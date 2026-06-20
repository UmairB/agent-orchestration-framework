---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 05 · Work Memory — Architecture Decisions

> Research input: the pre-refine spike under `spike/` (`memory-spike.mjs`, run against the real
> milestones 00–04 stream) and its `spike/FINDINGS.md` (findings F1–F5 + open questions). ADRs cite
> these as `FINDINGS §N` / `Fn` the way prior milestones cite RESEARCH.

## ADR-001: `memory` is a backend selected by config; the local backend is a derived index, never a second source of truth

**Status:** Accepted
**Date:** 2026-06-19

**Context.** The milestone exists to give ACD agents recall of prior lessons so they improve over
time (SPEC Objective). The spike proved the loop works on the real stream with zero extra authoring
(`FINDINGS §1`): 21 records pulled straight from `RETROSPECTIVE.md` R-entries and `ARCHITECTURE.md`
ADRs. The load-bearing SPEC constraint is that memory is a **derived index** — rebuildable from the
work-stream `.md` files, never an authoritative second copy — because a second copy is exactly the
drift vector ACD exists to defend against (`FINDINGS §3`). aof already has a pluggable-seam idiom
(adapters by runtime, packages by source); memory should reuse it so a richer semantic backend
(MemPalace) plugs in later behind identical verbs with no agent-prompt change (SPEC Scope; `FINDINGS
§4`).

**Decision.** Memory is a named **backend** chosen by config (ADR-002), behind a frozen JS module
contract (ADR-003). Three backends are in scope: the **local** backend (the default cheap one this
milestone ships), and **`none`** (a graceful no-op so ACD runs unchanged when memory is absent). The
**local** backend's store is a **derived index** with two non-negotiable properties: (a) `reindex`
fully reconstructs it from the work-stream `.md` files every run — nothing accretes that a rebuild
would not reproduce; (b) every record carries a `source: path:line` back-reference and restates no
fact that is not present at that source (ADR-005, the derived-index invariant). The index is the
*only* persistent artifact memory owns, and it is disposable.

**Alternatives considered.**
- *A hand-curated lessons database authored alongside the work* — rejected: it becomes an
  authoritative second copy that drifts from the `.md` files it summarises; it violates ACD's
  single-source-of-truth principle and is the exact failure mode the SPEC names.
- *Index chat/transcript logs rather than the curated artifacts* — rejected: the corpus is
  deliberately *pre-curated* (RETROSPECTIVE R-entries, ADRs); `FINDINGS §1` showed the curated
  artifacts already carry clean, attributed fields. Transcripts are noisy and unattributed.
- *Bake the local retrieval logic into the agents/commands directly (no backend seam)* — rejected:
  then MemPalace could not replace it without rewriting prompts; the whole point of the milestone is
  to prove the seam earns its keep with a cheap backend first (SPEC Out-of-scope).

**Consequences.** The milestone partitions cleanly into a backend-agnostic seam plus a local backend
that itself splits into indexing and retrieval (see the partition). Memory can always be deleted and
rebuilt; CI can prove it holds no fact absent from source (ADR-005). The cost is that the local
backend's value compounds slowly while the corpus is ADR-heavy (`FINDINGS §3`, 17 ADRs vs 4
lessons) — acceptable, because the seam is the deliverable, not the corpus size.

**Invariant.** The local backend's store is reconstructible: a fresh `reindex` from the `.md` files
alone reproduces the index, and every record's `source` resolves to live text in the named file. No
backend persists a fact that is absent from its referenced source. (Enforced by
`acd-memory-derived-index` — see ADR-005.)

## ADR-002: Backend selection lives at config key `memory.backend`; `memory` is a top-level config object (a new `$defs/memory`)

**Status:** Accepted
**Date:** 2026-06-19

**Context.** The SPEC names a **top-level** `memory.backend` in `.aof/aof.config.json`. The schema
today (`schemas/aof.schema.json`) has top-level `name/resources/workflows/packages/frameworks/
settings/work`; the `work` def (line 349) has `additionalProperties: true` but **no** `memory` key.
So memory selection could be modelled either as a new top-level `memory` object or nested as
`work.memory`. Memory is conceptually scoped to the *work stream* (it indexes work-stream `.md`
files), which argues for `work.memory`; but the SPEC is explicit that the key is top-level, and a
top-level object reads as a first-class subsystem (peer to `settings`/`work`) that other surfaces
could one day target beyond the work stream.

