---
type: story
number: 00
slug: graphify-backend-module
title: "The graphify memory backend module — the frozen 05 interface + reindex via graph:build (the spine)"
parent: 10
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-22
schema: 1
aofVersion: 0.1.0
---
# 00 · The graphify memory backend module — the frozen interface + the graph-build integration (the spine)

## User story

As the memory subsystem milestone 05 deliberately left a backend slot open in,
I want a **graphify memory backend** that satisfies the frozen `{ name, recall, reindex, status }` interface (`05/ADR-003`) — producing its records from the milestone-05 markdown parsers (so every record stays a frozen `MemoryRecord` with a resolving `source:line`) and (re)building a work-stream graph through milestone 09's `graph:build` command **via `invoke(...)` — never spawning graphify itself** — registered in `BACKEND_REGISTRY` behind a new `memory.backend = graphify` enum value,
so that `aof work memory` answers through graphify behind the **unchanged** verb surface, and the `graph:build` integration + the records-from-05-parsers contract are **frozen** for the sibling stories (01 re-ranking, 02 posture/fallback, 03 fitness) to fan out from.

<!-- This is the SPINE the milestone exists to make safe: it freezes the backend module shape, the
     records-source (05 parsers, ADR-001), and the seam-bridge + reindex-via-graph:build integration
     (ADR-002) the three sibling stories couple through. It owns no re-ranking math (story 01), no
     extraction-posture/classification/fallback wiring (story 02), and no arch-tests (story 03). -->

## Tasks

<!-- Contract authored `2026-06-22` via Three Amigos (`aof:refine 10/00`): PO headline Scenarios +
     aof-qa Examples tables/tagging + aof-developer feasibility (verdict: BUILDABLE-WITH-NOTE — no
     blocker). Each task is one `.feature` under tasks/; done when its @executable feature is green
     (the live graph-build row is @manual — needs the binary + a logged-in extraction backend). -->

- [x] **00 · [backend-registered-and-selectable](tasks/00_backend-registered-and-selectable.feature)** — `memory.backend = graphify` is schema-valid + selectable, `status` reports it, the default export is the frozen `{name,recall,reindex,status}`, an unregistered name still fails the enum. _@executable green (11 rows)._
- [x] **01 · [reindex-rebuilds-records-and-graph](tasks/01_reindex-rebuilds-records-and-graph.feature)** — reindex rebuilds the 05 records (REUSING the parsers; same frozen `MemoryRecord`s as local; `--item` scopes; ingest aliases; no growth) _@executable green (5)_, and builds a real work-stream `graphify-out/graph.json` via `invoke("graph:build")` _@manual — pending live run at verify (work-stream egress)._
- [x] **02 · [recall-returns-frozen-records](tasks/02_recall-returns-frozen-records.feature)** — recall returns the frozen `RecallResult {query,scope,records[],text}`, each record a `MemoryRecord` + numeric `score` with a resolving `source:line`; scope pre-filters before ranking; `--json` emits the records array. _@executable green (6) (graph re-rank ORDER is story 01)._

**Build + review (2026-06-22, `aof:continue 10/00`):** `src/memory/graphify-backend.mjs` implemented (reuses the 05 pure parsers/ranking; own store `.aof/aof.memory.graphify.index.json`; reaches graphify only via `invoke("graph:build")`, never imports `src/graphify.mjs`; reindex fails soft on binary-absent; re-ranker stubbed with the ADR-001 signature). Enum + `BACKEND_REGISTRY` + `ensureGraphifyOutGitignore` wired. **22 `@executable` scenarios green; full suite 1013 ok / 0 fail.** Review: **architect PASS** (conforms to all 6 ADRs + the 4 story-00 fitness invariants); **QA PASS-WITH-FINDINGS** (tests verified genuinely honest) — F-1 (source traces to live text, not just in-range) and F-2 (`--area` negative-exclusion symmetry) applied; F-3/F-4 info, F-4 deferred to story 02's degrade lane. **Remaining for `done`:** the `@manual` live work-stream graph build at `aof:verify 10/00` (a real `claude-cli` egress of `wiki/work/**`).

