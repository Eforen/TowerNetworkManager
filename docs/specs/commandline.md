# Command Palette

Pull-down command bar for fast, keyboard-driven operations. Bound to the `CommandPaletteOpen` state in [statemachine.md](statemachine.md). Executes commands from [commands.md](commands.md).

## Trigger and dismissal

- **Open**: `` ` `` (backtick) keydown while focus is NOT inside `<input>`, `<textarea>`, or `contenteditable`.
- **Close**: `Escape`, re-press `` ` ``, or click on the graph area outside the palette.
- The palette animates down from the top, occupying ~40% of viewport height. Animation is disabled under `prefers-reduced-motion`.
- Opening the palette captures keyboard focus; closing restores focus to the graph container.

## Layout

```
+------------------------------------------------------------+
|  >  add node server --name=db01 --floor=1_                 |  <- input line (prompt '>')
|     add node server --name=<NAME> --floor=<N>              |  <- ghost/preview (dim)
+------------------------------------------------------------+
|  add node      create node                                 |
|  add link      create edge                                 |  <- completions popup
|  add alias     alias command                               |
+------------------------------------------------------------+
|  [history: 12/200]  [Tab] complete  [Enter] run  [Esc] close|
+------------------------------------------------------------+
|  last: ok - added node server#db01 (id=db01)               |  <- status line
+------------------------------------------------------------+
```

## Input behavior

- Monospace font.
- Left prompt `>` is not editable.
- Single-line. `Shift+Enter` inserts literal newline (multi-line commands not supported v1; reserved).
- Tokenization: whitespace-separated, with double-quoted strings (`"Casual Dweller"`) preserved as one token. Backslash escapes inside quotes.

## Tab complete

Context-aware completion driven by the active command's `argSpec`.

### Algorithm

1. Tokenize input up to caret; find current token and its byte range `[start, end]` in the buffer.
2. If current token is position 0, complete against registered command names (including aliases).
3. Otherwise, look up the resolved command, find the `ArgSpec` for the current token position, and ask its `Completer` for candidates.
4. Show up to 12 candidates in the popup; `Tab` accepts the first (or currently highlighted).
5. Repeated `Tab` cycles forward; `Shift+Tab` cycles backward. Cycling replaces the token range with the cycled candidate.
6. `Escape` with completions visible closes the popup but keeps the palette open (state returns to `Typing`).

### Completion provider interface

```ts
interface Completer {
  complete(
    tokens: string[],
    tokenIndex: number,
    partial: string,
    ctx: { graph: Graph; filter: FilterState }
  ): CompletionResult;
}

interface CompletionResult {
  replace: [number, number];     // char range in original buffer
  candidates: Candidate[];
}

interface Candidate {
  value: string;                 // text inserted
  label?: string;                // display text (defaults to value)
  detail?: string;               // right-aligned hint (e.g. node type)
  sortKey?: string;
}
```

### Built-in completer types

Each `ArgSpec.type` maps to a completer:

- `command` — registered command names plus aliases.
- `nodeId` — all node ids, optionally filtered by `argSpec.nodeType` or `argSpec.nodeTag`.
- `edgeId` — all edge ids, optionally filtered by `argSpec.edgeType`.
- `nodeType` — enum from [graphdata.md](graphdata.md).
- `edgeType` — enum from [graphdata.md](graphdata.md).
- `tag` — canonical tag list plus tags currently present on any node.
- `floor` — `0..N` plus `unassigned` where N = max floor in graph.
- `enum` — values from `argSpec.values`.
- `flag` — `--name`, `--prop`, etc. from `argSpec.flags`.
- `string` / `number` — no candidates, just placeholder hint.

### Ghost-text preview

When exactly one strong candidate is ranked first and the user has typed >= 1 char of it, render the rest in dim color after the caret. Right-arrow at end-of-line accepts the ghost.

## History

- Up/Down arrows walk history when caret is at end-of-line; otherwise arrows navigate the input.
- `Ctrl+R` opens reverse-incremental search over history.
- History persisted to `localStorage` key `tni.cmdhistory` as JSON array, capped at 200 entries.
- Duplicates collapsed (consecutive identical commands stored once).
- `clear history` command wipes both memory and storage.

## Execution pipeline

1. On `Enter`, input buffer is tokenized, resolved to a command, arguments validated against `argSpec`.
2. If validation fails: transition to `ShowingError` with message; keep buffer.
3. If valid: transition to `ExecutingCommand`, invoke handler.
4. Handler returns `Ok(message)` or `Err(message)`:
   - `Ok` -> clear buffer, push to history, transition to `Idle`, show green status line for 2s.
   - `Err` -> transition to `ShowingError`, keep buffer, show red status line until next keystroke.
5. `Ctrl+Enter` runs without closing the palette (useful for chaining).

## Registration API

```ts
interface CommandDef {
  name: string;
  aliases?: string[];
  summary: string;
  argSpec: ArgSpec[];
  flags?: FlagSpec[];
  undoable?: boolean;
  run(args: ParsedArgs, ctx: CommandContext): CommandResult | Promise<CommandResult>;
}

interface ArgSpec {
  name: string;
  type: 'command' | 'nodeId' | 'edgeId' | 'nodeType' | 'edgeType'
      | 'tag' | 'floor' | 'enum' | 'flag' | 'string' | 'number';
  required?: boolean;
  variadic?: boolean;
  values?: string[];             // for 'enum'
  nodeType?: string;             // narrows nodeId completions
  nodeTag?: string;
  edgeType?: string;
}
```

Commands register at app boot via `registerCommand(def)` into a central registry consumed by both the palette and the tab completer.

## Keybindings (palette-open)

| Key                     | Action                              |
|-------------------------|-------------------------------------|
| `Enter`                 | Run command                         |
| `Ctrl+Enter`            | Run, keep palette open              |
| `Tab` / `Shift+Tab`     | Cycle completions                   |
| `ArrowRight` (at EOL)   | Accept ghost completion             |
| `ArrowUp` / `ArrowDown` | History prev/next                   |
| `Ctrl+R`                | Reverse-incremental history search  |
| `Ctrl+L`                | Clear status line                   |
| `Escape`                | Close completions, then close palette |
| `` ` ``                 | Close palette                       |
| `Ctrl+C`                | Clear current input                 |

## Theming

Palette uses the same CSS custom properties as the rest of the app (`--tni-bg`, `--tni-fg`, `--tni-accent`, `--tni-error`). Prompt `>` uses `--tni-accent`.

## Non-goals

- No piping between commands (`cmd1 | cmd2`) in v1.
- No scripting language; each submission is one command.
- No remote command execution.