**Decision.** Selection lives at **top-level `memory.backend`**, matching the SPEC verbatim. A new
`$defs/memory` is added to the schema and referenced from the root `properties` as `"memory": {
"$ref": "#/$defs/memory" }`. `memory` is **optional**; its absence is equivalent to `backend:
"none"` (ADR-001's graceful no-op). `backend` is an enum constrained to the registered backend names
(`"local" | "none"` in this milestone). The work *directory* memory indexes is **not** re-declared
under `memory` — it is read from the existing `work.dir` via `loadWorkspace` (DRY: one source for the
stream location).

**The locked shared contract — `memory` config block (frozen 2026-06-19):**

```jsonc
// .aof/aof.config.json  (top-level "memory" key; OPTIONAL — absent ≡ { "backend": "none" })
{
  "memory": {
    "backend": "local"          // enum: "local" | "none"  (more backends register later)
    // backend-specific options, if any, are namespaced under the backend's own key in a later
    // milestone (e.g. "mempalace": { ... }); v0 local + none take no options.
  }
}
```

**Alternatives considered.**
- *Nest under `work.memory`* — rejected: contradicts the SPEC's explicit top-level naming, and
  couples the memory schema change to the `work` def. Top-level keeps memory a first-class,
  independently-evolvable subsystem.
- *A free-form string (no enum)* — rejected: an unregistered backend name should fail validation,
  not fail at dispatch with an opaque error; the enum makes the registered set self-documenting and
  validatable.
- *Re-declare the indexed directory under `memory`* — rejected: a second source for the stream path
  that can drift from `work.dir`. Reuse `loadWorkspace`.

**Consequences.** Adding the local backend is the only schema change (`$defs/memory` + root ref +
enum). The seam reads `config.memory?.backend ?? "none"` once and dispatches; no other surface learns
the backend name. The enum must grow by one line when MemPalace registers (a later milestone), which
is a deliberate, reviewable touchpoint.

**Invariant.** `memory.backend` is the *only* config key that selects a backend, and it is read in
exactly one place (the seam's dispatch). No agent prompt, command, or other module branches on the
backend name. (Enforced by `acd-memory-backend-selection`.)

## ADR-003: The backend interface is a small JS module contract `{ recall, ingest, reindex, status }` — the locked shared contract for the seam ↔ backends

**Status:** Accepted
**Date:** 2026-06-19

**Context.** This seam is the reason the milestone exists: it is what lets a cheap local backend ship
now and a semantic backend (MemPalace) replace it later **behind identical verbs**, with no agent
prompt change (SPEC; `FINDINGS §4`). The spike settled the verb spine as `recall / reindex / status`
with `brief` and `ingest` as thin conveniences (`FINDINGS` verb shape). `FINDINGS §4` established
that for the local backend `ingest == reindex` (the derived store has no separate write path) — but
a semantic backend would override `ingest` to push records while keeping the same signature. The
*only* thing coupling the seam story to the backend stories is this interface; if we freeze it now,
they build in parallel against a frozen module contract and never touch each other's code (the
milestone-01 ADR-004 decoupling pattern).

**Decision.** A backend is a JS module exporting an object that satisfies the **backend interface**
below. The seam (`aof work memory <verb>`) resolves the configured backend (ADR-002), then delegates:
`recall`/`brief` call `backend.recall(...)`; `reindex`/`ingest` call `backend.reindex(...)`
(`brief` and `ingest` are conveniences the seam composes over `recall`/`reindex`, not new interface
methods); `status` calls `backend.status(...)`. The seam owns argv parsing, scope-flag extraction,
the config dispatch, and rendering the return; the **backend** owns the data. For the local backend
`ingest` is an alias of `reindex` (`FINDINGS §4`); the interface does not separate them.

**The locked shared contract — backend interface (frozen 2026-06-19):**

```js
// A memory backend module's default export. All methods are async.
// `ctx` is supplied by the seam: { workDir, projectRoot, configMemory } (configMemory = config.memory ?? {}).
export default {
  name: "local",                                   // string, === the registered backend id (ADR-002 enum)

  // READ. Returns a RecallResult (ADR-004 return contract) — structured records + a rendered text view.
  // scope: { area?, stage?, kind?, owner?, item? } (string filters, all optional — ADR-006 first-class).
  // opts:  { limit?: number }
  async recall(query /* string */, scope /* object */, opts /* object */, ctx) { /* → RecallResult */ },

  // WRITE / BUILD. Reconstructs the backend's store from source. For the local backend this fully
  // rebuilds the derived index (ADR-005); `ingest` is an alias of reindex (no separate write path).
  // only: a milestone ref (e.g. "01") to scope the rebuild, or null/undefined for the whole stream.
  async reindex(only /* string | null */, ctx) { /* → { recordCount, ... } */ },

  // INTROSPECT. Backend name + counts + store location; never throws on an absent store.
  async status(ctx) { /* → { backend, recordCount, ... } */ }
};
```

The `none` backend satisfies this interface as a no-op: `recall` returns an empty `RecallResult`,
`reindex` is a no-op returning `{ recordCount: 0 }`, `status` returns `{ backend: "none",
recordCount: 0 }`. No verb errors when memory is absent.

**Alternatives considered.**
- *Separate `ingest` and `reindex` interface methods* — rejected for v0: `FINDINGS §4` showed the
  local backend has no distinct write path, so two methods would be one method twice. The seam still
  exposes both *verbs* (ingest is the Accept-time convenience) — it just maps both to `reindex`. A
  backend that genuinely separates them can compose internally without changing the signature.
- *A class/inheritance contract* — rejected: aof's existing seams (adapters, packages) are plain
  data + functions, not classes; a duck-typed default-export object matches the codebase and is
  trivial to mock for the seam's tests.
- *Let each backend define its own verb set* — rejected: the verbs are the agent-facing surface and
  must be stable across backends, or swapping backends would change every prompt. The verb shape is
  frozen here precisely so it does not.

**Consequences.** The seam story can be built and tested against an in-memory stub backend; the local
backend stories can be built against this signature without the seam's argv code. Swapping in
MemPalace later is a new module satisfying this same export plus one enum line (ADR-002). The cost is
that `brief`/`ingest` are seam-level compositions, not interface methods — a deliberate choice to
keep the interface minimal (`recall`/`reindex`/`status`).

**Invariant.** Every registered backend module's default export provides exactly `{ name, recall,
reindex, status }` (functions), and the seam calls backends only through these; no seam code reaches
into a backend's internals or its index file directly. (Enforced by `acd-memory-backend-interface`.)

## ADR-004: `recall` returns a structured `RecallResult` (records + a rendered text view); JSON is the contract, text is a projection

**Status:** Accepted
**Date:** 2026-06-19

**Context.** Open question 1: does `recall` return human text or structured JSON for an agent to fold
into its prompt? The spike does both via `--json`. Agent-injection wiring (refine/continue/verify
hooks) is explicitly out of scope (SPEC Out-of-scope), but the **return contract must anticipate it**
— an agent will eventually consume `recall` programmatically, so the structured form must be the
load-bearing one and the human text a derived view, not the reverse.

**Decision.** `backend.recall(...)` returns a structured **`RecallResult`**: an array of scored
records (each a `MemoryRecord` per ADR-005, plus its `score`) and a pre-rendered human `text` view.
The CLI prints the `text` view by default and the raw `records` array under `--json`. JSON is the
**contract**; the text view is a projection of it (the agent path and the human path read the same
records). The record shape inside `RecallResult` is the frozen `MemoryRecord` of ADR-005 — recall
adds only `score`.

**The locked shared contract — `RecallResult` (frozen 2026-06-19):**

```jsonc
{
  "query": "content addressed hash cross platform",
  "scope": { "area": "architecture" },          // the filters that were applied (echoed back)
  "records": [
    {
      // ── a MemoryRecord (ADR-005), plus: ──
      "score": 27,                              // backend-assigned relevance (ADR-006); higher = better
      "recordType": "adr",                      // "lesson" | "adr"
      "id": "ADR-002",
      "item": "01", "itemSlug": "acd-asset-bundle",
      "title": "Bundle membership … content-addressed manifest",
      "area": "architecture", "stage": "", "kind": "", "owner": "",
      "text": "…", "summary": "…",
      "source": "01_milestone_acd-asset-bundle/ARCHITECTURE.md:66"
    }
  ],
  "text": "recall \"…\"  →  2 hit(s)\n  ▸ [ADR-002 · m01] …\n    ↳ …:66\n"  // rendered human view
}
```

**Alternatives considered.**
- *Return human text only (parse it later for agents)* — rejected: forces the agent path to scrape
  formatted text; the structured form is cheaper and stable. Make JSON primary.
- *Return records only; let every caller format* — rejected: the CLI human path and any future hook
  would each reinvent rendering; a single rendered `text` projection in the result keeps formatting
  in one place (the backend), consistent across callers.
- *Defer the return shape until the injection milestone* — rejected: leaving it unpinned would let
  the seam and the retrieval story diverge on the shape, and a later hook would force a breaking
  change. Anticipating injection now (per the open question) costs one field documented.

**Consequences.** The retrieval story builds against this exact shape over a fixture index (ADR-005)
with no seam code. A future injection hook reads `result.records` directly. The text view lives in
the backend, so all callers render identically. `--json` emits `records` (the contract), not the
text blob.

**Invariant.** `recall` returns `{ query, scope, records[], text }`; each record is a `MemoryRecord`
(ADR-005) plus a numeric `score`; `--json` output is the `records` array (structured), never the
rendered text. (Enforced by `acd-memory-recall-contract`.)

## ADR-005: A memory record is the frozen `MemoryRecord` shape; the derived index lives at `.aof/aof.memory.index.json`, git-ignored — the locked shared contract for indexing ↔ retrieval

**Status:** Accepted
**Date:** 2026-06-19

**Context.** The indexing story (parsers → records → store) and the retrieval story (recall/brief
over the store) couple *only* through the record shape and the index file format. If we freeze both
now, retrieval builds against a hand-authored **fixture index** with no code from the indexer —
exactly how milestone-02 story-01 ran against a PRD fixture. The spike proved the record shape on
real data (`FINDINGS §1`): a `lesson` (from RETROSPECTIVE R-entries: kind/area/stage/owner) and an
`adr` (from ARCHITECTURE ADRs: status/decision/invariant), each with a `source: path:line`
back-reference. `FINDINGS §4` fixed the index location: `.aof/aof.memory.index.json`, **derived and
git-ignored** — never in the work tree (the spike used a throwaway path to avoid polluting `.aof/`).
`.aof/` is currently tracked in this repo, so the index path must be added to `.gitignore` as part of
indexing — and the derived-index invariant is what keeps it from being committed as an authoritative
copy.

**Decision.** A memory record is the frozen **`MemoryRecord`** below; the local backend's derived
index is a JSON document at the fixed path **`.aof/aof.memory.index.json`** (relative to the project
root, the dir holding `.aof/`), in the frozen **index format** below. The path is **added to
`.gitignore`** by the indexing story (the index is derived; committing it would make it an
authoritative second copy, violating ADR-001). Every record's `source` is `"<work-relative
path>:<1-based line>"` and MUST resolve to live text in that file (ADR-001 invariant; the fitness
function below enforces it).

