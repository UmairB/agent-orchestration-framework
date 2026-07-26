---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 40 · Work-item versioning & the upgrade path — Architecture Decisions

> Inputs: `SPEC.md` (give a work item a **version**, give aof a way to **run the upgrade**, and keep the
> load-bearing property that *a migration is code that runs, not prose that advises* — the changelog is
> generated from the registry, never hand-authored) and `STATE.md` (the five open questions for refine +
> the inherited **reconstruction-is-not-migration** constraint). This milestone borrows the three existing
> versioning idioms (`GLOBAL_WORK_SCHEMA_VERSION`, `INDEX_VERSION`, `aof project migrate`); it invents no
> fourth (SPEC scope).
>
> **Codebase-graph grounding.** The graph was rebuilt fresh at this refine (`aof graph build src` →
> **1924 nodes, 4954 edges, 89 communities**, `builtAt` = this session; `aof graph impact` read back
> per-file below). It reports the two facts that shape every decision here — cited as *actual* structure,
> not inferred:
> - **`src/work.mjs` is a god-node — imported/called by 39 modules** (`aof graph impact src/work.mjs`;
>   ~26 live `src/**` consumers — `cli`, `command-core`, `commands/validate`, `commands/next`,
>   `commands/list`, `commands/resolve`, `commands/run-start`, `commands/run-complete`,
>   `commands/mesh-*`, `commands/notion-*`, `commands/insert-shared`, `commands/promote-gap-to-chore`,
>   `board-ui`, `global-work-store`, `integrations/routing`, `memory/graphify-backend`,
>   `memory/local-indexing`, `mesh-assignment-reclaim`, `mesh-launcher`, `mesh-worker-execution`,
>   `terminal-ws`, `work-doctor`, `work-memory`, `work-reindex` — plus ~13 retired m35 reference tests)
>   and **imports only 3** (`fs`, `node-identity`, `workspace`). Anything bolted INTO `work.mjs` inherits
>   that 39-module blast radius. This is the single hardest constraint on the milestone (ADR-004/ADR-005).
> - **`src/global-work-store.mjs` is the primary versioning precedent** (`aof graph impact` → 12 in, 2 out;
>   it imports `work.mjs` + `workspace.mjs`, never the reverse). `GLOBAL_WORK_SCHEMA_VERSION = 3`
>   (`global-work-store.mjs:7`) + `readSchemaVersion(db)` (`:80-87`, treats a null/absent version as
>   needing migration) + the recorded migration (`:189-196`) is the exact shape ADR-001/003/005 apply to
>   the *document* stream. Memory's `INDEX_VERSION = 1` (`memory/local-indexing.mjs:26`) and
>   `aof project migrate` (the legacy root-config → `.aof/` migrator, `cli.mjs:2362-2395`,
>   `config-inspect.mjs:77/254`, dry-run/apply shape) are the two secondary precedents.
>
> The graph is one input; the boundaries below are the architect's call. The inherited
> reconstruction constraint (SPEC "Why the backfill is deliberately excluded" + STATE "Inherited
> constraint") is encoded in ADR-008 and is the readiness criterion the whole milestone is measured
> against.

---

## ADR-001: The version is TWO fields — a machine-comparable schema integer `schema` that drives migration, and a human-legible provenance stamp `aofVersion` (the aof that created the item). The current schema is a single exported constant `WORK_ITEM_SCHEMA_VERSION` in `work.mjs`, mirroring `GLOBAL_WORK_SCHEMA_VERSION`

**Status:** Accepted
**Date:** 2026-07-17

**Context.** Q1 asks *what the version is*: the aof package string (`0.1.0`), a monotonic schema integer,
or both. These answer different questions and conflating them makes both useless (SPEC/STATE). A migration
selector must compare *ordinally* — "is this item behind the current shape, and by which steps?" — which a
package string (`0.1.0` vs `0.1.0-rc.2` vs a git build) cannot answer deterministically. A human asking
"which aof produced this?" wants the package string, not an opaque integer. The precedent already keeps
these separate: `global-work-store.mjs` compares the **integer** `GLOBAL_WORK_SCHEMA_VERSION` (`:7`,
`:30`, `:189`) to decide migration, while the node registry separately records a human `aof_version`
string column (`global-work-store.mjs:139`). One drives logic; the other is provenance.

**Decision.**
- **Two frontmatter keys on the record doc, never one:**
  - **`schema`** — a non-negative **integer**, the work-item schema version. This is the *only* field the
    migration selector reads. It is compared ordinally against the current-schema constant. It mirrors the
    `GLOBAL_WORK_SCHEMA_VERSION` integer exactly.
  - **`aofVersion`** — a **string**, the aof package version that *created* the item, sourced from
    `packageVersionString()` (`asset-base.mjs:235`). Human-legible provenance ("the aof that created it").
    It is never parsed for logic and never gates a transform.
- **The current schema is ONE exported constant, `WORK_ITEM_SCHEMA_VERSION`, in `src/work.mjs`.** It is an
  integer, mirroring `GLOBAL_WORK_SCHEMA_VERSION`'s single-exported-constant idiom
  (`global-work-store.mjs:7`). Its initial value is **1** — schema 1 IS the current document shape as of
  this milestone. It lives in `work.mjs` and NOT in the registry module because story 01 (the stamp +
  reader) must consume it *before* the registry (story 02) exists (see the story partition); `work.mjs` is
  the item-frontmatter authority (19/ADR-002), so the current-shape declaration belongs with the reader
  and the born-stamp. The registry's highest transform target is then bound *equal* to this constant by a
  fitness function (ADR-005, `acd-work-item-schema-single-constant`) so the split introduces no drift.
- **`aofVersion` is a born-stamp: written at creation, NOT rewritten by an upgrade.** A migration advances
  `schema` (that is what a migration *is*); `aofVersion` keeps recording where the item came from. After an
  upgrade an item honestly reads `aofVersion: 0.1.0, schema: 2` — "born under 0.1.0, since migrated to
  shape 2". (Considered: also stamping a `migratedBy`/`upgradedAt` on each transform. Deferred — it widens
  the writer's bound (ADR-004) and the recorded-migration ledger already lives on the *store* side in the
  precedent, `global-work-store.mjs:189-196`; a per-item "last migrated by" can be added as its own field
  later without re-opening this ADR. Flagged for the PO.)

