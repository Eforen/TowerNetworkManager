import { describe, expect, it } from 'vitest';
import { tokenize, tokenizeWithCaret } from '@/commands';

describe('tokenizer', () => {
  it('splits on whitespace', () => {
    const toks = tokenize('add node server db01');
    expect(toks.map((t) => t.value)).toEqual(['add', 'node', 'server', 'db01']);
    expect(toks[0].start).toBe(0);
    expect(toks[0].end).toBe(3);
    expect(toks[1].start).toBe(4);
  });

  it('merges embedded quoted strings into the surrounding token', () => {
    const toks = tokenize('add node server --name="Casual Dweller"');
    expect(toks.map((t) => t.value)).toEqual([
      'add',
      'node',
      'server',
      '--name=Casual Dweller',
    ]);
    expect(toks[3].quoted).toBe(true);
  });

  it('preserves a lone quoted token as its unquoted value', () => {
    const toks = tokenize('echo "hello world"');
    expect(toks[1].value).toBe('hello world');
    expect(toks[1].quoted).toBe(true);
  });

  it('handles escape sequences inside quotes', () => {
    const toks = tokenize('echo "he said \\"hi\\\\"');
    expect(toks[1].value).toBe('he said "hi\\');
    expect(toks[1].quoted).toBe(true);
  });

  it('flags unterminated quotes', () => {
    const toks = tokenize('echo "open');
    expect(toks[1].unterminated).toBe(true);
  });

  it('locates the active token at caret', () => {
    const input = 'add node ser';
    const r = tokenizeWithCaret(input, input.length);
    expect(r.activeIndex).toBe(2);
    expect(r.caretAtTokenEnd).toBe(true);
  });

  it('reports no active token in whitespace between existing tokens', () => {
    const input = 'add  node';
    const r = tokenizeWithCaret(input, 4); // caret at the second space
    expect(r.activeIndex).toBe(-1);
  });

  it('returns a virtual slot after the last token when caret is at EOL', () => {
    const input = 'add node ';
    const r = tokenizeWithCaret(input, input.length);
    expect(r.activeIndex).toBe(2);
    expect(r.tokens.length).toBe(2);
  });

  it('locates token when caret is mid-token', () => {
    const input = 'add node server';
    const r = tokenizeWithCaret(input, 6);
    expect(r.activeIndex).toBe(1);
    expect(r.caretAtTokenEnd).toBe(false);
  });
});
