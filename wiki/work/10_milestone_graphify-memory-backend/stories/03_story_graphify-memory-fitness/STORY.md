---
type: story
number: 03
slug: graphify-memory-fitness
title: "The graphify-memory fitness functions — records-from-parsers, via-command, derived-index, classified, degrades — as arch-tests"
parent: 10
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-22
---
# 03 · The graphify-memory fitness functions — the load-bearing structural guarantee

## User story

As the architecture itself (the "records come from the 05 parsers, graphify is reached only through the 09 command, the index is derived, the extraction backend is classified honestly, and a missing binary degrades not crashes" guarantee),
I want the structural invariants of ADR-001…ADR-005 enforced as CI **arch-tests**,
so that the contract is **durable**: a future change that sources records from `graph.json` nodes, imports `src/graphify.mjs` or spawns graphify directly, commits the derived graph, leaves `claude-cli` network-by-accident, or hard-fails when the binary is absent — fails CI **loudly** instead of silently re-introducing the drift.

## Tasks

<!-- This story's deliverable is the FITNESS FUNCTIONS of the ARCHITECTURE.md table — arch-tests, NOT
     task `.feature` scenarios (structural invariants belong in the fitness table, never inside a
     behaviour feature). Its contract is therefore ALREADY fully specified by the fitness-functions
     table — there is no Three-Amigos `.feature`-authoring pass to run; `aof:continue 10/03` authors the
     arch-tests directly and they turn GREEN as 00/01/02 land (mirrors 05/03 and 09/03). The six
     arch-tests are tracked here as the story's buildable units. -->

- [x] `test/arch/acd-graphify-records-from-parsers.test.mjs` — **records from the 05 parsers, not graph nodes**: `recall` returns frozen `MemoryRecord`s with a resolving `source:line`; the graph contributes only to `score` — ADR-001 _GREEN_
- [x] `test/arch/acd-graphify-derived-index.test.mjs` — **derived-index (records + graph)**: a fresh `reindex` reproduces the identical record set, every `source:line` resolves, `graphify-out/` AND the graphify store are git-ignored + rebuildable, no recalled fact lives only in the graph (graph-build half @manual) — ADR-001, ADR-005 _GREEN (durably pins the F-01 fix)_
- [x] `test/arch/acd-graphify-backend-via-command.test.mjs` — **reach graphify only via the 09 command**: the backend imports `command-core.invoke` + `graph-normalize`, imports NEITHER `src/graphify.mjs` NOR `node:child_process`, and spawns nothing — ADR-002 _GREEN (mutation-verified)_
- [x] `test/arch/acd-graphify-backend-selection.test.mjs` — **selection enum + single read**: `graphify` registered in `$defs/memory.backend` + `BACKEND_REGISTRY`; an unregistered name fails the enum; `config.memory?.backend` read in exactly one place — ADR-003 (05/ADR-002) _GREEN_
- [x] `test/arch/acd-graphify-backend-classified.test.mjs` — **honest classification, never silently networked**: `classifyEgress("claude-cli") === "docs-media"`, `isNetworkBackend("claude-cli") === true` (by knowledge), `ollama` stays LOCAL; the extraction backend is surfaced — ADR-003 _GREEN_
- [x] `test/arch/acd-graphify-binary-absent-degrades.test.mjs` — **binary-absent degrades, never crashes**: with `resolveGraphifyBinary` stubbed `{found:false}`, `recall`/`brief`/`reindex`/`status` return without throwing; `recall` still returns the 05 records with resolving `source:line` + a `graphSignal` diagnostic — ADR-004 _GREEN_

**Build (2026-06-22, `aof:continue 10/03`):** all six `test/arch/acd-graphify-*` authored + registered in `scripts/test.mjs`; **all GREEN, full suite 1067 ok / 0 fail** (+24). No RED guards — every story-00/01/02 surface satisfies its invariant. Non-vacuity mutation-verified (the via-command import guard catches both `from` and bare-import forms of `../graphify.mjs`/`child_process`; the single-read guard counts a second `config.memory?.backend` read). Fitness-only story (no `.feature`, no `@manual`/`@uat`) → verify = the six green + validate. **Done.**

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (the **Fitness functions** table — the
load-bearing deliverable). This story **owns** the six arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It authors **no production code**.

**Independent because** it asserts against the **frozen** module (story 00), re-ranker (story 01), and
classification/fallback (story 02) surfaces — but consumes **none of their internals**: it source-greps the
import graph, validates the schema, feeds a committed `graph.json` fixture + fixture records through the
re-ranker, and stubs `resolveGraphifyBinary` absent. Owning no production code, it cannot block — or be
blocked by — the siblings' internals; the tests are RED-until-built by design (they reference the
stories-00/01/02 surfaces and fail cleanly until those land) and go GREEN as the siblings land.

> **Note (a separately-tracked deliverable, not a behaviour story):** the SPEC names the derived-index +
> enforcing guarantees as load-bearing, so they get their own owner and review surface here. But the units
> are *arch-tests*, not `.feature` files — there is no Three-Amigos Contract pass; the contract is the
> ARCHITECTURE.md fitness table (mirrors 05/03 and 09/03).
