import { describe, expect, it } from 'vitest';
import { parseArgs, tokenize, type CommandDef } from '@/commands';

const addNode: CommandDef = {
  name: 'add node',
  summary: 'add a node',
  argSpec: [
    { name: 'nodeType', type: 'nodeType', required: true },
    { name: 'id', type: 'string' },
  ],
  flags: [
    { name: 'name', takesValue: true },
    { name: 'tag', takesValue: true, repeatable: true },
    { name: 'force', takesValue: false },
  ],
  run: () => ({ ok: true }),
};

describe('parseArgs', () => {
  it('binds positional args', () => {
    const toks = tokenize('server db01');
    const got = parseArgs(addNode, toks);
    expect(got.ok).toBe(true);
    if (got.ok) expect(got.args.positional).toEqual(['server', 'db01']);
  });

  it('parses inline flags --k=v', () => {
    const toks = tokenize('server db01 --name=Foo');
    const got = parseArgs(addNode, toks);
    if (!got.ok) throw new Error(got.error);
    expect(got.args.flags.name).toBe('Foo');
  });

  it('parses spaced flags --k v', () => {
    const toks = tokenize('server db01 --name Foo');
    const got = parseArgs(addNode, toks);
    if (!got.ok) throw new Error(got.error);
    expect(got.args.flags.name).toBe('Foo');
  });

  it('collects repeatable flags into arrays', () => {
    const toks = tokenize('server db01 --tag=A --tag B');
    const got = parseArgs(addNode, toks);
    if (!got.ok) throw new Error(got.error);
    expect(got.args.flags.tag).toEqual(['A', 'B']);
  });

  it('boolean flags set to true', () => {
    const toks = tokenize('server db01 --force');
    const got = parseArgs(addNode, toks);
    if (!got.ok) throw new Error(got.error);
    expect(got.args.flags.force).toBe(true);
  });

  it('errors on missing required arg', () => {
    const toks = tokenize('');
    const got = parseArgs(addNode, toks);
    expect(got.ok).toBe(false);
  });

  it('errors on unterminated quote', () => {
    const toks = tokenize('server "db');
    const got = parseArgs(addNode, toks);
    expect(got.ok).toBe(false);
  });

  it('variadic trailing arg absorbs the rest', () => {
    const echo: CommandDef = {
      name: 'echo',
      summary: 'echo',
      argSpec: [{ name: 'text', type: 'string', variadic: true }],
      run: () => ({ ok: true }),
    };
    const toks = tokenize('hello world "with spaces"');
    const got = parseArgs(echo, toks);
    if (!got.ok) throw new Error(got.error);
    expect(got.args.positional).toEqual(['hello', 'world', 'with spaces']);
  });

  it('coerces numbers', () => {
    const cmd: CommandDef = {
      name: 'set',
      summary: 's',
      argSpec: [{ name: 'n', type: 'number', required: true }],
      run: () => ({ ok: true }),
    };
    const got = parseArgs(cmd, tokenize('42'));
    if (!got.ok) throw new Error(got.error);
    expect(got.args.positional[0]).toBe(42);
  });
});
