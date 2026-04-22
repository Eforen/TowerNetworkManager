/**
 * End-to-end command pipeline: tokenize -> resolve -> parse -> run.
 *
 * Pure function (given stores), returns a `CommandResult`. Callers are
 * responsible for dispatching the appropriate FSM event (`commandOk` /
 * `commandErr`) and pushing to history; see palette wiring in
 * `CommandPalette.vue`.
 */

import type { CommandContext, CommandResult } from './types';
import type { CommandRegistry } from './registry';
import { tokenize } from './tokenizer';
import { parseArgs } from './parser';

export async function execute(
  input: string,
  registry: CommandRegistry,
  ctx: CommandContext,
): Promise<CommandResult> {
  const tokens = tokenize(input);
  if (tokens.length === 0) {
    return { ok: false, message: 'empty command' };
  }
  const resolved = registry.resolve(tokens.map((t) => t.value));
  if (!resolved) {
    return {
      ok: false,
      message: `unknown command: ${tokens[0].value}`,
      errorCode: 'UNKNOWN_COMMAND',
    };
  }
  const argTokens = tokens.slice(resolved.consumed);
  const parsed = parseArgs(resolved.def, argTokens);
  if (!parsed.ok) {
    return { ok: false, message: parsed.error, errorCode: 'BAD_ARGS' };
  }
  try {
    return await resolved.def.run(parsed.args, ctx);
  } catch (err) {
    return { ok: false, message: (err as Error).message, errorCode: 'THROWN' };
  }
}
