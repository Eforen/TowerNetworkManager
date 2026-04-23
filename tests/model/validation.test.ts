import { describe, it, expect } from 'vitest';
import { Graph } from '@/model/graph';
import { validate } from '@/model/validation';

function codes(report: ReturnType<typeof validate>): string[] {
  return report.errors.map((e) => e.code);
}

describe('validation: numeric fields', () => {
  it('flags negative traversalsPerTick on a switch', () => {
    const g = new Graph();
    g.addNode({
      type: 'switch',
      id: 'sw1',
      properties: { traversalsPerTick: -1 },
    });
    expect(codes(validate(g))).toContain('property.notNonNegInt');
  });

  it('flags non-integer server.cpuTotal', () => {
    const g = new Graph();
    g.addNode({
      type: 'server',
      id: 'db01',
      properties: { cpuTotal: 1.5 },
    });
    expect(codes(validate(g))).toContain('property.notNonNegInt');
  });

  it('flags program missing cpu/memory/storage', () => {
    const g = new Graph();
    g.addNode({ type: 'program', id: 'custom' });
    expect(codes(validate(g))).toEqual(
      expect.arrayContaining(['program.missingResource']),
    );
  });

  it('flags behaviorinsight.activeProbability out of [0,1]', () => {
    const g = new Graph();
    g.addNode({
      type: 'behaviorinsight',
      id: 'x',
      properties: { activeProbability: 1.5 },
    });
    expect(codes(validate(g))).toContain('behaviorinsight.badProbability');
  });
});

describe('validation: tags', () => {
  it('warns on non-canonical PascalCase tag', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01', tags: ['Custom'] });
    const r = validate(g);
    expect(r.warnings.some((w) => w.code === 'tag.nonCanonical')).toBe(true);
  });

  it('errors on malformed tag', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01', tags: ['lowercase'] });
    expect(codes(validate(g))).toContain('tag.malformed');
  });

  it('errors when userport has no media tag', () => {
    const g = new Graph();
    g.addNode({ type: 'userport', id: '12', tags: [] });
    expect(codes(validate(g))).toContain('port.noMedia');
  });

  it('errors when port has both media tags', () => {
    const g = new Graph();
    g.addNode({
      type: 'server',
      id: 's1',
      properties: { portLayout: 'RJ45' },
    });
    g.addNode({
      type: 'port',
      id: 's1/port0',
      tags: ['RJ45', 'FiberOptic'],
    });
    expect(codes(validate(g))).toContain('port.dualMedia');
  });
});

describe('validation: network address format', () => {
  it('accepts a valid networkaddress node', () => {
    const g = new Graph();
    g.addNode({ type: 'networkaddress', id: '@f1/u/1' });
    expect(codes(validate(g))).not.toContain('netAddr.invalid');
  });

  it('accepts an uplink with a 4-letter id', () => {
    const g = new Graph();
    g.addNode({ type: 'uplink', id: 'comc', tags: ['RJ45'] });
    expect(codes(validate(g))).not.toContain('netAddr.invalid');
  });
});

