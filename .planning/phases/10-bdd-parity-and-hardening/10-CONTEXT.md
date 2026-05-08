# Phase 10: BDD Parity And Hardening - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 10 delivers user-facing regression coverage for the v1.1 aligned-core work. It should make lifecycle commands, expanded DSL primitives, package semantics, adapter degradation behavior, and setup UI API/editor flows traceable through BDD-style scenarios before future runtime expansion or core rewrites.

This phase is about coverage structure, missing BDD scenarios, runner parity, and verification hardening. It is not about adding new product capabilities beyond tests and supporting test infrastructure.

</domain>

<decisions>
## Implementation Decisions

### Coverage Boundary
- **D-01:** Create a phase-local BDD coverage matrix at `.planning/phases/10-bdd-parity-and-hardening/10-BDD-COVERAGE.md`.
- **D-02:** The matrix must map `BDD-01` through `BDD-04` to exact scenario names and mark each requirement `covered`, `partial`, or `missing`.
- **D-03:** Existing BDD scenario names count as evidence. Rename only when a title is misleading.
- **D-04:** Phase 10 should both create the matrix and fill missing scenarios.

### Feature Organization
- **D-05:** Split the monolithic BDD feature file into domain feature files.
- **D-06:** Use domain names for feature files: `lifecycle.feature`, `dsl.feature`, `packages.feature`, `adapter-policy.feature`, and `setup-ui.feature`.
- **D-07:** Give every domain feature file its own step module during Phase 10. Do not leave only skeleton modules.
- **D-08:** Update the Node integration runner to discover and run multiple `.feature` files.
- **D-09:** Update the PowerShell integration runner to mirror the split.

### Setup UI API BDD Scope
- **D-10:** Add BDD-style setup UI API coverage through a dedicated `setup-ui.feature`.
- **D-11:** Drive setup UI BDD through the real local HTTP server, not direct helper calls.
- **D-12:** Prioritize editor save/validate flows: saving resources, saving expanded sections, invalid payload failures, and adapter warning review payloads.
- **D-13:** Do not add browser E2E in Phase 10.

### Cross-Platform Hardening
- **D-14:** Treat the PowerShell integration runner as normal Phase 10 verification.
- **D-15:** Keep `npm test` as the current fast/default verification path. Add or document `npm run test:integration:ps` as a separate required Phase 10 verification command.
- **D-16:** The PowerShell runner should skip cleanly with a clear success message on non-Windows environments.
- **D-17:** Node and PowerShell runners should consume the same shared `.feature` files.

### the agent's Discretion
- Choose the exact internal step module API and fixture-sharing shape, provided every feature domain has its own step module and shared behavior does not become harder to maintain.
- Choose the exact Markdown table layout for `10-BDD-COVERAGE.md`, provided it maps requirements to exact scenario names with `covered`, `partial`, or `missing` status.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 10 goal, success criteria, and requirement mapping.
- `.planning/REQUIREMENTS.md` — `BDD-01` through `BDD-04` definitions.
- `.planning/STATE.md` — current phase state and prior decisions from phases 6-9.

### Codebase Maps
- `.planning/codebase/TESTING.md` — current test commands, unit harness, integration harness, and known testing gaps.
- `.planning/codebase/CONVENTIONS.md` — established test style and CLI/module conventions.
- `.planning/codebase/STRUCTURE.md` — important source/test paths and integration points.

### Current Test Infrastructure
- `test/integration/cli.feature` — current monolithic BDD scenario source to split by domain.
- `test/integration/cli.mjs` — current Node BDD runner and step implementation.
- `test/integration/cli.ps1` — current PowerShell BDD runner and step implementation.
- `scripts/test.mjs` — current aggregate `npm test` behavior.
- `package.json` — test scripts, including `test:integration:ps`.

### Setup UI API
- `src/setup-ui.mjs` — HTTP server routes for setup UI API BDD scenarios.
- `test/setup-ui.test.mjs` — existing HTTP-style setup UI API coverage to translate into BDD scenarios where useful.
- `src/config-editor.mjs` — setup UI config editor save/validate behavior exercised by API routes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/integration/cli.mjs`: already parses Gherkin-like feature text, creates isolated temp projects, supports in-process CLI execution, and has broad fixture/assertion helpers.
- `test/integration/cli.ps1`: mirrors much of the Node runner for Windows and currently points at a single `cli.feature`.
- `test/setup-ui.test.mjs`: already starts `serveSetupUi()` on port `0` and exercises HTTP endpoints with temp project directories.
- `scripts/test.mjs`: already runs unit tests then imports the Node integration runner with `AOF_IN_PROCESS_INTEGRATION=1`.

### Established Patterns
- Integration scenarios are user-facing and live in `.feature` files.
- Unit tests export arrays of `{ name, run }`; integration runners produce `ok - ...` / `not ok - ...` output.
- Tests use temp project/data directories and avoid touching user app data by setting `AOF_DATA_DIR`.
- CLI installer execution is simulated with `AOF_TEST_FRAMEWORK_INSTALL_STATUS`.
- Prompt behavior is driven with environment variables for deterministic tests.

### Integration Points
- Multi-feature discovery affects both `test/integration/cli.mjs` and `test/integration/cli.ps1`.
- Full per-feature step modules will likely require shared fixture/assertion utilities to avoid duplicating setup code.
- Setup UI BDD should connect through `serveSetupUi()` and real HTTP requests, following existing setup UI unit test patterns.
- Verification documentation must include `npm test` and `npm run test:integration:ps`; `npm test` should not be expanded to include the PowerShell runner.

</code_context>

<specifics>
## Specific Ideas

- The BDD coverage matrix should be the planning anchor for identifying gaps before adding scenarios.
- Split feature names are decided: `lifecycle.feature`, `dsl.feature`, `packages.feature`, `adapter-policy.feature`, and `setup-ui.feature`.
- Phase 10 should favor shared `.feature` files consumed by both Node and PowerShell instead of maintaining separate scenario text.

</specifics>

<deferred>
## Deferred Ideas

- Browser-driven setup UI E2E is deferred. Phase 10 covers setup UI API/editor flows through HTTP.
- Making PowerShell integration part of `npm test` is deferred. It remains a separate required verification command for this phase.

</deferred>

---

*Phase: 10-BDD Parity And Hardening*
*Context gathered: 2026-05-08*
