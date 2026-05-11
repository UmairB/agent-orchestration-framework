# Phase 19 Wave 2 Summary: Assets Apply Validate Clean And UI

**Status:** Complete
**Completed:** 2026-05-10

## Implemented

- Added `aof assets apply` for asset rendering, lock state, adapter warnings, strict mode, dry-run previews, drift protection, and global references.
- Changed `assets apply` default runtime selection to use `.aof/aof.config.json` runtimes unless runtime flags narrow the run.
- Rejected legacy `--install` and global runtime-output flags on `assets apply`; package execution belongs to the packages namespace and global source reuse flows through project references.
- Added `aof assets validate`, including `--global` validation for the reusable asset library.
- Added `aof assets clean` using existing lock-owned cleanup and drift preservation.
- Moved setup UI launch to `aof assets ui`.
- Removed catalog/SQLite initialization from normal setup UI launch by allowing `serveSetupUi(null, ...)`.
- Rejected old `aof apply`, `aof sync`, `aof clean`, and `aof install` with replacement guidance and no side effects.

## Coverage

- Rewrote asset rendering, validation, clean, adapter warning, and DSL BDD scenarios to use `aof assets ...`.
- Converted old install/sync package execution scenarios into removed-command checks pending Phase 20 package namespace work.

## Deferred

- `aof packages add/install/validate` is intentionally deferred to Phase 20.
- UI execution of apply/install remains out of scope.
