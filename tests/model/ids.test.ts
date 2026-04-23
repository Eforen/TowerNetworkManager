import { describe, it, expect } from 'vitest';
import {
  edgeId,
  isValidNodeId,
  nodeKey,
  parseNodeKey,
  NET_ADDR_RE,
  NODE_ID_RE,
  PROGRAM_ID_RE,
} from '@/model/ids';

describe('id regex', () => {
  it('node id: slug, 1..64 chars, starts with letter or digit', () => {
    expect(NODE_ID_RE.test('db01')).toBe(true);
    expect(NODE_ID_RE.test('organic-goat')).toBe(true);
    expect(NODE_ID_RE.test('a')).toBe(true);
    expect(NODE_ID_RE.test('a_b-c_1')).toBe(true);
    expect(NODE_ID_RE.test('')).toBe(false);
    expect(NODE_ID_RE.test('Uppercase')).toBe(false);
    expect(NODE_ID_RE.test('-leading')).toBe(false);
    expect(NODE_ID_RE.test('a'.repeat(65))).toBe(false);
  });

  it('network address: starts with @ and max 10 chars', () => {
    expect(NET_ADDR_RE.test('@f1/c/1')).toBe(true);
    expect(NET_ADDR_RE.test('@f1/c/99')).toBe(true);
    expect(NET_ADDR_RE.test('@f2/s/9')).toBe(true);
    expect(NET_ADDR_RE.test('@')).toBe(false);
    expect(NET_ADDR_RE.test('f1/c/1')).toBe(false);
    expect(NET_ADDR_RE.test('@f1/customer/1')).toBe(false); // 14 chars
    expect(NET_ADDR_RE.test('@' + 'x'.repeat(10))).toBe(false); // 11 chars
  });

  it('program id accepts underscores (game-style)', () => {
    expect(PROGRAM_ID_RE.test('padu_v1')).toBe(true);
    expect(PROGRAM_ID_RE.test('gitcoffee')).toBe(true);
    expect(PROGRAM_ID_RE.test('Foo')).toBe(false);
  });

  it('isValidNodeId routes per type', () => {
    expect(isValidNodeId('networkaddress', '@f1/c/1')).toBe(true);
    expect(isValidNodeId('port', 'sw1/port0')).toBe(true);
    expect(isValidNodeId('port', 'port0')).toBe(false);
    expect(isValidNodeId('port', '12345')).toBe(true);
    expect(isValidNodeId('port', '@f1/c/1')).toBe(false);
    expect(isValidNodeId('port', 'Bad-Port')).toBe(false);
    expect(isValidNodeId('server', 'db01')).toBe(true);
    expect(isValidNodeId('program', 'padu_v1')).toBe(true);
    expect(isValidNodeId('usagetype', 'stream-video')).toBe(true);
    expect(isValidNodeId('domain', 'example.com')).toBe(true);
  });
});

describe('nodeKey / parseNodeKey', () => {
  it('round-trips', () => {
    const key = nodeKey('server', 'db01');
    expect(key).toBe('server:db01');
    expect(parseNodeKey(key)).toEqual({ type: 'server', id: 'db01' });
  });

  it('supports network address ids with colons absent', () => {
    const key = nodeKey('networkaddress', '@f1/c/1');
    expect(parseNodeKey(key)).toEqual({
      type: 'networkaddress',
      id: '@f1/c/1',
    });
  });
});

describe('edgeId', () => {
  it('directed encodes from->to order', () => {
    const a = nodeKey('server', 'db01');
    const b = nodeKey('port', 'db01/port0');
    expect(edgeId('NIC', a, b, true)).toBe('NIC:server:db01->port:db01/port0');
    expect(edgeId('NIC', b, a, true)).toBe('NIC:port:db01/port0->server:db01');
  });

  it('undirected canonicalizes endpoints lexicographically', () => {
    const a = nodeKey('port', 'a/port0');
    const b = nodeKey('port', 'b/port0');
    expect(edgeId('NetworkCableLinkRJ45', a, b, false)).toBe(
      edgeId('NetworkCableLinkRJ45', b, a, false),
    );
  });
});
