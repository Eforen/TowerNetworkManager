import { describe, expect, it } from 'vitest';
import { ParseError, parse } from '@/format';
import { RELATION_META, parseNodeKey } from '@/model';

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
        'switch sw1 RJ45[1]',
        'switch[sw1] -> port[sw1/port0]',
      ].join('\n'),
    );
    const edges = [...graph.edges.values()];
    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('NIC');
  });

  it('errors on ambiguous relations and requires an explicit :Relation', () => {
    const ambiguous = [
      '!tni v1',
      'port 1 RJ45 #UserPort',
      'port 2 RJ45 #UserPort',
      'port[1] -> port[2]',
    ].join('\n');
    expect(() => parse(ambiguous)).toThrow(ParseError);

    const explicit = [
      '!tni v1',
      'port 1 RJ45 #UserPort',
      'port 2 RJ45 #UserPort',
      'port[1] -> port[2] :NetworkCableLinkFiber',
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
  it('materializes device ports from server portLayout and assigns tags', () => {
    const { graph } = parse('!tni v1\nserver s1 RJ45[2] FIBER[1]\n');
    const p0 = graph.getNode('port', 's1/port0');
    const p1 = graph.getNode('port', 's1/port1');
    const p2 = graph.getNode('port', 's1/port2');
    expect(p0?.tags).toEqual(expect.arrayContaining(['RJ45']));
    expect(p1?.tags).toEqual(expect.arrayContaining(['RJ45']));
    expect(p2?.tags).toEqual(expect.arrayContaining(['FiberOptic']));
  });

  it('rejects a bare `port` line without #UserPort (use portLayout on device)', () => {
    expect(() => parse('!tni v1\nport 0 RJ45\n')).toThrow(ParseError);
  });

  it('accepts short media in portLayout (RJ, F) on a switch', () => {
    const { graph } = parse('!tni v1\nswitch sw1 RJ[1] F[1]\n');
    expect(graph.getNode('port', 'sw1/port0')?.tags).toEqual(
      expect.arrayContaining(['RJ45']),
    );
    expect(graph.getNode('port', 'sw1/port1')?.tags).toEqual(
      expect.arrayContaining(['FiberOptic']),
    );
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

  it('rejects an empty/inverted range on UserPort', () => {
    expect(() => parse('!tni v1\nport 3-1 RJ45 #UserPort\n')).toThrow(
      ParseError,
    );
  });
});

describe('format/parser – arrow-prefix continuation (`->` / `=>`)', () => {
  const edgesBy = (
    graph: import('@/model').Graph,
    rel: import('@/model').RelationName,
  ) => [...graph.edges.values()].filter((e) => e.relation === rel);

  const from = (e: import('@/model').Edge) => parseNodeKey(e.fromKey);
  const to = (e: import('@/model').Edge) => parseNodeKey(e.toKey);

  it('`->` creates an edge from the anchor to an existing entity', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customertype casual_dweller',
        'customer organic-goat',
        '-> customertype[casual_dweller] :Owner',
      ].join('\n'),
    );
    expect(graph.stats().edges).toBe(1);
    const owner = edgesBy(graph, 'Owner');
    expect(owner.length).toBe(1);
    expect(from(owner[0])).toEqual({ type: 'customer', id: 'organic-goat' });
    expect(to(owner[0])).toEqual({
      type: 'customertype',
      id: 'casual_dweller',
    });
  });

  it('`=>` creates a new entity AND the anchor-to-new edge', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '=> port 52682 RJ45 #UserPort :Owner',
      ].join('\n'),
    );
    expect(graph.getNode('port', '52682')).toBeDefined();
    const owner = edgesBy(graph, 'Owner');
    expect(owner.length).toBe(1);
    expect(from(owner[0])).toEqual({ type: 'customer', id: 'organic-goat' });
    expect(to(owner[0])).toEqual({ type: 'port', id: '52682' });
  });

  it('auto-flips direction when relation requires the opposite order', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '=> networkaddress @f1/c/3 :AssignedTo',
      ].join('\n'),
    );
    const assigned = edgesBy(graph, 'AssignedTo');
    expect(assigned.length).toBe(1);
    expect(from(assigned[0])).toEqual({
      type: 'networkaddress',
      id: '@f1/c/3',
    });
    expect(to(assigned[0])).toEqual({ type: 'customer', id: 'organic-goat' });
  });

  it('chains multiple arrow lines off the same anchor', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customertype casual_dweller',
        'customer organic-goat',
        '=> port 52682 RJ45 #UserPort :Owner',
        '=> networkaddress @f1/c/3 :AssignedTo',
        '-> customertype[casual_dweller] :Owner',
      ].join('\n'),
    );
    const owner = edgesBy(graph, 'Owner');
    expect(owner.length).toBe(2);
    expect(owner.every((e) => from(e).id === 'organic-goat')).toBe(true);
    expect(edgesBy(graph, 'AssignedTo').length).toBe(1);
  });

  it('blank lines and comments do NOT change the anchor', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '',
        '# still rooted on organic-goat',
        '=> port 52682 RJ45 #UserPort :Owner',
      ].join('\n'),
    );
    const owner = edgesBy(graph, 'Owner');
    expect(owner.length).toBe(1);
    expect(from(owner[0]).id).toBe('organic-goat');
    expect(to(owner[0])).toEqual({ type: 'port', id: '52682' });
  });

  it('full-form edge decls do NOT change the anchor', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customertype casual_dweller',
        'customer organic-goat',
        'customer[organic-goat] -> customertype[casual_dweller] :Owner',
        '=> port 52682 RJ45 #UserPort :Owner',
      ].join('\n'),
    );
    const owner = edgesBy(graph, 'Owner');
    expect(owner.length).toBe(2);
    const tos = owner.map((e) => `${to(e).type}:${to(e).id}`);
    expect(tos).toEqual(
      expect.arrayContaining(['customertype:casual_dweller', 'port:52682']),
    );
  });

  it('infers the relation when only one pair is legal', () => {
    const { graph } = parse(
      ['!tni v1', 'customer organic-goat', '=> networkaddress @f1/c/9'].join(
        '\n',
      ),
    );
    expect(edgesBy(graph, 'AssignedTo').length).toBe(1);
  });

  it('NIC from switch to device port after portLayout', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'server s1 RJ45[3]',
        'switch sw1',
        '-> port[s1/port2] :NIC',
      ].join('\n'),
    );
    const nic = edgesBy(graph, 'NIC');
    // s1’s layout adds NICs for its own ports; the arrow is switch → s1’s port2.
    const cross = nic.find(
      (e) => from(e).type === 'switch' && to(e).id === 's1/port2',
    );
    expect(cross).toBeDefined();
    expect(from(cross!)).toEqual({ type: 'switch', id: 'sw1' });
    expect(to(cross!)).toEqual({ type: 'port', id: 's1/port2' });
  });

  it('`->` NIC from switch to its own port', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'switch sw1 RJ45[3]',
        '-> port[sw1/port2] :NIC',
      ].join('\n'),
    );
    const nic = edgesBy(graph, 'NIC');
    // Layout sync pre-adds NICs; the arrow duplicates sw1’s slot2 and is a no-op.
    expect(nic.length).toBe(3);
    const toOwn = nic.find(
      (e) => from(e).id === 'sw1' && to(e).id === 'sw1/port2',
    );
    expect(toOwn).toBeDefined();
  });

  it("errors when `->` has no anchor", () => {
    expect(() =>
      parse(['!tni v1', '-> customertype[x] :Owner'].join('\n')),
    ).toThrow(/no anchor/);
  });

  it("errors when `=>` has no anchor", () => {
    expect(() =>
      parse(['!tni v1', '=> port 0 RJ45 #UserPort'].join('\n')),
    ).toThrow(/no anchor/);
  });

  it('errors when the relation is invalid for either direction', () => {
    expect(() =>
      parse(
        [
          '!tni v1',
          'customer organic-goat',
          '=> customer other :AssignedTo',
        ].join('\n'),
      ),
    ).toThrow(/AssignedTo/);
  });

  it('errors when the pair is ambiguous without a relation', () => {
    // domain<->usagetype has both Consumes and Provides.
    expect(() =>
      parse(
        [
          '!tni v1',
          'domain "example.com"',
          '=> usagetype stream-video',
        ].join('\n'),
      ),
    ).toThrow(/ambiguous/);
  });
});

