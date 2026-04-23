/**
 * Tab-completion for the command palette per docs/specs/commandline.md
 * §"Tab complete".
 *
 * Pure functions: given the current buffer, caret position, registry,
 * and graph, returns a `CompletionResult` describing the candidates to
 * offer and the byte range to replace when one is accepted.
 *
 * We intentionally keep the completer stateless - the palette component
 * owns the cycling index (`selectedIndex`) and calls back into us only
 * for the candidate list.
 */

import { NODE_TYPES, RELATION_NAMES, CANONICAL_TAGS } from '@/model';
import type { Graph } from '@/model';
import type { ArgSpec } from './types';
import type { CommandRegistry } from './registry';
import { tokenizeWithCaret } from './tokenizer';

export interface Candidate {
  value: string;
  label?: string;
  detail?: string;
  sortKey?: string;
}

export interface CompletionResult {
  /** Character range `[start, end]` in the original buffer to replace. */
  replace: [number, number];
  candidates: Candidate[];
  /** Argument description to show as a placeholder/hint. */
  hint?: string;
}

export function complete(
  input: string,
  caret: number,
  registry: CommandRegistry,
  graph: Graph,
): CompletionResult {
  const { tokens, activeIndex, caretAtTokenEnd } = tokenizeWithCaret(
    input,
    caret,
  );

  // Caret in whitespace between existing tokens: nothing sensible to
  // complete (would require disambiguating which slot is "active").
  if (activeIndex === -1) {
    return { replace: [caret, caret], candidates: [] };
  }

  const isVirtualSlot = activeIndex >= tokens.length;
  const activeToken = isVirtualSlot ? undefined : tokens[activeIndex];
  const partial = activeToken
    ? caretAtTokenEnd
      ? activeToken.value
      : activeToken.value.slice(0, caret - activeToken.start)
    : '';
  const replace: [number, number] = activeToken
    ? [activeToken.start, activeToken.end]
    : [caret, caret];

  // First token: command names.
  if (activeIndex === 0) {
    return {
      replace,
      candidates: completeCommandName(registry, partial),
      hint: 'command',
    };
  }

  // Resolve the command greedily against all tokens typed so far.
  const resolved = registry.resolve(tokens.map((t) => t.value));
  if (!resolved) {
    // The typed tokens don't name a command yet — treat everything
    // written so far (including an optional in-progress partial) as an
    // incomplete command prefix. Filter by that prefix and expand the
    // replace range to cover the whole command-name region so accepting
    // a candidate rewrites the line cleanly (no duplicate "add add node").
    const priorValues = tokens.slice(0, activeIndex).map((t) => t.value);
    const prefix = priorValues.concat(partial ? [partial] : []).join(' ');
    const expandedReplace: [number, number] = [
      tokens[0]?.start ?? replace[0],
      replace[1],
    ];
    return {
      replace: expandedReplace,
      candidates: completeCommandName(registry, prefix),
      hint: 'command',
    };
  }

  // If the caret is still inside the command-name prefix, offer longer
  // command names that share the current prefix. Expand the replace
  // range to cover the whole command-name region so accepting rewrites
  // the full prefix cleanly (no duplicate "add add node").
  if (activeIndex < resolved.consumed) {
    const prefix = tokens
      .slice(0, activeIndex)
      .map((t) => t.value)
      .concat(partial)
      .join(' ');
    const expandedReplace: [number, number] = [
      tokens[0]?.start ?? replace[0],
      replace[1],
    ];
    return {
      replace: expandedReplace,
      candidates: completeCommandName(registry, prefix),
      hint: resolved.def.name,
    };
  }

  const argIndex = activeIndex - resolved.consumed;
  const argSpec = resolved.def.argSpec ?? [];
  const spec = argSpec[argIndex]
    ?? (argSpec[argSpec.length - 1]?.variadic
      ? argSpec[argSpec.length - 1]
      : undefined);
  if (!spec) {
    return { replace, candidates: [], hint: 'no more args' };
  }

  return {
    replace,
    candidates: completeArg(spec, partial, graph),
    hint: `<${spec.name}: ${spec.type}>`,
  };
}