**Consequences.** Migration selection is deterministic integer arithmetic; provenance is legible without
polluting the selector. The reader seam (`readMeta`, `work.mjs:344`) gains two keys the existing minimal
`parseFrontmatter` (`work.mjs:314`) already parses as scalars — no parser change (18/ADR-007 protected).
`schema` absent ⇒ baseline 0 (ADR-003). The anti-drift binding (ADR-005) means "current schema" has
exactly one source of truth even though the constant and the transforms live in two modules.

---

## ADR-002: The stamp lives in per-item record-doc frontmatter — items can drift independently, so per-item is the honest shape. New items are born stamped at scaffold time; the existing stream is backstamped

**Status:** Accepted
**Date:** 2026-07-17

**Context.** Q2 asks *where the stamp lives*: per-item (precise, but every item carries a write) or once
per stream (cheap, but cannot express a partially-upgraded stream). The deciding question STATE poses is
"can items drift independently?" — and they demonstrably can: streams are installed into other repos
(voice-vox-web, let-shield) at whatever aof was current that week, and a future migration may touch some
item *types* but not others (e.g. m39's `OUTCOME.md` backfill targets only `status: done` milestones, not
stories or spikes). A single stream-level stamp cannot represent "milestones migrated, stories not yet",
and a half-applied `aof upgrade` (interrupted, or a transform that legitimately skips items it does not
apply to) would leave a stream-level stamp lying. The record doc is already the per-item identity/status
authority (`recordDoc`, `work.mjs:287`), so it is the natural carrier.

**Decision.**
- **`schema` + `aofVersion` live in each item's record-doc frontmatter** — the file `recordDoc(item)`
  resolves (`work.mjs:287-298`): `SPEC.md`/`AOF.md` for a milestone, `STORY.md`, `SESSION.md`,
  `SPIKE.md`, `CHORE.md`. Per-item, so a partially-upgraded stream is representable and honest.
- **New items are born stamped.** Scaffolding (the bundle/insert render path — `insert-shared.mjs`'s
  `renderStoryTemplate` (`:271`), the milestone/story templates) writes `schema: <WORK_ITEM_SCHEMA_VERSION>`
  and `aofVersion: <packageVersionString()>` into the frontmatter at creation. A newly created item is
  never stale-by-construction.
