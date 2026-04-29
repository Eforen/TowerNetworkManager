/**
 * Drag store.
 *
 * Holds the single object currently being pointer-dragged across the
 * whole UI, or `null`. The active target is set on pointer-down by the
 * thing that started the drag and is cleared only on pointer-up /
 * pointer-cancel by that same handler.
 *
 * Why this exists: hover handlers on nodes / edges / panels were
 * stomping on each other during a drag (hovering another shape mid-drag
 * could change `hoverKey`, hide the dragged tooltip, or otherwise break
 * the gesture). Consumers consult `isDragging` to bail out of
 * incidental hover work while a drag is in flight, so the originator of
 * the gesture stays in control until release.
 */

import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { NodeKey } from '@/model';

export type DragTarget =
  | { kind: 'node'; key: NodeKey }
  | { kind: 'other'; id: string };

export const useDragStore = defineStore('drag', () => {
  const target = shallowRef<DragTarget | null>(null);

  const isDragging = computed(() => target.value !== null);

  function begin(t: DragTarget): void {
    target.value = t;
  }

  function end(): void {
    target.value = null;
  }

  function isDraggingNode(key: NodeKey): boolean {
    const t = target.value;
    return t?.kind === 'node' && t.key === key;
  }

  return { target, isDragging, begin, end, isDraggingNode };
});

export type DragStore = ReturnType<typeof useDragStore>;
