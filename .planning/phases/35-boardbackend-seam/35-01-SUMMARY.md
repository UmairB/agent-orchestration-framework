---
phase: "35"
plan: "35-01"
subsystem: "backends"
tags:
  - backend-seam
  - gsd
key-files:
  - src/backends/index.mjs
  - src/backends/gsd-backend.mjs
  - src/backends/null-backend.mjs
metrics:
  tests: "npm run test:unit; npm test; node scripts/check-sdk-boundary.mjs"
---

# Summary 35-01: Backend Registry And GSD Wrapper

## Result

Created the internal `BoardBackend` registry with a real `gsd` backend and a test-only `null` backend.

## Commits

| Commit | Description |
|--------|-------------|
| 40e2598 | Added `src/backends/`, structured backend errors, GSD adapter wrapper, and deterministic null backend coverage. |

## Deviations

None.

## Self-Check

PASSED. `resolveBackend("gsd")` exposes the strict four-method backend shape, unsupported providers return `BACKEND_UNSUPPORTED`, and `supportedBackends()` hides the test-only null backend from user-facing lists.

