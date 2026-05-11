# Phase 20 Wave 2 Summary: Packages Install And Lock Replay

**Status:** Complete
**Completed:** 2026-05-10

## Implemented

- Added `aof packages install gsd` using the existing GSD installer planning and execution path.
- Added `aof packages install` to install all configured installable packages; v1.4 installable package support is GSD only.
- Added `aof packages install --from-lock` for lock replay.
- Preserved dry-run output that previews installer commands without network execution or lock writes.
- Preserved explicit network/package-code boundary output for non-dry-run installs.
- Preserved simulated installer statuses and framework install attempt lock metadata.
- Rejected unsupported arbitrary package installer ids instead of running generic `npx`.

## Coverage

- Added BDD coverage for GSD install dry-run, all-configured dry-run, successful simulated install, partial failure/retry output, and from-lock dry-run replay.
- Kept old `install` and `sync --install` removed-command coverage.

## Deferred

- Non-GSD installer semantics remain out of scope.
- Package uninstall/runtime cleanup remains out of scope.
