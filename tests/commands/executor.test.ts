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

describe('add link', () => {
  beforeEach(() => setActivePinia(createPinia()));

  async function seed(ctx: CommandContext, registry: CommandRegistry) {
    await execute('add node customer organic-goat', registry, ctx);
    await execute('add node port 52682', registry, ctx);
    await execute('tag add port 52682 UserPort', registry, ctx);
    await execute('tag add port 52682 RJ45', registry, ctx);
    await execute('add node networkaddress @f1/c/3', registry, ctx);
  }

  it('creates an explicit-relation edge in typed-ref form', async () => {
    const { ctx, registry } = bootstrap();
    await seed(ctx, registry);
    const r = await execute(
      'add link customer[organic-goat] port[52682] Owner',
      registry,
      ctx,
    );
    expect(r.ok).toBe(true);
    const edges = [...ctx.graph.edges.values()];
    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('Owner');
    expect(edges[0].fromKey).toBe('customer:organic-goat');
    expect(edges[0].toKey).toBe('port:52682');
  });

  it('infers the relation when only one pair is legal', async () => {
    const { ctx, registry } = bootstrap();
    await seed(ctx, registry);
    const r = await execute(
      'add link customer[organic-goat] networkaddress[@f1/c/3]',
      registry,
      ctx,
    );
    expect(r.ok).toBe(true);
    const edges = [...ctx.graph.edges.values()];
    expect(edges.length).toBe(1);
    expect(edges[0].relation).toBe('AssignedTo');
    // Auto-flipped: networkaddress -> customer per registry.
    expect(edges[0].fromKey).toBe('networkaddress:@f1/c/3');
    expect(edges[0].toKey).toBe('customer:organic-goat');
  });

  it('auto-flips direction when relation is legal only in the reverse order', async () => {
    const { ctx, registry } = bootstrap();
    await seed(ctx, registry);
    const r = await execute(
      'add link customer[organic-goat] networkaddress[@f1/c/3] AssignedTo',
      registry,
      ctx,
    );
    expect(r.ok).toBe(true);
    const edges = [...ctx.graph.edges.values()];
    expect(edges[0].fromKey).toBe('networkaddress:@f1/c/3');
    expect(edges[0].toKey).toBe('customer:organic-goat');
  });

  it('errors when the pair is ambiguous without a relation', async () => {
    const { ctx, registry } = bootstrap();
    await execute('add node domain "example.com"', registry, ctx);
    await execute('add node usagetype stream-video', registry, ctx);
    const r = await execute(
      'add link domain[example.com] usagetype[stream-video]',
      registry,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/ambiguous/);
  });

  it('errors when the relation is invalid for either direction', async () => {
    const { ctx, registry } = bootstrap();
    await seed(ctx, registry);
    const r = await execute(
      'add link customer[organic-goat] port[52682] AssignedTo',
      registry,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/AssignedTo/);
  });

  it('errors when an endpoint node does not exist', async () => {
    const { ctx, registry } = bootstrap();
    await seed(ctx, registry);
    const r = await execute(
      'add link customer[organic-goat] port[99999] Owner',
      registry,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/no such node/);
  });

  it('errors when an argument is not a typed-ref', async () => {
    const { ctx, registry } = bootstrap();
    await seed(ctx, registry);
    const r = await execute(
      'add link organic-goat port[52682] Owner',
      registry,
      ctx,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/type\[id\]/);
  });

  it('accepts edge properties via --prop', async () => {
    const { ctx, registry } = bootstrap();
    await execute('add node port 0', registry, ctx);
    // add_link needs a device port; id `0` is a user-port-shaped id but we
    // just want any edge with props. Use NIC switch->port edge instead:
    await execute('add node switch sw1', registry, ctx);
    await execute('add node port port1', registry, ctx);
    const r = await execute(
      'add link switch[sw1] port[port1] NIC --prop mode=trunk',
      registry,
      ctx,
    );
    expect(r.ok).toBe(true);
    const edges = [...ctx.graph.edges.values()];
    expect(edges[0].properties.mode).toBe('trunk');
  });
});
