/**
 * Runtime indices per docs/specs/graphdata.md §Indices (runtime).
 *
 * - `byType:  Map<NodeType, Set<NodeKey>>`
 * - `byTag:   Map<Tag, Set<NodeKey>>`
 * - `floorOf: Map<NodeKey, number | undefined>` via FloorAssignment +
 *            transitive through RackAssignment.
 * - `adjacency: Map<NodeKey, EdgeId[]>`
 *
 * `byType`, `byTag`, and `adjacency` are maintained incrementally by the
 * Graph class. `floorOf` is lazy — rebuilt on first access after a
 * `FloorAssignment` or `RackAssignment` edge, or any rack/floor node
 * mutation.
 */

import type { Edge, EdgeId, Node, NodeKey, NodeType } from './types';
import { nodeKey, parseNodeKey } from './ids';

export interface Indices {
  byType: Map<NodeType, Set<NodeKey>>;
  byTag: Map<string, Set<NodeKey>>;
  adjacency: Map<NodeKey, Set<EdgeId>>;
  /** `undefined` => floor info not yet computed for this node. */
  floorOf: Map<NodeKey, number | undefined>;
  /** Dirty flag for lazy floorOf rebuild. */
  floorDirty: boolean;
}

export function emptyIndices(): Indices {
  return {
    byType: new Map(),
    byTag: new Map(),
    adjacency: new Map(),
    floorOf: new Map(),
    floorDirty: true,
  };
}

export function indexAddNode(ix: Indices, node: Node): void {
  const key = nodeKey(node.type, node.id);
  addToSet(ix.byType, node.type, key);
  for (const tag of node.tags) addToSet(ix.byTag, tag, key);
  if (!ix.adjacency.has(key)) ix.adjacency.set(key, new Set());
  if (node.type === 'rack' || node.type === 'floor') ix.floorDirty = true;
}

export function indexRemoveNode(ix: Indices, node: Node): void {
  const key = nodeKey(node.type, node.id);
  removeFromSet(ix.byType, node.type, key);
  for (const tag of node.tags) removeFromSet(ix.byTag, tag, key);
  ix.adjacency.delete(key);
  ix.floorOf.delete(key);
  if (node.type === 'rack' || node.type === 'floor') ix.floorDirty = true;
}

export function indexUpdateNodeTags(
  ix: Indices,
  node: Node,
  oldTags: readonly string[],
): void {
  const key = nodeKey(node.type, node.id);
  for (const t of oldTags) removeFromSet(ix.byTag, t, key);
  for (const t of node.tags) addToSet(ix.byTag, t, key);
}

export function indexAddEdge(ix: Indices, edge: Edge): void {
  addToSet(ix.adjacency, edge.fromKey, edge.id);
  addToSet(ix.adjacency, edge.toKey, edge.id);
  if (
    edge.relation === 'FloorAssignment' ||
    edge.relation === 'RackAssignment'
  ) {
    ix.floorDirty = true;
  }
}

export function indexRemoveEdge(ix: Indices, edge: Edge): void {
  removeFromSet(ix.adjacency, edge.fromKey, edge.id);
  removeFromSet(ix.adjacency, edge.toKey, edge.id);
  if (
    edge.relation === 'FloorAssignment' ||
    edge.relation === 'RackAssignment'
  ) {
    ix.floorDirty = true;
  }
}

/**
 * Rebuild the `floorOf` map from scratch. A node's floor is derived by:
 *
 * 1. If reachable via `FloorAssignment` (floor -> node), the floor level
 *    property of that floor is the answer.
 * 2. Else if reachable via `RackAssignment` (rack -> node) and the rack
 *    itself has a floor, inherit it.
 * 3. Else `undefined`.
 *
 * Floor level is taken from `floor.properties.level` if set, else
 * parsed from the id when it matches `^f(\d+)$`.
 */
export function rebuildFloorOf(
  ix: Indices,
  nodes: Map<NodeKey, Node>,
  edges: Map<EdgeId, Edge>,
): void {
  ix.floorOf.clear();

  const floorLevels = new Map<NodeKey, number>();
  for (const [, node] of nodes) {
    if (node.type !== 'floor') continue;
    const key = nodeKey('floor', node.id);
    const raw = node.properties.level;
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      floorLevels.set(key, raw);
      continue;
    }
    const m = /^f(\d+)$/.exec(node.id);
    if (m) floorLevels.set(key, Number(m[1]));
  }

  const rackFloor = new Map<NodeKey, number>();
  const directAssign = new Map<NodeKey, number>();

  for (const [, edge] of edges) {
    if (edge.relation !== 'FloorAssignment') continue;
    const floorLevel = floorLevels.get(edge.fromKey);
    if (floorLevel === undefined) continue;
    const to = edge.toKey;
    const toType = parseNodeKey(to).type;
    if (toType === 'rack') rackFloor.set(to, floorLevel);
    else directAssign.set(to, floorLevel);
  }

  for (const [, edge] of edges) {
    if (edge.relation !== 'RackAssignment') continue;
    const floorLevel = rackFloor.get(edge.fromKey);
    if (floorLevel === undefined) continue;
    if (!directAssign.has(edge.toKey)) directAssign.set(edge.toKey, floorLevel);
  }

  for (const [key, level] of floorLevels) ix.floorOf.set(key, level);
  for (const [key, level] of rackFloor) ix.floorOf.set(key, level);
  for (const [key, level] of directAssign) ix.floorOf.set(key, level);

  ix.floorDirty = false;
}

function addToSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  let set = map.get(key);
  if (!set) {
    set = new Set();
    map.set(key, set);
  }
  set.add(value);
}

function removeFromSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const set = map.get(key);
  if (!set) return;
  set.delete(value);
  if (set.size === 0) map.delete(key);
}
