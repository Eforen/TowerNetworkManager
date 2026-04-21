/**
 * Graph container: typed node/edge maps with incremental indices.
 *
 * This is a pure-TS class with no Pinia/Vue dependencies; stores wrap it
 * in Phase 3 onward. Mutation surface kept minimal:
 *
 * - `addNode(init)` / `removeNode(type, id)` / `updateNode(type, id, patch)`
 * - `addEdge(init)`  / `removeEdge(id)`      / `updateEdge(id, patch)`
 *
 * All validation is opt-in via `validation.ts#validate(graph)`. The graph
 * itself only enforces structural invariants (unique keys, endpoint
 * existence) and index consistency.
 */

import { edgeId as buildEdgeId, isValidNodeId, nodeKey } from './ids';
import {
  mergeDefaultProperties,
  mergeDefaultTags,
} from './defaults';
import {
  emptyIndices,
  indexAddEdge,
  indexAddNode,
  indexRemoveEdge,
  indexRemoveNode,
  indexUpdateNodeTags,
  rebuildFloorOf,
  type Indices,
} from './indices';
import { RELATION_META } from './relations';
import type {
  Edge,
  EdgeId,
  Node,
  NodeId,
  NodeKey,
  NodeType,
  Properties,
  RelationName,
} from './types';

export interface NodeInit {
  type: NodeType;
  id: NodeId;
  tags?: readonly string[];
  properties?: Properties;
}

export interface EdgeInit {
  relation: RelationName;
  from: { type: NodeType; id: NodeId };
  to: { type: NodeType; id: NodeId };
  properties?: Properties;
}

export interface NodePatch {
  tags?: readonly string[];
  properties?: Properties;
}

export interface EdgePatch {
  properties?: Properties;
}

export class GraphStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphStructureError';
  }
}

export class Graph {
  readonly nodes: Map<NodeKey, Node> = new Map();
  readonly edges: Map<EdgeId, Edge> = new Map();
  private readonly ix: Indices = emptyIndices();

  // ---------------------------------------------------------------------
  // Nodes
  // ---------------------------------------------------------------------

  addNode(init: NodeInit): Node {
    if (!isValidNodeId(init.type, init.id)) {
      throw new GraphStructureError(
        `invalid id for ${init.type}: ${JSON.stringify(init.id)}`,
      );
    }
    const key = nodeKey(init.type, init.id);
    if (this.nodes.has(key)) {
      throw new GraphStructureError(`duplicate ${init.type}[${init.id}]`);
    }
    const node: Node = {
      id: init.id,
      type: init.type,
      tags: mergeDefaultTags(init.type, init.tags ?? []),
      properties: mergeDefaultProperties(init.type, init.properties ?? {}),
    };
    this.nodes.set(key, node);
    indexAddNode(this.ix, node);
    return node;
  }

  removeNode(type: NodeType, id: NodeId): Node | undefined {
    const key = nodeKey(type, id);
    const node = this.nodes.get(key);
    if (!node) return undefined;
    const incident = [...(this.ix.adjacency.get(key) ?? [])];
    for (const eid of incident) this.removeEdge(eid);
    this.nodes.delete(key);
    indexRemoveNode(this.ix, node);
    return node;
  }

  updateNode(type: NodeType, id: NodeId, patch: NodePatch): Node {
    const key = nodeKey(type, id);
    const node = this.nodes.get(key);
    if (!node) {
      throw new GraphStructureError(`no such node ${type}[${id}]`);
    }
    const oldTags = node.tags;
    if (patch.tags) {
      node.tags = mergeDefaultTags(type, patch.tags);
      indexUpdateNodeTags(this.ix, node, oldTags);
    }
    if (patch.properties) {
      node.properties = { ...node.properties, ...patch.properties };
    }
    return node;
  }

  getNode(type: NodeType, id: NodeId): Node | undefined {
    return this.nodes.get(nodeKey(type, id));
  }

