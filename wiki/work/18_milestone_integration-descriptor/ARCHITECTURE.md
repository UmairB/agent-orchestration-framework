# 18 · Per-folder integration descriptor — Architecture (ADRs)

> **This file SUPERSEDES the prior milestone-18 architecture** (the "Notion parent-grouping"
> ADR-001..005: a `notion: { parent: <key> }` SPEC.md-frontmatter key + a central
> `work.integrations.notion.parents` map). Those ADRs were built and accepted earlier on this branch,
> then judged redundant against the real `voice-vox-web` usage (SPEC §Objective). The ADRs below
> **supersede** them; the mapping is in §"Superseded prior ADRs". ADRs are immutable — a later decision
> supersedes, never edits.

Decisions local to this milestone live here. The durable carried-over principle (authored-vs-derived,
17/ADR-001) is reaffirmed in ADR-006; it is not re-derived.

## Recalled prior-architecture context (acknowledged)

`work memory recall` surfaced exactly the prior 18/ADR-001..005 (the frontmatter+central-`parents`
design). Those are the **supersession target**, not a near-miss to honour — they are consciously
departed from for the reasons in SPEC §Objective (a single central key→pageId map and a single-board
`dataSourceId` cannot express "different items on different boards"). The one piece carried over intact
is their authored-vs-derived split (prior ADR-001 ⊃ 17/ADR-001) — see ADR-006.

Retro lesson **R1 (m18)** — "a SPEC open question can be over-determined by the prior milestone's
posture; check before framing it as open" — is **honoured**: the SPEC's four open questions each carry an
explicit *lean*, and the STATE records them as documented defaults. ADR-001..004 below take those leans as
decided defaults and do **not** re-litigate them. Retro lesson **R4 (m18)** — extending the shared
`parseFrontmatter` to read an inline map silently changed parsing for every frontmatter reader (a
brace-wrapped-scalar blast radius) — is the load-bearing motivation for ADR-003 (a discrete JSON file,
not frontmatter) and ADR-007 (revert the parser). Memory was on; the block was non-empty.

---

## ADR-001 — Parent addressing: a raw page-id OR a named key, disambiguated by shape

**Context.** A descriptor's `parent` must name an existing Notion page (the phase/parent the milestone
nests under). Two affordances are wanted: a **raw page-id** (fully self-contained, locality is the whole
point) for one-offs, and a **named key** into a small central registry (dedupe a shared parent across many
folders). The SPEC's lean: "allow a raw id, optionally a key — locality is the whole point, shared-parent
dedupe is the minority case."

**Decision.** `.integrations.json` `notion.parent` accepts **either** a raw Notion page-id **or** a named
key, disambiguated by **shape, not by a discriminator field**:

- A **page-id** is a 32-hex UUID, with or without dashes (`^[0-9a-fA-F]{32}$` after stripping `-`, i.e.
  the canonical `8-4-4-4-12` form or the 32-hex compact form). When `parent` matches this shape it is used
  **verbatim** as the relation parent page id — no registry lookup, fully self-contained.
- Any other string is a **key** resolved against a central registry: the chosen board's
  `boards.<board-key>.parents` map (a closed `{ <key>: <page-id> }` peer of `statusMap`, per board). A key
  absent from that board's `parents` is an **honest** `unknown-parent-key` command error at associate time
  naming the available keys (never a dangling write) — the authored-validity check (mirrors prior
  18/ADR-002's posture, now per-board).
- The registry lives **per board** (`boards.<board-key>.parents`), not a single global `parents`, because
  a page-id is board-scoped (a relation cannot cross databases) — a key only makes sense relative to the
  board it nests on. Resolution: the descriptor's `board` (ADR-002) selects the board; that board's
  `parents` resolves the key.

**Consequences.** Locality wins for the common case (paste an id into the folder). Shared parents dedupe
via a key without a global table. The shape-test means an operator cannot ambiguously name a key that
"looks like" a UUID — acceptable: keys are human slugs, never 32-hex. The associate verb resolves keys
**purely against committed config** (no Notion read — ADR-006). The page-id-verbatim path needs no config
at all.

**Supersedes** prior 18/ADR-001 (parent as a key-only into a global `parents`) + ADR-004 (the no-read
posture is preserved in ADR-006, generalised).

---

## ADR-002 — The `boards` registry: a closed per-board map with a designated default + flat back-compat

**Context.** m17 shipped a single flat `work.integrations.notion` block (one `dataSourceId`,
`statusProperty`, `statusMap`, `relationProperty`, `tokenEnv`). The SPEC requires addressing **multiple**
boards by key so two milestones can route to different boards. m17's config must not break (it just
shipped). Validation must happen at the **Ajv-2020 schema-compile seam** (the m17-retro-mandated idiom),
NOT `validateConfig` — `validateConfig` is hand-rolled per-field diagnostics
(`src/config-inspect.mjs:140`) and never compiles the JSON-Schema, so a schema-shape invariant is only
enforced by compiling `aof.schema.json` with Ajv-2020 (the `acd-notion-parents-schema` /
`acd-headroom-config-schema` idiom).

