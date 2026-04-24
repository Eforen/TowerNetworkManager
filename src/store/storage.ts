/**
 * Persistence adapter for the project store.
 *
 * Per docs/specs/fileformat.md §"Browser storage":
 *
 *   tni.projects           -> JSON { slugs: string[]; active: string }
 *   tni.project.<slug>     -> file text
 *   tni.project.<slug>.undo -> optional undo snapshot (Phase 14)
 *   tni.cmdhistory         -> palette history (Phase 5)
 *   tni.filter.presets     -> filter presets (Phase 7)
 *   tni.view.dataLayers    -> graph view layer toggles (Phase 6+)
 *
 * Quota guard: serialized size > 4 MB warns and refuses to write;
 * `QuotaExceededError` surfaces as `StorageError` so commands can fail
 * without corrupting state.
 *
 * `localStorage` is abstracted behind `StorageLike` so tests can inject
 * an in-memory fake that simulates `QuotaExceededError`.
 */

export const STORAGE_KEYS = {
  projects: 'tni.projects',
  cmdHistory: 'tni.cmdhistory',
  filterPresets: 'tni.filter.presets',
  viewDataLayers: 'tni.view.dataLayers',
} as const;

export function projectKey(slug: string): string {
  return `tni.project.${slug}`;
}

export function undoKey(slug: string): string {
  return `tni.project.${slug}.undo`;
}

/** 4 MB ceiling per docs/specs/fileformat.md §"Browser storage". */
export const QUOTA_WARN_BYTES = 4 * 1024 * 1024;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  key(index: number): string | null;
  readonly length: number;
}

export type StorageErrorCode =
  | 'quota-exceeded'
  | 'quota-warning'
  | 'unavailable'
  | 'invalid';

export class StorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

export interface ProjectsIndex {
  slugs: string[];
  active: string;
}

/** Slug shape per docs/specs/commands.md §"General". */
export const SLUG_RE = /^[a-z0-9][a-z0-9_-]*$/;

export function isValidSlug(s: string): boolean {
  return s.length > 0 && s.length <= 64 && SLUG_RE.test(s);
}

// ---------------------------------------------------------------------------
// Default backend (real localStorage) + an in-memory fallback used in tests
// or when running outside the browser (e.g. SSR).
// ---------------------------------------------------------------------------

export function defaultStorage(): StorageLike {
  if (typeof globalThis !== 'undefined' && 'localStorage' in globalThis) {
    return (globalThis as { localStorage: StorageLike }).localStorage;
  }
  return new MemoryStorage();
}

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();
  private order: string[] = [];

  get length(): number {
    return this.order.length;
  }
  getItem(key: string): string | null {
    return this.map.has(key) ? this.map.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    if (!this.map.has(key)) this.order.push(key);
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    if (!this.map.has(key)) return;
    this.map.delete(key);
    this.order = this.order.filter((k) => k !== key);
  }
  key(index: number): string | null {
    return this.order[index] ?? null;
  }
  clear(): void {
    this.map.clear();
    this.order = [];
  }
}

// ---------------------------------------------------------------------------
// High-level helpers used by projectStore
// ---------------------------------------------------------------------------

export function readProjectsIndex(backend: StorageLike): ProjectsIndex {
  const raw = backend.getItem(STORAGE_KEYS.projects);
  if (!raw) return { slugs: [], active: '' };
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      Array.isArray((parsed as ProjectsIndex).slugs) &&
      typeof (parsed as ProjectsIndex).active === 'string'
    ) {
      return parsed as ProjectsIndex;
    }
  } catch {
    // fall through
  }
  throw new StorageError(
    'invalid',
    `corrupt ${STORAGE_KEYS.projects} payload; reset required`,
  );
}

export function writeProjectsIndex(
  backend: StorageLike,
  index: ProjectsIndex,
): void {
  safeSetItem(backend, STORAGE_KEYS.projects, JSON.stringify(index));
}

export function readProjectText(
  backend: StorageLike,
  slug: string,
): string | null {
  return backend.getItem(projectKey(slug));
}

export function writeProjectText(
  backend: StorageLike,
  slug: string,
  text: string,
): void {
  const size = byteSize(text);
  if (size > QUOTA_WARN_BYTES) {
    throw new StorageError(
      'quota-warning',
      `project '${slug}' is ${(size / 1024 / 1024).toFixed(2)} MB, over the ${
        QUOTA_WARN_BYTES / 1024 / 1024
      } MB soft limit; export to file instead`,
    );
  }
  safeSetItem(backend, projectKey(slug), text);
}

export function removeProjectText(
  backend: StorageLike,
  slug: string,
): void {
  backend.removeItem(projectKey(slug));
  backend.removeItem(undoKey(slug));
}

/**
 * UTF-8 byte size for the quota guard. `TextEncoder` handles multi-byte
 * codepoints correctly where `string.length` would undercount.
 */
export function byteSize(s: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(s).length;
  }
  // Fallback approximation when TextEncoder is unavailable.
  return s.length;
}

function safeSetItem(backend: StorageLike, key: string, value: string): void {
  try {
    backend.setItem(key, value);
  } catch (err) {
    if (isQuotaError(err)) {
      throw new StorageError(
        'quota-exceeded',
        `localStorage quota exceeded while writing '${key}'`,
      );
    }
    throw err;
  }
}

function isQuotaError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'QuotaExceededError') return true;
  if (err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
  // Some environments (older Safari) use code 22 / 1014.
  const code = (err as unknown as { code?: number }).code;
  return code === 22 || code === 1014;
}
