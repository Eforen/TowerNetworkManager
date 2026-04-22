import { beforeEach, describe, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import {
  CommandHistory,
  CommandRegistry,
  execute,
  registerBuiltins,
  type CommandContext,
} from '@/commands';
import {
  MemoryStorage,
  useFsmStore,
  useGraphStore,
  useProjectStore,
} from '@/store';

function bootstrap(): { ctx: CommandContext; registry: CommandRegistry } {
  setActivePinia(createPinia());
  const registry = new CommandRegistry();
  registerBuiltins(registry);
  const graphStore = useGraphStore();
  const projectStore = useProjectStore();
  const fsmStore = useFsmStore();
  projectStore.setStorage(new MemoryStorage());
  const history = new CommandHistory(new MemoryStorage());
  const ctx: CommandContext = {
    graph: graphStore.graph,
    graphStore,
    projectStore,
    fsmStore,
    registry,
    history,
    log: () => undefined,
  };
  return { ctx, registry };
}

describe('executor pipeline', () => {
  beforeEach(() => setActivePinia(createPinia()));

  it('echo prints its arguments', async () => {
    const { ctx, registry } = bootstrap();
    const r = await execute('echo hello world', registry, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toBe('hello world');
  });

  it('add node mutates the graph and marks dirty', async () => {
    const { ctx, registry } = bootstrap();
    const r = await execute('add node server db01', registry, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.graph.hasNode('server', 'db01')).toBe(true);
    expect(ctx.projectStore.dirty).toBe(true);
  });

  it('rm node removes the node', async () => {
    const { ctx, registry } = bootstrap();
    await execute('add node server db01', registry, ctx);
    const r = await execute('rm node server db01', registry, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.graph.hasNode('server', 'db01')).toBe(false);
  });

  it('tag add appends tags', async () => {
    const { ctx, registry } = bootstrap();
    await execute('add node server db01', registry, ctx);
    const r = await execute('tag add server db01 Production', registry, ctx);
    expect(r.ok).toBe(true);
    const node = ctx.graph.getNode('server', 'db01');
    expect(node?.tags).toContain('Production');
  });

  it('errors on unknown command', async () => {
    const { ctx, registry } = bootstrap();
    const r = await execute('nope', registry, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('UNKNOWN_COMMAND');
  });

  it('errors on bad args', async () => {
    const { ctx, registry } = bootstrap();
    const r = await execute('add node', registry, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errorCode).toBe('BAD_ARGS');
  });

  it('save persists current graph', async () => {
    const { ctx, registry } = bootstrap();
    await execute('new demo', registry, ctx);
    await execute('add node server db01', registry, ctx);
    const r = await execute('save', registry, ctx);
    expect(r.ok).toBe(true);
    expect(ctx.projectStore.dirty).toBe(false);
  });

  it('help lists registered commands', async () => {
    const { ctx, registry } = bootstrap();
    const r = await execute('help', registry, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.message).toContain('add node');
  });
});