**The locked shared contract — `MemoryRecord` + index format (frozen 2026-06-19):**

```jsonc
// A single MemoryRecord. Fields absent for a given recordType are present as "" (never omitted),
// so retrieval can filter uniformly without undefined-guards.
{
  "recordType": "lesson",                 // "lesson" (RETROSPECTIVE R-entry) | "adr" (ARCHITECTURE ADR)
  "id": "R2",                             // "R<n>" for lessons, "ADR-NNN" for adrs (in-doc id)
  "item": "01",                           // milestone number the source belongs to
  "itemSlug": "acd-asset-bundle",
  "title": "Pin line endings …",
  "area": "architecture",                 // lessons: from the R-entry meta; adrs: always "architecture"
  "stage": "build",                       // lessons only; "" for adrs
  "kind": "near-miss",                    // lessons only; "" for adrs
  "owner": "developer",                   // lessons only; "" for adrs
  "status": "",                           // adrs only ("Accepted" | "Superseded …"); "" for lessons
  "summary": "the one-line gist",         // lesson text | adr decision/invariant — the short display line
  "text": "title \n what \n why \n lesson",  // the full searchable blob (what ranking scores over — ADR-006)
  "source": "01_milestone_acd-asset-bundle/ARCHITECTURE.md:66"  // "<workRelPath>:<1-based line>", MUST resolve
}

// The index document at .aof/aof.memory.index.json:
{
  "backend": "local",
  "version": 1,                           // index-format version (bump on a breaking record-shape change)
  "generatedAt": "<ISO-8601>",
  "workDir": "<absolute work.dir at build time>",
  "recordCount": 21,
  "records": [ /* MemoryRecord, … */ ]
}
```

