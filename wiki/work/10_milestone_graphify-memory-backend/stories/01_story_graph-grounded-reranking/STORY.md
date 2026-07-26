---
type: story
number: 01
slug: graph-grounded-reranking
title: "Graph-grounded re-ranking — the work-stream graph re-orders the 05 records (the value)"
parent: 10
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-22
schema: 1
aofVersion: 0.1.0
---
# 01 · Graph-grounded re-ranking — what makes recall graph-grounded

## User story

As an ACD agent recalling a prior lesson while building the next milestone,
I want recall **re-ranked by the work-stream graph** — boosting records whose source file is graph-central or graph-related (community co-membership, `semantically_similar_to` / inferred edges, god-node centrality) to my query, layered on top of milestone 05's scoped, length-normalised base ranking (`05/ADR-006`),
so that "graph-grounded recall" earns its name — a better #1 hit than BM25-lite alone — while **every** returned record is still a frozen `MemoryRecord` (`05/ADR-005`) with a resolving `source:line` and the result is the frozen `RecallResult` (`05/ADR-004`), the graph contributing only to `score`.

<!-- This story is the VALUE the milestone's name promises. It owns the re-ranker math ONLY — a pure
     function; it owns no module wiring (story 00), no extraction posture / fallback (story 02), and no
     arch-tests (story 03). -->

## Tasks

<!-- Contract authored `2026-06-22` via Three Amigos (`aof:refine 10/01`): PO intent + aof-qa
     Examples/fixtures + feasibility (low-risk — the `rerank(records, normalizedGraph, query, scope)`
     stub + signature were frozen by story 00; this fills in the graph term). @executable, no binary. -->

- [x] **00 · [graph-reranks-by-file-relatedness](tasks/00_graph-reranks-by-file-relatedness.feature)** — the work-stream graph re-orders the 05 records by file relatedness (community co-membership / `semantically_similar_to`-inferred edges / god-node centrality), joined by `source_file`; re-rank-never-replace; only `score` changes; hard scope pre-filter preserved; file-level join; null-graph → base ranking. Deterministic fixtures under `tasks/fixtures/` (a 4-way base tie the graph flips). _@executable green (13)._

**Build + review (2026-06-22, `aof:continue 10/01`):** shared `src/graph-normalize.mjs` extracted (the pure `readGraph`/`normalizeGraph`/`graphJsonPath` from `src/graphify.mjs`, re-exported → 09 behaviour-preserved); `rerank` graph term implemented (3 ADR-001 channels, file-level join, bounded boost ≤ 0.3 on the 05 base, null-graph → base); `recall` wired to read the built graph via the shared module. **13 `@executable` green; full suite 1026 ok / 0 fail; 09 + 10/00 tests confirmed still green.** Review: **architect PASS** (all 6 checks — extraction byte-faithful, ADR-001 conformant, story-03 guard holds, privacy-boundary fitness preserved/widened). No `@manual`/`@uat` → verify = green lanes + validate. **Done.**

**Contract decision locked at the Three-Amigos pass (carry into the build):**
- **`recall` reads + normalizes `graph.json` via a shared pure module, NOT `src/graphify.mjs`.** The graph term needs a normalized `{nodes,edges,hyperedges}` (09/ADR-003), but the `acd-graphify-backend-via-command` guard forbids the backend importing `src/graphify.mjs` (where `readGraph`/`normalizeGraph` live). **Default decision:** extract those PURE helpers from `src/graphify.mjs` into a new shared `src/graph-normalize.mjs` (no spawn / no `child_process`); `src/graphify.mjs` re-imports them so milestone 09 is behaviour-preserved (its tests stay green); the graphify backend imports `src/graph-normalize.mjs`. This honours **both** ADR-002 ("read the on-disk graph via the pure helpers") **and** the story-03 guard ("backend never imports `graphify.mjs`/`child_process`"), and keeps the normalizer DRY (one `links`-not-`edges`/hyperedge-separate implementation). Mirrors 09's own pure-router/IO-shell split idiom. If extraction proves invasive to 09, fall back to a self-contained minimal normalizer and record it.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** — the graph re-ranks, never
replaces, the 05 records; the join is file-level by `source_file`, never graph-`id`-keyed). This story
**owns**: the pure re-ranker `recall` consumes — a function of `(records, normalizedGraph, query, scope)`
that joins `normalizeGraph`'s `{nodes, edges, hyperedges}` (`09/ADR-003`) to the candidate 05 records by
**`source_file`** and layers a graph-relatedness boost onto the 05 base `rankRecords`
([src/memory/local-retrieval.mjs](../../../../../src/memory/local-retrieval.mjs), `05/ADR-006`), returning
the frozen `RecallResult`. It adds **no field** to `MemoryRecord` and changes no field's meaning.

**Independent because** it is a **pure function** of its inputs — fixture-testable against a committed
`graph.json` + fixture records with **no live binary, no spawn, no config, no command core**. It couples to
story 00 only through ADR-001's re-ranker signature (which 00 stubs until this lands), and to story 02 not
at all. The graph's coarse (file-level) grain is an accepted limit (ADR-001): it re-weights *across* files;
the 05 base ranking already orders *within* a file.
