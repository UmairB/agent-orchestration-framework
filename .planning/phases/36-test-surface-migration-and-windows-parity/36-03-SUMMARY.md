---
phase: "36"
plan: "36-03"
subsystem: "migration-and-fingerprints"
tags:
  - migration
  - line-endings
  - fingerprints
key-files:
  - test/fixtures/v1-6-board.json
  - test/fixtures/v1-6-board-tasks/phase-30.json
  - test/fixtures/v1-6-board-tasks/phase-31.json
  - src/boards.mjs
  - .gitattributes
metrics:
  tests: "npm run test:unit; npm test; npm run test:integration:ps"
---

# Summary 36-03: v1.6 Migration Fixture And Fingerprint Stability

## Result

Added canonical v1.6 board/task fixtures, BDD coverage for happy auto-bind and ambiguous no-guess repair paths, `.gitattributes` line-ending policy, and runtime CRLF-to-LF normalization for board index fingerprints.

## Commits

| Commit | Description |
|--------|-------------|
| c0cc080 | Added v1.6 migration fixtures, BDD migration scenarios, line-ending policy, and fingerprint parity coverage. |

## Deviations

None.

## Self-Check

PASSED. The migration fixture syncs through the same CLI route users run, and the unit test proves CRLF/LF differences do not change board index fingerprints.

