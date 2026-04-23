/**
 * Default tag sets and property defaults per node type.
 * Sourced from docs/specs/graphdata.md "Node types" section.
 */

import type { NodeType, Properties } from './types';

/**
 * Tags applied automatically when a node is created of this type. Authors
 * may add more; these may not be removed without changing the node's type.
 */
export const DEFAULT_TAGS_BY_TYPE: Record<NodeType, readonly string[]> = {
  player: ['Logical', 'Player', 'User'],
  port: ['Physical', 'NetworkPort'],
  userport: ['Physical', 'NetworkPort'],
  uplink: ['Physical', 'NetworkPort', 'Uplink'],
  switch: ['Physical', 'Device', 'Network', 'Switch'],
  router: ['Physical', 'Device', 'Network', 'Router'],
  server: ['Physical', 'Device', 'Server'],
  floor: ['Physical', 'Location', 'Floor'],
  rack: ['Physical', 'Location', 'Rack'],
  customer: ['Logical', 'User'],
  customertype: ['Logical', 'User'],
  rtable: ['Logical', 'Routing'],
  domain: ['Logical', 'DomainName'],
  networkaddress: ['Logical'],
  consumerbehavior: ['Logical', 'Behavior', 'Consumer'],
  producerbehavior: ['Logical', 'Behavior', 'Producer'],
  behaviorinsight: ['Logical', 'Behavior', 'Insight'],
  usagetype: ['Logical', 'UsageType'],
  program: ['Logical', 'Program'],
};

/**
 * Default numeric/string properties for freshly created nodes. Per the
 * spec, "the save file wins" — these defaults only apply if not set.
 */
export const DEFAULT_PROPERTIES_BY_TYPE: Partial<Record<NodeType, Properties>> =
  {
    switch: { traversalsPerTick: 1000 },
    router: { traversalsPerTick: 500 },
    server: {
      traversalsPerTick: 200,
      cpuTotal: 8,
      memoryTotal: 8,
      storageTotal: 16,
    },
    behaviorinsight: { bandwidthPerTick: 1, activeProbability: 1.0 },
  };

/** Merge provided tags with type defaults; dedupes, preserves input order. */
export function mergeDefaultTags(
  type: NodeType,
  tags: readonly string[] = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of DEFAULT_TAGS_BY_TYPE[type] ?? []) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  for (const t of tags) {
    if (!seen.has(t)) {
      seen.add(t);
      out.push(t);
    }
  }
  return out;
}

/** Merge provided properties with type defaults (provided wins). */
export function mergeDefaultProperties(
  type: NodeType,
  props: Properties = {},
): Properties {
  return { ...(DEFAULT_PROPERTIES_BY_TYPE[type] ?? {}), ...props };
}
