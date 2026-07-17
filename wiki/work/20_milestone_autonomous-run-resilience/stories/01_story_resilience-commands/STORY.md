---
type: story
number: 01
slug: resilience-commands
title: "The resilience command surface — work:run-retry + the first item-status writer (rollbackItemStatus)"
parent: 20
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-06-30
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · The resilience command surface — run-retry + the bounded status rollback

## User story

As the operator (and the autonomous skill) driving runs,
I want a registered `work:run-retry` verb that resumes a retryable failed run's session on its lineage, plus a bounded item-status rollback that leaves the stream honest when a run fails or is reclaimed,
so that resume-vs-fresh and status-rollback are reachable through the **one command door** (the CLI today; the board inherits it free in m21) rather than improvised — and a genuinely-failing item is halted at the ceiling instead of looped.

<!-- This story wraps story 00's frozen store contract: the work:run-retry command (ADR-003) registered
     into command-core + the CLI face, and the rollbackItemStatus writer in work.mjs (ADR-005) — the FIRST
     programmatic item-frontmatter status write in the codebase, bounded hard. It wires only the CLI face;
     the board is milestone 21 (the new verb takes the precedented BOARD_DEFERRED carve-out). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 20 --autonomous`, Contract stage, 2026-06-30 — PO
     headline scenarios inline, `aof-qa` case-matrix audit + `aof-developer` feasibility check). Each
     behaviour is one `.feature` under tasks/; the fitness functions below are arch-tests the story OWNS,
     built at `aof:continue`. -->

Authored task `.feature`s (behavioural — RED until `aof:continue 20/01` builds the wiring + arch-tests):

- [x] **[00 · run-retry-command](tasks/00_run-retry-command.feature)** (ADR-003) — `work:run-retry` registered into the core, resolves exact, resumes the lineage, surfaces the store's coded rejections.
- [x] **[01 · run-retry-cli-face](tasks/01_run-retry-cli-face.feature)** (ADR-003) — `aof work run-retry` dispatch, `--run`/`--max-attempts`, the single `--json` envelope (the `argsFor("run-retry")` bijection case).
- [x] **[02 · status-rollback](tasks/02_status-rollback.feature)** (ADR-005) — `rollbackItemStatus` bounded `in-progress → not-started | blocked`, never `→ done`, status-field-only, atomic; wired into the failed-run + reclaim paths; rolled-back items re-offered by `aof work next`.
- [x] **[03 · resilience-acceptance](tasks/03_resilience-acceptance.feature)** (ADR-002/003/004/005/006) — the outsider-verifiable e2e through the real CLI: resume-on-infra, fresh-on-rejection, ceiling-halt, reclaim-and-rollback, dedup.
- [x] **[04 · run-complete-reason](tasks/04_run-complete-reason.feature)** (DEFAULT DECISION, the producer command-half) — `work:run-complete` gains `--reason`, recording `failureReason` on a failed run (null on done/cancelled).

This story **owns** these fitness-function arch-tests (from [ARCHITECTURE §Fitness functions](../../ARCHITECTURE.md), RED-until-built):

- [x] **`acd-status-rollback-bounded`** (ADR-005) — `rollbackItemStatus` (in `work.mjs`) writes status ONLY `in-progress → not-started | blocked`, NEVER `→ done`; touches only the frontmatter `status` field; writes via atomic `writeText`; and a source-grep over the whole module family confirms it is the ONLY item-status writer (`15/R3` + `10/R2` — scan the family, follow the function).
- [x] **`acd-run-retry-resumes-lineage`** (ADR-003, command path) — the `work:run-retry` command end-to-end resumes the lineage and surfaces the coded `not-retryable` / `attempts-exhausted` errors (shares the arch-test with story 00's store side).
- [x] **New-command registry gates (`19/R1`)** — EXTEND three existing arch-tests for `work:run-retry`: `acd-work-command-cli-bijection` (add the `argsFor("run-retry")` case — its switch THROWS on an unmapped sub), `command-core-contract` (add `work:run-retry` to `WORK_IDS`), `acd-work-command-route-coverage` (add `run-retry` to `BOARD_DEFERRED`, board = m21).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**:
`src/commands/run-retry.mjs` — a thin WRITE wrapper (`resolveItemExact`) over story 00's `retryRun`
(**ADR-003**), registered into [command-core.mjs](../../../../../src/command-core.mjs) (one import + one
`COMMANDS` entry — the additive door) with its CLI `aof work run-retry` dispatch + `--json` face; and the
new `rollbackItemStatus` writer in [work.mjs](../../../../../src/work.mjs) (**ADR-005**) — the FIRST
programmatic item-frontmatter status mutation in the codebase, bounded `in-progress → not-started | blocked`
(never `→ done`), status-field-only, via the atomic [fs.mjs](../../../../../src/fs.mjs)`:writeText` — wired
into the failed-run (`work:run-complete --outcome failed`) and reclaim (story 00's `reclaimStaleRuns`) paths.
It also EXTENDS the three registry-derived arch-tests (`19/R1`) + adds `acd-status-rollback-bounded`, all in
[scripts/test.mjs](../../../../../scripts/test.mjs).

**Independent because** it depends ONLY on story 00 (the store functions `retryRun` / `shouldRetry` /
`reclaimStaleRuns` it wraps and the writer signature the reclaim scan calls) — a single forward edge the
call graph dictates (`command-core.mjs` is the additive door imported by the 4 faces and importing every
`commands/*`; `work.mjs` is the item-frontmatter authority where the first status writer belongs, NOT the
store, which the `19/ADR-002` write-scope guard restricts to `runs/`). It registers into the SAME command
core, so milestone 21 (board) and the skill (story 02) inherit `work:run-retry` for free.

**The `19/R1` lesson is honoured up front:** registering `work:run-retry` arms THREE registry-derived gates,
not one — the CLI bijection (`argsFor` case required, the switch throws otherwise), the `/api/work`
route-coverage (`BOARD_DEFERRED` carve-out, board = m21), and the `command-core/00` known-commands allow-list
(`WORK_IDS` widening). Status rollback is deliberately NOT a new `work:run-*` verb (ADR-005) — it is a
`work.mjs` writer the failed/reclaim path calls, so it arms none of those three gates.

**The board face stays untouched (milestone 21)** — `aof graph impact src/board-ui.mjs` confirms no edge
from this work reaches it; only the CLI face is wired here.

**This story also owns the COMMAND half of the `failureReason` producer split (DEFAULT DECISION, refine
2026-06-30).** The Three-Amigos feasibility check surfaced that no ADR named who sets `timeout`/`agent_error`
on a failed run (only the reclaim path's `runtime_offline`, ADR-004) — yet five features depend on it.
Resolution: `work:run-complete` gains an optional `--reason` (the EXISTING m19 command extended — registers
NO new command, so it arms none of the `19/R1` registry gates) that maps argv → input → the store write
story 00 owns. The closed-set safety stays with the classifier (ADR-002 fails closed on an unknown reason),
not a command rejection. Asserted by [04_run-complete-reason](tasks/04_run-complete-reason.feature).
