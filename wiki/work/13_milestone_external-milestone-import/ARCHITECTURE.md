---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 13 · External Milestone Import — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — a new import command that ingests an
> existing milestone as *reference knowledge* into the 05/10 memory seam: knowledge not managed work,
> a one-time snapshot, read-only on the source) and `STATE.md` (`§Notes & decisions in flight`: the
> three framing decisions + the four open `refine` questions resolved by ADR-001…004 below). This
> milestone consumes the milestone-**05** memory contract WHOLE and re-opens none of it: the
> `MemoryRecord` with a resolving `source:line` + the derived-index invariant (`05/ADR-005`); the
> source set = RETROSPECTIVE R-entries + ARCHITECTURE ADRs, where *adding a source is a localised
> change — a new parser producing `MemoryRecord`s with a resolving `source`, gated by the same
> derived-index fitness function* (`05/ADR-007`); the backend interface `{name, recall, reindex,
> status}` and `reindex` rebuilds from `.md` (`05/ADR-003`); `memory.backend` selection (`05/ADR-002`).
> It also honours milestone **10** (`graphify` reaches graphify ONLY through the 09 registered
> `graph:*` commands — *no bespoke second integration* — `10/ADR-002`). The real code these ADRs build
> against was read at `file:line`: `src/memory/local-indexing.mjs` (`buildRecords(only, ctx)` scans
> `listItems(workDir)` top-level milestone folders for `RETROSPECTIVE.md`/`ARCHITECTURE.md`,
> `parseRetrospective`/`parseArchitecture` over `splitSections`/`inlineField`, the frozen
> `MemoryRecord`, the git-ignored `.aof/aof.memory.index.json`); `src/work.mjs` (`listItems` /
> `findWork` / `nextWork` / `validateWork` ALL key off `ITEM_RE = ^(\d+)_(milestone|story|task|uat)_…$`
> under `workDir` — the work-item resolver's ONLY surface); `src/command-core.mjs` (the frozen Command
> shape `{id, input, run, cli}` + `invoke(id, input, ctx)`, `ctx = {workspace}`); `src/work-memory.mjs`
> (the seam — `BACKEND_REGISTRY`, `selectBackendName`, `ctx = {workDir, projectRoot, configMemory}`);
> `src/planning-init.mjs` (the ONLY existing external-fetch idiom — read-only `git ls-remote` via
> argv-`spawnSync`, behind a `--dry-run` that spawns/writes/networks nothing, with an injection seam
> for offline tests); `src/aof-gitignore.mjs` (the self-contained nested-`.gitignore` discipline for
> derived artifacts, never the repo-root `.gitignore`); `src/commands/doc.mjs` (`DOC_FILES`:
> SPEC/STORY/VERIFICATION/RETROSPECTIVE).
>
> **Prior-lesson recall (mandatory, before any ADR).** `aof work memory recall "external milestone
> import recover knowledge index memory derived-index invariant command surface" --area architecture
> --block` returned an EMPTY block — no near-miss to honour or depart from (the active backend is
> `none` while this repo's memory is off, so recall is the no-op `none` backend; the very gap memory
> exists to fill). Decisions below stand on the 05/10 frozen contracts + the verified real code alone.

## ADR-001: An imported milestone materializes a `SPEC.md` + an `ARCHITECTURE.md`/`RETROSPECTIVE.md`-shaped knowledge artifact — REUSING the 05 doc conventions so the EXISTING parsers index it with NO new parser; recovered facts are records, never a hand-summarised second copy

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `STATE §Open-for-refine` Q1: the normalized artifact shape — a recovered SPEC-like "what
it set out to do" + an OUTPUT-like "what it delivered / decided / learned": one record or a pair, and
is `OUTPUT.md` a NEW doc type or a reuse? The load-bearing constraint forces the answer. The derived-
index invariant (`05/ADR-005`, `05/ADR-001`) says memory holds **no fact absent from its `.md`
source**, and the source it indexes is fixed by the real `buildRecords` (`src/memory/local-indexing.mjs:182`):
it reads each milestone's `RETROSPECTIVE.md` → `parseRetrospective` (`## R<n>` → `lesson` records) and
`ARCHITECTURE.md` → `parseArchitecture` (`## ADR-NNN` → `adr` records), each record carrying a
`source: "<workRelPath>:<1-based line>"` produced from the section heading line. `05/ADR-007` is
explicit that the way to add knowledge is *a new parser producing `MemoryRecord`s with a resolving
`source`* — but a NEW bespoke parser for a NEW `OUTPUT.md` shape is avoidable: if the import
materializes its recovered knowledge using the **same heading conventions** the two existing parsers
already read, the existing parsers index it with zero new parsing code, and the resolving-`source:line`
spine is satisfied for free. The recovered intent ("what it set out to do") has no ADR/lesson shape —
it is a SPEC — so it is a distinct artifact, not a record source.

**Decision.** An imported milestone materializes a **pair** of legible `.md` artifacts under the import
store (ADR-004), reusing existing aof doc shapes — there is **NO new `OUTPUT.md` doc type**:

