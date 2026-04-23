# Behaviors, Usage Types, and Bandwidth

Models demand and supply on the network. Paired with the capacity fields on devices, this spec powers the Network Specs page and the throughput bottleneck analysis. Nodes and edges here live in the same graph described by [graphdata.md](graphdata.md).

## Overview

- **Consumer Behavior** and **Producer Behavior** are high-level roles a `customer` or `domain` exhibits.
- Each Behavior is composed of one or more **Behavior Insights** (reusable building blocks, e.g. "watches evening TV", "runs a messaging app").
- Each Insight `consumes` and/or `provides` a set of **Usage Types** (atomic network activities), with an optional `required` quantity.
- `domain` (Domain Name Registration) nodes use the same `consumes`/`provides` edges directly (a domain is effectively a producer/consumer without an intermediate Insight when convenient).
- Every Insight declares a **bandwidth cost per tick** expressed in traversals.
- Every Device (`server`, `switch`, `router`) declares a **traversals-per-tick capacity**.
- Servers additionally declare **CPU**, **memory**, and **storage** budgets; `program` nodes (see [programs.md](programs.md)) draw from those budgets and also participate in the same `Consumes` / `Provides` graph, injecting supply at their host server's `NIC` edges.
- The specs page aggregates supply vs demand per Usage Type and per Device; the bottleneck analyzer walks the topology to find saturated links, devices, and resource-overcommitted servers.

## Node types (added to [graphdata.md](graphdata.md))

### Consumer Behavior — type `consumerbehavior`
- Tags: `Logical`, `Behavior`, `Consumer`.
- Properties:
  - `name` (required, human-readable).
  - `description` (optional).
- Edges:
  - `Owner` from `customer` or `player` (N:M).
  - `Insight` to `behaviorinsight` (1:N).

### Producer Behavior — type `producerbehavior`
- Tags: `Logical`, `Behavior`, `Producer`.
- Properties/edges: same as Consumer Behavior but `Insight` edges typically link to producing insights.

### Behavior Insight — type `behaviorinsight`
- Tags: `Logical`, `Behavior`, `Insight`.
- Properties:
  - `name` (required).
  - `description` (optional).
  - `bandwidthPerTick` (integer, required, default `1`) — cost in traversals per tick when active.
  - `activeProbability` (optional float `[0,1]`, default `1.0`) — fraction of ticks the insight is active; used for expected-load math.
- Edges:
  - `Insight` from `consumerbehavior` or `producerbehavior` (reverse of above).
  - `Consumes` to `usagetype` (N:M, property `required` optional).
  - `Provides` to `usagetype` (N:M, property `required` optional).

### Usage Type — type `usagetype`
- Tags: `Logical`, `UsageType`.
- Id: slug drawn from the canonical Usage Type catalog below.
- Properties:
  - `label` (optional, display label; defaults to the id).
- Edges:
  - `Consumes` from `behaviorinsight` or `domain`.
  - `Provides` from `behaviorinsight` or `domain`.

## Canonical Usage Types

Reserved ids recognized by the app out of the box (file can still declare custom ones):

```
# Core consumer activities
read-text
view-image
stream-audio
stream-video
stream-voice
verify-user
authenticate-transaction
accept-instruction
tunnel-vpn-traffic
read-instant-messages
post-instant-messages
post-text
post-image
facilitate-banking
update-software

# Storage (produced by Padu/Poems-DB style programs)
store-text
store-image
store-audio
store-video

# Network infrastructure replies
reply-dns-queries
reply-dhcp-requests

# Media / comms server acceptors
accept-cctv-camera-connection
accept-cctv-monitor-connection
accept-voip-phone-connection
stream-live-video

# Crypto / decentro
facilitate-p2p-transaction
access-p2p-currency

# Botnet / inspection
inspect-user-packets
support-bots
```

Notes:
- Ids are lowercase kebab-case.
- A save file that references an id outside this list is accepted but triggers a lint warning; palette tab-complete still suggests custom ids that exist in the project.
- `label` lets the UI display "Stream Video" for `stream-video` without changing the stable id.

## Relationships (added to [graphdata.md](graphdata.md))

