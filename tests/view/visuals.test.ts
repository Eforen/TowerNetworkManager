import { describe, expect, it } from 'vitest';
import { NODE_TYPES, RELATION_NAMES } from '@/model';
import {
  EDGE_VISUALS,
  NODE_VISUALS,
  edgeDashArray,
  edgeStroke,
  edgeWidth,
  fillVar,
  nodeFamily,
  nodeRadius,
  nodeShape,
} from '@/view';

describe('node visuals', () => {
  it('maps every node type', () => {
    for (const t of NODE_TYPES) {
      expect(NODE_VISUALS[t]).toBeTruthy();
      expect(nodeRadius(t)).toBeGreaterThan(0);
      expect(nodeShape(t)).toBeTruthy();
      expect(fillVar(nodeFamily(t))).toMatch(/^--tni-/);
    }
  });

  it('uses a square for server and hexagon for router', () => {
    expect(nodeShape('server')).toBe('square');
    expect(nodeShape('router')).toBe('hexagon');
    expect(nodeShape('switch')).toBe('diamond');
    expect(nodeShape('port')).toBe('circle');
  });

  it('ports are smaller than devices', () => {
    expect(nodeRadius('port')).toBeLessThan(nodeRadius('server'));
  });
});

describe('edge visuals', () => {
  it('maps every relation', () => {
    for (const r of RELATION_NAMES) {
      expect(EDGE_VISUALS[r]).toBeTruthy();
      expect(edgeStroke(r)).toMatch(/^--tni-edge/);
    }
  });

  it('directed edges have arrowheads, cable links do not', () => {
    expect(EDGE_VISUALS['Owner'].arrowhead).toBe(true);
    expect(EDGE_VISUALS['NetworkCableLinkRJ45'].arrowhead).toBe(false);
    expect(EDGE_VISUALS['NetworkCableLinkFiber'].arrowhead).toBe(false);
  });

  it('Consumes and Provides are dotted', () => {
    expect(EDGE_VISUALS['Consumes'].dash).toBe('dotted');
    expect(EDGE_VISUALS['Provides'].dash).toBe('dotted');
  });

  it('dash array maps are well-formed', () => {
    expect(edgeDashArray('solid')).toBeUndefined();
    expect(edgeDashArray('dashed')).toMatch(/\d+ \d+/);
    expect(edgeDashArray('dotted')).toMatch(/\d+ \d+/);
  });

  it('width inversely tracks strength', () => {
    const wStrong = edgeWidth('NIC', 3);
    const wWeak = edgeWidth('NIC', 0.5);
    expect(wWeak).toBeGreaterThan(wStrong);
  });
});
