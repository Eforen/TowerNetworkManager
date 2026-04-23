/**
 * Server / switch / router `portLayout` materializes `port[parentId/portN]`
 * nodes and a matching `NIC` edge from the device to each slot (idempotent
 * re-parse if the file also declares those edges). Sync runs after parse
 * and on graph `touch` (commands).
 */

import { mergeDefaultTags } from './defaults';
import { Graph } from './graph';
import { edgeId, nodeKey, parseCompositeDevicePortId, parseNodeKey } from './ids';
import type { Edge, EdgeId, Node, NodeId, NodeType } from './types';
import { expandPortLayoutToMediaList, type PortLayoutMedia } from './portLayout';

const DEVICE_PORT_TYPES: readonly NodeType[] = [
  'server',
  'switch',
  'router',
] as const;

const NIC_FROM: ReadonlySet<NodeType> = new Set(DEVICE_PORT_TYPES);

/**
 * `parentId` may refer to at most one of server|switch|router. Returns that
 * node, or `undefined` if none.
 */
export function findDeviceForPortParentId(
  graph: Graph,
  parentId: string,
): { type: NodeType; id: string; node: Node } | undefined {
  for (const t of DEVICE_PORT_TYPES) {
    const n = graph.getNode(t, parentId);
    if (n) return { type: t, id: parentId, node: n };
  }
  return undefined;
}

export function hasDuplicateDeviceIdAcrossTypes(
  graph: Graph,
  parentId: string,
): boolean {
  let c = 0;
  for (const t of DEVICE_PORT_TYPES) {
    if (graph.getNode(t, parentId)) c++;
  }
  return c > 1;
}

/** `port[parentId/portN]` whose media comes from the parent's `portLayout`. */
export function isDeviceLayoutManagedPort(
  graph: Graph,
  port: Node,
): boolean {
  if (port.type !== 'port' || port.tags.includes('UserPort')) return false;
  const c = parseCompositeDevicePortId(port.id);
  if (!c) return false;
  const dev = findDeviceForPortParentId(graph, c.parentId);
  if (!dev) return false;
  const spec = String(dev.node.properties['portLayout'] ?? '').trim();
  if (spec.length === 0) return false;
  try {
    const m = expandPortLayoutToMediaList(spec);
    return c.suffixIndex < m.length;
  } catch {
    return false;
  }
}

/**
 * True for `NIC` from a device to one of its own `portLayout` slots. These are
 * recreated by {@link syncEphemeralDevicePorts} and are omitted on serialize
 * when they have no edge properties. Cross-device or custom NICs still emit.
 */
export function isImplicitLayoutNicEdge(graph: Graph, edge: Edge): boolean {
  if (edge.relation !== 'NIC' || !edge.directed) return false;
  if (Object.keys(edge.properties).length > 0) return false;
  const from = parseNodeKey(edge.fromKey);
  const to = parseNodeKey(edge.toKey);
  if (to.type !== 'port' || !NIC_FROM.has(from.type)) return false;
  const c = parseCompositeDevicePortId(to.id);
  if (!c || c.parentId !== from.id) return false;
  const dev = findDeviceForPortParentId(graph, c.parentId);
  if (!dev || dev.type !== from.type) return false;
  const portNode = graph.getNode('port', to.id);
  if (!portNode) return false;
  return isDeviceLayoutManagedPort(graph, portNode);
}

function portIdForSlot(parentId: string, index: number): string {
  return `${parentId}/port${index}`;
}

/**
 * Each layout slot is a device NIC port; graphdata expects `NIC` from the
 * owning device. Idempotent (skips if the edge already exists).
 */
function ensureNicFromDevice(
  graph: Graph,
  devType: (typeof DEVICE_PORT_TYPES)[number],
  devId: string,
  portId: string,
): void {
  const fromKey = nodeKey(devType, devId);
  const toKey = nodeKey('port', portId);
  const eid = edgeId('NIC', fromKey, toKey, true) as EdgeId;
  if (graph.getEdge(eid)) return;
  graph.addEdge({
    relation: 'NIC',
    from: { type: devType, id: devId },
    to: { type: 'port', id: portId },
  });
}

function removePortsForDevicePrefixAfter(
  graph: Graph,
  parentId: string,
  keepCount: number,
): void {
  const ids: NodeId[] = [];
  for (const [, n] of graph.nodes) {
    if (n.type !== 'port') continue;
    const c = parseCompositeDevicePortId(n.id);
    if (c && c.parentId === parentId && c.suffixIndex >= keepCount) {
      ids.push(n.id);
    }
  }
  for (const id of ids) graph.removeNode('port', id);
}

/**
 * For each server/switch/router with a `portLayout` string, add/update/remove
 * `port[parentId/portN]` nodes to match.
 */
export function syncEphemeralDevicePorts(graph: Graph): void {
  for (const t of DEVICE_PORT_TYPES) {
    for (const dev of graph.nodesOfType(t)) {
      const spec = String(dev.properties['portLayout'] ?? '').trim();
      if (spec.length === 0) {
        removePortsForDevicePrefixAfter(graph, dev.id, 0);
        continue;
      }
      let medias: PortLayoutMedia[];
      try {
        medias = expandPortLayoutToMediaList(spec);
      } catch {
        continue;
      }
      for (let i = 0; i < medias.length; i++) {
        const id = portIdForSlot(dev.id, i);
        const mediaTag = medias[i];
        const existing = graph.getNode('port', id);
        if (existing) {
          const noMedia = existing.tags.filter(
            (x) => x !== 'RJ45' && x !== 'FiberOptic',
          );
          const nextTags = mergeDefaultTags('port', [...noMedia, mediaTag]);
          graph.updateNode('port', id, { tags: nextTags });
        } else {
          graph.addNode({
            type: 'port',
            id,
            tags: [mediaTag],
            properties: {},
          });
        }
        ensureNicFromDevice(graph, t, dev.id, id);
      }
      removePortsForDevicePrefixAfter(graph, dev.id, medias.length);
    }
  }
}
