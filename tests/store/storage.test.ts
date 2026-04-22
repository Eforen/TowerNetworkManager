import { beforeEach, describe, expect, it } from 'vitest';
import {
  MemoryStorage,
  QUOTA_WARN_BYTES,
  STORAGE_KEYS,
  StorageError,
  byteSize,
  isValidSlug,
  projectKey,
  readProjectText,
  readProjectsIndex,
  removeProjectText,
  writeProjectText,
  writeProjectsIndex,
} from '@/store/storage';

describe('storage – slug validation', () => {
  it('accepts kebab_snake and numeric starts', () => {
    expect(isValidSlug('alpha')).toBe(true);
    expect(isValidSlug('1-alpha_beta')).toBe(true);
    expect(isValidSlug('proj-01')).toBe(true);
  });

  it('rejects uppercase, leading dash, and empty strings', () => {
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('-bad')).toBe(false);
    expect(isValidSlug('NoUpper')).toBe(false);
    expect(isValidSlug('a b')).toBe(false);
  });
});

describe('storage – projects index', () => {
  let backend: MemoryStorage;
  beforeEach(() => {
    backend = new MemoryStorage();
  });

  it('reads an empty index when nothing is stored', () => {
    expect(readProjectsIndex(backend)).toEqual({ slugs: [], active: '' });
  });

  it('round-trips through JSON', () => {
    writeProjectsIndex(backend, { slugs: ['a', 'b'], active: 'a' });
    expect(readProjectsIndex(backend)).toEqual({ slugs: ['a', 'b'], active: 'a' });
    expect(backend.getItem(STORAGE_KEYS.projects)).toContain('"slugs"');
  });

  it('throws StorageError on corrupt JSON', () => {
    backend.setItem(STORAGE_KEYS.projects, '{not json');
    expect(() => readProjectsIndex(backend)).toThrow(StorageError);
  });
});

describe('storage – project text', () => {
  let backend: MemoryStorage;
  beforeEach(() => {
    backend = new MemoryStorage();
  });

  it('round-trips plain text', () => {
    writeProjectText(backend, 'alpha', '!tni v1\nfloor f1\n');
    expect(readProjectText(backend, 'alpha')).toBe('!tni v1\nfloor f1\n');
    expect(backend.getItem(projectKey('alpha'))).toContain('floor f1');
  });

  it('removes the project text and its undo snapshot', () => {
    writeProjectText(backend, 'alpha', '!tni v1\n');
    backend.setItem(`${projectKey('alpha')}.undo`, '[]');
    removeProjectText(backend, 'alpha');
    expect(backend.getItem(projectKey('alpha'))).toBeNull();
    expect(backend.getItem(`${projectKey('alpha')}.undo`)).toBeNull();
  });

  it('refuses writes over the 4 MB soft quota', () => {
    const big = 'x'.repeat(QUOTA_WARN_BYTES + 1);
    try {
      writeProjectText(backend, 'alpha', big);
      throw new Error('expected StorageError');
    } catch (err) {
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).code).toBe('quota-warning');
    }
  });

  it('surfaces QuotaExceededError as StorageError code="quota-exceeded"', () => {
    const failing: Pick<Storage, 'setItem'> = {
      setItem() {
        const e = new Error('quota reached');
        e.name = 'QuotaExceededError';
        throw e;
      },
    };
    const wrapped = Object.assign(new MemoryStorage(), failing);
    try {
      writeProjectText(wrapped, 'alpha', '!tni v1\n');
      throw new Error('expected StorageError');
    } catch (err) {
      expect(err).toBeInstanceOf(StorageError);
      expect((err as StorageError).code).toBe('quota-exceeded');
    }
  });

  it('byteSize counts UTF-8 bytes, not code units', () => {
    expect(byteSize('abc')).toBe(3);
    // "é" is two bytes in UTF-8
    expect(byteSize('é')).toBe(2);
  });
});
