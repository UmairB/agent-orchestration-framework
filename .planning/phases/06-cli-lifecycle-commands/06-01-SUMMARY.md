---
phase: 6
plan: 1
subsystem: cli-diagnostics
tags:
  - cli
  - diagnostics
  - bdd
key-files:
  created:
    - .planning/phases/06-cli-lifecycle-commands/06-01-SUMMARY.md
  modified:
    - src/cli.mjs
    - test/integration/cli.feature
    - test/integration/cli.mjs
requirements-completed:
  - CLI-07
  - CLI-08
completed: 2026-05-07
---

# Phase 6 Plan 1: Top-Level Diagnostics And Lifecycle Help Summary

Top-level lifecycle diagnostics now route through `aof validate` and `aof doctor`, with lifecycle-first help output and strict warning handling.

## What Changed

- Added top-level `validate` and `doctor` command routing in `src/cli.mjs`.
- Reused the existing `validateConfig()` and `doctorConfig()` diagnostic paths instead of duplicating logic.
- Added `--strict` parsing and behavior so warnings can fail diagnostics commands when requested.
- Reorganized help output to present lifecycle commands before supporting commands.
- Extended BDD scenarios for top-level validate/doctor behavior, strict doctor warnings, and lifecycle-first help ordering.
- Added an integration runner assertion for text ordering in stdout.

## Verification

| Command | Result |
|---------|--------|
| `npm run test:unit` | Passed |
| `npm test` | Passed |

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

- `aof validate` and `aof doctor` exist as top-level commands.
- Human-readable output remains the default.
- `--json` remains available.
- `--strict` promotes doctor warnings to failure.
- Existing `aof config show` remains intact.

