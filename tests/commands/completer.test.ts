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

describe('add link completions', () => {
  function linkGraph(): Graph {
    const g = new Graph();
    g.addNode({ type: 'customer', id: 'organic-goat' });
    g.addNode({ type: 'customer', id: 'casual-dweller' });
    g.addNode({ type: 'networkaddress', id: '@f1/c/3' });
    g.addNode({ type: 'port', id: '52682', tags: ['UserPort', 'RJ45'] });
    g.addNode({ type: 'server', id: 'db01' });
    return g;
  }

  function serverlessGraph(): Graph {
    const g = new Graph();
    g.addNode({ type: 'customer', id: 'organic-goat' });
    g.addNode({ type: 'port', id: '52682', tags: ['UserPort', 'RJ45'] });
    return g;
  }

  it('suggests node types with `[` after `add link `', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link ';
    const { candidates, hint } = complete(input, input.length, r, g);
    expect(hint).toContain('typedRef');
    const values = candidates.map((c) => c.value);
    expect(values).toContain('customer[');
    expect(values).toContain('server[');
  });

  it('filters type prefixes for the from typed-ref', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link cust';
    const { candidates } = complete(input, input.length, r, g);
    const values = candidates.map((c) => c.value);
    expect(values).toContain('customer[');
    expect(values.every((v) => v.toLowerCase().startsWith('cust'))).toBe(true);
  });

  it('suggests node ids after `add link customer[`', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link customer[';
    const { candidates } = complete(input, input.length, r, g);
    const values = candidates.map((c) => c.value);
    expect(values).toContain('customer[organic-goat]');
    expect(values).toContain('customer[casual-dweller]');
  });

  it('filters node ids by prefix inside the brackets', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link customer[org';
    const { candidates } = complete(input, input.length, r, g);
    const values = candidates.map((c) => c.value);
    expect(values).toContain('customer[organic-goat]');
    expect(values).not.toContain('customer[casual-dweller]');
  });

  it('suggests the to typed-ref after a complete from', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link customer[organic-goat] netw';
    const { candidates } = complete(input, input.length, r, g);
    const values = candidates.map((c) => c.value);
    expect(values).toContain('networkaddress[');
  });

  it('restricts relation candidates to those legal for the two endpoints', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link customer[organic-goat] networkaddress[@f1/c/3] ';
    const { candidates, hint } = complete(input, input.length, r, g);
    expect(hint).toContain('relation');
    const values = candidates.map((c) => c.value);
    // AssignedTo is the canonical relation between those two (in either
    // order via auto-flip). Unrelated relations should not appear.
    expect(values).toContain('AssignedTo');
    expect(values).not.toContain('NIC');
  });

  it('filters relation candidates by the typed partial', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link customer[organic-goat] port[52682] Ow';
    const { candidates } = complete(input, input.length, r, g);
    const values = candidates.map((c) => c.value);
    expect(values).toContain('Owner');
    expect(values.every((v) => v.startsWith('Ow'))).toBe(true);
  });

  it('applyCandidate finishes a typed-ref without duplicating', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link cust';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find((c) => c.value === 'customer[');
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add link customer[');
  });

  // Regression for the reported bug: typing `add link server[` on a graph
  // with NO server nodes used to return 0 candidates, so the popup stayed
  // hidden and it looked like autocomplete was broken. We now emit a
  // non-insertable sentinel so the user gets immediate feedback.
  it('emits an explanatory sentinel when the type has no nodes', () => {
    const r = buildRegistry();
    const g = serverlessGraph();
    const input = 'add link server[';
    const { candidates } = complete(input, input.length, r, g);
    expect(candidates.length).toBe(1);
    expect(candidates[0].label).toMatch(/no server nodes/);
    expect(candidates[0].value).toBe('server[');
  });

  it('emits a no-match sentinel when ids do not match the prefix', () => {
    const r = buildRegistry();
    const g = linkGraph();
    // `port` exists (id 52682) but no id starts with `z`.
    const input = 'add link port[z';
    const { candidates } = complete(input, input.length, r, g);
    expect(candidates.length).toBe(1);
    expect(candidates[0].label).toMatch(/no port.*matches/);
  });

  it('applyCandidate finishes a typed-ref id without duplicating', () => {
    const r = buildRegistry();
    const g = linkGraph();
    const input = 'add link customer[org';
    const { candidates, replace } = complete(input, input.length, r, g);
    const cand = candidates.find(
      (c) => c.value === 'customer[organic-goat]',
    );
    expect(cand).toBeDefined();
    const out = applyCandidate(input, cand!, replace);
    expect(out.buffer).toBe('add link customer[organic-goat]');
  });
});
