# Roadmap: AOF

**Created:** 2026-05-06
**Last updated:** 2026-05-16 after v1.7 roadmap creation

## Milestones

- ✅ **v1 Assistant Configuration Foundation** — Phases 1-5, shipped 2026-05-07. Archive: [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- ✅ **v1.1 Aligned Core Hardening** — Phases 6-10, shipped 2026-05-08. Archive: [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Global Asset Library** — Phases 11-15, shipped 2026-05-09. Archive: [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Interactive CLI Hardening** — Phases 16-17, shipped 2026-05-09. Archive: [v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 Namespaced CLI Contract** — Phases 18-22, shipped 2026-05-11. Archive: [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Runtime Semantics And Workflow Assets** — Phases 23-27, shipped 2026-05-14. Archive: [v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md)
- ✅ **v1.6 Task Management** — Phases 28-32, shipped 2026-05-15. Archive: [v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md)
- 🚧 **v1.7 Typed GSD SDK Backend** — Phases 33-38, in progress.

## Phases

<details>
<summary>✅ Shipped Milestones (Phases 1-27)</summary>

Previous milestone details are archived under `.planning/milestones/`.

- v1: Phases 1-5 — Assistant Configuration Foundation
- v1.1: Phases 6-10 — Aligned Core Hardening
- v1.2: Phases 11-15 — Global Asset Library
- v1.3: Phases 16-17 — Interactive CLI Hardening
- v1.4: Phases 18-22 — Namespaced CLI Contract
- v1.5: Phases 23-27 — Runtime Semantics And Workflow Assets

</details>

<details>
<summary>✅ v1.6 Task Management (Phases 28-32)</summary>

v1.6 milestone details are archived under `.planning/milestones/v1.6-ROADMAP.md`.

- Phase 28: Board And Task State Foundation
- Phase 29: GSD Objective Breakdown
- Phase 30: Agent Assignment And Execution
- Phase 31: Kanban Setup UI
- Phase 32: Task Management Verification

</details>

### v1.7 Phases (in progress)

- [x] **Phase 33: SDK Adapter Foundation** — Pin `@gsd-build/sdk@0.1.0`, ship the typed adapter module, version-drift probe, error wrapping, dispatch log, and first captured fixture. (completed 2026-05-16)
- [ ] **Phase 34: Board Lifecycle Migration And Typed Sync** — Route `aof boards sync --milestone` through the adapter, drop implicit ROADMAP.md parsing, add `binding.*` fields and structured error codes, auto-migrate v1.6 boards via `repair`.
- [ ] **Phase 35: BoardBackend Seam** — Extract a minimal 4-method `BoardBackend` interface from the working Phase 34 code, register GSD as the v1 backend, add a null backend for tests, keep GSD-isms under `backend.gsd.*`.
- [ ] **Phase 36: Test Surface Migration And Windows Parity** — Captured-fixture two-tier doubles, SDK-path BDD siblings, `test:integration:ps` exercises the SDK adapter, v1.6 board regression fixture, `.gitattributes` for cross-OS fingerprint stability.
- [ ] **Phase 37: Runtime Fallback Hardening And Collapse** — Rename `gsd-runtime.mjs` → `gsd-runtime-fallback.mjs`, drop `completedRoadmapPath` mtime scraping, loud `[fallback]` stderr, parity unit test, milestone-creation handoff.
- [ ] **Phase 38: Doctor, Observability, And Milestone Closeout** — `aof boards doctor` end-to-end ladder, SDK/tools version drift diagnostic, lock state records both versions, Windows-specific checks, milestone audit and archive.

## Progress

| Milestone | Phases | Plans | Requirements | Status | Shipped |
|-----------|--------|-------|--------------|--------|---------|
| v1 Assistant Configuration Foundation | 1-5 | 15/15 | 32/32 | Complete | 2026-05-07 |
| v1.1 Aligned Core Hardening | 6-10 | 16/16 | 22/22 | Complete | 2026-05-08 |
| v1.2 Global Asset Library | 11-15 | 15/15 | 22/22 | Complete | 2026-05-09 |
| v1.3 Interactive CLI Hardening | 16-17 | 3/3 | 12/12 | Complete | 2026-05-09 |
| v1.4 Namespaced CLI Contract | 18-22 | 9/9 | 22/22 | Complete | 2026-05-11 |
| v1.5 Runtime Semantics And Workflow Assets | 23-27 | 13/13 | 24/24 | Complete | 2026-05-14 |
| v1.6 Task Management | 28-32 | 15/15 | 30/30 | Complete | 2026-05-15 |
| v1.7 Typed GSD SDK Backend | 33-38 | 0/0 | 0/46 | In progress | - |

## Phase Details

### Phase 33: SDK Adapter Foundation

**Goal:** Land the single typed seam over `@gsd-build/sdk@0.1.0` so every later phase can call SDK functions through one auditable, error-wrapped, version-pinned module.

**Depends on:** Nothing (first v1.7 phase).

**Requirements:** SDK-01, SDK-02, SDK-03, SDK-04, SDK-05, SDK-06, SDK-07, SDK-08, SDK-09, DIAG-05

**Success Criteria** (what must be TRUE):
1. User can `npm install` AOF and get exactly `@gsd-build/sdk@0.1.0` pinned with `--save-exact`, and `npm run security:supply-chain` passes against the widened transitive surface.
2. User-facing AOF code can call `loadGsdState`, `analyzeGsdRoadmap`, `assertMilestone(milestoneId)`, and `listMilestonePhases(milestoneId)` and receive typed structured results — never a raw `GSDToolsError` string.
3. System refuses to boot the adapter if the `@gsd-build/sdk` surface AOF depends on (`GSDTools.roadmapAnalyze`, `stateLoad`, etc.) is missing or shape-changed, with a clear actionable message.
4. System records every `GSDTools.exec` call to `.aof/cache/boards/dispatch.log.jsonl` as `{ts, command, args, latencyMs, ok}` so adapter behavior is debuggable post-hoc.
5. System uses an injectable `gsdToolsPath` resolved via `src/frameworks.mjs`, so users without the default `~/.claude/get-shit-done/bin/gsd-tools.cjs` still work without code edits.

**Plans:** 3/3 plans complete

**Notes:**
- This is a pure addition — no existing AOF behavior changes yet.
- Adapter must be the ONLY module that imports `@gsd-build/sdk` or invokes `gsd-tools.cjs`; lint/grep guard belongs here.
- `assertMilestone` returns `{ok, expected, actual, code}` rather than throwing anonymous strings, so Phase 34's structured errors compose cleanly on top.
- Phase 33 produces the first captured fixture under `test/fixtures/gsd-sdk/` so Phase 36 has something to seed its two-tier doubles with.

### Phase 34: Board Lifecycle Migration And Typed Sync

**Goal:** Re-route board sync, attach, and repair through the Phase 33 adapter so `aof boards sync <board-id> --milestone <milestone-id>` is the typed contract, implicit ROADMAP.md parsing is gone, and v1.6 boards self-migrate.

**Depends on:** Phase 33 (adapter must exist and be stable).

**Requirements:** SYNC-01, SYNC-02, SYNC-03, SYNC-04, SYNC-05, SYNC-06, SYNC-07, LIFE-01, LIFE-02, LIFE-03, LIFE-04, LIFE-05, MIG-02, MIG-04

**Success Criteria** (what must be TRUE):
1. User can run `aof boards sync <board-id> --milestone <milestone-id>` and have task creation driven by typed `RoadmapAnalysis`; omitting `--milestone` fails with `MILESTONE_MISSING_ARG` and a `next:` hint instead of silently re-reading ROADMAP.md.
2. User can run `aof boards sync <id> --milestone <id> --dry-run --json` and see per-phase `{phaseId, action: "create"|"keep"|"drift"}` without writing, and re-sync is idempotent — `binding.status` flips to `synced` only after every task write succeeds.
3. User can run `aof boards create` with an objective and a GSD provider and see `binding.status = "pending-attachment"` recorded without any runtime CLI spawn during creation.
4. User can run `aof boards milestone attach <board-id> --milestone <id>` and have AOF verify the milestone exists in GSD state via `assertMilestone` before any BOARD.json write — unknown milestones fail clean.
5. User upgrading a v1.6 project sees `aof boards repair <id>` auto-bind a matching milestone when exactly one matches the stored `roadmapPath`; ambiguous matches print a fix-it command and never auto-pick; `validateBoardShape` surfaces missing `gsd.milestone.id` as a warning during the deprecation window so users see the migration prompt before any hard failure.

**Plans:** TBD
**UI hint**: yes

**Notes:**
- This is the load-bearing CLI surface change for v1.7 — `aof boards sync <id> --milestone <id>` is the contract users adopt.
- `parseRoadmapPhases` and `nextBoldValue` get deleted in this phase; SDK `roadmapAnalyze` is the only source of truth from here on.
- New BOARD.json fields are additive under `gsd.milestone.binding.{status, sdkVersion, driftReason?, fingerprint}` — BOARD.json schema version stays at 1.
- Diagnostic codes introduced here: `MILESTONE_MISSING_ARG`, `MILESTONE_NOT_BOUND`, `MILESTONE_ID_MISMATCH`, `MILESTONE_NOT_IN_STATE`, `MILESTONE_INCOMPLETE`, `BOARD_MILESTONE_UNATTACHED`, `BOARD_MILESTONE_DRIFT`. The `next:` hint on every error is part of the contract; Phase 38 audits coverage.
- UI gets two additive display strings only — boards UI shows `binding.status` next to `milestone.status`. No new routes, no SSE/WebSocket.
- Migration is doctor-detection (Phase 38) + repair-auto-bind (here). Splitting prevents Phase 38 from owning lifecycle code.

### Phase 35: BoardBackend Seam

**Goal:** Extract a minimal `BoardBackend` interface from the working Phase 34 code so a non-GSD backend could be swapped in later, without baking GSD assumptions into the abstraction.

**Depends on:** Phase 34 (interface must be extracted from working code, NOT designed up-front; pitfall #5 in PITFALLS.md).

**Requirements:** BACK-01, BACK-02, BACK-03, BACK-04, BACK-05

**Success Criteria** (what must be TRUE):
1. User-facing GSD behavior is unchanged after the seam lands — `aof boards sync`, `attach`, `repair` produce identical observable output to Phase 34.
2. System resolves `executionProvider` through `resolveBackend(name)`; passing a non-`gsd` real value fails fast with `BACKEND_UNSUPPORTED` and a clear list of supported backends instead of silently shelling out.
3. System routes `assignTaskToAgent` gating through `backend.capabilities.has("assignTask")` instead of the v1.6 `provider !== "gsd"` literal — capability flags are the public contract.
4. Test runner can swap in the `null` backend (`kind: "null"`) for unit tests, verifying the same call paths work without touching `gsd-tools.cjs`.
5. System keeps GSD-specific surface (`milestone.invocation`, `session.turns`, slash-command strings) under `backend.gsd.*` sub-objects in BOARD.json — `BoardBackend` interface stays at exactly four methods (`loadState`, `analyzeRoadmap`, `assertMilestone`, `syncBoardFromMilestone`) plus `kind` and `capabilities`.

**Plans:** TBD

**Notes:**
- This phase is the highest-risk for over-abstraction. The discipline is: extract from Phase 34's working code; do not invent fields the second backend "might" need.
- Only two implementations ship: `gsd-backend.mjs` (real, thin composition over the Phase 33 adapter) and `null-backend.mjs` (test-only, no-op). Shipping a second real backend is explicitly out of scope.
- `BoardBackend` documentation must say "v1.7 does not promise this shape is stable" — it is a seam, not a contract.
- Consumers updated in this phase: `src/boards.mjs`, `src/board-execution.mjs`, `src/cli.mjs`, `src/setup-ui.mjs`. All four touch `resolveBackend()` and nothing else from the backend layer.

### Phase 36: Test Surface Migration And Windows Parity

**Goal:** Land the captured-fixture two-tier test doubles, parallel SDK-path BDD scenarios, the v1.6 migration regression fixture, and Windows PowerShell coverage of the SDK adapter so the v1.7 seam is verifiable cross-platform.

**Depends on:** Phase 35 (backend seam must exist so tests can inject `null-backend` and capability flags are stable). Conceptually informs Phases 33-35 too — captured fixtures should be added as each phase produces them.

**Requirements:** MIG-03, TEST-01, TEST-02, TEST-03, TEST-04, TEST-05, TEST-06

**Success Criteria** (what must be TRUE):
1. Test author can write a unit test that imports `MockGSDTools` from `test/support/`, scaffold a scenario via `AOF_TEST_GSD_SDK_FIXTURE=<name>`, and have the adapter return values captured from real `gsd-tools.cjs` output under `test/fixtures/gsd-sdk/<scenario>/` — tests inject at the adapter boundary, never at the `boards.mjs` boundary.
2. CI run executes `npm run test:integration:sdk-contract` and boots a real `GSDTools` against a controlled `.planning/` fixture, asserting the JSON-over-process shape AOF depends on hasn't drifted under the SDK pin.
3. Windows user can run `test:integration:ps` against a project rooted at a path containing a space and see SDK-adapter BDD scenarios pass; UNC and BOM scenarios surface as doctor warnings rather than crashing the suite.
4. User upgrading a v1.6 project sees the migration fixture `test/fixtures/v1-6-board.json` exercised end-to-end in BDD — "v1.6 board breaks on first v1.7 sync" cannot regress without a CI failure.
5. System produces identical `gsd.milestone.binding.status` transitions whether the SDK path or the CLI-fallback path handles the same logical input — a parity unit test enforces it, and `.gitattributes` forces LF on `.aof/**/*.json` and `.planning/**/*.md` so `canonicalFingerprint` matches across Linux CI and Windows runs.

**Plans:** TBD

**Notes:**
- Two-tier doubles are non-negotiable: `MockGSDTools` (captured fixtures) for fast unit tests + a real-SDK contract suite for the JSON-over-process boundary. Mocking the entire `gsd-sdk-adapter` module skips the boundary that breaks in production.
- BDD scenarios at `test/integration/features/boards.feature:70-106` assert specific stdout strings. Keep the fallback variants as-is; clone them for the SDK path. Don't delete.
- The v1.6 fixture is the regression artifact that proves Phase 34's migration logic works. Without it, every future SDK bump risks silently breaking field upgrades.
- `.gitattributes` lands here because cross-platform `canonicalFingerprint` is a v1.7 prerequisite for drift detection, and the fix is one-line.

### Phase 37: Runtime Fallback Hardening And Collapse

**Goal:** Demote the runtime CLIs to explicit fallback-only status — rename, strip mtime scraping, add loud `[fallback]` stderr labeling, parity unit test, and implement the deferred milestone-creation handoff cleanly.

**Depends on:** Phase 33 (adapter is the primary path; fallback must be defined relative to it). Can begin in parallel with Phases 34-35 once 33 is stable, but completion sequences after 35 because the handoff target uses the backend seam.

**Requirements:** EXEC-01, EXEC-02, EXEC-03, EXEC-04

**Success Criteria** (what must be TRUE):
1. User assigning a phase-shaped task to an agent sees AOF call `gsd.runPhase(phaseNumber)` via the adapter, and `task.execution` records the typed `PhaseRunnerResult` with byte-compatible shape to the v1.6 UI consumer — boards UI continues to render execution state without changes.
2. User reading stderr during any runtime-CLI invocation sees `[fallback runtime=<x>] SDK path unavailable for <reason>` — fallback paths are never silent.
3. User running phase execution against a failed `PlanResult` sees a non-zero exit code and the SDK `error.subtype` (e.g. `error_max_turns`, `error_during_execution`) surfaced through `GsdSdkError`, not a raw shell exit code.
4. Maintainer reading the repo sees `src/gsd-runtime.mjs` is gone, replaced by `src/gsd-runtime-fallback.mjs`; the `completedRoadmapPath` mtime-scraping helper is deleted; callers needing "did GSD finish?" use `loadGsdState()` instead.
5. User running `aof boards milestone create <id>` sees a clean handoff message pointing at `$gsd-new-milestone` then `aof boards milestone attach` — no AOF-side composite that tries to fake a missing SDK runner.

**Plans:** TBD

**Notes:**
- The rename (`gsd-runtime.mjs` → `gsd-runtime-fallback.mjs`) is the load-bearing signal that the file's role has demoted. Keep the file; just rename and prune.
- Windows-specific safeguards in the fallback (`shell: process.platform === "win32"`, `\r?\n` regex) MUST stay. Tag with `// WINDOWS-FALLBACK: required for <reason>` before any "cleanup" touches them.
- No `tools.exec("state", ["milestone-switch"])` in the adapter or anywhere AOF-side — that recreates the brittle composite v1.7 exists to delete. Hand off to runtime CLI for interactive milestone creation, then re-enter SDK path via `loadGsdState()` once the user finishes.
- The parity unit test belongs here, not in Phase 36, because the test asserts a behavior this phase creates. Phase 36 plumbs `AOF_TEST_GSD_SDK_FIXTURE` infrastructure; this phase exercises it for the parity assertion.

### Phase 38: Doctor, Observability, And Milestone Closeout

**Goal:** Ship `aof boards doctor` as the end-to-end pass/fail ladder, surface SDK-vs-tools version drift, record both versions in lock state, add Windows-specific checks, and close out the milestone with audit + archive.

**Depends on:** Phases 33-37 (doctor is a reporter over every other phase's surface). Must run last.

**Requirements:** DIAG-01, DIAG-02, DIAG-03, DIAG-04, DIAG-06, MIG-01

**Success Criteria** (what must be TRUE):
1. User can run `aof boards doctor [<board-id>]` and see a per-check pass/fail ladder covering: GSD state present, milestone bound, identity matches GSD state, roadmap analyzable, tasks consistent with roadmap, SDK version drift — one command answers "is my board healthy."
2. User upgrading a v1.6 project sees `aof boards doctor` emit `BOARD_MILESTONE_ID_MISSING` for any v1.6-shaped board (`gsd.milestone.roadmapPath` set, `gsd.milestone.id` missing) with the exact `aof boards milestone attach …` migration command pre-filled in the `next:` hint.
3. User sees `SDK_VERSION_DRIFT` (warning) when the installed `@gsd-build/sdk` version differs from the resolved global `gsd-sdk` CLI version, and `GSD_TOOLS_MISSING` (error) when `gsd-tools.cjs` cannot be resolved — drift never causes silent state corruption.
4. User running any `aof boards` subcommand with `--json` gets structured error objects (`{code, message, expected?, actual?, next?}`) for every typed failure mode, and every typed error includes a `next:` hint with the exact remediation command — no `--json` blind spots.
5. User on Windows running `aof boards doctor` sees `node`-on-PATH check, UNC-path warning, and BOM detection; system records the bundled `@gsd-build/sdk` version and the resolved `gsd-tools.cjs` path + reported version into `.aof/lock/packages.json` after every adapter boot.

**Plans:** TBD

**Notes:**
- Doctor is a reporter — it composes Phase 33's adapter, Phase 34's binding fields, Phase 35's backend capabilities, and Phase 37's fallback labels into one ladder. No new business logic should land here.
- `--json` parity audit lives in this phase: every `aof boards` subcommand introduced or modified across 34-37 gets its `--json` path verified. Don't trust per-phase claims; sweep once at closeout.
- Lock-state extension to record `sdkVersion` + `toolsVersion` depends on the v1.1 Phase 9 framework lock metadata decision — verify the slot exists before writing, additive only.
- Milestone audit + archive (`.planning/milestones/v1.7-*.md`) is the closeout artifact. Follows the v1.6 audit format already on disk.

## Next

v1.7 Typed GSD SDK Backend is in progress. Start with `/gsd:plan-phase 33` to plan the SDK adapter foundation.
