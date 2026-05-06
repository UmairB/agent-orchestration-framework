---
last_mapped: 2026-05-06
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
  - `test/paths.test.mjs`
  - `test/prompt.test.mjs`
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
- Applying a legacy config to Codex only.
- Catalog initialization and listing.
- Default catalog item initialization.
- Dry-run install preview.
- Interactive catalog item selection.

## Unit Coverage By Area

- `test/adapters.test.mjs` verifies rendering into Claude and Codex folders and runtime filtering.
- `test/catalog.test.mjs` verifies built-in catalog seed behavior and `itemsToConfig()`.
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

- No schema validation tests for `schemas/aof.schema.json`.
- No tests for file-backed resource body resolution through `path` in `src/dsl.mjs`.
- No tests for `src/frameworks.mjs` command construction except indirect README expectations.
- No tests for setup UI API routes in `src/setup-ui.mjs`.
- No tests for invalid database row JSON or SQLite migration compatibility.
- No coverage reporting is configured.

## Useful Test Additions

- Add unit tests around `loadConfig()` and `resolveConfig()` for invalid kinds, invalid runtimes, file-backed bodies, and package preservation.
- Add tests for `installFramework(..., { dryRun: true })`.
- Add setup UI server tests for `GET /api/items`, valid `POST /api/items`, invalid kind rejection, and malformed JSON handling.
- Add integration scenarios for `aof install gsd --dry-run` and runtime combinations.
