import { describe, it, expect } from 'vitest';
import { Graph, GraphStructureError } from '@/model/graph';

describe('Graph.addNode', () => {
  it('applies default tags per type', () => {
    const g = new Graph();
    const sw = g.addNode({ type: 'switch', id: 'sw1' });
    expect(sw.tags).toEqual(
      expect.arrayContaining(['Physical', 'Device', 'Network', 'Switch']),
    );
  });

  it('applies default properties per type (server resources)', () => {
    const g = new Graph();
    const s = g.addNode({ type: 'server', id: 'db01' });
    expect(s.properties).toMatchObject({
      traversalsPerTick: 200,
      cpuTotal: 8,
      memoryTotal: 8,
      storageTotal: 16,
    });
  });

  it('supplied properties override defaults', () => {
    const g = new Graph();
    const s = g.addNode({
      type: 'server',
      id: 'big01',
      properties: { cpuTotal: 16 },
    });
    expect(s.properties.cpuTotal).toBe(16);
    expect(s.properties.memoryTotal).toBe(8);
  });

  it('rejects duplicate (type, id)', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    expect(() => g.addNode({ type: 'server', id: 'db01' })).toThrow(
      GraphStructureError,
    );
  });

  it('same id across types is allowed', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'x' });
    g.addNode({ type: 'switch', id: 'x' });
    expect(g.hasNode('server', 'x')).toBe(true);
    expect(g.hasNode('switch', 'x')).toBe(true);
  });

  it('rejects malformed ids', () => {
    const g = new Graph();
    expect(() => g.addNode({ type: 'server', id: 'Bad-Id' })).toThrow();
    expect(() => g.addNode({ type: 'port', id: '@f1/c/1' })).toThrow();
    expect(() => g.addNode({ type: 'port', id: 'Bad-Port' })).toThrow();
  });
});

describe('Graph.addEdge', () => {
  it('rejects edges referencing missing nodes', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    expect(() =>
      g.addEdge({
        relation: 'NIC',
        from: { type: 'server', id: 'db01' },
        to: { type: 'port', id: 'db01/port0' },
      }),
    ).toThrow(/missing node/);
  });

  it('creates NIC edge server -> port with strength 0.5', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    g.addNode({ type: 'port', id: 'db01/port0', tags: ['RJ45'] });
    const e = g.addEdge({
      relation: 'NIC',
      from: { type: 'server', id: 'db01' },
      to: { type: 'port', id: 'db01/port0' },
    });
    expect(e.directed).toBe(true);
    expect(e.strength).toBe(0.5);
  });

  it('dedupes undirected edges regardless of endpoint order', () => {
    const g = new Graph();
    g.addNode({ type: 'port', id: 'a/port0', tags: ['RJ45'] });
    g.addNode({ type: 'port', id: 'b/port0', tags: ['RJ45'] });
    g.addEdge({
      relation: 'NetworkCableLinkRJ45',
      from: { type: 'port', id: 'a/port0' },
      to: { type: 'port', id: 'b/port0' },
    });
    expect(() =>
      g.addEdge({
        relation: 'NetworkCableLinkRJ45',
        from: { type: 'port', id: 'b/port0' },
        to: { type: 'port', id: 'a/port0' },
      }),
    ).toThrow(/duplicate edge/);
  });
});

describe('Graph.removeNode cascades edges', () => {
  it('removes incident edges and cleans adjacency', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    g.addNode({ type: 'port', id: 'db01/port0', tags: ['RJ45'] });
    g.addEdge({
      relation: 'NIC',
      from: { type: 'server', id: 'db01' },
      to: { type: 'port', id: 'db01/port0' },
    });
    expect(g.edges.size).toBe(1);
    g.removeNode('server', 'db01');
    expect(g.edges.size).toBe(0);
    expect(g.edgesOf('port', 'db01/port0')).toEqual([]);
  });
});

describe('Graph.edgesOf', () => {
  it('returns edges incident in either direction', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    g.addNode({ type: 'port', id: 'db01/port0', tags: ['RJ45'] });
    g.addEdge({
      relation: 'NIC',
      from: { type: 'server', id: 'db01' },
      to: { type: 'port', id: 'db01/port0' },
    });
    expect(g.edgesOf('server', 'db01')).toHaveLength(1);
    expect(g.edgesOf('port', 'db01/port0')).toHaveLength(1);
  });
});

describe('Graph.updateNode', () => {
  it('applies propertyRemove before merging properties', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 's1', properties: { portLayout: 'RJ45[1]', name: 'x' } });
    g.updateNode('server', 's1', {
      propertyRemove: ['portLayout'],
      properties: { memoryTotal: 4 },
    });
    const n = g.getNode('server', 's1')!;
    expect('portLayout' in n.properties).toBe(false);
    expect(n.properties.memoryTotal).toBe(4);
  });
});
