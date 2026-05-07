---
last_mapped: 2026-05-07
focus: quality
---

# Testing

## Summary

The project has a custom lightweight test harness rather than a third-party test framework. Unit tests cover pure module behavior, and integration tests cover CLI behavior through BDD-style feature scenarios.

## Test Commands

- `npm test` runs `node ./scripts/test.mjs`.
- `npm run test:unit` runs `node ./scripts/test-unit.mjs`.
- `npm run test:integration` runs `node ./test/integration/cli.mjs`.
- `npm run test:integration:ps` runs `powershell -ExecutionPolicy Bypass -File ./test/integration/cli.ps1`.
- `npm run check` aliases to `npm test`.
- `npm run ui:build` runs TypeScript build and Vite build for the UI workspace.

## Unit Harness

- `scripts/test-unit.mjs` imports test arrays from:
  - `test/adapters.test.mjs`
  - `test/catalog.test.mjs`
  - `test/clean.test.mjs`
  - `test/config-editor.test.mjs`
  - `test/config-inspect.test.mjs`
  - `test/frameworks.test.mjs`
  - `test/model.test.mjs`
  - `test/paths.test.mjs`
  - `test/prompt.test.mjs`
  - `test/render-plan.test.mjs`
  - `test/schema.test.mjs`
  - `test/setup-ui.test.mjs`
  - `test/workspace.test.mjs`
- Each test entry has a `name` and async or sync `run` function.
- Assertions use Node's built-in `node:assert/strict`.
- Failures print stack traces and set `process.exitCode = 1`.

## Integration Harness

- `test/integration/cli.feature` contains the user-facing scenarios.
- `test/integration/cli.mjs` parses the feature file and executes each scenario in an isolated temp project.
- Each scenario gets a temp project directory and temp data directory.
- The CLI can run as a child process or in process.
- In-process mode is enabled by `AOF_IN_PROCESS_INTEGRATION=1`, which is used by `scripts/test.mjs`.
- `test/integration/cli.ps1` mirrors the feature runner for PowerShell/Windows environments.

## Current Integration Coverage

The BDD feature covers:

- Help text.
- `aof install --no-serve` catalog creation.
- `aof init --items ... --codex` project initialization.
- Refusal to overwrite existing config.
- File-backed `aof add` scaffolding and collision behavior.
- Top-level `aof validate` and `aof doctor` diagnostics.
- Applying a legacy config to Codex only.
- `aof sync` dry-run, apply-only, and explicit installer execution behavior.
- `aof clean` dry-run, lock-owned deletion, and drift preservation behavior.
- Catalog initialization and listing.
- Default catalog item initialization.
- Dry-run install preview.
- Interactive catalog item selection.

## Unit Coverage By Area

- `test/adapters.test.mjs` verifies rendering into Claude and Codex folders and runtime filtering.
- `test/catalog.test.mjs` verifies built-in catalog seed behavior and `itemsToConfig()`.
- `test/clean.test.mjs` verifies cleanup planning, deletion, drift preservation, and framework lock preservation.
- `test/paths.test.mjs` verifies Windows and Linux data directory resolution.
- `test/prompt.test.mjs` verifies item selection and runtime selection parsing.

## Mocking And Isolation

- Tests use temporary directories through `mkdtemp()`.
- Tests clean up with recursive `rm()`.
- Integration tests set `AOF_DATA_DIR` so catalog databases do not touch the user's real app data directory.
- Integration tests set `NODE_NO_WARNINGS=1`.
- Prompt behavior can be driven by `AOF_TEST_SELECTION_INPUT` and `AOF_TEST_RUNTIMES_INPUT`.

## UI Testing

- There are no dedicated UI component tests.
- `npm run ui:build` provides TypeScript and bundling verification.
- The setup UI API is indirectly covered only through CLI install flow starting the server path; endpoint behavior is not currently tested.

## Gaps

- No tests for invalid database row JSON or SQLite migration compatibility.
- No coverage reporting is configured.

## Useful Test Additions

- Add coverage reporting for source and branch-level confidence.
- Add more direct unit coverage for missing-lock and absent-file clean planner branches.
- Add invalid SQLite row and migration compatibility tests.
