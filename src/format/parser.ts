/**
 * Parser for TNI v1 text files per docs/specs/fileformat.md.
 *
 * Line-oriented; no streaming. Preprocesses backslash-continued lines
 * into logical lines, then parses each one via a per-line char cursor.
 *
 * Usage:
 *
 *   const { graph, errors, warnings } = parse(text);
 *
 * Callers can also pass an existing `Graph` via `parseInto` to merge a
 * fragment into a running project.
 */

import { syncEphemeralDevicePorts } from '@/model/devicePortSync';
import { isPortLayoutToken } from '@/model/portLayout';
import { ParseError, suggest } from './errors';
import {
  Graph,
  DEVICE_PORT_COMPOSITE_RE,
  HARDWARE_ADDR_RE,
  NET_ADDR_RE,
  NODE_ID_RE,
  NODE_TYPES,
  PORT_SLUG_RE,
  UPLINK_ID_RE,
  RELATION_META,
  RELATION_NAMES,
  isNetAddrType,
  mergeDefaultTags,
  parseCompositeDevicePortId,
  relationsForPair,
  type NodeType,
  type PropertyValue,
  type RelationName,
} from '@/model';

export interface ParsedFile {
  graph: Graph;
}

interface LogicalLine {
  text: string;
  srcLine: number;
}

export function parse(text: string): ParsedFile {
  const graph = new Graph();
  parseInto(text, graph);
  return { graph };
}

export function parseInto(text: string, graph: Graph): void {
  const lines = collectLogicalLines(text);
  if (lines.length === 0) {
    throw new ParseError(
      "missing header '!tni v1'",
      { line: 1, col: 1 },
      '!tni v1',
    );
  }

  const header = lines.shift()!;
  const headerText = stripComments(header.text).trim();
  if (headerText !== '!tni v1') {
    throw new ParseError(
      `expected header '!tni v1', got ${JSON.stringify(header.text.trim())}`,
      { line: header.srcLine, col: 1 },
      '!tni v1',
    );
  }

  // Track the most recent *entity* declaration so `->` / `=>` prefix lines
  // can reuse it as the implicit subject. Arrow lines, blank lines, edge
  // declarations, and comments do not update the anchor.
  const ctx: ParseContext = { anchor: undefined };

  for (const line of lines) {
    const stripped = stripComments(line.text).trim();
    if (stripped.length === 0) continue;
    parseStatement(stripped, line.srcLine, graph, ctx);
  }
  syncEphemeralDevicePorts(graph);
}

interface ParseContext {
  anchor: { type: NodeType; id: string } | undefined;
}

// ---------------------------------------------------------------------------
// Logical line reconstruction (`\` at EOL joins to next line).
// ---------------------------------------------------------------------------

function collectLogicalLines(text: string): LogicalLine[] {
  const src = text.replace(/\r\n?/g, '\n').split('\n');
  const out: LogicalLine[] = [];
  let buf = '';
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const s = src[i];
    if (buf.length === 0) start = i + 1;
    if (s.endsWith('\\')) {
      buf += s.slice(0, -1) + ' ';
      continue;
    }
    buf += s;
    out.push({ text: buf, srcLine: start });
    buf = '';
  }
  if (buf.length > 0) out.push({ text: buf, srcLine: start });
  return out;
}

/**
 * Remove `#` comments while respecting double-quoted strings. A `#`
 * starts a tag when followed immediately by an uppercase letter; a `#`
 * followed by anything else starts a comment to end-of-line.
 */
function stripComments(line: string): string {
  let out = '';
  let inQuotes = false;
  let bracketDepth = 0;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      out += c;
      continue;
    }
    if (!inQuotes) {
      if (c === '[') bracketDepth++;
      else if (c === ']' && bracketDepth > 0) bracketDepth--;
    }
    if (!inQuotes && c === '#') {
      // Inside a typed-ref bracket, `#` is a literal-id selector (`>port[#0]`)
      // and must NOT start a comment.
      if (bracketDepth > 0) {
        out += c;
        continue;
      }
      const nxt = line[i + 1];
      if (nxt && /[A-Z]/.test(nxt)) {
        out += c;
        continue;
      }
      return out;
    }
    out += c;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Statement dispatch: entity vs edge.
// ---------------------------------------------------------------------------

function parseStatement(
  text: string,
  srcLine: number,
  graph: Graph,
  ctx: ParseContext,
): void {
  // `portLayout` on devices materializes `port[parentId/portN]` before any
  // line that can reference such ids (e.g. edges) is processed.
  syncEphemeralDevicePorts(graph);

  // Arrow-prefix continuation: `->` or `=>` at column 1 after trim.
  if (text.startsWith('->') && !text.startsWith('->[')) {
    parseArrowRefLine(text, srcLine, graph, ctx);
    return;
  }
  if (text.startsWith('=>')) {
    parseArrowEntityLine(text, srcLine, graph, ctx);
    return;
  }
  // Edge shape always contains `->`; entity never does.
  if (text.includes('->')) {
    parseEdge(text, srcLine, graph);
    return;
  }
  const created = parseEntity(text, srcLine, graph, ctx);
  ctx.anchor = created;
}

