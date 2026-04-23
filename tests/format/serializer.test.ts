import { describe, expect, it } from 'vitest';
import { ENTITY_TYPE_ORDER, RELATION_ORDER, parse, serialize } from '@/format';
import { Graph } from '@/model';

describe('format/serializer – header and layout', () => {
  it('emits a !tni v1 header and ends with a single newline', () => {
    const text = serialize(new Graph());
    expect(text.startsWith('!tni v1')).toBe(true);
    expect(text.endsWith('\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('orders entity groups by ENTITY_TYPE_ORDER', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    g.addNode({ type: 'floor', id: 'f1' });
    g.addNode({ type: 'rack', id: 'r1' });
    const out = serialize(g);
    const lines = out.trim().split('\n');
    const idx = (prefix: string) => lines.findIndex((l) => l.startsWith(prefix));
    expect(idx('floor')).toBeLessThan(idx('rack'));
    expect(idx('rack')).toBeLessThan(idx('server'));
  });

  it('sorts entities within a group by id', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'f9' });
    g.addNode({ type: 'floor', id: 'f1' });
    g.addNode({ type: 'floor', id: 'f2' });
    const out = serialize(g);
    const floors = out
      .split('\n')
      .filter((l) => l.startsWith('floor '))
      .map((l) => l.split(' ')[1]);
    expect(floors).toEqual(['f1', 'f2', 'f9']);
  });

  it('sorts edges by RELATION_ORDER then (fromType, fromId, toType, toId)', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'f1' });
    g.addNode({ type: 'rack', id: 'r1' });
    g.addNode({ type: 'rack', id: 'r2' });
    g.addNode({ type: 'switch', id: 'sw1' });
    g.addEdge({
      relation: 'RackAssignment',
      from: { type: 'rack', id: 'r1' },
      to: { type: 'switch', id: 'sw1' },
    });
    g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'f1' },
      to: { type: 'rack', id: 'r2' },
    });
    g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'f1' },
      to: { type: 'rack', id: 'r1' },
    });

    const out = serialize(g);
    const lines = out.split('\n').filter((l) => l.includes('->'));
    const first = RELATION_ORDER.indexOf('FloorAssignment');
    const second = RELATION_ORDER.indexOf('RackAssignment');
    expect(first).toBeLessThan(second);
    expect(lines[0]).toContain(':FloorAssignment');
    expect(lines[0]).toContain('rack[r1]');
    expect(lines[1]).toContain(':FloorAssignment');
    expect(lines[1]).toContain('rack[r2]');
    expect(lines[2]).toContain(':RackAssignment');
  });

  it('sorts undirected cable endpoints in lex order', () => {
    const g = new Graph();
    g.addNode({ type: 'port', id: 'a/port0' });
    g.addNode({ type: 'port', id: 'b/port0' });
    g.addEdge({
      relation: 'NetworkCableLinkRJ45',
      from: { type: 'port', id: 'b/port0' },
      to: { type: 'port', id: 'a/port0' },
    });
    const out = serialize(g);
    const line = out.split('\n').find((l) => l.includes(':NetworkCableLinkRJ45'));
    expect(line).toBeDefined();
    expect(line!.indexOf('a')).toBeLessThan(line!.indexOf('b'));
  });
});

describe('format/serializer – node formatting', () => {
  it('elides default tags and defers to parse to re-apply them', () => {
    const g = new Graph();
    g.addNode({ type: 'switch', id: 'sw1' });
    const out = serialize(g);
    const line = out.split('\n').find((l) => l.startsWith('switch '));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/#Physical|#Device|#Network|#Switch/);
  });

  it('serializes UserPort with positional media and remaining tags', () => {
    const g = new Graph();
    g.addNode({
      type: 'port',
      id: '12345',
      tags: ['UserPort', 'RJ45'],
      properties: { deviceAddress: 12345 },
    });
    const out = serialize(g);
    const line = out.split('\n').find((l) => l.startsWith('port '));
    expect(line).toBe('port 12345 RJ45 #UserPort deviceAddress=12345');
  });

  it('serializes a composite (non–layout-only) port id with quotes', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 's1' });
    g.addNode({ type: 'port', id: 's1/port7', tags: ['FiberOptic'] });
    const out = serialize(g);
    const line = out.split('\n').find((l) => l.startsWith('port '));
    expect(line).toBe('port "s1/port7" FiberOptic');
  });

  it('quotes strings with spaces or special chars', () => {
    const g = new Graph();
    g.addNode({
      type: 'customer',
      id: 'alice',
      properties: { customerName: 'Alice Example' },
    });
    const out = serialize(g);
    expect(out).toContain('customerName="Alice Example"');
  });

  it('escapes quotes and backslashes inside strings', () => {
    const g = new Graph();
    g.addNode({
      type: 'customer',
      id: 'alice',
      properties: { customerName: 'Alice "Ace"\\' },
    });
    const out = serialize(g);
    expect(out).toContain('customerName="Alice \\"Ace\\"\\\\"');
  });
});

describe('format/serializer – edge formatting', () => {
  it('omits layout-implied NIC edges (re-synced on parse)', () => {
    const { graph } = parse('!tni v1\nswitch 54321 RJ45[1]\n');
    expect([...graph.edges.values()].some((e) => e.relation === 'NIC')).toBe(
      true,
    );
    const out = serialize(graph);
    expect(out).not.toMatch(/:NIC/);
    expect(out).toContain('switch 54321');
  });

  it('emits edge properties as {k=v, k=v} sorted by key', () => {
    const g = new Graph();
    g.addNode({ type: 'program', id: 'database' });
    g.addNode({ type: 'server', id: 'db01' });
    g.addEdge({
      relation: 'Install',
      from: { type: 'program', id: 'database' },
      to: { type: 'server', id: 'db01' },
      properties: { amount: 2, pool: 'main' },
    });
    const out = serialize(g);
    const line = out.split('\n').find((l) => l.includes(':Install'));
    expect(line).toBe(
      'program[database] -> server[db01] :Install {amount=2, pool=main}',
    );
  });
});

describe('format/serializer – order constants', () => {
  it('ENTITY_TYPE_ORDER and RELATION_ORDER are non-empty and unique', () => {
    expect(new Set(ENTITY_TYPE_ORDER).size).toBe(ENTITY_TYPE_ORDER.length);
    expect(new Set(RELATION_ORDER).size).toBe(RELATION_ORDER.length);
  });
});

describe('format/serializer – integration with parser', () => {
  it('is idempotent: serialize(parse(text)) === serialize(parse(serialize(parse(text))))', () => {
    const text = [
      '!tni v1',
      'floor f1',
      'rack r1',
      'floor[f1] -> rack[r1] :FloorAssignment',
      '',
    ].join('\n');
    const once = serialize(parse(text).graph);
    const twice = serialize(parse(once).graph);
    expect(twice).toBe(once);
  });
});
