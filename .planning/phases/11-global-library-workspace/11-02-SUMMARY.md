---
phase: 11
plan: 2
subsystem: global-cli
status: complete
key-files:
  - src/cli.mjs
  - src/scaffold.mjs
  - src/config-inspect.mjs
  - test/integration/features/lifecycle.feature
  - test/integration/support/cli-context.mjs
  - test/integration/steps/shared-cli.steps.mjs
---

# Plan 11-02 Summary: Global CLI Asset Operations

## Completed

- Added explicit `aof global ...` command routing.
- Added `aof global add` for global skills, agents, and rules.
- Added `aof global list` and `aof global show`.
- Refactored scaffolding so global assets reuse the `.aof/assets/<kind>/<id>/...` file-backed layout.
- Added BDD coverage using an isolated `AOF_GLOBAL_HOME` test directory.

## Verification

- `npm run test:unit` passed.
- `npm test` passed.

## Deviations

None.

## Self-Check: PASSED

The explicit `aof global ...` namespace is implemented without changing existing project-local `aof add` or runtime-output `--global` behavior.

