---
phase: 01-aof-workspace-model
plan: 02
subsystem: model
tags: [node, dsl, schema, overrides, capabilities, bdd]
requires:
  - phase: 01-aof-workspace-model
    provides: ".aof workspace paths and migration command"
provides:
  - "Central resource/runtime/capability model"
  - "File-backed asset parsing"
  - "Runtime override parsing and shallow merge semantics"
affects: [phase-2-rendering, phase-4-ui]
tech-stack:
  added: []
  patterns:
    - "Runtime and resource constants live in src/model.mjs"
key-files:
  created: [src/model.mjs, test/model.test.mjs]
  modified: [src/dsl.mjs, src/adapters.mjs, schemas/aof.schema.json, test/adapters.test.mjs, test/integration/cli.feature, test/integration/cli.mjs]
key-decisions:
  - "Capabilities are represented one-by-one in a central model"
  - "Runtime overrides shallow-merge and cannot change id or kind"
patterns-established:
  - "Conventional overrides/<runtime>.json files live beside source assets"
requirements-completed: [ASST-01, ASST-02, ASST-03, ASST-04, ASST-05, RTOV-01, RTOV-02, RTOV-03]
duration: 55min
completed: 2026-05-06
---

# Phase 1 Plan 02: Asset Model And Overrides Summary

**Central AOF model with file-backed assets, runtime capabilities, and shallow runtime overrides**

## Performance

- **Duration:** 55 min
- **Started:** 2026-05-06T15:39:30+01:00
- **Completed:** 2026-05-06T16:34:43+01:00
- **Tasks:** 3
- **Files modified:** 7

## Accomplishments

- Added `src/model.mjs` for runtimes, resource kinds, default source body filenames, capability statuses, and override merge rules.
- Updated `src/dsl.mjs` to support `rule`, file-backed bodies, inline override metadata, and conventional `overrides/claude.json` / `overrides/codex.json`.
- Updated schema to include `rule`, `paths`, and runtime override metadata.
- Added unit and BDD coverage for central capabilities, file-backed assets, valid overrides, and invalid identity override rejection.

## Task Commits

1. **Central model, parser, schema, and override behavior** - `381234c` (feat)

**Plan metadata:** included in this summary commit.

## Files Created/Modified

- `src/model.mjs` - Runtime/resource/capability model and override merge helper.
- `src/dsl.mjs` - Resource validation, body loading, and override loading.
- `schemas/aof.schema.json` - Schema support for `rule`, `paths`, and runtime overrides.
- `test/model.test.mjs` - Unit tests for capability table and override merge policy.
- `test/integration/cli.feature` - BDD scenarios for file-backed and override behavior.

## Decisions Made

None beyond the decisions already locked in `01-CONTEXT.md`.

## Deviations from Plan

The implementation was committed as one cohesive Phase 1 implementation commit. No behavioral deviations from the plan.

**Total deviations:** 1 protocol deviation.
**Impact on plan:** No functional impact.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

Phase 2 can consume the central capability model when expanding rendering and lock-state reproducibility.

---
*Phase: 01-aof-workspace-model*
*Completed: 2026-05-06*
