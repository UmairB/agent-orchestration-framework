# Phase 10 Research: BDD Parity And Hardening

## Research Complete

Phase 10 is primarily test infrastructure and coverage hardening. The current codebase already has a custom BDD-style integration runner, enough scenario coverage to preserve existing behavior, and setup UI HTTP tests that can be translated into BDD-style scenarios.

## Current Test Architecture

- `npm run test:unit` runs `scripts/test-unit.mjs`, which imports arrays of `{ name, run }` objects from unit test modules.
- `npm test` runs `scripts/test.mjs`, which runs unit tests and then imports `test/integration/cli.mjs` with `AOF_IN_PROCESS_INTEGRATION=1`.
- `test/integration/cli.feature` is the single monolithic feature file today.
- `test/integration/cli.mjs` parses Gherkin-like text, runs each scenario in an isolated temp project/data directory, and supports either child-process CLI runs or in-process CLI runs.
- `test/integration/cli.ps1` mirrors a subset of the Node runner and points at the same `cli.feature`.
- `test/setup-ui.test.mjs` already drives `serveSetupUi()` over real HTTP on port `0`.

## Existing BDD Coverage

Existing scenarios already cover much of Phase 6 through Phase 9 behavior:

- Lifecycle: init, add, migrate, apply, sync, validate, doctor, clean, install, catalog, interactive flows.
- Expanded DSL: MCP, hooks, project docs, settings, runtime overrides, rules, Codex AGENTS merges.
- Adapter policy: warning output, JSON warning payloads, strict-mode failure before writes.
- Package semantics: framework intent, install dry-run, install attempts, replay from lock, sync behavior, package output conflicts.

The gap is not absence of scenarios. The gap is traceability and maintainability:

- Requirements `BDD-01` through `BDD-04` are not mapped to exact scenario evidence.
- The monolithic feature and step runner make it harder to see whether lifecycle, DSL, package, adapter, and setup UI coverage remain balanced.
- PowerShell coverage is not integrated with the split-domain plan yet.
- Setup UI API coverage exists as unit tests but not as user-facing BDD scenarios.

## Recommended Structure

Use a custom multi-feature runner instead of introducing a third-party BDD package. This preserves current project conventions and avoids dependency churn.

Recommended Node layout:

- `test/integration/features/lifecycle.feature`
- `test/integration/features/dsl.feature`
- `test/integration/features/packages.feature`
- `test/integration/features/adapter-policy.feature`
- `test/integration/features/setup-ui.feature`
- `test/integration/support/feature-runner.mjs`
- `test/integration/support/cli-context.mjs`
- `test/integration/support/assertions.mjs`
- `test/integration/steps/lifecycle.steps.mjs`
- `test/integration/steps/dsl.steps.mjs`
- `test/integration/steps/packages.steps.mjs`
- `test/integration/steps/adapter-policy.steps.mjs`
- `test/integration/steps/setup-ui.steps.mjs`

Recommended PowerShell layout mirrors the same shared `.feature` files:

- `test/integration/cli.ps1` discovers `test/integration/features/*.feature`.
- `test/integration/steps/*.ps1` or equivalent per-domain dispatch files implement domain steps.
- The script exits successfully with a clear skip message on non-Windows platforms.

## Coverage Matrix

Create `.planning/phases/10-bdd-parity-and-hardening/10-BDD-COVERAGE.md` first and keep it updated during implementation.

Minimum columns:

- Requirement
- Status (`covered`, `partial`, `missing`)
- Scenario evidence
- Gap to close
- Plan/wave

This matrix should be phase-local because it is a planning and verification artifact, not a permanent test README.

## Setup UI API BDD

Translate the most important existing HTTP tests into BDD-style scenarios:

- Saving a command/resource through `PUT /api/config/resources/:kind/:id`.
- Rejecting malformed JSON and route/payload mismatches.
- Saving expanded sections through `PUT /api/config/sections`.
- Returning adapter warnings from config save/load payloads.

Do not add browser E2E in this phase. The value here is API/editor behavior parity, not frontend interaction testing.

## Verification Implications

Final Phase 10 verification should include:

- `npm run test:unit`
- `npm test`
- `npm run test:integration:ps`

`npm test` should not be expanded to include PowerShell. Keep PowerShell as a separate required phase verification command.

## Risks And Mitigations

- **Risk: Feature split breaks existing coverage.** Mitigate by moving scenarios domain by domain and running `npm test` after each split.
- **Risk: Step module duplication.** Mitigate with shared support modules for temp directories, CLI execution, JSON/file assertions, and feature parsing.
- **Risk: PowerShell runner drifts from Node behavior.** Mitigate by consuming the same `.feature` files and using the same scenario names.
- **Risk: Setup UI HTTP scenarios leave servers open.** Mitigate by following `test/setup-ui.test.mjs`: use port `0`, close servers in `finally`, and remove temp directories.
- **Risk: Coverage matrix goes stale during implementation.** Mitigate by making the matrix update part of each plan's acceptance criteria and final verification.