**Alternatives considered.**
- *Store the index in the work tree (e.g. under the milestone folder)* — rejected: `FINDINGS §4`
  ruled this out; a tracked, in-tree index reads as an authoritative artifact and pollutes the
  stream. The derived store belongs in `.aof/`, git-ignored.
- *Omit absent fields per record-type* — rejected: forces every retrieval filter to undefined-guard;
  empty-string-present is uniform and lets `(r.area || "").includes(scope.area)` work for both types
  (the spike's filter shape).
- *Restate source text verbatim in the record without a `path:line`* — rejected: that is the
  authoritative-second-copy failure mode; the `source` back-reference + the derived-index invariant
  are what keep memory honest. `summary`/`text` are searchable projections, and the fitness function
  asserts they trace back to live source.

**Consequences.** Retrieval (ADR-006) reads only this format and is testable against a hand-authored
fixture index — fully independent of the indexer's parser code. The indexer owns producing this shape
and the `.gitignore` entry. A breaking shape change bumps `version`. The `source` discipline is the
spine of the derived-index invariant.

**Invariant.** (a) The local index is written only to `.aof/aof.memory.index.json` and that path is
git-ignored. (b) Every record matches the `MemoryRecord` shape, and on a fresh `reindex` every
record's `source` resolves to live text at-or-after the named line in the named file (memory holds no
fact absent from its source). (Enforced by `acd-memory-index-location` and `acd-memory-derived-index`.)

