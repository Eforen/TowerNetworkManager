/**
 * Phase-5 starter command catalog.
 *
 * We ship enough commands to exercise the end-to-end pipeline (graph
 * mutation, tab completion, project IO, utility). The larger catalog
 * from docs/specs/commands.md lands incrementally in later phases.
 */

import { isNodeType, type NodeType } from '@/model';
import type { CommandDef, CommandResult } from './types';
import type { CommandRegistry } from './registry';

const addNode: CommandDef = {
  name: 'add node',
  summary: 'Create a node of the given type',
  undoable: true,
  argSpec: [
    { name: 'nodeType', type: 'nodeType', required: true },
    { name: 'id', type: 'string' },
  ],
  flags: [
    { name: 'id', takesValue: true },
    { name: 'name', takesValue: true },
    { name: 'tag', takesValue: true, repeatable: true },
    { name: 'prop', takesValue: true, repeatable: true },
  ],
  run(args, ctx): CommandResult {
    const [rawType, inlineId] = args.positional;
    const nodeType = String(rawType);
    if (!isNodeType(nodeType)) {
      return { ok: false, message: `unknown node type: ${nodeType}` };
    }
    const flagId = flagString(args.flags.id);
    const id = String(flagId ?? inlineId ?? autoId(ctx.graph, nodeType as NodeType));
    const tagList = flagList(args.flags.tag).map(String);
    const propEntries = flagList(args.flags.prop).map(String);
    const properties: Record<string, string | number | boolean> = {};
    const nameFlag = flagString(args.flags.name);
    if (nameFlag !== undefined) properties.name = String(nameFlag);
    for (const raw of propEntries) {
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
  argSpec: [{ name: 'slug', type: 'string' }],
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
  argSpec: [{ name: 'slug', type: 'string', required: true }],
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
  argSpec: [{ name: 'slug', type: 'string', required: true }],
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
  rmNode,
  tagAdd,
  tagList,
  echo,
  help,
  saveCmd,
  loadCmd,
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
