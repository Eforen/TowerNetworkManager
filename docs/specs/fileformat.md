# File Format (TNI v1)

Line-oriented text format for serializing a Tower Networking Manager project. Mirrors the model in [graphdata.md](graphdata.md). Goals: human-editable, diff-friendly, lossless round-trip, safe to paste into chat or commit to git.

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
- **Device port identifier**: composite `parentId/portN` where `parentId` is the owning `server` / `switch` / `router` id and `N` is a non-negative integer (e.g. `sw1/port0`). Used quoted on `port` entity lines. `port` node ids are globally unique within the `port` type.
- **User port id (hardware address)**: 1..5 numeric digits; used only for type `userport` (customer endpoint gear).
- **Uplink id**: exactly four letters `A–Z` or `a–z`; normalized to lowercase in the model (e.g. `MTVW` and `mtvw` are the same node).
- **Network address**: `@[A-Za-z0-9_\-/]{1,9}` (must start with `@`, total <= 10 chars per [graphdata.md](graphdata.md)).
- **Hardware address**: 1..5 numeric digits, used as a `userport` id or as the `hardwareAddress` property on a server / switch / router.
- **Quoted string**: `"..."`, backslash escapes `\"`, `\\`, `\n`.
- **Bare word**: same charset as identifier, used for property keys, type names, and tags.
- **Tag**: `#Tag` — PascalCase canonical tag from [graphdata.md](graphdata.md).
- **Property**: `key=value` where value is bare word, number, network address, or quoted string.

## Entity declaration

```
<type> <id-or-address> [#Tag ...] [key=value ...]
```

- `<type>` is one of the node types (lowercased): `player`, `port`, `userport`, `switch`, `router`, `server`, `floor`, `rack`, `uplink`, `customer`, `customertype`, `rtable`, `domain`, `networkaddress`, `consumerbehavior`, `producerbehavior`, `behaviorinsight`, `usagetype`, `program`.
- `<id-or-address>`:
  - For `networkaddress`: the network address (`@f1/c/1`) serves as the id.
  - For `uplink` entity lines: four letters plus required positional media (see **Uplink declaration** below); id is stored lowercase.
  - For `userport`: 1..5 digit hardware address plus required positional media (see **User port declaration**).
  - For `port`: see **Port declaration** — device NICs use quoted composite ids; legacy `port <digits> <MEDIA> #UserPort` is still parsed but stored as `userport` (prefer `userport` lines for new files).
  - For `domain`: the domain name quoted or bare (`"example.com"`).
  - For `usagetype`: a kebab-case slug from the canonical catalog in [behaviors.md](behaviors.md) (or a custom slug matching `[a-z][a-z0-9-]*`).
  - For `program`: a slug matching `[a-z][a-z0-9_-]*` (game-style ids allow underscores, e.g. `padu_v1`); see [programs.md](programs.md).
  - For `customer`, `player`, `server`, `switch`, `router`, `floor`, `rack`, `customertype`, `rtable`, `consumerbehavior`, `producerbehavior`, `behaviorinsight`: an identifier.
- Tags and properties are optional and order-independent inside a single line.
- Re-declaration of the same `(type, id)` is an error.

### User port declaration

Customer-owned endpoint (no `NIC` edge; cabled to device `port` nodes):

```
userport <hardware> <MEDIA> [#Tag ...] [key=value ...]
```

- `<hardware>`: 1..5 digits (`HARDWARE_ADDR` in [graphdata.md](graphdata.md)).
- `<MEDIA>`: `RJ45`, `RJ`, `FiberOptic`, `FIBER`, or `F` (case-insensitive). Stored as tag `RJ45` or `FiberOptic`; not re-emitted as `#RJ45` / `#FiberOptic` on the line.

### Uplink declaration

Building / ISP uplink port:

```
uplink <code> <MEDIA> [#Tag ...] [key=value ...]
```

- `<code>`: four letters; normalized to lowercase in the model.
- `<MEDIA>`: same aliases as `userport` / `port`.

### Port declaration (device NIC)

Device ports use a dedicated line shape because media is always required. The id is the **composite** `parent/portN`, quoted:

```
port "<parent>/port<N>" <MEDIA> [#Tag ...] [key=value ...]
```

