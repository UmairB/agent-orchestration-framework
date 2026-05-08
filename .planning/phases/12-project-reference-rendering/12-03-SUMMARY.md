---
phase: 12
plan: 3
status: completed
completed: 2026-05-08
---

# Phase 12 Wave 3 Summary: Global Reference Diagnostics And Lock Traceability

## Completed

- Added source metadata to rendered resource lock entries, including `scope: "global"` for referenced global assets.
- Updated render-plan conflict descriptions to distinguish global resources from local and package outputs.
- Extended config inspection output and human `config show` output with global reference/source information.
- Added BDD coverage for lock source scope, config inspection, missing references, local/global conflicts, apply, and sync.
- Documented `globalRefs` syntax, no-copy semantics, global override rendering, and associated-file deferral in `README.md`.

## Verification

- `npm run test:unit` - passed
- `npm test` - passed

## Deviations

None.

## Handoff

Phase 13 should build on the global source metadata to preserve associated helper/code files owned by global asset directories.