- **The existing aof stream (00-39) is backstamped**, via the same registered transform that stamps any
  unstamped item (ADR-003) — not a bespoke one-off script.

**Consequences.** ~40 items each gain two frontmatter lines; each write is a surgical frontmatter-block
edit (ADR-004), never a body touch. Per-item is more writes than a stream stamp but it is the only shape
that survives selective migrations and interrupted upgrades. `validateWork` (`work.mjs:574`) can now report
staleness *per item* (ADR-005 / story 03).

---

## ADR-003: An item with no `schema` field reads as the pre-versioning baseline, schema 0 — the version the registry migrates FROM. The aof repo's own current stream backstamps to the current schema; foreign unstamped streams read 0 and upgrade forward

**Status:** Accepted
**Date:** 2026-07-17

**Context.** Q3 asks what version items 00-39 (which predate the stamp) *are*. The honest answer STATE
already gestures at is "unknown / pre-versioning", which the registry must then be able to migrate *from*.
The precedent handles exactly this: `readSchemaVersion(db)` returns `null` when the schema table is absent
and `0` when the row is missing (`global-work-store.mjs:80-87`), and `migrateSchema` treats a null/less-than
version as "needs migration" (`:30`, `:189`). Absence is a legible signal, not an error.

**Decision.**
- **No `schema` frontmatter key ⇒ the item is read as schema `0`** — the pre-versioning baseline. The
  reader (story 01, extending `readMeta`, `work.mjs:344`) coerces a missing/non-integer `schema` to `0`,
  mirroring `readSchemaVersion`'s null→needs-migration treatment.
- **Schema 0 is a real registered "from" version.** The **0 → 1 transform is the stamp transform**: it
  writes `schema: 1` + `aofVersion` onto an unstamped item. This is what backstamps the aof repo's own
  stream (00-39) — those items ARE the current shape, so stamping them schema 1 is truthful, not a
  reconstruction (ADR-008). It is also the registry's *first* transform, so `WORK_ITEM_MIGRATIONS`' highest
  target (1) equals `WORK_ITEM_SCHEMA_VERSION` (1) from day one (ADR-005 anti-drift).
