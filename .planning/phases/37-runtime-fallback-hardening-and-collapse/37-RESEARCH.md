---
phase: 37
name: Runtime Fallback Hardening And Collapse
status: complete
requirements:
  - EXEC-01
  - EXEC-02
  - EXEC-03
  - EXEC-04
---

# 37 Research: Runtime Fallback Hardening And Collapse

## Findings

- SDK 0.1.0 exposes `GSD.runPhase(phaseNumber, options?)` from `@gsd-build/sdk/dist/index.d.ts`; it returns `PhaseRunnerResult` with `{phaseNumber, phaseName, steps, success, totalCostUsd, totalDurationMs}`.
- `PlanResult.error.subtype` is available on failed plan results and carries values such as `error_max_turns` and `error_during_execution`.
- `src/board-execution.mjs::assignTaskToAgent()` currently creates a `running` execution record with command strings only. It is the right insertion point for SDK phase execution because it already owns execution records and task status summaries.
- `src/gsd-runtime.mjs` is still milestone-fallback code. It imports `stat` only for `completedRoadmapPath()` mtime probing, so removing that helper also removes the `stat` dependency.
- `continueGsdMilestone()` is imported by `src/cli.mjs` and `src/setup-ui.mjs`; test prompt helpers are imported by `test/boards.test.mjs`. The rename must update all three.

## Constraints

- Tests must not invoke real `GSD.runPhase()`; use injected fake runners.
- The existing boards UI consumes `task.execution` summaries, so the summary shape should remain stable.
- Runtime fallback must keep Windows-specific spawn behavior.
- Doctor/version-drift diagnostics stay Phase 38.