**Decision.** Promote the flat block to a **`boards` registry**:

```jsonc
work.integrations.notion = {
  "default": "<board-key>",            // REQUIRED when `boards` is present: names the default board
  "boards": {
    "<board-key>": {
      "dataSourceId": "...",           // required (per board)
      "tokenEnv": "...",               // optional (default NOTION_API_TOKEN)
      "statusProperty": "...",         // required
      "statusMap": { ... },            // required, the closed 4-status map (m17 shape)
      "relationProperty": "...",       // required
      "parents": { "<key>": "<page-id>" }  // optional (ADR-001), closed string-valued map
    }
  }
}
```

- **Default designation = a `default` string key naming a board** (`default: "<board-key>"`), NOT a board
  literally keyed `default`. Rationale: a string pointer is unambiguous and lets the default be renamed
  without renaming a board; a magic board-key `"default"` would collide with a real board an operator
  might call "default". `default` must name a key present in `boards` (an Ajv-level cross-check is not
  expressible in plain JSON-Schema — so the **runtime resolver** (ADR-003) treats an unknown `default` as a
  config error; the schema only requires `default` to be a string when `boards` is present).
- **Back-compat (the SPEC lean).** An **existing flat block** (a `notion` block with `dataSourceId` at the
  top level and no `boards` key) is treated as the **implicit `default` board**: the resolver synthesises
  `boards = { default: <the flat block> }`, `default = "default"`. The schema is a **`oneOf`**: either the
  flat m17 shape (top-level `dataSourceId`+…, closed, `parents` allowed per ADR-001) **or** the
  `boards`-registry shape (`{ default, boards }`, closed). m17 configs validate byte-for-byte; the two
  shapes are mutually exclusive (you cannot have both `dataSourceId` at top level and `boards`).
- The `notion` block stays **closed** in both arms (`additionalProperties:false`); each board entry is
  closed; `statusMap` stays the closed 4-status map. An unknown peer / a malformed board entry is rejected
  at the Ajv seam.

**Consequences.** Multiple boards are addressable by key; m17 is opt-in-compatible. The opt-in no-op gate
(17/ADR-004) is unchanged: an **absent** `notion` block is still an honest no-op. The sync-work command
reads the **resolved** board connection (ADR-003), so `notion-sync-work.mjs` no longer reads
`config.work.integrations.notion` as a flat block — it goes through the resolver. The `parents` sub-block
moves **per board** (was a single global map under prior 18/ADR-002).

**Supersedes** prior 18/ADR-002 (the global `parents` closed map) — `parents` is now a per-board peer; the
single flat block is promoted to a registry.

---

## ADR-003 — The descriptor: a per-folder `.integrations.json`, read by a new `src/integrations/routing.mjs`

