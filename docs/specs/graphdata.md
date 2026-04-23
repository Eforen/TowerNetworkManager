# Graph Data Model

Defines the node and relationship types for the Tower Networking Inc graph. Consumed by [fileformat.md](fileformat.md), [visualization.md](visualization.md), [filters.md](filters.md), and [commands.md](commands.md).

## Conventions

- **Node id**: slug-case, `[a-z0-9][a-z0-9_-]*`, 1..64 chars, unique per type.
  - `networkaddress` uses a **Network Address** (see below) as its id.
  - `uplink` uses a 4-letter ISP code (e.g. `comc`, `attn`). Not a network address. Regex `^[a-z]{4}$`.
  - `port` nodes come in two flavors:
    - **UserPort** (customer endpoint): id IS the **Hardware Address** of the customer's equipment (1..5 numeric digits). Acts like a device — carries no extra properties beyond tags/hardware id. Customer-controlled; can change if the customer swaps gear.
    - **Device port** (NIC on a server / switch / router): id is literally `port` followed by digits — `port0`, `port1`, `port10`. Regex: `^port\d+$`. No `eth0`, no custom slugs. Port ids are globally unique within the `port` type. A device port without a `NIC` edge to a device is a warning.
  - `server`, `switch`, `router`: carry their own static **Hardware Address** via a `hardwareAddress` property.
  - The (changeable) **Network Address** for any addressable entity is attached via a `networkaddress` node and an `AssignedTo` edge; it is never an id.
  - For `domain`, the domain name IS the id.
- **Tag**: PascalCase, drawn from the canonical list below. Casing is enforced; `FiberOptic` not `Fiber Optic`, `NetworkPort` not `Network Port`.
- **Edge direction**: `from -> to`. Edges marked (undirected) have no semantic direction but are still serialized in id-sorted order.
- **Cardinality**: noted per edge as `from:to` (e.g. `1:N`, `N:N`).
- **Strength**: lower number = stronger = shorter link in the force simulation ([visualization.md](visualization.md)).

## Data types

- **Domain Name**
  - Format: normal domain name (`[a-z0-9.-]+`), lowercased.
