---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 42 · Structural overhaul — one home, one door, no silence — State

## Progress

- Framed 2026-07-26 from TECH_DEBT.md items 0–7 (operator direction: rewrite-to-a-designed-shape
  over further adhoc fixes). Stories not yet broken down — next: `aof:refine 42`.

## Notes & decisions in flight

- 2026-07-26 (pre-refine): the one-door rule gained its EXECUTION-SCOPE leg (operator-found
  defect: a story's Continue ran locally while its milestone ran on a worker — the door looked up
  execution by exact ref, but runs/branches/worktrees are recorded at the TOP-LEVEL item). One rule
  in one home (`executionScopeRef`/`resolveScopedExecution`, board-mesh-execution.mjs) consumed by
  BOTH the continue decision (now pure + unit-tested; third answer `running` = watch, don't
  restart; remote dispatch always at scope ref) and the row overlay (story rows inherit execution →
  the affordance disables Continue with "Running on <node>"). Wave (b) must generalise this scope
  rule to refine/verify when they get their doors.
- 2026-07-26 (pre-refine): debt item 1's core was paid down — `aof.exe` is now a payload-first
  launcher (sea-entry bootstrap; verified `import()` of external ESM works inside this SEA recipe),
  install-local defaults to a payload file-copy deploy (`--sea` only for launcher/release builds),
  BUILD_ID stamped + surfaced (`--version`, daemon startup lines), `.bak` pruning. Remaining for
  wave (c): remote build-id in `aof mesh status`. Refine should fold this in, not re-plan it.
- 2026-07-26 (pre-refine): debt item 6's doc/run legs were paid down ahead of the milestone —
  projection schema v5 (`work_item_docs`/`work_item_runs`), the worker's `worktree-content` frame,
  and the `work:doc`/`work:run-status` projection fallback. Unit-verified only; live two-machine
  verification pending (needs deploy + operator restarts). The board's embedded console leg remains
  for wave (b). Refine should fold this into the wave-(b) story rather than re-planning it.

- Sequencing is load-bearing, not stylistic: wave (a) (logs, no-silent-catch, green gate) is the
  verification substrate — without it, no later rewrite's success is observable. Do not reorder.
- The soak stays up throughout; any stage that would require stopping both nodes needs a re-think
  before it needs a schedule.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
