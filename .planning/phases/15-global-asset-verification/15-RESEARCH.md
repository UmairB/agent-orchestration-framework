# Phase 15 Research: Global Asset Verification

**Date:** 2026-05-09
**Status:** Complete

## Verification Inputs

- Phase 11 verification covers global workspace path helpers, `aof global add/list/show/validate`, malformed global diagnostics, and global config path behavior.
- Phase 12 verification covers `globalRefs`, missing/conflicting references, apply/sync rendering of referenced globals, runtime overrides, and lock source scope.
- Phase 13 verification covers explicit `files`, associated-file validation, skill helper rendering, dry-run visibility, lock ownership, and drift protection.
- Phase 14 verification covers scoped setup UI APIs, Project / Global UI behavior, global asset editing, project reference add/remove, and global skill helper editing.

## Current Test Evidence

- `npm run test:unit` covers module-level behavior for workspace paths, config inspection, DSL resolution, render planning, setup UI API helpers, and schema/model alignment.
- `npm test` covers unit tests plus Node BDD scenarios across lifecycle, DSL, packages, adapter policy, and setup UI API.
- `npm run ui:build` covers TypeScript and Vite build for the setup UI.
- `npm run test:integration:ps` runs the shared feature suite through the PowerShell integration wrapper.

## Likely Coverage Matrix Rows

- GLIB-01..04: workspace path tests, global CLI BDD, validation tests.
- GREF-01..04: config inspection tests, lifecycle BDD, lock/source metadata tests.
- GRND-01..04: render/apply/sync BDD, render-plan lock tests, runtime override tests.
- CODE-01..03: config-inspect tests, render-plan tests, lifecycle BDD.
- GUI-01..04: setup UI API tests, setup-ui BDD, UI build.
- TEST-01..03: aggregate verification command evidence and matrix.

## Planning Implication

Start with a matrix/audit wave. If the matrix finds gaps, add only targeted tests. If not, execute the full verification command set and produce closeout artifacts.

