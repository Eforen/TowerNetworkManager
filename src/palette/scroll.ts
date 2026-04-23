/**
 * Pure scroll-into-view math for a vertical list with a fixed viewport.
 *
 * Given the viewport's current scroll offset + height and the active
 * item's offset + height, return the scrollTop that keeps the item
 * fully visible. Mirrors the common `scrollIntoView({block:'nearest'})`
 * behavior: don't move if the item is already in view; otherwise
 * minimally scroll so the item's top (or bottom) snaps to the viewport
 * edge.
 *
 * Extracted from the command palette so it can be unit-tested without
 * a real DOM layout engine.
 */
export function computeScrollTop(opts: {
  currentScrollTop: number;
  viewportHeight: number;
  itemTop: number;
  itemHeight: number;
}): number {
  const { currentScrollTop, viewportHeight, itemTop, itemHeight } = opts;
  const itemBottom = itemTop + itemHeight;
  const viewBottom = currentScrollTop + viewportHeight;
  if (itemTop < currentScrollTop) return itemTop;
  if (itemBottom > viewBottom) return itemBottom - viewportHeight;
  return currentScrollTop;
}