- **Hardware Address**
  - Format: 1..5 numeric digits total.
  - Regex: `^\d{1,5}$`.
  - Static per piece of hardware. Carried as:
    - The `id` of a `port` node tagged `UserPort` (the customer's endpoint gear).
    - The `hardwareAddress` property of `server`, `switch`, `router` (optional but required for uniqueness when multiple devices share a floor/rack).
- **Network Address**
  - An ISP-assigned address; can be reassigned to different hardware over time.
  - Represented by a `networkaddress` node whose id is:
    - Must start with `@`.
    - Max 10 characters total including `@`.
    - Only letters, numbers, `-`, `_`, `/` allowed.
    - Regex: `^@[A-Za-z0-9_\-/]{1,9}$`.
  - Examples: `@f1/123`, `@f1/c/1`, `@f2/s/9`.
  - An address is bound to its current holder via an `AssignedTo` edge (`networkaddress -> server | router | switch | port | uplink | customer | player`).
  - `uplink` nodes have their own 4-letter id and, like other devices, are bound to a `networkaddress` via an `AssignedTo` edge when addressable.

## Canonical tag list

- Families: `Physical`, `Logical`.
- Roles: `Device`, `Network`, `NetworkPort`, `User`, `Player`, `Routing`, `Location`, `DomainName`, `Behavior`, `Insight`, `UsageType`, `Consumer`, `Producer`, `Program`.
- Specifics: `Server`, `Switch`, `Router`, `Floor`, `Rack`, `RJ45`, `FiberOptic`, `Uplink`, `UserPort`.

Additional tags may be added by users, but they must match `^[A-Z][A-Za-z0-9]*$`.

## Node types

Each entry lists: purpose, required properties, default tags, and allowed edges (by relation name and role — "from" or "to").

### Player
- Purpose: the human player.
- Tags: `Logical`, `Player`, `User`.
- Properties: none required.
- Edges: from `Owner` (to `UserPort`, `DomainRegistration`).

### Network Port (RJ45) — type `port` + tag `RJ45`
- Tags: `Physical`, `NetworkPort`, `RJ45`.
- Id: literal `port` + digits (`port0`, `port1`, ...). Regex `^port\d+$`. UserPort ports instead use a 1..5 digit hardware address.
- Must be the target of a `NIC` edge from a `server` / `switch` / `router` (validation warning if missing).
- Edges: from `NIC` (from Device), to/from `NetworkCableLinkRJ45` (undirected), from `FloorAssignment` (from Floor), from `RackAssignment` (from Rack).

### Network Port (Fiber Optic) — type `port` + tag `FiberOptic`
- Tags: `Physical`, `NetworkPort`, `FiberOptic`.
- Same id rules and edges as RJ45 variant but using `NetworkCableLinkFiber`.

### User Port (RJ45/Fiber Optic) — type `port` + tag `UserPort`
- Tags: `Physical`, `NetworkPort`, `UserPort`, and one of `RJ45` | `FiberOptic`.
- Id IS the hardware address (`^\d{1,5}$`, customer-controlled). No `NIC` edge; a UserPort represents the customer's gear.
- Validation warning if the UserPort has no `NetworkCableLink*` edge (dangling customer endpoint).
- Edges: from `Owner` (from Customer/Player), `NetworkCableLink*`, `FloorAssignment`, `RackAssignment`, and may be the target of an `AssignedTo` edge from a `networkaddress`.

### Uplink Port (RJ45/Fiber Optic) — type `uplink`
- Tags: `Physical`, `NetworkPort`, `Uplink`, and one of `RJ45` | `FiberOptic`.
- Id: 4 lowercase letters (ISP code), e.g. `comc`, `attn`. Regex `^[a-z]{4}$`.
- Edges: `UplinkConnection` (undirected, must connect same sub-type), plus Port edges. Bound to a `networkaddress` via `AssignedTo` when addressable.

### Network Switch — type `switch`
- Tags: `Physical`, `Device`, `Network`, `Switch`.
- Properties:
  - `traversalsPerTick` (integer, default `1000`) — capacity for bandwidth analysis; see [behaviors.md](behaviors.md).
  - `hardwareAddress` (optional numeric, 1..5 digits) — the switch's static hardware id.
- Edges: `NIC` (from Switch, to Port) 1:N; `FloorAssignment` (to from Floor); `RackAssignment` (to from Rack); may be the target of an `AssignedTo` edge from a `networkaddress`.

### Network Router — type `router`
- Tags: `Physical`, `Device`, `Network`, `Router`.
- Properties:
  - `traversalsPerTick` (integer, default `500`).
  - `hardwareAddress` (optional numeric, 1..5 digits).
- Edges: `NIC` 1:N; `Owner` to `RoutingTable` 1:1; floor/rack assignments; may be the target of an `AssignedTo` edge from a `networkaddress`.

### Server — type `server`
- Tags: `Physical`, `Device`, `Server`.
- Properties:
  - `traversalsPerTick` (integer, default `200`).
  - `cpuTotal` (integer, default `8`) — CPU budget for installed programs.
  - `memoryTotal` (integer, default `8`) — memory budget for installed programs.
  - `storageTotal` (integer, default `16`) — storage budget for installed programs.
  - `hardwareAddress` (optional numeric, 1..5 digits) — static hardware id.
- Edges: `NIC` 1:N; floor/rack assignments; `Install` to `program` 1:N (see [programs.md](programs.md)); may be the target of an `AssignedTo` edge from a `networkaddress`.

### Floor — type `floor`
- Tags: `Physical`, `Location`, `Floor`.
- Required property: `level` (integer), or inferred from id (`f1` -> 1).
- Edges: `FloorAssignment` (from Floor, to Device|Rack) 1:N.

### Rack — type `rack`
- Tags: `Physical`, `Location`, `Rack`.
- Edges: `RackAssignment` (from Rack, to Device) 1:N; a rack is itself `FloorAssignment`ed to a Floor.

### Customer — type `customer`
- Tags: `Logical`, `User`.
- Properties:
  - `customerName` (e.g. `organic-goat`), defaults from id.
- Edges: `Owner` (from Customer) to `UserPort` or `DomainRegistration` or `customertype`; may be the target of an `AssignedTo` edge from a `networkaddress`.

### Customer Type — type `customertype`
- Tags: `Logical`, `User`.
- Properties: `name` (e.g. "Casual Dweller").
- Edges: `Owner` (to, from Customer).

### Routing Table — type `rtable`
- Tags: `Logical`, `Routing`.
- Edges: `Owner` (to, from Router) 1:1; `Route` (from, to `rtable` | `port` | `uplink`).

### Domain Name Registration — type `domain`
- Tags: `Logical`, `DomainName`.
- Properties: `domainName` (required; also usable as id).
- Edges: `Owner` (to, from Customer|Player); `Consumes` / `Provides` (to `usagetype`, optional `required` property) — see [behaviors.md](behaviors.md).

### Network Address — type `networkaddress`
- Represents a logical, reassignable address that can be bound to any addressable holder.
- Tags: `Logical`.
- Id: the address itself (`@...`).
- Edges: `AssignedTo` (from `networkaddress`, to `server` | `router` | `switch` | `port` | `uplink` | `customer` | `player`) 1:1 at any moment; `Route` (to/from `rtable`).
- A single `networkaddress` has at most one outbound `AssignedTo` edge at a time (spec rule, enforced as a validation error on duplicates).

### Consumer Behavior — type `consumerbehavior`
- Tags: `Logical`, `Behavior`, `Consumer`.
- Properties: `name` (required), `description` (optional).
- Edges: `Owner` (to, from `customer` | `player`); `Insight` (from, to `behaviorinsight`) 1:N.
- See [behaviors.md](behaviors.md).

### Producer Behavior — type `producerbehavior`
- Tags: `Logical`, `Behavior`, `Producer`.
- Properties: `name` (required), `description` (optional).
- Edges: same as Consumer Behavior.
- See [behaviors.md](behaviors.md).

### Behavior Insight — type `behaviorinsight`
- Tags: `Logical`, `Behavior`, `Insight`.
- Properties: `name` (required), `description` (optional), `bandwidthPerTick` (integer, default `1`), `activeProbability` (float `[0,1]`, default `1.0`).
- Edges: `Insight` (to, from Behavior); `Consumes` (from, to `usagetype`) with optional `required`; `Provides` (from, to `usagetype`) with optional `required`.
- See [behaviors.md](behaviors.md).

### Usage Type — type `usagetype`
- Tags: `Logical`, `UsageType`.
- Id: kebab-case slug, e.g. `stream-video`; see canonical list in [behaviors.md](behaviors.md).
- Properties: `label` (optional display string).
- Edges: `Consumes` (to, from `behaviorinsight` | `domain` | `program`); `Provides` (to, from `behaviorinsight` | `domain` | `program`).

### Program — type `program`
- Tags: `Logical`, `Program`.
- Properties: `cpu` (required), `memory` (required), `storage` (required), `name`, `description`, optional pool totals `pool.provide.<name>` / `pool.consume.<name>`.
- Edges: `Install` (from `server`) N:M; `Consumes` / `Provides` (to `usagetype`, with optional `amount` and/or `pool`).
- See [programs.md](programs.md).

## Relationships

| Name | Direction | From | To | Cardinality | Strength | Notes |
|------|-----------|------|----|-------------|---------:|-------|
| `NIC` | directed | `server` \| `switch` \| `router` | `port` (RJ45 or Fiber, non-`UserPort`) | 1:N | 0.5 | Device owns its ports. |
| `Owner` | directed | `customer` \| `player` | `UserPort` \| `domain` \| `customertype` | N:M | 4 | Also used for `router -> rtable` 1:1. |
| `AssignedTo` | directed | `networkaddress` | `server` \| `router` \| `switch` \| `port` \| `uplink` \| `customer` \| `player` | 1:1 (per address) | 3 | Binds a logical network address to its current holder. |
| `NetworkCableLinkRJ45` | undirected | `port`+`RJ45` | `port`+`RJ45` | 1:1 | 1.5 | Physical patch. |
| `NetworkCableLinkFiber` | undirected | `port`+`FiberOptic` | `port`+`FiberOptic` | 1:1 | 1.0 | Physical patch. |
| `FloorAssignment` | directed | `floor` | `server` \| `switch` \| `router` \| `rack` | 1:N | 3 | Where a device lives. |
| `RackAssignment` | directed | `rack` | `server` \| `switch` \| `router` | 1:N | 2 | Within rack. |
| `UplinkConnection` | undirected | `uplink` | `uplink` (same sub-tag) | 1:1 | 5 | Matches Fiber↔Fiber or RJ45↔RJ45. |
| `Route` | directed | `rtable` | `rtable` \| `port` \| `uplink` \| `networkaddress` | 1:N | 2.5 | Property: `target` (datatype, network address, or hardware address). |
| `Insight` | directed | `consumerbehavior` \| `producerbehavior` | `behaviorinsight` | 1:N | 2.0 | Composes a behavior from insights. |
| `Consumes` | directed | `behaviorinsight` \| `domain` \| `program` | `usagetype` | N:M | 3.0 | Optional properties `required`, `amount`, `pool`. |
| `Provides` | directed | `behaviorinsight` \| `domain` \| `program` | `usagetype` | N:M | 3.0 | Optional properties `required`, `amount`, `pool`. |
| `Install` | directed | `server` | `program` | 1:N | 1.5 | Installed program instance on a server. |

Notes:
- "Strength" mirrors the original spec numbers; visualization turns these into link distance/strength per [visualization.md](visualization.md).
- `Owner` is intentionally overloaded (several (from, to) combos). The parser and `link` command use endpoint types to disambiguate.

## Validation rules

- No dangling edges: both endpoints must exist.
- `NIC` target must be a port node (tag `NetworkPort`) and NOT carry the `UserPort` tag (device NICs and user endpoints are distinct; use `NetworkCableLink*` to connect a device port to a user port).
- `NetworkCableLink*` endpoints must share media tag (`RJ45` or `FiberOptic`).
- `UplinkConnection` endpoints must both be `uplink` and share media tag.
- `FloorAssignment.from` and `RackAssignment.from` must be `floor`/`rack` respectively.
- Id uniqueness:
  - Unique (type, id) per node.
  - `networkaddress` ids must match the network-address regex; `uplink` ids must match `^[a-z]{4}$`.
  - `port` ids: UserPort-tagged ports match `^\d{1,5}$`; device ports match `^port\d+$`.
- A `networkaddress` has at most one `AssignedTo` edge at a time; declaring two is an error.
- Device ports (non-UserPort) must have a `NIC` edge from a device (warning if missing).
- UserPorts must have at least one `NetworkCableLink*` edge (warning if dangling).
- Tags outside the canonical list are allowed but surface a lint warning.
- `Consumes` / `Provides` endpoints must be one of the allowed source types (`behaviorinsight`, `domain`) paired with `usagetype` on the other side.
- `Insight` edges must originate from a Behavior node and target a `behaviorinsight`.
- `required` on `Consumes`/`Provides` must be a non-negative number when present.
- `traversalsPerTick` on Device nodes must be a non-negative integer.
- `cpu`, `memory`, `storage` on Program nodes must be non-negative integers.
- `cpuTotal`, `memoryTotal`, `storageTotal` on Server nodes must be non-negative integers.
- `Install` edges must originate from a `server` and target a `program`.
- A `Provides`/`Consumes` edge may set `amount` (fixed) or `pool` (shared); a pool referenced on edges must have a matching `pool.<dir>.<name>` total on the owning program node.

## Indices (runtime)

The app maintains derived indices for fast queries:

- `byType: Map<NodeType, Set<NodeId>>`
- `byTag:  Map<Tag, Set<NodeId>>`
- `floorOf: Map<NodeId, FloorNumber | undefined>` — via `FloorAssignment` + transitive through `RackAssignment`.
- `adjacency: Map<NodeId, Edge[]>`

Indices are rebuilt on load and incrementally maintained on every mutation.

## Example (matches [fileformat.md](fileformat.md))

```
customertype casual_dweller name="Casual Dweller"
customer organic-goat
networkaddress @f1/c/1
floor f1
rack r1
switch sw1 #Switch hardwareAddress=42
port port0 #RJ45
port 12345 #RJ45 #UserPort

floor[f1] -> rack[r1] :FloorAssignment
rack[r1] -> switch[sw1] :RackAssignment
switch[sw1] -> port[port0] :NIC
port[port0] -> port[12345] :NetworkCableLinkRJ45
customer[organic-goat] -> customertype[casual_dweller] :Owner
customer[organic-goat] -> port[12345] :Owner
networkaddress[@f1/c/1] -> customer[organic-goat] :AssignedTo
```
