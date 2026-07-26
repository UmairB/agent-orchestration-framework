---
type: milestone
number: 20
slug: autonomous-run-resilience
title: "Autonomous Run Resilience — make the cascade resumable and self-healing"
status: done
owner: product-owner
created: 2026-06-27
updated: 2026-06-30
depends: [19]
origin: wiki/planning/PRD-work-run-orchestration.md
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 20 · Autonomous Run Resilience — make the cascade resumable and self-healing

## Objective

The **resilience** value axis of the work-run orchestration arc (origin:
[PRD-work-run-orchestration](../../planning/PRD-work-run-orchestration.md)). Today `aof:autonomous`
loops `refine → build → verify` over `aof work next`, gating on `aof work validate`, and *claims* to be
resumable and to "stop on a blocker" — but with no durable run state behind the claim, a multi-hour
cascade that crashes, stalls, or wedges is silently stuck rather than detectable and recoverable.

This milestone makes the loop robust by **consuming the run lifecycle** (milestone 19): it lifts
Multica's runner-resilience mechanics and adapts each to aof's file-based, single-operator model —
**retryable** (`runtime_offline` / `timeout`) vs **non-retryable** (`agent_error`) failure
classification with an **attempt ceiling**; the sharp **session rule** (auto-retry on infra failure
*resumes* the prior session; a manual rerun starts *fresh*, never replaying poisoned state); **liveness**
via a heartbeat plus a restart-time backstop scan that reclaims a crashed run's in-flight work; **status
rollback** on a blocker (`in-progress → todo`); and **dedup** (no duplicate queued run per item) plus
**anti-loop guards** (skip self-triggers) for the multi-agent hand-offs in the cascade.

The behaviour must conform to the existing `aof:autonomous` stop conditions — it still stops only on a
genuine human gate (`@uat`), a blocker, or unsafe ambiguity; resilience makes those stops *reliable*, it
does not add new ones. An outsider can verify the objective is met when a cascade interrupted by an
infra failure resumes its session and completes, a rejected output triggers a fresh-session rerun, the
attempt ceiling halts a genuinely-failing item instead of looping, and a run orphaned by a crash is
reclaimed (not left wedged) on the next start.

## Scope

In scope:
- **Retryable vs non-retryable classification** — infra failures (`runtime_offline` / `timeout`) retry;
  agent rejection (`agent_error`) does not — bounded by an **attempt ceiling**.
- **Resume-vs-fresh session semantics** — auto-retry on infra failure resumes the prior session; a
  manual rerun starts fresh ("you judged the output bad — don't replay poisoned state").
- **Liveness + orphan reclaim** — a heartbeat file marks a live run; a restart-time backstop scan over
  the run records reclaims a crashed run's in-flight work (a restart scan, not a network/server sweep).
- **Status rollback on blocker** — a blocked/failed run rolls the item status back (`in-progress → todo`)
  so the stream is left honest.
- **Dedup + anti-loop guards** — no duplicate queued run per item; multi-agent hand-offs skip
  self-triggers and cannot loop.
- **Conformance to the existing stop conditions** — `@uat`, blocker, unsafe ambiguity remain the only
  stops; this milestone makes them robust, consuming milestone 19's run records and state machine.

Out of scope:
- **The run-lifecycle contract itself** — the item/run split, state machine, and run records are
  milestone 19 (work-run-lifecycle); this milestone only *consumes* them.
- **Board run observability** — surfacing run history / state / rerun on the board is milestone 21.
- **Any server / daemon / Postgres / WebSocket-hub / auth infrastructure** — "liveness" is a heartbeat
  file and "reclaim" is a restart-time scan, not a network poll or server sweep (PRD Out of scope).
- **Executing agents *for* the operator** — aof orchestrates the operator's local agent session; it does
  not spawn and bill agent processes (PRD Out of scope).
- **New aof runtimes** beyond the supported `claude` / `codex`.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 20.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Partitioned `2026-06-30` by `aof:refine 20` into **three** stories — a by-layer, single-direction chain
(`00 → 01 → 02`), the cut the codebase call graph dictates (see
[ARCHITECTURE §Story break-down rationale](ARCHITECTURE.md)). The by-concern alternative was weighed and
rejected: ADRs 001/002/003/004/006/007 all land in the single `run-store.mjs` spine, so concern-parallel
stories would contend on one file — the parallelism is illusory. The board face is deliberately untouched
(milestone 21); the new `work:run-retry` verb registers into the SAME command core, so 21 inherits it free.

- [x] **00 · [resilience-core](stories/00_story_resilience-core/STORY.md)** — `src/run-store.mjs`: the
  four additive resilience keys (ADR-001), the classification table + attempt ceiling (ADR-002), the
  `retryRun` lineage mint (ADR-003), the heartbeat + path-walking orphan-reclaim scan (ADR-004), the dedup
  guard + collision-safe mint (ADR-006), and the atomic-persist fix (ADR-007). The spine; owns the
  classification / retry-lineage / reclaim-stale-only / persist-atomic / dedup arch-tests. Consumes only
  `19`'s store + `fs.mjs`. **Picks up the `19/R2` carry-forwards** (atomic persist + concurrent-mint/dedup).
- [x] **01 · [resilience-commands](stories/01_story_resilience-commands/STORY.md)** — the `work:run-retry`
  command (ADR-003) registered into the command core + CLI face, the three `19/R1` registry gates, and the
  first item-status writer `rollbackItemStatus` in `work.mjs` (ADR-005, bounded `in-progress →
  not-started|blocked`, never `→ done`). Owns the status-rollback-bounded + registry-gate arch-tests.
  Depends only on story 00.
- [x] **02 · [resilience-skill](stories/02_story_resilience-skill/STORY.md)** — `autonomous.md` consuming
  the new commands: reclaim-at-restart, retry-resume on infra failure / fresh on rejection, the anti-loop
  guidance (ADR-006 skill side), within the UNCHANGED stop set (ADR-008, no new stop). Skill-layer judgment
  — owns no fitness function (asserted by review + `.feature`). Depends only on story 01.

## Dependencies

- **19 · work-run-lifecycle** — the foundation this milestone consumes: it reads and drives the run
  records, the `queued → running → done / failed / cancelled` state machine, the attempt count, the
  session id, and the structured brief that milestone 19 persists. Without that durable run state the
  resilience mechanics (resume, reclaim, ceiling, rollback) have nothing to act on. The `aof:autonomous`
  skill and its `aof work next` / `aof work validate` engine are existing machinery this hardens (the
  host of the loop), not a separate milestone to depend on. Independent of milestone 21 — both consume
  the foundation, neither consumes the other.
