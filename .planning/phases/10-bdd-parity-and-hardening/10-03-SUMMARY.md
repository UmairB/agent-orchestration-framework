# Phase 10 Wave 3 Summary: Setup UI API BDD

## Completed

- Added `test/integration/features/setup-ui.feature` with real HTTP API scenarios for:
  - Capability payload and resource save.
  - Expanded section save for MCP servers, hooks, project docs, and settings.
  - Invalid expanded section diagnostics.
  - Malformed JSON, route/payload mismatch, and unsupported route kind failures.
  - Adapter warning review payloads.
- Added `test/integration/support/setup-ui-context.mjs` to start `serveSetupUi()` on port `0` and close the server during scenario cleanup.
- Added `test/integration/steps/setup-ui.steps.mjs` for setup UI API request and response assertions.
- Registered `setup-ui.feature` in the shared Node integration runner.
- Updated `10-BDD-COVERAGE.md` to mark BDD-02 covered for Node CLI and setup UI HTTP API/editor behavior.

## Verification

- `npm run test:integration` passed.
- `npm run test:unit` passed.
- `npm test` passed.

## Deferred

- Browser E2E remains intentionally out of scope.
- PowerShell parity remains for the final wave.
