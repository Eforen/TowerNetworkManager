/**
 * Build a derived graph for force view: optional floor hiding and collapsing
 * leaf types into parents (see docs/specs/visualization.md §Data layers).
 */

import {
  Graph,
  GraphStructureError,
  nodeKey,
  parseCompositeDevicePortId,
  parseNodeKey,
} from '@/model';
import type { Node, NodeKey } from '@/model';

/** Persisted under `tni.view.dataLayers` (JSON). */
export interface DataLayersSettings {
  /** When false, `floor` nodes and all edges touching them are omitted. */
  showFloors: boolean;
  /** Hide `networkaddress` nodes; remap edges to the AssignedTo holder. */
  collapseNetworkAddresses: boolean;
  /** Hide `userport` nodes; remap edges to the `Owner` (customer | player). */
  collapseUserports: boolean;
  /** Hide layout `port` nodes (`parent/portN`); remap edges to owning device. */
  collapseNicPorts: boolean;
}

/** Keep in sync with `STORAGE_KEYS.viewDataLayers` in `store/storage.ts`. */
export const DATA_LAYERS_STORAGE_KEY = 'tni.view.dataLayers';

export const DEFAULT_DATA_LAYERS: DataLayersSettings = {
  showFloors: true,
  collapseNetworkAddresses: false,
  collapseUserports: false,
  collapseNicPorts: false,
};

export function parseDataLayersJson(raw: string | null): DataLayersSettings {
  if (!raw) return { ...DEFAULT_DATA_LAYERS };
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    return {
      showFloors: readBool(o.showFloors, DEFAULT_DATA_LAYERS.showFloors),
      collapseNetworkAddresses: readBool(
        o.collapseNetworkAddresses,
        DEFAULT_DATA_LAYERS.collapseNetworkAddresses,
      ),
      collapseUserports: readBool(
        o.collapseUserports,
        DEFAULT_DATA_LAYERS.collapseUserports,
      ),
      collapseNicPorts: readBool(
        o.collapseNicPorts,
        DEFAULT_DATA_LAYERS.collapseNicPorts,
      ),
    };
  } catch {
    return { ...DEFAULT_DATA_LAYERS };
  }
}

function readBool(v: unknown, d: boolean): boolean {
  return typeof v === 'boolean' ? v : d;
}

function findDeviceKeyForParentId(
  graph: Graph,
  parentId: string,
): NodeKey | undefined {
  for (const t of ['server', 'switch', 'router'] as const) {
    if (graph.hasNode(t, parentId)) return nodeKey(t, parentId);
  }
  return undefined;
}

function resolveRemap(k: NodeKey, remap: Map<NodeKey, NodeKey>): NodeKey {
  const seen = new Set<NodeKey>();
  let cur = k;
  while (remap.has(cur)) {
    const nxt = remap.get(cur)!;
    if (seen.has(nxt)) break;
    seen.add(cur);
    cur = nxt;
  }
  return cur;
}

/** Remap table + keys of source nodes that appear in {@link buildPresentationGraph}. */
export interface PresentationCollapseState {
  remap: Map<NodeKey, NodeKey>;
  /** Source keys not omitted from the presentation node set. */
  visibleKeys: Set<NodeKey>;
}

export function getPresentationCollapseState(
  source: Graph,
  layers: DataLayersSettings,
): PresentationCollapseState {
  const remap = new Map<NodeKey, NodeKey>();
  const omit = new Set<NodeKey>();

  if (layers.collapseUserports) {
    for (const e of source.edges.values()) {
      if (e.relation !== 'Owner') continue;
      const to = parseNodeKey(e.toKey);
      if (to.type !== 'userport') continue;
      const from = parseNodeKey(e.fromKey);
      if (from.type === 'customer' || from.type === 'player') {
        remap.set(e.toKey, e.fromKey);
        omit.add(e.toKey);
      }
    }
  }

  if (layers.collapseNetworkAddresses) {
    for (const e of source.edges.values()) {
      if (e.relation !== 'AssignedTo') continue;
      const from = parseNodeKey(e.fromKey);
      if (from.type !== 'networkaddress') continue;
      remap.set(e.fromKey, e.toKey);
      omit.add(e.fromKey);
    }
  }

  if (layers.collapseNicPorts) {
    for (const [key, n] of source.nodes) {
      if (n.type !== 'port') continue;
      const c = parseCompositeDevicePortId(n.id);
      if (!c) continue;
      const devKey = findDeviceKeyForParentId(source, c.parentId);
      if (!devKey) continue;
      remap.set(key, devKey);
      omit.add(key);
    }
  }

  if (!layers.showFloors) {
    for (const [key, n] of source.nodes) {
      if (n.type === 'floor') omit.add(key);
    }
  }

  const visibleKeys = new Set<NodeKey>();
  for (const k of source.nodes.keys()) {
    if (!omit.has(k)) visibleKeys.add(k);
  }

  return { remap, visibleKeys };
}