// ---------------------------------------------------------------------------
// Entity: <type> <id-or-address> [#Tag ...] [key=value ...]
// ---------------------------------------------------------------------------

const DEVICE_PORT_LAYOUT_TYPES: ReadonlySet<NodeType> = new Set([
  'server',
  'switch',
  'router',
]);

function parseEntity(
  text: string,
  srcLine: number,
  graph: Graph,
  ctx: ParseContext,
): { type: NodeType; id: string } {
  const cur = new Cursor(text, srcLine);
  const typeTok = cur.readWord();
  if (typeTok === undefined) {
    throw new ParseError('expected a node type', cur.loc());
  }
  if (!(NODE_TYPES as readonly string[]).includes(typeTok)) {
    throw new ParseError(
      `unknown node type '${typeTok}'`,
      cur.startLoc(),
      suggest(typeTok, NODE_TYPES),
    );
  }
  const type = typeTok as NodeType;

  if (type === 'port') {
    return parsePortEntity(cur, graph, ctx);
  }
  if (type === 'userport') {
    return parseUserportEntity(cur, graph, ctx);
  }
  if (type === 'uplink') {
    return parseUplinkEntity(cur, graph, ctx);
  }

  cur.skipSpaces();
  const id = readIdentity(cur, type);
  if (DEVICE_PORT_LAYOUT_TYPES.has(type)) {
    const { tags, properties, portLayout } = readDeviceTagsPropsAndPortLayout(
      cur,
    );
    if (portLayout !== undefined) {
      (properties as Record<string, string | number | boolean>).portLayout =
        portLayout;
    }
    graph.addNode({ type, id, tags, properties });
  } else {
    const { tags, properties } = readTagsAndProps(cur);
    graph.addNode({ type, id, tags, properties });
  }
  return { type, id };
}

/**
 * Positional media keywords (aliases) for `port` / `userport` / `uplink` lines.
 */
const PORT_MEDIA_ALIASES: Record<string, 'RJ45' | 'FiberOptic'> = {
  rj45: 'RJ45',
  rj: 'RJ45',
  fiberoptic: 'FiberOptic',
  fiber: 'FiberOptic',
  f: 'FiberOptic',
};

/**
 * Customer endpoint: `userport <hardware> <MEDIA> [#Tag …] [k=v …]`.
 */
function parseUserportEntity(
  cur: Cursor,
  graph: Graph,
  _ctx: ParseContext,
): { type: NodeType; id: string } {
  cur.skipSpaces();
  let id: string;
  if (cur.peek() === '"') {
    id = cur.readQuoted();
    if (!HARDWARE_ADDR_RE.test(id)) {
      throw new ParseError(
        'userport id in quotes must be 1..5 digit hardware address',
        cur.startLoc(),
      );
    }
  } else {
    const d = cur.readDigits();
    if (d === undefined) {
      throw new ParseError(
        "expected userport hardware id (1..5 digits), e.g. `userport 52682 RJ45`",
        cur.loc(),
      );
    }
    id = d;
    if (cur.peek() === '-') {
      throw new ParseError(
        'userport hardware addresses do not support ranges',
        cur.startLoc(),
      );
    }
  }
  cur.skipSpaces();
  const mediaWord = cur.readAlnumWord();
  if (!mediaWord) {
    throw new ParseError(
      'expected userport media (RJ45|RJ|FiberOptic|FIBER|F)',
      cur.loc(),
    );
  }
  const mediaTag = PORT_MEDIA_ALIASES[mediaWord.toLowerCase()];
  if (!mediaTag) {
    throw new ParseError(
      `unknown userport media '${mediaWord}' (use RJ45|RJ|FiberOptic|FIBER|F)`,
      cur.startLoc(),
    );
  }
  const { tags, properties } = readTagsAndProps(cur);
  const extra = tags.includes(mediaTag) ? tags : [mediaTag, ...tags];
  graph.addNode({
    type: 'userport',
    id,
    tags: mergeDefaultTags('userport', extra),
    properties: { ...properties },
  });
  return { type: 'userport', id };
}

/**
 * Building uplink: `uplink <id> <MEDIA> [#Tag …] [k=v …]` (id: 4 letters).
 */
function parseUplinkEntity(
  cur: Cursor,
  graph: Graph,
  _ctx: ParseContext,
): { type: NodeType; id: string } {
  cur.skipSpaces();
  const idRaw = cur.readWord();
  if (idRaw === undefined) {
    throw new ParseError('expected an uplink id (4 letters)', cur.loc());
  }
  if (!UPLINK_ID_RE.test(idRaw)) {
    throw new ParseError(
      `invalid uplink id '${idRaw}' (expected 4 letters, e.g. mtvw)`,
      cur.startLoc(),
    );
  }
  const id = idRaw.toLowerCase();
  cur.skipSpaces();
  const mediaWord = cur.readAlnumWord();
  if (!mediaWord) {
    throw new ParseError(
      'expected uplink media (RJ45|RJ|FiberOptic|FIBER|F)',
      cur.loc(),
    );
  }
  const mediaTag = PORT_MEDIA_ALIASES[mediaWord.toLowerCase()];
  if (!mediaTag) {
    throw new ParseError(
      `unknown uplink media '${mediaWord}' (use RJ45|RJ|FiberOptic|FIBER|F)`,
      cur.startLoc(),
    );
  }
  const { tags, properties } = readTagsAndProps(cur);
  const extra = tags.includes(mediaTag) ? tags : [mediaTag, ...tags];
  graph.addNode({
    type: 'uplink',
    id,
    tags: mergeDefaultTags('uplink', extra),
    properties: { ...properties },
  });
  return { type: 'uplink', id };
}

