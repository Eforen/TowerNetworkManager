/**
 * Canonical serializer for the TNI v1 file format.
 *
 * Per docs/specs/fileformat.md §"Canonical serialization":
 *
 *   1. `!tni v1` header.
 *   2. Entities grouped and ordered by the fixed `ENTITY_TYPE_ORDER`;
 *      within a group sorted by id lexicographically.
 *   3. One blank line separator.
 *   4. Edges grouped by relation per `RELATION_ORDER`; within a group
 *      sorted by `(fromType, fromId, toType, toId)` after canonicalizing
 *      undirected endpoints into lex order. `NIC` from a device to its own
 *      `portLayout` slot (no edge props) is omitted; sync recreates them on load.
 *   5. Tags before properties; tags sorted; property keys sorted.
 *   6. Strings quoted with minimal escaping.
 *   7. Default tags and properties for a node type are elided so that
 *      `parse(serialize(model))` is stable; they are re-applied on parse.
 *
 * Round-trip guarantees:
 *
 *   parse(serialize(model))      ≡ model    (structural equality)
 *   serialize(parse(canonical))  === canonical    byte-for-byte
 */

import {
  DEFAULT_PROPERTIES_BY_TYPE,
  DEFAULT_TAGS_BY_TYPE,
  HARDWARE_ADDR_RE,
  NET_ADDR_RE,
  NODE_ID_RE,
  PORT_SLUG_RE,
  RELATION_META,
  isDeviceLayoutManagedPort,
  isImplicitLayoutNicEdge,
  isNetAddrType,
  parseNodeKey,
  type Edge,
  type Graph,
  type Node,
  type NodeType,
  type PropertyValue,
  type RelationName,
} from '@/model';

export const ENTITY_TYPE_ORDER: readonly NodeType[] = [
  'floor',
  'rack',
  'uplink',
  'port',
  'userport',
  'switch',
  'router',
  'server',
  'program',
  'rtable',
  'player',
  'customertype',
  'customer',
  'domain',
  'networkaddress',
  'usagetype',
  'behaviorinsight',
  'consumerbehavior',
  'producerbehavior',
];

export const RELATION_ORDER: readonly RelationName[] = [
  'FloorAssignment',
  'RackAssignment',
  'UplinkConnection',
  'NetworkCableLinkFiber',
  'NetworkCableLinkRJ45',
  'NIC',
  'Install',
  'Owner',
  'AssignedTo',
  'Route',
  'Insight',
  'Consumes',
  'Provides',
];

export function serialize(graph: Graph): string {
  const lines: string[] = ['!tni v1'];

  for (const type of ENTITY_TYPE_ORDER) {
    const nodes = graph.nodesOfType(type);
    if (nodes.length === 0) continue;
    nodes.sort((a, b) => a.id.localeCompare(b.id));
    for (const node of nodes) {
      if (type === 'port' && isDeviceLayoutManagedPort(graph, node)) {
        continue;
      }
      lines.push(serializeNode(node, graph));
    }
  }

  lines.push('');

  for (const relation of RELATION_ORDER) {
    const edges = [...graph.edges.values()].filter(
      (e) =>
        e.relation === relation &&
        !(e.relation === 'NIC' && isImplicitLayoutNicEdge(graph, e)),
    );
    if (edges.length === 0) continue;
    const meta = RELATION_META[relation];
    const prepared = edges.map((e) => canonicalizeEdge(e, meta.directed));
    prepared.sort(compareEdgeKeys);
    for (const pe of prepared) lines.push(serializeEdgeLine(pe));
  }

  // Drop trailing blank line if no edges exist.
  while (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();

  return lines.join('\n') + '\n';
}

// ---------------------------------------------------------------------------
// Nodes
// ---------------------------------------------------------------------------

function serializeNode(node: Node, graph: Graph): string {
  if (node.type === 'port') return serializePortNode(node);
  if (node.type === 'userport') return serializeUserportNode(node);
  if (node.type === 'uplink') return serializeUplinkNode(node);

  const parts: string[] = [node.type, formatIdentity(node.type, node.id)];
  if (node.type === 'server' || node.type === 'switch' || node.type === 'router') {
    const pl = String(node.properties['portLayout'] ?? '').trim();
    if (pl) parts.push(pl);
  }

  const defaults = DEFAULT_TAGS_BY_TYPE[node.type] ?? [];
  const emittedTags = node.tags
    .filter((t) => !defaults.includes(t))
    .sort((a, b) => a.localeCompare(b));
  for (const t of emittedTags) parts.push(`#${t}`);

  const defaultProps = DEFAULT_PROPERTIES_BY_TYPE[node.type] ?? {};
  const keys = Object.keys(node.properties)
    .filter((k) => {
      if (k === 'portLayout' && (node.type === 'server' || node.type === 'switch' || node.type === 'router')) {
        return false;
      }
      return true;
    })
    .sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const v = node.properties[k];
    if (defaultProps[k] !== undefined && defaultProps[k] === v) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }

  return parts.join(' ');
}

/**
 * Device port line: `port "parent/port0" <MEDIA> …` (media positional).
 */
