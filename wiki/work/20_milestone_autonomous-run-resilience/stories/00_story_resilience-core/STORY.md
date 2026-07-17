---
type: story
number: 00
slug: resilience-core
title: "The run-store resilience core — classification, retry-lineage, heartbeat + reclaim, dedup, atomic persist (src/run-store.mjs)"
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
# 00 · The run-store resilience core — the spine the commands + skill couple through

## User story

As the resilience foundation that the new command surface (story 01) and the hardened autonomous loop (story 02) all couple through,
I want `src/run-store.mjs` extended with the failure-classification table + attempt ceiling, the retry-lineage mint, the heartbeat stamp + path-walking orphan-reclaim scan, the dedup guard + collision-safe mint, and the atomic-persist fix — all on the m19 derived run record,
so that the durable run state can actually be **classified, resumed, reclaimed, and de-duplicated** — the deterministic mechanics resilience rests on — from one authority, without any face or skill re-deriving them.

<!-- This is the SPINE milestone 20 exists to harden: it extends the m19 frozen record with the four
     resilience keys (ADR-001), and adds the pure classification table (ADR-002), the retry-lineage mint
     (ADR-003, store side), the heartbeat + reclaim scan (ADR-004), the dedup + collision-safe mint
     (ADR-006), and the atomic persist (ADR-007). It owns NO command registration, NO CLI dispatch, and
     does NOT write item frontmatter (the rollback writer is story 01, in work.mjs). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 20 --autonomous`, Contract stage, 2026-06-30 — PO
     headline scenarios inline, `aof-qa` case-matrix audit + `aof-developer` feasibility check). Each
     behaviour is one `.feature` under tasks/; the fitness functions below are arch-tests (structural
     invariants → never a behaviour feature) the story OWNS, built at `aof:continue`. -->

Authored task `.feature`s (behavioural — RED until `aof:continue 20/00` builds the step defs + arch-tests):

- [x] **[00 · resilience-record-keys](tasks/00_resilience-record-keys.feature)** (ADR-001) — the four additive keys default null, round-trip, read forward over a 9-key record; each key set only by its owning mechanic; **the store-side `failureReason` producer** (completing failed with a reason writes it).
- [x] **[01 · failure-classification](tasks/01_failure-classification.feature)** (ADR-002) — `isRetryable` over the closed table; `shouldRetry` ANDs the verdict with the ceiling, failing closed at `attempt >= maxAttempts`.
- [x] **[02 · retry-lineage](tasks/02_retry-lineage.feature)** (ADR-003 store) — `retryRun` carries the prior `sessionId`/`attempt+1`/`retryOf`; resolves the prior; a non-retryable / ceiling-exhausted / fail-closed prior → a coded error, no new run.
- [x] **[03 · heartbeat-and-reclaim](tasks/03_heartbeat-and-reclaim.feature)** (ADR-004) — `heartbeat` stamps liveness; `reclaimStaleRuns(items, …)` walks by path, force-fails only stale `running` runs, leaves siblings byte-unchanged.
- [x] **[04 · dedup-and-atomic-persist](tasks/04_dedup-and-atomic-persist.feature)** (ADR-006/007) — no duplicate non-terminal run (incl. the self-lineage backstop); collision-safe mint; every persist through the atomic `writeText`.

This story **owns** these fitness-function arch-tests (from [ARCHITECTURE §Fitness functions](../../ARCHITECTURE.md), RED-until-built):

- [x] **`acd-run-retry-classification`** (ADR-002) — the closed retryable/non-retryable table + `isRetryable`/`shouldRetry` are pure (no clock/fs/config); `shouldRetry` fails closed at `attempt >= maxAttempts`.
- [x] **`acd-run-retry-resumes-lineage`** (ADR-003, store side) — a `retryRun` record carries `sessionId = prior.sessionId`, `attempt = prior.attempt + 1`, `retryOf = prior.runId`; a non-retryable / ceiling-exhausted prior → coded error, no new run minted, prior record byte-unchanged.
- [x] **`acd-run-reclaim-stale-only`** (ADR-004) — `reclaimStaleRuns(items, …)` force-fails ONLY stale `running` runs (`runtime_offline` + `reclaimedAt`) via the legal `running → failed` edge, takes the item list as an argument (the `26 → 20` path-walk seam), and leaves every live/queued/terminal run byte-unchanged.
- [x] **`acd-run-persist-atomic`** (ADR-007) — every run-record write routes through `src/fs.mjs:writeText`; no raw `writeFile`/`appendFile` of a `runs/<id>.json`; run-store imports `writeText` (the previously-missing edge).
- [x] **`acd-run-dedup-no-duplicate`** (ADR-006) — the mint path rejects a second non-terminal (`queued`/`running`) run with `duplicate-run` (writes nothing, first record unchanged); two mints at the same injected `now` get distinct `runId`s (collision-safe).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns** `src/run-store.mjs` — it
extends the m19 frozen record with the four additive resilience keys `failureReason` / `heartbeatAt` /
`retryOf` / `reclaimedAt` (**ADR-001**), and adds: the closed classification table + `isRetryable` /
`shouldRetry` pure functions beside `isLegalTransition` (**ADR-002**); `retryRun` — the lineage-linked mint
that carries the prior `sessionId` (**ADR-003**, store side); `heartbeat` + `reclaimStaleRuns` — the
path-walking restart-time scan that force-fails stale `running` runs (**ADR-004**); the dedup guard +
collision-safe mint that gives `19`'s reserved `queued` state its producer and closes the `19/R2b`
concurrent-`runId` race (**ADR-006**); and routing `persist` through the atomic `src/fs.mjs:writeText`
seam (**ADR-007**, closing `19/R2a`) — plus the five arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It *reads* the existing [work.mjs](../../../../../src/work.mjs)
item model (`listItems`/`recordDoc` resolve the `item.dir` the `runs/` dir sits under) and now *imports*
[fs.mjs](../../../../../src/fs.mjs) (`writeText`). It does **not** write item frontmatter (the
`rollbackItemStatus` writer is story 01), and does **not** touch `command-core.mjs`, `cli.mjs`, or
`board-ui.mjs` (story 01 / milestone 21).

**Independent because** it is the dependency ROOT the call graph dictates: `aof graph impact
src/run-store.mjs` reports it is imported by **exactly the 3 run commands** and imports **nothing** — the
spine at the centre of a high-fan-in star (the `work.mjs` role). Every new mechanic here is a contract the
commands (story 01) and skill (story 02) consume in one forward direction; this story consumes only `19`'s
already-shipped store + `fs.mjs`, so it can be built and tested in full isolation before any new command
exists. The reclaim scan (ADR-004) *triggers* the status rollback, but the rollback WRITER lives in story
01 (`work.mjs`) by the `19/ADR-002` write-scope guard — this story builds the scan that calls it, against
the writer's signature.

**The two `19/R2` carry-forwards are picked up HERE, not re-discovered:** the atomic-persist fix (`R2a` →
ADR-007) and the concurrent-`runId`-mint / dedup fix (`R2b` → ADR-006). The `compactStamp` UTC-`Z`
`toISOString()` assumption is preserved across every new persist path (heartbeat bump, reclaim force-fail,
retry mint) — never inject a non-UTC `now`.

**The `failureReason` producer is split — this story owns the STORE half (DEFAULT DECISION, refine
2026-06-30; the command half is story 01).** ADR-001 says a failed run carries a `failureReason` and ADR-002
classifies it, but **no ADR named WHO sets `timeout`/`agent_error`** (ADR-004 names only the reclaim path's
`runtime_offline`). The Three-Amigos feasibility check surfaced this as a real producer gap five features
lean on. Resolution: `completeRun`/`applyTransition` gains an optional `failureReason` written onto the
record on a `→ failed` transition (recorded verbatim — the closed-set safety is the classifier failing
closed, ADR-002, NOT a store rejection), null on a clean `done`/`cancelled`. The operator/agent-facing
`run-complete --reason` flag that drives it is **story 01**. Asserted by
[00_resilience-record-keys](tasks/00_resilience-record-keys.feature) (the producer scenario).
