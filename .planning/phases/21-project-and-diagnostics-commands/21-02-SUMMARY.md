# Phase 21 Wave 2 Summary: Removed Project Config And Catalog Paths

**Status:** Complete
**Date:** 2026-05-11

## Completed

- Removed execution routes for top-level `validate`, `doctor`, and `migrate`.
- Removed execution routes for `config show`, `config validate`, and `config doctor`.
- Kept `catalog` removed with an unsupported-product-path message and project/global asset guidance.
- Removed the unreachable catalog command body from `src/cli.mjs`.

## Behavior Notes

- Removed commands are failures, not aliases.
- Removed command failures do not inspect config, write files, render assets, install packages, or initialize catalog storage.
- Catalog commands do not import SQLite-backed catalog behavior or create catalog data files.

## Verification

- Covered by removed-command BDD scenarios and child-process smoke checks in `21-VERIFICATION.md`.
