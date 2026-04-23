/**
 * ID and key helpers per docs/specs/graphdata.md §Conventions and §Data types.
 */

import type { EdgeId, NodeId, NodeKey, NodeType, RelationName } from './types';

/** slug-case, `[a-z0-9][a-z0-9_-]*`, 1..64 chars. */
export const NODE_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

/** Network address: starts with `@`, total length <= 10. */
export const NET_ADDR_RE = /^@[A-Za-z0-9_\-/]{1,9}$/;

/**
 * Hardware address: 1..5 numeric digits. Used as:
 *   - id of a `port` tagged `UserPort`.
 *   - `hardwareAddress` property on `server` / `switch` / `router`.
 */
export const HARDWARE_ADDR_RE = /^\d{1,5}$/;

/**
 * Device port id: literal `port` followed by one or more digits
 * (`port0`, `port1`, `port10`). In-game port ids are always this shape —
 * no `eth0`, no custom slugs. UserPort (consumer) ports instead use
 * a pure-digit hardware address (see `HARDWARE_ADDR_RE`).
 */
export const PORT_SLUG_RE = /^port\d+$/;

/**
 * Uplink id: exactly 4 lowercase letters, e.g. `comc`, `attn`. Not a
 * network address — uplinks identify an ISP peering endpoint.
 */
export const UPLINK_ID_RE = /^[a-z]{4}$/;

/**
 * Program slugs allow underscores anywhere (game-style ids like `padu_v1`).
 * Matches `[a-z][a-z0-9_-]*`, 1..64 chars.
 */
export const PROGRAM_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

/** Usage type slugs: kebab-case, `[a-z][a-z0-9-]*`. */
export const USAGE_TYPE_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

/** Canonical tag ids are PascalCase-ish. Custom tags must match. */
export const TAG_RE = /^[A-Z][A-Za-z0-9]*$/;

/**
 * Types that use a network address (`@...`) as their id. Only
 * `networkaddress` qualifies: `port` uses a slug/digit id and `uplink`
 * uses a 4-letter ISP code (see `UPLINK_ID_RE`).
 */
export const NET_ADDR_TYPES: readonly NodeType[] = [
  'networkaddress',
] as const;

export function isNetAddrType(type: NodeType): boolean {
  return NET_ADDR_TYPES.includes(type);
}

/**
 * Validate that an `id` is well-formed for its `type`.
 *
 * - `networkaddress` / `uplink`: must match `NET_ADDR_RE`.
 * - `port`: either hardware address (`HARDWARE_ADDR_RE`) for UserPorts,
 *   or plain slug (`PORT_SLUG_RE`) for device NICs. Which one is required
 *   is decided by tags and enforced in `validation.ts`; here we accept
 *   either shape.
 * - `program`: `PROGRAM_ID_RE`.
 * - `usagetype`: `USAGE_TYPE_ID_RE`.
 * - `domain`: lenient domain regex.
 * - everything else: `NODE_ID_RE`.
 */
export function isValidNodeId(type: NodeType, id: string): boolean {
  if (isNetAddrType(type)) return NET_ADDR_RE.test(id);
  if (type === 'uplink') return UPLINK_ID_RE.test(id);
  if (type === 'port') return HARDWARE_ADDR_RE.test(id) || PORT_SLUG_RE.test(id);
  if (type === 'program') return PROGRAM_ID_RE.test(id);
  if (type === 'usagetype') return USAGE_TYPE_ID_RE.test(id);
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