/**
 * Device NIC port line: `port "parent/port0" <MEDIA> …`.
 * Legacy `port <digits> <MEDIA> #UserPort` is accepted and stored as `userport`.
 */
function parsePortEntity(
  cur: Cursor,
  graph: Graph,
  _ctx: ParseContext,
): { type: NodeType; id: string } {
  cur.skipSpaces();
  if (cur.peek() === '"') {
    const id = cur.readQuoted();
    cur.skipSpaces();
    const mediaWord = cur.readAlnumWord();
    if (!mediaWord) {
      throw new ParseError(
        'expected port media (RJ45|RJ|FiberOptic|FIBER|F)',
        cur.loc(),
      );
    }
    const mediaTag = PORT_MEDIA_ALIASES[mediaWord.toLowerCase()];
    if (!mediaTag) {
      throw new ParseError(
        `unknown port media '${mediaWord}' (use RJ45|RJ|FiberOptic|FIBER|F)`,
        cur.startLoc(),
      );
    }
    const { tags, properties } = readTagsAndProps(cur);
    const allTags = tags.includes(mediaTag) ? tags : [mediaTag, ...tags];
    if (allTags.includes('UserPort')) {
      if (!HARDWARE_ADDR_RE.test(id)) {
        throw new ParseError(
          'legacy #UserPort on port line: id must be 1..5 digit hardware address (prefer `userport`)',
          cur.startLoc(),
        );
      }
      const sans = allTags.filter((t) => t !== 'UserPort');
      graph.addNode({
        type: 'userport',
        id,
        tags: mergeDefaultTags('userport', sans),
        properties: { ...properties },
      });
      return { type: 'userport', id };
    }
    if (!parseCompositeDevicePortId(id)) {
      throw new ParseError(
        'device port id in quotes must be parentId/portN',
        cur.startLoc(),
      );
    }
    graph.addNode({
      type: 'port',
      id,
      tags: allTags.slice(),
      properties: { ...properties },
    });
    return { type: 'port', id };
  }
  const firstDigits = cur.readDigits();
  if (firstDigits === undefined) {
    throw new ParseError(
      "expected quoted composite port id or digits with #UserPort (prefer `userport` for hardware addresses)",
      cur.loc(),
    );
  }
  const start = Number(firstDigits);
  let end = start;
  if (cur.peek() === '-') {
    cur.advance(1);
    const lastDigits = cur.readDigits();
    if (lastDigits === undefined) {
      throw new ParseError(
        "expected end of port range after '-'",
        cur.loc(),
      );
    }
    end = Number(lastDigits);
    if (end < start) {
      throw new ParseError(
        `empty port range ${start}-${end}`,
        cur.startLoc(),
      );
    }
  }

  cur.skipSpaces();
  const mediaWord = cur.readAlnumWord();
  if (!mediaWord) {
    throw new ParseError(
      'expected port media (RJ45|RJ|FiberOptic|FIBER|F)',
      cur.loc(),
    );
  }
  const mediaTag = PORT_MEDIA_ALIASES[mediaWord.toLowerCase()];
  if (!mediaTag) {
    throw new ParseError(
      `unknown port media '${mediaWord}' (use RJ45|RJ|FiberOptic|FIBER|F)`,
      cur.startLoc(),
    );
  }

  const { tags, properties } = readTagsAndProps(cur);
  const allTags = tags.includes(mediaTag) ? tags : [mediaTag, ...tags];
  if (allTags.includes('UserPort')) {
    if (start !== end) {
      throw new ParseError(
        'UserPort range is not supported (use one `userport` line per hardware address)',
        cur.startLoc(),
      );
    }
    const id = String(start);
    const sans = allTags.filter((t) => t !== 'UserPort');
    graph.addNode({
      type: 'userport',
      id,
      tags: mergeDefaultTags('userport', sans),
      properties: { ...properties },
    });
    return { type: 'userport', id };
  }
  throw new ParseError(
    'numeric `port …` without #UserPort is invalid (device ports come from portLayout). For customer gear use `userport <id> <MEDIA>`',
    cur.startLoc(),
  );
}

// ---------------------------------------------------------------------------
// Edge: <typeA>[<id>] -> <typeB>[<id>] [:Relation] [{key=val, ...}]
// ---------------------------------------------------------------------------

