/**
 * Node and edge visual tables per docs/specs/visualization.md §Node/Edge
 * visuals.
 *
 * Pure data + tiny helpers. No d3 / DOM. The renderer in `GraphView.vue`
 * reads these tables to build SVG primitives; tests exercise the
 * look-ups without touching the DOM.
 */

import type { NodeType, RelationName } from '@/model';

export type NodeShape =
  | 'circle'
  | 'square'
  | 'diamond'
  | 'hexagon'
  | 'roundedRect'
  | 'pill'
  | 'pillNumber'
  | 'cloud';

export type FillFamily =
  | 'physical'
  | 'logical'
  | 'behavior'
  | 'usage'
  | 'program'
  | 'player'
  | 'customer'
  | 'floor'
  | 'rack';

export interface NodeVisual {
  shape: NodeShape;
  /** Radius for circles / half-side for squares/diamonds/hexagons. */
  radius: number;
  family: FillFamily;
}

export const NODE_VISUALS: Record<NodeType, NodeVisual> = {
  server:           { shape: 'square',       radius: 10, family: 'physical' },
  router:           { shape: 'hexagon',      radius: 10, family: 'physical' },
  switch:           { shape: 'diamond',      radius: 10, family: 'physical' },
  port:             { shape: 'circle',       radius: 4,  family: 'physical' },
  userport:         { shape: 'circle',       radius: 4,  family: 'customer' },
  uplink:           { shape: 'circle',       radius: 5,  family: 'physical' },
  floor:            { shape: 'roundedRect',  radius: 16, family: 'floor' },
  rack:             { shape: 'roundedRect',  radius: 14, family: 'rack' },
  customer:         { shape: 'circle',       radius: 9,  family: 'customer' },
  player:           { shape: 'circle',       radius: 10, family: 'player' },
  customertype:     { shape: 'roundedRect',  radius: 10, family: 'customer' },
  rtable:           { shape: 'roundedRect',  radius: 10, family: 'logical' },
  domain:           { shape: 'pill',         radius: 10, family: 'logical' },
  networkaddress:   { shape: 'pill',         radius: 8,  family: 'logical' },
  consumerbehavior: { shape: 'pill',         radius: 12, family: 'behavior' },
  producerbehavior: { shape: 'pill',         radius: 12, family: 'behavior' },
  behaviorinsight:  { shape: 'pillNumber',   radius: 10, family: 'behavior' },
  usagetype:        { shape: 'cloud',        radius: 8,  family: 'usage' },
  program:          { shape: 'roundedRect',  radius: 8,  family: 'program' },
};

export function nodeRadius(type: NodeType): number {
  return NODE_VISUALS[type]?.radius ?? 6;
}

export function nodeShape(type: NodeType): NodeShape {
  return NODE_VISUALS[type]?.shape ?? 'circle';
}

export function nodeFamily(type: NodeType): FillFamily {
  return NODE_VISUALS[type]?.family ?? 'logical';
}

/** CSS variable name that the family maps to; defined in styles/variables.css. */
export function fillVar(family: FillFamily): string {
  switch (family) {
    case 'physical':  return '--tni-phys';
    case 'logical':   return '--tni-log';
    case 'behavior':  return '--tni-log-behavior';
    case 'usage':     return '--tni-log-usage';
    case 'program':   return '--tni-log-program';
    case 'customer':  return '--tni-customer';
    case 'player':    return '--tni-player';
    case 'floor':     return '--tni-floor';
    case 'rack':      return '--tni-rack';
  }
}

// ---------------------------------------------------------------------
// Edge visuals
// ---------------------------------------------------------------------

export type EdgeDashStyle = 'solid' | 'dashed' | 'dotted';

export interface EdgeVisual {
  /** CSS variable name for stroke color. */
  strokeVar: string;
  dash: EdgeDashStyle;
  /** Base stroke-width before inverse-strength scaling. */
  baseWidth: number;
  arrowhead: boolean;
}

export const EDGE_VISUALS: Record<RelationName, EdgeVisual> = {
  NIC:                  { strokeVar: '--tni-edge-nic',         dash: 'solid',  baseWidth: 1.5, arrowhead: true },
  Owner:                { strokeVar: '--tni-edge-owner',       dash: 'dashed', baseWidth: 1.5, arrowhead: true },
  AssignedTo:           { strokeVar: '--tni-edge-assigned',    dash: 'dashed', baseWidth: 1.2, arrowhead: true },
  NetworkCableLinkRJ45: { strokeVar: '--tni-edge-cable-rj45',  dash: 'solid',  baseWidth: 2.0, arrowhead: false },
  NetworkCableLinkFiber:{ strokeVar: '--tni-edge-cable-fiber', dash: 'solid',  baseWidth: 2.0, arrowhead: false },
  FloorAssignment:      { strokeVar: '--tni-edge-floor',    dash: 'dashed', baseWidth: 1.0, arrowhead: true },
  RackAssignment:       { strokeVar: '--tni-edge-rack',     dash: 'dashed', baseWidth: 1.0, arrowhead: true },
  UplinkConnection:     { strokeVar: '--tni-edge-uplink',   dash: 'solid',  baseWidth: 2.5, arrowhead: false },
  Route:                { strokeVar: '--tni-edge-route',    dash: 'dashed', baseWidth: 1.0, arrowhead: true },
  Insight:              { strokeVar: '--tni-edge-insight',  dash: 'dashed', baseWidth: 1.0, arrowhead: true },
  Consumes:             { strokeVar: '--tni-edge-consumes', dash: 'dotted', baseWidth: 1.0, arrowhead: true },
  Provides:             { strokeVar: '--tni-edge-provides', dash: 'dotted', baseWidth: 1.0, arrowhead: true },
  Install:              { strokeVar: '--tni-edge-install',  dash: 'solid',  baseWidth: 3.0, arrowhead: true },
};

export function edgeStroke(relation: RelationName): string {
  return EDGE_VISUALS[relation]?.strokeVar ?? '--tni-edge-default';
}

export function edgeDashArray(dash: EdgeDashStyle): string | undefined {
  switch (dash) {
    case 'solid':  return undefined;
    case 'dashed': return '6 4';
    case 'dotted': return '2 3';
  }
}

/** Stroke width = baseWidth / max(strength, 0.5). */
export function edgeWidth(relation: RelationName, strength: number): number {
  const v = EDGE_VISUALS[relation];
  const base = v?.baseWidth ?? 1;
  return base / Math.max(strength, 0.5);
}
