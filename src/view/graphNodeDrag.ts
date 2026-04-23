import type { SimNode } from './layout';

/**
 * d3-drag passes datum from `__data__` on the selected `g`, but Vue `v-for`
 * never sets that. Each node group carries `data-sim-id="${nodeKey}"` so the
 * SimNode can be resolved from the live simulation array.
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