function parseEdge(text: string, srcLine: number, graph: Graph): void {
  const cur = new Cursor(text, srcLine);

  const from = readTypedRef(cur, graph);
  cur.skipSpaces();
  if (!cur.consume('->')) {
    throw new ParseError("expected '->'", cur.loc());
  }
  cur.skipSpaces();
  const to = readTypedRef(cur, graph);

  cur.skipSpaces();
  let relation: RelationName | undefined;
  if (cur.peek() === ':') {
    cur.advance(1);
    const word = cur.readPascalWord();
    if (!word) {
      throw new ParseError("expected a relation name after ':'", cur.loc());
    }
    if (!(RELATION_NAMES as readonly string[]).includes(word)) {
      throw new ParseError(
        `unknown edge type ':${word}'`,
        cur.startLoc(),
        suggest(word, RELATION_NAMES),
      );
    }
    relation = word as RelationName;
  }

  cur.skipSpaces();
  const properties = cur.peek() === '{' ? readEdgeProps(cur) : {};

  if (!relation) {
    const candidates = relationsForPair(from.type, to.type);
    if (candidates.length === 0) {
      throw new ParseError(
        `no legal relation between ${from.type} and ${to.type}`,
        cur.startLoc(),
      );
    }
    if (candidates.length > 1) {
      throw new ParseError(
        `ambiguous relation between ${from.type} and ${to.type}; candidates: ${candidates.join(', ')}`,
        cur.startLoc(),
      );
    }
    relation = candidates[0];
  } else {
    // Validate pair against declared relation.
    const meta = RELATION_META[relation];
    const ok = meta.pairs.some(([a, b]) => {
      if (a === from.type && b === to.type) return true;
      if (!meta.directed && a === to.type && b === from.type) return true;
      return false;
    });
    if (!ok) {
      throw new ParseError(
        `:${relation} does not accept ${from.type} -> ${to.type}`,
        cur.startLoc(),
      );
    }
  }

  graph.addEdge({ relation, from, to, properties });
}

// ---------------------------------------------------------------------------
// Arrow-prefix lines: `-> TypedRef ...` and `=> EntityDecl ...`
// ---------------------------------------------------------------------------

function parseArrowRefLine(
  text: string,
  srcLine: number,
  graph: Graph,
  ctx: ParseContext,
): void {
  const cur = new Cursor(text, srcLine);
  cur.advance(2); // '->'
  cur.skipSpaces();
  if (!ctx.anchor) {
    throw new ParseError(
      "'-> ...' has no anchor; add an entity declaration above it",
      cur.loc(),
    );
  }
  const target = readTypedRef(cur, graph);
  const { relation, properties } = readOptionalRelationAndProps(cur);
  applyArrowEdge(graph, ctx.anchor, target, relation, properties, cur);
}

function parseArrowEntityLine(
  text: string,
  srcLine: number,
  graph: Graph,
  ctx: ParseContext,
): void {
  const cur = new Cursor(text, srcLine);
  cur.advance(2); // '=>'
  cur.skipSpaces();
  if (!ctx.anchor) {
    throw new ParseError(
      "'=> ...' has no anchor; add an entity declaration above it",
      cur.loc(),
    );
  }
  // Parse the RHS as an entity declaration. We first split off a trailing
  // `:RelationName [{props}]` segment because the entity parser stops at
  // `:`. The simplest safe approach: find the last `:Pascal...` token that
  // isn't inside braces/quotes, split there.
  // Spec: `=>` and `->` are continuation lines; they do not replace the
  // anchor. Only a normal entity line updates ctx.anchor.
  const { entityText, trailer } = splitEntityTrailer(text.slice(2).trimStart());
  const fromAnchor = ctx.anchor;
  const created = parseEntity(entityText, srcLine, graph, ctx);

  const trailCur = new Cursor(trailer, srcLine);
  const { relation, properties } = readOptionalRelationAndProps(trailCur);
  applyArrowEdge(graph, fromAnchor, created, relation, properties, cur);
}

/**
 * Split an entity line into its declaration text and any trailing
 * `:RelationName [{props}]` tokens. Returns the trailer as a string that
 * can be fed to `readOptionalRelationAndProps` via a fresh Cursor.
 *
 * This is safe because entity lines never contain `:` in their normal
 * tokens (identifiers, tags, props), and `{` / `}` are reserved for edge
 * props. We respect double-quoted strings so quoted property values
 * containing `:` don't trip the split.
 */
function splitEntityTrailer(text: string): {
  entityText: string;
  trailer: string;
} {
  let inQuotes = false;
  let braceDepth = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' && text[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (c === '{') braceDepth++;
    else if (c === '}') braceDepth--;
    else if (c === ':' && braceDepth === 0) {
      return {
        entityText: text.slice(0, i).trimEnd(),
        trailer: text.slice(i),
      };
    }
  }
  return { entityText: text.trimEnd(), trailer: '' };
}

