import { describe, expect, it } from 'vitest';
import { CommandRegistry, type CommandDef } from '@/commands';

const make = (name: string, aliases?: string[]): CommandDef => ({
  name,
  aliases,
  summary: name,
  run: () => ({ ok: true }),
});

describe('CommandRegistry', () => {
  it('resolves single-word names', () => {
    const r = new CommandRegistry();
    r.register(make('help'));
    expect(r.resolve(['help'])?.def.name).toBe('help');
    expect(r.resolve(['help'])?.consumed).toBe(1);
  });

  it('resolves multi-word names greedily (longest first)', () => {
    const r = new CommandRegistry();
    r.register(make('add'));
    r.register(make('add node'));
    r.register(make('add node server'));
    const got = r.resolve(['add', 'node', 'server', 'db01']);
    expect(got?.def.name).toBe('add node server');
    expect(got?.consumed).toBe(3);
  });

  it('falls back to shorter match when longer absent', () => {
    const r = new CommandRegistry();
    r.register(make('add node'));
    expect(r.resolve(['add', 'node', 'server'])?.def.name).toBe('add node');
    expect(r.resolve(['add'])).toBeUndefined();
  });

  it('honors aliases (single token)', () => {
    const r = new CommandRegistry();
    r.register(make('inspect bottleneck', ['btwn']));
    expect(r.resolve(['btwn', 'a', 'b'])?.def.name).toBe('inspect bottleneck');
    expect(r.resolve(['btwn', 'a', 'b'])?.consumed).toBe(1);
  });

  it('throws on duplicate name', () => {
    const r = new CommandRegistry();
    r.register(make('help'));
    expect(() => r.register(make('help'))).toThrow();
  });

  it('throws on alias collision', () => {
    const r = new CommandRegistry();
    r.register(make('help', ['h']));
    expect(() => r.register(make('hello', ['h']))).toThrow();
  });
});
