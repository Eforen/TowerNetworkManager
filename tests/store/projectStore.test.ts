import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  MemoryStorage,
  STORAGE_KEYS,
  StorageError,
  useGraphStore,
  useProjectStore,
} from '@/store';

function bootstrap() {
  setActivePinia(createPinia());
  const storage = new MemoryStorage();
  const project = useProjectStore();
  const graph = useGraphStore();
  project.setStorage(storage);
  return { storage, project, graph };
}

describe('projectStore – new project', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it('creates an empty project, sets active, and persists the index', () => {
    const { storage, project, graph } = bootstrap();

    project.newProject('alpha');

    expect(project.active).toBe('alpha');
    expect(project.slugs).toEqual(['alpha']);
    expect(project.dirty).toBe(false);
    expect(graph.stats.nodes).toBe(0);

    const index = JSON.parse(storage.getItem(STORAGE_KEYS.projects)!);
    expect(index).toEqual({ slugs: ['alpha'], active: 'alpha' });
  });

  it('rejects invalid slugs', () => {
    const { project } = bootstrap();
    expect(() => project.newProject('Bad Slug')).toThrow(StorageError);
    expect(() => project.newProject('-bad')).toThrow(StorageError);
  });

  it('rejects duplicate slugs', () => {
    const { project } = bootstrap();
    project.newProject('alpha');
    expect(() => project.newProject('alpha')).toThrow(StorageError);
  });
});

describe('projectStore – save / load', () => {
  it('saves the current graph text under tni.project.<slug>', () => {
    const { storage, project, graph } = bootstrap();
    project.newProject('alpha');
    graph.parseText('!tni v1\nfloor f1\n');
    project.save();

    const text = storage.getItem('tni.project.alpha');
    expect(text).toContain('!tni v1');
    expect(text).toContain('floor f1');
    expect(project.dirty).toBe(false);
  });

  it('defaults save() to the active slug; accepts an explicit one', () => {
    const { storage, project } = bootstrap();
    project.newProject('alpha');
    project.save('beta');
    expect(storage.getItem('tni.project.beta')).toContain('!tni v1');
    expect(project.slugs).toContain('beta');
    expect(project.active).toBe('beta');
  });

  it('refuses save() when no active project exists', () => {
    const { project } = bootstrap();
    expect(() => project.save()).toThrow(StorageError);
  });

  it('load() parses stored text into the graph and switches active', () => {
    const { storage, project, graph } = bootstrap();
    storage.setItem(
      'tni.project.alpha',
      '!tni v1\nfloor f1\nrack r1\nfloor[f1] -> rack[r1] :FloorAssignment\n',
    );
    project.load('alpha');
    expect(project.active).toBe('alpha');
    expect(graph.stats.nodes).toBe(2);
    expect(graph.stats.edges).toBe(1);
    expect(project.dirty).toBe(false);
  });

  it('load() throws for an unknown slug', () => {
    const { project } = bootstrap();
    expect(() => project.load('missing')).toThrow(StorageError);
  });
});

describe('projectStore – remove / list', () => {
  it('removeProject() deletes storage + index entry and resets when active', () => {
    const { storage, project, graph } = bootstrap();
    project.newProject('alpha');
    project.save();
    expect(storage.getItem('tni.project.alpha')).not.toBeNull();

    project.removeProject('alpha');
    expect(storage.getItem('tni.project.alpha')).toBeNull();
    expect(project.slugs).toEqual([]);
    expect(project.active).toBeNull();
    expect(graph.stats.nodes).toBe(0);
  });

  it('list() returns a stable snapshot of slugs', () => {
    const { project } = bootstrap();
    project.newProject('a');
    project.newProject('b');
    expect(project.list()).toEqual(['a', 'b']);
  });
});

describe('projectStore – export / import', () => {
  it('exportCurrent() returns text plus a suggested filename', () => {
    const { project, graph } = bootstrap();
    project.newProject('alpha');
    graph.parseText('!tni v1\nfloor f1\n');
    const out = project.exportCurrent();
    expect(out.filename).toBe('alpha.tni');
    expect(out.text).toContain('floor f1');
  });

  it('importText() replaces the graph and marks the project dirty', () => {
    const { project, graph } = bootstrap();
    project.newProject('alpha');
    project.importText('!tni v1\nfloor f1\nfloor f2\n');
    expect(graph.stats.nodes).toBe(2);
    expect(project.dirty).toBe(true);
  });
});

describe('projectStore – hydrate', () => {
  it('restores slug list and active project from storage', () => {
    const { storage, project } = bootstrap();
    storage.setItem(
      STORAGE_KEYS.projects,
      JSON.stringify({ slugs: ['alpha', 'beta'], active: 'beta' }),
    );
    project.hydrate();
    expect(project.slugs).toEqual(['alpha', 'beta']);
    expect(project.active).toBe('beta');
  });

  it('silently resets on a corrupt index', () => {
    const { storage, project } = bootstrap();
    storage.setItem(STORAGE_KEYS.projects, '{not json');
    project.hydrate();
    expect(project.slugs).toEqual([]);
    expect(project.active).toBeNull();
  });
});