- **`SPEC.md`** — the recovered intent: "what it set out to do," in the milestone-SPEC shape (Objective
  + Scope as recoverable from the source). It is the human-legible record of the import's *intent* half.
  It is NOT a record source for memory (a SPEC has no ADR/lesson structure to parse); it is the legible
  artifact a reader (and a later `work:doc`-style read) opens. **Absence is information** (the
  cross-cutting constraint): when the source has no recoverable intent, `SPEC.md` records that the
  intent was not recoverable — it never fabricates an Objective the source never stated.
- **A knowledge artifact reusing the 05 record conventions** — "what it delivered / decided / learned"
  is materialized as `ARCHITECTURE.md` (`## ADR-NNN` blocks → `adr` records, when the source had
  architecture decisions to recover) and/or `RETROSPECTIVE.md` (`## R<n>` entries → `lesson` records,
  when the source had outcomes/lessons to recover), using the EXACT heading + inline-field conventions
  `parseArchitecture`/`parseRetrospective` already read. This is the OUTPUT half — but it reuses the two
  doc shapes the indexer already parses, so it produces frozen `MemoryRecord`s with a resolving
  `source:line` and needs **no new parser** (the `05/ADR-007` localised-change bar is met by reusing,
  not adding). An aof-structured source's own `ARCHITECTURE.md`/`RETROSPECTIVE.md` are recovered as-is;
  an arbitrary source's recovered decisions/outcomes are written INTO these shapes.
- **It is a pair, not a single record**, because the two halves have different shapes and different
  consumers: the SPEC is legible intent (not indexed); the ADR/retro artifact is the indexed knowledge.
  Collapsing them into one record would either lose the intent or force the SPEC into a record shape it
  does not have.
- **Recovered facts trace to the materialized `.md`, which is the legible artifact — not to the source
  repo's line numbers.** A record's `source` resolves within the import store (the artifact the import
  wrote), which is the derived, re-derivable `.md`. The source REPO is read-only and is not the
  `source:line` target (its paths are not in this repo and would not resolve on `reindex`); the
  materialized artifact IS the rebuildable source the invariant requires.

**Locked contract this ADR satisfies (FROZEN by 05 — inherited, NOT re-opened):**

```js
// 05/ADR-005 MemoryRecord — the imported knowledge artifact produces EXACTLY this shape, via the
//   EXISTING parsers, because it reuses the ARCHITECTURE/RETROSPECTIVE heading conventions:
//   { recordType:"adr"|"lesson", id, item, itemSlug, title, area, stage, kind, owner, status,
//     summary, text, source:"<importStoreRelPath>:<1-based line>" }   // source MUST resolve
// 05/ADR-007 source set — UNCHANGED parser set (parseArchitecture, parseRetrospective); the import is a
//   PRODUCER of `.md` in those two shapes, not a new parser. SPEC.md is legible intent, never indexed.
```

**Alternatives considered.**
- *A single normalized record / a new `OUTPUT.md` doc type with a bespoke parser* — REJECTED: it adds a
  third parser and a third record shape for no gain over reusing the two the indexer already reads, and
  it would re-open the frozen source set instead of being the *localised additive change* `05/ADR-007`
  prescribes. Reusing the ADR/retro conventions indexes the import with zero new parsing code.
- *Hand-summarise the source into a curated free-prose `OUTPUT.md` and index the prose* — REJECTED: this
  is the **authoritative-second-copy** failure mode `05/ADR-001` names. Unattributed prose has no stable
  `path:line` record identity (the same objection `05/ADR-007` raises to indexing arbitrary `.md`). The
  recovered knowledge must land in the structured ADR/lesson shapes so each record traces to a heading
  line — the derived-index invariant is what keeps the import honest.
- *Index the source repo's files in place (source paths as `source:line`)* — REJECTED: the source repo
  is read-only (cross-cutting constraint) and external; its paths do not resolve on a `reindex` in THIS
  repo, breaking the invariant. The import must MATERIALIZE a local, re-derivable `.md` artifact and
  point `source` at that.

**Consequences.** The recovery story (recover → materialize) owns producing the SPEC + ADR/retro-shaped
`.md`; the indexing story owns only EXTENDING the existing scan to the import store (ADR-003), reusing
`parseArchitecture`/`parseRetrospective` UNTOUCHED. The artifact pair is human-legible and re-derivable.
A breaking record-shape change is impossible to introduce here — the import does not own the record
shape; it owns producing the two doc shapes the frozen parsers read.

**Invariant.** Every record an import contributes to memory is produced by the existing
`parseArchitecture`/`parseRetrospective` parsers over materialized `ARCHITECTURE.md`/`RETROSPECTIVE.md`-
shaped `.md`, carries the frozen `MemoryRecord` shape, and its `source:line` resolves to live text in
the import store; the recovered `SPEC.md` is legible intent and is never an index record source; the
import introduces no new record shape and no new parser. (Enforced by `acd-import-artifact-shape` and
the derived-index invariant `acd-import-derived-index` — ADR-005.)

