import { describe, expect, it } from 'vitest';
import { ParseError, parse } from '@/format';
import { RELATION_META } from '@/model';

describe('format/parser – header', () => {
  it('requires !tni v1 header', () => {
    expect(() => parse('floor f1')).toThrow(ParseError);
    expect(() => parse('!tni v2\nfloor f1')).toThrow(ParseError);
  });

  it('parses an empty document with just the header', () => {
    const { graph } = parse('!tni v1\n');
    expect(graph.stats().nodes).toBe(0);
    expect(graph.stats().edges).toBe(0);
  });

  it('skips blank lines and comments', () => {
    const { graph } = parse(
      ['!tni v1', '# a comment', '', 'floor f1', '# trailing'].join('\n'),
    );
    expect(graph.stats().nodes).toBe(1);
  });
});

describe('format/parser – entities', () => {
  it('parses a plain floor entity', () => {
    const { graph } = parse('!tni v1\nfloor f1\n');
    const f = graph.getNode('floor', 'f1');
    expect(f).toBeDefined();
  });

  it('parses tags and properties on an entity', () => {
    const { graph } = parse(
      '!tni v1\nport 12345 RJ45 #UserPort deviceAddress=12345\n',
    );
    const port = graph.getNode('port', '12345');
    expect(port?.tags).toEqual(
      expect.arrayContaining(['RJ45', 'UserPort', 'Physical', 'NetworkPort']),
    );
    expect(port?.properties.deviceAddress).toBe(12345);
  });

  it('accepts quoted string values with escapes', () => {
    const { graph } = parse(
      '!tni v1\ncustomer alice customerName="Alice \\"Ace\\""\n',
    );
    const node = graph.getNode('customer', 'alice');
    expect(node?.properties.customerName).toBe('Alice "Ace"');
  });

  it('parses dotted property keys (pool.provide.main)', () => {
    const { graph } = parse(
      '!tni v1\nprogram database pool.provide.main=16 pool.consume.buf=4\n',
    );
    const p = graph.getNode('program', 'database');
    expect(p?.properties['pool.provide.main']).toBe(16);
    expect(p?.properties['pool.consume.buf']).toBe(4);
  });

  it('accepts quoted domain identities', () => {
    const { graph } = parse('!tni v1\ndomain "example.com"\n');
    const d = graph.getNode('domain', 'example.com');
    expect(d).toBeDefined();
  });

  it('accepts bare domain identities with dots', () => {
    const { graph } = parse('!tni v1\ndomain example.com\n');
    const d = graph.getNode('domain', 'example.com');
    expect(d).toBeDefined();
  });

  it('rejects unknown node types with a suggestion', () => {
    try {
      parse('!tni v1\nswithc sw1\n');
      throw new Error('expected ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).hint).toBe('switch');
      expect((err as Error).message).toMatch(/line 2, col 1/);
    }
  });
});

describe('format/parser – edges', () => {
  it('parses an explicit relation', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'floor f1',
        'rack r1',
        'floor[f1] -> rack[r1] :FloorAssignment',
      ].join('\n'),
    );
    expect(graph.stats().edges).toBe(1);
  });

  it('infers the relation when the type pair is unambiguous', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'switch sw1',
        'port 0 RJ45',
        'switch[sw1] -> port[port0]',
      ].join('\n'),
    );
    const edges = [...graph.edges.values()];
    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('NIC');
  });

  it('errors on ambiguous relations and requires an explicit :Relation', () => {
    const ambiguous = [
      '!tni v1',
      'port 0 F',
      'port 1 F',
      'port[port0] -> port[port1]',
    ].join('\n');
    expect(() => parse(ambiguous)).toThrow(ParseError);

    const explicit = [
      '!tni v1',
      'port 0 F',
      'port 1 F',
      'port[port0] -> port[port1] :NetworkCableLinkFiber',
    ].join('\n');
    expect(() => parse(explicit)).not.toThrow();
  });

  it('parses edge properties in braces', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer alice',
        'port 12345 RJ45 #UserPort',
        'customer[alice] -> port[12345] :Owner',
        '',
        'program database',
        'server db01',
        'server[db01] -> program[database] :Install {amount=2}',
      ].join('\n'),
    );
    const install = [...graph.edges.values()].find(
      (e) => e.relation === 'Install',
    );
    expect(install?.properties.amount).toBe(2);
  });

  it('rejects unknown relations with a suggestion', () => {
    const text =
      '!tni v1\ncustomer alice\nport 12345 RJ45 #UserPort\ncustomer[alice] -> port[12345] :Ownner\n';
    try {
      parse(text);
      throw new Error('expected ParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(ParseError);
      expect((err as ParseError).hint).toBe('Owner');
    }
  });

  it('rejects illegal type pairs for a declared relation', () => {
    const text = [
      '!tni v1',
      'floor f1',
      'rack r1',
      'floor[f1] -> rack[r1] :RackAssignment',
    ].join('\n');
    expect(() => parse(text)).toThrow(ParseError);
  });

  it('honors line continuation with trailing backslash', () => {
    const { graph } = parse(
      ['!tni v1', 'port 12345 RJ45 #UserPort \\', '  deviceAddress=1'].join('\n'),
    );
    const p = graph.getNode('port', '12345');
    expect(p?.properties.deviceAddress).toBe(1);
  });
});

