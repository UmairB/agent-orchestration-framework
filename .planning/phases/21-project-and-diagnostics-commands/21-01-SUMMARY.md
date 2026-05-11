# Phase 21 Wave 1 Summary: Project Command Namespace

**Status:** Complete
**Date:** 2026-05-11

## Completed

- Added `aof project show`, `aof project validate`, `aof project doctor`, and `aof project migrate`.
- Reused existing inspection, validation, doctor, and migration behavior under the project namespace.
- Updated `aof init` guidance to point to namespaced commands.
- Made init source-only: it creates project `.aof` workspace state and does not prompt to create assets.

## Behavior Notes

- `project` means the current repository's AOF workspace, config, lock state, migration state, and health.
- `aof project migrate` preserves the legacy root config and reports that it was left untouched.

## Verification

- Covered by Node BDD, PowerShell BDD, smoke, and aggregate verification in `21-VERIFICATION.md`.
