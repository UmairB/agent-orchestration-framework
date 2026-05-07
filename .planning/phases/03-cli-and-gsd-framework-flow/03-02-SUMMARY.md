# Phase 3 Wave 2 Summary: Config-Aware GSD Install, Attempt Recording, And Lock Replay

**Completed:** 2026-05-07
**Status:** Complete

## Implemented

- Added pure GSD framework install planning in `src/frameworks.mjs`.
- `aof install gsd` resolves managed package intent from `.aof/aof.config.json`.
- CLI flags can override runtimes, scope, and package source for one run.
- `aof install gsd --dry-run` prints exact commands and performs no writes or network execution.
- Real installer execution prints a network/npm boundary before each runtime command.
- Framework install attempts are recorded in `.aof/aof.lock.json` without losing render lock data.
- Successful prior installs are skipped by default and rerun with `--force`.
- Partial failures record successes and failures, fail overall, and print retry commands.
- Added `aof install --from-lock` and dry-run replay from lock framework intent.
- Added test-only simulated framework execution via `AOF_TEST_FRAMEWORK_INSTALL_STATUS` so tests never run npm.

## Tests

- Added `test/frameworks.test.mjs`.
- Extended BDD coverage for dry-run commands, config-declared package intent, simulated success/failure, skip policy, retry commands, attempt records, and replay preview.
- Verified through `npm run test:unit` and `npm test`.

## Residual Notes

- Attempt records are audit history, not a guarantee that external installer output still exists.

