---
phase: 35
name: BoardBackend Seam
status: complete
requirements:
  - BACK-01
  - BACK-02
  - BACK-03
  - BACK-04
  - BACK-05
---

# Phase 35 Research: BoardBackend Seam

## Existing Code Shape

Phase 34 left a working typed GSD path:

- `src/boards.mjs` owns BOARD.json lifecycle, sync actions, milestone attachment, repair, drift detection, and binding status writes.
- `src/gsd-sdk-adapter.mjs` is the only SDK boundary and exposes `loadGsdState`, `analyzeGsdRoadmap`, `assertMilestone`, and `gsdSdkVersion`.
- `src/board-execution.mjs` still gates assignment with `provider !== "gsd"` and constructs GSD phase commands inline.
- `src/cli.mjs` and `src/setup-ui.mjs` already support structured errors via `toJSON()`.

## Extraction Boundary

The least risky seam is a new `src/backends/` registry that wraps the Phase 33 adapter rather than moving board persistence into backend implementations. The backend interface remains exactly:

- `kind`
- `capabilities`
- `loadState(projectDir, options)`
- `analyzeRoadmap(projectDir, options)`
- `assertMilestone(projectDir, milestoneId, options)`
- `syncBoardFromMilestone(projectDir, milestoneId, options)`

`boards.mjs` still owns BOARD.json writes. The backend owns provider resolution and GSD SDK calls.

## Implementation Notes

- `resolveBackend(name)` should normalize missing names to `gsd`, support only registered backends, and throw `BACKEND_UNSUPPORTED` with `expected` as the supported backend list.
- The real GSD backend should be a thin adapter composition. It can add private metadata to returned roadmap data only if needed by board binding, but the public backend object should stay at the strict interface.
- The null backend is production-exported but documented as test-only and unsupported for user workflows. It exists to prove routing without GSD tools.
- Existing GSD user output must remain byte-compatible except structured unsupported-backend failures.

## Risks

- Over-moving GSD fields out of `board.gsd` would create unnecessary migration scope. Keep BOARD.json shape stable.
- Import cycles are possible if a backend imports `boards.mjs`. Avoid that: backend methods return SDK data only; board lifecycle remains in `boards.mjs`.
- Capability-gating assignment should not change generated GSD commands. Only replace the hard-coded provider check.