## ADR-002: The command is `aof import milestone <repo> <selector>`, a registered command `import:milestone` in the frozen Command core; it is read-only on the source (the `git ls-remote` argv-spawn idiom, never a write/clone-into-source), with a `--dry-run` that recovers + previews but materializes nothing

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `STATE §Open-for-refine` Q2: the command's name + surface (`aof import …` vs `aof work
import …`; positional args; registry id). Two facts shape it. (1) The command registry is the frozen
spine both faces couple through (`08/ADR-002`, `src/command-core.mjs`): every work operation is a
Command `{id, input, run, cli}` invoked via `invoke(id, input, ctx)` with `ctx = {workspace}`; a new
command registers there (as `graph:build`, `work:doc`, `project:provision` do) and the CLI is a thin
`argv → invoke → render` face. (2) The unit of import is a **milestone** (`SPEC §Scope`: "the unit of
import is a milestone, not arbitrary content"), and import is **knowledge, not managed work** — so it is
conceptually a sibling of `graph` and `import`-as-a-verb, not a `work` subcommand that operates on the
managed stream. The ONLY existing external-fetch precedent (`src/planning-init.mjs`) reads a remote with
read-only `git ls-remote` via argv-`spawnSync` (no shell string), behind a `--dry-run` that
spawns/writes/networks nothing, with an injection seam (`resolveSha`/`AOF_PLANNING_*`) so tests run
offline — the house idiom for touching an external source safely.

**Decision.**
- **Surface:** `aof import milestone <repo> [selector]`. `<repo>` is a path or URL to the source repo;
  `[selector]` names which milestone to import (a folder ref for an aof-structured source, or a
  path/heuristic anchor for an arbitrary source). `import` is a **top-level command** (a sibling of
  `aof graph` / `aof work`), because the import produces *knowledge*, not a managed work item — placing
  it under `aof work` would wrongly imply it joins the managed stream. `milestone` is the import unit
  (`SPEC §Scope`), leaving room for no other unit in v0.
- **Registry:** one Command registered in `src/command-core.mjs` with id **`import:milestone`**, the
  frozen `{id, input, run, cli}` shape (`08/ADR-002`); the CLI dispatch (`aof import milestone …`) is a
  thin `argv → invoke("import:milestone", input, {workspace}) → render`/`--json` face, exactly as the
  graph verbs are.
- **Read-only on the source (cross-cutting constraint).** The source repo is NEVER mutated: the import
  READS it (a local path is read in place; a remote is fetched read-only via the `planning-init`
  `git`-argv-spawn idiom — `git ls-remote`/a read-only fetch into a throwaway/scratch dir, never a
  clone INTO the source, never a write back). No `git` write verb (commit/push/checkout-into-source) is
  ever constructed. An injection seam (a `--repo` local path / an injected fetch hook, mirroring
  `resolveInjectedSha`) keeps `@executable` tests offline; the live network fetch is `@manual`.
- **`--dry-run`** recovers + previews the artifacts it WOULD materialize (and the records they would
  yield) and writes/indexes/networks-for-remote nothing — the `planning-init` dry-run discipline.

**Locked contract this ADR touches (the registered command + the read-only seam):**

```js
// src/command-core.mjs — one new Command in the frozen registry (the single dispatch door, 08/ADR-002):
//   importMilestoneCommand = { id: "import:milestone", input: {…}, run: async (input, ctx) => result,
//                              cli: { argv, render, json } }   // ctx = { workspace }
// Source access is READ-ONLY: a local <repo> is read in place; a remote is fetched read-only via the
//   src/planning-init.mjs git-argv-spawn idiom (git ls-remote / read-only fetch, NO shell string, NO
//   write/clone-into-source). FORBIDDEN: any git write verb against <repo>; any mutation of <repo>.
```

**Alternatives considered.**
- *`aof work import …` (a `work` subcommand)* — REJECTED: `aof work` operates on the MANAGED stream
  (`find`/`doc`/`next`/`validate` all resolve managed items); import produces knowledge that is
  explicitly NOT a managed item (ADR-004, `SPEC §Out-of-scope`). Nesting it under `work` invites the
  category error this milestone exists to avoid.
- *A bespoke external-fetch path (clone the source, shell strings, or a new HTTP client)* — REJECTED:
  `src/planning-init.mjs` already proves the read-only `git`-argv-spawn idiom (no shell string, dry-run
  preview, offline injection seam). Reusing it inherits the read-only discipline and the offline-test
  seam for free; a second fetch mechanism would duplicate the network-boundary + injection machinery.
- *Free-form import unit (any path/document)* — REJECTED by `SPEC §Scope`: the unit is a milestone, not
  arbitrary content. The `milestone` sub-noun and the `<selector>` make the unit explicit and bound the
  recovery to one milestone's worth of source.

**Consequences.** The import command story owns the `import:milestone` registration + the CLI face + the
read-only source-access seam (reusing `planning-init`'s `git`-argv-spawn + injection seam). The
materialize + index halves are reached from `run` (ADR-001, ADR-003). The read-only boundary is
structurally pinned by a fitness function (`acd-import-read-only-source`), mirroring how `planning-init`
pins its network boundary.

## ADR-003: Imported knowledge feeds the EXISTING 05/10 memory backend by EXTENDING the indexer's scan to the import store — NO bespoke store; graphify is reached only through 09's registered commands

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `STATE §Open-for-refine` Q3: confirm the 05/10 memory seam is the indexing target, not a
new store. The real indexer (`src/memory/local-indexing.mjs`) builds ONE derived index at the fixed,
git-ignored path `.aof/aof.memory.index.json` (`05/ADR-005`), and `buildRecords(only, ctx)` produces its
records by scanning `listItems(ctx.workDir)` top-level milestone folders. The graphify backend
(`src/memory/graphify-backend.mjs`) reuses that exact `buildRecords` untouched and reaches graphify ONLY
through `invoke("graph:build")` (`10/ADR-001/002`). `05/ADR-007` already established the extension model:
*adding a source is a localised change — a new parser producing `MemoryRecord`s with a resolving
`source`, gated by the same derived-index fitness function* — and ADR-001 here makes the import a
producer of `.md` in the two shapes the EXISTING parsers read, so the only change the indexer needs is
to SCAN the import store in addition to the work stream.

**Decision.**
- **One index, extended scan.** Imported knowledge is indexed into the SAME derived store the local and
  graphify backends already own (`.aof/aof.memory.index.json` / `aof.memory.graphify.index.json`) — there
  is **NO bespoke import store**. The localised change `05/ADR-007` prescribes is realised as
  `buildRecords` (or a thin sibling it composes) ALSO scanning the import store (ADR-004) for the
  materialized `ARCHITECTURE.md`/`RETROSPECTIVE.md`-shaped `.md`, running the SAME
  `parseArchitecture`/`parseRetrospective` parsers UNTOUCHED, and emitting the same frozen
  `MemoryRecord`s. Imported `adr`/`lesson` records sit alongside the work-stream's, recallable through
  the same `aof work memory recall` verbs with no agent-prompt change.
- **The import produces `.md`; the indexer derives records — the import NEVER writes the JSON index
  directly.** This is the spine of the derived-index invariant (`05/ADR-001`): the import is a *producer
  of indexable `.md` source*; a separate `reindex` (the backend's existing `reindex`, now scanning the
  import store too) fully reconstructs the index from those `.md` files. The import command MAY trigger a
  `reindex` after materializing (so import reaches memory — the load-bearing "wire the seam into the
  loop" SPEC deliverable), but it does so by invoking the backend's `reindex`, never by hand-writing
  index JSON.
- **Reach graphify only through 09's registered commands (the 10 precedent).** When the active backend is
  `graphify`, the graph re-rank over the imported records is the graphify backend's existing job — it
  builds/reads the graph via `invoke("graph:build")` / `readGraph` (`10/ADR-001/002`). The import does
  NOT integrate with graphify itself; it only produces the `.md` and triggers a backend `reindex`. There
  is **no bespoke second graphify integration**.

**Locked contract this ADR satisfies (the indexer extension — no new store, no new index path):**

```js
// src/memory/local-indexing.mjs — buildRecords gains a SECOND scan root (the import store), running the
//   SAME parsers; the index PATH (.aof/aof.memory.index.json) and the MemoryRecord shape are UNCHANGED:
//   records = [ ...scan(workDir milestones), ...scan(importStore) ]   // parseArchitecture/parseRetrospective
// The import is a PRODUCER of .md; reindex (UNCHANGED contract) re-derives the index from it.
// FORBIDDEN: the import command writing aof.memory.index.json directly; a bespoke per-import index store;
//   the import importing src/graphify.mjs or spawning graphify (graphify is reached only by the backend,
//   via invoke("graph:…") — 10/ADR-002).
```

**Alternatives considered.**
- *A bespoke per-import knowledge store + a second recall path* — REJECTED by `SPEC §Dependencies` ("import
  feeds this backend rather than a bespoke side-channel") and `05/ADR-001`: a second store is a second
  source of truth that drifts and a second recall surface the agents would have to learn. Extending the
  one scan keeps imported precedent recallable through the unchanged verbs.
- *Have the import inject records straight into the JSON index* — REJECTED: it bypasses the derived-index
  invariant (`05/ADR-001/005`) — the index would hold facts no `reindex` could reconstruct from `.md`,
  the exact drift vector ACD defends against. The import materializes `.md`; the indexer derives.
- *Have the import integrate with graphify directly (build/read the graph itself)* — REJECTED by
  `10/ADR-002` ("no bespoke second integration"): graphify is reached only through the 09 registered
  commands, and only by the graphify backend. The import's responsibility ends at producing `.md` + a
  backend `reindex`.

**Consequences.** The indexing story owns ONLY extending `buildRecords`' scan to the import store +
running the existing parsers; it touches no parser internals, no record shape, no index path, no graphify
code. Imported records flow through `local` and `graphify` identically (graphify re-ranks them by
file relatedness via its existing path). The "import reaches memory" win is realised by the import
triggering the backend's `reindex` after materializing — closing the loop the SPEC names as load-bearing.

**Invariant.** Imported knowledge is indexed only by extending the existing indexer's scan to the import
store and running the existing parsers into the existing `.aof/aof.memory.*.index.json` store; the import
command never writes the index JSON directly, never creates a bespoke knowledge store, and never imports
`src/graphify.mjs` / spawns graphify (graphify is reached only by the backend via the 09 commands).
(Enforced by `acd-import-indexer-extends-scan` and `acd-import-no-graphify-spawn`.)

## ADR-004: Materialized imports live in a dedicated import store OUTSIDE `workDir` (under `.aof/`), so the work-item resolver (`listItems` / `find` / `next` / `validate`) never treats them as managed milestone/story/task — knowledge, never managed work

**Status:** Accepted
**Date:** 2026-06-22

**Context.** `STATE §Open-for-refine` Q4: where do materialized imported artifacts live — they must NOT
be picked up by `aof work find` as a managed/refinable work item, yet must be re-indexable `.md` source.
The work-item resolver is a SINGLE surface with a SINGLE rule: `listItems(workDir)`
(`src/work.mjs:57`) enumerates folders directly under `workDir` matching `ITEM_RE =
^(\d+)_(milestone|story|task|uat)_([a-z0-9-]+)$`, and EVERYTHING downstream — `findWork`
(`aof work find`), `listStream` (the board), `nextWork` (`aof work next` → continue/verify), and
`validateWork` — derives from `listItems`. So an artifact is a managed work item **iff** it is a
top-level `NN_type_slug` folder under `workDir`. The constraint resolves cleanly on this single rule:
materialize imports **outside `workDir`** (or, inside it, not as a top-level `NN_milestone_*` folder),
and `listItems` never sees them — they can never be `refine`/`continue`/`verify`-ed because the resolver
that feeds those flows does not enumerate them. But the indexer's `buildRecords` ALSO scans
`listItems(workDir)` — so the import store must be a location the EXTENDED indexer scan (ADR-003) reaches
while the work-item resolver does not.

**Decision.** Materialized imports live in a **dedicated import store rooted OUTSIDE `workDir`, under the
project's `.aof/`** (the home for derived/managed-by-aof artifacts; the same `.aof/` the memory index and
locks live in). The concrete layout (the exact subpath under `.aof/`, e.g. `.aof/imports/<source>/<milestone>/`)
is a story-00 wiring detail; the ARCHITECTURAL contract is:

- **It is NOT under `workDir`** — so `listItems(workDir)` never enumerates it, and therefore
  `findWork`/`listStream`/`nextWork`/`validateWork` never treat an import as a milestone/story/task/uat.
  An import is consequently never `refine`/`continue`/`verify`-able (knowledge, not managed work —
  `SPEC §Out-of-scope`). This is the structural guarantee, not a convention: the resolver's one rule
  (top-level `NN_type_slug` under `workDir`) is what excludes it.
- **It holds legible, re-derivable `.md`** — the `SPEC.md` + `ARCHITECTURE.md`/`RETROSPECTIVE.md`-shaped
  artifacts of ADR-001, the source of the records the EXTENDED indexer scan reaches (ADR-003). The
  records' `source:line` resolves WITHIN the import store (the materialized artifact), satisfying the
  derived-index invariant.
- **It is git-ignored** via the SAME self-contained nested-`.gitignore` idiom the derived artifacts use
  (`src/aof-gitignore.mjs` — never the repo-root `.gitignore`). An import is a **one-time snapshot**
  (`SPEC §Scope`): re-running re-imports fresh (the store for a given source/milestone is rebuilt), so a
  committed copy would be a stale authoritative second copy. The materialized `.md` is re-derivable
  knowledge, not a tracked deliverable — consistent with `05/ADR-005`'s git-ignore-the-derived discipline
  and `10/ADR-005`'s `graphify-out/` precedent.
- **The import folder names do NOT use `NN_type_slug`.** Even though it is outside `workDir`, the import
  store uses a naming that would not be mistaken for a work item, reinforcing the boundary at the tree
  level (self-documenting, as `graphify-out/`'s `.gitignore` is).

**Locked contract this ADR satisfies (where imports live — the resolver-exclusion boundary):**

```text
.aof/imports/…                 # import store: OUTSIDE workDir → invisible to listItems(workDir)
  └─ <source>/<milestone>/     # NOT an NN_type_slug folder; never a managed item
       SPEC.md                 # recovered intent (legible; NOT an index record source — ADR-001)
       ARCHITECTURE.md         # recovered decisions → adr records (existing parser — ADR-001/003)
       RETROSPECTIVE.md        # recovered outcomes  → lesson records (existing parser)
  └─ .gitignore                # self-contained nested ignore (src/aof-gitignore.mjs idiom) — derived
