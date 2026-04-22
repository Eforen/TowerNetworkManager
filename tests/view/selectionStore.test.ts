import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useSelectionStore } from '@/store';

describe('selectionStore', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('starts empty', () => {
    const sel = useSelectionStore();
    expect(sel.count).toBe(0);
    expect(sel.primary).toBeNull();
  });

  it('set replaces the selection', () => {
    const sel = useSelectionStore();
    sel.set(['server:db01', 'server:db02']);
    expect(sel.count).toBe(2);
    expect(sel.isSelected('server:db01')).toBe(true);
  });

  it('toggle adds/removes', () => {
    const sel = useSelectionStore();
    sel.toggle('server:db01');
    expect(sel.isSelected('server:db01')).toBe(true);
    sel.toggle('server:db01');
    expect(sel.isSelected('server:db01')).toBe(false);
  });

  it('clear empties', () => {
    const sel = useSelectionStore();
    sel.set(['a:1', 'a:2']);
    sel.clear();
    expect(sel.count).toBe(0);
  });

  it('hover is separate from selection', () => {
    const sel = useSelectionStore();
    sel.set(['a:1']);
    sel.setHover('a:2');
    expect(sel.hovered).toBe('a:2');
    expect(sel.isSelected('a:2')).toBe(false);
  });
});
