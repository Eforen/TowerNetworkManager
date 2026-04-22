/**
 * Command registry with multi-word name resolution.
 *
 * Commands register a canonical name (possibly multi-word, e.g.
 * "add node") plus optional aliases. `resolve` greedily matches the
 * longest name against a leading slice of the token list so
 * `tokens[0..n]` become the command name and `tokens[n..]` the args.
 */

import type { CommandDef } from './types';

export class CommandRegistry {
  private readonly byName = new Map<string, CommandDef>();
  private readonly byAlias = new Map<string, CommandDef>();

  /** Register a command. Duplicate names/aliases throw. */
  register(def: CommandDef): void {
    if (this.byName.has(def.name)) {
      throw new Error(`command already registered: ${def.name}`);
    }
    this.byName.set(def.name, def);
    for (const alias of def.aliases ?? []) {
      if (this.byAlias.has(alias) || this.byName.has(alias)) {
        throw new Error(`alias collision: ${alias}`);
      }
      this.byAlias.set(alias, def);
    }
  }

  /** List all registered defs in insertion order. */
  all(): CommandDef[] {
    return [...this.byName.values()];
  }

  /** Lookup a command by exact name or alias. */
  get(name: string): CommandDef | undefined {
    return this.byName.get(name) ?? this.byAlias.get(name);
  }

  /**
   * Resolve a leading prefix of `tokens` to a command.
   *
   * Returns the matched def plus `consumed` = number of tokens that
   * belonged to the command name (>= 1 on success). A single-word
   * alias still returns `consumed = 1` even if the canonical name has
   * multiple words (alias is the rewrite target).
   */
  resolve(
    tokens: string[],
  ): { def: CommandDef; consumed: number } | undefined {
    if (tokens.length === 0) return undefined;
    const maxWords = Math.min(tokens.length, 4);
    for (let n = maxWords; n >= 1; n--) {
      const candidate = tokens.slice(0, n).join(' ');
      const def = this.byName.get(candidate);
      if (def) return { def, consumed: n };
    }
    const alias = this.byAlias.get(tokens[0]);
    if (alias) return { def: alias, consumed: 1 };
    return undefined;
  }

  /** All visible names for completion (canonical + aliases). */
  names(): string[] {
    return [...this.byName.keys(), ...this.byAlias.keys()].sort();
  }
}

/** Singleton used by the palette + Vue app. */
let globalRegistry: CommandRegistry | undefined;

export function getRegistry(): CommandRegistry {
  if (!globalRegistry) globalRegistry = new CommandRegistry();
  return globalRegistry;
}

export function resetRegistry(): void {
  globalRegistry = new CommandRegistry();
}
