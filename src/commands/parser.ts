/**
 * Bind a resolved command to its parsed arguments.
 *
 * Supports:
 *   - Positional args in argSpec order, with optional and variadic
 *     final slots.
 *   - `--flag=value`, `--flag value`, `--flag` (boolean). Repeatable
 *     flags collect into arrays.
 *   - Coercion: 'number' coerces to number, 'floor' to number or the
 *     string 'unassigned', everything else stays as a string.
 *
 * Parse errors are returned as a structured result so the palette can
 * show them on the status line without throwing.
 */

import type { ArgSpec, CommandDef, ParsedArgs, ParsedValue } from './types';
import type { Token } from './tokenizer';

export type ParseArgsResult =
  | { ok: true; args: ParsedArgs }
  | { ok: false; error: string };

export function parseArgs(
  def: CommandDef,
  argTokens: Token[],
): ParseArgsResult {
  const positional: ParsedValue[] = [];
  const flags: Record<string, ParsedValue | ParsedValue[]> = {};
  const argSpec = def.argSpec ?? [];
  const flagSpec = def.flags ?? [];
  const flagByName = new Map(flagSpec.map((f) => [f.name, f]));

  let posIndex = 0;
  for (let i = 0; i < argTokens.length; i++) {
    const tok = argTokens[i];
    if (tok.unterminated) {
      return { ok: false, error: `unterminated string: "${tok.value}` };
    }
    if (!tok.quoted && tok.value.startsWith('--')) {
      const raw = tok.value.slice(2);
      const eq = raw.indexOf('=');
      const name = eq === -1 ? raw : raw.slice(0, eq);
      const inlineValue = eq === -1 ? undefined : raw.slice(eq + 1);
      if (name.length === 0) {
        return { ok: false, error: `empty flag: ${tok.value}` };
      }
      const spec = flagByName.get(name);
      const takesValue = spec?.takesValue !== false;
      let value: ParsedValue;
      if (inlineValue !== undefined) {
        value = inlineValue;
      } else if (takesValue) {
        const next = argTokens[i + 1];
        if (!next) {
          if (spec && spec.takesValue === false) {
            value = true;
          } else {
            return { ok: false, error: `flag --${name} missing value` };
          }
        } else {
          value = next.value;
          i++;
        }
      } else {
        value = true;
      }
      if (spec?.repeatable) {
        const cur = flags[name];
        if (Array.isArray(cur)) cur.push(value);
        else flags[name] = cur === undefined ? [value] : [cur, value];
      } else {
        flags[name] = value;
      }
      continue;
    }
    const spec = selectPositional(argSpec, posIndex);
    if (!spec) {
      return { ok: false, error: `unexpected argument: ${tok.value}` };
    }
    const coerced = coerce(spec, tok.value);
    if (coerced.ok === false) return coerced;
    positional.push(coerced.value);
    if (!spec.variadic) posIndex++;
  }

  for (let i = posIndex; i < argSpec.length; i++) {
    const spec = argSpec[i];
    if (spec.required && !spec.variadic) {
      return { ok: false, error: `missing required arg <${spec.name}>` };
    }
  }

  return {
    ok: true,
    args: {
      positional,
      flags,
      tokens: argTokens.map((t) => t.value),
    },
  };
}

function selectPositional(
  argSpec: ArgSpec[],
  index: number,
): ArgSpec | undefined {
  if (index < argSpec.length) return argSpec[index];
  const last = argSpec[argSpec.length - 1];
  return last?.variadic ? last : undefined;
}

function coerce(
  spec: ArgSpec,
  raw: string,
): { ok: true; value: ParsedValue } | { ok: false; error: string } {
  if (spec.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) {
      return { ok: false, error: `<${spec.name}> expects number, got "${raw}"` };
    }
    return { ok: true, value: n };
  }
  if (spec.type === 'floor') {
    if (raw === 'unassigned') return { ok: true, value: raw };
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) {
      return {
        ok: false,
        error: `<${spec.name}> expects floor number or "unassigned"`,
      };
    }
    return { ok: true, value: n };
  }
  if (spec.type === 'enum' && spec.values && !spec.values.includes(raw)) {
    return {
      ok: false,
      error: `<${spec.name}> expects one of: ${spec.values.join(', ')}`,
    };
  }
  return { ok: true, value: raw };
}
