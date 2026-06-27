---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  COMPACTED at Accept 2026-06-25: durable decisions graduated to ADR-001..007 (ARCHITECTURE.md),
  the calibration lesson to RETROSPECTIVE.md R1, evidence to VERIFICATION.md — the blow-by-blow
  and the `## Feedback (for retro)` notes are archived there, not restated.
-->
# 16 · Context-Budget Lint — State

## Progress

<!-- Story-by-story roll-up; the source of truth for the story's status is its own STORY.md frontmatter. -->

- **Framed 2026-06-25** (`aof:shatter`) from
  [PRD-work-artifact-health.md](../../planning/PRD-work-artifact-health.md) (origin). The milestone-15
  `work:doctor` engine carried the structural-health groups but no signal for **context bloat**; this
  milestone appends a doc-bloat check-group. Depends on **15 · work-doctor-core** (`done`).
- **Refined 2026-06-25** (`aof:refine 16 --autonomous`) — architect recorded **ADRs 001–007**
  ([ARCHITECTURE.md](ARCHITECTURE.md)); broken into a **single** non-splittable story (ADR-007) —
  [00 · doc-bloat-check-group](stories/00_story_doc-bloat-check-group/STORY.md) — whose Contract
  (`tasks/00_doc-over-budget.feature`, `tasks/01_configurable-budget.feature`) was authored via Three
  Amigos in the same run. Memory recall ran empty (backend `none`).
- **Built + reviewed 2026-06-25** (`aof:continue 16`) — landed exactly as ADR-001…007 specify: the
  `splitLines` + `docSizes` snapshot extension and the `budgetsFromConfig` resolver (defaults 300/700/150)
  in `src/work-doctor.mjs`; the pure `budgetGroup` in the new `src/work-doctor-budget.mjs` appended to
  `CHECK_GROUPS`; the closed `budgets` schema block on `work.doctor`. Both `@executable` features green
  via `test/doctor-context-budget.test.mjs` + the two new fitness functions (`acd-context-budget-finding`,
  `acd-context-budget-config-sourced`); the inherited determinism glob auto-covers the new module. Review:
  architect (structural) **CONFORMS** on every ADR, QA (behavioural) **COVERED**. Durable decisions live in
  **ADR-001..007**; the one process lesson graduated to **RETROSPECTIVE.md R1**.
- **Verified + accepted 2026-06-25** (`aof:verify 16`) — `@executable`-only milestone (no `@manual`/`@uat`,
  no UI). Suite **1247 ok / 0 not ok** + all fitness functions green (ADR-004 envelope · ADR-005
  config-sourced/no-baked-literal · inherited determinism + no-wall-clock + no-new-door bijection). A live
  `aof work doctor` over this repo confirmed the check fires end-to-end through the unchanged surface,
  surfacing the one real `doc-over-budget` warn (m02 `ARCHITECTURE.md` 725 > 700 — VERIFICATION `@finding-F1`,
  a non-blocker routed to RETROSPECTIVE R1). `aof:validate 16` gate **PASS**; no blocker finding open. The
  single story is done → **milestone accepted**. Evidence + accept decision → [VERIFICATION.md](VERIFICATION.md).
  - **00** done.

## Verification

<!-- Pointers, not restatements. -->
- [x] `@executable` suite green — `node ./scripts/test.mjs` → 1247 ok / 0 not ok (2026-06-25).
- [x] Fitness functions green — ADR-004 envelope, ADR-005 config-sourced/no-baked-literal; determinism +
      no-wall-clock + no-new-door inherited (m15 arch-tests, unchanged).
- [x] No `@manual` / `@uat` / UI lanes in scope — foundational/technical milestone; the agent-runnable
      end-to-end smoke (live `aof work doctor`) is recorded in [VERIFICATION.md](VERIFICATION.md).

<!-- ARCHIVED at accept (2026-06-25): the `## Notes & decisions in flight` (the 15 dependency), the
     `## Documented default decisions` (the LINES-only-v1 metric, the 300/700/150 budgets, the single
     warn code, the single-story partition, the trailing-newline convention) and the `## Build-time
     obligations` (the `budgets` schema block, the load-bearing module name) have all graduated into
     ADR-001..007 (ARCHITECTURE.md). The `## Feedback (for retro)` calibration note graduated into
     RETROSPECTIVE.md R1 (with the open trim-m02-vs-raise-default-to-750 follow-up). The build/verify
     blow-by-blow lives in VERIFICATION.md. History is preserved there; not duplicated here. -->