- **A foreign unstamped stream reads as 0 and upgrades forward** through whatever transforms exist. The
  0 → 1 transform stamps it; genuinely-older *shape* drift (a stream predating m14's `AOF.md` digest or
  m37's `spike`/`chore`) is NOT retroactively reconstructed by the stamp — those shape moves predate the
  registry and have no registered transform, and inferring their missing content would be exactly the
  forbidden reconstruction (ADR-008). The stamp declares the *version*; shape transforms are added
  explicitly, as code, when written.

**Consequences.** The registry is never empty (it always carries at least 0 → 1), so the anti-drift
invariant is well-defined from the first commit. Backstamping is "run the 0 → 1 transform over the stream"
— a use of `aof upgrade` (ADR-007), not a special path. A stream two shape-generations behind reads 0,
stamps to 1, and validate stops nagging; any residual *shape* gap is a future registered transform, never
a silent guess.

---

## ADR-004: The migration writer is a NEW, transform-scoped frontmatter writer in `work.mjs` — NOT a widening of `rollbackItemStatus`. It rewrites only the leading `---…---` block (body byte-identical), runs ONLY inside a registered transform, and persists atomically via `fs.mjs:writeText`

**Status:** Accepted
**Date:** 2026-07-17

**Context.** Q4 is the load-bearing frontmatter decision. `rollbackItemStatus` (`work.mjs:375`) is the
FIRST — and today ONLY — programmatic item-frontmatter writer (20/ADR-005). Its bound is deliberate and
documented (`work.mjs:364-374`): it sets `status` ONLY from `in-progress` to `not-started`|`blocked`
(`ROLLBACK_TARGETS`, `:362`), touches ONLY the `status` line, leaves the body and every other key
byte-identical (the surgical reassembly at `:400-403`), and refuses to bump `updated`. That bound exists
precisely so it never becomes a general mutator. A migration transform needs a *broader* write — it adds
keys (`schema`, `aofVersion`), may rename a doc or restructure frontmatter — which is exactly the widening
the rollback writer was bounded to prevent. Widening `rollbackItemStatus` would dissolve the one guarantee
that makes it safe; and per ADR of 19/ADR-002 the store may not write frontmatter at all — `work.mjs` is
the sole item-frontmatter authority.

**Decision.**
- **A SEPARATE, transform-scoped writer lives in `work.mjs`** (indicatively `applyItemFrontmatter(item,
  mutate)` / `writeItemFrontmatter`) — a NEW export, exactly as `rollbackItemStatus` was a new export
  alongside the readers. It is NOT reached by widening `rollbackItemStatus`; the rollback writer keeps its
  hard status-only bound untouched.
- **Its bound, precisely:** it rewrites **only the leading `---…---` frontmatter block** of the record doc
  — it may add, rename, remove, or re-value frontmatter keys — and reassembles the **body byte-for-byte**
  around it, using the same block-capture + slice idiom `rollbackItemStatus` uses (`work.mjs:390-404`). It
  NEVER edits authored body prose. It does NOT round-trip through `parseFrontmatter` + reserialize (that
  shared 14-importer parser drops comments/order/formatting — 18/ADR-007). It persists through the atomic
  `writeText` temp+rename seam (`fs.mjs`), never a bare `writeFile`.
- **It runs ONLY inside a registered transform.** The writer is the primitive the registry's `apply`
  functions call; it is not a public "edit any frontmatter" verb. Creating or renaming a *sibling* doc
  (e.g. adding `OUTCOME.md`) is a distinct registry capability layered on top — a new file is not a
  frontmatter-block rewrite, and a reconstructed new doc carries the ADR-008 marker.
- **Fitness function `acd-migration-writer-body-preserving`** proves the body-byte-identity bound, mirroring
  any `rollbackItemStatus` body-preservation test.

**Consequences.** The god-node gains ONE new writer with a stated, tested bound — not a general mutator.
The rollback writer's bound is preserved verbatim (two narrow writers, each bounded, beat one wide one).
Because the writer is in `work.mjs`, ALL frontmatter-mutating surface stays in the one authority module;
the registry engine (ADR-005) calls it but lives outside `work.mjs`, so the 39-module blast radius does not
grow.

---

## ADR-005: The migration registry + `aof upgrade` engine are a NEW module (`src/work-upgrade.mjs`) that IMPORTS `work.mjs`, never the reverse. The registry is the single source of truth; the highest transform target EQUALS `WORK_ITEM_SCHEMA_VERSION`; `aof upgrade` is dry-run-first, atomic, and idempotent — mirroring `GLOBAL_WORK_SCHEMA_VERSION` / `readSchemaVersion` / `aof project migrate`

**Status:** Accepted
**Date:** 2026-07-17

**Context.** The engine must enumerate items, read each `schema`, compute the ordered set of transforms
between "what this item is" and "what aof is now", and apply them. It is a heavy, fs-mutating,
multi-item routine. `work.mjs` is imported by 39 modules and imports only 3 (`aof graph impact
src/work.mjs`); bolting the engine into it drags that whole blast radius along for no gain — the engine
needs `work.mjs`'s readers, not the reverse. This is the exact shape m41 resolved for the re-index engine
(`work-reindex.mjs` imports `work.mjs`, guarded by `acd-reindex-engine-blast-radius`), and the same
direction `global-work-store.mjs` already respects (it imports `work.mjs`, `aof graph impact` → 2 out).
The SPEC also fixes the *idiom*: follow `GLOBAL_WORK_SCHEMA_VERSION` / `readSchemaVersion` / the recorded
migration, and the `aof project migrate` dry-run/apply face — invent no fourth.

**Decision.**
- **A new module, `src/work-upgrade.mjs`, holds the registry and the engine.** It exports
  `WORK_ITEM_MIGRATIONS` — an ordered list of transform descriptors, indicatively
  `{ from, to, id, summary, apply, reconstructs? }` — and an engine (`planUpgrade` / `runUpgrade`). It
  IMPORTS `work.mjs`'s readers + the ADR-004 writer; **`work.mjs` NEVER imports `work-upgrade.mjs`**
  (fitness `acd-upgrade-engine-blast-radius`, mirroring m41/ADR-001).
- **The registry is the single source of truth.** Its highest transform `to` value MUST equal
  `WORK_ITEM_SCHEMA_VERSION` (fitness `acd-work-item-schema-single-constant`) — the constant declares the
  target, the registry provides the path to it, and the two cannot drift. Transforms form a contiguous
  chain (0 → 1 → 2 → …); the engine selects the sub-chain `item.schema → current`.
- **`aof upgrade` is the CLI face**, a top-level verb over a registered command (indicatively `work:upgrade`),
  mirroring the `aof migrate` → `migrate:folder` face (`cli.mjs:830-845`) and the `aof project migrate`
  dry-run/apply shape (`cli.mjs:2362-2395`). It reports what would change **dry-run first**, applies on
  confirm, and writes through ADR-004's atomic writer.
- **Idempotent by construction** (fitness `acd-upgrade-idempotent`): an item already at
  `WORK_ITEM_SCHEMA_VERSION` selects an empty transform chain and is left byte-untouched; a second run is a
  no-op. This mirrors `openGlobalWorkProjectionStore` re-opening a current store without re-migrating
  (`global-work-store.mjs:29-39`).

**Consequences.** The engine is a near-leaf: no existing `work.mjs` dependent is forced to import it. The
selector is deterministic integer arithmetic over a contiguous chain. "Which migrations are pending" is an
`aof upgrade --dry-run` concern (this module), deliberately kept OUT of validate (ADR-006 / story 03 stays
dep-01-only). A store schema *newer* than the build is a refusal, not a downgrade (the `:30-37` precedent).

---

## ADR-006: The changelog is GENERATED from the registry, never hand-authored — "how do I upgrade" resolves to a command, and a generated artifact cannot drift from the transforms it describes

**Status:** Accepted
**Date:** 2026-07-17

**Context.** This is the SPEC's one load-bearing property. A hand-written changelog that *advises* how to
upgrade is the passive-note failure mode this stream is abolishing for delivery gaps (m39): it binds
nobody, is found only by whoever looks, and rots the moment the next transform lands. Repeating it one
milestone later would be a straight own-goal (STATE "Considered and rejected — a prose changelog").

**Decision.**
- **`WORK_ITEM_MIGRATIONS` is the single source; the changelog is a pure projection of it** — produced by a
  generator function over the registry (each descriptor's `id`/`from`/`to`/`summary`), not authored by
  hand. The generated artifact carries the `aof-generated` stamp (01/ADR-005 form) so it is self-identifying
  and drift-detectable.
- **"How do I upgrade" resolves to `aof upgrade`, not to prose.** The changelog *describes* the transforms;
  the *act* is the command. Validate names the command (story 03); the changelog enumerates the steps.
- **Fitness function `acd-changelog-generated`** proves non-drift: regenerating from `WORK_ITEM_MIGRATIONS`
  reproduces the committed artifact byte-for-byte (a hand edit would fail the drift guard), and the
  generator reads the registry — not the reverse.

**Consequences.** The changelog cannot describe a transform the registry does not contain, nor omit one it
does. Adding a transform + regenerating is the only way to change the changelog. No prose is load-bearing.

---

## ADR-007: `chore` is the vehicle for RUNNING an upgrade on an installed stream, NOT for BUILDING this machinery. This milestone builds the registry / `aof upgrade` / stamp / staleness as stories with real `.feature` contracts

**Status:** Accepted
**Date:** 2026-07-17

**Context.** Q5 asks whether `chore` is the right vehicle. A `chore` (37/ADR-002-003) is minimal-ceremony
housekeeping: a single `CHORE.md`, no `tasks/`, no `.feature`, verified by a checklist + green validate
(`acd-chore-no-feature`, `acd-chore-dod-checklist`). *Invoking* `aof upgrade` on a specific installed
stream (voice-vox-web, let-shield) later is exactly that shape — run the command, tick the checklist,
validate green. But *building* the registry, the engine, the stamp, and staleness is behaviour verifiable
by an outsider (does upgrade transform the right items? is it idempotent? does the writer preserve the
body?) — that demands `.feature` acceptance criteria, not a checklist.

**Decision.**
- **This milestone is built as stories with `.feature` contracts** (the four below), NOT as a chore. The
  machinery has observable behaviour and fitness functions; a chore's checklist cannot carry it.
- **Running an upgrade on a given installed stream is the chore-shaped act**, authored *later*, per target
  repo, once the machinery exists. m39's `OUTCOME.md` backfill is the first such registered transform
  (depending on both 39 and 40), and applying it to a specific stream is a chore.

**Consequences.** Recorded so nobody mistakes the milestone for a chore and strips its acceptance criteria.
The chore vehicle is reserved for the *invocation*, keeping the machinery under full contract.

---

## ADR-008: Reconstruction is NOT migration. `aof upgrade` transforms SHAPE only (add a field, rename a doc, restructure frontmatter); it never infers content, revises authored prose, or rewrites history. The registry MUST be able to mark a reconstructed doc so it can never be recalled as an authored fact — the readiness criterion for m39's backfill

**Status:** Accepted
**Date:** 2026-07-17

**Context.** This is the inherited constraint, stated in the SPEC and repeated in STATE because it is the
one most likely to be lost at refine. A mechanical migration (add `schema`, rename a doc) is total and
checkable. Authoring an `OUTCOME.md` for a milestone that closed months ago is neither — it requires an
agent to *read delivered code and infer* what shipped. Inference presented as fact is the exact defect m39
exists to kill, and exactly what 13/ADR-001 already forbids for imported `SPEC.md` (recovered intent is
legible, never a record source). Run that inference across a completed stream via a command and this
milestone becomes a fiction generator at scale. The precedent for the honest alternative already exists:
the import leg marks a recovered digest `imported: true` (`import/materialize.mjs` renderDigest; asserted
in `acd-import-digest-recallable`), and `isImportRecord` (`memory/local-indexing.mjs:453`, keyed off the
`import:` `IMPORT_ITEM_PREFIX`, `:445`) routes those to a soft `summary` record — never a hard `adr`/`lesson`
authored fact.

**Decision.**
- **`aof upgrade` transforms SHAPE only** — add/rename/restructure frontmatter, add or rename a doc. It
  never infers content from delivered code, never revises authored prose (ADR-004 body-byte-identity),
  never rewrites history.
- **The registry MUST be able to express a reconstructed-marker.** A transform descriptor can declare that
  it produces *reconstructed* content (indicatively `reconstructs: true`), and a doc so produced is written
  with a `reconstructed: true` frontmatter marker — the exact analogue of the import leg's `imported: true`.
  A registry that cannot express this distinction is NOT ready to carry m39's backfill, and shipping it
  anyway would industrialise the original defect.
- **A reconstructed doc can never be recalled as an authored fact.** The `reconstructed` marker is the
  memory layer's signal (the `imported`/`isImportRecord` idiom) to index such a doc as provenance, never as
  an authored `adr`/`lesson`/`outcome`. The *stamp* transform (0 → 1, ADR-003) is NOT a reconstruction — it
  records a true version, adds no inferred content, and sets no marker.
- **Fitness function `acd-reconstructed-marker-expressible`** proves the registry can carry the marker
  (readiness), guard-if-present on `work-upgrade.mjs`.

**Consequences.** This milestone builds a framework that is *ready* for the backfill without performing it
(backfill is out of scope, SPEC). The distinction "true version-stamp vs inferred content" is structural,
not a convention an author must remember. m39's backfill, when it lands, sets `reconstructs: true` on its
`OUTCOME.md` transform and inherits the recall-exclusion for free.

---

## Story boundaries (confirmed against `aof graph impact`)

Four stories, cut so cross-story dependency is minimal and grounded in the real coupling:

| Story | Scope | Touches | Intra-milestone dep |
| --- | --- | --- | --- |
| **01 · version stamp & reader** | `WORK_ITEM_SCHEMA_VERSION` constant, the two frontmatter keys, the reader (schema-0 baseline coercion), the born-stamp at scaffold, AND the ADR-004 transform-scoped writer primitive — all in `work.mjs` + the scaffold/insert templates | `work.mjs`, `insert-shared.mjs`, templates | **none** (foundation) |
| **02 · migration registry & `aof upgrade`** | `work-upgrade.mjs` (`WORK_ITEM_MIGRATIONS` incl. the 0 → 1 stamp transform + engine), the `aof upgrade` CLI face | NEW `work-upgrade.mjs` → imports `work.mjs`; `cli.mjs` | **01** |
| **03 · staleness in validate** | `validateWork` reports an item whose `schema < WORK_ITEM_SCHEMA_VERSION`, naming `aof upgrade` | `work.mjs` `validateWork` (`:574`) | **01 only** |
| **04 · generated changelog** | the generator projecting `WORK_ITEM_MIGRATIONS` → the `aof-generated`-stamped changelog | `work-upgrade.mjs` / a generator | **02** |

**Dep graph:** `01 → {02, 03}` and `02 → 04`. After 01 lands, **02 and 03 run in parallel** (both dep 01
only); 04 follows 02. This is the maximally-parallel cut.

**The staleness-independence question (03: dep-01 only, or forced onto 02?).** Confirmed **dep-01 only**,
grounded in the graph: `aof graph impact src/commands/validate.mjs`'s only relevant edge is
`validate → work.mjs`; `validateWork` (`work.mjs:574`) reads item frontmatter and would compare `schema`
against `WORK_ITEM_SCHEMA_VERSION` — both story-01 artifacts in `work.mjs`. **Naming the remedy `aof
upgrade` is a string literal in a finding message, NOT an import edge** — validate does not `import`
`work-upgrade.mjs`, so no code dependency on story 02 is created. The boundary is drawn precisely here:
staleness reports *schema-behind + the command name* (dep 01); enumerating *which* transforms are pending
requires the registry and is an `aof upgrade --dry-run` concern (story 02). Keeping that enumeration out of
validate is what preserves the parallel cut — if a future validate wants "3 migrations pending", that is a
deliberate dep-02 widening, not part of story 03.

**God-node discipline (graph-grounded).** `work.mjs` is a 39-dependent god-node. Stories 01 and 03 both
edit it, but in disjoint regions (01: the reader/stamp/writer/constant near the top seam; 03: staleness
findings inside `validateWork`, `:604-663`) and the `01 → 03` dep edge sequences them, so there is no
concurrent edit to the same lines. Every `work.mjs` change is **purely additive** (new exports, new
findings) — no existing reader/writer contract is widened (ADR-004). The engine (02) and changelog (04)
live OUTSIDE `work.mjs` (`work-upgrade.mjs → work.mjs`, never the reverse — `acd-upgrade-engine-blast-radius`),
so the 39-module blast radius does not grow.

---

## Security / compliance tier — verdict: **NO tier warranted**

`aof upgrade` does local, in-place frontmatter transforms on the user's own repo: **no network, no
personal/regulated data, no auth, no secrets, no cross-tenant surface.** The genuine risk is *data-loss
from a buggy transform* — and that is a **correctness** risk, fully covered by the fitness functions:
dry-run-first + confirm (ADR-005), idempotency (`acd-upgrade-idempotent`), atomic `writeText` temp+rename
(ADR-004), and body-byte-identity (`acd-migration-writer-body-preserving`). There is no threat model here —
no adversary, no boundary crossed, no data classified. A SECURITY.md tier would be ceremony over a
correctness problem the arch-tests already gate. **Challenge welcome, but the default holds: no security
tier.**

---

## Fitness functions (this milestone's structural invariants)

All authored **guard-if-present** (the m36/m41 refine-stage discipline): each is a clean no-op while its
target module/export is absent (suite stays green now) and arms into a hard assertion the moment the code
lands. Each pairs a positive assertion with a non-vacuity self-check.

| Arch-test | Invariant | ADR |
| --- | --- | --- |
| `acd-work-item-schema-single-constant` | `WORK_ITEM_SCHEMA_VERSION` is a monotonic int; the registry's highest transform `to` EQUALS it (no drift); a missing `schema` reads as 0 | 001/003/005 |
| `acd-upgrade-idempotent` | `aof upgrade` run twice is a no-op the second time; a stamped-current item is byte-untouched | 005 |
| `acd-migration-writer-body-preserving` | the transform-scoped writer rewrites only the frontmatter block; the body is byte-identical around the change (the `rollbackItemStatus` bound, widened only to the block) | 004 |
| `acd-changelog-generated` | the changelog is generated from `WORK_ITEM_MIGRATIONS` and cannot drift (regenerate == committed); the generator reads the registry, not the reverse | 006 |
| `acd-reconstructed-marker-expressible` | the registry can mark a produced doc reconstructed (the `imported: true` analogue); the stamp transform sets NO marker | 008 |
| `acd-upgrade-engine-blast-radius` | `work.mjs` never imports the upgrade engine; `work-upgrade.mjs` imports `work.mjs`, never the reverse — the god-node blast radius does not grow | 005 |