**Contract refinements locked at the Three-Amigos pass (carry into the build):**
- **`recall` reads the built graph WITHOUT importing `src/graphify.mjs`.** The `acd-graphify-backend-via-command` fitness guard (story 03) forbids importing the driver — so `recall` takes the graph path from the `graph:build` `BuildResult.graphPath` (or derives `<projectRoot>/graphify-out/graph.json` itself) and reads it; it does NOT import `graphJsonPath`/`readGraph`/`normalizeGraph` from `src/graphify.mjs`. (Resolves the architect's flagged ADR-002 nuance — the **`BuildResult` path** is chosen.)
- **Own store path.** `memoryIndexPath` hardcodes `.aof/aof.memory.index.json` with `backend:"local"` baked in — so the graphify backend writes its **own** record store (reusing the pure `buildRecords`/`rankRecords`, NOT 05's `reindex` writer); zero edits to 05's shipped code.
- **git-ignore `graphify-out/`.** It sits at `projectRoot`, outside `.aof/`; story 00 extends the ignore (the `.aof/.gitignore` baseline doesn't cover it for a consuming project) — ADR-005.
- **Enum/registry ownership.** Story 00 owns the `$defs/memory` enum line + the `BACKEND_REGISTRY` loader (its task-00 selection scenarios depend on them). ADR-003's Consequences line attributing the enum to story 02 is a minor slip — the enum/registry land here; story 02 owns only the `claude-cli` classification + posture.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** records-from-05-parsers /
graph-as-signal, **ADR-002** reach-graphify-only-via-`invoke("graph:…")` + the `{workspace}` seam-bridge,
**ADR-003** the `$defs/memory` enum + `BACKEND_REGISTRY` registration, **ADR-005** the derived-index +
git-ignored `graphify-out/`, **ADR-006** work-stream-only scope). This story **owns**: the new
`src/memory/graphify-backend.mjs` module (default export `{ name, recall, reindex, status }`); the
`graphify` line in `$defs/memory.backend` ([schemas/aof.schema.json](../../../../../schemas/aof.schema.json))
and in `BACKEND_REGISTRY` ([src/work-memory.mjs](../../../../../src/work-memory.mjs)); `reindex`
rebuilding the 05 records (REUSING `buildRecords`/`parseRetrospective`/`parseArchitecture` from
[src/memory/local-indexing.mjs](../../../../../src/memory/local-indexing.mjs)) **and** (re)building the
graph via `invoke("graph:build", { path: workDir, backend }, { workspace })` over the work stream
(ADR-002/006); the **seam-bridge** that constructs the `{workspace}` ctx from the memory
`ctx = {workDir, projectRoot, configMemory}`; and the git-ignored `graphify-out/` discipline (ADR-005). It
**calls** the existing 05 parsers and the 09 `graph:build` command unchanged — it does **not** rewrite
them, does **not** import `src/graphify.mjs` or `node:child_process`, and spawns nothing.

**Independent because** it consumes only the already-frozen 05 interface (`05/ADR-003`) and the frozen 09
`graph:build` command (`09/ADR-001/002`), and produces the ONE frozen contract the siblings consume: the
module surface + ADR-001's pure re-ranker signature `(records, normalizedGraph, query, scope) → ranked
records` (which it can **stub** while story 01 builds the real re-ranker) and the `invoke("graph:build")`
integration 02's fallback asserts against. It is the spine they fan out from and consumes none of their
internals.

> **Open refinement (architect note, carry into the Contract pass):** ADR-002 reads the built graph via
> the driver's PURE helpers (`readGraph`/`normalizeGraph`/`graphJsonPath`) — not a spawn, exactly what
> `09/ADR-001` permits. If the Contract prefers the backend to obtain the normalized graph from the
> `graph:build` `BuildResult` rather than re-reading via the driver helpers, that tightens the
> no-second-integration boundary further — a story-00 refinement that changes **no ADR**.
