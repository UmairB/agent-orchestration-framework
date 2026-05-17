---
phase: "38"
plan: "38-01"
subsystem: "board-doctor"
tags:
  - boards
  - diagnostics
  - migration
key-files:
  - src/boards.mjs
  - src/cli.mjs
  - test/boards.test.mjs
  - test/integration/features/boards.feature
metrics:
  tests: "npm run test:unit; npm test"
---

# Summary 38-01: Board Doctor And Migration Diagnostics

## Result

Added `aof boards doctor [board-id] [--json]` with a read-only pass/warn/fail ladder over board state, GSD state, milestone binding, roadmap analysis, cached phase/task consistency, and v1.6 missing milestone-id migration hints.

## Commits

| Commit | Description |
|--------|-------------|
| 387e20e | Adds board doctor implementation, CLI route, help text, unit coverage, and BDD coverage. |

## Deviations

The doctor reuses `assertBoardMilestone()` rather than calling the backend assertion directly so CLI-safe milestone forms like `v1-7` normalize the same way sync/attach already do.

## Self-Check

PASSED. `npm run test:unit` and `npm test` pass with healthy synced board and v1.6 migration hint coverage.
