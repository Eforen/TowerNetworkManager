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

import { ParseError, suggest } from './errors';
import {
  Graph,
  NET_ADDR_RE,
  NODE_ID_RE,
  NODE_TYPES,
  RELATION_META,
  RELATION_NAMES,
  isNetAddrType,
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

  for (const line of lines) {
    const stripped = stripComments(line.text).trim();
    if (stripped.length === 0) continue;
    parseStatement(stripped, line.srcLine, graph);
  }
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
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && line[i - 1] !== '\\') {
      inQuotes = !inQuotes;
      out += c;
      continue;
    }
    if (!inQuotes && c === '#') {
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

function parseStatement(text: string, srcLine: number, graph: Graph): void {
  // Edge shape always contains `->`; entity never does.
  if (text.includes('->')) {
    parseEdge(text, srcLine, graph);
  } else {
    parseEntity(text, srcLine, graph);
  }
}

// ---------------------------------------------------------------------------
// Entity: <type> <id-or-address> [#Tag ...] [key=value ...]
// ---------------------------------------------------------------------------

function parseEntity(text: string, srcLine: number, graph: Graph): void {
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

  cur.skipSpaces();
  const id = readIdentity(cur, type);

  const { tags, properties } = readTagsAndProps(cur);

  graph.addNode({ type, id, tags, properties });
}

// ---------------------------------------------------------------------------
// Edge: <typeA>[<id>] -> <typeB>[<id>] [:Relation] [{key=val, ...}]
// ---------------------------------------------------------------------------

function parseEdge(text: string, srcLine: number, graph: Graph): void {
  const cur = new Cursor(text, srcLine);

  const from = readTypedRef(cur);
  cur.skipSpaces();
  if (!cur.consume('->')) {
    throw new ParseError("expected '->'", cur.loc());
  }
  cur.skipSpaces();
  const to = readTypedRef(cur);

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
// Sub-parsers
// ---------------------------------------------------------------------------

function readTypedRef(cur: Cursor): { type: NodeType; id: string } {
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
  return { type, id };
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
