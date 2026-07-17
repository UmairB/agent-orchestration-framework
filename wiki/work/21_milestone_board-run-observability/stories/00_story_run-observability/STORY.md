---
type: story
number: 00
slug: run-observability
title: "Run observability (read/render) — the /api/work/run-status route + the detail-panel runs view, current-run indicator & poll"
parent: 21
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
# 00 · Run observability (read/render) — what the agent did, and what it's doing now

## User story

As the operator driving the ACD loop from the board,
I want each work item's run history and its current run's state surfaced in the detail panel — read through the registered `work:run-status` command and refreshed by poll,
so that I can see what the agent has actually run on an item, and what it is doing right now, without leaving the board or reading run records behind the registry's back.

<!-- The READ/RENDER half of milestone 21: the additive `GET /api/work/run-status` thin face route
     (ARCHITECTURE ADR-001), the type-aware RUNS tab + the current-run-state indicator + the lane-card
     in-flight dot (DESIGN surfaces 1 + 2), and the poll/refresh wiring. It produces the read-model the
     rerun story (01) observes through; it owns the read-path fitness functions. -->

## Tasks

<!-- Contract authored via Three Amigos at `aof:refine 21` (autonomous, Contract stage). Each behaviour
     task is one `.feature` under tasks/; done when its @executable feature is green. The fitness functions
     are arch-tests (structural invariants → never a behaviour feature) tracked as buildable units. PO wrote
     the headline Scenarios; QA the Examples tables; the developer checked feasibility against the real
     seams (the /api/work route family in board-ui.mjs, work:run-status's `{ ref, runs[] }`, and the pure
     status.tsx / dock-state module convention for the headless lanes). -->

Authored `2026-06-30`:

- [x] `tasks/00_runs-render-from-run-status.feature` — the new `/api/work/run-status?ref=` route returns `work:run-status`'s `{ ref, runs[] }` through the registry (empty history for a never-run item, not-found for an unresolvable ref, read-only); the detail panel's RUNS tab renders the runs newest-first (`#attempt` · run-state chip · truncated `sess·…` · relative time), the dashed "No runs yet" card for an empty history, the type-aware tab set, and the pure relative-time formatter. *(@executable green: `board-run-status-route` 4 + `board-runs-pure` relative-time/history; @manual/@uat → verify.)*
- [x] `tasks/01_current-run-highlighted.feature` — the pure current-run selection (single `running`, else most-recent) + the fixed run-state chip ramp (queued/running+pulse/done+✓/failed/cancelled); the pinned Current-run strip, the lane-card in-flight pulse dot (`running` only), the no-in-flight → most-recent-terminal fallback, and the no-runs → empty-card degrade. *(@executable green: selection + tie-break + chip ramp + unknown-state; @manual → verify.)*
- [x] `tasks/02_runs-poll-refresh.feature` — the pure `⟳ refreshed Ns ago` freshness label; the in-place re-fetch over the `load({silent})` non-tearing idiom, the absence of live-tail/stream chrome, and the @uat that a silent poll updates run state without tearing down a live terminal. *(@executable green: refreshed-label outline; @manual/@uat → verify.)*
- [x] **Fitness `acd-work-command-route-coverage`** (EXTENDED, ARCHITECTURE fitness #2) — dropped `run-status` from `BOARD_DEFERRED`; the route↔command bijection re-tightens so the new `/api/work/run-status` route must exist and invoke `work:run-status` (`run-start`/`run-complete`/`run-retry` stay deferred). **Green.**
- [x] **Fitness `acd-work-ui-no-core-import`** (re-asserted, fitness #4) — `board-ui.mjs` reaches run state ONLY through `command-core.mjs`; no direct `run-store.mjs` / `commands/run-*.mjs` import. **Green.**
- [x] **Fitness `acd-board-write-isolation`** (EXTENDED — route half, fitness #1) — the new run route adds no `writeFile`/`appendFile` call site and no command-CLI shell-out. **Green.**
- [x] **Fitness `acd-work-list-contract`** (untouched — stays green, fitness #5) — the additive route does not alter the frozen 7-field `work list --json` contract. **Green.**

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (ADR-001 the read route; ADR-003 envelope/guard additivity) and [DESIGN.md](../../DESIGN.md) (surfaces 1 + 2). This story **owns**: the new `GET /api/work/run-status?ref=` thin route in [board-ui.mjs](../../../../../src/board-ui.mjs) (`invoke("work:run-status", {ref}) → projection`, zero operation logic), the `workApi.runStatus(ref)` client + `RunRecord` wire type in `ui/src/board/api.ts`, the RUNS tab + runs view + current-run indicator in `ui/src/board/DetailPanel.tsx`, the lane-card in-flight dot in `ui/src/board/BoardLanes.tsx`, and the poll wiring in `ui/src/board/Board.tsx` — plus the read-path fitness functions above + the `BOARD_DEFERRED` edit, registered in [scripts/test.mjs](../../../../../scripts/test.mjs).

**Independent because** the read path is a thin additive face over the **already-registered** `work:run-status` (no new command-core wiring — the codebase graph confirms `command-core.mjs` already imports `run-status.mjs`); it binds to the `work:run-status` `{ ref, runs[] }` shape (a checked-in wire type), and produces the read-model the rerun story (01) only consumes for post-launch state. The cross-story dependency is **one-directional** (01 → 00's read-model) and fixturable — 00 depends on neither story (ARCHITECTURE §Story break-down rationale).
