# File Format (TNI v1)

Line-oriented text format for serializing a Tower Networking Inc project. Mirrors the model in [graphdata.md](graphdata.md). Goals: human-editable, diff-friendly, lossless round-trip, safe to paste into chat or commit to git.

## File layout

```
!tni v1
# optional comments
<entity declarations>
<blank line>
<relationship declarations>
```

- A file MUST begin with the version sentinel `!tni v1` on line 1.
- `#` starts a comment to end-of-line. Blank lines are allowed anywhere and are not significant (except to separate the two canonical sections when serialized).
- A backslash `\` at the very end of a line continues the statement on the next line.
- Encoding: UTF-8, LF line endings on serialize. Parser accepts CRLF.

## Lexical rules

- **Identifier** (`<id>`): `[a-z0-9][a-z0-9_-]*`, 1..64 chars.
- **Network address**: `@[A-Za-z0-9_\-/]{1,9}` (must start with `@`, total <= 10 chars per [graphdata.md](graphdata.md)).
- **Quoted string**: `"..."`, backslash escapes `\"`, `\\`, `\n`.
- **Bare word**: same charset as identifier, used for property keys, type names, and tags.
- **Tag**: `#Tag` — PascalCase canonical tag from [graphdata.md](graphdata.md).
- **Property**: `key=value` where value is bare word, number, network address, or quoted string.

## Entity declaration

```
<type> <id-or-address> [#Tag ...] [key=value ...]
```

- `<type>` is one of the node types (lowercased): `player`, `port`, `switch`, `router`, `server`, `floor`, `rack`, `uplink`, `customer`, `customertype`, `rtable`, `domain`, `networkaddress`, `consumerbehavior`, `producerbehavior`, `behaviorinsight`, `usagetype`, `program`.
- `<id-or-address>`:
  - For `port`, `networkaddress`, `uplink`: the network address (`@f1/c/1`) serves as the id.
  - For `domain`: the domain name quoted or bare (`"example.com"`).
  - For `usagetype`: a kebab-case slug from the canonical catalog in [behaviors.md](behaviors.md) (or a custom slug matching `[a-z][a-z0-9-]*`).
  - For `program`: a slug matching `[a-z][a-z0-9_-]*` (game-style ids allow underscores, e.g. `padu_v1`); see [programs.md](programs.md).
  - For `customer`, `player`, `server`, `switch`, `router`, `floor`, `rack`, `customertype`, `rtable`, `consumerbehavior`, `producerbehavior`, `behaviorinsight`: an identifier.
- Tags and properties are optional and order-independent inside a single line.
- Re-declaration of the same `(type, id)` is an error.

Examples:

```
customertype casual_dweller name="Casual Dweller"
customer organic-goat
networkaddress @f1/c/1
floor f1
port @f1/c/1 #RJ45 #UserPort
server db01 #Server address=10.0.0.5
router r1 #Router
rtable r1-rt
domain "example.com"
```

## Relationship declaration

```
<typeA>[<id>] -> <typeB>[<id>] [:<RelationName>] [{key=value, ...}]
```

- Direction is left-to-right. Undirected relationships (cable links, uplink connections) are serialized with endpoints in id-sorted order and `:` is required to disambiguate from ambiguous pairs.
- `:<RelationName>` is the canonical edge type from [graphdata.md](graphdata.md): `NIC`, `Owner`, `Route`, `FloorAssignment`, `RackAssignment`, `NetworkCableLinkRJ45`, `NetworkCableLinkFiber`, `UplinkConnection`, `Insight`, `Consumes`, `Provides`, `Install`.
  - If omitted, the parser infers it from the single legal edge type between the two endpoint types; if zero or more than one match, this is an error.
- `{...}` contains optional edge properties.

Examples:

```
customer[organic-goat] -> customertype[casual_dweller] :Owner
customer[organic-goat] -> networkaddress[@f1/c/1] :Owner
port[@f1/c/1] -> floor[f1] :FloorAssignment
server[db01] -> port[@f1/s/1] :NIC
rtable[r1-rt] -> rtable[r2-rt] :Route {target=@f2/c/*}
```

## Grammar (EBNF)

```
File          = Header { Line } .
Header        = "!tni v1" NL .
Line          = Comment | EntityDecl | EdgeDecl | BlankLine .
BlankLine     = NL .
Comment       = "#" { AnyCharButNL } NL .
EntityDecl    = Type Identity { Tag } { Prop } NL .
EdgeDecl      = TypedRef "->" TypedRef [ ":" RelationName ]
                [ "{" PropList "}" ] NL .
TypedRef      = Type "[" Identity "]" .
Type          = "player" | "port" | "switch" | "router" | "server"
              | "floor" | "rack" | "uplink" | "customer" | "customertype"
              | "rtable" | "domain" | "networkaddress"
              | "consumerbehavior" | "producerbehavior"
              | "behaviorinsight" | "usagetype" | "program" .
Identity      = Ident | NetAddr | QuotedString .
RelationName  = PascalIdent .
Tag           = "#" PascalIdent .
Prop          = Key "=" Value .
PropList      = Prop { "," Prop } .
Key           = Ident { "." Ident } .
Value         = Ident | Number | NetAddr | QuotedString .
Ident         = /[a-z0-9][a-z0-9_-]*/ .
PascalIdent   = /[A-Z][A-Za-z0-9]*/ .
NetAddr       = /@[A-Za-z0-9_\-\/]{1,9}/ .
Number        = /-?[0-9]+(\.[0-9]+)?/ .
QuotedString  = /"([^"\\]|\\.)*"/ .
NL            = "\n" | "\r\n" .
```