/**
 * Presentation-space neighbor keys for a source node (after collapse remap),
 * excluding the child's own collapsed identity. Omits targets not visible
 * in the presentation graph (e.g. hidden floors).
 */
export function collapsedChildPresentationTargets(
  source: Graph,
  layers: DataLayersSettings,
  childKey: NodeKey,
): NodeKey[] {
  const { remap, visibleKeys } = getPresentationCollapseState(source, layers);
  const childPresent = resolveRemap(childKey, remap);
  const seen = new Set<NodeKey>();
  const out: NodeKey[] = [];
  for (const e of source.edges.values()) {
    let other: NodeKey | null = null;
    if (e.fromKey === childKey) other = e.toKey;
    else if (e.toKey === childKey) other = e.fromKey;
    else continue;
    const r = resolveRemap(other, remap);
    if (r === childPresent) continue;
    if (!visibleKeys.has(r)) continue;
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(r);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

/**
 * Shallow copy of nodes/edges with collapsed endpoints and optional floor
 * removal. Does not run validation.
 */
export function buildPresentationGraph(
  source: Graph,
  layers: DataLayersSettings,
): Graph {
  const { remap, visibleKeys: include } = getPresentationCollapseState(
    source,
    layers,
  );

  const out = new Graph();

  for (const [key, n] of source.nodes) {
    if (!include.has(key)) continue;
    out.addNode({
      type: n.type,
      id: n.id,
      tags: [...n.tags],
      properties: { ...n.properties },
    });
  }

  for (const e of source.edges.values()) {
    const fa = resolveRemap(e.fromKey, remap);
    const ta = resolveRemap(e.toKey, remap);
    if (fa === ta) continue;
    if (!include.has(fa) || !include.has(ta)) continue;

    const from = parseNodeKey(fa);
    const to = parseNodeKey(ta);
    try {
      out.addEdge({
        relation: e.relation,
        from: { type: from.type, id: from.id },
        to: { type: to.type, id: to.id },
        properties: { ...e.properties },
      });
    } catch (err) {
      if (err instanceof GraphStructureError) {
        // duplicate collapsed edge — ignore
        continue;
      }
      throw err;
    }
  }

  return out;
}

const TOOLTIP_COLLAPSE_TYPE_ORDER: Partial<Record<string, number>> = {
  networkaddress: 0,
  userport: 1,
  port: 2,
};

/**
 * Full-graph nodes that are hidden in the presentation view but grouped
 * under `parentKey` for tooltips (same collapse rules as
 * {@link buildPresentationGraph}).
 */
export function collapsedChildrenForParent(
  source: Graph,
  layers: DataLayersSettings,
  parentKey: NodeKey,
): Node[] {
  const out: Node[] = [];

  if (layers.collapseUserports) {
    for (const e of source.edges.values()) {
      if (e.relation !== 'Owner') continue;
      if (e.fromKey !== parentKey) continue;
      const to = parseNodeKey(e.toKey);
      if (to.type !== 'userport') continue;
      const n = source.getNode('userport', to.id);
      if (n) out.push(n);
    }
  }

  if (layers.collapseNetworkAddresses) {
    for (const e of source.edges.values()) {
      if (e.relation !== 'AssignedTo') continue;
      if (e.toKey !== parentKey) continue;
      const from = parseNodeKey(e.fromKey);
      if (from.type !== 'networkaddress') continue;
      const n = source.getNode('networkaddress', from.id);
      if (n) out.push(n);
    }
  }

  if (layers.collapseNicPorts) {
    const p = parseNodeKey(parentKey);
    if (p.type === 'server' || p.type === 'switch' || p.type === 'router') {
      for (const [, n] of source.nodes) {
        if (n.type !== 'port') continue;
        const c = parseCompositeDevicePortId(n.id);
        if (!c || c.parentId !== p.id) continue;
        const devKey = findDeviceKeyForParentId(source, c.parentId);
        if (devKey === parentKey) out.push(n);
      }
    }
  }

  out.sort((a, b) => {
    const oa = TOOLTIP_COLLAPSE_TYPE_ORDER[a.type] ?? 9;
    const ob = TOOLTIP_COLLAPSE_TYPE_ORDER[b.type] ?? 9;
    if (oa !== ob) return oa - ob;
    return a.id.localeCompare(b.id);
  });

  return out;
}
