---
type: milestone
number: 21
slug: board-run-observability
title: "Board Run Observability — surface run history, state, and rerun on the board"
status: done
owner: product-owner
created: 2026-06-27
updated: 2026-06-30
depends: [03, 19]
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
# 21 · Board Run Observability — surface run history, state, and rerun on the board

## Objective

The **observability** value axis of the work-run orchestration arc (origin:
[PRD-work-run-orchestration](../../planning/PRD-work-run-orchestration.md)). The board names the next
pipeline stage but never shows what actually *ran*; once milestone 19 records each run as durable derived
state, the board can finally make it visible.

This milestone surfaces, per work item, the **run history**, the **current run's state**, and a **rerun
affordance** — all reached **through the registered command-core commands** (no side-channel that reads
run records or triggers a run behind the registry's back), preserving the read-mostly board's existing
discipline: its transport/path-display face rules and its frozen API envelope (milestone 03) stay
intact. Observability is **poll/refresh** over the existing read-mostly board, not a real-time push
stream. An outsider can verify the objective is met when the board shows a given item's prior runs and
the live run's state, a rerun can be triggered from the board and resolves to the same `work:run-*`
command the CLI would invoke, and the milestone-03 board envelope plus the bijection/no-UI-core-import
fitness functions (milestone 08) stay green.

## Scope

In scope:
- **Run history per item** — the board surfaces an item's prior runs (attempt, outcome, session id, when)
  read through the registered run commands.
- **Current-run state** — the live run's `queued → running → done / failed / cancelled` state, shown on
  the board and refreshed by poll.
- **A rerun affordance** — trigger a rerun from the board, resolving to the same registered `work:run-*`
  command the CLI exposes (with milestone 20's fresh-vs-resume semantics where applicable).
- **Thin-face discipline preserved** — every new board capability maps to a registered command; the board
  carries no run logic of its own and imports no core module behind the registry, and the milestone-03
  API envelope is preserved.

Out of scope:
- **The run-lifecycle contract** — the run records and state machine are milestone 19; this milestone
  only *renders* them through the registered commands.
- **The autonomous-resilience mechanics** — classification / resume / reclaim / ceiling are milestone 20;
  this milestone visualises runs, it does not author the loop's robustness.
- **Real-time push to a live web client** — observability is poll/refresh over the read-mostly board, not
  a WebSocket event stream (revisit only if the board ever becomes interactive) (PRD Out of scope).
- **A broader interactive board / UI redesign** — beyond the rerun affordance, the board stays
  read-mostly; the rendered surface and envelope are otherwise unchanged.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 21.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Partitioned `2026-06-30` by `aof:refine 21` into **two** stories — a FACE addition cut along the two
shapes of work the Scope names (read/render vs. the rerun action), following the real call/dependency
coupling the codebase graph reports (see [ARCHITECTURE §Story break-down rationale](ARCHITECTURE.md)). The
m19 `work:run-*` commands are already registered, so the read path is a thin additive face — no new
command-core wiring.

- [x] **00 · [run-observability](stories\00_story_run-observability\STORY.md)** — the additive
  `GET /api/work/run-status` thin route (ADR-001) + the detail-panel **RUNS view**, the **current-run-state
  indicator** + lane-card in-flight dot, and the **poll/refresh** wiring (DESIGN surfaces 1 + 2). Owns the
  read-path fitness functions (route bijection re-tighten, no-core-import, list-contract, the route half of
  write-isolation).
- [x] **01 · [rerun-affordance](stories\01_story_rerun-affordance\STORY.md)** — the quiet **`↻ Rerun`**
  affordance (DESIGN surface 3) reusing the m03 ADR-006 `runAgent → TerminalDock` launch (ADR-002); the
  board writes nothing, the verb (fresh `work:run-start`) reaches the agent as typed PTY input, and m20's
  fresh-vs-resume slots in as a later additive delta. Owns the rerun half of `acd-board-write-isolation`.

## Dependencies

- **19 · work-run-lifecycle** — the foundation this milestone renders: the run history, current-run
  state, and rerun all read/drive the run records and the registered `work:run-*` commands milestone 19
  authors. Independent of milestone 20 — both consume the foundation, neither consumes the other.
- **03 · work-board-ui** — supplies the board surface and the frozen `/api/work` API envelope this
  milestone extends through registered commands; its read-mostly transport/path-display face discipline
  (carried through the milestone-08 command-core inversion) is preserved here.
