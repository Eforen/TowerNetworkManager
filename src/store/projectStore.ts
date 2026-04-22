/**
 * Project store: top-level persistence controller.
 *
 * Per docs/specs/commands.md §"Project / persistence" and
 * docs/specs/fileformat.md §"Browser storage":
 *
 *   - `new <slug>` creates an empty project and makes it active.
 *   - `load <slug>` reads `tni.project.<slug>` and replaces the graph.
 *   - `save [<slug>]` serializes the current graph and writes
 *     `tni.project.<slug>` (quota guarded at 4 MB).
 *   - `rm project <slug>` deletes the project entry.
 *   - `list projects` returns the slug list.
 *   - `export` / `import` trade file text with the caller; DOM download
 *     and file-picker glue lives in the UI layer, not here, so the store
 *     stays easy to unit-test.
 *
 * State transitions that fully replace the graph (`new`, `load`,
 * `import`) clear the dirty flag; in-place mutations bump it (Phase 4
 * wires this to FSM events).
 */

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useGraphStore } from './graphStore';
import {
  MemoryStorage,
  QUOTA_WARN_BYTES,
  StorageError,
  byteSize,
  defaultStorage,
  isValidSlug,
  readProjectText,
  readProjectsIndex,
  removeProjectText,
  writeProjectText,
  writeProjectsIndex,
  type StorageLike,
} from './storage';

export interface ProjectStoreOptions {
  storage?: StorageLike;
}

export const useProjectStore = defineStore('project', () => {
  const graphStore = useGraphStore();

  const backend = ref<StorageLike>(defaultStorage());
  const slugs = ref<string[]>([]);
  const active = ref<string | null>(null);
  const dirty = ref(false);

  const hasActive = computed(() => active.value !== null);
  const projectSize = computed(() => byteSize(graphStore.serializeText()));
  const overQuota = computed(() => projectSize.value > QUOTA_WARN_BYTES);

  /**
   * Swap out the storage backend. Primarily used by tests to inject a
   * fresh `MemoryStorage`; production code uses `defaultStorage()`.
   */
  function setStorage(next: StorageLike): void {
    backend.value = next;
  }

  /**
   * Reloads slug list and active project from storage. Silently resets
   * on a corrupt index so the UI can recover without user intervention.
   */
  function hydrate(): void {
    try {
      const idx = readProjectsIndex(backend.value);
      slugs.value = [...idx.slugs];
      active.value = idx.active || null;
    } catch (err) {
      if (err instanceof StorageError && err.code === 'invalid') {
        slugs.value = [];
        active.value = null;
        return;
      }
      throw err;
    }
  }

  function persistIndex(): void {
    writeProjectsIndex(backend.value, {
      slugs: [...slugs.value],
      active: active.value ?? '',
    });
  }

  /** Commands -------------------------------------------------------- */

  function newProject(slug: string): void {
    requireSlug(slug);
    if (slugs.value.includes(slug)) {
      throw new StorageError(
        'invalid',
        `project '${slug}' already exists`,
      );
    }
    slugs.value = [...slugs.value, slug];
    active.value = slug;
    graphStore.reset();
    dirty.value = false;
    persistIndex();
  }

  function load(slug: string): void {
    requireSlug(slug);
    const text = readProjectText(backend.value, slug);
    if (text === null) {
      throw new StorageError('invalid', `no project '${slug}' in storage`);
    }
    graphStore.parseText(text);
    active.value = slug;
    if (!slugs.value.includes(slug)) {
      slugs.value = [...slugs.value, slug];
    }
    dirty.value = false;
    persistIndex();
  }

  function save(slug?: string): void {
    const target = slug ?? active.value;
    if (!target) {
      throw new StorageError('invalid', 'no active project to save');
    }
    requireSlug(target);
    const text = graphStore.serializeText();
    writeProjectText(backend.value, target, text);
    if (!slugs.value.includes(target)) {
      slugs.value = [...slugs.value, target];
    }
    active.value = target;
    dirty.value = false;
    persistIndex();
  }

  function removeProject(slug: string): void {
    requireSlug(slug);
    removeProjectText(backend.value, slug);
    slugs.value = slugs.value.filter((s) => s !== slug);
    if (active.value === slug) {
      active.value = null;
      graphStore.reset();
      dirty.value = false;
    }
    persistIndex();
  }

  function list(): string[] {
    return [...slugs.value];
  }

  /**
   * Serialize the current graph to file text; caller handles the actual
   * browser download. Returns `{ text, filename }` so callers can wire
   * an anchor/Blob without importing the graph store themselves.
   */
  function exportCurrent(slug?: string): { text: string; filename: string } {
    const target = slug ?? active.value ?? 'untitled';
    const text = graphStore.serializeText();
    return { text, filename: `${target}.tni` };
  }

  /**
   * Replace the current graph with parsed contents of `text` and mark
   * the project dirty so the next `save` persists it. Throws if the
   * file has a syntactic or structural error.
   */
  function importText(text: string): void {
    graphStore.parseText(text);
    dirty.value = true;
  }

  function markDirty(): void {
    dirty.value = true;
  }

  function requireSlug(s: string): void {
    if (!isValidSlug(s)) {
      throw new StorageError(
        'invalid',
        `'${s}' is not a valid project slug (expected [a-z0-9][a-z0-9_-]*)`,
      );
    }
  }

  return {
    slugs,
    active,
    dirty,
    hasActive,
    projectSize,
    overQuota,
    setStorage,
    hydrate,
    newProject,
    load,
    save,
    removeProject,
    list,
    exportCurrent,
    importText,
    markDirty,
  };
});

export type ProjectStore = ReturnType<typeof useProjectStore>;

// Re-export for convenience so UI code can `new MemoryStorage()` when
// spinning up an isolated preview instance.
export { MemoryStorage };
