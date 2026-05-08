# Phase 10 Patterns: BDD Parity And Hardening

## Existing Patterns To Preserve

### Custom BDD Runner

- `test/integration/cli.mjs` parses a small Gherkin-like syntax instead of relying on a third-party BDD framework.
- Scenario output uses `ok - Feature: Scenario` and `not ok - Feature: Scenario`.
- The runner aggregates failures through `process.exitCode`.
- `scripts/test.mjs` imports the runner with `AOF_IN_PROCESS_INTEGRATION=1` for fast full-suite verification.

### Isolated Test Projects

- Integration scenarios create temp project and data directories.
- `AOF_DATA_DIR` isolates catalog/database writes from user app data.
- Scenario cleanup removes temp directories in `finally`.
- CLI subprocess and in-process modes are both supported.

### Step Style

- Steps are plain text strings matched by regex or exact string checks.
- Fixture setup steps write `.aof/aof.config.json` and file-backed assets directly in temp directories.
- Command steps call `aof` with deterministic environment variables for selection, runtime, confirmation, and framework installer status.
- Assertions read stdout/stderr, generated files, and lock JSON directly.

### Setup UI HTTP Tests

- `test/setup-ui.test.mjs` starts `serveSetupUi()` on port `0`.
- Test catalog stubs provide `listItems()` and `upsertItem()`.
- Tests use `fetch()` against real HTTP routes and close the server in `finally`.
- This is the preferred source pattern for `setup-ui.feature`.

## Planning Implications

- Prefer extracting runner support modules over adopting a new BDD dependency.
- Keep shared helper code small and boring: feature parsing, context lifecycle, CLI execution, HTTP setup UI server lifecycle, and assertions.
- Domain step modules should use shared helpers rather than duplicate temp directory and assertion logic.
- The PowerShell runner should consume the same `.feature` files to avoid scenario drift.
- The coverage matrix should reference scenario names exactly as emitted by the runner.
