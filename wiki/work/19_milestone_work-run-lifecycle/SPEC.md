---
type: milestone
number: 19
slug: work-run-lifecycle
title: "Work-Run Lifecycle — the durable item/run split + run state machine in the command core"
status: done
owner: product-owner
created: 2026-06-27
updated: 2026-06-30
depends: [08]
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
# 19 · Work-Run Lifecycle — the durable item/run split + run state machine in the command core

## Objective

The **foundation** of the work-run orchestration arc (origin: [PRD-work-run-orchestration](../../planning/PRD-work-run-orchestration.md)).
Separate the durable **work item** from each **run** of it, and give every run an explicit state machine
recorded *in* the work stream as a derived artifact — so the arc's "resumable" and "observable" claims
finally rest on durable state instead of an empty promise.

Concretely: author the run lifecycle **as registered command-core commands** (`work:run-start` /
`work:run-status` / `work:run-complete` and the rest — exact verbs pinned at refine), each with a
stable, machine-readable (`--json`) contract, so the CLI and board faces inherit execution control for
free through the one registry door (the milestone-08 precedent this milestone applies, never
re-litigates). A run carries an explicit state machine (`queued → running → done / failed / cancelled`),
and each run record is persisted as a **derived log** in the work stream (per-item `STATE.md` or a runs
log — settled at refine) capturing at least attempt count, outcome, session id, and the structured brief
the run was spawned with.

The load-bearing invariant: a run record is **derived** — an observability/resume log, never an
authoritative second copy of item state. Item status (frontmatter) stays the single source of truth; the
run log explains *how it got there* and must be rebuildable and prunable (the same single-source
constraint milestones 05/09 enforce). An outsider can verify the objective is met when a run's lifecycle
is driven entirely through the registered `work:run-*` commands with stable `--json` shapes, the
recorded run state survives a restart, and pruning/rebuilding the run log changes no item's authoritative
status. This milestone is the contract the other two arc milestones consume; it ships first.

## Scope

In scope:
- **The item/run split** — the durable work item is distinct from each run of it; every trigger produces
  a new run, giving clean audit and retry (the "Issue ≠ Task" mechanic, adapted to the file-based model).
- **The run state machine** — `queued → running → done / failed / cancelled`, authored into the command
  core; the exact transition rules pinned in the milestone ADR at refine.
- **`work:run-*` registered command-core commands** — start / status / complete (+ any sibling verbs)
  as first-class commands with stable input/result shapes and a `--json` contract; the CLI is a thin
  face and the board is a second thin face, both invoking the same commands (the milestone-08 bijection).
- **Run records as a derived log** — persisted in the work stream (per-item `STATE.md` or a runs log,
  decided at refine), each capturing attempt count, outcome, session id, and the structured brief the run
  was spawned with; rebuildable and prunable.

Out of scope:
- **The autonomous-resilience mechanics that consume this** — retryable/non-retryable classification,
  resume-vs-fresh session semantics, attempt ceiling, heartbeat + orphan reclaim, status rollback,
  dedup/anti-loop guards — are milestone 20 (autonomous-run-resilience).
- **Board run observability** — surfacing run history / current-run state / a rerun affordance on the
  board is milestone 21 (board-run-observability).
- **Any server / daemon / Postgres / WebSocket-hub / auth / multi-workspace infrastructure** — aof stays
  file-based and single-operator; it adopts Multica's mechanics, not its platform (PRD Out of scope).
- **Executing agents *for* the operator** — aof records the lifecycle of the operator's local agent
  session; it does not become a runner that spawns and bills agent processes (PRD Out of scope).
- **Treating the run record as authoritative item state** — it is derived only; item frontmatter remains
  the source of truth.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 19.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Partitioned `2026-06-29` by `aof:refine 19 --autonomous` into **two** stories — store-first, the cut the
codebase call graph dictates (see [ARCHITECTURE §Story break-down rationale](ARCHITECTURE.md)). The board
face is deliberately untouched (milestone 21); both stories register into the SAME command core so 20/21
inherit the `work:run-*` commands for free.

- [x] **00 · [run-store](stories/00_story_run-store/STORY.md)** — `src/run-store.mjs`: the run model + the
  frozen per-run JSON schema (ADR-003), the derived `runs/<run-id>.json` path seam (ADR-002), and the
  state-machine transition table (ADR-001). The spine; owns fitness functions #1–#3. Consumes only the
  existing `work.mjs` item model.
- [x] **01 · [run-commands](stories/01_story_run-commands/STORY.md)** — the `work:run-start` /
  `work:run-complete` / `work:run-status` registered command-core commands (thin over the store) + the CLI
  `--json` face; owns the bijection arch-test extension (#4). Wraps story 00's frozen contract.

## Dependencies

- **08 · cli-command-core** — this milestone authors the run lifecycle *as command-core commands*, so it
  inherits 08's command registry, the `{id,input,run,cli}→result` contract, the `--json` discipline, and
  the bijection fitness function that keeps the CLI and board faces thin. The run ops are new operations
  arriving "as commands first," exactly as 08 mandates.

## Accept decision

**Accepted `2026-06-30` by `aof:verify 19`.** Both stories done; milestone `status: done`.

- **Automated + agent-run lane (green).** Whole suite green (1445 `ok` / 0 `not ok`, exit 0). All six
  `@executable` task features pass: story 00 — `run-store/00` (record+schema, 11), `run-store/01`
  (state-machine, 4), `run-store/02` (derived-log lifecycle, 12); story 01 — `run-commands/00` (11),
  `run-cli-face/01` (8), `run-restart/02` (the outsider-verifiable lifecycle-survives-restart, 2). All
  **four fitness functions** green: `run-record-derived` (#1), `run-write-scope` (#2), `run-partition-ready`
  (#3), and the registry-derived bijection extension (#4, `aof work <sub> --json` clean for the three
  `run-*` verbs). Test-traceability satisfied; litmus clean (the structural invariants live in arch-tests,
  not the `.feature` text).
- **No human lane.** No `@manual`, `@uat`, or UI/`DESIGN.md` surface (board observability is milestone 21),
  so the human-acceptance step was correctly skipped — no design-conformance render and no `@uat` sign-off.
- **Findings.** No new defects. Two pre-existing non-blocking findings carried in `VERIFICATION.md`:
  **F-19-01** (design-gap/process, low — stale `@manual`/UAT line in the STATE template → retro;
  resolved in this accept's STATE compaction) and **F-19-02** (enhancement, low — under-specified
  sibling-run invariant → optional/backlog). Neither blocks acceptance.
- **Gate.** `aof work validate 19` and the full-stream `aof work validate` both **PASS**.
