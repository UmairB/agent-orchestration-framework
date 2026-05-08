---
phase: 12
plan: 1
status: completed
completed: 2026-05-08
---

# Phase 12 Wave 1 Summary: Global Reference Model And Validation

## Completed

- Added top-level `globalRefs` schema support for `{ kind, id }` references.
- Added project validation for global reference shape, duplicate references, missing referenced globals, and local/global `kind:id` conflicts.
- Preserved the Phase 11 boundary: project validation only checks referenced global assets, not unrelated global drafts.
- Added project-aware config loading via `loadProjectConfig()`.
- Added unit coverage for valid references, missing references, conflicts, and schema alignment.

## Verification

- `npm run test:unit` - passed
- `npm test` - passed

## Deviations

None.

## Handoff

Wave 2 uses `loadProjectConfig(configPath, options)` as the shared resolver for apply and sync.

