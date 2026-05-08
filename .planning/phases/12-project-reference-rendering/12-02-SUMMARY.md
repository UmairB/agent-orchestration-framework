---
phase: 12
plan: 2
status: completed
completed: 2026-05-08
---

# Phase 12 Wave 2 Summary: Apply And Sync Global Reference Rendering

## Completed

- Routed `aof apply` through `loadProjectConfig()` so referenced globals render with local resources.
- Routed `aof sync` through the same resolver so dry-run, writes, adapter warnings, and lock previews include referenced globals.
- Preserved runtime-output `--global` semantics.
- Honored runtime overrides declared on global assets.
- Added BDD scenarios proving referenced globals render without copying source files into project `.aof/assets`.

## Verification

- `npm run test:unit` - passed
- `npm test` - passed

## Deviations

None.

## Handoff

Wave 3 completed lock source metadata and diagnostics on top of the resolved resource source metadata.