## ADR-006: Retrieval ranks with length-normalised scoring (BM25-lite) plus a record-type boost; scope filters are first-class and applied before ranking

**Status:** Accepted
**Date:** 2026-06-19

**Context.** `FINDINGS §1` headline: **ranking, not parsing, is the hard part**. The spike's naive
term-frequency scoring is noisy — a long ADR can outrank a more on-point one-line lesson purely
because it repeats query terms (ADR-005 out-scored R1 in spike scenario 1). On a *small, curated*
corpus the fix is cheap (`FINDINGS §1`): length-normalised / IDF (BM25-lite) scoring, and/or a
record-type boost so a "how should I do X" query prefers a `lesson` over an `adr`. `FINDINGS §2`:
scope filters (`--area`, `--kind`, `--stage`, `--owner`, `--item`) carry real weight and may be
enough for v0 — every record already has these fields, so scoped retrieval is high-precision without
embeddings. `FINDINGS §1` also names the signal for *when* a semantic backend earns its keep: the day
filter+keyword stops surfacing the right record at #1.

**Decision.** The local backend's `recall` (a) applies **scope filters first** — `area / stage / kind
/ owner / item` are first-class, intersected, and reduce the candidate set *before* scoring — then
(b) ranks the survivors by a **length-normalised term score (BM25-lite)**: term frequency damped and
normalised by record `text` length (so a long ADR does not win on raw repetition), plus IDF weighting
of query terms over the corpus, plus a small **title-match boost** and a **record-type boost** that
lifts `lesson` over `adr` for the same score (lessons are the distilled "we already learned this"
signal the Objective is about). Results are returned highest-score-first, truncated to `limit`
(default 5). Recall precision **under scope** is what the milestone tests (`FINDINGS §2`), not just
raw keyword recall.

**Why this is the seam's reason to exist.** The decision deliberately stops at BM25-lite + boosts.
The documented trigger for a semantic backend (MemPalace, a later milestone) is precisely: *the day
filter+keyword stops surfacing the right record at #1* (`FINDINGS §1`). Capturing the ceiling here is
what makes "the seam earns its keep" measurable — when local ranking demonstrably fails on a real
query under scope, that is the evidence the seam was built to honour.

**Alternatives considered.**
- *Keep naive term-frequency (the spike's `score`)* — rejected: `FINDINGS §1` showed it inverts the
  desired order (long ADR over on-point lesson). Length normalisation is the cheap, correct fix on a
  small corpus.
- *Jump straight to embeddings/vectors for v0* — rejected: that *is* the MemPalace backend, out of
  scope; the milestone's thesis is that the cheap backend suffices until it provably doesn't. Adding
  embeddings now would skip the very experiment the seam exists to run.
- *Treat scope as just another scoring signal (soft filter)* — rejected: `FINDINGS §2` showed scope
  is high-precision and should be a *hard* pre-filter; folding it into the score would let off-scope
  records leak into results. Filter first, then rank.

**Consequences.** Retrieval is a pure function of the frozen index format (ADR-005) and the scope/
query inputs — testable against a fixture index with assertions on *ranked order under scope*, not
just membership. The ranking choice is documented as a ceiling, so the later MemPalace milestone has
a concrete bar to clear. The cost is a small amount of corpus-statistics bookkeeping (IDF) computed
at recall time over the in-memory index — trivial at this corpus size.

**Invariant.** `recall` applies scope filters as a hard pre-filter before scoring (no off-scope
record appears in results), and scoring is length-normalised so raw term repetition in a longer
record cannot outrank a shorter, denser match of equal relevance. (Enforced by `acd-memory-ranking`.)

## ADR-007: The local backend's source set is RETROSPECTIVE R-entries + ARCHITECTURE ADRs; every source is referenced and rebuildable

**Status:** Accepted
**Date:** 2026-06-19

**Context.** `FINDINGS §3` / `§5`: the v0 proven source set is RETROSPECTIVE `R<n>` entries +
ARCHITECTURE `ADR-NNN` blocks (the spike indexed exactly these and produced 21 attributed records).
STATE's `## Feedback (for retro)` inbox and VERIFICATION findings are *candidate* additional sources
(`FINDINGS §5`) — but each new source must obey the derived-index invariant (ADR-001/005): it must be
a *referenced, rebuildable* source, every record tracing to a `path:line`. The corpus is ADR-heavy
early (`FINDINGS §3`: 17 ADRs vs 4 lessons), so the read path must weight both record types (handled
by ADR-006's type boost) and `brief` should make the lesson/ADR split visible (the spike's `brief`
does).

