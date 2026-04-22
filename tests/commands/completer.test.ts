import { describe, expect, it } from 'vitest';
import { Graph } from '@/model';
import {
  CommandRegistry,
  complete,
  registerBuiltins,
} from '@/commands';

function buildRegistry(): CommandRegistry {
  const r = new CommandRegistry();
  registerBuiltins(r);
  return r;
}

function buildGraph(): Graph {
  const g = new Graph();
  g.addNode({ type: 'server', id: 'db01' });
  g.addNode({ type: 'server', id: 'db02' });
  g.addNode({ type: 'switch', id: 'sw1' });
  return g;
}

describe('completer', () => {
  it('completes command names from empty input', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const { candidates } = complete('', 0, r, g);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.value === 'add node')).toBe(true);
  });

  it('completes command names by prefix', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'ad';
    const { candidates } = complete(input, input.length, r, g);
    expect(candidates.every((c) => c.value.startsWith('ad'))).toBe(true);
    expect(candidates.some((c) => c.value === 'add node')).toBe(true);
  });

  it('completes nodeType after "add node"', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'add node ser';
    const { candidates, replace } = complete(input, input.length, r, g);
    expect(candidates.some((c) => c.value === 'server')).toBe(true);
    expect(replace).toEqual([9, 12]);
  });

  it('completes nodeId after "rm node server"', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'rm node server ';
    const { candidates } = complete(input, input.length, r, g);
    const values = candidates.map((c) => c.value);
    expect(values).toContain('db01');
    expect(values).toContain('db02');
  });

  it('reports hint for next arg', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const { hint } = complete('add node ', 9, r, g);
    expect(hint).toContain('nodeType');
  });
});