## Canonical serialization

To guarantee byte-identical round-trips (modulo user comments, which are preserved positionally on a best-effort basis):

1. Emit header `!tni v1`.
2. Emit entities, grouped and ordered by type in this fixed order: `floor`, `rack`, `uplink`, `port`, `switch`, `router`, `server`, `program`, `rtable`, `player`, `customertype`, `customer`, `domain`, `networkaddress`, `usagetype`, `behaviorinsight`, `consumerbehavior`, `producerbehavior`. Within a group, sort by id (lexicographic; network addresses compared as strings).
3. Emit one blank line.
4. Emit edges, grouped by relation in this fixed order: `FloorAssignment`, `RackAssignment`, `UplinkConnection`, `NetworkCableLinkFiber`, `NetworkCableLinkRJ45`, `NIC`, `Install`, `Owner`, `Route`, `Insight`, `Consumes`, `Provides`. Within a group, sort by `(fromType, fromId, toType, toId)`.
5. Within entity/edge lines, tag tokens come before property tokens; tags sorted lexicographically; props sorted lexicographically by key.
6. Quoted strings normalized to use `"` quotes with minimal escaping.
7. Trailing whitespace stripped; file ends with exactly one newline.

A parser implementation MUST accept any valid form; a serializer MUST emit only canonical form.

## Round-trip guarantee

- `parse(serialize(model)) == model` (structural equality).
- `serialize(parse(canonicalText)) == canonicalText` byte-for-byte.
- For non-canonical input, the round-trip produces the canonical equivalent; user comments are reattached to the entity/edge that followed them in the original file when possible.

## Browser storage

- Per-project file text is stored under key `tni.project.<slug>` as a string.
- The project index is stored under key `tni.projects` as JSON: `{ slugs: string[]; active: string }`.
- Palette history under `tni.cmdhistory` (see [commandline.md](commandline.md)).
- Filter presets under `tni.filter.presets` as JSON `Record<name, FilterState>` (sets serialized as arrays).
- Optional undo snapshot under `tni.project.<slug>.undo` (see [commands.md](commands.md)).
- Storage quota check: before save, compute serialized size; if > 4 MB, warn and prompt to export instead.
- Storage writes use try/catch around `localStorage.setItem`; on `QuotaExceededError`, the command returns an error and leaves state unchanged.

## Versioning and migration

- The header MUST be `!tni v1`. Future versions bump the integer.
- A parser seeing a higher version rejects the file with a clear error and suggests exporting from the newer app.
- Migrations are one-way: `migrate_v1_to_v2(text): text`. Migrations run on load, and the user is prompted before overwriting the stored copy.

## Error reporting

Parser errors include line and column and a short hint. Examples:

```
line 4, col 10: unknown edge type ':Ownner' (did you mean 'Owner'?)
line 7, col 1: duplicate entity 'server[db01]'
line 12, col 15: network address '@f1/customer/1' exceeds 10-char limit
```

## Example (full)

```
!tni v1
# Small demo: one customer on floor 1 with a streaming behavior

floor f1
rack r1 floor=f1
port @f1/c/1 #RJ45 #UserPort
switch sw1 #Switch traversalsPerTick=1000
router rt1 #Router traversalsPerTick=500
server db01 #Server address=10.0.0.5 traversalsPerTick=200 cpuTotal=8 memoryTotal=8 storageTotal=16
customertype casual_dweller name="Casual Dweller"
customer organic-goat
domain "netplix.example"

program gitcoffee cpu=4 memory=2 storage=4 pool.provide.main=16
program padu_v1 cpu=1 memory=2 storage=4 pool.provide.main=1

usagetype stream-video label="Stream Video"
usagetype read-text
usagetype update-software
usagetype store-text
behaviorinsight evening-tv name="Evening TV" bandwidthPerTick=40 activeProbability=0.6
consumerbehavior casual-home-user name="Casual Home User"

floor[f1] -> rack[r1] :FloorAssignment
floor[f1] -> switch[sw1] :FloorAssignment
switch[sw1] -> port[@f1/c/1] :NIC
server[db01] -> program[gitcoffee] :Install
server[db01] -> program[padu_v1]   :Install
customer[organic-goat] -> customertype[casual_dweller] :Owner
customer[organic-goat] -> networkaddress[@f1/c/1] :Owner
customer[organic-goat] -> consumerbehavior[casual-home-user] :Owner
consumerbehavior[casual-home-user] -> behaviorinsight[evening-tv] :Insight
behaviorinsight[evening-tv] -> usagetype[stream-video] :Consumes {required=25}
domain["netplix.example"] -> usagetype[stream-video] :Provides {required=50}
program[gitcoffee] -> usagetype[read-text]       :Provides {pool=main}
program[gitcoffee] -> usagetype[update-software] :Provides {pool=main}
program[gitcoffee] -> usagetype[store-text]      :Consumes {amount=2}
program[padu_v1]   -> usagetype[store-text]      :Provides {pool=main}
```

## Non-goals

- No binary format.
- No streaming parser (files are tiny, whole-file reads are fine).
- No embedded binary blobs (icons, floor plans) in v1.