describe('format/parser – port syntax', () => {
  it('parses the positional media keyword (long form)', () => {
    const { graph } = parse('!tni v1\nport 0 RJ45\n');
    const p = graph.getNode('port', 'port0');
    expect(p).toBeDefined();
    expect(p?.tags).toEqual(expect.arrayContaining(['RJ45']));
  });

  it('accepts short media aliases RJ and F', () => {
    const { graph } = parse('!tni v1\nport 0 RJ\nport 1 F\n');
    expect(graph.getNode('port', 'port0')?.tags).toEqual(
      expect.arrayContaining(['RJ45']),
    );
    expect(graph.getNode('port', 'port1')?.tags).toEqual(
      expect.arrayContaining(['FiberOptic']),
    );
  });

  it('accepts FIBER and FiberOptic as fiber aliases', () => {
    const { graph } = parse('!tni v1\nport 0 FIBER\nport 1 FiberOptic\n');
    expect(graph.getNode('port', 'port0')?.tags).toEqual(
      expect.arrayContaining(['FiberOptic']),
    );
    expect(graph.getNode('port', 'port1')?.tags).toEqual(
      expect.arrayContaining(['FiberOptic']),
    );
  });

  it('expands a range into one port per number (inclusive)', () => {
    const { graph } = parse('!tni v1\nport 0-2 RJ45\n');
    expect(graph.getNode('port', 'port0')).toBeDefined();
    expect(graph.getNode('port', 'port1')).toBeDefined();
    expect(graph.getNode('port', 'port2')).toBeDefined();
    expect(graph.getNode('port', 'port3')).toBeUndefined();
  });

  it('stores UserPort ids as bare hardware digits', () => {
    const { graph } = parse('!tni v1\nport 52682 RJ45 #UserPort\n');
    expect(graph.getNode('port', '52682')).toBeDefined();
    expect(graph.getNode('port', 'port52682')).toBeUndefined();
  });

  it('rejects range syntax on UserPort lines', () => {
    expect(() => parse('!tni v1\nport 0-2 RJ45 #UserPort\n')).toThrow(
      ParseError,
    );
  });

  it('rejects unknown media keywords', () => {
    expect(() => parse('!tni v1\nport 0 COAX\n')).toThrow(ParseError);
  });

  it('rejects the legacy `port port0 #RJ45` form', () => {
    expect(() => parse('!tni v1\nport port0 #RJ45\n')).toThrow(ParseError);
  });

  it('rejects a missing media keyword', () => {
    expect(() => parse('!tni v1\nport 0\n')).toThrow(ParseError);
  });

  it('rejects an empty/inverted range', () => {
    expect(() => parse('!tni v1\nport 3-1 RJ45\n')).toThrow(ParseError);
  });
});

describe('format/parser – relation registry sanity', () => {
  it('RELATION_META contains entries for every relation', () => {
    for (const k of Object.keys(RELATION_META)) {
      expect(RELATION_META[k as keyof typeof RELATION_META].pairs.length).toBeGreaterThan(
        0,
      );
    }
  });
});
