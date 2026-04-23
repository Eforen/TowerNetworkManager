# Inspection Tools

Two-point inspection tools for diagnosing the network. Each tool accepts exactly two endpoints, runs a read-only analysis, and renders the result directly on the graph view in [visualization.md](visualization.md). Backed by the model in [graphdata.md](graphdata.md) and the analyzer in [behaviors.md](behaviors.md).

## Tools

### `inspect route <a> <b>`
- **Purpose**: Answer "is `a` connected to `b`, and what route would packets take?"
- **Direction**: Always evaluated as *consumer -> producer*. If one endpoint has (or is reached by) a `Consumes` edge for a Usage Type that the other side `Provides`, that ordering wins; otherwise the order given on the command line is used (`a` = source, `b` = sink).
- **Output**:
  - Success: ordered list of devices and edges from source to sink; total path strength/length; each hop annotated with the port/interface used.
  - Failure: the prefix of the path that resolved, plus the first dead-end reason (no route entry on router X, media mismatch at port Y, filtered by firewall in a future update, etc.).
- **Side effects**: none on the model. The path is highlighted on the graph until the tool is dismissed.

### `inspect bottleneck <a> <b>`
- **Purpose**: Answer "between `a` and `b`, where is the first saturated or resource-starved link/device?"
- **Uses**: the shortest path from `inspect route`, the traversal loads from [behaviors.md](behaviors.md), and the server-resource loads from [programs.md](programs.md).
- **Output**:
  - Ranked list of hops on the path with columns: `Hop`, `Device`, `Load / Capacity`, `Headroom`, `Severity`.
  - First saturated hop highlighted as the "primary bottleneck".
  - Additional rows for program resources (CPU/Mem/Storage) when the sink or a midpoint is a server hosting programs that contribute to the pair's demand.
- **Side effects**: none. Path + primary bottleneck highlighted on the graph.

## Endpoint resolution

Each endpoint argument can be any of:

- A node id (e.g. `@f1/c/1`, `db01`, `organic-goat`, `netplix.example`).
- A `customer`, `player`, or `domain`: resolves to their owning/hosting network endpoint:
  - `customer` / `player` -> their `userport` (via `Owner`).
  - `domain` -> the `server` that hosts the `program` which `Provides` the matching Usage Type; if ambiguous, prompt the user.
- A `usagetype`: invalid by itself; must be paired with a consumer/producer anchor.

If an endpoint cannot be resolved to a physical `port`, the tool walks `NIC` edges until it reaches one. The resolved port pair is what the pathing algorithm actually uses.

## Picking from the UI

Both tools can be invoked without args; the palette drops into the `PickingTarget` substate (see [statemachine.md](statemachine.md)) and waits for two graph clicks:

1. User runs `inspect route` or `inspect bottleneck` with no args.
2. Palette closes; a thin banner at the top shows `Pick endpoint 1` and a crosshair cursor.
3. Click a node -> banner updates to `Pick endpoint 2` with endpoint 1's label.
4. Click a second node -> tool runs; result overlay appears; banner shows `Esc to dismiss`.

Shortcuts:

- `r` with no modal open -> same as `inspect route` with no args.
- `b` is already used for the bottleneck overlay; `Shift+b` starts `inspect bottleneck` pick mode.
- `Esc` at any point cancels picking.
- Right-click a node during picking -> "Use as endpoint 1/2" context option.
- While picking, hovering a node shows its tooltip plus a small badge: `Endpoint 1?` or `Endpoint 2?`.

## Result panel

Both tools pin a compact result panel to the right side of the viewport until dismissed:

```
+----------------------------------------------+
| inspect route                                |
| from: customer organic-goat (@f1/c/1)        |
| to:   domain "netplix.example" (server db01) |
|                                              |
| 1. port @f1/c/1   (RJ45)                     |
| 2. switch sw1     port p3 -> p0              |
| 3. router rt1     route @f1/c/* -> port1     |
| 4. server db01    NIC port @f1/s/1           |
|                                              |
| length: 4 hops    strength: 3.5              |
| [Close]  [Copy path]  [Bottleneck this path] |
+----------------------------------------------+
```

