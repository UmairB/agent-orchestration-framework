---
type: story
number: 04
slug: import-digest
title: "Intent-only imports gain a recallable AOF.md digest — the deferred 13×14 follow-up"
parent: 13
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
schema: 1
aofVersion: 0.1.0
---
# 04 · Intent-only imports gain a recallable AOF.md digest

## User story

As the ACD agents who ground planning / refine / review through `aof work memory recall`,
I want an imported milestone that recovered only **intent** (a `## Goal`/`## Scope`, with no `ARCHITECTURE.md`/`RETROSPECTIVE.md` to recover) to ALSO materialize an `AOF.md` **digest** — each `## ` section indexed by the EXISTING `parseAof` as one `summary` record — so that a zero-record import gains a recallable presence,
so that importing a real, spec-only repo (the voice-vox pay-guard testbed) surfaces its intent in recall instead of contributing **nothing** — closing the gap milestone 14 named and explicitly deferred ("having the import materialize writer also emit an `AOF.md` … a deferred follow-up").

<!-- This is the deferred 13×14 follow-up, re-opening milestone 13 to take it. It owns ONLY the
     conditional AOF.md emission in the materialize writer (story 00's seam) + the one-line scan
     extension in the indexer (story 02's seam). It introduces NO new parser and NO new record shape
     (it reuses milestone-14's parseAof + the `summary` recordType — ADR-006), NO new store / index path
     / graphify code (ADR-003/004 unchanged), and emits the digest ONLY for the zero-record case so an
     ADR/retro import's artifact set is untouched (ADR-001 frozen for that case). -->

## Tasks

<!-- @executable runs OFFLINE against a fixture import store materialized via materializeImport with a
     FIXED `recovered` (no recovery engine, no binary). The structural invariant is the story-03-style
     arch-test `acd-import-digest-recallable`, NOT a scenario here. -->

- [x] `tasks/00_import-emits-recallable-digest.feature` — an intent-only import (no decisions/outcomes) materializes an `AOF.md` digest with one `## ` section per recovered intent half; `reindex` indexes each as a frozen `summary` record resolving within the import store; the imported intent becomes recall-able; an import that recovered ADR/retro records emits NO digest; an unrecoverable intent fabricates none; a re-import is byte-identical. (all @executable scenarios green — `test/import-digest.test.mjs`)

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) **ADR-006** (the digest-on-import decision:
emit `AOF.md` ONLY for the intent-only zero-record case; reuse milestone-14's `parseAof` + `summary` record
shape — no new parser/shape; extend `scanImportStore` by one existing parser), which itself rests on
**ADR-001** (the import is a PRODUCER of `.md` the existing parsers read; SPEC.md stays legible-but-unindexed),
**ADR-003** (one index, extended scan — no bespoke store/direct write), and **ADR-005** (absence is
information — no fabricated section).

This story **owns** the conditional digest emission in
[src/import/materialize.mjs](../../../../../src/import/materialize.mjs) (`renderDigest` + the zero-record
predicate `emitsDigest`) and the one-line digest read in `scanImportStore`
([src/memory/local-indexing.mjs](../../../../../src/memory/local-indexing.mjs)). It **calls** the existing
`parseAof` unchanged; it touches no parser internals, no record shape, no index path, no graphify code.

**Independent because** it is a localised additive change (the `05/ADR-007` model) behind story 00's frozen
materialize signature + story 02's frozen scan, testable against a fixture import store with no recovery
engine and no binary. It couples to 00 (the materialize writer) and 02 (the scan) through their existing
seams only, and to milestone 14 through the `parseAof`/`summary` contract it reuses verbatim.
