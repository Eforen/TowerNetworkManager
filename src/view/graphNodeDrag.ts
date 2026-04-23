import type { SimNode } from './layout';

/**
 * Map a DOM event target to a `SimNode` using `data-sim-id` on the node
 * group (Vue does not set d3 `__data__` on `g` elements). Used in tests;
 * `GraphView` primary drag path uses the key from the `v-for` item instead.
 */
export function simNodeForDrag(
  startTarget: EventTarget | null,
  simNodes: readonly SimNode[],
): SimNode | null {
  const g = startTarget && (startTarget as Element).closest?.('[data-sim-node]');
  if (!g) return null;
  const k = g.getAttribute('data-sim-id');
  if (k == null) return null;
  return simNodes.find((n) => n.id === k) ?? null;
}