- `<MEDIA>`: same aliases as above; stored as `RJ45` / `FiberOptic` tag; not re-emitted as `#Tag` for media.
- **Legacy:** `port <digits> <MEDIA> #UserPort` (optional quoted form with `#UserPort`) is accepted and imported as a **`userport`** node. Numeric `port <digits> <MEDIA>` **without** `#UserPort` is invalid — use `userport` for customer gear.

Canonical examples:

```
port "sw1/port0" RJ45
userport 38118 RJ45
uplink mtvw FIBER
```

Examples:

```
customertype casual_dweller name="Casual Dweller"
customer organic-goat
networkaddress @f1/c/1
floor f1
switch sw1 #Switch hardwareAddress=42
port "sw1/port0" RJ45
userport 38118 RJ45
uplink mtvw FIBER
server db01 #Server hardwareAddress=17 traversalsPerTick=200
router r1 #Router hardwareAddress=9
rtable r1-rt
domain "example.com"
```

## Relationship declaration

```
<typeA>[<id>] -> <typeB>[<id>] [:<RelationName>] [{key=value, ...}]
```

- Direction is left-to-right. Undirected relationships (cable links, uplink connections) are serialized with endpoints in id-sorted order and `:` is required to disambiguate from ambiguous pairs.
- `:<RelationName>` is the canonical edge type from [graphdata.md](graphdata.md): `NIC`, `Owner`, `AssignedTo`, `Route`, `FloorAssignment`, `RackAssignment`, `NetworkCableLinkRJ45`, `NetworkCableLinkFiber`, `UplinkConnection`, `Insight`, `Consumes`, `Provides`, `Install`.
  - If omitted, the parser infers it from the single legal edge type between the two endpoint types; if zero or more than one match, this is an error.
- `{...}` contains optional edge properties.

Examples:

```
customer[organic-goat] -> customertype[casual_dweller] :Owner
customer[organic-goat] -> userport[38118] :Owner
networkaddress[@f1/c/1] -> customer[organic-goat] :AssignedTo
port[sw1/port0] -> userport[38118] :NetworkCableLinkRJ45
switch[sw1] -> port[sw1/port0] :NIC
server[db01] -> port[db01/port1] :NIC
rtable[r1-rt] -> rtable[r2-rt] :Route {target=@f2/c/1}
```

## Implicit-subject continuation lines (`->` / `=>`)

Authoring shortcut for chaining edges off a shared subject without repeating it:

```
-> <TypedRef> [:RelationName] [{key=value, ...}]
=> <EntityDecl>  [:RelationName] [{key=value, ...}]
```

- The **anchor** is the most recent *entity declaration* line. Arrow lines (lines that begin with `->` or `=>`), blank lines, full-form edge declarations (`typeA[id] -> typeB[id]`), and comment-only lines do NOT change the anchor.
- `->` creates an edge `anchor -> <TypedRef>`. The target must already exist (either earlier in the file or elsewhere in the project when parsing fragments).
- `=>` creates the entity on the right-hand side *and* an edge between the anchor and the new entity. Entity declaration syntax is identical to a normal entity line (e.g. `=> userport 38118 RJ45 :Owner`, `=> port "sw1/port0" RJ45 :NIC`).
- **Direction resolution.** Parsers try `(anchor, new)` first, then `(new, anchor)`; the order that matches a legal pair for the chosen relation wins. If the relation is omitted, inference runs the same way and must yield exactly one legal pair.
- It is an error if:
  - No prior entity declaration exists (no anchor).
  - The resulting direction has zero or >1 legal relations.
  - An `->` line targets an entity that does not exist yet.

Example (equivalent forms):

```
# compact
customer organic-goat
=> userport 52682 RJ45 :Owner
=> networkaddress @f1/c/3 :AssignedTo
-> consumerbehavior[casual-dweller] :Owner

# expanded (canonical for new commands)
customer organic-goat
userport 52682 RJ45
networkaddress @f1/c/3
customer[organic-goat] -> userport[52682] :Owner
networkaddress[@f1/c/3] -> customer[organic-goat] :AssignedTo
customer[organic-goat] -> consumerbehavior[casual-dweller] :Owner
```

## Edge-ref selectors

Inside a TypedRef, the `>` operator chains through an existing outgoing *or* incoming edge to resolve a related node by type:

```
<Type>[<id>]>Type                 # first edge of that type from the subject
<Type>[<id>]>Type[<index>]        # N-th edge (0-based)
<Type>[<id>]>Type[<id-of-target>] # filter the target by its id (or network address)
```