describe('validation: edge endpoint rules', () => {
  it('NIC target must carry NetworkPort tag', () => {
    const g = new Graph();
    g.addNode({
      type: 'server',
      id: 'db01',
      properties: { portLayout: 'RJ45' },
    });
    g.addNode({ type: 'port', id: 'db01/port0', tags: ['RJ45'] });
    g.addEdge({
      relation: 'NIC',
      from: { type: 'server', id: 'db01' },
      to: { type: 'port', id: 'db01/port0' },
    });
    expect(codes(validate(g))).not.toContain('nic.targetNotPort');
  });

  it('rejects NetworkCableLinkRJ45 between RJ45 and FiberOptic ports', () => {
    const g = new Graph();
    g.addNode({ type: 'port', id: 'a/port0', tags: ['RJ45'] });
    g.addNode({ type: 'port', id: 'b/port0', tags: ['FiberOptic'] });
    g.addEdge({
      relation: 'NetworkCableLinkRJ45',
      from: { type: 'port', id: 'a/port0' },
      to: { type: 'port', id: 'b/port0' },
    });
    expect(codes(validate(g))).toContain('cable.mediaMismatch');
  });

  it('accepts FloorAssignment floor -> customer', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'f1' });
    g.addNode({ type: 'customer', id: 'c1' });
    g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'f1' },
      to: { type: 'customer', id: 'c1' },
    });
    expect(codes(validate(g))).not.toContain('edge.badEndpoints');
  });

  it('rejects FloorAssignment whose from is not a floor', () => {
    const g = new Graph();
    g.addNode({ type: 'rack', id: 'r1' });
    g.addNode({ type: 'server', id: 'db01' });
    // Synthesize an illegal FloorAssignment by overriding allowed pairs:
    // constructor rejects because relation pair (rack, server) is not in
    // FloorAssignment's pair list — so we get a GraphStructureError first.
    // Validation only sees the error path when endpoints exist, so we try
    // via badly typed edge after manually inserting.
    // Instead test the structural guard:
    expect(() =>
      g.addEdge({
        relation: 'FloorAssignment',
        from: { type: 'rack', id: 'r1' },
        to: { type: 'server', id: 'db01' },
      }),
    ).not.toThrow(); // rack,server IS allowed via rack->server RackAssignment,
    // but not FloorAssignment. Verify the edge.badEndpoints error surfaces.
    const r = validate(g);
    expect(r.errors.some((e) => e.code === 'edge.badEndpoints')).toBe(true);
  });

  it('Install must be server -> program', () => {
    const g = new Graph();
    g.addNode({ type: 'server', id: 'db01' });
    g.addNode({
      type: 'program',
      id: 'gitcoffee',
      properties: { cpu: 4, memory: 2, storage: 4 },
    });
    g.addEdge({
      relation: 'Install',
      from: { type: 'server', id: 'db01' },
      to: { type: 'program', id: 'gitcoffee' },
    });
    expect(validate(g).errors).toHaveLength(0);
  });

  it('Owner customer -> device port is not an allowed pair', () => {
    const g = new Graph();
    g.addNode({ type: 'customer', id: 'organic-goat' });
    g.addNode({
      type: 'server',
      id: 's1',
      properties: { portLayout: 'RJ45' },
    });
    g.addNode({ type: 'port', id: 's1/port0', tags: ['RJ45'] });
    g.addEdge({
      relation: 'Owner',
      from: { type: 'customer', id: 'organic-goat' },
      to: { type: 'port', id: 's1/port0' },
    });
    expect(codes(validate(g))).toContain('edge.badEndpoints');
  });

  it('Consumes.required must be non-negative', () => {
    const g = new Graph();
    g.addNode({
      type: 'behaviorinsight',
      id: 'x',
      properties: { bandwidthPerTick: 1 },
    });
    g.addNode({ type: 'usagetype', id: 'stream-video' });
    g.addEdge({
      relation: 'Consumes',
      from: { type: 'behaviorinsight', id: 'x' },
      to: { type: 'usagetype', id: 'stream-video' },
      properties: { required: -5 },
    });
    expect(codes(validate(g))).toContain('edge.badRequired');
  });

  it('program Consumes with pool requires matching pool total', () => {
    const g = new Graph();
    g.addNode({
      type: 'program',
      id: 'gitcoffee',
      properties: { cpu: 4, memory: 2, storage: 4 },
    });
    g.addNode({ type: 'usagetype', id: 'read-text' });
    g.addEdge({
      relation: 'Provides',
      from: { type: 'program', id: 'gitcoffee' },
      to: { type: 'usagetype', id: 'read-text' },
      properties: { pool: 'main' },
    });
    expect(codes(validate(g))).toContain('pool.undeclared');

    g.updateNode('program', 'gitcoffee', {
      properties: { 'pool.provide.main': 16 },
    });
    expect(codes(validate(g))).not.toContain('pool.undeclared');
  });

  it('Insight edges must originate from a Behavior node', () => {
    // Insight only allows consumerbehavior/producerbehavior -> behaviorinsight
    // (structurally enforced). Attempting a bad pair throws at addEdge.
    const g = new Graph();
    g.addNode({ type: 'customer', id: 'c1' });
    g.addNode({ type: 'behaviorinsight', id: 'i1' });
    expect(() =>
      g.addEdge({
        relation: 'Insight',
        from: { type: 'customer', id: 'c1' },
        to: { type: 'behaviorinsight', id: 'i1' },
      }),
    ).not.toThrow();
    // addEdge does not check pair allow list — validation does.
    expect(codes(validate(g))).toContain('edge.badEndpoints');
  });
});

describe('validation: clean graph has no errors', () => {
  it('simple star graph validates clean', () => {
    const g = new Graph();
    g.addNode({ type: 'floor', id: 'f1' });
    g.addNode({
      type: 'switch',
      id: 'sw1',
      properties: { portLayout: 'RJ45' },
    });
    g.addNode({ type: 'port', id: 'sw1/port0', tags: ['RJ45'] });
    g.addNode({ type: 'userport', id: '12345', tags: ['RJ45'] });
    g.addEdge({
      relation: 'FloorAssignment',
      from: { type: 'floor', id: 'f1' },
      to: { type: 'switch', id: 'sw1' },
    });
    g.addEdge({
      relation: 'NIC',
      from: { type: 'switch', id: 'sw1' },
      to: { type: 'port', id: 'sw1/port0' },
    });
    g.addEdge({
      relation: 'NetworkCableLinkRJ45',
      from: { type: 'port', id: 'sw1/port0' },
      to: { type: 'userport', id: '12345' },
    });
    expect(validate(g).errors).toEqual([]);
  });
});
