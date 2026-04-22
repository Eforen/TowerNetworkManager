import { beforeEach, describe, expect, it } from 'vitest';
import { computed } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { useGraphStore } from '@/store';

describe('graphStore reactivity', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('serializeText() returns updated canonical text on direct call after touch', () => {
    const store = useGraphStore();
    expect(store.serializeText()).toBe('!tni v1\n');
    store.graph.addNode({ type: 'server', id: 'db01' });
    store.touch();
    const text = store.serializeText();
    expect(text).toContain('server db01');
  });

  it('invalidates vue-computed() consumers after touch()', () => {
    const store = useGraphStore();
    const canonical = computed(() => store.serializeText());
    const nodes = computed(() => store.stats.nodes);

    expect(canonical.value).toBe('!tni v1\n');
    expect(nodes.value).toBe(0);

    store.graph.addNode({ type: 'server', id: 'db01' });
    store.touch();

    expect(nodes.value).toBe(1);
    expect(canonical.value).toContain('server db01');
    expect(canonical.value).not.toBe('!tni v1\n');
  });

  it('invalidates consumers after parseText()', () => {
    const store = useGraphStore();
    const canonical = computed(() => store.serializeText());

    store.parseText('!tni v1\nfloor f1\n');
    expect(canonical.value).toContain('floor f1');
  });

  it('invalidates consumers after reset()', () => {
    const store = useGraphStore();
    store.graph.addNode({ type: 'server', id: 'db01' });
    store.touch();
    const canonical = computed(() => store.serializeText());
    expect(canonical.value).toContain('server db01');

    store.reset();
    expect(canonical.value).toBe('!tni v1\n');
  });
});
