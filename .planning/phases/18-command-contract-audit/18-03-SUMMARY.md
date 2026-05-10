# Phase 18 Plan 18-03 Summary: Help, Errors, And BDD Contract

**Status:** Complete
**Completed:** 2026-05-10

## Result

Created `.planning/phases/18-command-contract-audit/18-BDD-CONTRACT.md` and expanded `.planning/phases/18-command-contract-audit/18-CLI-CONTRACT.md` with help and output contracts.

## BDD Coverage Expectations

The BDD contract covers:

- Help grouped by product area.
- Removed commands failing without execution or aliasing.
- `aof init` creating only project workspace state.
- Project namespace commands.
- Project and global assets namespace commands.
- Asset apply default runtime behavior and runtime narrowing.
- Asset UI launch.
- Package add/install/list/show/validate.
- Package lock replay.
- No SQLite/catalog side effects.
- PowerShell parity expectations.

## Residual Risks

- Some target commands such as `assets remove`, `assets use`, `assets unuse`, and package inspection/removal do not currently exist as CLI behavior. Later implementation phases must decide exact mutation safety and config editing mechanics while preserving this contract.
- `assets ui --no-serve` was not included in the accepted contract. If needed later, it should be designed explicitly rather than inherited from `install --no-serve`.

## Verification

- Cross-checked BDD contract against `18-CLI-CONTRACT.md`.
- Cross-checked both documents against `18-CONTEXT.md` decisions D-01 through D-37.
