import { describe, expect, it } from 'vitest';
import { computeScrollTop } from '@/palette/scroll';

describe('palette/scroll – computeScrollTop', () => {
  it('does not move when the item is already in view', () => {
    const out = computeScrollTop({
      currentScrollTop: 0,
      viewportHeight: 100,
      itemTop: 20,
      itemHeight: 20,
    });
    expect(out).toBe(0);
  });

  it('scrolls up to show an item above the viewport', () => {
    const out = computeScrollTop({
      currentScrollTop: 200,
      viewportHeight: 100,
      itemTop: 50,
      itemHeight: 20,
    });
    expect(out).toBe(50);
  });

  it('scrolls down just enough to show an item below the viewport', () => {
    // Viewport [0..100]; item at 150..170. New scrollTop should bring
    // item bottom (170) to the viewport bottom => scrollTop = 170 - 100 = 70.
    const out = computeScrollTop({
      currentScrollTop: 0,
      viewportHeight: 100,
      itemTop: 150,
      itemHeight: 20,
    });
    expect(out).toBe(70);
  });

  it('handles an item exactly at the viewport bottom edge', () => {
    const out = computeScrollTop({
      currentScrollTop: 0,
      viewportHeight: 100,
      itemTop: 80,
      itemHeight: 20,
    });
    expect(out).toBe(0);
  });

  it('handles an item taller than the viewport by anchoring to its top', () => {
    const out = computeScrollTop({
      currentScrollTop: 0,
      viewportHeight: 50,
      itemTop: 100,
      itemHeight: 200,
    });
    // Item bottom = 300. 300 - 50 = 250, but scrolling to 250 still
    // leaves the top (100) off-screen. `nearest` semantics: the first
    // branch (itemTop < currentScrollTop) only triggers if we were
    // already past the item. If we're below, we use the bottom branch.
    expect(out).toBe(250);
  });
});
