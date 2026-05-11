# Phase 21 Wave 3 Summary: Project Namespace Help Docs And Parity Hardening

**Status:** Complete
**Date:** 2026-05-11

## Completed

- Updated CLI help to show `init`, `Project`, `Assets`, and `Packages` sections.
- Removed help/docs examples for top-level `migrate`, top-level `validate`, top-level `doctor`, `config`, and `catalog`.
- Updated README project diagnostics and adapter warning examples to use `aof project ...`.
- Updated Node BDD, PowerShell BDD, and child-process smoke coverage for project commands and removed command failures.
- Added BDD step parity for asserting catalog data files are not created.

## Verification

- `npm run test:unit` - passed
- `npm run test:integration` - passed
- `npm run test:integration:ps` - passed
- `npm run test:smoke:cli` - passed
- `npm run ui:build` - passed
- `npm test` - passed
