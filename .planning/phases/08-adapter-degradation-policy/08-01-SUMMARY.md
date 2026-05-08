---
phase: 8
plan: 1
subsystem: adapter-warning-model
tags:
  - adapter-warnings
  - diagnostics
  - strict-mode-foundation
requires: []
provides:
  - src/adapter-warnings.mjs
affects:
  - scripts/test-unit.mjs
  - scripts/test.mjs
tech-stack:
  added: []
  patterns:
    - pure command-time analyzer
    - stable warning object shape
key-files:
  created:
    - src/adapter-warnings.mjs
    - test/adapter-warnings.test.mjs
  modified:
    - scripts/test-unit.mjs
    - scripts/test.mjs
key-decisions:
  - Adapter warnings are computed by a shared pure analyzer and are not lock state.
  - Existing Codex rule guidance remains intentionally supported mapped output and emits no warning.
  - Runtime-specific extension objects remain silent for non-matching runtimes.
requirements-completed:
  - ADPT-01
  - ADPT-02
  - ADPT-03
  - ADPT-04
duration: "0 min"
completed: 2026-05-08
---

# Phase 8 Plan 1: Shared Adapter Warning Model Summary

Implemented the shared adapter warning model that later CLI, doctor, and UI surfaces can consume without duplicating policy logic.

## Tasks Completed

| Task | Result | Commit |
|------|--------|--------|
| Shared warning constants and object shape | Added `ADAPTER_WARNING_CODES`, `adapterWarning()`, stable object fields, and deterministic sorting. | 34d291e |
| Analyzer entry point | Added `collectAdapterWarnings(config, options)` for normalized configs and requested runtimes. | 34d291e |
| Degradation policy encoding | Covered unsupported hook fields, skipped project doc targets, top-level setting gaps, lossy Codex agent model fallback, silent runtime extensions, and no-warning Codex rule guidance. | 34d291e |
| Generated paths | Added deterministic portable generated paths for settings, hooks, project docs, and Codex agent fallbacks. | 34d291e |
| Focused tests | Added `test/adapter-warnings.test.mjs` and registered it in unit/full test runners. | 34d291e |

## Verification

- `npm run test:unit` - passed

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check: PASSED

The analyzer is pure, warnings are not persisted to lock manifests, and unit tests cover the planned policy cases.