**Decision.** The local backend indexes exactly **two source kinds in v0**: `RETROSPECTIVE.md`
R-entries → `lesson` records, and `ARCHITECTURE.md` ADR blocks → `adr` records, across every
milestone folder in the work stream. STATE feedback and VERIFICATION findings are **explicitly
deferred** — not because they violate anything, but because v0 ships the proven set; adding a source
is a localised change (a new parser producing `MemoryRecord`s with a resolving `source`) gated by the
same derived-index fitness function. `brief` surfaces the `lesson`/`adr` split (counts + recent
lessons by area) so the corpus shape is visible. Each parser emits the frozen `MemoryRecord`
(ADR-005); none restates source text it cannot trace to a `path:line`.

**Alternatives considered.**
- *Index STATE feedback + VERIFICATION findings now* — rejected for v0: not yet proven on real data,
  and the milestone's job is to prove the seam with the cheap, known-good source set. Deferring keeps
  the indexing story small and the invariant easy to satisfy.
- *Index arbitrary `.md` prose across the stream* — rejected: unattributed prose has no stable
  `path:line` record identity and dilutes precision; the curated R-entry/ADR structure is what makes
  parsing clean (`FINDINGS §1`).

**Consequences.** The indexing story has a closed, testable source set (two parsers). Future sources
are additive and individually gated by the derived-index invariant, so the source set can grow
without re-litigating the architecture. `brief` keeps the ADR-heavy-early reality (`FINDINGS §3`)
honest to the reader.

