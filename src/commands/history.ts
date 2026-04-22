/**
 * Command palette history persisted to localStorage per
 * docs/specs/commandline.md §"History".
 *
 * Rules:
 *   - Key: `tni.cmdhistory`
 *   - Cap: 200 entries
 *   - Consecutive duplicates collapsed
 *   - Stored as a JSON array of strings
 *
 * The class takes an injectable `StorageLike` so tests can use a memory
 * backing. It exposes a cursor (`walkPrev` / `walkNext` / `reset`) for
 * Up/Down arrow navigation.
 */

import { defaultStorage, type StorageLike } from '@/store';

export const HISTORY_KEY = 'tni.cmdhistory';
export const HISTORY_CAP = 200;

export class CommandHistory {
  private entries: string[] = [];
  private cursor = -1;
  private draft = '';

  constructor(private readonly storage: StorageLike = defaultStorage()) {
    this.load();
  }

  /** Entries in oldest-first order. */
  list(): readonly string[] {
    return this.entries;
  }

  size(): number {
    return this.entries.length;
  }

  /** Persist-and-append. Collapses consecutive duplicates. Trims to cap. */
  push(entry: string): void {
    const trimmed = entry.trim();
    if (trimmed.length === 0) return;
    const last = this.entries[this.entries.length - 1];
    if (last !== trimmed) {
      this.entries.push(trimmed);
      if (this.entries.length > HISTORY_CAP) {
        this.entries.splice(0, this.entries.length - HISTORY_CAP);
      }
      this.save();
    }
    this.cursor = -1;
    this.draft = '';
  }

  /** Wipe both memory and storage. */
  clear(): void {
    this.entries = [];
    this.cursor = -1;
    this.draft = '';
    try {
      this.storage.removeItem(HISTORY_KEY);
    } catch {
      // swallow
    }
  }

  /**
   * Arrow-up. Pass the current editor buffer so the "below history"
   * position can be restored on arrow-down. Returns the entry to show
   * or `null` if history is empty.
   */
  walkPrev(currentBuffer: string): string | null {
    if (this.entries.length === 0) return null;
    if (this.cursor === -1) {
      this.draft = currentBuffer;
      this.cursor = this.entries.length - 1;
    } else if (this.cursor > 0) {
      this.cursor--;
    }
    return this.entries[this.cursor];
  }

  /** Arrow-down. Returns the next newer entry, the saved draft, or null. */
  walkNext(): string | null {
    if (this.cursor === -1) return null;
    if (this.cursor < this.entries.length - 1) {
      this.cursor++;
      return this.entries[this.cursor];
    }
    this.cursor = -1;
    const draft = this.draft;
    this.draft = '';
    return draft;
  }

  /** Discard walk state without touching entries (called on Enter / Esc). */
  reset(): void {
    this.cursor = -1;
    this.draft = '';
  }

  private load(): void {
    try {
      const raw = this.storage.getItem(HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        this.entries = parsed.filter(
          (v): v is string => typeof v === 'string',
        );
      }
    } catch {
      this.entries = [];
    }
  }

  private save(): void {
    try {
      this.storage.setItem(HISTORY_KEY, JSON.stringify(this.entries));
    } catch {
      // Quota errors are non-fatal for history.
    }
  }
}
