/**
 * Graph validation per docs/specs/graphdata.md §Validation rules.
 *
 * `validate(graph)` returns `{ errors, warnings }` without mutating the
 * graph. Errors are model-level violations (dangling edges, type
 * mismatches, bad numeric fields); warnings are lint-only (non-canonical
 * tags, unknown usage type ids, etc.).
 */

import { Graph } from './graph';
import {
  HARDWARE_ADDR_RE,
  NET_ADDR_RE,
  PORT_SLUG_RE,
  isNetAddrType,
  parseNodeKey,
} from './ids';
import { RELATION_META } from './relations';
import { CANONICAL_TAGS, type Edge, type Node } from './types';

export type IssueSeverity = 'error' | 'warning';

export interface ValidationIssue {
  severity: IssueSeverity;
  code: string;
  message: string;
  nodeKey?: string;
  edgeId?: string;
}

export interface ValidationReport {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export function validate(graph: Graph): ValidationReport {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  for (const node of graph.nodes.values()) {
    validateNode(graph, node, errors, warnings);
  }

  validateNetAddressUniqueness(graph, errors);
  validatePortConnectivity(graph, warnings);

  for (const edge of graph.edges.values()) {
    validateEdge(graph, edge, errors);
  }

  validateAssignedToUniqueness(graph, errors);

