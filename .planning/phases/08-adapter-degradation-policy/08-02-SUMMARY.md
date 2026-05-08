---
phase: 8
plan: 2
subsystem: cli-adapter-warning-surfaces
tags:
  - cli
  - adapter-warnings
  - strict-mode
  - bdd
requires:
  - src/adapter-warnings.mjs
provides:
  - validate adapterWarnings JSON
  - doctor adapterWarnings JSON and health check
  - apply/sync strict adapter warning gates
affects:
  - src/adapters.mjs
  - src/cli.mjs
  - src/config-inspect.mjs
  - src/sync.mjs
tech-stack:
  added: []
  patterns:
    - shared warning formatter
    - pre-write strict gate
key-files:
  created: []
  modified:
    - src/adapters.mjs
    - src/cli.mjs
    - src/config-inspect.mjs
    - src/sync.mjs
    - test/config-inspect.test.mjs
    - test/integration/cli.feature
    - test/integration/cli.mjs
key-decisions:
  - Adapter warnings remain separate from structural diagnostics but are exposed at top level in JSON.
  - Unsupported common hook fields skip hook rendering for affected runtimes.
  - `apply --strict` and `sync --strict` fail before file actions, lock writes, or installers.
requirements-completed:
  - ADPT-01
  - ADPT-02
  - ADPT-04
duration: "0 min"
completed: 2026-05-08
---

# Phase 8 Plan 2: CLI Warning Output And Strict Gates Summary

Connected the shared adapter warning model to diagnostics, doctor, apply, and sync command flows.

## Tasks Completed

| Task | Result | Commit |
|------|--------|--------|
| Config inspection warning payload | `inspectConfig()` and `doctorConfig()` now expose `adapterWarnings`; doctor adds an `adapter-degradation` check. | 5777e2b |
| CLI human formatting | Added compact `adapter-warnings:` blocks for validate, doctor, apply, and sync. | 5777e2b |
| CLI JSON output | Added top-level `adapterWarnings` to validate/doctor and dry-run JSON for apply/sync. | 5777e2b |
| Strict gates | `--strict` now fails validate, doctor, apply, and sync when adapter warnings exist; apply/sync return before writes and lock updates. | 5777e2b |
| Render skip behavior | Hooks with unsupported common fields are skipped from runtime config output, matching emitted warnings. | 5777e2b |
| BDD coverage | Added adapter warning scenarios for JSON, warning order, dry-run previews, and strict no-side-effect failure. | 5777e2b |

## Verification

- `npm run test:unit` - passed
- `npm test` - passed

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

All planned command surfaces emit the shared warning objects, and BDD coverage verifies strict mode fails before generated files or lock state are created.