**Invariant.** The local backend produces records only from declared source kinds (v0:
RETROSPECTIVE R-entries, ARCHITECTURE ADRs), and every produced record's `source` resolves to live
text — covered by the derived-index invariant (ADR-005), so a new source that smuggles in an
untraceable fact fails CI. (Enforced by `acd-memory-derived-index`; no separate test.)

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature. -->

| Invariant | Enforced by (arch-test) | From |
|---|---|---|
| A fresh `reindex` from the `.md` files reproduces the index, and **every** record's `source` (`path:line`) resolves to live text at/after the recorded line in the named file — memory holds no fact absent from its source | `test/arch/acd-memory-derived-index.test.mjs` (build the local index into a temp store from a small real/fixture stream; for each record split `source` into `path:line`, read that file, assert the line exists and the record's `summary`/`title` traces to text at/after that line; assert a second `reindex` yields the identical record set) | ADR-001, ADR-005, ADR-007 |
| `memory.backend` is the only key that selects a backend, read in exactly one place; no agent/command/module branches on the backend name | `test/arch/acd-memory-backend-selection.test.mjs` (grep the memory-seam source: it reads `config.memory?.backend` once; grep the bundle command/agent bodies and other `src/*.mjs` for the backend-name literals `"local"`/`"mempalace"` as dispatch branches → none outside the seam's registry; validate a `{ memory: { backend: "local" } }` config against the schema and assert an unknown backend name fails the enum) | ADR-002 |
| Every registered backend module's default export provides exactly `{ name, recall, reindex, status }` (all functions); the seam calls backends only through these and never reads a backend's index file directly | `test/arch/acd-memory-backend-interface.test.mjs` (import the `local` and `none` backend modules; assert the default export has the four keys with the right types; grep the seam source → it never reads `aof.memory.index.json` directly, only the backend does; assert `none` is a total no-op that throws on no verb) | ADR-003 |
| `recall` returns `{ query, scope, records[], text }`; each record is a `MemoryRecord` plus a numeric `score`; `--json` emits the structured `records`, never the rendered text blob | `test/arch/acd-memory-recall-contract.test.mjs` (run `recall` over a fixture index; assert the result has the four keys, each record carries `score` + the frozen `MemoryRecord` fields, and the `--json` CLI path prints the records array (parses as JSON, contains `source`) not the human `text` view) | ADR-004 |
| The local index is written only to `.aof/aof.memory.index.json`, that path is git-ignored, and every record matches the frozen `MemoryRecord` shape | `test/arch/acd-memory-index-location.test.mjs` (reindex into a temp project; assert the only file written under `.aof/` for memory is `aof.memory.index.json`; assert the repo `.gitignore` ignores it; validate each record against the frozen shape — required keys present, absent-type fields present as `""`) | ADR-005 |
| Scope filters are a hard pre-filter applied before scoring (no off-scope record in results), and scoring is length-normalised so raw term repetition in a longer record cannot outrank a shorter denser match | `test/arch/acd-memory-ranking.test.mjs` (over a hand-authored fixture index with one long term-heavy `adr` and one short on-point `lesson`: assert a scoped recall returns zero off-scope records; assert the on-point lesson ranks at or above the longer adr for an equivalent-relevance query — the spike's documented inversion does not recur) | ADR-006 |

<!-- Note: ADR-002's "read in one place" and ADR-003's "seam never reads the index directly" are
     grep-style source asserts on the *seam* module; ADR-005/006 are behavioural over a fixture index
     so they need no indexer code. This is what lets the three stories build in parallel. -->