  hasNode(type: NodeType, id: NodeId): boolean {
    return this.nodes.has(nodeKey(type, id));
  }

  // ---------------------------------------------------------------------
  // Edges
  // ---------------------------------------------------------------------

  addEdge(init: EdgeInit): Edge {
    const meta = RELATION_META[init.relation];
    if (!meta) {
      throw new GraphStructureError(`unknown relation ${init.relation}`);
    }
    const fromKey = nodeKey(init.from.type, init.from.id);
    const toKey = nodeKey(init.to.type, init.to.id);
    if (!this.nodes.has(fromKey)) {
      throw new GraphStructureError(
        `edge references missing node ${init.from.type}[${init.from.id}]`,
      );
    }
    if (!this.nodes.has(toKey)) {
      throw new GraphStructureError(
        `edge references missing node ${init.to.type}[${init.to.id}]`,
      );
    }
    const id = buildEdgeId(init.relation, fromKey, toKey, meta.directed);
    if (this.edges.has(id)) {
      throw new GraphStructureError(`duplicate edge ${id}`);
    }
    const edge: Edge = {
      id,
      relation: init.relation,
      fromKey,
      toKey,
      directed: meta.directed,
      strength: meta.strength,
      properties: { ...(init.properties ?? {}) },
    };
    this.edges.set(id, edge);
    indexAddEdge(this.ix, edge);
    return edge;
  }

  removeEdge(id: EdgeId): Edge | undefined {
    const edge = this.edges.get(id);
    if (!edge) return undefined;
    this.edges.delete(id);
    indexRemoveEdge(this.ix, edge);
    return edge;
  }

  updateEdge(id: EdgeId, patch: EdgePatch): Edge {
    const edge = this.edges.get(id);
    if (!edge) throw new GraphStructureError(`no such edge ${id}`);
    if (patch.properties) {
      edge.properties = { ...edge.properties, ...patch.properties };
    }
    return edge;
  }

  getEdge(id: EdgeId): Edge | undefined {
    return this.edges.get(id);
  }

  // ---------------------------------------------------------------------
  // Queries and indices
  // ---------------------------------------------------------------------

  /**
   * Edges incident to the given node (both directions). Returns a fresh
   * array so callers may mutate without affecting indices.
   */
  edgesOf(type: NodeType, id: NodeId): Edge[] {
    const key = nodeKey(type, id);
    const ids = this.ix.adjacency.get(key);
    if (!ids) return [];
    const out: Edge[] = [];
    for (const eid of ids) {
      const e = this.edges.get(eid);
      if (e) out.push(e);
    }
    return out;
  }

  nodesOfType(type: NodeType): Node[] {
    const keys = this.ix.byType.get(type);
    if (!keys) return [];
    const out: Node[] = [];
    for (const k of keys) {
      const n = this.nodes.get(k);
      if (n) out.push(n);
    }
    return out;
  }

  nodesWithTag(tag: string): Node[] {
    const keys = this.ix.byTag.get(tag);
    if (!keys) return [];
    const out: Node[] = [];
    for (const k of keys) {
      const n = this.nodes.get(k);
      if (n) out.push(n);
    }
    return out;
  }

  /**
   * Return the floor level of a node, walking `FloorAssignment` and
   * `RackAssignment` transitively. Rebuilds cache when dirty.
   */
  floorOf(type: NodeType, id: NodeId): number | undefined {
    if (this.ix.floorDirty) {
      rebuildFloorOf(this.ix, this.nodes, this.edges);
    }
    return this.ix.floorOf.get(nodeKey(type, id));
  }

  /** Read-only view of the current indices, for tests and debugging. */
  get indices(): Readonly<Indices> {
    return this.ix;
  }

  /** Total counts for quick stats lines. */
  stats(): { nodes: number; edges: number } {
    return { nodes: this.nodes.size, edges: this.edges.size };
  }
}

// Re-exports for convenience.
export { nodeKey, parseNodeKey } from './ids';
