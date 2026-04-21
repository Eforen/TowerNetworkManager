# Programs

Programs are software that runs on servers. Each program consumes host resources (CPU, memory, storage) and participates in the bandwidth economy described in [behaviors.md](behaviors.md) by consuming and/or providing Usage Types per tick. Reference game data: the Hitchhiker's Guide to Tower Networking (programs sections).

## Goals

- Model what programs a server hosts and whether that server has enough CPU/memory/storage to run them.
- Fold program supply into the same supply/demand math used for behaviors, so the Specs page and bottleneck analysis account for both.
- Support "pool" producers like GitCoffee that produce N total units spread across several Usage Types.

## New node type

### Program — type `program`
- Tags: `Logical`, `Program`.
- Id: slug-case name, typically the in-game program id (`padu_v1`, `dnsmasq`, `gitcoffee`, etc.).
- Properties:
  - `name` (optional display label).
  - `cpu` (integer, required) — CPU units consumed on the host server per tick.
  - `memory` (integer, required) — memory units consumed.
  - `storage` (integer, required) — storage units consumed.
  - `description` (optional).
- Edges:
  - `Install` from `server` (N:M; many programs per server, and one program slug may be installed on many servers as separate instances).
  - `Consumes` to `usagetype` (N:M, optional `amount`, optional `pool`).
  - `Provides` to `usagetype` (N:M, optional `amount`, optional `pool`).

Programs re-use the existing `Consumes` and `Provides` relations from [behaviors.md](behaviors.md), so all aggregation and bottleneck logic works uniformly for Behaviors, Domains, and Programs.

## New relationship

| Name | Direction | From | To | Cardinality | Strength | Properties |
|------|-----------|------|----|-------------|---------:|------------|
| `Install` | directed | `server` | `program` | 1:N | 1.5 | `instance?: string` (disambiguator when a slug is installed twice on one server) |

Validation:
- Every `Install` edge implies that `sum(program.cpu) <= server.cpuTotal`, and likewise for `memory` and `storage`. The analyzer reports violations; the editor does not block them.
- The program node is the shared definition; the `Install` edge is the running instance. Edge properties may override consume/provide amounts per-instance when needed (future).

## Server resource properties (added to [graphdata.md](graphdata.md))

The `server` node type gains three additional properties alongside the existing `traversalsPerTick`:

- `cpuTotal` (integer, default `8`) — CPU units available for installed programs.
- `memoryTotal` (integer, default `8`) — memory units available.
- `storageTotal` (integer, default `16`) — storage units available.

Typical game values range from tiny (Meerkat ~ 4/4/8) to standard (Boulder+ ~ 8/8/16) to large (ICC ~ 16/16/32); the save file wins.

## Amount and pool semantics

Each `Consumes` or `Provides` edge from a `program` node accepts two optional properties:

- `amount` — fixed units per tick attributable to this edge.
- `pool` — pool name shared across edges of the same program and same direction.

Pools model game patterns like GitCoffee ("16 total Read-Text and Update-Software per tick") and Padu_V1 ("1 total unit of Store-Text or Store-Image per tick").

Pool totals are declared on the program via a `pool.<direction>.<name>=<total>` property, where `<direction>` is `provide` or `consume`:

```
program gitcoffee cpu=4 memory=2 storage=4 pool.provide.main=16
program[gitcoffee] -> usagetype[read-text]       :Provides {pool=main}
program[gitcoffee] -> usagetype[update-software] :Provides {pool=main}
program[gitcoffee] -> usagetype[store-text]      :Consumes {amount=2}
```

Rules:
- An edge belongs to exactly one pool (by `pool` name) OR declares a fixed `amount`.
- If multiple edges share a pool, the pool total is split across them at runtime to maximize satisfied demand. The default split is equal; the analyzer produces the optimal split subject to declared `amount` minima when present.
- An edge with neither `amount` nor `pool` defaults to `amount=1`.
- `amount` and `pool` may coexist on the same edge only when `amount` is a **minimum**; pool capacity is reserved for it first.

## Resource accounting

Per server `S`:

```
cpuUsed(S)     = sum(p.cpu     for p in installedPrograms(S))
memoryUsed(S)  = sum(p.memory  for p in installedPrograms(S))
storageUsed(S) = sum(p.storage for p in installedPrograms(S))
```

A server is **resource-overcommitted** when any of `cpuUsed > cpuTotal`, `memoryUsed > memoryTotal`, `storageUsed > storageTotal`. The Specs page flags these in red; the bottleneck analyzer lists them separately from traversal bottlenecks because they have different remediation (scale server, move program, buy new server).

## Supply integration

For analysis, a program on server `S` producing Usage Type `U` with effective per-tick amount `a` contributes:

```
supply(U) += a
sourceEndpoint(a) = any NIC-connected port of S
```

This means program supply is injected at the server's network edge, identical to how a `domain`'s `Provides` edges were treated before. Consumers (behaviors, domains) elsewhere pull from that pool via the pathing logic in [behaviors.md](behaviors.md).

Consumer-side `Consumes` from programs is handled symmetrically: a program hosting a `Consumes store-text` edge creates demand that must be served by some other producer (Padu variant, Poems-DB, etc.) reachable via the network from `S`.

## Specs page additions

