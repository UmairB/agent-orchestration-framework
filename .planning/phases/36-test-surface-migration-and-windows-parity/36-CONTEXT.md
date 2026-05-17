# Phase 36: Test Surface Migration And Windows Parity - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Land the v1.7 verification surface for the typed GSD SDK board path: captured fixture replay, adapter-boundary test doubles, SDK-path BDD scenarios, Windows PowerShell parity, a v1.6 board migration regression fixture, and cross-OS line-ending/fingerprint stability. This phase proves the Phase 33-35 SDK and backend work through tests; it must not implement Phase 37 fallback behavior or Phase 38 doctor diagnostics early.

</domain>

<decisions>
## Implementation Decisions

### Fixture Harness Shape
- **D-01:** `MockGSDTools` should replay raw captured fixture files from `test/fixtures/gsd-sdk/<scenario>/`, while allowing small scenario overrides for edge cases such as milestone mismatch, empty phases, or tool errors. Do not require a full captured directory for every tiny mutation.
- **D-02:** Add `AOF_TEST_GSD_SDK_FIXTURE=<name>` for named captured scenarios. Keep the existing `AOF_TEST_GSD_SDK_FIXTURE_JSON` override path for small mutations and backwards compatibility with current tests.
- **D-03:** `MockGSDTools` lives under `test/support/` and is injected at the `gsd-sdk-adapter.mjs` boundary through `ToolsClass` or tool injection. Do not mock `boards.mjs` or backend modules for this harness.
- **D-04:** Unknown command/argument pairs must fail strictly. A test that calls an uncaptured SDK command should throw instead of returning permissive empty defaults or warning-only output.

### BDD SDK Path Scope
- **D-05:** Add SDK-path siblings only for SDK-relevant GSD board scenarios: sync, attach, repair, and assignment flows where adapter behavior matters. Do not clone generic board CRUD scenarios that do not touch GSD SDK behavior.
- **D-06:** Use explicit BDD setup steps such as `Given a project with GSD board execution using SDK fixture "v17-active"` so SDK-path scenarios are visibly distinct from fallback scenarios.
- **D-07:** Preserve current fallback scenarios as-is and add SDK siblings below them. Do not convert existing fallback coverage into SDK-only coverage.
- **D-08:** SDK BDD siblings should assert both user-visible stdout/stderr and persisted BOARD.json binding fields, especially `gsd.milestone.binding.status`, `sdkVersion`, and phase/task state.

### Windows Parity Boundary
- **D-09:** PowerShell integration should run a focused SDK smoke subset, not the full SDK sibling suite. `test:integration:ps` should prove Windows CLI/env/path behavior without duplicating every Node SDK BDD scenario.
- **D-10:** The PowerShell runner should create a temporary project root with spaces in the path itself. Do not rely on the user's checkout path containing spaces.
- **D-11:** UNC and BOM handling remain Phase 38 doctor-warning scope. Phase 36 may document that deferral, but should not implement doctor behavior early or create brittle skipped tests.
- **D-12:** Add a dedicated npm script `test:integration:sdk-contract` for the real SDK JSON-over-process contract suite. Keep that separate from `npm test` so normal tests do not require a real local GSD tools environment.

### v1.6 Migration Fixture
- **D-13:** The v1.6 fixture should be realistic: legacy `gsd.milestone.roadmapPath`, missing `gsd.milestone.id`, old `aof boards sync <id>` command, and existing phase tasks so fingerprint auto-bind is exercised.
- **D-14:** MIG-03 should be covered by BDD end-to-end: load the v1.6 fixture, run `boards repair`, then run `boards sync --milestone ...`, and assert binding/task state.
- **D-15:** Store canonical board/task fixture files, not generated index/cache snapshots. Generated `.aof/cache/boards/index.json` should be rebuilt during tests instead of checked into fixtures.
- **D-16:** Include one happy auto-bind case and one ambiguous no-guess case. The phase should prove both the intended upgrade path and the safety branch that refuses to guess.

### Line Ending Guard
- **D-17:** `.gitattributes` should cover `.aof/**/*.json`, `.planning/**/*.md`, SDK/test fixtures, and `.feature` files. This extends the roadmap's minimum requirement to protect BDD fixture stability too.
- **D-18:** Add a focused fingerprint parity unit test proving CRLF vs LF board/task JSON content does not change board fingerprint behavior after normalization.
- **D-19:** Normalize fingerprint inputs in runtime code as well as adding `.gitattributes`. `canonicalFingerprint` should defensively hash content after normalizing `\r\n` to `\n`.
- **D-20:** Do not renormalize existing files just to apply `.gitattributes`. Add the policy and let future edits normalize touched files, avoiding broad diff churn.

### the agent's Discretion
- Exact helper names, fixture loader structure, and whether `MockGSDTools` exposes class-based or object-based construction are at the agent's discretion as long as adapter-boundary injection remains the test seam.
- The planner may choose the precise SDK-path BDD scenario names and step wording, provided fallback and SDK paths remain visibly distinct.
- The planner may decide whether fingerprint normalization helper code lives inside `src/boards.mjs` or a small local helper, provided no unrelated board behavior changes.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase And Requirements
- `.planning/ROADMAP.md` §Phase 36 — phase goal, dependency, success criteria, and notes.
- `.planning/REQUIREMENTS.md` §Migration — MIG-03 v1.6 board fixture requirement.
- `.planning/REQUIREMENTS.md` §Test surface + Windows parity — TEST-01 through TEST-06.
- `.planning/PROJECT.md` §Current Milestone v1.7 — typed SDK backend intent and no slash-command scraping direction.