function readOptionalRelationAndProps(cur: Cursor): {
  relation: RelationName | undefined;
  properties: Record<string, PropertyValue>;
} {
  cur.skipSpaces();
  let relation: RelationName | undefined;
  if (cur.peek() === ':') {
    cur.advance(1);
    const word = cur.readPascalWord();
    if (!word) {
      throw new ParseError("expected a relation name after ':'", cur.loc());
    }
    if (!(RELATION_NAMES as readonly string[]).includes(word)) {
      throw new ParseError(
        `unknown edge type ':${word}'`,
        cur.startLoc(),
        suggest(word, RELATION_NAMES),
      );
    }
    relation = word as RelationName;
  }
  cur.skipSpaces();
  const properties = cur.peek() === '{' ? readEdgeProps(cur) : {};
  return { relation, properties };
}

/**
 * Build an edge from an anchor/target pair. For named relations, tries
 * `(anchor, target)` first; if that order isn't legal, auto-flips to
 * `(target, anchor)` so users can write `customer => networkaddress
 * :AssignedTo` without worrying about the canonical direction. For
 * unnamed relations, inference runs in both orders and must resolve to
 * exactly one legal relation.
 */
function applyArrowEdge(
  graph: Graph,
  anchor: { type: NodeType; id: string },
  target: { type: NodeType; id: string },
  relation: RelationName | undefined,
  properties: Record<string, PropertyValue>,
  cur: Cursor,
): void {
  if (relation) {
    const meta = RELATION_META[relation];
    const forward = meta.pairs.some(
      ([a, b]) => a === anchor.type && b === target.type,
    );
    const backward = meta.pairs.some(
      ([a, b]) => a === target.type && b === anchor.type,
    );
    if (forward) {
      graph.addEdge({ relation, from: anchor, to: target, properties });
      return;
    }
    if (backward) {
      graph.addEdge({ relation, from: target, to: anchor, properties });
      return;
    }
    throw new ParseError(
      `:${relation} does not accept ${anchor.type} <-> ${target.type}`,
      cur.startLoc(),
    );
  }

  const forward = relationsForPair(anchor.type, target.type);
  const backward = relationsForPair(target.type, anchor.type);
  const total = forward.length + backward.length;
  if (total === 0) {
    throw new ParseError(
      `no legal relation between ${anchor.type} and ${target.type}`,
      cur.startLoc(),
    );
  }
  if (total > 1) {
    const names = [...forward, ...backward];
    throw new ParseError(
      `ambiguous relation between ${anchor.type} and ${target.type}; candidates: ${names.join(', ')}`,
      cur.startLoc(),
    );
  }
  if (forward.length === 1) {
    graph.addEdge({
      relation: forward[0],
      from: anchor,
      to: target,
      properties,
    });
  } else {
    graph.addEdge({
      relation: backward[0],
      from: target,
      to: anchor,
      properties,
    });
  }
}

// ---------------------------------------------------------------------------
// Sub-parsers
// ---------------------------------------------------------------------------

function readTypedRef(
  cur: Cursor,
  graph?: Graph,
): { type: NodeType; id: string } {
  const typeTok = cur.readWord();
  if (typeTok === undefined) {
    throw new ParseError('expected a node type', cur.loc());
  }
  if (!(NODE_TYPES as readonly string[]).includes(typeTok)) {
    throw new ParseError(
      `unknown node type '${typeTok}'`,
      cur.startLoc(),
      suggest(typeTok, NODE_TYPES),
    );
  }
  const type = typeTok as NodeType;
  if (!cur.consume('[')) {
    throw new ParseError("expected '['", cur.loc());
  }
  const id = readIdentity(cur, type);
  if (!cur.consume(']')) {
    throw new ParseError("expected ']'", cur.loc());
  }

  let current: { type: NodeType; id: string } = { type, id };
  while (cur.peek() === '>') {
    cur.advance(1);
    current = readSelectorSegment(cur, current, graph);
  }
  return current;
}

/**
 * Edge-ref selector: after a TypedRef, a `>Type[qual]` segment resolves
 * to a neighbor of the subject along an edge that links the two types.
 *
 * Qualifier forms (inside `[...]`):
 *   - bare integer   -> 0-based index into the ordered candidate list
 *   - `#<id>`        -> literal id match (use when the id is a decimal)
 *   - `<id>` / `@..` -> literal id match (ids starting with `@` or non-digit)
 * Missing `[...]` is equivalent to `[0]` (first match).
 */
function readSelectorSegment(
  cur: Cursor,
  subject: { type: NodeType; id: string },
  graph: Graph | undefined,
): { type: NodeType; id: string } {
  if (!graph) {
    throw new ParseError(
      'edge-ref selectors are not allowed here',
      cur.loc(),
    );
  }
  const segTypeTok = cur.readWord();
  if (segTypeTok === undefined) {
    throw new ParseError("expected a node type after '>'", cur.loc());
  }
  if (!(NODE_TYPES as readonly string[]).includes(segTypeTok)) {
    throw new ParseError(
      `unknown node type '${segTypeTok}'`,
      cur.startLoc(),
      suggest(segTypeTok, NODE_TYPES),
    );
  }
  const segType = segTypeTok as NodeType;

  let qualifier: Qualifier = { kind: 'index', n: 0 };
  if (cur.peek() === '[') {
    cur.advance(1);
    cur.skipSpaces();
    qualifier = readQualifier(cur, segType);
    cur.skipSpaces();
    if (!cur.consume(']')) {
      throw new ParseError("expected ']'", cur.loc());
    }
  }

  return resolveSelector(graph, subject, segType, qualifier, cur);
}