**Context.** The routing intent (which board, which parent) must be **co-located** with the item, committed,
and **not** milestone frontmatter — R4 (m18) showed extending `parseFrontmatter` to read an inline map is a
blast-radius hazard across every frontmatter reader. The reader must resolve the **record-doc folder** so
imported/converted (AOF.md-class) milestones are first-class (the original m18 BLOCKER fix). The name
`notion-descriptor`/`NOTION_DESCRIPTOR` is **already taken** by the m12 tool-store descriptor for the `ntn`
binary (`src/tool-store.mjs:361`, `src/notion/cli.mjs:3`, `test/notion-descriptor.test.mjs`) — it must not
be reused.

**Decision.**

- **File:** a discrete dotfile **`.integrations.json`** at the work item's **folder root** (a sibling of
  `SPEC.md`/`AOF.md`/`STORY.md`), machine-managed by `associate` (ADR-004). **Provider-namespaced**:
  `{ "notion": { "board"?: <board-key>, "parent"?: <page-id|key> } }`. Both `notion` fields are optional;
  the whole `notion` block is optional; an absent file ⇒ default board, top-level (m17), unchanged.
- **Reader module: `src/integrations/routing.mjs`** (a **new** `src/integrations/` directory). Named
  `routing` (not `descriptor`) to avoid the m12 `NOTION_DESCRIPTOR` collision; "routing" is what it answers
  ("which board/parent does this item route to"). It reads the file with **`JSON.parse`** — it has **no**
  `parseFrontmatter` import or dependency (the FF below + ADR-007 enforce this). Its API (illustrative, the
  build pins it):
  - `readRouting(item)` → `{ notion?: { board?, parent? }, ... }` (the parsed descriptor, `{}` on absent
    file — never throws, mirroring `readMapping`'s absent-file tolerance).
  - `resolveNotionRouting(item, notionConfig)` → `{ board: <resolved board connection>, parentPageId|null,
    reason? }` — combines the descriptor with the `boards` registry: descriptor `board` → that board's
    connection; absent `board` → the `default` board; `parent` per ADR-001 (id verbatim / key→`parents`);
    an absent/unresolvable parent ⇒ `parentPageId: null` + an honest `reason` (top-level).
  - `writeRouting(item, next)` / clearing — the associate mutation (ADR-004).
- **Record-doc-folder resolution.** The reader resolves the item's folder via **`recordDoc(item)`
  semantics** (`src/work.mjs:97` — AOF.md-first for a converted milestone, else SPEC.md), i.e. the
  `.integrations.json` lives in the **same folder** as the resolved record doc. It does NOT hardcode
  `SPEC.md`. (The descriptor is folder-rooted, so in practice "the folder" is `item.dir`; the recordDoc tie
  matters for the doc-class first-classness and is the carried-forward BLOCKER fix.)
- **Provider extensibility.** The reader **tolerates an unknown provider key** (a future `jira`/`linear`
  block) — it reads only `notion`, ignores peers, and never hard-fails on a non-`notion` key. (There is no
  JSON-Schema gate on `.integrations.json` itself — it is a machine file the associate verb writes; the
  *closedness* invariant that bites is on the central `notion` **config** block, ADR-002. The descriptor's
  `notion` sub-shape is validated by the reader/associate, not Ajv.)

**Consequences.** `parseFrontmatter` is untouched by routing (ADR-007 reverts its m18 extension). Imported
milestones carry routing. The reader is the **new shared seam** both `associate` (write) and `projection`
(read) consume — the story spine (§Story boundaries). `src/integrations/routing.mjs` has a small import
surface (`node:fs`, `path`, and `recordDoc` from `work.mjs`); it does **not** import any Notion spawn seam
(ADR-006).

**Supersedes** prior 18/ADR-003 (associate writes the `notion.parent` frontmatter key) — the write target
is now `.integrations.json`, not frontmatter.

---

## ADR-004 — The `associate` verb rewrite: the descriptor write is the only mutation

**Context.** The verb must record/clear routing in the committed work stream, validate against committed
config, and make no other mutation (never the sidecar, never Notion). It stays a registered command-core
command (`notion:associate`, `src/command-core.mjs:94`) on the `integrations notion` namespace with the
`--json` envelope (08/ADR-004, 17/ADR-002).

**Decision.** `aof work integrations notion associate <ref> --board <key> --parent <page-id|key|none>`:

- Resolves the item via the shared `listItems` traversal (NO new traversal). Associating routing is a
  **milestone**-level action (a top-level milestone), as before — a non-milestone ref is the honest
  `not-a-milestone` error.
- **Validates against committed config** (purely, no Notion read — ADR-006): `--board <key>` must be a key
  in `boards` (or resolve to the implicit `default` for a flat config) — an unknown board is an honest
  `unknown-board-key` error naming available boards. `--parent` per ADR-001: a key must resolve in the
  chosen board's `parents` (`unknown-parent-key`), a page-id is shape-checked and accepted verbatim.
- **The ONLY mutation is the `.integrations.json` write** (via `writeRouting`, ADR-003) — it writes
  **neither** the git-ignored sidecar **nor** Notion. `--parent none` clears the parent; clearing the whole
  `notion` block (e.g. `--board none` or a dedicated clear) is in scope; an empty descriptor may be removed
  or left as `{}` (the build pins it; either round-trips to "absent ⇒ defaults").
- **Idempotent**: a write that changes nothing is reported `unchanged` and makes no disk write. The result
  envelope reports `{ ref, board, parent, action: "set"|"unset"|"unchanged" }`.

**Consequences.** The authored routing is visible in the committed stream (a JSON file, diffable), never a
derived artifact (ADR-006). Because the only mutation is a JSON write and there is no spawn seam imported,
the no-Notion-read invariant (ADR-006) holds by construction. `associate` ← `command-core`, → `work.mjs`
(for `listItems`/`recordDoc`) + the new `routing.mjs` reader (graph impact: associate currently → `errors`,
`work.mjs`; it gains `integrations/routing.mjs`).

**Supersedes** prior 18/ADR-003 (the frontmatter-rewrite associate) — the verb now writes
`.integrations.json` and gains `--board`.

---

## ADR-005 — Multi-board sidecar coexistence: key the sidecar per data-source

**Context.** I (architect) flagged this and resolve it here. The SPEC objective requires "two milestones
routed to **different boards** each land in the right place after one sync-work." Today
`src/notion/mapping.mjs` scopes the sidecar to **one** `dataSourceId` at the top level: `readMapping`
returns empty entries when the file's `dataSourceId` differs (`mapping.mjs:62`), and `recordPageId`
**replaces the scope** when recording under a different data-source (`mapping.mjs:85-91`). So syncing
milestone B on board Y would clobber milestone A's bindings on board X — A would then create **duplicate**
pages on its next sync (a real data-loss bug under the new multi-board capability). The graph shows
`mapping.mjs` is a **3-importer hub** (`notion-sync-work.mjs`, `projection.mjs`, `sync.mjs` all
import it), so this is the right single place to fix coexistence.

**Decision.** Re-key the sidecar to hold entries for **>1 board**, keyed per data-source:

```jsonc
// .aof/notion.work-map.json  (still git-ignored, still derived — ADR-006)
{ "version": 2, "boards": { "<dataSourceId>": { "entries": { "<aofRef>": { pageId, lastStatus, lastSyncedAt } } } } }
```

- `readMapping(projectRoot, dataSourceId)` returns the entries **under that data-source's bucket** (empty
  when the bucket is absent) — so a binding under ds-A and a binding under ds-B **coexist** in one file; B's
  sync no longer empties A's bucket.
