# Graph Visualization

Force-directed network view built on [d3-force](https://d3js.org/d3-force). Renders the model defined in [graphdata.md](graphdata.md). Runs entirely client-side inside the Vue PWA; no server round-trips.

## Goals

- Show all nodes/edges in one view with readable labels.
- Keep physical topology (floors, racks, ports) spatially coherent.
- Support fast pan, zoom, hover, and click at 1k+ nodes.
- Honor filter state from [filters.md](filters.md).

## Rendering approach

- SVG for < 2000 nodes (crisp, easy DOM hit testing, CSS styling).
- Canvas fallback for > 2000 nodes (single `<canvas>` + quadtree hit test).
- Choice made at project-load time based on node count; configurable via `view.renderer = 'svg' | 'canvas' | 'auto'` in the project.
- One `<div class="tni-graph">` root with an absolutely-positioned overlay `<div class="tni-tooltip">`.

## Forces

```ts
const simulation = d3.forceSimulation(nodes)
  .force('link', d3.forceLink(edges)
    .id(d => d.id)
    .distance(e => 40 + 20 * e.strength)
    .strength(e => 1 / Math.max(e.strength, 0.5)))
  .force('charge', d3.forceManyBody().strength(-180))
  .force('center', d3.forceCenter(0, 0))
  .force('collide', d3.forceCollide().radius(d => nodeRadius(d) + 2))
  .force('floorY', d3.forceY(d => floorY(d)).strength(d => d.floor != null ? 0.25 : 0));
```

- Link distance/strength derive from `edge.strength` in [graphdata.md](graphdata.md) (lower number = stronger = shorter link).
- **`Owner` edges that touch a `userport`** use ~¼ the computed link distance and a higher link stiffness so user ports sit close to their owner (`customer` / `player`).
- `floorY` keeps floor-assigned nodes stacked horizontally per floor when "Floor layout" toggle is on. `floorY(d) = d.floor * FLOOR_SPACING`.
- `alphaDecay` bumped to `0.05` for snappier settling on edits.
- Simulation is paused when document is hidden (`visibilitychange`).

## Node visuals

| Attribute | Source |
|-----------|--------|
| Shape     | Node type (Server = square, Router = hexagon, Switch = diamond, Port = small circle, Floor/Rack = rounded rect "group" node, Customer/Player = circle, ConsumerBehavior / ProducerBehavior = rounded rect pill, BehaviorInsight = pill with bandwidth number, UsageType = cloud/tag glyph, Program = small rounded square pinned inside its host server) |
| Size      | Role: devices 10px, ports 4px, groups 16px, behaviors 12px, insights 10px, usagetypes 8px, programs 8px |
| Fill      | Tag family: Physical vs Logical (two hues); Behaviors use a warmer Logical hue, UsageTypes a cooler one |
| Stroke    | Selection/highlight state |
| Label     | `node.name || node.id`, rendered below node, hidden at low zoom |

## Edge visuals

- Color by edge type (NIC, Owner, Route, FloorAssignment, RackAssignment, CableLink, UplinkConnection, Insight, Consumes, Provides, Install).
- Cable edges solid; logical/ownership edges dashed; `Consumes` dotted cool, `Provides` dotted warm; `Install` solid short and thick to anchor programs inside their server.
- Stroke-width inversely proportional to `strength`.
- Arrowheads on directed edges (Owner, Route, FloorAssignment, RackAssignment, Insight, Consumes, Provides, Install); undirected for cable links.
- `Consumes` / `Provides` edges show the optional `required` or `amount` value as a small badge near the midpoint when set; when a `pool` is set, the badge is the pool name.

## Data layers toolbar

- **Placement**: top-left overlay on the graph (`position: absolute`), above the SVG, pointer-events enabled so it does not steal zoom from the canvas except on the controls themselves (wheel zoom is ignored over `[data-tni-toolbar]`).
- **Primary control**: a **Data layers** toggle opens a **flyout column** immediately to its right: a vertical stack of layer buttons (floors, network addresses, user ports, NIC ports, and room for more types later).
- **Floors**: toggle **visibility** of `floor` nodes. When off, `floor` nodes and every edge that touches a `floor` endpoint are omitted from the force simulation (no re-parenting).
- **Network addresses**: when “collapsed”, `networkaddress` nodes are hidden and edges that referenced an address are **re-homed** to the node at the other end of that address’s `AssignedTo` edge (the current assignee).
- **User ports**: when collapsed, `userport` nodes are hidden; edges are re-homed to the **`Owner`** (`customer` | `player`) for that user port.
- **NIC ports**: when collapsed, layout-managed device `port` nodes (`parentId/portN`) are hidden; edges are re-homed to the owning **`server` | `switch` | `router`**; redundant `NIC` edges between a device and its own port are dropped after collapse.
- **Collapsed children in tooltips**: when any of the three collapse modes above is on, hovering the **parent** node (assignee, owner, or device) lists the hidden `networkaddress` / `userport` / `port` rows under “Grouped here (data layers)” so addresses and ports stay discoverable without separate nodes on the canvas. Rows that still have **edges to other presentation nodes** (after collapse remap) show a **link** glyph. With the pointer still over the graph node, press **Shift** once to **pin** the tooltip (fixed position, tooltips accept pointer events). While pinned, hovering a collapsed row draws **dashed lines** in the SVG from that link icon to each linked **visible** node, highlights those nodes, and opens a **secondary tooltip** for the collapsed child stacked beside the parent. **Escape**, **click on the graph background**, or moving the pointer off the tooltip stack dismisses the pin and the child overlay (unless the pointer returns to a graph node with the tooltip still active).
- **Persistence**: layer settings are JSON under **`tni.view.dataLayers`** in `localStorage` (same storage abstraction as other `tni.*` keys). Defaults keep floors visible and all collapse toggles off.

## Interactions

- **Hover**: show tooltip; neighbors get `.hover-neighbor` class; non-neighbors dim to 30% opacity.
- **Click**: select node, open `NodeInspectorOpen` state (see [statemachine.md](statemachine.md)).
- **Shift+click**: add to multi-selection (for future group ops).
- **Drag**: d3 drag sets `fx,fy` while held; on release `fx=fy=null` unless "Pin on drop" toggle is on.
- **Pan/Zoom**: `d3.zoom()` on the root SVG, scale range `[0.1, 8]`. Labels fade in above scale `0.6`. Wheel / drag zoom is ignored while the pointer is over `[data-tni-tooltip-stack]` so pinned tooltips stay usable.
- **Double-click background**: reset zoom to fit.
- **Keyboard** (when graph focused): arrow keys pan, `+`/`-` zoom, `f` fit, `g` toggle floor layout.

## Tooltip

Follows the pattern from the d3-force gallery (https://observablehq.com/@d3/force-directed-graph/2). Content:

- Line 1: `<type> · <id>`
- Line 2: `name` (if set)
- Line 3: tag chips
- Lines 4+: key properties (network address, domain name, floor, rack, port count)
- When data-layer collapse hides leaf nodes, an extra block lists those nodes (`type · id`, optional `name`) grouped under the hovered parent, with a link icon when that child has at least one neighbor still visible after presentation remap (e.g. a cable to a device when NIC ports are collapsed).
- **Shift pin**: `Shift` keydown while the pointer is still over the hovered graph node pins the stack (even when there are no collapsed rows, so the tooltip can be reached without it vanishing). While **Shift stays physically down** and the stack is **pinned**, other graph hovers (**other nodes**, **edges**, edge `mouseleave`) do **not** replace or hide that session; release Shift to browse the graph normally again. The pinned stack **does not follow the pointer** on node/edge `mousemove` (position freezes after pin until Shift is released). Node `mouseleave`, tooltip-stack `pointerleave`, and background click also stay suppressed while Shift is down. Child row hover then drives connector lines and the child tooltip as above. Collapsed rows use a **fixed icon column** so type/id lines align whether or not the row has a link glyph. The child tooltip repeats the same head/name/tags/props block for the collapsed node, then a **horizontal rule with a centered pill** (`LINK` / `ALSO`) and the same block for each presentation target (first link → `LINK`, further targets → `ALSO`).
- Footer: neighbor count

Renders as an HTML stack (`[data-tni-tooltip-stack]`) following the pointer (d3-style flip when the primary panel would cross the graph edge). When the pinned **child** inspector opens beside the parent, layout nudges **horizontally** from the union of both panels if needed; **vertical** overflow from a tall child is corrected by shifting the **child** panel only so the primary tooltip’s vertical position does not jump.

## Bottleneck overlay

Toggle via the `layout` / view menu or keyboard `b`. Visualizes the output of the analyzer described in [behaviors.md](behaviors.md).

- Device fill switches to a red-scale gradient driven by `load / traversalsPerTick`:
  - `< 50%` green
  - `50..80%` yellow
  - `80..100%` orange
  - `> 100%` red (saturated)
- Edges inherit their heavier endpoint's color.
- Overlay tooltip adds two lines: `load / capacity` and the top three contributing `(consumerInsight -> usageType -> producerInsight)` tuples.
- Unreachable demand pairs render a dashed red overlay linking the two endpoints through the viewport (not the simulation) so they're easy to spot.
- Legend shows the gradient and the capacity units ("traversals/tick").

## Inspection path highlight

Drives the output of the two-point tools in [inspect.md](inspect.md). Set by the app as `ui.pathHighlight = { edges: Set<EdgeId>, nodes: Set<NodeId>, primary?: NodeId, source: NodeId, sink: NodeId }`.

- Path nodes get the `.path-node` class: full opacity, thicker stroke, accent color.
- Path edges get the `.path-edge` class: thicker, solid, accent color, with a subtle animated dash flowing from source to sink to convey direction.
- `source` and `sink` get corner badges `S` and `D` (consumer -> producer).
- When `primary` is set (bottleneck tool), that node gets `.path-primary-bottleneck`: red halo ring, priority animation.
- Non-path nodes/edges are dimmed to 25% opacity so the path pops.
- During `PickingTarget` (see [statemachine.md](statemachine.md)) the cursor is a crosshair; hovered nodes show a `Pick 1` / `Pick 2` badge; a top banner spans the viewport with the prompt and an `Esc` hint.
- `inspect clear` removes `ui.pathHighlight` and the classes.

Path highlight composes with the Bottleneck and Server-Resource overlays: when overlays are on, path nodes retain their overlay fill but the `.path-edge` stroke still wins for edges.

## Server resource overlay

Toggle with keyboard `r` (separate from the traversal overlay; both can be on at once). Visualizes program load per server from [programs.md](programs.md).

- Each `server` node shows a three-segment micro-bar (CPU, Memory, Storage) anchored below the node glyph.
- Segment colors use the same green/yellow/orange/red gradient driven by `used / total`.
- Tooltip lists installed programs with their individual `cpu/memory/storage` costs and contribution to the bar.
- Servers exceeding any resource get a red halo ring to catch the eye even at low zoom.

## Performance

- Ticks rAF-throttled; positions written in one pass.
- Only visible (post-filter) nodes participate in the simulation; filtered-out nodes are removed from `simulation.nodes()` and re-added when filter clears.
- Quadtree from `d3-quadtree` reused for canvas hit-testing and selection rectangles.

## Accessibility

- Every node gets `role="img"` and an `aria-label` (`<type> <name>`).
- Keyboard-only users can tab through a hidden ordered list of nodes (DOM order = stable by id); focus syncs to the graph selection.
- Respect `prefers-reduced-motion`: when set, simulation alpha is forced to 0 after initial settle and drag does not restart it.

## Theming

- Colors sourced from CSS custom properties so light/dark themes swap without re-rendering.
- Defaults defined at `:root` with `--tni-phys`, `--tni-log`, `--tni-edge-*`.

## Public component API

```vue
<GraphView
  :graph="graph"
  :filter="filterState"
  :layout="'force' | 'floor'"
  @select="onSelect"
  @edit="onEdit"
/>
```

## Non-goals

- No 3D view, no WebGL.
- No live-layout animations beyond d3's tick loop.
- No automated floor-plan import.