type Qualifier =
  | { kind: 'index'; n: number }
  | { kind: 'literal'; id: string };

function readQualifier(cur: Cursor, segType: NodeType): Qualifier {
  if (cur.peek() === '#') {
    cur.advance(1);
    const id = readIdentity(cur, segType);
    return { kind: 'literal', id };
  }
  // Heuristic: a bare run of digits followed by `]` is an index.
  // Anything else (letters, `@`, `"`) is a literal id.
  const save = cur.pos;
  const digits = cur.readDigits();
  if (digits !== undefined) {
    cur.skipSpaces();
    if (cur.peek() === ']') {
      return { kind: 'index', n: Number(digits) };
    }
    cur.pos = save;
  }
  const id = readIdentity(cur, segType);
  return { kind: 'literal', id };
}

function resolveSelector(
  graph: Graph,
  subject: { type: NodeType; id: string },
  segType: NodeType,
  qualifier: Qualifier,
  cur: Cursor,
): { type: NodeType; id: string } {
  // All edges incident to the subject, in insertion order, whose other
  // endpoint is of the requested type.
  const candidates: { type: NodeType; id: string }[] = [];
  const edges = graph.edgesOf(subject.type, subject.id);
  const subjectKey = `${subject.type}:${subject.id}`;
  for (const e of edges) {
    const other = e.fromKey === subjectKey ? e.toKey : e.fromKey;
    const parsed = parseNodeKeyLike(other);
    if (parsed.type === segType) candidates.push(parsed);
  }
  if (candidates.length === 0) {
    throw new ParseError(
      `no ${segType} reachable from ${subject.type}[${subject.id}]`,
      cur.startLoc(),
    );
  }
  if (qualifier.kind === 'index') {
    const hit = candidates[qualifier.n];
    if (!hit) {
      throw new ParseError(
        `${subject.type}[${subject.id}]>${segType}[${qualifier.n}] is out of range (have ${candidates.length})`,
        cur.startLoc(),
      );
    }
    return hit;
  }
  const hit = candidates.find((c) => c.id === qualifier.id);
  if (!hit) {
    throw new ParseError(
      `${subject.type}[${subject.id}]>${segType}[${qualifier.id}] not found`,
      cur.startLoc(),
    );
  }
  return hit;
}

/** Parse a `type:id` key string. Duplicates `parseNodeKey` locally so we
 * don't have to re-import it in this module. */
function parseNodeKeyLike(key: string): { type: NodeType; id: string } {
  const idx = key.indexOf(':');
  return { type: key.slice(0, idx) as NodeType, id: key.slice(idx + 1) };
}

function readIdentity(cur: Cursor, type: NodeType): string {
  cur.skipSpaces();
  const c = cur.peek();
  if (c === '"') {
    return cur.readQuoted();
  }
  if (c === '@') {
    const id = cur.readNetAddr();
    if (!NET_ADDR_RE.test(id)) {
      throw new ParseError(
        `invalid network address '${id}'`,
        cur.startLoc(),
      );
    }
    return id;
  }
  // Domain accepts bare `a.b.c` forms
  if (type === 'domain') {
    const id = cur.readDomainLike();
    if (!id) throw new ParseError('expected a domain name', cur.loc());
    return id;
  }
  if (type === 'userport') {
    const w1 = cur.readWord();
    if (w1 === undefined) {
      throw new ParseError('expected a userport hardware id', cur.loc());
    }
    if (!HARDWARE_ADDR_RE.test(w1)) {
      throw new ParseError(
        'userport hardware id must be 1..5 decimal digits',
        cur.startLoc(),
      );
    }
    return w1;
  }
  // `port` ids: `parentId/port0` (device NIC).
  if (type === 'port') {
    const w1 = cur.readWord();
    if (w1 === undefined) {
      throw new ParseError('expected a port id', cur.loc());
    }
    if (cur.peek() === '/') {
      cur.advance(1);
      const w2 = cur.readWord();
      if (w2 === undefined || !PORT_SLUG_RE.test(w2)) {
        throw new ParseError(
          'expected port device id like parentId/port0',
          cur.startLoc(),
        );
      }
      const id = `${w1}/${w2}`;
      if (!DEVICE_PORT_COMPOSITE_RE.test(id)) {
        throw new ParseError(
          `invalid composite port id ${JSON.stringify(id)}`,
          cur.startLoc(),
        );
      }
      return id;
    }
    throw new ParseError(
      "expected device port id parentId/portN (e.g. sw1/port0); use type userport for hardware addresses",
      cur.startLoc(),
    );
  }
  if (type === 'uplink') {
    const id = cur.readWord();
    if (id === undefined) {
      throw new ParseError('expected an uplink id', cur.loc());
    }
    if (!UPLINK_ID_RE.test(id)) {
      throw new ParseError(
        `invalid uplink id '${id}' (expected 4 letters, e.g. mtvw)`,
        cur.startLoc(),
      );
    }
    return id.toLowerCase();
  }
  const id = cur.readWord();
  if (id === undefined) {
    throw new ParseError(
      `expected an id for ${type}`,
      cur.loc(),
    );
  }
  if (!NODE_ID_RE.test(id) && !isNetAddrType(type)) {
    throw new ParseError(`invalid id '${id}' for ${type}`, cur.startLoc());
  }
  return id;
}

