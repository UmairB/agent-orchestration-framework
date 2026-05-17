---
phase: "37"
plan: "37-03"
subsystem: "runtime-fallback"
tags:
  - fallback
  - runtime
  - windows
key-files:
  - src/gsd-runtime-fallback.mjs
  - src/cli.mjs
  - src/setup-ui.mjs
  - test/boards.test.mjs
metrics:
  tests: "npm run test:unit; npm test; npm run test:integration:ps; node scripts/check-sdk-boundary.mjs"
---

# Summary 37-03: Explicit Runtime Fallback

## Result

Renamed `src/gsd-runtime.mjs` to `src/gsd-runtime-fallback.mjs`, updated callers, removed `completedRoadmapPath()` mtime probing, and added loud fallback stderr markers for runtime CLI handoffs.

## Commits

| Commit | Description |
|--------|-------------|
| 3a19584 | Collapsed runtime CLI execution to explicit fallback-only milestone creation and replaced completion probing with `loadGsdState()`. |

## Deviations

No material deviation. Windows shell resolution is retained and documented with a `WINDOWS-FALLBACK` comment.

## Self-Check

PASSED. Boundary checks confirm only the adapter imports `@gsd-build/sdk`, and unit coverage asserts fallback stderr includes `[fallback runtime=<x>]`.
