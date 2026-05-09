# Phase 16 Wave 1 Summary: Empty Repo Init Hardening

**Date:** 2026-05-09
**Status:** Complete

## Finding

Live testing `aof init --codex` in a new repository exposed two bad first-run behaviors:

- Node printed an experimental SQLite warning because AOF initialized `node:sqlite`.
- AOF prompted for seeded built-in repo defaults (`project-context`, `prime`, `code-reviewer`, `gsd`) even though the current product model should use explicit project assets and reusable global assets.

## Changes

- Removed the SQLite-backed catalog implementation for now.
- Disabled built-in repo defaults.
- Changed `aof init --codex` to create an empty `.aof` project workspace.
- Made catalog-backed init flags fail with an explicit message.
- Made `aof catalog ...` fail with an explicit disabled-catalog message.
- Marked `install --interactive` as pending redesign.
- Added Phase 17 context for a future keyboard-driven interactive CLI.

## Verification

- `npm run test:unit` passed.
- `npm test` passed.
- `npm run test:integration:ps` passed.
- Manual empty-repo smoke: `node ...\bin\aof.mjs init --codex` created an empty `.aof` config without SQLite warnings.
