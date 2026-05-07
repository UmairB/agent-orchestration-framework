# Phase 5: Verification And Hardening - Context

**Gathered:** 2026-05-07T00:00:00+01:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 5 hardens and verifies the completed v1 AOF milestone. It protects existing CLI behavior, expands coverage for `.aof/` config parsing/rendering/runtime overrides/lock state, closes setup UI request/static-serving risks, establishes reliable cross-platform UI build checks, and produces a final verification matrix. It should not add new product capabilities beyond validation, tests, documentation, and hardening of the v1 behavior delivered in Phases 1-4.

</domain>

<decisions>
## Implementation Decisions

### Regression Safety Net
- **D-01:** Phase 5 should run and preserve coverage for all milestone flows, not only Phase 4 changed paths.
- **D-02:** Add explicit regression scenarios for legacy root `aof.config.json`, migration, `.aof/aof.config.json` precedence, and no silent root mutation.
- **D-03:** Add focused child-process smoke tests for real CLI entry/process-boundary behavior while keeping `npm test` primarily in-process.
- **D-04:** Produce a visible final verification matrix mapping requirements to tests/checks and commands run.

### Config And Schema Hardening
- **D-05:** Validation should be strict for invalid core fields but tolerant for extension fields.
- **D-06:** Malformed JSON and unreadable body/override files should produce structured blocking diagnostics with path-specific issues where practical.
- **D-07:** Root config compatibility should be an explicit contract: root-only is legacy input, `.aof` wins when both exist, migration never mutates root, and warnings are clear.
- **D-08:** Add schema alignment tests so key schema enums/fields stay aligned with the central model and supported config shape.

### Setup UI Risk Closure
- **D-09:** Close request validation and static serving risks: malformed JSON, route validation, payload size behavior, path traversal/static file safety, and API error shapes.
- **D-10:** Include lightweight browser smoke testing for the setup UI if feasible; API and build checks remain the fallback.
- **D-11:** Keep but harden older catalog endpoints (`GET/POST /api/items`) rather than removing or deprecating them in v1.
- **D-12:** Treat the local UI as local-only but still defensive: keep binding to `127.0.0.1`, and treat inputs/static paths as untrusted.

### Lock And Generated-Output Confidence
- **D-13:** Prioritize an ownership/drift/prune matrix covering create, update, skip, drift-warning, force overwrite, delete, and stale entries.
- **D-14:** Add cross-kind runtime override coverage across skills, commands, agents, and rules where supported.
- **D-15:** Include framework attempt replay/failure matrix coverage: dry-run, success skip, force rerun, partial failure, and lock replay.
- **D-16:** Add selective golden-style output checks for high-value outputs such as merged Codex `AGENTS.md`, Claude rules, and lock manifest shape.

### Build And Test Command Policy
- **D-17:** Add a cross-platform UI build wrapper that invokes TypeScript and Vite through Node entry points, avoiding Windows dependence on Git Bash utilities.
- **D-18:** Keep `npm test` focused on unit/integration tests and make `npm run check` include the cross-platform UI build.
- **D-19:** Document the wrapper as the primary UI build command and direct TypeScript/Vite Node commands as troubleshooting fallback.
- **D-20:** Successful Phase 5 verification requires the full closeout command set: `npm run test:unit`, `npm test`, the cross-platform UI build, `npm run check`, and the final verification matrix.

### the agent's Discretion
No areas were delegated to the agent's discretion. The user selected concrete decisions for all discussed areas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 5 goal, requirements, success criteria, and milestone boundary.
- `.planning/PROJECT.md` — Product context, source-of-truth decisions, runtime scope, and UI execution boundary.
- `.planning/REQUIREMENTS.md` — VERI-01, VERI-02, and VERI-03 plus v1 requirement traceability.
- `.planning/STATE.md` — Current project state and accumulated memory. Note that STATE may be stale because local `gsd-sdk query` state mutation handlers were unavailable during Phase 4.