/**
 * Apply a selected candidate to the buffer at the given replace range.
 * Pure: returns the next buffer string and the new caret position (just
 * after the inserted text). Extracted from the palette component so the
 * insertion behavior can be unit-tested without mounting Vue.
 */
export function applyCandidate(
  buffer: string,
  cand: Candidate,
  replace: [number, number],
): { buffer: string; caret: number } {
  const [start, end] = replace;
  const before = buffer.slice(0, start);
  const after = buffer.slice(end);
  const next = `${before}${cand.value}${after}`;
  return { buffer: next, caret: (before + cand.value).length };
}

function completeCommandName(
  registry: CommandRegistry,
  prefix: string,
): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const def of registry.all()) {
    if (def.name.startsWith(prefix) && !seen.has(def.name)) {
      seen.add(def.name);
      out.push({
        value: def.name,
        label: def.name,
        detail: def.summary,
      });
    }
    for (const alias of def.aliases ?? []) {
      if (alias.startsWith(prefix) && !seen.has(alias)) {
        seen.add(alias);
        out.push({
          value: alias,
          label: alias,
          detail: `alias for ${def.name}`,
        });
      }
    }
  }
  return out.sort((a, b) => a.value.localeCompare(b.value)).slice(0, 12);
}

function completeArg(
  spec: ArgSpec,
  partial: string,
  graph: Graph,
): Candidate[] {
  switch (spec.type) {
    case 'nodeType':
      return filterPrefix(
        [...NODE_TYPES].map((t) => ({ value: t, detail: 'node type' })),
        partial,
      );
    case 'edgeType':
      return filterPrefix(
        [...RELATION_NAMES].map((r) => ({ value: r, detail: 'edge type' })),
        partial,
      );
    case 'nodeId':
      return filterPrefix(nodeIdCandidates(spec, graph), partial);
    case 'edgeId':
      return filterPrefix(edgeIdCandidates(spec, graph), partial);
    case 'tag': {
      const live = new Set<string>(CANONICAL_TAGS as readonly string[]);
      for (const n of graph.nodes.values()) {
        for (const t of n.tags) live.add(t);
      }
      return filterPrefix(
        [...live].map((t) => ({ value: t, detail: 'tag' })),
        partial,
      );
    }
    case 'floor': {
      let maxFloor = -1;
      for (const n of graph.nodes.values()) {
        const f = graph.floorOf(n.type, n.id);
        if (typeof f === 'number' && f > maxFloor) maxFloor = f;
      }
      const floors: Candidate[] = [];
      for (let i = 0; i <= Math.max(maxFloor, 0); i++) {
        floors.push({ value: String(i), detail: 'floor' });
      }
      floors.push({ value: 'unassigned', detail: 'no floor' });
      return filterPrefix(floors, partial);
    }
    case 'enum':
      return filterPrefix(
        (spec.values ?? []).map((v) => ({ value: v, detail: spec.name })),
        partial,
      );
    case 'command': {
      // Rare: an argSpec entry explicitly wants a command name (e.g. `help`).
      // Fall back to empty; palette's first-token completer already covers
      // the common case.
      void partial;
      return [];
    }
    case 'string':
    case 'number':
    case 'flag':
    default:
      return [];
  }
}

function nodeIdCandidates(spec: ArgSpec, graph: Graph): Candidate[] {
  const out: Candidate[] = [];
  const wantType = spec.nodeType;
  const wantTag = spec.nodeTag;
  for (const n of graph.nodes.values()) {
    if (wantType && n.type !== wantType) continue;
    if (wantTag && !n.tags.includes(wantTag)) continue;
    out.push({
      value: n.id,
      label: n.id,
      detail: n.type,
    });
  }
  return out;
}

function edgeIdCandidates(spec: ArgSpec, graph: Graph): Candidate[] {
  const out: Candidate[] = [];
  for (const e of graph.edges.values()) {
    if (spec.edgeType && e.relation !== spec.edgeType) continue;
    out.push({ value: e.id, detail: e.relation });
  }
  return out;
}

function filterPrefix(cands: Candidate[], partial: string): Candidate[] {
  const pfx = partial.toLowerCase();
  const matches = cands.filter((c) => c.value.toLowerCase().startsWith(pfx));
  matches.sort((a, b) => a.value.localeCompare(b.value));
  return matches.slice(0, 12);
}
