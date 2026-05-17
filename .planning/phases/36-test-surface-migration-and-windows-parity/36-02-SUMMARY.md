---
phase: "36"
plan: "36-02"
subsystem: "integration-tests"
tags:
  - bdd
  - powershell
  - windows
key-files:
  - test/integration/features/boards.feature
  - test/integration/support/cli-context.mjs
  - test/integration/steps/shared-cli.steps.mjs
  - test/integration/cli.ps1
metrics:
  tests: "npm test; npm run test:integration:ps"
---

# Summary 36-02: SDK BDD And PowerShell Parity

## Result

Added explicit SDK fixture BDD setup and SDK-path board scenarios for attach/sync, v1.6 repair, and assignment. Updated the PowerShell runner to propagate SDK fixture env vars, create temp roots with spaces, support the GSD board steps, and run with `-NoProfile`.

## Commits

| Commit | Description |
|--------|-------------|
| c0cc080 | Added SDK BDD siblings and PowerShell runner parity for SDK board flows. |

## Deviations

PowerShell now runs the shared feature suite and therefore covers all SDK board siblings rather than only one smoke scenario. The runner work was already needed to keep the existing shared feature suite green.

## Self-Check

PASSED. Node and PowerShell BDD both exercise named SDK fixtures and persisted `BOARD.json` binding assertions.