// INVARIANT: nothing the import writes is a top-level NN_type_slug folder under workDir, so
//   findWork/listStream/nextWork/validateWork (all via listItems(workDir)) never enumerate it.
```

**Alternatives considered.**
- *Materialize imports as `NN_milestone_<slug>` folders inside `workDir`* — REJECTED: `listItems` would
  enumerate them and `aof work find`/`next`/`validate` would treat them as managed, refinable milestones
  — the exact category error `SPEC §Out-of-scope` forbids. An imported milestone must never become work
  to drive.
- *Materialize them in `workDir` but with a non-`NN_type_slug` name* — REJECTED as less robust: it
  relies on the naming staying off the `ITEM_RE` pattern AND co-locates non-managed knowledge inside the
  managed stream, muddying what `workDir` means. Rooting the store under `.aof/` (the derived-artifact
  home) makes the boundary unambiguous and matches where the memory index already lives.
- *Commit the materialized imports (tracked knowledge)* — REJECTED: imports are a one-time SNAPSHOT
  re-run to refresh (`SPEC §Scope`); a tracked copy would drift and read as an authoritative artifact —
  the `05/ADR-001` second-copy failure mode. Git-ignored + re-derivable keeps it honest.

**Consequences.** The materialize story (story 01) writes only under the `.aof/` import store + ensures
it is git-ignored (reusing `src/aof-gitignore.mjs`); the indexing story (story 02) points the extended
scan at that store. The work-item resolver is UNTOUCHED — no change to `src/work.mjs`; the exclusion is
structural (the import is simply not where `listItems` looks). A fitness function
(`acd-import-not-a-work-item`) materializes a fixture import, runs `listItems`/`findWork`/`nextWork` over
the work stream, and asserts the import never appears as a resolvable item — pinning the boundary in CI.

## ADR-005: The derived-index invariant for the import — the materialized `.md` is the rebuildable source; recovery NEVER fabricates absent SPEC/stories/decisions (absence is information); a re-import is a clean one-time snapshot

**Status:** Accepted
**Date:** 2026-06-22

**Context.** This is the load-bearing carry-forward (`SPEC §Scope`, the cross-cutting constraints):
memory is a **derived index** — rebuildable from `.md`, holding no fact absent from it (`05/ADR-001/005`).
The import adds a new producer of that `.md`, so it must obey the same invariant from its end: the
materialized artifact is the rebuildable source, and the records the indexer derives from it must trace
to live text within it. Two import-specific honesty constraints attach here. (1) **Absence is
information** (`SPEC §Scope`): recovery recovers only what is PRESENT in the source and never fabricates a
SPEC/stories/tasks/decisions the source never had — a missing intent is recorded as missing, not
invented. (2) **One-time snapshot** (`SPEC §Scope`): a re-import re-materializes fresh (no incremental
merge, no live sync), so the import store for a given source/milestone is a clean rebuild — nothing
accretes that a fresh import would not reproduce.

**Decision.**
- **The materialized `.md` is the derived, rebuildable source.** Every record the import contributes
  traces to a resolving `source:line` within the import store's `.md` (ADR-001/004); a `reindex`
  reconstructs the index from those `.md` files (ADR-003); the import never persists a record fact that
  is absent from its materialized `.md`. The import store itself is git-ignored + re-derivable (ADR-004).
- **Recovery never fabricates.** When the source lacks a recoverable intent, decision set, or outcome,
  the corresponding artifact records the ABSENCE (e.g. an empty/"not recoverable" section) — it never
  emits a SPEC Objective, an ADR, or a lesson the source did not contain. The records that DO get indexed
  are only those grounded in recovered source content. (This is a recovery-behaviour scenario for the
  recovery story's `.feature`, AND a structural floor here: no record is produced that the materialized
  `.md` does not contain — the same `source:line`-resolves discipline that catches fabrication.)
- **A re-import is a clean snapshot.** Re-running `aof import milestone` for the same source/milestone
  re-materializes the import store fresh (replacing the prior snapshot), then re-indexes — there is no
  incremental sync or change-detection (`SPEC §Out-of-scope`); a second import yields the same artifact
  set as the first over an unchanged source, and nothing accretes across runs.

**Alternatives considered.**
- *Treat the source repo as the rebuildable source (point `source:line` at it)* — REJECTED (also by
  ADR-001): the source is external + read-only; its paths do not resolve on a local `reindex`, breaking
  the invariant. The materialized local `.md` is the rebuildable source.
- *Incremental / merge re-import (preserve prior import, layer changes)* — REJECTED by `SPEC §Out-of-scope`
  (one-time snapshot; live sync deferred): a merge would accrete state a fresh import could not reproduce
  and reintroduce drift. A clean re-materialize keeps the snapshot honest.
- *Allow recovery to "fill gaps" with inferred SPEC/decisions when the source is thin* — REJECTED by
  "absence is information" (`SPEC §Scope`): fabricated precedent is worse than no precedent — it grounds
  the agents in fiction. Recovery records what is present and marks what is absent.

**Invariant.** A fresh re-import + `reindex` reproduces the identical imported record set, every imported
record's `source:line` resolves to live text in the (git-ignored, re-derivable) import store, the index
holds no imported fact absent from that `.md`, and recovery emits no record not grounded in recovered
source content (no fabricated SPEC/decision/lesson). (Enforced by `acd-import-derived-index`, mirroring
`05/ADR-005`'s `acd-memory-derived-index`.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is correct now: the import command + store + indexer extension do not exist yet;
     the tests reference them and fail cleanly until the stories land. The 05 idioms
     (acd-memory-derived-index, acd-memory-index-location) and the planning-init network-boundary idiom
     are the house patterns these mirror. -->

| Invariant | Enforced by (arch-test `test/arch/acd-*.test.mjs`) | State now | From |
|---|---|---|---|
| **Reuse the 05 doc shapes; no new parser, no new record shape.** Every record an import contributes is produced by the EXISTING `parseArchitecture`/`parseRetrospective` over materialized `ARCHITECTURE.md`/`RETROSPECTIVE.md`-shaped `.md` and matches the frozen `MemoryRecord`; the recovered `SPEC.md` is legible intent, never an index record source. | `test/arch/acd-import-artifact-shape.test.mjs` (over a fixture materialized import: parse the artifacts with the EXISTING `parseArchitecture`/`parseRetrospective`, assert each record matches `MEMORY_RECORD_FIELDS` with absent-type fields present-as-`""`; assert the import module/indexer extension defines NO new parser and NO new record shape — source-grep + the `acd-memory-index-location` shape idiom; assert `SPEC.md` is not parsed into records) | RED until the materialize + indexer-extension code exist | ADR-001 |
| **Registered command + read-only source.** `import:milestone` is registered in the frozen Command core (`{id, input, run, cli}`) and dispatched via `invoke`; source access is read-only — a local repo read in place, a remote fetched via the `planning-init` `git`-argv-spawn idiom (no shell string), and NO git write verb / mutation is ever constructed against the source. | `test/arch/acd-import-read-only-source.test.mjs` (assert `getCommand("import:milestone")` returns the frozen-shape command with a `cli` adapter; source-grep the import module: no `git` write verb (`commit`/`push`/`checkout`/`clone <repo> <repo>`/write-into-source), no shell-string spawn; assert the only external-fetch form is the read-only `git ls-remote`/fetch argv idiom — the `acd-planning-install-commands`/network-boundary idiom applied to import) | RED until the `import:milestone` command exists | ADR-002 |
| **Index via the existing store + scan extension; never graphify directly.** Imported knowledge is indexed only by extending the existing indexer scan to the import store (existing parsers, existing `.aof/aof.memory.*.index.json` path); the import never writes the index JSON directly, creates no bespoke store, and imports no `src/graphify.mjs` / spawns no graphify. | `test/arch/acd-import-indexer-extends-scan.test.mjs` + `test/arch/acd-import-no-graphify-spawn.test.mjs` (assert the indexer extension reuses `buildRecords`/the existing parsers into the existing index path — no new index file written under `.aof/`; source-grep the import command + materialize module: no direct write of `aof.memory.index.json`, no `import "../graphify.mjs"`, no `node:child_process` spawn of graphify — the `acd-memory-index-location` + `10/acd-graphify-backend-via-command` idioms) | RED until the indexer extension + import command exist | ADR-003 |
| **An import is never a managed work item.** Nothing the import materializes is a top-level `NN_type_slug` folder under `workDir`; the import store lives outside `workDir` (under `.aof/`) and is git-ignored, so `listItems`/`findWork`/`listStream`/`nextWork`/`validateWork` never enumerate it as a milestone/story/task/uat. | `test/arch/acd-import-not-a-work-item.test.mjs` (materialize a fixture import into a temp project; run `listItems(workDir)` / `findWork` / `nextWork` over the work stream and assert the import NEVER appears as a resolvable item; assert the import store is OUTSIDE `workDir`, uses no `NN_type_slug` name, and is git-ignored via the nested-`.gitignore` baseline — never the repo-root `.gitignore`) | RED until the materialize store wiring exists | ADR-004 |
| **Derived-index invariant for imports (+ no fabrication, clean snapshot).** A fresh re-import + `reindex` reproduces the identical imported record set, every imported record's `source:line` resolves to live text in the git-ignored re-derivable import store, the index holds no imported fact absent from that `.md`, and no record is produced that the materialized `.md` does not contain (no fabricated SPEC/decision/lesson). | `test/arch/acd-import-derived-index.test.mjs` (materialize a fixture import; for each derived record split `source` into `path:line`, read the file in the import store, assert the line resolves; assert a second import over the same fixture source yields the identical artifact + record set; assert the import store is git-ignored — the `05/acd-memory-derived-index` idiom, extended to the import store as a new derived source) | RED until the materialize + indexer-extension code exist | ADR-001, ADR-005 |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors 05/10's split):
     - ARTIFACT-SHAPE, READ-ONLY-SOURCE, INDEXER-EXTENDS-SCAN/NO-GRAPHIFY-SPAWN, NOT-A-WORK-ITEM,
       DERIVED-INDEX are structural invariants over the import module / the indexer extension / the
       command registry / the work-item resolver / the import store → arch-tests (this table). They are
       the milestone's load-bearing deliverable (a fitness-only story — 04 — with no .feature of its own,
       mirroring 05/03 and 10/03).
     - The OBSERVABLE end-to-end behaviours — "importing an aof-structured milestone recovers its
       SPEC + ADRs and they become recall-able", "importing an arbitrary repo recovers what is present
       and marks what is absent", "a later refine/review surfaces the imported precedent through recall",
       "--dry-run previews and materializes/networks nothing" — belong in task .feature files authored by
       the recovery/materialize/index stories, gated @manual where they touch the live network fetch.
     - "absence is information" has BOTH a structural floor (no record absent from the .md — DERIVED-INDEX)
       AND a recovery-behaviour scenario (recovery records the absence, never fabricates) — the latter is
       the recovery story's @executable .feature over a thin fixture source, not a fitness function. -->

## Proposed Story Breakdown

<!-- ADVISORY — the PO finalises (lifts into the SPEC `## Stories` + STORY.md files). The partition
     minimises cross-story coupling: stories couple ONLY through the frozen 05/10 contracts + this
     milestone's ADRs, exactly as 05 split seam/indexing/retrieval/fitness and 10 split
     backend/reranking/posture/fitness. The spine is 00 (the command + the materialize CONTRACT it
     freezes); 01/02 fan out from that frozen artifact shape + store layout; 03 is recovery heuristics;
     04 is the fitness pass. -->

