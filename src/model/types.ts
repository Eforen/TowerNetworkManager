/**
 * Core graph data model types per docs/specs/graphdata.md.
 *
 * Node ids are unique per `type`. The runtime key used in maps is the
 * compound `{type}:{id}` so different types may share an id.
 *
 * Network addresses (`networkaddress` ids) are validated separately from
 * `port` / `userport` / `uplink` ids in `validation.ts`.
 */

export const NODE_TYPES = [
  'player',
  'port',
  'switch',
  'router',
  'server',
  'floor',
  'rack',
  'uplink',
  'userport',
  'customer',
  'customertype',
  'rtable',
  'domain',
  'networkaddress',
  'consumerbehavior',
  'producerbehavior',
  'behaviorinsight',
  'usagetype',
  'program',
] as const;

export type NodeType = (typeof NODE_TYPES)[number];

export const CANONICAL_TAGS = [
  // Families
  'Physical',
  'Logical',
  // Roles
  'Device',
  'Network',
  'NetworkPort',
  'User',
  'Player',
  'Routing',
  'Location',
  'DomainName',
  'Behavior',
  'Insight',
  'UsageType',
  'Consumer',
  'Producer',
  'Program',
  // Specifics
  'Server',
  'Switch',
  'Router',
  'Floor',
  'Rack',
  'RJ45',
  'FiberOptic',
  'Uplink',
  'UserPort',
] as const;

export type CanonicalTag = (typeof CANONICAL_TAGS)[number];

/**
 * Tags are PascalCase strings. Canonical tags are enforced via lint but
 * any `^[A-Z][A-Za-z0-9]*$` tag is accepted (warning on non-canonical).
 */
export type Tag = CanonicalTag | (string & { __brand?: 'Tag' });

export const RELATION_NAMES = [
  'NIC',
  'Owner',
  'AssignedTo',
  'NetworkCableLinkRJ45',
  'NetworkCableLinkFiber',
  'FloorAssignment',
  'RackAssignment',
  'UplinkConnection',
  'Route',
  'Insight',
  'Consumes',
  'Provides',
  'Install',
] as const;

export type RelationName = (typeof RELATION_NAMES)[number];

export type NodeId = string;

/** Compound key used in `Map<NodeKey, Node>`. Format: `${type}:${id}`. */
export type NodeKey = string & { __brand?: 'NodeKey' };

export type PropertyValue = string | number | boolean;

export type Properties = Record<string, PropertyValue>;

export interface Node {
  id: NodeId;
  type: NodeType;
  tags: string[];
  properties: Properties;
}

/** Derived unique key for an edge, see `edges.ts#edgeId`. */
export type EdgeId = string & { __brand?: 'EdgeId' };

export interface Edge {
  id: EdgeId;
  relation: RelationName;
  /** Compound `{type}:{id}` key of source endpoint. */
  fromKey: NodeKey;
  /** Compound `{type}:{id}` key of target endpoint. */
  toKey: NodeKey;
  directed: boolean;
  strength: number;
  properties: Properties;
}

export function isCanonicalTag(tag: string): tag is CanonicalTag {
  return (CANONICAL_TAGS as readonly string[]).includes(tag);
}

export function isNodeType(value: string): value is NodeType {
  return (NODE_TYPES as readonly string[]).includes(value);
}

export function isRelationName(value: string): value is RelationName {
  return (RELATION_NAMES as readonly string[]).includes(value);
}