- The subject's neighborhood is searched across *any* relation whose pair allows (subject,target) or (target,subject); edges are enumerated in the order they were added to the graph.
- Index form uses 0-based positions into the filtered list; the special form `<N>` as a qualifier is treated as an index, NOT a literal id lookup. Prefix with `#` to force literal id matching of a decimal id (`>port[#0]`).
- The target type may itself include a selector chain: `customer[x]>userport[0]>port` (find the 0th userport linked to `customer[x]`, then the first port linked to that port).
- Errors: no match, ambiguous unqualified reference (>1 candidate with no qualifier AND no index), or invalid subject.

Example:

```
customer[organic-goat]>userport              # first userport linked to the customer
customer[organic-goat]>userport[0]           # same, explicit index
customer[organic-goat]>networkaddress         # first networkaddress assigned to the customer
customer[organic-goat]>networkaddress[@f1/c/3] # the specific assigned address
```

## Grammar (EBNF)

```
File          = Header { Line } .
Header        = "!tni v1" NL .
Line          = Comment | EntityDecl | EdgeDecl | ArrowLine | BlankLine .
BlankLine     = NL .
Comment       = "#" { AnyCharButNL } NL .
EntityDecl    = Type Identity { Tag } { Prop } NL .
EdgeDecl      = TypedRef "->" TypedRef [ ":" RelationName ]
                [ "{" PropList "}" ] NL .
ArrowLine     = ArrowRef | ArrowEntity .
ArrowRef      = "->" TypedRef [ ":" RelationName ]
                [ "{" PropList "}" ] NL .
ArrowEntity   = "=>" EntityDecl .
TypedRef      = (Type "[" Identity "]" | TypedRef ">" Selector) .
Selector      = Type [ "[" (Integer | "#" Identity | Identity) "]" ] .
Type          = "player" | "port" | "userport" | "switch" | "router" | "server"
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
2. Emit entities, grouped and ordered by type in this fixed order: `floor`, `rack`, `uplink`, `port`, `userport`, `switch`, `router`, `server`, `program`, `rtable`, `player`, `customertype`, `customer`, `domain`, `networkaddress`, `usagetype`, `behaviorinsight`, `consumerbehavior`, `producerbehavior`. Within a group, sort by id (lexicographic; network addresses compared as strings).
3. Emit one blank line.
4. Emit edges, grouped by relation in this fixed order: `FloorAssignment`, `RackAssignment`, `UplinkConnection`, `NetworkCableLinkFiber`, `NetworkCableLinkRJ45`, `NIC`, `Install`, `Owner`, `AssignedTo`, `Route`, `Insight`, `Consumes`, `Provides`. Within a group, sort by `(fromType, fromId, toType, toId)`.
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
line 19, col 14: numeric 'port …' without #UserPort is invalid (use 'userport <id> <MEDIA>')
```

## Example (full)

```
!tni v1
# Small demo: one customer on floor 1 with a streaming behavior

floor f1
rack r1
userport 12345 RJ45
port "sw1/port0" RJ45
port "db01/port1" RJ45
switch sw1 #Switch hardwareAddress=42 traversalsPerTick=1000
router rt1 #Router hardwareAddress=9 traversalsPerTick=500
server db01 #Server hardwareAddress=17 traversalsPerTick=200 cpuTotal=8 memoryTotal=8 storageTotal=16
customertype casual_dweller name="Casual Dweller"
customer organic-goat
domain "netplix.example"
networkaddress @f1/c/1
networkaddress @f1/s/1

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
rack[r1] -> server[db01] :RackAssignment
switch[sw1] -> port[sw1/port0] :NIC
server[db01] -> port[db01/port1] :NIC
port[sw1/port0] -> userport[12345] :NetworkCableLinkRJ45
server[db01] -> program[gitcoffee] :Install
server[db01] -> program[padu_v1]   :Install
customer[organic-goat] -> customertype[casual_dweller] :Owner
customer[organic-goat] -> userport[12345] :Owner
customer[organic-goat] -> consumerbehavior[casual-home-user] :Owner
networkaddress[@f1/c/1] -> customer[organic-goat] :AssignedTo
networkaddress[@f1/s/1] -> server[db01] :AssignedTo
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
