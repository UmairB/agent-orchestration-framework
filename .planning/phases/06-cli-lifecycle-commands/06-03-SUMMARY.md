---
phase: 6
plan: 3
subsystem: cli-lifecycle
tags:
  - cli
  - sync
  - clean
  - bdd
key-files:
  created:
    - src/sync.mjs
    - src/clean.mjs
    - test/clean.test.mjs
    - .planning/phases/06-cli-lifecycle-commands/06-03-SUMMARY.md
  modified:
    - src/cli.mjs
    - scripts/test-unit.mjs
    - scripts/test.mjs
    - test/integration/cli.feature
    - test/integration/cli.mjs
requirements-completed:
  - CLI-06
  - CLI-09
completed: 2026-05-07
---

# Phase 6 Plan 3: Sync And Clean Lifecycle Commands Summary

`aof sync` and `aof clean` now provide safe lifecycle reconciliation around generated runtime outputs, declared package intent, lock state, installer boundaries, and drifted files.

## What Changed

- Added `src/sync.mjs` to combine render planning, apply actions, lock manifest creation, and framework installer planning.
- Added top-level `aof sync` routing with runtime filters, `--global`, `--force`, `--dry-run`, and explicit `--install`.
- Kept package installers disabled by default during sync while still printing installer commands and next-step guidance.
- Reused the existing framework installer execution path for `aof sync --install`, including simulated status support in tests and lock attempt recording.
- Added `src/clean.mjs` to plan lock-owned generated output cleanup through hash comparison.
- Added top-level `aof clean` routing with dry-run previews.
- Preserved drifted generated files and their lock entries during clean.
- Removed deleted or already-absent generated file entries from lock state while preserving framework intent and install attempts.
- Added unit coverage for clean planning/execution and integration coverage for sync/clean lifecycle flows.

## Verification

| Command | Result |
|---------|--------|
| `npm run test:unit` | Passed |
| `npm test` | Passed |

## Deviations from Plan

- `src/render-plan.mjs` and `test/render-plan.test.mjs` did not need changes because the existing apply planning primitives already supported the sync behavior.
- Missing-lock clean behavior is currently covered through CLI behavior, while focused unit coverage targets matching and drifted lock entries plus framework lock preservation.

## Self-Check: PASSED

- `aof sync --dry-run` prints generated output actions, framework installer commands, and lock preview without writing files or lock state.
- `aof sync` applies generated outputs and writes lock state without running installers by default.
- `aof sync --install` runs through the explicit network-boundary installer path and records attempts.
- `aof clean --dry-run` previews generated file deletion and lock changes without writing.
- `aof clean` deletes only matching lock-owned generated outputs.
- Drifted generated outputs are preserved and remain represented in the lock.
