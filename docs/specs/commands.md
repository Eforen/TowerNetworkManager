# Command Catalog

All commands exposed by the palette defined in [commandline.md](commandline.md). Commands mutate the graph model from [graphdata.md](graphdata.md), drive filters from [filters.md](filters.md), or move focus in the view from [visualization.md](visualization.md).

## Conventions

- Angle brackets = required, square brackets = optional, ellipsis = variadic.
- `<id>` is always a slug (`[a-z0-9][a-z0-9_-]*`). If omitted on `add`, one is auto-generated from `--name` or the type + a counter.
- Flags use `--key=value` or `--key value`. Repeatable flags noted as `(repeatable)`.
- `--force` suppresses destructive confirmation.
- Every mutating command is **undoable** unless noted.

## Command reference

### Node mutations

- `add node <nodeType> [ <id> [ <portLayout>… ] ] [--id=<id>] [--name=<name>] [--tag=<tag>] (repeatable) [--prop <key>=<val>] (repeatable)`
  - Creates a node. Type must be a known node type. Tags must be canonical.
  - **`server` / `switch` / `router`:** after `<id>`, you may add **inline `portLayout`** as one or more tokens (file-format `RJ45[2] FIBER[1] …`). Example: `add node server 12345 RJ45[2] FIBER[1]`. If you set `--id=…`, all remaining positionals are layout: `add node server --id=s1 RJ45[2] FIBER[1]`. You can also set layout with `--prop portLayout=…` (quote if the value has spaces). Inline layout and `--prop portLayout=…` are merged; a non-empty inline layout wins for `portLayout` when both are present.
  - **`userport`:** exactly two positionals after the type, no `--id`: `add node userport <hardwareAddress> <RJ45|FIBER|…>`. The hardware address is 1–5 digits (customer gear id). Media uses the same aliases as in the file format (`RJ45`, `FIBER`, etc.).
  - **`uplink`:** same shape: `add node uplink <code> <RJ45|FIBER|…>`. The uplink code is four letters (ISP/building code); stored lowercase.
  - Example: `add node Server --name=db01 --prop address=10.0.0.5`

- `rm node <id> [--force]`
  - Removes node and all incident edges. Cascading deletions are recorded for undo.

- `mod node <nodeType> <id> [--name=<name>] [--tag+=<tag>] [--tag-=<tag>] [--prop <key>=<val>] [--unprop <key>]` (repeatable tag/unprop)
  - Modifies properties, name, and tags in-place. `portLayout` on server/switch/router is a normal string property: `mod node server s1 --prop portLayout="RJ45[3] FIBER"`.

- `rename node <id> <newId>`
  - Changes a node's id; rewrites edge endpoints. Fails if `<newId>` exists.

### Edge mutations

- `add link <fromType>[<fromId>] <toType>[<toId>] [<Relation>] [--prop <key>=<val>] (repeatable)`
  - Creates an edge between two existing nodes using file-format typed-ref syntax for the endpoints.
  - `<Relation>` is optional. When omitted the parser auto-infers it from the type pair; errors if zero or more than one legal relation matches.
  - Direction auto-flips: if the declared or inferred relation is only legal as `(to, from)`, the stored edge is oriented accordingly (e.g. `add link customer[c1] networkaddress[@a]` yields `networkaddress -> customer :AssignedTo`).
  - Endpoints must already exist in the graph.

- `rm link <id> [--force]`
- `mod link <id> [--prop <key>=<val>] [--unprop <key>]`
- `unlink <fromType>[<fromId>] <toType>[<toId>]` — removes edges between the pair; errors if more than one exists unless `--all` is passed.

### Behaviors and capacity

Models from [behaviors.md](behaviors.md).

- `add behavior <consumer|producer> --name=<name> [--id=<id>] [--description=<text>]`
  - Creates a `consumerbehavior` or `producerbehavior` node.
- `add insight --name=<name> [--id=<id>] [--bw=<n>] [--p=<0..1>] [--description=<text>]`
  - Creates a `behaviorinsight` (`--bw` -> `bandwidthPerTick`, `--p` -> `activeProbability`).