| Name | Direction | From | To | Cardinality | Strength | Properties |
|------|-----------|------|----|-------------|---------:|------------|
| `Insight` | directed | `consumerbehavior` \| `producerbehavior` | `behaviorinsight` | 1:N | 2 | none |
| `Consumes` | directed | `behaviorinsight` \| `domain` | `usagetype` | N:M | 3 | `required?: number` |
| `Provides` | directed | `behaviorinsight` \| `domain` | `usagetype` | N:M | 3 | `required?: number` |
| `OwnerBehavior` (uses existing `Owner`) | directed | `customer` \| `player` | `consumerbehavior` \| `producerbehavior` | N:M | 4 | none |

- `required` is optional on `Consumes` / `Provides`. When set, it declares the minimum units the edge demands/supplies per tick; when unset, the edge declares participation only (treated as 1 for aggregation unless the UI is in "required-only" mode).
- `Owner` is reused (it already disambiguates by endpoint types per [graphdata.md](graphdata.md)).

## Device capacity (added to Device nodes)

All `server`, `switch`, `router` nodes gain:

- `traversalsPerTick` (integer, required, default varies by type).
- Recommended defaults: `switch` = 1000, `router` = 500, `server` = 200. These are starting values; the save file wins.

Ports and uplinks do NOT have their own capacity value in v1 — each port's effective throughput is taken from the smaller of the two adjacent devices' `traversalsPerTick` divided by its port count. (Future: per-port capacities.)

## Bandwidth model

### Demand

For each Insight `I` owned (transitively via Behavior -> Insight) by a Consumer (`customer` or `player`):

```
demand(I) = I.bandwidthPerTick * I.activeProbability
```

Demand is attributed:

1. To the owning customer's `networkaddress` or `userport` (via existing `Owner` edges) as the **source** endpoint.
2. To the server(s) fronting the matching `Provides` Usage Types as the **sink** endpoint (see routing below).

For `domain` nodes with direct `Consumes` edges, the domain is itself the source endpoint at its `Owner`'s port.

### Supply

Two sources contribute to supply:

1. **Producer Insights** — for each Insight `I` attached to a Producer Behavior owned by a `domain` hosted on a `server`:

   ```
   supply(I) = I.bandwidthPerTick * I.activeProbability
   ```

2. **Programs** — for each `program` P installed on a `server` S, each `Provides` edge contributes its fixed `amount`; edges sharing a `pool` share the program's `pool.provide.<name>` total per tick (see [programs.md](programs.md)). A program's `Consumes` edges generate demand rooted at S.

In both cases, supply is attributed to the host server's `NIC` edge(s) as the sink endpoint for matching demand.

### Matching

For a given Usage Type `U`:

```
totalDemand(U)  = sum(demand(I))  over consumer-insights with Consumes-U edge
totalSupply(U)  = sum(supply(I))  over producer-insights with Provides-U edge
totalRequired(U)= sum(edge.required ?? 0) over Consumes edges targeting U
```

The specs page shows `totalSupply(U) >= totalDemand(U)` (green) else red, per Usage Type. `totalRequired(U)` surfaces as "committed demand" — a strict subset of `totalDemand(U)`.

### Path traversal cost

For each (source, sink) pair, the analyzer finds the shortest path through the connected topology (respecting cable types and uplink connections). Every device on the path accrues the pair's bandwidth:

```
load(device) += pairBandwidth
```

A **bottleneck** is any device where:

```
load(device) > device.traversalsPerTick
```

Edges (cables/uplinks) inherit the load of the smaller endpoint's capacity for display.

## Specs page

Top-level summary view, bound to a dedicated route or toggle button. Sections:

1. **Totals** — grand total supply, demand, required, and surplus/deficit in traversals/tick.
2. **By Usage Type** — table with columns: `UsageType`, `Supply`, `Demand`, `Required`, `Deficit`, `Status`.
3. **By Customer** — per-customer demand with their behaviors and insights expanded.
4. **By Producer/Domain** — per-producer supply.
5. **Device utilization** — table: `Device`, `Capacity`, `Load`, `Utilization %`, `Status` (traversals per tick).
6. **Programs** (see [programs.md](programs.md)) — per server: installed programs and their CPU/memory/storage consumption.
7. **Server capacity** — per server: CPU used/total, memory used/total, storage used/total, status.
8. **Bottlenecks** — ordered list of saturated devices/links, plus CPU/memory/storage-overcommitted servers, each with top contributing paths or hosted programs.

