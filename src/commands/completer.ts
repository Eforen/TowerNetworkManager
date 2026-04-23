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

import {
  NODE_TYPES,
  RELATION_NAMES,
  CANONICAL_TAGS,
  isNodeType,
  relationsForPair,
  type NodeType,
} from '@/model';
import type { Graph } from '@/model';
import type { ArgSpec } from './types';
import { parseTypedRef } from './builtins';
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

/**
 * Extra context the completer can draw on for domain-specific arg types
 * that live outside the graph (e.g. project slugs from localStorage).
 *
 * All fields are optional — pass what you have, and arg types whose data
 * is missing simply return empty candidate lists.
 */
export interface CompletionExtras {
  /** Callback returning the saved project slugs (for `projectSlug` args). */
  projects?: () => string[];
}

export function complete(
  input: string,
  caret: number,
  registry: CommandRegistry,
  graph: Graph,
  extras: CompletionExtras = {},
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

  // Prior positional arg values (after the command-name prefix, before the
  // active slot). Used by context-sensitive completers like `relation`.
  const priorArgs = tokens
    .slice(resolved.consumed, activeIndex)
    .map((t) => t.value);

  return {
    replace,
    candidates: completeArg(spec, partial, graph, priorArgs, extras),
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
  priorArgs: string[] = [],
  extras: CompletionExtras = {},
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
    case 'typedRef':
      return completeTypedRef(partial, graph);
    case 'relation':
      return completeRelation(partial, priorArgs);
    case 'projectSlug': {
      const slugs = extras.projects?.() ?? [];
      const hits = filterPrefix(
        slugs.map((s) => ({ value: s, detail: 'project' })),
        partial,
      );
      if (hits.length > 0) return hits;
      const label = slugs.length === 0
        ? '(no saved projects — run `save <slug>` to create one)'
        : `(no project slugs match "${partial}")`;
      return [
        {
          value: partial,
          label,
          detail: slugs.length === 0 ? 'empty' : 'no match',
        },
      ];
    }
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

/**
 * Typed-ref completion (`type[id]`). Two states:
 *   - no `[` yet → suggest `<type>[` for node types matching the partial
 *   - `[` present → suggest `<type>[<id>]` using ids of nodes of that type
 */
function completeTypedRef(partial: string, graph: Graph): Candidate[] {
  const openIdx = partial.indexOf('[');
  if (openIdx === -1) {
    const pfx = partial.toLowerCase();
    // Types that currently have at least one node in the graph win; rank
    // them ahead of types with no instances so `add link ` surfaces the
    // relevant endpoints first within the 12-candidate cap.
    const live = new Set<string>();
    for (const n of graph.nodes.values()) live.add(n.type);
    const all: Candidate[] = [];
    for (const t of NODE_TYPES) {
      if (!t.toLowerCase().startsWith(pfx)) continue;
      all.push({
        value: `${t}[`,
        label: `${t}[…]`,
        detail: live.has(t) ? 'type[id]' : 'type[id] (no nodes yet)',
        sortKey: `${live.has(t) ? '0' : '1'}-${t}`,
      });
    }
    all.sort((a, b) => (a.sortKey ?? a.value).localeCompare(b.sortKey ?? b.value));
    return all.slice(0, 12);
  }
  const typeStr = partial.slice(0, openIdx);
  if (!isNodeType(typeStr)) return [];
  const type = typeStr as NodeType;
  // Strip the trailing `]` if user already typed one (mid-edit).
  const rawId = partial.slice(
    openIdx + 1,
    partial.endsWith(']') ? partial.length - 1 : partial.length,
  );
  const idPfx = rawId.toLowerCase();
  const hits: Candidate[] = [];
  let sawAnyOfType = false;
  for (const n of graph.nodes.values()) {
    if (n.type !== type) continue;
    sawAnyOfType = true;
    if (!n.id.toLowerCase().startsWith(idPfx)) continue;
    hits.push({
      value: `${type}[${n.id}]`,
      label: `${type}[${n.id}]`,
      detail: (n.properties.name as string | undefined) ?? type,
    });
  }
  hits.sort((a, b) => a.value.localeCompare(b.value));
  if (hits.length > 0) return hits.slice(0, 12);
  // Zero matches: emit a non-insertable sentinel so the user sees that the
  // autocomplete fired and understands why no ids appeared (either the
  // type has no nodes, or the id prefix excluded them all). Accepting the
  // sentinel leaves the buffer exactly as typed.
  const label = sawAnyOfType
    ? `(no ${type}[…] matches "${rawId}")`
    : `(no ${type} nodes — run \`add node ${type} <id>\` first)`;
  return [
    {
      value: partial,
      label,
      detail: sawAnyOfType ? 'no match' : 'empty',
    },
  ];
}

/**
 * Relation completion for `add link`-style commands. Reads the two
 * preceding positional args (from and to typed-refs) and only offers
 * relations legal for either `(from, to)` or `(to, from)`. Falls back
 * to the full relation list when endpoints aren't parseable yet.
 */
function completeRelation(partial: string, priorArgs: string[]): Candidate[] {
  const from = priorArgs[priorArgs.length - 2];
  const to = priorArgs[priorArgs.length - 1];
  const f = from ? parseTypedRef(from) : undefined;
  const t = to ? parseTypedRef(to) : undefined;
  if (f && f.ok && t && t.ok) {
    const legal = new Set<string>([
      ...relationsForPair(f.ref.type, t.ref.type),
      ...relationsForPair(t.ref.type, f.ref.type),
    ]);
    const hits: Candidate[] = [];
    for (const r of legal) {
      hits.push({ value: r, detail: 'relation' });
    }
    return filterPrefix(hits, partial);
  }
  return filterPrefix(
    [...RELATION_NAMES].map((r) => ({ value: r, detail: 'relation' })),
    partial,
  );
}

function filterPrefix(cands: Candidate[], partial: string): Candidate[] {
  const pfx = partial.toLowerCase();
  const matches = cands.filter((c) => c.value.toLowerCase().startsWith(pfx));
  matches.sort((a, b) => a.value.localeCompare(b.value));
  return matches.slice(0, 12);
}
