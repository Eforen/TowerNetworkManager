/**
 * Reactive wrapper around the `Graph` model class.
 *
 * Pinia store responsibilities:
 *
 *   - Hold the active graph as a shallow ref so replacing it (via parse /
 *     new-project / import) triggers a single reactivity tick.
 *   - Expose pure derived state (stats + validation report) as computed
 *     getters; downstream components never have to call `validate()`
 *     directly.
 *   - Offer parse/serialize passthroughs so other stores (notably
 *     `projectStore`) do not need their own references to `@/format`.
 *
 * Mutation through this store always replaces the underlying Graph; the
 * class itself is not a reactive object. For Phase 3 that is sufficient
 * because all write paths (new/load/import) are whole-graph swaps.
 */

import { computed, shallowRef } from 'vue';
import { defineStore } from 'pinia';
import { parse, serialize } from '@/format';
import { Graph, validate } from '@/model';

export const useGraphStore = defineStore('graph', () => {
  const graph = shallowRef<Graph>(new Graph());
  const revision = shallowRef(0);

  const stats = computed(() => {
    void revision.value;
    return graph.value.stats();
  });

  const report = computed(() => {
    void revision.value;
    return validate(graph.value);
  });

  function reset(): void {
    graph.value = new Graph();
    revision.value++;
  }

  function parseText(text: string): void {
    const { graph: next } = parse(text);
    graph.value = next;
    revision.value++;
  }

  function serializeText(): string {
    return serialize(graph.value);
  }

  return {
    graph,
    revision,
    stats,
    report,
    reset,
    parseText,
    serializeText,
  };
});

export type GraphStore = ReturnType<typeof useGraphStore>;
