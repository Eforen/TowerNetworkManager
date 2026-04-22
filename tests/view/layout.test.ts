import { describe, expect, it } from 'vitest';
import { Graph } from '@/model';
import { GraphLayout, FLOOR_SPACING } from '@/view';

function makeGraph(): Graph {
  const g = new Graph();
  g.addNode({ type: 'floor', id: 'f1' });
  g.addNode({ type: 'rack', id: 'r1' });
  g.addNode({ type: 'server', id: 'db01' });
  g.addNode({ type: 'switch', id: 'sw1' });
  g.addEdge({
    relation: 'FloorAssignment',
    from: { type: 'floor', id: 'f1' },
    to: { type: 'rack', id: 'r1' },
  });
  g.addEdge({
    relation: 'RackAssignment',
    from: { type: 'rack', id: 'r1' },
    to: { type: 'server', id: 'db01' },
  });
  g.addEdge({
    relation: 'RackAssignment',
    from: { type: 'rack', id: 'r1' },
    to: { type: 'switch', id: 'sw1' },
  });
  return g;
}

describe('GraphLayout', () => {
  it('builds SimNode/SimLink arrays from a graph', () => {
    const l = new GraphLayout();
    l.setGraph(makeGraph());
    expect(l.nodes().length).toBe(4);
    expect(l.links().length).toBe(3);
    l.destroy();
  });

  it('preserves x/y/fx/fy across rebuilds', () => {
    const l = new GraphLayout();
    const g = makeGraph();
    l.setGraph(g);
    const first = l.nodes().find((n) => n.id === 'server:db01');
    if (first) { first.x = 42; first.y = -17; first.fx = 42; first.fy = -17; }
    l.setGraph(g);
    const second = l.nodes().find((n) => n.id === 'server:db01');
    expect(second?.x).toBe(42);
    expect(second?.y).toBe(-17);
    expect(second?.fx).toBe(42);
    l.destroy();
  });

  it('assigns floor index to assignable nodes', () => {
    const l = new GraphLayout();
    l.setGraph(makeGraph());
    const rack = l.nodes().find((n) => n.id === 'rack:r1');
    expect(rack?.floor).toBe(1);
    l.destroy();
  });

  it('switches layout mode without throwing', () => {
    const l = new GraphLayout();
    l.setGraph(makeGraph());
    expect(l.getMode()).toBe('force');
    l.setMode('floor');
    expect(l.getMode()).toBe('floor');
    l.setMode('force');
    expect(l.getMode()).toBe('force');
    l.destroy();
  });

  it('exposes FLOOR_SPACING constant', () => {
    expect(FLOOR_SPACING).toBeGreaterThan(0);
  });
});