### Prior Phase Context
- `.planning/phases/02-runtime-rendering-and-lock-state/02-CONTEXT.md` — Generated-output, lock state, drift, stale pruning, dry-run, and framework intent decisions.
- `.planning/phases/03-cli-and-gsd-framework-flow/03-CONTEXT.md` — Config inspection, GSD install, lock replay, interactive CLI, and network boundary decisions.
- `.planning/phases/04-ui-configuration-editor/04-CONTEXT.md` — UI config editor, runtime override editing, capability display, and no-execution boundary decisions.
- `.planning/phases/04-ui-configuration-editor/04-VERIFICATION.md` — Phase 4 verification result and UI build shim issue.

### Codebase Maps
- `.planning/codebase/TESTING.md` — Current unit, integration, PowerShell, and UI build coverage; known test gaps.
- `.planning/codebase/CONCERNS.md` — Setup UI path handling, request validation, duplicated validation, and coverage concerns.
- `.planning/codebase/CONVENTIONS.md` — Test harness, module style, filesystem helper pattern, CLI option pattern, and UI conventions.
- `.planning/codebase/STRUCTURE.md` — Source/test/UI layout and important paths for future work.

### Current Implementation
- `scripts/test-unit.mjs` — Unit test registry; Phase 5 may add suites here.
- `scripts/test.mjs` — Main in-process unit + integration test entrypoint.
- `package.json` — npm scripts, including `test`, `ui:build`, and `check`.
- `test/integration/cli.feature` — BDD coverage for user-facing CLI behavior.
- `test/integration/cli.mjs` — Node integration runner and in-process/child-process boundary.
- `test/integration/cli.ps1` — PowerShell integration runner.
- `src/config-inspect.mjs` — Config validation and doctor diagnostics.
- `src/config-editor.mjs` — UI config editing load/save/validation helpers from Phase 4.
- `src/setup-ui.mjs` — Local setup UI server and API endpoints.
- `src/render-plan.mjs` — Render action planning, lock manifest creation, drift and stale pruning behavior.
- `src/lock.mjs` — Lock read/write/hash helpers.
- `src/frameworks.mjs` — GSD install planning, execution simulation, skip/force, attempts, and lock replay.
- `src/model.mjs` — Central runtime/resource/capability source of truth.
- `schemas/aof.schema.json` — Config schema that must stay aligned with the central model.
- `ui/package.json` — UI workspace scripts that currently expose the `npm run ui:build` shim issue.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- The custom unit harness accepts exported arrays of `{ name, run }`, making it easy to add targeted hardening suites.
- The BDD integration runner already supports isolated temp projects, in-process execution, external child-process execution, framework status simulation, file assertions, JSON lock assertions, and command input.
- `src/config-inspect.mjs` already emits diagnostics and can be extended toward structured blocking diagnostics.
- `src/config-editor.mjs` centralizes Phase 4 setup UI config editor behavior and is the right place for UI save validation hardening.
- `src/setup-ui.mjs` already binds to `127.0.0.1` and has a body-size guard; Phase 5 should improve validation and error shape without broadening exposure.
- `src/model.mjs` centralizes resource kinds, runtimes, and capabilities; schema alignment tests should compare against it.

### Established Patterns
- New behavior should be verified through focused unit tests plus BDD integration scenarios when user-facing CLI behavior changes.
- Tests use temporary directories and should not touch real app data or assistant runtime folders.
- CLI output is expected to be human-readable by default with JSON modes where already supported.
- UI build verification currently needs direct Node entry points as a fallback due to the Phase 4 Windows npm/Git Bash shim issue.

### Integration Points
- `npm run check` should become the aggregate closeout command once the cross-platform UI build wrapper exists.
- Child-process smoke tests should exercise `bin/aof.mjs` or the real CLI entry without replacing the existing in-process BDD flow.
- Setup UI hardening should cover both new config editor endpoints and older catalog endpoints.
- Final verification should create a Phase 5 verification matrix artifact in `.planning/phases/05-verification-and-hardening/`.

</code_context>

<specifics>
## Specific Ideas

- Treat Phase 5 as the milestone closeout gate, not a feature phase.
- Prefer explicit compatibility contracts over implicit behavior for root config and `.aof` precedence.
- Use selective golden checks only for outputs users inspect and trust: merged Codex `AGENTS.md`, Claude rules, and lock manifest shape.
- Browser smoke testing is desirable but not mandatory if local tooling blocks it; API tests plus TypeScript/Vite build remain the fallback.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 5-Verification And Hardening*
*Context gathered: 2026-05-07T00:00:00+01:00*
