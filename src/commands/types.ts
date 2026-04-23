/**
 * Command palette registry types per docs/specs/commandline.md §"Registration API".
 *
 * Kept deliberately small in Phase 5: enough to register a dozen useful
 * commands, validate their arguments, drive completion, and run them
 * with access to the graph / project / FSM stores. Undo + redo are
 * stubbed (each command may return an `undo` payload, but the stack
 * itself is wired later in Phase 14).
 */

import type { Graph } from '@/model';
import type { GraphStore, ProjectStore, FsmStore } from '@/store';
import type { CommandHistory } from './history';
import type { CommandRegistry } from './registry';

export type ArgType =
  | 'command'
  | 'nodeId'
  | 'edgeId'
  | 'nodeType'
  | 'edgeType'
  | 'typedRef'
  | 'relation'
  | 'projectSlug'
  | 'tag'
  | 'floor'
  | 'enum'
  | 'flag'
  | 'string'
  | 'number';

export interface ArgSpec {
  name: string;
  type: ArgType;
  required?: boolean;
  variadic?: boolean;
  values?: string[];
  nodeType?: string;
  nodeTag?: string;
  edgeType?: string;
  summary?: string;
}

export interface FlagSpec {
  name: string;
  takesValue?: boolean;
  repeatable?: boolean;
  summary?: string;
}

export type ParsedValue = string | number | boolean;

export interface ParsedArgs {
  /** Positional args in argSpec order, coerced per `type`. */
  positional: ParsedValue[];
  /** Flag values keyed by flag name without the `--` prefix. */
  flags: Record<string, ParsedValue | ParsedValue[]>;
  /** Original tokens (after tokenizer) for diagnostics. */
  tokens: string[];
}

export interface UndoEntryStub {
  label: string;
  forward: unknown[];
  inverse: unknown[];
}

export type CommandResult =
  | { ok: true; message?: string; undo?: UndoEntryStub }
  | { ok: false; message: string; errorCode?: string };

export interface CommandContext {
  graph: Graph;
  graphStore: GraphStore;
  projectStore: ProjectStore;
  fsmStore: FsmStore;
  registry: CommandRegistry;
  history: CommandHistory;
  log: (line: string) => void;
}

export interface CommandDef {
  /** Dotted-by-space name, e.g. `"add node"` or `"tag list"`. */
  name: string;
  aliases?: string[];
  summary: string;
  argSpec?: ArgSpec[];
  flags?: FlagSpec[];
  undoable?: boolean;
  run(args: ParsedArgs, ctx: CommandContext): CommandResult | Promise<CommandResult>;
}
