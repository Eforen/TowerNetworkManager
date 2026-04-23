import { describe, it, expect } from 'vitest';
import { Graph } from '@/model/graph';

describe('indices: byType and byTag', () => {
  it('tracks nodes by type', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'a' });
    g.addNode({ type: 'server', id: 'b' });
    g.addNode({ type: 'switch', id: 'sw1' });
    expect(g.nodesOfType('server').map((n) => n.id).sort()).toEqual([
      'a',
      'b',
    ]);
    expect(g.nodesOfType('switch').map((n) => n.id)).toEqual(['sw1']);
  });

  it('tracks nodes by tag', () => {
    const g = new Graph();
    g.addNode({ type: 'port', id: '12345', tags: ['RJ45', 'UserPort'] });
    g.addNode({ type: 'port', id: 'sw1/port0', tags: ['RJ45'] });
    expect(g.nodesWithTag('UserPort').map((n) => n.id)).toEqual(['12345']);
    expect(g.nodesWithTag('RJ45').map((n) => n.id).sort()).toEqual([
      '12345',
      'sw1/port0',
    ]);
  });

  it('updates byTag on updateNode', () => {
    const g = new Graph();
    g.addNode({ type: 'port', id: '12345', tags: ['RJ45'] });
    expect(g.nodesWithTag('UserPort')).toHaveLength(0);
    g.updateNode('port', '12345', { tags: ['RJ45', 'UserPort'] });
    expect(g.nodesWithTag('UserPort').map((n) => n.id)).toEqual(['12345']);
  });
});

describe('indices: floorOf', () => {
  it('derives level from floor id pattern f<N>', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'f3' });
    g.addNode({ type: 'server', id: 'db01' });
    g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'f3' },
      to: { type: 'server', id: 'db01' },
    });
    expect(g.floorOf('server', 'db01')).toBe(3);
  });

  it('uses explicit floor.level property over id', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'basement', properties: { level: 0 } });
    g.addNode({ type: 'server', id: 'db01' });
    g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'basement' },
      to: { type: 'server', id: 'db01' },
    });
    expect(g.floorOf('server', 'db01')).toBe(0);
  });

  it('inherits floor transitively through a rack', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'f2' });
    g.addNode({ type: 'rack', id: 'r1' });
    g.addNode({ type: 'server', id: 'db01' });
    g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'f2' },
      to: { type: 'rack', id: 'r1' },
    });
    g.addEdge({
      relation: 'RackAssignment',
      from: { type: 'rack', id: 'r1' },
      to: { type: 'server', id: 'db01' },
    });
    expect(g.floorOf('rack', 'r1')).toBe(2);
    expect(g.floorOf('server', 'db01')).toBe(2);
  });

  it('returns undefined for unassigned nodes', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    expect(g.floorOf('server', 'db01')).toBeUndefined();
  });

  it('invalidates on edge mutation', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'f1' });
    g.addNode({ type: 'server', id: 'db01' });
    expect(g.floorOf('server', 'db01')).toBeUndefined();
    const e = g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'f1' },
      to: { type: 'server', id: 'db01' },
    });
    expect(g.floorOf('server', 'db01')).toBe(1);
    g.removeEdge(e.id);
    expect(g.floorOf('server', 'db01')).toBeUndefined();
  });
});

describe('indices: adjacency', () => {
  it('incrementally maintained on add/remove', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    g.addNode({ type: 'port', id: 'db01/port0', tags: ['RJ45'] });
    const e = g.addEdge({
      relation: 'NIC',
      from: { type: 'server', id: 'db01' },
      to: { type: 'port', id: 'db01/port0' },
    });
    expect(g.edgesOf('server', 'db01')).toHaveLength(1);
    g.removeEdge(e.id);
    expect(g.edgesOf('server', 'db01')).toHaveLength(0);
    expect(g.edgesOf('port', 'db01/port0')).toHaveLength(0);
  });
});
