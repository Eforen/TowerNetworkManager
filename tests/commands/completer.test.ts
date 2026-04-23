import { describe, expect, it } from 'vitest';
import { Graph } from '@/model';
import {
  applyCandidate,
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

  // Regression: typing the prefix of a multi-word command and then Tab
  // should rewrite the incomplete prefix — not append the full command
  // name after it. Previously: 'add ' + Tab -> 'add add node'.
  it('expands replace range to cover the whole command prefix on Tab', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const { replace, candidates } = complete('add ', 4, r, g);
    expect(candidates.some((c) => c.value === 'add node')).toBe(true);
    expect(replace).toEqual([0, 4]);
  });

  it('expands replace range when a partial second word is typed', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const { replace, candidates } = complete('add no', 6, r, g);
    expect(candidates.some((c) => c.value === 'add node')).toBe(true);
    expect(replace).toEqual([0, 6]);
  });

  it('returns no candidates when prefix has no match', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const { candidates } = complete('add nodes', 9, r, g);
    expect(candidates.length).toBe(0);
  });

  // Regression: typing the FULL multi-word command name and hitting Tab
  // would replace only the last token, producing 'add add node'.
  it('expands replace range to cover the whole command name on Tab', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const { replace, candidates } = complete('add node', 8, r, g);
    expect(candidates.some((c) => c.value === 'add node')).toBe(true);
    expect(replace).toEqual([0, 8]);
  });
});

describe('applyCandidate', () => {
  it("replaces 'add' with the selected candidate", () => {
    const r = { value: 'add node' };
    const out = applyCandidate('add', r, [0, 3]);
    expect(out.buffer).toBe('add node');
    expect(out.caret).toBe('add node'.length);
  });

  // Regression for the Tab bug the user hit at runtime.
  it("rewrites 'add ' (trailing space) to the full command name", () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'add ';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find((c) => c.value === 'add node');
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add node');
    expect(out.caret).toBe('add node'.length);
  });

  it("rewrites 'add no' to the full command name", () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'add no';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find((c) => c.value === 'add node');
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add node');
    expect(out.caret).toBe('add node'.length);
  });

  // Regression for the second Tab bug: typing the full 'add node' and
  // hitting Tab must not duplicate the first word.
  it("rewrites 'add node' (fully typed command) to itself", () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'add node';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find((c) => c.value === 'add node');
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add node');
    expect(out.caret).toBe('add node'.length);
  });

  it("replaces the single-token prefix 'add' in place", () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'add';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find((c) => c.value === 'add node');
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add node');
  });

  it('inserts an arg after a completed command', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'add node s';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find((c) => c.value === 'server');
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add node server');
  });

  it('replaces a partial arg, not duplicates it', () => {
    const r = buildRegistry();
    const g = buildGraph();
    const input = 'add node ser';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find((c) => c.value === 'server');
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add node server');
  });
});
