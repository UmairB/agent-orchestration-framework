---
phase: "37"
plan: "37-01"
subsystem: "gsd-sdk-runner"
tags:
  - sdk
  - execution
  - adapter
key-files:
  - src/gsd-sdk-adapter.mjs
  - test/gsd-sdk-adapter.test.mjs
metrics:
  tests: "npm run test:unit; node scripts/check-sdk-boundary.mjs"
---

# Summary 37-01: SDK Phase Runner Adapter

## Result

Added `runGsdPhase()` to the SDK adapter, including runner surface probing, typed `GSD.runPhase()` invocation, injected fake runner support, and `GSD_PHASE_FAILED` wrapping for failed `PhaseRunnerResult` values.

## Commits

| Commit | Description |
|--------|-------------|
| 3a19584 | Added SDK phase execution, runner surface checks, and failed-plan subtype extraction. |

## Deviations

No material deviation. The adapter returns successful SDK results unchanged and wraps failed results only when `success === false`.

## Self-Check

PASSED. Unit coverage proves successful injected runs, failed plan subtype propagation, and SDK runner surface mismatch detection.