- **00 · import-command-and-materialize-contract (THE SPINE)** — *Outcome:* the registered
  `import:milestone` command (the frozen `{id, input, run, cli}` in `src/command-core.mjs`, the CLI
  `argv → invoke → render`/`--json` face, the `--dry-run`), the read-only source-access seam (the
  `planning-init` `git`-argv-spawn idiom + the offline injection seam), and the FROZEN materialize
  artifact shape + import-store layout (ADR-001's SPEC + ARCHITECTURE/RETROSPECTIVE-shaped `.md`;
  ADR-004's `.aof/` import store outside `workDir`, git-ignored via `src/aof-gitignore.mjs`). *Consumes
  from frozen contracts:* the Command core (`08/ADR-002`, `command-core.invoke`), the `MemoryRecord`
  doc-shape conventions (`05/ADR-005/007`), the read-only-fetch idiom (`src/planning-init.mjs`), the
  nested-`.gitignore` discipline (`src/aof-gitignore.mjs`). *Parallelizable because:* it FREEZES the two
  contracts every other story builds against — the materialized artifact shape (so recovery/indexing
  build against a fixed shape) and the import-store layout (so indexing/fitness know where to scan). It
  stubs recovery (story 03) behind a fixed materialize signature and is testable with a hand-authored
  fixture import. **This is the critical path.**

- **01 · recovery — source-shape tolerance** — *Outcome:* the recovery heuristics that turn a source
  repo (aof-structured OR arbitrary: README, docs, ADRs, commit history) into the materialize CONTRACT's
  artifact set — recovering what is PRESENT, marking what is absent (no fabrication, ADR-005). *Consumes
  from frozen contracts:* story 00's frozen materialize signature + artifact shape (ADR-001); the
  read-only source access (ADR-002); "absence is information" (ADR-005). *Parallelizable because:* it is
  a pure source→artifact-set transform behind story 00's frozen materialize signature — fixture-testable
  against a few example source repos (aof-shaped + arbitrary; the user offered to provide these at
  refine — collect them here) with NO command wiring and NO indexer. Couples to 00 only through the
  materialize-input shape.

- **02 · indexer extension — import store into memory** — *Outcome:* `buildRecords`' scan EXTENDED to the
  import store (ADR-003), running the EXISTING `parseArchitecture`/`parseRetrospective` UNTOUCHED into
  the EXISTING `.aof/aof.memory.*.index.json` store, and the import command triggering a backend
  `reindex` so import REACHES memory (the load-bearing "wire the seam into the loop" deliverable).
  *Consumes from frozen contracts:* the indexer (`05/ADR-005/007`, `buildRecords`), the backend
  `reindex` (`05/ADR-003`), story 00's frozen import-store layout (ADR-004). *Parallelizable because:* it
  is a localised additive change to the scan (the `05/ADR-007` model) testable against a fixture import
  store in the frozen layout — it touches no parser internals, no record shape, no graphify code, and
  needs neither the recovery heuristics (01) nor the live binary. Couples to 00 only through the store
  layout.

- **03 · graphify-path + fitness (OPTIONAL MERGE)** — could fold into 04; called out so the PO sees the
  graphify-backend interaction. *Outcome:* confirm imported records flow through the `graphify` backend
  unchanged (graphify re-ranks them by file relatedness via its EXISTING `invoke("graph:build")` path —
  no import-side graphify code, `10/ADR-002`), as a contract/fixture check. *Consumes:* the graphify
  backend's frozen path (`10/ADR-001/002`). *Parallelizable because:* it asserts only that the import
  side does NOT touch graphify and that imported `.md` indexes identically for both backends — a
  source-grep + fixture check needing no live binary. **The PO may merge this into story 04** (it is a
  fitness assertion, not new production code).

- **04 · import-fitness** — *Outcome:* the five arch-tests of the fitness table
  (`acd-import-artifact-shape`, `-read-only-source`, `-indexer-extends-scan` + `-no-graphify-spawn`,
  `-not-a-work-item`, `-derived-index`), mirroring 05/03 and 10/03 — a fitness-only story with **no
  `.feature` of its own**; its contract IS the fitness table above. *Consumes:* the FROZEN command (00),
  recovery (01), and indexer extension (02) surfaces; the 05/10 arch-test idioms. *Parallelizable
  because:* it authors only `test/arch/*` against the frozen ADRs, RED-until-built by design (it
  references the stories-00/01/02 surfaces and fails cleanly until they land).

**Critical path:** `00 (command + materialize contract + store layout)` → then `01 (recovery)` and
`02 (indexer extension)` fan out in PARALLEL from 00's two frozen contracts (artifact shape + store
layout), and `04 (fitness)` is authored in parallel against the frozen ADRs. `03` is a thin graphify-path
confirmation the PO may merge into `04`. Story 00 is the spine: nothing materializes, recovers, or
indexes until its artifact shape + store layout are frozen — exactly the 05 "00 is the seam; 01/02/03 fan
out from its frozen contract" / 10 "00 is the backend module; 01/02/03 fan out" pattern. The minimal
load-bearing slice (the SPEC's "import reaching memory") is `00 → 02` over an aof-structured source;
`01`'s arbitrary-source tolerance and `04`'s fitness layer onto that spine.