interface TagsAndProps {
  tags: string[];
  properties: Record<string, PropertyValue>;
}

function readTagsAndProps(cur: Cursor): TagsAndProps {
  const tags: string[] = [];
  const properties: Record<string, PropertyValue> = {};
  while (!cur.eol()) {
    cur.skipSpaces();
    if (cur.eol()) break;
    if (cur.peek() === '#') {
      cur.advance(1);
      const tag = cur.readPascalWord();
      if (!tag) throw new ParseError('expected a tag name', cur.loc());
      tags.push(tag);
      continue;
    }
    const { key, value } = readProperty(cur);
    properties[key] = value;
  }
  return { tags, properties };
}

/**
 * `server` / `switch` / `router` lines: optional `RJ45[2] FIBER ...` run, then
 * the usual #tags and key=value.
 */
function readDeviceTagsPropsAndPortLayout(
  cur: Cursor,
): TagsAndProps & { portLayout: string | undefined } {
  const plParts: string[] = [];
  for (;;) {
    const save = cur.getPos();
    cur.skipSpaces();
    if (cur.eol() || cur.peek() === '#') {
      cur.setPos(save);
      break;
    }
    const raw = cur.readNonSpaceToken();
    if (raw === undefined) {
      cur.setPos(save);
      break;
    }
    if (raw.includes('=')) {
      cur.setPos(save);
      break;
    }
    if (!isPortLayoutToken(raw)) {
      cur.setPos(save);
      break;
    }
    plParts.push(raw);
  }
  const rest = readTagsAndProps(cur);
  const portLayout = plParts.length > 0 ? plParts.join(' ') : undefined;
  return { ...rest, portLayout };
}

function readEdgeProps(cur: Cursor): Record<string, PropertyValue> {
  cur.advance(1); // '{'
  const props: Record<string, PropertyValue> = {};
  cur.skipSpaces();
  if (cur.peek() === '}') {
    cur.advance(1);
    return props;
  }
  for (;;) {
    cur.skipSpaces();
    const { key, value } = readProperty(cur);
    props[key] = value;
    cur.skipSpaces();
    if (cur.peek() === ',') {
      cur.advance(1);
      continue;
    }
    if (cur.peek() === '}') {
      cur.advance(1);
      return props;
    }
    throw new ParseError("expected ',' or '}'", cur.loc());
  }
}

function readProperty(cur: Cursor): { key: string; value: PropertyValue } {
  const key = cur.readDottedKey();
  if (!key) throw new ParseError('expected a property key', cur.loc());
  if (!cur.consume('=')) {
    throw new ParseError(`expected '=' after '${key}'`, cur.loc());
  }
  const value = readValue(cur);
  return { key, value };
}

function readValue(cur: Cursor): PropertyValue {
  cur.skipSpaces();
  const c = cur.peek();
  if (c === '"') return cur.readQuoted();
  if (c === '@') return cur.readNetAddr();
  if (c === '-' || (c !== undefined && /[0-9]/.test(c))) {
    const raw = cur.readNumberLike();
    if (raw !== undefined && /^-?[0-9]+(\.[0-9]+)?$/.test(raw)) {
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
    }
    if (raw !== undefined) return raw;
  }
  const word = cur.readWord();
  if (word !== undefined) return word;
  throw new ParseError('expected a value', cur.loc());
}

// ---------------------------------------------------------------------------
// Cursor — a tiny scanner over a single logical line.
// ---------------------------------------------------------------------------

class Cursor {
  private readonly text: string;
  private readonly srcLine: number;
  private pos = 0;
  private tokenStart = 0;

  constructor(text: string, srcLine: number) {
    this.text = text;
    this.srcLine = srcLine;
  }

  getPos(): number {
    return this.pos;
  }

  setPos(p: number): void {
    this.pos = p;
  }

  eol(): boolean {
    return this.pos >= this.text.length;
  }

  peek(offset = 0): string | undefined {
    return this.text[this.pos + offset];
  }

  advance(n: number): void {
    this.pos += n;
  }

  consume(s: string): boolean {
    if (this.text.startsWith(s, this.pos)) {
      this.tokenStart = this.pos;
      this.pos += s.length;
      return true;
    }
    return false;
  }

  loc(): { line: number; col: number } {
    return { line: this.srcLine, col: this.pos + 1 };
  }

  startLoc(): { line: number; col: number } {
    return { line: this.srcLine, col: this.tokenStart + 1 };
  }

  skipSpaces(): void {
    while (this.pos < this.text.length && /[ \t]/.test(this.text[this.pos])) {
      this.pos++;
    }
  }