- `add usage <id> [--label="..."]`
  - Creates a `usagetype` node.
- `link insight <behaviorId> <insightId>`
  - Adds an `Insight` edge.
- `link consume <insightOrDomainId> <usageTypeId> [--required=<n>]`
  - Adds a `Consumes` edge with optional `required` property.
- `link provide <insightOrDomainId> <usageTypeId> [--required=<n>]`
  - Adds a `Provides` edge.
- `unlink consume <insightOrDomainId> <usageTypeId>` / `unlink provide <...>`
- `mod device <id> --traversals=<n>`
  - Sets `traversalsPerTick` on a `server` / `switch` / `router`.
- `mod insight <id> [--bw=<n>] [--p=<0..1>] [--name=<name>]`

### Programs

Models from [programs.md](programs.md).

- `program install <slug> on <serverId> [--instance=<name>]`
  - Creates an `Install` edge from the server to the program definition. If the program definition doesn't exist yet and `<slug>` matches a canonical starter, auto-creates the definition with defaults.
- `program uninstall <slug> on <serverId> [--instance=<name>]`
  - Removes the `Install` edge. Program-owned Consumes/Provides edges stay (they belong to the program definition, not the instance); uninstall from the last server removes the program node when `--purge` is passed.
- `program list [on <serverId>]`
  - Prints programs installed on the given server, or all programs if omitted.
- `program show <slug>`
  - Prints a program's definition and resource/pool values.
- `add program <slug> --cpu=<n> --memory=<n> --storage=<n> [--name=<name>] [--description=<text>] [--pool.provide.<name>=<n>] [--pool.consume.<name>=<n>]`
  - Creates a program definition.
- `mod program <slug> [--cpu=<n>] [--memory=<n>] [--storage=<n>] [--pool.provide.<name>=<n>] [--pool.consume.<name>=<n>]`
- `rm program <slug> [--force]`
  - Removes the program definition and all its `Install`, `Consumes`, `Provides` edges.
- `mod server <id> [--cpuTotal=<n>] [--memoryTotal=<n>] [--storageTotal=<n>] [--traversals=<n>]`
  - Supersedes the prior `mod device --traversals` for servers; `mod device` still works for switches and routers.

### Analysis (read-only; not undoable)

- `analyze` — runs the bandwidth analyzer and opens the Specs page.
- `specs` — opens the Specs page without recomputing (uses last cached run).
- `bottleneck [--top=<n>] [--kind=traversal|cpu|memory|storage|all]` — prints the top `n` saturated devices/links (default 10). `--kind=all` interleaves traversal and resource (CPU/memory/storage) hotspots.
- `usage [<usageTypeId>]` — prints supply/demand/required totals per Usage Type (or for one).
- `reachable <fromId> <toId>` — prints the shortest path and its bandwidth contribution.

### Inspection tools

Two-point pick tools from [inspect.md](inspect.md). All read-only; never undoable.

- `inspect route <a> <b> [--show-unreachable]`
  - Prints the consumer -> producer path from `a` to `b` and highlights it on the graph. If no route exists, prints the failure reason at the last resolved hop.
- `inspect bottleneck <a> <b> [--rank] [--include=traversal|cpu|memory|storage|all]`
  - Runs `inspect route` then scores every hop against its capacity and returns the primary bottleneck (first saturated or highest utilization).
- `inspect pick route` / `inspect pick bottleneck`
  - Dismisses the palette and enters `PickingTarget` mode (see [statemachine.md](statemachine.md)); the user clicks two nodes to pick endpoints. `inspect route` / `inspect bottleneck` with no args are shorthand for these.
- `inspect clear` — dismiss the pinned inspection overlay.
- `inspect last` — re-open the most recent inspection result.
- Aliases: `route <a> <b>` (unambiguous against `route add/default/...` which take keywords first), `btwn <a> <b>` for `inspect bottleneck`.

### Tagging

- `tag add <id> <tag>[,<tag>...]`
- `tag rm <id> <tag>[,<tag>...]`
- `tag list <id>` (not undoable; read-only)

