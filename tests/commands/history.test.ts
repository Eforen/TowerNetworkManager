import { beforeEach, describe, expect, it } from 'vitest';
import { CommandHistory, HISTORY_CAP, HISTORY_KEY } from '@/commands';
import { MemoryStorage } from '@/store';

describe('CommandHistory', () => {
  let storage: MemoryStorage;
  let hist: CommandHistory;

  beforeEach(() => {
    storage = new MemoryStorage();
    hist = new CommandHistory(storage);
  });

  it('persists to storage on push', () => {
    hist.push('echo hi');
    const raw = storage.getItem(HISTORY_KEY);
    expect(raw).toBe(JSON.stringify(['echo hi']));
  });

  it('collapses consecutive duplicates', () => {
    hist.push('echo hi');
    hist.push('echo hi');
    hist.push('echo hi');
    expect(hist.size()).toBe(1);
  });

  it('keeps alternating duplicates', () => {
    hist.push('a');
    hist.push('b');
    hist.push('a');
    expect(hist.list()).toEqual(['a', 'b', 'a']);
  });

  it('trims to the cap', () => {
    for (let i = 0; i < HISTORY_CAP + 50; i++) hist.push(`cmd ${i}`);
    expect(hist.size()).toBe(HISTORY_CAP);
    expect(hist.list()[0]).toBe(`cmd 50`);
  });

  it('walks prev/next with saved draft', () => {
    hist.push('a');
    hist.push('b');
    expect(hist.walkPrev('draft')).toBe('b');
    expect(hist.walkPrev('draft')).toBe('a');
    expect(hist.walkNext()).toBe('b');
    expect(hist.walkNext()).toBe('draft');
    expect(hist.walkNext()).toBeNull();
  });

  it('clear wipes memory and storage', () => {
    hist.push('a');
    hist.clear();
    expect(hist.size()).toBe(0);
    expect(storage.getItem(HISTORY_KEY)).toBeNull();
  });

  it('loads existing history from storage', () => {
    storage.setItem(HISTORY_KEY, JSON.stringify(['one', 'two']));
    const h = new CommandHistory(storage);
    expect(h.list()).toEqual(['one', 'two']);
  });

  it('ignores corrupt storage gracefully', () => {
    storage.setItem(HISTORY_KEY, 'not-json');
    const h = new CommandHistory(storage);
    expect(h.size()).toBe(0);
  });
});