  return { errors, warnings };
}

function validateNode(
  _graph: Graph,
  node: Node,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const key = `${node.type}:${node.id}`;

  if (node.type === 'server') {
    checkNonNegativeInt(node, 'cpuTotal', errors);
    checkNonNegativeInt(node, 'memoryTotal', errors);
    checkNonNegativeInt(node, 'storageTotal', errors);
    checkNonNegativeInt(node, 'traversalsPerTick', errors);
    checkHardwareAddress(node, errors);
  }
  if (node.type === 'switch' || node.type === 'router') {
    checkNonNegativeInt(node, 'traversalsPerTick', errors);
    checkHardwareAddress(node, errors);
  }
  if (node.type === 'program') {
    for (const key of ['cpu', 'memory', 'storage']) {
      const v = node.properties[key];
      if (v === undefined) {
        errors.push({
          severity: 'error',
          code: 'program.missingResource',
          message: `program[${node.id}] missing required property ${key}`,
          nodeKey: `${node.type}:${node.id}`,
        });
      } else {
        checkNonNegativeInt(node, key, errors);
      }
    }
  }
  if (node.type === 'behaviorinsight') {
    const bw = node.properties.bandwidthPerTick;
    if (bw !== undefined) {
      if (typeof bw !== 'number' || !Number.isInteger(bw) || bw < 0) {
        errors.push({
          severity: 'error',
          code: 'behaviorinsight.badBandwidth',
          message: `behaviorinsight[${node.id}].bandwidthPerTick must be a non-negative integer`,
          nodeKey: key,
        });
      }
    }
    const p = node.properties.activeProbability;
    if (p !== undefined) {
      if (typeof p !== 'number' || p < 0 || p > 1) {
        errors.push({
          severity: 'error',
          code: 'behaviorinsight.badProbability',
          message: `behaviorinsight[${node.id}].activeProbability must be in [0,1]`,
          nodeKey: key,
        });
      }
    }
  }

  for (const tag of node.tags) {
    if (!(CANONICAL_TAGS as readonly string[]).includes(tag)) {
      if (!/^[A-Z][A-Za-z0-9]*$/.test(tag)) {
        errors.push({
          severity: 'error',
          code: 'tag.malformed',
          message: `${node.type}[${node.id}] has malformed tag ${JSON.stringify(tag)}`,
          nodeKey: key,
        });
      } else {
        warnings.push({
          severity: 'warning',
          code: 'tag.nonCanonical',
          message: `${node.type}[${node.id}] uses non-canonical tag ${tag}`,
          nodeKey: key,
        });
      }
    }
  }

  // Media tag sanity: port + uplink must carry exactly one of RJ45/FiberOptic.
  if (node.type === 'port' || node.type === 'uplink') {
    const rj = node.tags.includes('RJ45');
    const fo = node.tags.includes('FiberOptic');
    if (!rj && !fo) {
      errors.push({
        severity: 'error',
        code: 'port.noMedia',
        message: `${node.type}[${node.id}] must carry RJ45 or FiberOptic tag`,
        nodeKey: key,
      });
    } else if (rj && fo) {
      errors.push({
        severity: 'error',
        code: 'port.dualMedia',
        message: `${node.type}[${node.id}] cannot carry both RJ45 and FiberOptic`,
        nodeKey: key,
      });
    }
  }

  // Port id shape depends on UserPort-ness.
  if (node.type === 'port') {
    const isUser = node.tags.includes('UserPort');
    if (isUser) {
      if (!HARDWARE_ADDR_RE.test(node.id)) {
        errors.push({
          severity: 'error',
          code: 'port.userIdNotHardware',
          message: `UserPort port[${node.id}] id must be a 1..5 digit hardware address`,
          nodeKey: key,
        });
      }
    } else {
      if (!PORT_SLUG_RE.test(node.id)) {
        errors.push({
          severity: 'error',
          code: 'port.deviceIdMalformed',
          message: `device port[${node.id}] id must be 'port' + digits (e.g. port0, port1)`,
          nodeKey: key,
        });
      }
    }
  }
}

function checkHardwareAddress(node: Node, errors: ValidationIssue[]): void {
  const v = node.properties['hardwareAddress'];
  if (v === undefined) return;
  const s = String(v);
  if (!HARDWARE_ADDR_RE.test(s)) {
    errors.push({
      severity: 'error',
      code: 'device.badHardwareAddress',
      message: `${node.type}[${node.id}].hardwareAddress must be 1..5 numeric digits`,
      nodeKey: `${node.type}:${node.id}`,
    });
  }
}

function validateEdge(
  graph: Graph,
  edge: Edge,
  errors: ValidationIssue[],
): void {
  const meta = RELATION_META[edge.relation];
  if (!meta) return;

  const from = graph.nodes.get(edge.fromKey);
  const to = graph.nodes.get(edge.toKey);
  if (!from || !to) {
    errors.push({
      severity: 'error',
      code: 'edge.dangling',
      message: `edge ${edge.id} references missing endpoint`,
      edgeId: edge.id,
    });
    return;
  }

  const fromType = from.type;
  const toType = to.type;

  const allowed = meta.pairs.some(([a, b]) => {
    if (a === fromType && b === toType) return true;
    if (!meta.directed && a === toType && b === fromType) return true;
    return false;
  });
  if (!allowed) {
    errors.push({
      severity: 'error',
      code: 'edge.badEndpoints',
      message: `${edge.relation} ${fromType}->${toType} is not an allowed pair`,
      edgeId: edge.id,
    });
    return;
  }

  switch (edge.relation) {
    case 'NIC':
      if (!to.tags.includes('NetworkPort')) {
        errors.push({
          severity: 'error',
          code: 'nic.targetNotPort',
          message: `NIC target ${to.type}[${to.id}] must carry tag NetworkPort`,
          edgeId: edge.id,
        });
      }
      if (to.tags.includes('UserPort')) {
        errors.push({
          severity: 'error',
          code: 'nic.targetIsUserPort',
          message: `NIC target ${to.type}[${to.id}] is a UserPort; NIC connects device-side ports only`,
          edgeId: edge.id,
        });
      }
      break;
    case 'NetworkCableLinkRJ45':
      requireSharedTag(edge, from, to, 'RJ45', errors);
      break;
    case 'NetworkCableLinkFiber':
      requireSharedTag(edge, from, to, 'FiberOptic', errors);
      break;
    case 'UplinkConnection': {
      if (from.type !== 'uplink' || to.type !== 'uplink') {
        errors.push({
          severity: 'error',
          code: 'uplink.notUplink',
          message: `UplinkConnection endpoints must both be uplink nodes`,
          edgeId: edge.id,
        });
        break;
      }
      const media = ['RJ45', 'FiberOptic'] as const;
      const shared = media.some(
        (m) => from.tags.includes(m) && to.tags.includes(m),
      );
      if (!shared) {
        errors.push({
          severity: 'error',
          code: 'uplink.mediaMismatch',
          message: `UplinkConnection endpoints must share RJ45 or FiberOptic`,
          edgeId: edge.id,
        });
      }
      break;
    }
    case 'FloorAssignment':
      if (from.type !== 'floor') {
        errors.push({
          severity: 'error',
          code: 'floor.badFrom',
          message: `FloorAssignment.from must be a floor node`,
          edgeId: edge.id,
        });
      }
      break;
    case 'RackAssignment':
      if (from.type !== 'rack') {
        errors.push({
          severity: 'error',
          code: 'rack.badFrom',
          message: `RackAssignment.from must be a rack node`,
          edgeId: edge.id,
        });
      }
      break;
    case 'Install':
      if (from.type !== 'server' || to.type !== 'program') {
        errors.push({
          severity: 'error',
          code: 'install.badEndpoints',
          message: `Install must be server -> program`,
          edgeId: edge.id,
        });
      }
      break;
    case 'Insight':
      if (
        from.type !== 'consumerbehavior' &&
        from.type !== 'producerbehavior'
      ) {
        errors.push({
          severity: 'error',
          code: 'insight.badFrom',
          message: `Insight.from must be a Behavior node`,
          edgeId: edge.id,
        });
      }
      if (to.type !== 'behaviorinsight') {
        errors.push({
          severity: 'error',
          code: 'insight.badTo',
          message: `Insight.to must be a behaviorinsight`,
          edgeId: edge.id,
        });
      }
      break;
    case 'Owner': {
      // Owner to a port: the port must carry the UserPort tag
      // (customer/player can only own user-facing ports).
      if (
        (from.type === 'customer' || from.type === 'player') &&
        to.type === 'port' &&
        !to.tags.includes('UserPort')
      ) {
        errors.push({
          severity: 'error',
          code: 'owner.portNotUserPort',
          message: `Owner ${from.type}->port requires UserPort tag on port[${to.id}]`,
          edgeId: edge.id,
        });
      }
      break;
    }
    case 'Consumes':
    case 'Provides':
      validateConsumesProvides(graph, edge, from, errors);
      break;
    default:
      break;
  }

  // `required` must be a non-negative number when present.
  if (edge.relation === 'Consumes' || edge.relation === 'Provides') {
    const req = edge.properties.required;
    if (req !== undefined) {
      if (typeof req !== 'number' || req < 0) {
        errors.push({
          severity: 'error',
          code: 'edge.badRequired',
          message: `${edge.relation}.required must be a non-negative number`,
          edgeId: edge.id,
        });
      }
    }
    const amount = edge.properties.amount;
    if (amount !== undefined) {
      if (typeof amount !== 'number' || amount < 0) {
        errors.push({
          severity: 'error',
          code: 'edge.badAmount',
          message: `${edge.relation}.amount must be a non-negative number`,
          edgeId: edge.id,
        });
      }
    }
  }
}

function validateConsumesProvides(
  _graph: Graph,
  edge: Edge,
  from: Node,
  errors: ValidationIssue[],
): void {
  // When `pool` is present and the source is a program, the program must
  // declare `pool.<direction>.<name>` as a property.
  const poolName = edge.properties.pool;
  if (poolName !== undefined && from.type === 'program') {
    if (typeof poolName !== 'string') {
      errors.push({
        severity: 'error',
        code: 'pool.badName',
        message: `${edge.relation}.pool must be a string`,
        edgeId: edge.id,
      });
      return;
    }
    const direction = edge.relation === 'Consumes' ? 'consume' : 'provide';
    const key = `pool.${direction}.${poolName}`;
    if (from.properties[key] === undefined) {
      errors.push({
        severity: 'error',
        code: 'pool.undeclared',
        message: `program[${from.id}] references pool ${poolName} without declaring ${key}`,
        edgeId: edge.id,
      });
    } else {
      const v = from.properties[key];
      if (typeof v !== 'number' || v < 0) {
        errors.push({
          severity: 'error',
          code: 'pool.badTotal',
          message: `program[${from.id}].${key} must be a non-negative number`,
          edgeId: edge.id,
        });
      }
    }
  }
}

function validateNetAddressUniqueness(
  graph: Graph,
  errors: ValidationIssue[],
): void {
  const seen = new Map<string, string>();
  for (const [key, node] of graph.nodes) {
    if (!isNetAddrType(node.type)) continue;
    if (!NET_ADDR_RE.test(node.id)) {
      errors.push({
        severity: 'error',
        code: 'netAddr.invalid',
        message: `${node.type}[${node.id}] is not a valid network address`,
        nodeKey: key,
      });
      continue;
    }
    const prior = seen.get(node.id);
    if (prior && prior !== key) {
      errors.push({
        severity: 'error',
        code: 'netAddr.duplicate',
        message: `network address ${node.id} used by both ${prior} and ${key}`,
        nodeKey: key,
      });
    } else {
      seen.set(node.id, key);
    }
  }
}

/**
 * Warn on ports that are "dangling":
 *   - non-UserPort devices ports without a `NIC` edge from any device, and
 *   - UserPorts without any `NetworkCableLink*` edge (customer has no patch).
 */
function validatePortConnectivity(
  graph: Graph,
  warnings: ValidationIssue[],
): void {
  for (const [key, node] of graph.nodes) {
    if (node.type !== 'port') continue;
    const isUser = node.tags.includes('UserPort');
    let hasNic = false;
    let hasCable = false;
    for (const edge of graph.edgesOf(node.type, node.id)) {
      if (edge.relation === 'NIC' && edge.toKey === key) hasNic = true;
      if (
        edge.relation === 'NetworkCableLinkRJ45' ||
        edge.relation === 'NetworkCableLinkFiber'
      ) {
        hasCable = true;
      }
    }
    if (isUser && !hasCable) {
      warnings.push({
        severity: 'warning',
        code: 'port.userUncabled',
        message: `UserPort port[${node.id}] has no NetworkCableLink* edge`,
        nodeKey: key,
      });
    }
    if (!isUser && !hasNic) {
      warnings.push({
        severity: 'warning',
        code: 'port.deviceNoNic',
        message: `port[${node.id}] has no NIC edge from a device`,
        nodeKey: key,
      });
    }
  }
}

/**
 * A `networkaddress` can only be assigned to one holder at a time — declaring
 * two `AssignedTo` edges from the same address is an error.
 */
function validateAssignedToUniqueness(
  graph: Graph,
  errors: ValidationIssue[],
): void {
  const fromCount = new Map<string, string[]>();
  for (const edge of graph.edges.values()) {
    if (edge.relation !== 'AssignedTo') continue;
    const list = fromCount.get(edge.fromKey) ?? [];
    list.push(edge.id);
    fromCount.set(edge.fromKey, list);
  }
  for (const [fromKey, ids] of fromCount) {
    if (ids.length > 1) {
      for (const edgeId of ids) {
        errors.push({
          severity: 'error',
          code: 'assignedTo.duplicate',
          message: `networkaddress ${fromKey} has ${ids.length} AssignedTo edges; only one allowed`,
          edgeId,
        });
      }
    }
  }
}

function requireSharedTag(
  edge: Edge,
  from: Node,
  to: Node,
  tag: string,
  errors: ValidationIssue[],
): void {
  if (!from.tags.includes(tag) || !to.tags.includes(tag)) {
    errors.push({
      severity: 'error',
      code: 'cable.mediaMismatch',
      message: `${edge.relation} requires both endpoints to carry tag ${tag}`,
      edgeId: edge.id,
    });
  }
}

function checkNonNegativeInt(
  node: Node,
  key: string,
  errors: ValidationIssue[],
): void {
  const v = node.properties[key];
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
    errors.push({
      severity: 'error',
      code: 'property.notNonNegInt',
      message: `${node.type}[${node.id}].${key} must be a non-negative integer`,
      nodeKey: `${node.type}:${node.id}`,
    });
  }
}

// Keeps parseNodeKey exported for test convenience.
export { parseNodeKey };