### Selection and focus

- `focus <id>` — center camera on node, select it, open inspector. Not undoable.
- `select <id>[,<id>...]` — multi-select. Not undoable.
- `clear selection` — deselect all. Not undoable.

### Filters

Pass-through to [filters.md](filters.md). Not undoable (filter state has its own history).

- `filter floor <n>[,<n>...]`
- `filter tag <tag>[,<tag>...]`
- `filter type <type>[,<type>...]`
- `filter edge <edgeType>[,<edgeType>...]`
- `filter search <text...>`
- `filter clear [dimension]`
- `filter show`
- `filter preset save|load|rm <name>`

### Project / persistence

- `save [<slug>]` — Writes project to `localStorage[tni.project.<slug>]`. Default `<slug>` = current project.
- `load <slug>` — Reads project from `localStorage`. Switches active project. Not undoable (clears undo stack).
- `load raw <slug>` — Reads bytes into the manual source editor **without** parsing. Use when an old file fails `load` (e.g. migrate `port` lines, then `apply source` or `save` raw text).
- `apply source` — Parses the manual source buffer into the graph (after `load raw`). Fails with the usual parse error if still invalid.
- `cancel source` — Leaves manual source mode and clears the buffer without parsing.
- `new <slug>` — Creates an empty project.
- `rm project <slug> [--force]` — Removes project from localStorage. Not undoable (warns).
- `list projects` — Prints project slugs. Not undoable.
- `export [<slug>]` — Serializes to file text per [fileformat.md](fileformat.md) and offers download.
- `import` — Opens file picker, parses file, loads into current project (prompts if destructive).

### History

- `undo` — Reverts last undoable command.
- `redo` — Reapplies reverted command.
- `history` — Prints command history (scrollable). Not undoable.
- `clear history` — Wipes palette history and storage. Not undoable.

### Utility

- `help [<command>]` — Lists commands or prints detail for one.
- `alias <name>=<expansion>` — Creates a palette alias (expansion is a prefix).
- `rm alias <name>`
- `theme <light|dark|system>` — Switches theme. Not undoable.
- `layout <force|floor>` — Switches visualization layout.
- `echo <text>` — Prints text to the status line. Not undoable.

## Undo / redo model

```ts
interface UndoEntry {
  forward: Op[];   // applied to produce new state
  inverse: Op[];   // applied to revert
  label: string;   // human-readable ("add node Server db01")
  ts: number;      // epoch ms
}

type Op =
  | { kind: 'addNode'; node: Node }
  | { kind: 'rmNode';  node: Node }   // full snapshot so undo restores identity
  | { kind: 'modNode'; id: string; before: Partial<Node>; after: Partial<Node> }
  | { kind: 'addEdge'; edge: Edge }
  | { kind: 'rmEdge';  edge: Edge }
  | { kind: 'modEdge'; id: string; before: Partial<Edge>; after: Partial<Edge> };
```

- Undo/redo stacks are per-project, held in memory. Depth cap: 200.
- Cascading deletes (removing a node that drops edges) collapse into one entry.
- `load`, `new`, `rm project`, `clear history`, and `import` clear both stacks.
- `save` does **not** clear stacks but snapshots the dirty flag.
- Stacks optionally persisted under `tni.project.<slug>.undo` (off by default to save space).

## Argument validation

Each command defines `argSpec` per [commandline.md](commandline.md); the palette validates before dispatch. Handler signature:

```ts
type CommandResult =
  | { ok: true;  message?: string; undo?: UndoEntry }
  | { ok: false; message: string; errorCode?: string };

interface CommandContext {
  graph: GraphMutable;
  filter: FilterStore;
  view: ViewController;
  project: ProjectStore;
  history: UndoStack;
  log: (line: string) => void;
}
```

## Bulk / batch

`batch` is not a user command. Internally a command can return `undo: { forward, inverse, label }` containing multiple ops; the palette treats each submission as one atomic entry for undo purposes.

## Non-goals

- No macro recording v1.
- No scripting.
- No remote execution.