`Bottleneck this path` pivots the same endpoint pair into `inspect bottleneck` without a second pick.

For `inspect bottleneck` the table adds `Load / Capacity` and `Severity` columns and sorts by severity when `--rank` is passed.

## Algorithms

### Route finding

```
function route(src, dst):
    (srcPort, dstPort) = resolveEndpoints(src, dst)
    # BFS over cable/uplink links, honoring routing tables when traversing a router
    visited = {}
    queue = [ (srcPort, path=[srcPort]) ]
    while queue not empty:
        (cur, path) = queue.popleft()
        if cur == dstPort: return path
        for next in nextHops(cur):
            if next in visited: continue
            visited.add(next)
            queue.push((next, path + [next]))
    return null
```

`nextHops` rules:
- From a `port`, follow a `NetworkCableLink*` or `UplinkConnection` to the other port; or traverse into the owning device via `NIC`.
- From a `switch`, any `NIC`-connected port is a candidate (broadcast domain).
- From a `router`, only ports referenced by a matching `Route` entry in the router's `RoutingTable` are candidates; the `Route.target` is matched against `dstPort`'s network address (longest-prefix match on the `@fN/.../...` hierarchy per [graphdata.md](graphdata.md)).
- From a `server`, only `NIC` ports are candidates; pathing then terminates (`server` is a sink).
- Media compatibility: `FiberOptic` ports and `RJ45` ports don't cross-connect except through a device.

If no path is found, the tool returns the failure reason from the last attempted hop (e.g. `router rt1: no route matching @f1/c/1`).

### Bottleneck on a path

Given `path = [p_0, d_1, p_1, d_2, ..., p_k]` where `p_i` are ports and `d_i` are devices:

```
pairBw = demandFor(src, dst)        # from behaviors.md
totals = analyze(graph).deviceLoad  # cached from last analyze
results = []
for device d in path.devices:
    cap  = d.traversalsPerTick
    load = totals[d.id]
    share = pairBw                  # this pair contributes share to load
    headroom = cap - load
    severity = load / cap
    results.push({ d, cap, load, share, headroom, severity })
primary = argmax(results, key=severity)  # first >= 1.0 wins; else highest
```

For server endpoints, the tool also reports `cpu/memory/storage` overcommit per [programs.md](programs.md) as secondary rows.

### Link bottlenecks

Each cable/uplink link edge inherits a capacity equal to the link's physical rating when present (`linkCapacity` property on `NetworkCableLink*` / `UplinkConnection` edges; default = smaller of the two device capacities). When `share > linkCapacity` the link is flagged alongside any device bottlenecks.

## CLI forms and flags

- `inspect route <a> <b> [--show-unreachable]`
- `inspect bottleneck <a> <b> [--rank] [--include=<traversal|cpu|memory|storage|all>]`
- `inspect pick route` / `inspect pick bottleneck` — explicit picker form.
- `inspect clear` — dismiss any pinned inspection overlay.
- `inspect last` — re-open the most recent result.

Aliases:

- `route <a> <b>` (no model conflict with `route add/default/...` because those take keywords first).
- `btwn <a> <b>` for `inspect bottleneck`.

Results of any inspect command are not added to the undo stack (read-only).

## Visualization hooks

See [visualization.md](visualization.md) for the path highlight + primary-bottleneck styling. The tool sets:

- `ui.pathHighlight = { edges: [...], nodes: [...], primary: deviceId? }`
- Graph CSS applies classes `.path-edge`, `.path-node`, `.path-primary-bottleneck` accordingly.

## Non-goals (v1)

- No multi-path or ECMP visualization in the inspection tools (the global bottleneck overlay handles ECMP).
- No firewall/port-number-aware pathing in v1; all links are treated as protocol-agnostic. Future: add per-protocol filters that can disqualify hops.
- No latency modeling; the "strength" column is a topology distance proxy only.
