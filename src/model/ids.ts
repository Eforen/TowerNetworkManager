/**
 * ID and key helpers per docs/specs/graphdata.md §Conventions and §Data types.
 */

import type { EdgeId, NodeId, NodeKey, NodeType, RelationName } from './types';

/** slug-case, `[a-z0-9][a-z0-9_-]*`, 1..64 chars. */
export const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Network address: starts with `@`, total length <= 10. */
export const NET_ADDR_RE = /^@[A-Za-z0-9_\-/]{1,9}$/;

/**
 * Program slugs allow underscores anywhere (game-style ids like `padu_v1`).
 * Matches `[a-z][a-z0-9_-]*`, 1..64 chars.
 */
export const PROGRAM_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/** Usage type slugs: kebab-case, `[a-z][a-z0-9-]*`. */
export const USAGE_TYPE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** Canonical tag ids are PascalCase-ish. Custom tags must match. */
export const TAG_RE = /^[A-Z][A-Za-z0-9]*$/;

/** Type id pairs that use a network address as their id. */
export const NET_ADDR_TYPES: readonly NodeType[] = [
  'port',
  'uplink',
  'networkaddress',
] as const;

export function isNetAddrType(type: NodeType): boolean {
  return NET_ADDR_TYPES.includes(type);
}

/**
 * Validate that an `id` is well-formed for its `type`. Network-address types
 * must match `NET_ADDR_RE`; `program` uses `PROGRAM_ID_RE`; `usagetype` uses
 * `USAGE_TYPE_ID_RE`; everything else uses `NODE_ID_RE`.
 */
export function isValidNodeId(type: NodeType, id: string): boolean {
  if (isNetAddrType(type)) return NET_ADDR_RE.test(id);
  if (type === 'program') return PROGRAM_ID_RE.test(id);
  if (type === 'usagetype') return USAGE_TYPE_ID_RE.test(id);
  // domain uses the raw domain name, validated with a lenient rule
  if (type === 'domain') return /^[a-z0-9][a-z0-9.-]*$/.test(id);
  return NODE_ID_RE.test(id);
}

export function nodeKey(type: NodeType, id: NodeId): NodeKey {
  return `${type}:${id}` as NodeKey;
}

export function parseNodeKey(key: NodeKey): { type: NodeType; id: NodeId } {
  const idx = (key as string).indexOf(':');
  if (idx < 0) throw new Error(`invalid NodeKey: ${key}`);
  return {
    type: (key as string).slice(0, idx) as NodeType,
    id: (key as string).slice(idx + 1),
  };
}

/**
 * Build an EdgeId. Directed edges encode `from->to`; undirected edges sort
 * endpoints lexicographically so equivalent edges canonicalize the same way.
 */
export function edgeId(
  relation: RelationName,
  from: NodeKey,
  to: NodeKey,
  directed: boolean,
): EdgeId {
  if (directed) {
    return `${relation}:${from}->${to}` as EdgeId;
  }
  const [a, b] = (from as string) <= (to as string) ? [from, to] : [to, from];
  return `${relation}:${a}~${b}` as EdgeId;
}
