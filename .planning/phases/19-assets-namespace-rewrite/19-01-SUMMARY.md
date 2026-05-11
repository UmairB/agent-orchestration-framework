# Phase 19 Wave 1 Summary: Assets Source Command Namespace

**Status:** Complete
**Completed:** 2026-05-10

## Implemented

- Added `aof assets add`, `list`, `show`, `remove`, `use`, and `unuse` routing.
- Moved project asset scaffolding to `aof assets add skill|command|rule|agent`.
- Moved global asset scaffolding to `aof assets add --global skill|rule|agent`.
- Added project/global list and show output, including JSON output.
- Added source removal for project and global assets without deleting generated runtime outputs.
- Added project global-reference management through `aof assets use --global` and `aof assets unuse --global`.
- Rejected old `aof add` and `aof global ...` with replacement guidance and no side effects.

## Coverage

- Added BDD scenarios for project asset creation, interactive project/global creation, global list/show, source removal, and global reference use/unuse.
- Added removed-command BDD coverage for old source commands.

## Deferred

- Package namespace work remains Phase 20.
- Project namespace cleanup remains Phase 21.