describe('format/parser – edge-ref selectors (`subj>Type[qual]`)', () => {
  const edgesBy = (
    graph: import('@/model').Graph,
    rel: import('@/model').RelationName,
  ) => [...graph.edges.values()].filter((e) => e.relation === rel);
  const from = (e: import('@/model').Edge) => parseNodeKey(e.fromKey);
  const to = (e: import('@/model').Edge) => parseNodeKey(e.toKey);

  it('resolves the first neighbor of the requested type when no qualifier is given', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '=> port 52682 RJ45 #UserPort :Owner',
        'server s1 RJ45[1]',
        'customer[organic-goat]>port -> port[s1/port0] :NetworkCableLinkRJ45',
      ].join('\n'),
    );
    const cables = edgesBy(graph, 'NetworkCableLinkRJ45');
    expect(cables.length).toBe(1);
    const ids = [from(cables[0]).id, to(cables[0]).id].sort();
    expect(ids).toEqual(['52682', 's1/port0']);
  });

  it('resolves an indexed neighbor with `[N]`', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '=> port 11111 RJ45 #UserPort :Owner',
        '=> port 22222 RJ45 #UserPort :Owner',
        '=> port 33333 RJ45 #UserPort :Owner',
        'networkaddress @f1/c/1',
        'networkaddress[@f1/c/1] -> customer[organic-goat]>port[1] :AssignedTo',
      ].join('\n'),
    );
    const assigned = edgesBy(graph, 'AssignedTo');
    expect(assigned.length).toBe(1);
    expect(to(assigned[0])).toEqual({ type: 'port', id: '22222' });
  });

  it('resolves a literal id qualifier `[@addr]`', () => {
    // Two netaddrs assigned to the same customer. Use the selector to
    // pick the second one and assign it to a router as well; verify the
    // new AssignedTo edge came from the right netaddr.
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        'networkaddress @f1/c/3',
        'networkaddress @f1/c/4',
        'networkaddress[@f1/c/3] -> customer[organic-goat] :AssignedTo',
        'networkaddress[@f1/c/4] -> customer[organic-goat] :AssignedTo',
        'router rt1',
        'customer[organic-goat]>networkaddress[@f1/c/4] -> router[rt1] :AssignedTo',
      ].join('\n'),
    );
    const assigned = edgesBy(graph, 'AssignedTo');
    expect(assigned.length).toBe(3);
    const toRouter = assigned.find((e) => to(e).type === 'router')!;
    expect(from(toRouter)).toEqual({
      type: 'networkaddress',
      id: '@f1/c/4',
    });
  });

  it("resolves `[#id]` literal form explicitly", () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '=> port 52682 RJ45 #UserPort :Owner',
        '=> port 0 RJ45 #UserPort :Owner',
        '=> port 9 RJ45 #UserPort :Owner',
        'server s1 RJ45[1]',
        'customer[organic-goat]>port[#0] -> port[9] :NetworkCableLinkRJ45',
      ].join('\n'),
    );
    const cables = edgesBy(graph, 'NetworkCableLinkRJ45');
    expect(cables.length).toBe(1);
    const ids = [from(cables[0]).id, to(cables[0]).id].sort();
    expect(ids).toEqual(['0', '9']);
  });

  it('errors when no neighbor of the requested type is reachable', () => {
    expect(() =>
      parse(
        [
          '!tni v1',
          'customer organic-goat',
          'customertype casual_dweller',
          'customer[organic-goat]>port -> customertype[casual_dweller] :Owner',
        ].join('\n'),
      ),
    ).toThrow(/no port reachable/);
  });

  it('errors on out-of-range index', () => {
    expect(() =>
      parse(
        [
          '!tni v1',
          'customer organic-goat',
          '=> port 52682 RJ45 #UserPort :Owner',
          'customertype casual_dweller',
          'customer[organic-goat]>port[3] -> customertype[casual_dweller] :Owner',
        ].join('\n'),
      ),
    ).toThrow(/out of range/);
  });

  it('errors when a literal qualifier does not match any neighbor', () => {
    // Must use `#` to force literal matching of a decimal id (bare digits
    // are interpreted as an index).
    expect(() =>
      parse(
        [
          '!tni v1',
          'customer organic-goat',
          '=> port 52682 RJ45 #UserPort :Owner',
          'server s1 RJ45[1]',
          'customer[organic-goat]>port[#99999] -> port[s1/port0] :NetworkCableLinkRJ45',
        ].join('\n'),
      ),
    ).toThrow(/not found/);
  });

  it('chains multiple selectors left-to-right', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '=> port 52682 RJ45 #UserPort :Owner',
        'server s1 RJ45[1]',
        'port[s1/port0] -> port[52682] :NetworkCableLinkRJ45',
        'switch sw1',
        'switch[sw1] -> customer[organic-goat]>port :NIC',
      ].join('\n'),
    );
    const nic = edgesBy(graph, 'NIC');
    // sw1’s layout pre-adds one NIC; the arrow adds switch → user port 52682.
    const toUser = nic.find((e) => to(e).id === '52682');
    expect(toUser).toBeDefined();
    expect(from(toUser!)).toEqual({ type: 'switch', id: 'sw1' });
    expect(to(toUser!)).toEqual({ type: 'port', id: '52682' });
  });

  it('selectors work on the RHS of `->` arrow lines too', () => {
    const { graph } = parse(
      [
        '!tni v1',
        'customer organic-goat',
        '=> port 52682 RJ45 #UserPort :Owner',
        'switch sw1 RJ45[1]',
        '-> customer[organic-goat]>port :NIC',
      ].join('\n'),
    );
    const nic = edgesBy(graph, 'NIC');
    const toUser = nic.find(
      (e) => to(e).id === '52682' && from(e).id === 'sw1',
    );
    expect(toUser).toBeDefined();
    expect(from(toUser!)).toEqual({ type: 'switch', id: 'sw1' });
    expect(to(toUser!)).toEqual({ type: 'port', id: '52682' });
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
