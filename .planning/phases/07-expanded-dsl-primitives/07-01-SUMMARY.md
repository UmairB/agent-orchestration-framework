---
phase: 7
plan: 1
subsystem: dsl-model
tags:
  - dsl
  - validation
  - schema
key-files:
  created:
    - test/dsl-primitives.test.mjs
    - .planning/phases/07-expanded-dsl-primitives/07-01-SUMMARY.md
  modified:
    - src/model.mjs
    - src/dsl.mjs
    - src/config-inspect.mjs
    - schemas/aof.schema.json
    - scripts/test-unit.mjs
    - scripts/test.mjs
    - test/model.test.mjs
    - test/schema.test.mjs
requirements-completed:
  - DSL-01
  - DSL-02
  - DSL-03
  - DSL-04
  - DSL-05
completed: 2026-05-07
---

# Phase 7 Plan 1: Expanded DSL Model And Validation Summary

The `.aof/aof.config.json` model now accepts and validates top-level `mcpServers`, `hooks`, `projectDocs`, and `settings` sections while preserving existing `resources[]` behavior.

## What Changed

- Added shared model constants for MCP transports, hook events, hook types, project doc targets, and trust modes.
- Extended `resolveConfig()` to normalize expanded primitive sections.
- Added project doc body resolution from file-backed `path` entries.
- Added validation for expanded sections in `src/config-inspect.mjs`.
- Extended `schemas/aof.schema.json` with expanded primitive definitions.
- Added schema/model alignment coverage for the new enums.
- Added `test/dsl-primitives.test.mjs` for normalization, v1 compatibility, and diagnostics.

## Verification

| Command | Result |
|---------|--------|
| `npm run test:unit` | Passed |
| `npm test` | Passed |

## Deviations from Plan

None - plan executed as written.

## Self-Check: PASSED

- Existing resource configs still load unchanged.
- Expanded sections normalize to predictable arrays/objects.
- Invalid expanded primitive fields produce targeted diagnostics.
- Schema and model constants stay aligned.