- `recordPageId(projectRoot, dataSourceId, …)` writes into **that data-source's bucket**, leaving other
  buckets untouched (the clobber is gone).
- The per-board **scoping guarantee** of the old shape is preserved at the bucket boundary: a ref resolves
  ONLY under its own data-source (two boards never collide). The `acd-notion-mapping-sidecar` round-trip
  invariant ("a binding under one data-source does not resolve under another") still holds — now because
  buckets are separate, not because the whole file is single-scope.
- **Migration of the existing single-board shape** (`{ version:1, dataSourceId, entries }`): `readMapping`
  reads the v1 shape as the bucket for *its* `dataSourceId` (a one-line back-compat: if `parsed.version < 2`
  and `parsed.dataSourceId === dataSourceId`, treat `parsed.entries` as the bucket). The first
  `recordPageId` rewrites the file in v2 shape. No standalone migration step; it is additive and safe — a
  derived artifact re-derives.

**This is a documented default, not a blocker** (additive, safe). It is **in scope** for this milestone
(story 01) — without it the SPEC's "different boards" acceptance cannot pass. The egress (`createPageArgv`
in `sync.mjs`) is unchanged; only `mapping.mjs`'s file shape + read/record scoping change, and
`projection.mjs`/`notion-sync-work.mjs` pass the **per-routing** `dataSourceId` (from ADR-003's resolver)
into `readMapping`/`projectMilestone` instead of a single flat `dataSourceId`.

**Supersedes** nothing (the single-board sidecar was 17/ADR-001; this **extends** it to multi-board — 17's
authored-vs-derived and sidecar-is-sole-resolver invariants are preserved, ADR-006).

---

## ADR-006 — Authored-vs-derived + one-way, reaffirmed (carried over: 17/ADR-001, 17/ADR-003)

**Context.** The one principle carried intact from the prior m18 (STATE §Notes) and from m17: **authored**
routing is committed; the **derived** page-id binding stays the git-ignored sidecar; egress is one-way.

**Decision (reaffirmation, not a new mechanism).**

- **Routing is AUTHORED → committed**: `.integrations.json` (ADR-003) + the `boards` config (ADR-002). It is
  read from these committed facts + the descriptor, **never** the sidecar; the sidecar gains **no** routing
  field (no `board`/`parent`/`phase` key on an entry).
- **The page-id binding stays DERIVED → the git-ignored `.aof/notion.work-map.json` sidecar** (ADR-005's
  multi-board shape; still in `AOF_GITIGNORE_ENTRIES`). Re-deriving the sidecar (e.g. deleting it and
  re-syncing) loses **no routing choice** — routing lives entirely in committed files, so a fresh sidecar
  re-binds page ids without touching routing.
- **One-way (17/ADR-003) is UNCHANGED.** The associate write and the projection make **no** Notion read —
  no spawn seam imported, no `pages retrieve`/`query`/`search` argv. The only Notion egress remains a page
  `create`/`update` in `sync.mjs`. `acd-notion-one-way`'s allowed/forbidden verb sets are byte-for-byte
  unchanged; the new no-read FF (FF-D) reaffirms them with a snapshot guard.

**Consequences.** The multi-board sidecar (ADR-005) does not weaken any m17 invariant — it only re-shapes a
derived file. The whole design opens **no** addressing-read exception (the prior 18/ADR-004 conclusion,
generalised: addressing comes from committed config + the descriptor, never a Notion query).

**Supersedes** prior 18/ADR-004 (the no-read posture) by **generalising** it — kept, not dropped.

---

## ADR-007 — Revert the `parseFrontmatter` inline-flow-map extension (the highest-blast-radius cut)

**Context.** The prior m18 extended `src/work.mjs` `parseScalarOrCollection` with an inline-flow-map `{}`
branch (`work.mjs:138-150`) to read `notion: { parent: <key> }` from frontmatter. The graph shows
`work.mjs` is the **god-node** — **imported by 14 modules** (board-ui, cli, command-core, list, next,
notion-associate, notion-sync-work, resolve, validate, graphify-backend, local-indexing, terminal-ws,
work-doctor, work-memory). Reverting the parser branch is the **highest-blast-radius** change in this
milestone: every frontmatter reader runs through `parseFrontmatter`. R4 (m18) flagged the extension itself
as a brace-wrapped-scalar hazard.

**Decision.** Revert `parseScalarOrCollection` to its **pre-m18 minimal shape**: scalars + inline lists
`[a,b]` + quoted scalars — **drop the inline-flow-map `{}` branch**. Remove the `notion.parent` frontmatter
convention entirely. Remove the central `parents` schema block from `aof.schema.json` (replaced by the
per-board `parents` of ADR-002). This cut is **safe ONLY after** stories 00+01 land: nothing may read
`notion.parent` from frontmatter anymore (the descriptor reader + projection rewrite must be the routing
source first). The build-order dependency (00 → 01 → 02) is therefore **load-bearing**, not cosmetic.

**Consequences.** `parseFrontmatter` returns to a shape no routing feature depends on — the shared seam is
de-risked for all 14 importers. The FF `reader-is-JSON-no-parseFrontmatter` (FF-B) encodes both halves: the
new reader uses `JSON.parse` with no `parseFrontmatter` dependency, AND `parseScalarOrCollection` has no
`{}` branch.

**Supersedes** prior 18/ADR-005 (the `notion.parent`-driven projection) — the projection now reads routing
from the descriptor (ADR-003), and the frontmatter mechanism it depended on is removed.

---

## Fitness functions (arch-tests to author in the build)

Each ADR's structural invariant becomes a CI arch-test under `test/arch/`, wired into `scripts/test.mjs`,
mirroring the prior idioms (Ajv-2020 compile seam; registry-driven temp-fixture with a non-vacuous
self-check; source-grep with comment/string stripping + a planted-form self-check). Names below are the new
test names; each states the exact invariant + which prior test it supersedes.

- **FF-A · `acd-integrations-descriptor-committed`** — *descriptor-is-committed-not-derived.* Routing is read
  from `.integrations.json` + the `boards` config, **never** the sidecar; the sidecar entry shape gains **no**
  routing field (`board`/`parent`/`phase`). Source-grep `src/integrations/routing.mjs` + `projection.mjs` +
  `mapping.mjs` + `notion-associate.mjs`: no read of `entries[*].(board|parent|phase)`, no
  `recordPageId(... board|parent ...)`, mapping entry shape names none of them; the resolver DOES read the
  descriptor + `boards`. Non-vacuous: the forbidden matchers fire on a planted form.
  **Supersedes** `acd-notion-association-committed`.

- **FF-B · `acd-integrations-reader-is-json`** — *reader-is-JSON-no-parseFrontmatter + the revert.* (a) the
  reader (`src/integrations/routing.mjs`) uses `JSON.parse` and has **no** `parseFrontmatter` import/usage;
  (b) `src/work.mjs` `parseScalarOrCollection` is back to its pre-m18 minimal shape — **no inline-flow-map
  `{}` branch** (grep that the `{`-startsWith/`}`-endsWith flow-map branch is absent). Non-vacuous: the
  `{}`-branch matcher fires on a planted flow-map branch. **New** (encodes ADR-007's revert).

- **FF-C · `acd-integrations-board-resolution`** — *board resolution + default fallback.* Drive the resolver
  (`resolveNotionRouting`) over fixtures: a descriptor naming `board: X` resolves to X's connection; an
  absent `board` ⇒ the `default` board; an **absent descriptor** ⇒ default board, **top-level, byte-for-byte
  m17** (the no-regression arm — the resolved op equals the m17 op with no routing). Imports the resolver +
  `projectMilestone`; asserts the three arms. **New** (covers ADR-002/ADR-003 routing); subsumes the
  no-regression arm of the retired `acd-notion-parent-projection`.

- **FF-D · `acd-integrations-no-notion-read`** — *no Notion read on associate or projection.* Neither the
  associate write nor the projection imports/constructs a Notion spawn seam (`makeNotionSpawn`/`notion/cli`/
  `notionSpawn`) nor a read-verb argv (`retrieve`/`query`/`search`/`list`/`get`); plus the **snapshot guard**
  over `acd-notion-one-way`'s allowed/forbidden verb sets (byte-for-byte unchanged). Reaffirms 17/ADR-003.
  **Supersedes** `acd-notion-parent-no-read`.

- **FF-E · `acd-integrations-descriptor-extensible`** — *provider-namespaced + extensible.* The
  `.integrations.json` reader **tolerates an unknown provider key** (e.g. a `jira` block) — it is ignored,
  not a hard failure (the reader returns the `notion` routing and does not throw on a peer provider). Driven
  over a temp fixture with a planted unknown provider block. **Supersedes** `acd-notion-parents-schema`'s
  extensibility intent; the *closedness* half moves to FF-F.

- **FF-F · `acd-integrations-boards-schema`** — *boards-registry schema at the Ajv-2020 seam.* Compile
  `aof.schema.json` with Ajv-2020 (NOT `validateConfig`): (a) a valid `boards` registry (`{ default, boards:
  { k: {…} } }`) validates; (b) a **flat back-compat** m17 block validates (the `oneOf`); (c) a **malformed
  board entry** (missing `dataSourceId`, a non-string `parents` value, an unknown peer in a board or in the
  `notion` block) is **rejected**; (d) the `notion` block stays **closed** (an unknown peer rejected, the
  failure on the closed block). Mirrors `acd-notion-parents-schema`'s compile idiom. **Supersedes**
  `acd-notion-parents-schema` (becomes the boards-registry fitness).

**Retired with their mechanism (deleted in story 02, not replaced):** the behavioural+arch tests bound to
the frontmatter mechanism — `acd-notion-associate-frontmatter-only`, `acd-notion-association-committed`,
`acd-notion-parent-no-read`, `acd-notion-parent-projection`, `acd-notion-parents-schema` (arch), and the
behavioural `notion-associate*`, `notion-parent-projection`, `notion-parents-schema` — superseded as mapped
above. The `acd-notion-one-way` and `acd-notion-mapping-sidecar` (m17) arch-tests **stay** (sidecar round-trip
re-pointed at the v2 multi-board shape; one-way reaffirmed by FF-D).

---

## Doctor / context-budget treatment of `.integrations.json` (ADR-002/003 corollary — resolved)

`.integrations.json` is **out-of-scope by construction** for the m16 context budget and the m15 doctor
doc-bloat surfaces — **no ignore rule is needed**. Grounded in the code: `work-doctor.mjs:160,175` records
`docSizes` only for `SPEC.md`/`STORY.md`/`ARCHITECTURE.md`, and `work-doctor-budget.mjs`'s `BUDGET_KEY`
keys only those three. A dotfile the snapshot never measures cannot be flagged. The freshness/coherence
groups walk record docs, not arbitrary dotfiles. So the dotfile is silent to doctor by construction; the
decision is to **rely on that** (no new ignore), and to state it here so a future doctor change that begins
walking dotfiles knows `.integrations.json` is a machine file, not a budgeted context doc. (A one-line note
may be added to the budget group's comment when story 02 lands — not a behavioural change.)

---

## Story boundaries (graph-grounded)

Confirmed via `aof graph build src` + `aof graph impact` (run fresh at this decision point; results cited
inline). The partition follows the **real coupling**: the new `src/integrations/routing.mjs` reader is the
seam both the authoring side (associate) and the consumption side (projection) depend on, so it is the
**spine** and must land first; `work.mjs` is the **god-node** (14 importers) so its revert is last and
gated. Graph facts as actual structure (not inferred):

- `notion-associate.mjs` ← `command-core` (1); → `errors`, `work.mjs` (2). Gains the new `routing.mjs`.
- `projection.mjs` ← `notion-sync-work.mjs` (1); → `mapping.mjs` (1). Gains `routing.mjs` (read side).
- `sync.mjs` ← `notion-sync-work.mjs` (1); → `mapping.mjs` (1).
- `mapping.mjs` ← `notion-sync-work.mjs`, `projection.mjs`, `sync.mjs` (**3-importer hub**); → `workspace`
  (1). The single place to fix multi-board coexistence (ADR-005).
- `work.mjs` ← **14 importers** (the god-node); → `fs`, `workspace` (2). The `parseFrontmatter` revert
  (ADR-007) is the highest blast-radius cut — safe only after routing stops reading `notion.parent`.

**Story 00 — descriptor reader + `boards` registry + `associate` rewrite (the AUTHORING SPINE).** New
`src/integrations/routing.mjs` (JSON.parse, recordDoc-folder resolution, absent ⇒ defaults,
provider-namespaced/unknown-tolerated, the `resolveNotionRouting` resolver). Schema: the `boards` registry
+ `default` + flat back-compat `oneOf` at the Ajv-2020 seam (ADR-002). `notion-associate.mjs` rewrite
(`--board <key> --parent <id|key|none>` writes/clears `.integrations.json`, validates against committed
config, the ONLY mutation — ADR-004). Coupling: associate ← command-core, → work.mjs + the new reader; the
reader is the new seam both associate and projection consume. **FFs guarding this story's behaviour** (the
arch-test FILES are all authored in story 02's atomic test-swap, NOT here): FF-F (boards schema), FF-E
(extensible reader), the associate half of FF-A/FF-D.

**Story 01 — projection routing + multi-board sidecar (the CONSUMPTION side).** `projection.mjs` reads
routing via the story-00 resolver (board → connection, parent → relation parent page id), addresses the
chosen board, nests via that board's `relationProperty`; no descriptor/parent ⇒ default board, top-level
(m17 byte-for-byte). `mapping.mjs` gets the **multi-board sidecar** (ADR-005, the v2 per-data-source bucket
shape + v1 migration); `sync.mjs`/`notion-sync-work.mjs` thread the per-routing `dataSourceId` through.
Coupling: projection/sync ← sync-work → mapping (the 3-importer hub). Consumes story-00's reader. **FFs
guarding this story's behaviour** (arch-test FILES authored in story 02's swap): FF-C (board resolution +
default fallback), the projection half of FF-A/FF-D. The **re-pointed `acd-notion-mapping-sidecar`
round-trip** (updating the m17 round-trip test to the v2 multi-board sidecar shape) IS owned by THIS story —
it lands with the `mapping.mjs` re-shape so the kept m17 test stays green across the change.

**Story 02 — supersede the frontmatter mechanism + author the fitness invariants.** Revert `work.mjs`
`parseScalarOrCollection` to the pre-m18 minimal reader (drop the `{}` inline-flow-map branch — ADR-007);
remove the `parents` schema block + the `notion.parent` frontmatter convention; **delete** the 5 superseded
arch-tests (`acd-notion-associate-frontmatter-only`, `-association-committed`, `-parent-no-read`,
`-parent-projection`, `-parents-schema`) + the superseded behavioural tests (`notion-associate*`,
`notion-parent-projection`, `notion-parents-schema`) and their `scripts/test.mjs` wiring; author the NEW
fitness arch-tests (FF-A..F) and wire them. Coupling: `work.mjs` is the 14-importer god-node — this cut is
safe ONLY after 00+01 stop reading `notion.parent`.

**Build-order dependency (load-bearing): 00 → 01 → 02.** 01 needs 00's reader/resolver + the `boards`
registry; 02's `parseFrontmatter` revert is safe only once 00+01 have made the descriptor the sole routing
source (nothing reads `notion.parent` from frontmatter). The breakdown MUST list this order.

*Adjustment vs the proposed partition: none — confirmed as proposed.* The graph supports it exactly: the
reader is the convergence seam (spine first), `mapping.mjs` is the hub where multi-board coexistence belongs
(story 01, with projection), and the god-node revert is correctly last and gated.

---

## Superseded prior ADRs (mapping)

| Prior 18 ADR (frontmatter+central-`parents` design) | Replaced by |
| --- | --- |
| 18/ADR-001 — association committed in frontmatter + global `parents`; authored-vs-derived | **ADR-001** (parent addressing: id-or-key, per-board `parents`) + **ADR-006** (authored-vs-derived reaffirmed) |
| 18/ADR-002 — global closed `parents` map at the Ajv seam | **ADR-002** (`boards` registry; `parents` per board, at the Ajv seam) |
| 18/ADR-003 — associate writes `notion.parent` frontmatter | **ADR-003** (`.integrations.json` + `routing.mjs` reader) + **ADR-004** (associate writes the descriptor) |
| 18/ADR-004 — associate PURE / no-read | **ADR-006** (no-read generalised: addressing from committed config + descriptor, never a Notion query) |
| 18/ADR-005 — projection resolves `parents[meta.notion.parent]` | **ADR-003** (projection reads routing from the descriptor) + **ADR-007** (revert the frontmatter mechanism) |
