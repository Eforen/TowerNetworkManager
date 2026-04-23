/**
 * Phase-5 starter command catalog.
 *
 * We ship enough commands to exercise the end-to-end pipeline (graph
 * mutation, tab completion, project IO, utility). The larger catalog
 * from docs/specs/commands.md lands incrementally in later phases.
 */

import {
  expandPortLayoutToMediaList,
  isNodeType,
  RELATION_META,
  RELATION_NAMES,
  relationsForPair,
  type NodePatch,
  type NodeType,
  type RelationName,
} from '@/model';
import type { CommandDef, CommandResult } from './types';
import type { CommandRegistry } from './registry';

const DEVICE_PORT_LAYOUT: ReadonlySet<string> = new Set([
  'server',
  'switch',
  'router',
]);

/** Positional media token on `add node userport|uplink <id> <token>`. */
const CMD_LINE_MEDIA: Record<string, 'RJ45' | 'FiberOptic'> = {
  rj45: 'RJ45',
  rj: 'RJ45',
  fiberoptic: 'FiberOptic',
  fiber: 'FiberOptic',
  f: 'FiberOptic',
};

const addNode: CommandDef = {
  name: 'add node',
  summary:
    'Create a node. Devices: `add node server s1 RJ45[2] FIBER` or `--prop portLayout=…`. Customer port: `add node userport 52682 RJ45`. Uplink: `add node uplink mtvw FIBER`.',
  undoable: true,
  argSpec: [
    { name: 'nodeType', type: 'nodeType', required: true },
    { name: 'rest', type: 'string', variadic: true },
  ],
  flags: [
    { name: 'id', takesValue: true },
    { name: 'name', takesValue: true },
    { name: 'tag', takesValue: true, repeatable: true },
    { name: 'prop', takesValue: true, repeatable: true },
  ],
  run(args, ctx): CommandResult {
    const pos = args.positional;
    const nodeType = String(pos[0] ?? '');
    if (!isNodeType(nodeType)) {
      return { ok: false, message: `unknown node type: ${nodeType}` };
    }
    const tail = pos.slice(1).map(String);
    const flagId = flagString(args.flags.id);
    let tagList = flagList(args.flags.tag).map(String);
    const propEntries = flagList(args.flags.prop).map(String);
    const properties: Record<string, string | number | boolean> = {};
    const nameFlag = flagString(args.flags.name);
    if (nameFlag !== undefined) properties.name = String(nameFlag);
    for (const raw of propEntries) {
      const eq = String(raw).indexOf('=');
      if (eq === -1) {
        return { ok: false, message: `bad --prop (need key=value): ${raw}` };
      }
      const k = String(raw).slice(0, eq);
      const v = String(raw).slice(eq + 1);
      const num = Number(v);
      properties[k] = Number.isFinite(num) && v.trim() !== '' ? num : v;
    }

    const isLayoutDevice = DEVICE_PORT_LAYOUT.has(nodeType);
    const isUserportOrUplink = nodeType === 'userport' || nodeType === 'uplink';
    let id: string;
    let linePortLayout = '';

    if (isUserportOrUplink) {
      if (flagId !== undefined) {
        return {
          ok: false,
          message: `use positionals only: add node ${nodeType} <id> <RJ45|FiberOptic|…> (no --id)`,
        };
      }
      if (tail.length !== 2) {
        return {
          ok: false,
          message: `expected add node ${nodeType} <id> <RJ45|FiberOptic|FIBER|…>`,
        };
      }
      const rawId = String(tail[0]!);
      id = nodeType === 'uplink' ? rawId.toLowerCase() : rawId;
      const medKey = String(tail[1]!).toLowerCase();
      const med = CMD_LINE_MEDIA[medKey];
      if (!med) {
        return {
          ok: false,
          message: `unknown media ${JSON.stringify(tail[1])} (try RJ45 or FIBER)`,
        };
      }
      tagList = [...tagList, med];
    } else if (isLayoutDevice) {
      if (flagId !== undefined) {
        id = String(flagId);
        linePortLayout = tail.join(' ').trim();
      } else if (tail.length === 0) {
        id = autoId(ctx.graph, nodeType as NodeType);
        linePortLayout = '';
      } else {
        id = String(tail[0]!);
        linePortLayout = tail.slice(1).join(' ').trim();
      }
    } else {
      if (flagId !== undefined) {
        id = String(flagId);
        if (tail.length > 0) {
          return {
            ok: false,
            message: `unexpected argument(s) for ${nodeType}: ${tail.join(' ')} (use --id, or use only positionals, not both)`,
          };
        }
        linePortLayout = '';
      } else if (tail.length === 0) {
        id = autoId(ctx.graph, nodeType as NodeType);
        linePortLayout = '';
      } else if (tail.length === 1) {
        id = String(tail[0]!);
        linePortLayout = '';
      } else {
        return {
          ok: false,
          message: `unexpected extra argument(s) for ${nodeType}: ${tail.slice(1).join(' ')}`,
        };
      }
    }

    if (linePortLayout.length > 0) {
      try {
        expandPortLayoutToMediaList(linePortLayout);
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
      properties.portLayout = linePortLayout;
    }
    try {
      const node = ctx.graph.addNode({
        type: nodeType as NodeType,
        id,
        tags: tagList,
        properties,
      });
      ctx.graphStore.touch();
      ctx.projectStore.markDirty();
      return {
        ok: true,
        message: `added ${node.type}[${node.id}]`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const modNode: CommandDef = {
  name: 'mod node',
  summary: 'Update name, tags, and node properties in place',
  undoable: true,
  argSpec: [
    { name: 'nodeType', type: 'nodeType', required: true },
    { name: 'id', type: 'nodeId', required: true },
  ],
  flags: [
    { name: 'name', takesValue: true },
    { name: 'tag+', takesValue: true, repeatable: true },
    { name: 'tag-', takesValue: true, repeatable: true },
    { name: 'prop', takesValue: true, repeatable: true },
    { name: 'unprop', takesValue: true, repeatable: true },
  ],
  run(args, ctx): CommandResult {
    const nodeType = String(args.positional[0]);
    const id = String(args.positional[1]);
    if (!isNodeType(nodeType)) {
      return { ok: false, message: `unknown node type: ${nodeType}` };
    }
    const n = ctx.graph.getNode(nodeType as NodeType, id);
    if (!n) {
      return { ok: false, message: `no such node ${nodeType}[${id}]` };
    }
    const nameFlag = flagString(args.flags.name);
    const tagAdds = flagList(args.flags['tag+']).map(String);
    const tagRems = flagList(args.flags['tag-']).map(String);
    const unprops = flagList(args.flags.unprop).map(String);
    const propEntries = flagList(args.flags.prop).map(String);

    const nextProps: Record<string, string | number | boolean> = {};
    for (const raw of propEntries) {
      const s = String(raw);
      const eq = s.indexOf('=');
      if (eq === -1) {
        return { ok: false, message: `bad --prop (need key=value): ${raw}` };
      }
      const k = s.slice(0, eq);
      const v = s.slice(eq + 1);
      const num = Number(v);
      nextProps[k] = Number.isFinite(num) && v.trim() !== '' ? num : v;
    }
    if (nameFlag !== undefined) nextProps.name = String(nameFlag);

    if (nextProps.portLayout !== undefined) {
      const pl = String(nextProps.portLayout).trim();
      if (pl.length) {
        try {
          expandPortLayoutToMediaList(pl);
        } catch (e) {
          return { ok: false, message: (e as Error).message };
        }
      }
    }

    const propertyRemove: string[] = unprops
      .map((x) => String(x).trim())
      .filter((x) => x.length > 0);

    let nextTags: string[] | undefined;
    if (tagAdds.length > 0 || tagRems.length > 0) {
      const tset = new Set([...n.tags]);
      for (const t of tagRems) tset.delete(t);
      for (const t of tagAdds) tset.add(t);
      nextTags = [...tset];
    }

    const patch: NodePatch = {};
    if (nextTags) patch.tags = nextTags;
    if (propertyRemove.length) patch.propertyRemove = propertyRemove;
    if (Object.keys(nextProps).length > 0) patch.properties = nextProps;
    if (!patch.tags && !patch.properties && !patch.propertyRemove) {
      return {
        ok: false,
        message: 'nothing to change (use --name, --tag+, --tag-, --prop, or --unprop)',
      };
    }
    try {
      ctx.graph.updateNode(nodeType as NodeType, id, patch);
      ctx.graphStore.touch();
      ctx.projectStore.markDirty();
      return { ok: true, message: `updated ${nodeType}[${id}]` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const addLink: CommandDef = {
  name: 'add link',
  summary:
    'Create an edge between two nodes: `add link type[id] type[id] [Relation]`',
  undoable: true,
  argSpec: [
    { name: 'from', type: 'typedRef', required: true },
    { name: 'to', type: 'typedRef', required: true },
    { name: 'relation', type: 'relation' },
  ],
  flags: [{ name: 'prop', takesValue: true, repeatable: true }],
  run(args, ctx): CommandResult {
    const [rawFrom, rawTo, rawRel] = args.positional;
    const from = parseTypedRef(String(rawFrom));
    if (!from.ok) return { ok: false, message: `bad from: ${from.error}` };
    const to = parseTypedRef(String(rawTo));
    if (!to.ok) return { ok: false, message: `bad to: ${to.error}` };

    if (!ctx.graph.getNode(from.ref.type, from.ref.id)) {
      return {
        ok: false,
        message: `no such node ${from.ref.type}[${from.ref.id}]`,
      };
    }
    if (!ctx.graph.getNode(to.ref.type, to.ref.id)) {
      return {
        ok: false,
        message: `no such node ${to.ref.type}[${to.ref.id}]`,
      };
    }

    let relation: RelationName | undefined;
    if (rawRel !== undefined) {
      const word = String(rawRel);
      if (!(RELATION_NAMES as readonly string[]).includes(word)) {
        return { ok: false, message: `unknown relation: ${word}` };
      }
      relation = word as RelationName;
    }

    const resolved = resolveLinkDirection(from.ref, to.ref, relation);
    if (!resolved.ok) return { ok: false, message: resolved.error };

    const properties: Record<string, string | number | boolean> = {};
    for (const raw of flagList(args.flags.prop).map(String)) {
      const eq = raw.indexOf('=');
      if (eq === -1) {
        return { ok: false, message: `bad --prop (need key=value): ${raw}` };
      }
      const k = raw.slice(0, eq);
      const v = raw.slice(eq + 1);
      const num = Number(v);
      properties[k] = Number.isFinite(num) && v.trim() !== '' ? num : v;
    }

    try {
      const edge = ctx.graph.addEdge({
        relation: resolved.relation,
        from: resolved.from,
        to: resolved.to,
        properties,
      });
      ctx.graphStore.touch();
      ctx.projectStore.markDirty();
      return {
        ok: true,
        message: `added ${resolved.from.type}[${resolved.from.id}] -> ${resolved.to.type}[${resolved.to.id}] :${edge.relation}`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const rmNode: CommandDef = {
  name: 'rm node',
  summary: 'Remove a node and its incident edges',
  undoable: true,
  argSpec: [
    { name: 'nodeType', type: 'nodeType', required: true },
    { name: 'id', type: 'nodeId', required: true },
  ],
  flags: [{ name: 'force', takesValue: false }],
  run(args, ctx): CommandResult {
    const [rawType, rawId] = args.positional;
    const nodeType = String(rawType);
    if (!isNodeType(nodeType)) {
      return { ok: false, message: `unknown node type: ${nodeType}` };
    }
    const id = String(rawId);
    const removed = ctx.graph.removeNode(nodeType as NodeType, id);
    if (!removed) {
      return { ok: false, message: `no such node ${nodeType}[${id}]` };
    }
    ctx.graphStore.touch();
    ctx.projectStore.markDirty();
    return { ok: true, message: `removed ${nodeType}[${id}]` };
  },
};

const tagAdd: CommandDef = {
  name: 'tag add',
  summary: 'Add one or more tags to a node',
  undoable: true,
  argSpec: [
    { name: 'nodeType', type: 'nodeType', required: true },
    { name: 'id', type: 'nodeId', required: true },
    { name: 'tags', type: 'tag', required: true, variadic: true },
  ],
  run(args, ctx): CommandResult {
    const [rawType, rawId, ...tagsRaw] = args.positional;
    const nodeType = String(rawType);
    if (!isNodeType(nodeType)) {
      return { ok: false, message: `unknown node type: ${nodeType}` };
    }
    const id = String(rawId);
    const node = ctx.graph.getNode(nodeType as NodeType, id);
    if (!node) {
      return { ok: false, message: `no such node ${nodeType}[${id}]` };
    }
    const next = new Set(node.tags);
    for (const t of tagsRaw) next.add(String(t));
    try {
      ctx.graph.updateNode(nodeType as NodeType, id, { tags: [...next] });
      ctx.graphStore.touch();
      ctx.projectStore.markDirty();
      return {
        ok: true,
        message: `${nodeType}[${id}] tags: ${[...next].join(', ')}`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const tagList: CommandDef = {
  name: 'tag list',
  summary: 'List tags on a node (read-only)',
  argSpec: [
    { name: 'nodeType', type: 'nodeType', required: true },
    { name: 'id', type: 'nodeId', required: true },
  ],
  run(args, ctx): CommandResult {
    const [rawType, rawId] = args.positional;
    const node = ctx.graph.getNode(String(rawType) as NodeType, String(rawId));
    if (!node) {
      return { ok: false, message: `no such node ${rawType}[${rawId}]` };
    }
    return { ok: true, message: `tags: ${node.tags.join(', ') || '(none)'}` };
  },
};

const echo: CommandDef = {
  name: 'echo',
  summary: 'Print text to the status line',
  argSpec: [{ name: 'text', type: 'string', variadic: true }],
  run(args): CommandResult {
    const text = args.positional.map(String).join(' ');
    return { ok: true, message: text };
  },
};

const help: CommandDef = {
  name: 'help',
  summary: 'List commands or show detail for one',
  argSpec: [{ name: 'command', type: 'string' }],
  run(args, ctx): CommandResult {
    const target = args.positional[0];
    if (target === undefined) {
      const names = ctx.registry.all().map((d) => d.name);
      return { ok: true, message: `commands: ${names.join(', ')}` };
    }
    const def = ctx.registry.get(String(target));
    if (!def) return { ok: false, message: `no such command: ${target}` };
    const spec = (def.argSpec ?? [])
      .map((s) => (s.required ? `<${s.name}>` : `[${s.name}]`))
      .join(' ');
    return {
      ok: true,
      message: `${def.name} ${spec}  -- ${def.summary}`,
    };
  },
};

const saveCmd: CommandDef = {
  name: 'save',
  summary: 'Save the current project to localStorage',
  argSpec: [{ name: 'slug', type: 'projectSlug' }],
  run(args, ctx): CommandResult {
    const slug = args.positional[0] as string | undefined;
    try {
      ctx.projectStore.save(slug);
      return {
        ok: true,
        message: `saved ${ctx.projectStore.active ?? slug}`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const loadCmd: CommandDef = {
  name: 'load',
  summary: 'Load a project from localStorage',
  argSpec: [{ name: 'slug', type: 'projectSlug', required: true }],
  run(args, ctx): CommandResult {
    const slug = String(args.positional[0]);
    try {
      ctx.projectStore.load(slug);
      return { ok: true, message: `loaded ${slug}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const loadRawCmd: CommandDef = {
  name: 'load raw',
  summary:
    'Read project text from storage without parsing (fix old files, then apply source)',
  argSpec: [{ name: 'slug', type: 'projectSlug', required: true }],
  run(args, ctx): CommandResult {
    const slug = String(args.positional[0]);
    try {
      ctx.projectStore.loadRaw(slug);
      return {
        ok: true,
        message: `raw text for ${slug} — edit in Project drawer, then apply source or save`,
      };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const applySourceCmd: CommandDef = {
  name: 'apply source',
  summary: 'Parse manual source buffer into the graph (after load raw)',
  argSpec: [],
  run(_args, ctx): CommandResult {
    try {
      ctx.projectStore.applyManualSource();
      const n = ctx.graphStore.stats.nodes;
      const e = ctx.graphStore.stats.edges;
      return { ok: true, message: `parsed graph: ${n} nodes, ${e} edges` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const cancelSourceCmd: CommandDef = {
  name: 'cancel source',
  summary: 'Exit manual source mode without parsing (discards buffer)',
  argSpec: [],
  run(_args, ctx): CommandResult {
    if (!ctx.projectStore.manualSourceMode) {
      return { ok: true, message: 'not in manual source mode' };
    }
    ctx.projectStore.cancelManualSource();
    return { ok: true, message: 'manual source mode off' };
  },
};

const newCmd: CommandDef = {
  name: 'new',
  summary: 'Create a new empty project',
  argSpec: [{ name: 'slug', type: 'string', required: true }],
  run(args, ctx): CommandResult {
    const slug = String(args.positional[0]);
    try {
      ctx.projectStore.newProject(slug);
      return { ok: true, message: `new project: ${slug}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const listProjects: CommandDef = {
  name: 'list projects',
  summary: 'List saved project slugs',
  run(_args, ctx): CommandResult {
    const slugs = ctx.projectStore.list();
    if (slugs.length === 0) return { ok: true, message: '(no projects)' };
    return { ok: true, message: slugs.join(', ') };
  },
};

const rmProject: CommandDef = {
  name: 'rm project',
  summary: 'Delete a project from localStorage',
  argSpec: [{ name: 'slug', type: 'projectSlug', required: true }],
  flags: [{ name: 'force', takesValue: false }],
  run(args, ctx): CommandResult {
    const slug = String(args.positional[0]);
    try {
      ctx.projectStore.removeProject(slug);
      return { ok: true, message: `removed ${slug}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  },
};

const clearHistory: CommandDef = {
  name: 'clear history',
  summary: 'Wipe palette command history',
  run(_args, ctx): CommandResult {
    ctx.history.clear();
    return { ok: true, message: 'history cleared' };
  },
};

export const BUILTIN_COMMANDS: CommandDef[] = [
  addNode,
  modNode,
  addLink,
  rmNode,
  tagAdd,
  tagList,
  echo,
  help,
  saveCmd,
  loadCmd,
  loadRawCmd,
  applySourceCmd,
  cancelSourceCmd,
  newCmd,
  listProjects,
  rmProject,
  clearHistory,
];

/** Register every starter command into the given registry. */
export function registerBuiltins(registry: CommandRegistry): void {
  for (const def of BUILTIN_COMMANDS) registry.register(def);
}

// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function flagString(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (Array.isArray(v)) return v[v.length - 1] === undefined ? undefined : String(v[v.length - 1]);
  return String(v);
}

function flagList(v: unknown): unknown[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function autoId(graph: { nodes: Map<string, unknown> }, type: NodeType): string {
  let i = 1;
  while (graph.nodes.has(`${type}:${type}${i}`)) i++;
  return `${type}${i}`;
}

/**
 * Parse a palette typed-ref token (`type[id]`). Accepts only the exact
 * shape; whitespace trims to allow quoted tokens like `domain["example.com"]`
 * (the tokenizer already strips the quotes).
 */
export function parseTypedRef(
  text: string,
):
  | { ok: true; ref: { type: NodeType; id: string } }
  | { ok: false; error: string } {
  const s = text.trim();
  const open = s.indexOf('[');
  const close = s.endsWith(']') ? s.length - 1 : -1;
  if (open <= 0 || close <= open + 1) {
    return {
      ok: false,
      error: `expected type[id], got ${JSON.stringify(text)}`,
    };
  }
  const type = s.slice(0, open);
  const id = s.slice(open + 1, close);
  if (!isNodeType(type)) return { ok: false, error: `unknown node type: ${type}` };
  if (id.length === 0) return { ok: false, error: `empty id in ${text}` };
  return { ok: true, ref: { type: type as NodeType, id } };
}

/**
 * Pick the legal direction + relation for a link between two nodes.
 *
 * If `relation` is specified, tries `(from, to)` then `(to, from)` against
 * that relation's legal pairs (auto-flip). Without a relation, enumerates
 * all legal relations in both orders and requires exactly one match.
 */
export function resolveLinkDirection(
  a: { type: NodeType; id: string },
  b: { type: NodeType; id: string },
  relation: RelationName | undefined,
):
  | {
      ok: true;
      relation: RelationName;
      from: { type: NodeType; id: string };
      to: { type: NodeType; id: string };
    }
  | { ok: false; error: string } {
  if (relation) {
    const meta = RELATION_META[relation];
    const forward = meta.pairs.some(([x, y]) => x === a.type && y === b.type);
    const backward = meta.pairs.some(([x, y]) => x === b.type && y === a.type);
    if (forward) return { ok: true, relation, from: a, to: b };
    if (backward) return { ok: true, relation, from: b, to: a };
    return {
      ok: false,
      error: `:${relation} does not accept ${a.type} <-> ${b.type}`,
    };
  }
  const forward = relationsForPair(a.type, b.type);
  const backward = relationsForPair(b.type, a.type);
  const total = forward.length + backward.length;
  if (total === 0) {
    return {
      ok: false,
      error: `no legal relation between ${a.type} and ${b.type}`,
    };
  }
  if (total > 1) {
    return {
      ok: false,
      error: `ambiguous relation between ${a.type} and ${b.type}; try 'add link ... ${[...forward, ...backward][0]}'`,
    };
  }
  if (forward.length === 1) {
    return { ok: true, relation: forward[0], from: a, to: b };
  }
  return { ok: true, relation: backward[0], from: b, to: a };
}
