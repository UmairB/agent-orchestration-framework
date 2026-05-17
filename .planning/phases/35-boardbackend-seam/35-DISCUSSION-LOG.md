# Phase 35 Discussion Log

**Phase:** 35 — BoardBackend Seam
**Date:** 2026-05-17
**Mode:** Autonomous smart discuss

## Accepted Areas

### 1. Backend Seam Shape

User accepted all recommended answers:

- Strict four-method interface: `loadState`, `analyzeRoadmap`, `assertMilestone`, `syncBoardFromMilestone`, plus `kind` and `capabilities`.
- Extract from working Phase 34 code only.
- Unsupported providers fail with `BACKEND_UNSUPPORTED`.
- Minimal BOARD.json reshaping only.

### 2. Backend Registry And Resolution

User accepted all recommended answers:

- Add tiny `resolveBackend(name)` registry with only real `gsd` backend registered.
- Place backend modules under `src/backends/`.
- Capabilities are a `Set` of strings.
- Route `board-execution.mjs` capability gating through the seam while preserving execution behavior.

### 3. Test Backend Scope

User accepted all recommended answers:

- Null backend implements the same four methods with deterministic no-op/test responses.
- Use null backend in unit tests only.
- Export null backend from production code but document it as test-only/unsupported.
- Retest seam-level routing and unsupported capability behavior only.

### 4. Compatibility And Deferral Boundaries

User accepted all recommended answers:

- No observable CLI/API output changes except structured unsupported-backend errors.
- Runtime fallback hardening remains Phase 37.
- No user-facing backend configuration.
- Documentation stays short and code-level; seam is internal and unstable in v1.7.

## Deferred

- Milestone creation fallback belongs to Phase 37.
- Public backend authoring docs and UI backend selection are deferred.
- A second real backend remains out of scope.

