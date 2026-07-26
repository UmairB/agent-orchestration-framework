---
type: story
number: 00
slug: memory-seam
title: "Memory seam — aof work memory verbs + backend selection"
parent: 05
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-19
schema: 1
aofVersion: 0.1.0
---
# 00 · Memory seam — `aof work memory` verbs + backend selection

## User story

As an ACD agent (or command) standing at a decision point,
I want a stable `aof work memory` verb surface (recall / brief / ingest / reindex / status) that dispatches to whichever backend the project selected in config — with `none` as a graceful no-op,
so that I recall prior lessons and ingest new ones through one unchanging interface, and a richer backend can replace the cheap one later without changing a single agent prompt.

<!-- This story is the seam the whole milestone exists to prove: it makes the verbs and the
     backend-selection mechanism real, independent of which backend answers. The objective ("agents
     improve over time") is delivered through this surface; the indexing/retrieval stories supply the
     answers behind it. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 05/00`, Contract stage). Each task is one
     `.feature` under tasks/; done when its @executable feature is green. -->

- [x] 00_verb-dispatch — the five verbs route through the frozen interface (recall→recall, brief→recall composed, reindex→reindex, ingest→reindex alias, status→status); unknown/missing verb prints usage and exits non-zero
- [x] 01_backend-selection-and-schema — `config.memory?.backend` selects the answering backend; absent `memory` ≡ `none`; `$defs/memory` makes `{backend:"local"}` valid and rejects an unknown backend name by enum
- [x] 02_none-backend-noop — with `none` (or memory absent) every verb succeeds as a graceful no-op: recall→empty `RecallResult`, reindex/ingest→`{recordCount:0}`, status→`{backend:"none",recordCount:0}`
- [x] 03_argv-scope-and-json-rendering — scope/option flags parse into the `scope`/`opts` objects handed to the backend; text view by default, structured `records` array under `--json`

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: the
`aof work memory <verb>` CLI dispatch (extends `workCommand` in
[src/cli.mjs](../../../../../src/cli.mjs)), argv + scope-flag parsing (`--area --stage --kind --owner
--item --limit --json`), `config.memory?.backend` resolution (read **once**, ADR-002), the backend
registry, the **`none`** no-op backend, the `--json`-vs-text rendering of `RecallResult`, and the
`$defs/memory` schema change + root `$ref` in [schemas/aof.schema.json](../../../../../schemas/aof.schema.json).

**Independent because** it calls backends only through the **frozen backend interface** (ADR-003) and
renders the **frozen `RecallResult`** (ADR-004) — so it builds and tests against an in-memory **stub
backend**, never against story 01/02's code or the real index. The schema change is its own deliverable
(ADR-002), not implicit. Couples to 01/02 only through ADR-002/003/004.

**Feasibility (developer amigo seat):** no flags. The verb shape and end-to-end loop were proven by
the pre-refine spike against the real 00–04 stream; the seam is greenfield in `src/cli.mjs`, built at
`aof:continue`. All four task contracts are deterministic CLI behaviours over an in-memory stub
backend — no dependency on 01/02's parser, ranking, or on-disk index. The one place these features
touch a fitness-function invariant (the `--json` projection of ADR-004) is phrased as a concrete
behavioural example ("under `--json` the output is the records array, not the text blob"), not as the
universal rule the arch-test `acd-memory-recall-contract` owns.
