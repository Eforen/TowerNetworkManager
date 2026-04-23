/**
 * Relationship metadata per docs/specs/graphdata.md §Relationships.
 *
 * Each `RelationMeta` captures the constant properties of an edge type:
 * directionality, visual strength, and the allowed (fromType, toType)
 * endpoint pairs. Pair-wise extra constraints (e.g. matching media tags
 * on cable links) are enforced in `validation.ts`.
 */

import type { NodeType, RelationName } from './types';

/** Undirected cable endpoints: device `port`, customer `userport`, `uplink`. */
const NETWORK_CABLE_PAIRS: ReadonlyArray<readonly [NodeType, NodeType]> = (() => {
  const kinds: NodeType[] = ['port', 'userport', 'uplink'];
  const out: [NodeType, NodeType][] = [];
  for (const a of kinds) {
    for (const b of kinds) {
      out.push([a, b]);
    }
  }
  return out;
})();

export interface RelationMeta {
  name: RelationName;
  directed: boolean;
  strength: number;
  /**
   * Allowed (fromType, toType) pairs. For undirected relations the ordering
   * is still listed here for documentation; validation treats either
   * ordering as valid.
   */
  pairs: ReadonlyArray<readonly [NodeType, NodeType]>;
  /** Optional edge property keys recognized by the app. */
  edgeProperties?: readonly string[];
}

const consumesProvidesPairs: ReadonlyArray<readonly [NodeType, NodeType]> = [
  ['behaviorinsight', 'usagetype'],
  ['domain', 'usagetype'],
  ['program', 'usagetype'],
];

export const RELATION_META: Record<RelationName, RelationMeta> = {
  NIC: {
    name: 'NIC',
    directed: true,
    strength: 0.5,
    pairs: [
      ['server', 'port'],
      ['switch', 'port'],
      ['router', 'port'],
      ['server', 'uplink'],
      ['switch', 'uplink'],
      ['router', 'uplink'],
    ],
  },
  Owner: {
    name: 'Owner',
    directed: true,
    strength: 4,
    pairs: [
      ['customer', 'userport'],
      ['customer', 'domain'],
      ['customer', 'customertype'],
      ['customer', 'consumerbehavior'],
      ['customer', 'producerbehavior'],
      ['player', 'userport'],
      ['player', 'domain'],
      ['player', 'customertype'],
      ['player', 'consumerbehavior'],
      ['player', 'producerbehavior'],
      ['router', 'rtable'],
    ],
  },
  AssignedTo: {
    name: 'AssignedTo',
    directed: true,
    strength: 3,
    pairs: [
      ['networkaddress', 'server'],
      ['networkaddress', 'router'],
      ['networkaddress', 'switch'],
      ['networkaddress', 'port'],
      ['networkaddress', 'userport'],
      ['networkaddress', 'uplink'],
      ['networkaddress', 'customer'],
      ['networkaddress', 'player'],
    ],
  },
  NetworkCableLinkRJ45: {
    name: 'NetworkCableLinkRJ45',
    directed: false,
    strength: 1.5,
    pairs: NETWORK_CABLE_PAIRS,
    edgeProperties: ['linkCapacity'],
  },
  NetworkCableLinkFiber: {
    name: 'NetworkCableLinkFiber',
    directed: false,
    strength: 1.0,
    pairs: NETWORK_CABLE_PAIRS,
    edgeProperties: ['linkCapacity'],
  },
  FloorAssignment: {
    name: 'FloorAssignment',
    directed: true,
    strength: 3,
    pairs: [
      ['floor', 'server'],
      ['floor', 'switch'],
      ['floor', 'router'],
      ['floor', 'rack'],
      ['floor', 'port'],
      ['floor', 'userport'],
      ['floor', 'uplink'],
      ['floor', 'customer'],
    ],
  },
  RackAssignment: {
    name: 'RackAssignment',
    directed: true,
    strength: 2,
    pairs: [
      ['rack', 'server'],
      ['rack', 'switch'],
      ['rack', 'router'],
    ],
  },
  UplinkConnection: {
    name: 'UplinkConnection',
    directed: false,
    strength: 5,
    pairs: [['uplink', 'uplink']],
    edgeProperties: ['linkCapacity'],
  },
  Route: {
    name: 'Route',
    directed: true,
    strength: 2.5,
    pairs: [
      ['rtable', 'rtable'],
      ['rtable', 'port'],
      ['rtable', 'userport'],
      ['rtable', 'uplink'],
      ['rtable', 'networkaddress'],
    ],
    edgeProperties: ['target'],
  },
  Insight: {
    name: 'Insight',
    directed: true,
    strength: 2.0,
    pairs: [
      ['consumerbehavior', 'behaviorinsight'],
      ['producerbehavior', 'behaviorinsight'],
    ],
  },
  Consumes: {
    name: 'Consumes',
    directed: true,
    strength: 3.0,
    pairs: consumesProvidesPairs,
    edgeProperties: ['required', 'amount', 'pool'],
  },
  Provides: {
    name: 'Provides',
    directed: true,
    strength: 3.0,
    pairs: consumesProvidesPairs,
    edgeProperties: ['required', 'amount', 'pool'],
  },
  Install: {
    name: 'Install',
    directed: true,
    strength: 1.5,
    pairs: [['server', 'program']],
    edgeProperties: ['instance'],
  },
};

/**
 * Return all relation names that accept the given (fromType, toType) pair.
 * Used by the `link` shorthand command and the file-format parser for
 * inferring omitted `:RelationName` tokens.
 */
export function relationsForPair(
  fromType: NodeType,
  toType: NodeType,
): RelationName[] {
  const out: RelationName[] = [];
  for (const meta of Object.values(RELATION_META)) {
    for (const [a, b] of meta.pairs) {
      if (a === fromType && b === toType) {
        out.push(meta.name);
        break;
      }
      if (!meta.directed && a === toType && b === fromType) {
        out.push(meta.name);
        break;
      }
    }
  }
  return out;
}
