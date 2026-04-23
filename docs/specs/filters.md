# Filters

Filters shrink what the graph view renders without mutating the model. Consumed by [visualization.md](visualization.md) and driven by both the filter panel UI and `filter ...` commands from [commands.md](commands.md).

## Dimensions

1. **Floor** — multi-select over known floor numbers plus `unassigned`.
   - Values: `0`, `1`, `2`, `3`, ..., `unassigned` (nodes with no `FloorAssignment` edge).
2. **Tag** — multi-select over the canonical tag list in [graphdata.md](graphdata.md).
   - e.g. `Physical`, `Logical`, `NetworkPort`, `Device`, `Router`, `Switch`, `Server`, `Rack`, `Floor`, `Customer`, `DomainName`, `User`, `Uplink`, `RJ45`, `FiberOptic`, `Routing`.
3. **Node type** — multi-select over node types from [graphdata.md](graphdata.md).
4. **Edge type** — multi-select over relationship types (NIC, Owner, Route, FloorAssignment, RackAssignment, NetworkCableLinkRJ45, NetworkCableLinkFiber, UplinkConnection).
5. **Search** — free text, case-insensitive substring match on:
   - `node.id`, `node.name`
   - all string-valued properties (Network Address, Domain Name, Device Address, Customer Name)
   - tag names

## Semantics

- Across dimensions: **AND** (a node must pass every dimension).
- Within a dimension: **OR** (any selected value matches).
- Empty dimension = wildcard (all pass). A fresh filter is all wildcards = no filtering.
- Search is ANDed with the rest; empty string = wildcard.
- Edges are kept iff both endpoints survive node filtering AND the edge type is in `edgeTypes` (or `edgeTypes` is empty).
- Hiding a node hides its dangling edges.

## State shape

```ts
type FilterState = {
  floors: Set<number | 'unassigned'>;  // empty = any
  tags: Set<string>;                    // empty = any
  types: Set<string>;                   // empty = any
  edgeTypes: Set<string>;               // empty = any
  search: string;                       // '' = any
};

const emptyFilter: FilterState = {
  floors: new Set(),
  tags: new Set(),
  types: new Set(),
  edgeTypes: new Set(),
  search: '',
};
```

## Predicate

```ts
function passes(node: Node, f: FilterState, ctx: GraphIndex): boolean {
  if (f.types.size && !f.types.has(node.type)) return false;
  if (f.tags.size && !node.tags.some(t => f.tags.has(t))) return false;
  if (f.floors.size) {
    const floor = ctx.floorOf(node.id);        // number | undefined
    const key = floor ?? 'unassigned';
    if (!f.floors.has(key)) return false;
  }
  if (f.search) {
    const needle = f.search.toLowerCase();
    if (!nodeSearchText(node).toLowerCase().includes(needle)) return false;
  }
  return true;
}
```

`ctx.floorOf` walks the `FloorAssignment` edges once per filter change and caches results.

## UI (FilterPanelOpen)

- Collapsible groups per dimension.
- Each group shows counts: `Floor 1 (42)` reflecting passing-node counts under current filter minus that group (so you can see what toggling adds).
- "Clear all" button resets to `emptyFilter`.
- "Save preset" persists current filter under a name in `localStorage` key `tni.filter.presets`.

## Command integration

- `filter floor <n>[,<n>...]` — toggles floors (comma list).
- `filter tag <tag>[,<tag>...]` — toggles tags.
- `filter type <type>[,<type>...]` — toggles types.
- `filter edge <edgeType>[,...]` — toggles edge types.
- `filter search <text...>` — sets search.
- `filter clear [dimension]` — clears all or one dimension.
- `filter show` — prints current filter to the palette output area.
- `filter preset save <name>` / `filter preset load <name>` / `filter preset rm <name>`.

## URL sync

Current filter is mirrored into `location.hash` (`#floors=1,2&tags=Physical&search=goat`) so a view is shareable. On load, hash is parsed before the first render.

## Performance

- Filter evaluation is O(nodes + edges). Recomputed only when `FilterState` or graph changes.
- Results memoized into `Set<NodeId>` and `Set<EdgeId>`; [visualization.md](visualization.md) reads those sets each tick.

## Non-goals

- No boolean-expression language (future: `filter where 'tag:Router and floor:1'`).
- No regex in search v1 (plain substring only).