  private start(): void {
    this.tokenStart = this.pos;
  }

  // Reads an identifier. Spec line 104 defines Ident = /[a-z0-9][a-z0-9_-]*/
  // but the normative examples (and graphdata.md) use camelCase property
  // names like deviceAddress and traversalsPerTick. We accept uppercase
  // letters in continuation chars to match those examples; node-id shape is
  // separately enforced by NODE_ID_RE at validation time.
  readWord(): string | undefined {
    this.skipSpaces();
    this.start();
    if (this.pos >= this.text.length) return undefined;
    if (!/[a-z0-9]/.test(this.text[this.pos])) return undefined;
    let end = this.pos + 1;
    while (
      end < this.text.length &&
      /[a-zA-Z0-9_-]/.test(this.text[end])
    ) {
      end++;
    }
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  /** Unquoted token: non-space run (used for e.g. `RJ45[2]`). */
  readNonSpaceToken(): string | undefined {
    this.skipSpaces();
    this.start();
    if (this.pos >= this.text.length) return undefined;
    let end = this.pos;
    while (end < this.text.length && !/[\s]/.test(this.text[end])) {
      end++;
    }
    if (end === this.pos) return undefined;
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  /** Read a run of digits. Used for port numbers in `port 0 RJ45` syntax. */
  readDigits(): string | undefined {
    this.skipSpaces();
    this.start();
    if (this.pos >= this.text.length) return undefined;
    if (!/[0-9]/.test(this.text[this.pos])) return undefined;
    let end = this.pos + 1;
    while (end < this.text.length && /[0-9]/.test(this.text[end])) end++;
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  /** Read a run of ASCII alphanumerics. Case-insensitive start character. */
  readAlnumWord(): string | undefined {
    this.skipSpaces();
    this.start();
    if (this.pos >= this.text.length) return undefined;
    if (!/[A-Za-z0-9]/.test(this.text[this.pos])) return undefined;
    let end = this.pos + 1;
    while (end < this.text.length && /[A-Za-z0-9]/.test(this.text[end])) {
      end++;
    }
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  readPascalWord(): string | undefined {
    this.skipSpaces();
    this.start();
    if (this.pos >= this.text.length) return undefined;
    if (!/[A-Z]/.test(this.text[this.pos])) return undefined;
    let end = this.pos + 1;
    while (end < this.text.length && /[A-Za-z0-9]/.test(this.text[end])) {
      end++;
    }
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  readNetAddr(): string {
    this.skipSpaces();
    this.start();
    if (this.text[this.pos] !== '@') {
      throw new ParseError(
        'expected a network address',
        this.loc(),
      );
    }
    let end = this.pos + 1;
    while (
      end < this.text.length &&
      /[A-Za-z0-9_\-/]/.test(this.text[end])
    ) {
      end++;
    }
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  readDomainLike(): string | undefined {
    this.skipSpaces();
    this.start();
    if (this.pos >= this.text.length) return undefined;
    if (!/[a-z0-9]/.test(this.text[this.pos])) return undefined;
    let end = this.pos + 1;
    while (end < this.text.length && /[a-z0-9._-]/.test(this.text[end])) {
      end++;
    }
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  readNumberLike(): string | undefined {
    this.skipSpaces();
    this.start();
    if (this.pos >= this.text.length) return undefined;
    let end = this.pos;
    if (this.text[end] === '-') end++;
    while (end < this.text.length && /[0-9.]/.test(this.text[end])) end++;
    if (end === this.pos || (end === this.pos + 1 && this.text[this.pos] === '-')) {
      return undefined;
    }
    const out = this.text.slice(this.pos, end);
    this.pos = end;
    return out;
  }

  readQuoted(): string {
    this.skipSpaces();
    this.start();
    if (this.text[this.pos] !== '"') {
      throw new ParseError('expected a quoted string', this.loc());
    }
    let i = this.pos + 1;
    let out = '';
    while (i < this.text.length) {
      const c = this.text[i];
      if (c === '\\') {
        const n = this.text[i + 1];
        if (n === '"') out += '"';
        else if (n === '\\') out += '\\';
        else if (n === 'n') out += '\n';
        else
          throw new ParseError(
            `invalid escape '\\${n ?? ''}' in string`,
            { line: this.srcLine, col: i + 2 },
          );
        i += 2;
        continue;
      }
      if (c === '"') {
        this.pos = i + 1;
        return out;
      }
      out += c;
      i++;
    }
    throw new ParseError('unterminated quoted string', this.startLoc());
  }

  /**
   * `Key = Ident { "." Ident }` per fileformat.md EBNF.
   * Allows dotted property keys like `pool.provide.main`.
   */
  readDottedKey(): string | undefined {
    this.skipSpaces();
    this.start();
    const first = this.readWord();
    if (first === undefined) return undefined;
    let out = first;
    while (this.peek() === '.') {
      const saved = this.pos;
      this.pos++;
      const seg = this.readWord();
      if (seg === undefined) {
        this.pos = saved;
        break;
      }
      out += '.' + seg;
    }
    return out;
  }
}
