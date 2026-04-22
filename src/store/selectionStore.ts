/**
 * Selection store.
 *
 * Holds the currently selected node keys (`${type}:${id}`) and the
 * "hover" node, if any. Kept orthogonal from `graphStore` so the graph
 * data can be replaced without clearing selection until `reset()` is
 * called explicitly.
 *
 * Multi-select is driven by shift-click in `GraphView.vue`; the palette
 * will register `select` / `clear selection` commands against this
 * store in a later phase.
 */

import { computed, ref, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import type { NodeKey } from '@/model';

export const useSelectionStore = defineStore('selection', () => {
  const selected = ref<Set<NodeKey>>(new Set());
  const hovered = shallowRef<NodeKey | null>(null);

  const count = computed(() => selected.value.size);
  const primary = computed<NodeKey | null>(() => {
    for (const k of selected.value) return k;
    return null;
  });

  function isSelected(key: NodeKey): boolean {
    return selected.value.has(key);
  }

  function set(keys: readonly NodeKey[]): void {
    selected.value = new Set(keys);
  }

  function add(key: NodeKey): void {
    if (selected.value.has(key)) return;
    const next = new Set(selected.value);
    next.add(key);
    selected.value = next;
  }

  function toggle(key: NodeKey): void {
    const next = new Set(selected.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selected.value = next;
  }

  function clear(): void {
    if (selected.value.size === 0) return;
    selected.value = new Set();
  }

  function setHover(key: NodeKey | null): void {
    hovered.value = key;
  }

  return {
    selected,
    hovered,
    count,
    primary,
    isSelected,
    set,
    add,
    toggle,
    clear,
    setHover,
  };
});

export type SelectionStore = ReturnType<typeof useSelectionStore>;
