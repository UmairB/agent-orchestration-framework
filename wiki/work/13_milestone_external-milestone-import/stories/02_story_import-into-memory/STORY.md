---
type: story
number: 02
slug: import-into-memory
title: "Import reaches memory — extend the indexer scan to the import store; imported precedent is recall-able (the load-bearing win)"
parent: 13
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
---
# 02 · Import reaches memory — the load-bearing deliverable

## User story

As the ACD agents who ground planning / refine / review through `aof work memory recall`,
I want the import's materialized artifacts indexed into the **existing** 05/10 memory store — by EXTENDING `buildRecords`' scan to the import store and running the EXISTING parsers, then having the import trigger a backend `reindex` so import **reaches** memory — with no bespoke store and no direct index-JSON write,
so that imported precedent is recall-able through the **unchanged** `aof work memory` verbs (the SPEC's "a capability nothing invokes grounds nothing" win) — a later refine/review surfaces a real prior milestone, not a parsed file sitting inert on disk.

<!-- This is the load-bearing "wire the seam into the loop" deliverable (the 05/11 precedent: import
     reaching memory is the win, not mere parsing). It owns ONLY the localised additive scan-extension
     (the 05/ADR-007 model) + the import→reindex trigger. It owns NO recovery (story 01), NO new store
     / record shape / parser / graphify code (forbidden by ADR-003), NO arch-tests (story 03). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 13 --autonomous`): PO headline Scenarios +
     aof-qa Examples tables/tagging + aof-developer feasibility. @executable runs against a fixture
     import store in the frozen layout (no binary); the graphify-backend recall of imported records
     is @manual (needs the live binary). -->

- [x] `tasks/00_indexer-scans-import-store.feature` — `reindex` scans the import store in addition to the work stream, runs the EXISTING `parseArchitecture`/`parseRetrospective` UNTOUCHED, and the imported `adr`/`lesson` records land in the existing index as frozen `MemoryRecord`s whose `source:line` resolves within the import store. (all @executable scenarios green)
- [x] `tasks/01_imported-precedent-is-recallable.feature` — after import + reindex, `aof work memory recall` surfaces the imported milestone's precedent alongside work-stream records through the unchanged verbs (the load-bearing outcome). (all @executable scenarios green)
- [x] `tasks/02_import-triggers-reindex.feature` — running `aof import milestone` triggers the backend `reindex` (so import reaches memory with no manual reindex), and the import path never writes the index JSON directly. (all @executable rows green; the `@manual` graphify-backend recall row is DEFERRED — it needs the live graphify binary, which cannot run in CI)

**Three-Amigos pass (`2026-06-22`, `aof:refine 13 --autonomous`):** PO headline Scenarios + aof-qa Examples
tables/tagging + aof-developer feasibility. **Developer verdict: BUILDABLE-WITH-NOTE** — `buildRecords`
takes a second scan root cleanly; the index path, frozen `MemoryRecord` shape, and `reindex` contract are
all untouched. **Build-time decisions to carry into `aof:continue 13/02` (all inside the frozen 05
shapes):**
- **Imported-record `item` identifier** — stamp a stable, NON-numeric, namespaced ref (recommend
  `import:<source>/<milestone>`), reproducible across a clean re-import. It satisfies the frozen
  `MemoryRecord` (a string field), renders in `renderRecallBlock`'s `(m<item>)`, and never collides with a
  work-stream `--item NN` (exact string match in `applyScope`, no numeric coercion) — so `--item 01`
  EXCLUDES imports while `--area architecture` (a content filter) INCLUDES imported `adr` records.
- **Per-leg `source` base** — work-stream leg keeps `toWorkRel(workDir, …)` UNCHANGED; the import leg
  makes `source` relative to the import-store root, and the derived-index + recall resolvers are made
  leg-aware (resolve import records against the import root). No parser-internal change — the base is
  already injected via `{ workRelPath }`.
- **Scan seam** — compose `scan(importStore)` records onto `buildRecords`' work-stream records (the
  `05/ADR-007` localised additive model); scope prefilter flows through identically once `item` is set.
- **Fixture nit** — the `--item 01` exclusion fixture must include a REAL work-stream `01` so the
  exclusion is a positive exclusion, not a vacuous pass.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** one index, extended scan —
no bespoke store, no direct index-JSON write, graphify reached only by the backend via the 09 commands;
**ADR-001** the records come from the EXISTING parsers over the materialized `.md`; **ADR-005** the
derived-index invariant). This story **owns** extending `buildRecords`' scan
([src/memory/local-indexing.mjs](../../../../../src/memory/local-indexing.mjs)) to the story-00
import-store layout, running the existing parsers into the existing `.aof/aof.memory.*.index.json` store,
and the import command's `reindex` trigger (invoking the backend's `reindex`, never hand-writing the
index). It **calls** the existing parsers + the existing backend `reindex` unchanged; it touches no parser
internals, no record shape, no index path, no graphify code.

**Independent because** it is a localised additive change to the scan (the `05/ADR-007` model), testable
against a **fixture import store** in story 00's frozen layout — it needs neither the recovery heuristics
(01) nor the live binary. It couples to 00 only through the import-store layout and to the milestone only
through the frozen 05 indexer/`reindex` contract (`05/ADR-005/007`, `05/ADR-003`). The minimal
load-bearing slice of the whole milestone is `00 → 02` over an aof-structured source.