### Upstream v1.7 Contracts
- `.planning/phases/33-sdk-adapter-foundation/33-CONTEXT.md` — captured fixture seed, adapter boundary, dispatch log, and SDK surface decisions.
- `.planning/phases/34-board-lifecycle-migration-and-typed-sync/34-CONTEXT.md` — binding states, typed sync, v1.6 repair behavior, and no markdown fallback.
- `.planning/phases/35-boardbackend-seam/35-CONTEXT.md` — backend seam, null backend scope, and capability-gating decisions.
- `.planning/phases/35-boardbackend-seam/35-VERIFICATION.md` — confirms Phase 35 backend seam passed before Phase 36 builds on it.

### Existing Code To Modify
- `src/gsd-sdk-adapter.mjs` — existing env fixture hook and adapter injection surface.
- `src/boards.mjs` — `canonicalFingerprint` and v1.6 repair/sync behavior.
- `src/board-execution.mjs` — assignment path covered by SDK BDD siblings.
- `test/fixtures/gsd-sdk/README.md` and `test/fixtures/gsd-sdk/v17-active/` — existing captured fixture seed.
- `test/boards.test.mjs`, `test/gsd-sdk-adapter.test.mjs`, and `test/backends.test.mjs` — current unit surfaces.
- `test/integration/features/boards.feature` — add SDK-path board scenario siblings.
- `test/integration/steps/boards.steps.mjs`, `test/integration/steps/boards.steps.ps1`, and `test/integration/steps/shared-cli.steps.mjs` — Node/PowerShell setup and assertion steps.
- `test/integration/support/cli-context.mjs` — existing env propagation for `AOF_TEST_GSD_SDK_FIXTURE_JSON`.
- `test/integration/cli.ps1` — PowerShell parity runner and path-with-spaces setup.
- `package.json` — add `test:integration:sdk-contract`.
- `.gitattributes` — add line-ending policy.

### Codebase Maps
- `.planning/codebase/TESTING.md` — unit harness, BDD runner, PowerShell runner, and current test conventions.
- `.planning/codebase/CONVENTIONS.md` — testing and error-handling conventions.
- `.planning/codebase/STRUCTURE.md` — repository and test layout.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `test/fixtures/gsd-sdk/v17-active/` already contains `roadmap-analyze.stdout.json` and `state-load.stdout.txt` captured from real GSD tools.
- `src/gsd-sdk-adapter.mjs` already has `AOF_TEST_GSD_SDK_FIXTURE_JSON`; Phase 36 should add named fixture loading without breaking this hook.
- `test/integration/support/cli-context.mjs` already propagates GSD runtime and SDK fixture env into in-process CLI runs.
- `test/integration/features/boards.feature` already has fallback-path GSD board scenarios around lines 70-106; Phase 36 should add SDK siblings rather than rewriting them.
- `scripts/test-unit.mjs` and `scripts/test.mjs` use the custom exported-array unit harness; new unit tests should follow the same shape.
- `test/integration/cli.ps1` mirrors Node BDD behavior and is the right place for focused PowerShell SDK smoke coverage.

### Established Patterns
- Unit tests use `node:assert/strict` and temporary directories with cleanup.
- BDD features are split by domain under `test/integration/features/`, with matching step files for Node and PowerShell.
- Existing board state is canonical under `.aof/boards/<id>/BOARD.json` plus task files; generated indexes are cache output and should not be fixture source of truth.
- CLI JSON/human output and persisted file state are both legitimate test assertions in BDD.

### Integration Points
- Named fixture env should flow into both child-process/in-process Node integration and PowerShell integration.
- SDK contract testing should be scriptable but not part of default `npm test` because it depends on a real SDK/tools setup.
- The v1.6 migration fixture should feed `repairBoard` and `syncBoardFromGsdRoadmap` through the same CLI route users run.
- Fingerprint normalization affects board index staleness and drift detection; tests should isolate that behavior.

</code_context>

<specifics>
## Specific Ideas

- Preferred named fixture env: `AOF_TEST_GSD_SDK_FIXTURE=<name>`.
- Existing JSON mutation env to preserve: `AOF_TEST_GSD_SDK_FIXTURE_JSON`.
- Preferred fixture harness path: `test/support/MockGSDTools` or equivalent under `test/support/`.
- Preferred SDK fixture seed: `test/fixtures/gsd-sdk/v17-active/`.
- Preferred v1.6 fixture path: `test/fixtures/v1-6-board.json`, plus task fixture files only if needed.
- Preferred new script: `npm run test:integration:sdk-contract`.
- Preferred line-ending policy includes `.aof/**/*.json`, `.planning/**/*.md`, `test/fixtures/**`, and `test/integration/**/*.feature`.

</specifics>

<deferred>
## Deferred Ideas

- Phase 37 owns runtime fallback hardening and CLI-fallback parity behavior changes.
- Phase 38 owns `aof boards doctor`, UNC-path warnings, BOM warnings, and SDK/tools version drift diagnostics.
- Full PowerShell duplication of every SDK BDD sibling is deferred unless the focused smoke path proves insufficient.
- Broad repo-wide line-ending renormalization is deferred; Phase 36 should avoid unrelated diff churn.

</deferred>

---

*Phase: 36-Test Surface Migration And Windows Parity*
*Context gathered: 2026-05-17*