function serializePortNode(node: Node): string {
  const media = node.tags.includes('FiberOptic') ? 'FiberOptic' : 'RJ45';
  const second = node.id.includes('/') ? quoteString(node.id) : node.id.replace(/^port/, '');
  const parts: string[] = ['port', second, media];

  const defaults = DEFAULT_TAGS_BY_TYPE.port ?? [];
  const hidden = new Set<string>([...defaults, 'RJ45', 'FiberOptic']);
  const emittedTags = node.tags
    .filter((t) => !hidden.has(t))
    .sort((a, b) => a.localeCompare(b));
  for (const t of emittedTags) parts.push(`#${t}`);

  const defaultProps = DEFAULT_PROPERTIES_BY_TYPE.port ?? {};
  const keys = Object.keys(node.properties).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const v = node.properties[k];
    if (defaultProps[k] !== undefined && defaultProps[k] === v) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.join(' ');
}

/** `userport <hardware> <MEDIA>` — media positional, not `#RJ45`. */
function serializeUserportNode(node: Node): string {
  const media = node.tags.includes('FiberOptic') ? 'FiberOptic' : 'RJ45';
  const parts: string[] = ['userport', node.id, media];
  const defaults = DEFAULT_TAGS_BY_TYPE.userport ?? [];
  const hidden = new Set<string>([...defaults, 'RJ45', 'FiberOptic']);
  const emittedTags = node.tags
    .filter((t) => !hidden.has(t))
    .sort((a, b) => a.localeCompare(b));
  for (const t of emittedTags) parts.push(`#${t}`);
  const defaultProps = DEFAULT_PROPERTIES_BY_TYPE.userport ?? {};
  const keys = Object.keys(node.properties).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const v = node.properties[k];
    if (defaultProps[k] !== undefined && defaultProps[k] === v) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.join(' ');
}

/** `uplink <id> <MEDIA>` — media positional. */
function serializeUplinkNode(node: Node): string {
  const media = node.tags.includes('FiberOptic') ? 'FiberOptic' : 'RJ45';
  const parts: string[] = ['uplink', node.id, media];
  const defaults = DEFAULT_TAGS_BY_TYPE.uplink ?? [];
  const hidden = new Set<string>([...defaults, 'RJ45', 'FiberOptic']);
  const emittedTags = node.tags
    .filter((t) => !hidden.has(t))
    .sort((a, b) => a.localeCompare(b));
  for (const t of emittedTags) parts.push(`#${t}`);
  const defaultProps = DEFAULT_PROPERTIES_BY_TYPE.uplink ?? {};
  const keys = Object.keys(node.properties).sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    const v = node.properties[k];
    if (defaultProps[k] !== undefined && defaultProps[k] === v) continue;
    parts.push(`${k}=${formatValue(v)}`);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// Edges
// ---------------------------------------------------------------------------

interface PreparedEdge {
  relation: RelationName;
  from: { type: NodeType; id: string };
  to: { type: NodeType; id: string };
  properties: Record<string, PropertyValue>;
}

function canonicalizeEdge(edge: Edge, directed: boolean): PreparedEdge {
  let from = parseNodeKey(edge.fromKey);
  let to = parseNodeKey(edge.toKey);
  if (!directed) {
    const a = `${from.type}[${from.id}]`;
    const b = `${to.type}[${to.id}]`;
    if (a > b) [from, to] = [to, from];
  }
  return { relation: edge.relation, from, to, properties: edge.properties };
}

function compareEdgeKeys(a: PreparedEdge, b: PreparedEdge): number {
  return (
    a.from.type.localeCompare(b.from.type) ||
    a.from.id.localeCompare(b.from.id) ||
    a.to.type.localeCompare(b.to.type) ||
    a.to.id.localeCompare(b.to.id)
  );
}

function serializeEdgeLine(pe: PreparedEdge): string {
  const fromRef = `${pe.from.type}[${formatIdentity(pe.from.type, pe.from.id)}]`;
  const toRef = `${pe.to.type}[${formatIdentity(pe.to.type, pe.to.id)}]`;
  const main = `${fromRef} -> ${toRef} :${pe.relation}`;
  const keys = Object.keys(pe.properties).sort((a, b) => a.localeCompare(b));
  if (keys.length === 0) return main;
  const props = keys
    .map((k) => `${k}=${formatValue(pe.properties[k])}`)
    .join(', ');
  return `${main} {${props}}`;
}

// ---------------------------------------------------------------------------
// Identity + value formatting
// ---------------------------------------------------------------------------

function formatIdentity(type: NodeType, id: string): string {
  if (isNetAddrType(type)) return id; // e.g. @f1/c/1
  if (type === 'userport') {
    return HARDWARE_ADDR_RE.test(id) ? id : quoteString(id);
  }
  if (type === 'port') {
    if (id.includes('/')) return quoteString(id);
    return id;
  }
  if (type === 'domain' && !NODE_ID_RE.test(id)) {
    return quoteString(id);
  }
  if (NODE_ID_RE.test(id)) return id;
  return quoteString(id);
}

function formatValue(v: PropertyValue): string {
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (NET_ADDR_RE.test(v)) return v;
  if (NODE_ID_RE.test(v)) return v;
  return quoteString(v);
}

function quoteString(s: string): string {
  let out = '"';
  for (const ch of s) {
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else out += ch;
  }
  return out + '"';
}