The Specs page described in [behaviors.md](behaviors.md) gains:

1. A **Programs** section per server: `Program`, `CPU`, `Memory`, `Storage`, `Status`.
2. A **Server capacity** section: `Server`, `CPU used/total`, `Memory used/total`, `Storage used/total`, `Status`.
3. The per-Usage-Type table now attributes supply to both Behaviors (via Insights) and Programs, and splits the "Supply by source" mini-column accordingly.

## Bottleneck analysis additions

The analyzer returns three new categories alongside the existing traversal bottlenecks:

- `overCpu: ServerId[]`
- `overMemory: ServerId[]`
- `overStorage: ServerId[]`

These do not block pathing; they are warnings on the hosting server. A program on a resource-overcommitted server still participates in supply math but is flagged.

## Canonical starter programs

These are reserved slugs recognized by the app (convenience auto-complete; a save file may still declare any program). Values are starter defaults drawn from the game guide; save files may override any field.

| Slug | CPU | Mem | Stor | Consumes | Provides | Notes |
|------|----:|----:|-----:|----------|----------|-------|
| `padu_v1` | 1 | 2 | 4 | — | pool `main` total 1 over `store-text`, `store-image` | starter |
| `padu_v2` | 2 | 4 | 8 | — | pool `main` total 2 over `store-text`, `store-image`, `store-audio` | |
| `padu_v3` | 4 | 6 | 12 | — | pool `main` total 4 over `store-text`, `store-image`, `store-audio`, `store-video` | |
| `poems-db` | 4 | 4 | 6 | — | 4 `store-text` (fixed) | largest text store |
| `dnsmasq` | 1 | 1 | 2 | — | 3 `reply-dns-requests` | starter DHCP/DNS |
| `kea` | 6 | 5 | 7 | 1 `store-text` | 15 `reply-dhcp-requests` | |
| `dns-lite` | 1 | 1 | 2 | — | 3 `reply-dns-queries` | starter DNS |
| `dns-server` | 4 | 3 | 3 | 1 `store-text` | 20 `reply-dns-queries` | |
| `sun-dns` | 10 | 6 | 9 | 3 `store-text` | 40 `reply-dns-queries` | enterprise |
| `decentro-node` | 24 | 12 | 6 | — | 10 `facilitate-p2p-transaction` | |
| `decentro-collector` | 1 | 1 | 1 | — | — | storage of p2p currency |
| `decentro-wallet` | 1 | 2 | 2 | — | — | |
| `gitcoffee` | 4 | 2 | 4 | 2 `store-text` | pool `main` total 16 over `read-text`, `update-software` | |
| `mailer` | 5 | 6 | 3 | pool `in` total 3 over `store-text`, `store-image` | pool `main` total 15 over `read-text`, `post-text`, `verify-user` | |
| `rtsp-diva-r` | 6 | 4 | 10 | — | pool `main` total 13 over `accept-cctv-camera-connection`, `accept-cctv-monitor-connection` | |
| `voip-server` | 5 | 2 | 6 | — | 10 `accept-voip-phone-connection` | |
| `mbox` | 1 | 1 | 2 | — | — | middlebox |
| `ubbt` | 4 | 4 | 6 | 4 `inspect-user-packets` | 4 `support-bots` | secretariat unlock |

## File format (added to [fileformat.md](fileformat.md))

New type keyword: `program`. New relation: `Install`.

Example:

```
server s1 #Server cpuTotal=8 memoryTotal=8 storageTotal=16 traversalsPerTick=200
program gitcoffee cpu=4 memory=2 storage=4 pool.provide.main=16
program poems-db cpu=4 memory=4 storage=6

server[s1] -> program[gitcoffee] :Install
server[s1] -> program[poems-db]  :Install
program[gitcoffee] -> usagetype[read-text]       :Provides {pool=main}
program[gitcoffee] -> usagetype[update-software] :Provides {pool=main}
program[gitcoffee] -> usagetype[store-text]      :Consumes {amount=2}
program[poems-db]  -> usagetype[store-text]      :Provides {amount=4}
```

## Commands (added to [commands.md](commands.md))

See the Programs section there. Summary:

- `program install <slug> on <serverId>` — install.
- `program uninstall <slug> on <serverId>` — uninstall (cascades its edges).
- `program list [on <serverId>]` — list installed programs.
- `program show <slug>` — print definition and defaults.
- `add program <slug> --cpu=<n> --memory=<n> --storage=<n> [--pool.provide.<name>=<n>] ...` — create a custom program definition.
- `mod server <id> --cpuTotal=<n> --memoryTotal=<n> --storageTotal=<n>` — adjust server capacity.

## Visualization

- `program` nodes render inside their host server's orbit as small rounded squares labeled with the slug; a compact badge shows `cpu/mem/stor`.
- Resource overlay (toggle `r`): fills each `server` with a three-bar mini-gauge for CPU/Mem/Storage utilization, using the same green/yellow/orange/red scale as the traversal overlay.
- `Install` edges render short and thick (strength 1.5).

## Non-goals (v1)

- No program versioning/migrations.
- No startup time / boot ordering; all installs are instantaneous and steady-state.
- No per-instance override of program consume/provide amounts (planned via `Install` edge properties in a future revision).
- No pricing (PPU) modeled here; revenue math is out of scope.