Each row links back to the graph view with a filter pre-applied ([filters.md](filters.md)).

## Bottleneck analysis algorithm

```
function analyze(graph):
    load = Map<DeviceId, number>()
    linkLoad = Map<EdgeId, number>()
    for (src, sink, bw) in iterPairs(graph):
        path = shortestPath(graph, src, sink)
        if path is null:
            recordUnreachable(src, sink, bw)
            continue
        for node in path.devices:
            load[node] += bw
        for edge in path.edges:
            linkLoad[edge] += bw
    resource = computeServerResources(graph)   # see programs.md
    return {
        deviceLoad: load,
        linkLoad,
        bottlenecks: [d for d in load if load[d] > graph.get(d).traversalsPerTick],
        overCpu:     resource.overCpu,
        overMemory:  resource.overMemory,
        overStorage: resource.overStorage,
        unreachable: ...
    }
```

Details:
- `iterPairs` yields one entry per matched `(consumerInsight, producerInsight, usageType)` whose `Usage Type` matches.
- `bw = min(consumerInsight.bandwidthPerTick * p, producerInsight.bandwidthPerTick * p)` where `p = consumer.activeProbability * producer.activeProbability`.
- When `required` is set on either edge, `bw = max(bw, required)` to honor commitments.
- The analyzer is memoized on graph hash; invalidated on mutation.
- Multiple equal-cost paths: load is split equally ("ECMP-lite") — configurable flag `analysis.ecmp = true|false`.

Complexity: O(P * (V + E)) where P = matched pairs; fine for the target graph size (< 10k nodes).

## Commands (added to [commands.md](commands.md))

See the Behaviors section there. Summary:

- `add behavior <consumer|producer> --name=<name>`
- `add insight --name=<name> --bw=<n> [--p=<0..1>]`
- `link insight <behaviorId> <insightId>`
- `link consume <insightOrDomainId> <usageTypeId> [--required=<n>]`
- `link provide <insightOrDomainId> <usageTypeId> [--required=<n>]`
- `add usage <id> [--label="..."]`
- `mod device <id> --traversals=<n>`
- `analyze`
- `bottleneck [--top=<n>]`
- `specs` — opens the specs page.

## File format (added to [fileformat.md](fileformat.md))

New type keywords: `consumerbehavior`, `producerbehavior`, `behaviorinsight`, `usagetype`.

New relation names: `Insight`, `Consumes`, `Provides`.

Example:

```
usagetype stream-video label="Stream Video"
usagetype stream-audio label="Stream Audio"
behaviorinsight evening-tv name="Evening TV" bandwidthPerTick=40 activeProbability=0.6
behaviorinsight music name="Background Music" bandwidthPerTick=8
consumerbehavior casual-home-user name="Casual Home User"
customer organic-goat

customer[organic-goat] -> consumerbehavior[casual-home-user] :Owner
consumerbehavior[casual-home-user] -> behaviorinsight[evening-tv] :Insight
consumerbehavior[casual-home-user] -> behaviorinsight[music] :Insight
behaviorinsight[evening-tv] -> usagetype[stream-video] :Consumes {required=25}
behaviorinsight[music] -> usagetype[stream-audio] :Consumes

domain["netplix.example"] -> usagetype[stream-video] :Provides {required=50}
```

## Visualization (added to [visualization.md](visualization.md))

- Behavior nodes: rounded-rect, Logical hue.
- Insight nodes: small pill with the bandwidth number rendered inside.
- Usage Type nodes: cloud/tag glyph, always grouped visually near their owning domain/insight.
- Bottleneck overlay toggle: when on, each device's fill is a red-scale gradient driven by `load / traversalsPerTick`; links inherit their heavier endpoint's color. Capacity tooltip shows both numbers and the top 3 contributing pairs.

## Non-goals (v1)

- No time-series simulation; one tick, steady-state.
- No latency or jitter modeling.
- No per-port capacities (device-level only).
- No automatic behavior inference from real traffic.
