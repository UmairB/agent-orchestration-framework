# Requirements: AOF v1.7 Typed GSD SDK Backend

**Defined:** 2026-05-16
**Core Value:** Users can configure assistant assets once in `.aof/` and reliably generate the correct Claude Code and Codex files; with v1.7, the GSD board↔milestone bridge becomes typed, swappable, and free of slash-command output scraping.

---

## v1.7 Requirements

Requirements for this milestone. Each maps to one roadmap phase (Phase 33–38).

### Adapter (SDK seam)

- [ ] **SDK-01**: User can install AOF with `@gsd-build/sdk@0.1.0` as a pinned-exact direct dependency; supply-chain audit passes after the new transitive surface is allowlisted.
- [ ] **SDK-02**: A single `src/gsd-sdk-adapter.mjs` module is the only place in AOF that imports `@gsd-build/sdk` or invokes `gsd-tools.cjs`.
- [ ] **SDK-03**: User can call `loadGsdState(projectDir)` and receive a typed result containing the current GSD milestone id, plus whether state/roadmap/config are present.
- [ ] **SDK-04**: User can call `analyzeGsdRoadmap(projectDir)` and receive the SDK's typed `RoadmapAnalysis`; AOF no longer parses `.planning/ROADMAP.md` markdown directly for sync.
- [ ] **SDK-05**: User can call `assertMilestone(projectDir, milestoneId)` and receive a structured `{ok, expected, actual, code}` outcome rather than an anonymous thrown string.
- [ ] **SDK-06**: User can call `listMilestonePhases(projectDir, milestoneId)` and receive a typed phase list scoped to one milestone.
- [ ] **SDK-07**: Every adapter call wraps `GSDToolsError` into a typed `GsdSdkError` with `{code, message, expected?, actual?, next?}` and never leaks raw `gsd-tools.cjs` command strings to CLI users.
- [ ] **SDK-08**: AOF accepts an injectable `gsdToolsPath` for the adapter (resolved via `src/frameworks.mjs`) so users without `~/.claude/get-shit-done/bin/gsd-tools.cjs` still work.
- [ ] **SDK-09**: A boot-time contract test imports `@gsd-build/sdk` and fails fast if the surface AOF depends on (`GSDTools.roadmapAnalyze`, `stateLoad`, etc.) is missing or shape-changed.

### Sync (board ↔ GSD state, typed)

- [ ] **SYNC-01**: User can run `aof boards sync <board-id> --milestone <milestone-id>` and have task creation driven by the SDK's typed `RoadmapAnalysis`; the v1.6 markdown-regex sync path is removed.
- [ ] **SYNC-02**: `aof boards sync` without `--milestone` fails with the structured code `MILESTONE_MISSING_ARG` and a `next:` hint showing the exact invocation; no implicit `.planning/ROADMAP.md` fallback exists.
- [ ] **SYNC-03**: Sync fails with structured codes when the board's `gsd.milestone.id` is empty (`MILESTONE_NOT_BOUND`), differs from the supplied `--milestone` (`MILESTONE_ID_MISMATCH`), is not present in current GSD state (`MILESTONE_NOT_IN_STATE`), or the resolved milestone is incomplete (`MILESTONE_INCOMPLETE`).
- [ ] **SYNC-04**: Sync writes a typed `gsd.milestone.phases[]` array and `gsd.milestone.binding.{status, sdkVersion, driftReason?, fingerprint}` into `BOARD.json` so the UI and validator can reason about phase identity without re-parsing markdown.
- [ ] **SYNC-05**: User can run `aof boards sync <id> --milestone <id> --dry-run --json` to preview per-phase `{phaseId, action: "create"|"keep"|"drift"}` without writing.
- [ ] **SYNC-06**: Re-sync detects drift: phases that exist on the board but are no longer in the typed roadmap surface as warnings rather than being silently kept.
- [ ] **SYNC-07**: Sync is idempotent: re-running with the same milestone makes no task or BOARD.json changes; `binding.status` flips to `synced` only after all task writes succeed.

### Lifecycle (create / attach / repair)

- [ ] **LIFE-01**: User can run `aof boards create` with a GSD provider and an objective; the board is recorded with `binding.status = "pending-attachment"` and no runtime CLI is spawned during creation.
- [ ] **LIFE-02**: User can run `aof boards milestone attach <board-id> --milestone <id>` and the command verifies that `<id>` exists in GSD state via `assertMilestone()` before writing BOARD.json; an unknown milestone fails clearly without modifying state.
- [ ] **LIFE-03**: User can run `aof boards repair <board-id>` and have AOF re-check GSD state via the SDK; when a matching milestone exists, AOF auto-binds it (read-only attach, no spawn).
- [ ] **LIFE-04**: User can run `aof boards list` (and read the boards UI) and see boards without a bound GSD-confirmed milestone surfaced as `pending_milestone` rather than silently treated as ready.
- [ ] **LIFE-05**: Manual task creation on a GSD-backed board remains blocked until the board reports `binding.status === "synced"` (the v1.6 gate continues to enforce identity).

### Backend Interface (swap-in seam)

- [ ] **BACK-01**: A `BoardBackend` interface lives in `src/backends/index.mjs` with exactly four methods — `loadState`, `analyzeRoadmap`, `assertMilestone`, `syncBoardFromMilestone` — plus a `kind` discriminant and a `capabilities` set.
- [ ] **BACK-02**: GSD is registered as the v1.7 backend implementation (`kind: "gsd"`); a `null` test backend implements the same interface for unit/integration tests; no second real backend ships.
- [ ] **BACK-03**: `boards.mjs`, `board-execution.mjs`, `cli.mjs`, and `setup-ui.mjs` interact with backends exclusively through `resolveBackend(name)`; the `executionProvider` field becomes a registry lookup, with non-`gsd` real values rejected with `BACKEND_UNSUPPORTED`.
- [ ] **BACK-04**: `board-execution.mjs::assignTaskToAgent` gates on `backend.capabilities.has("assignTask")` rather than a `provider !== "gsd"` literal check.
- [ ] **BACK-05**: GSD-specific fields (`milestone.invocation`, `session.turns`, slash-command strings) live under `backend.gsd.*` sub-objects in BOARD.json — they are not promoted to the abstract `BoardBackend` interface.

### Diagnostics

- [ ] **DIAG-01**: User can run `aof boards doctor [<board-id>]` and see a per-check pass/fail ladder covering: GSD state present, milestone bound, identity matches GSD state, roadmap analyzable, tasks consistent with roadmap, SDK version drift.
- [ ] **DIAG-02**: `aof boards doctor` surfaces `SDK_VERSION_DRIFT` (warning) when the installed `@gsd-build/sdk` version differs from the resolved global `gsd-sdk` CLI version, and `GSD_TOOLS_MISSING` (error) when `gsd-tools.cjs` cannot be resolved.
- [ ] **DIAG-03**: All `aof boards` subcommands support `--json` output that emits structured error objects (`{code, message, expected?, actual?, next?}`) for every typed failure mode.
- [ ] **DIAG-04**: Every typed error includes a `next:` hint showing the exact remediation command (e.g. `aof boards milestone attach delivery --milestone v1-7`).
- [ ] **DIAG-05**: Every `GSDTools.exec` call from the adapter is appended to `.aof/cache/boards/dispatch.log.jsonl` with `{ts, command, args, latencyMs, ok}` for post-hoc debugging.
- [ ] **DIAG-06**: `.aof/lock/packages.json` (or equivalent lock surface) records both the bundled `@gsd-build/sdk` version and the resolved `gsd-tools.cjs` path + reported version after every adapter boot.

### Execution

- [ ] **EXEC-01**: User can assign a phase-shaped task to an agent and AOF calls `gsd.runPhase(phaseNumber)` via the SDK adapter; `task.execution` records the typed `PhaseRunnerResult` with byte-compatible shape to the v1.6 UI consumer.
- [ ] **EXEC-02**: Runtime-CLI execution (`claude`/`codex` spawn) is preserved only as the fallback for interactive milestone creation; every fallback invocation logs `[fallback runtime=<x>] SDK path unavailable for <reason>` to stderr.
- [ ] **EXEC-03**: Phase execution exits non-zero on `PlanResult.success === false` and the adapter surfaces SDK `error.subtype` (e.g. `error_max_turns`, `error_during_execution`) through `GsdSdkError`.
- [ ] **EXEC-04**: `src/gsd-runtime.mjs` is renamed to `src/gsd-runtime-fallback.mjs`; the `completedRoadmapPath` mtime-scraping helper is removed; callers needing completion status read `loadGsdState()` instead.

### Migration (v1.6 boards → v1.7)

- [ ] **MIG-01**: `aof boards doctor` detects v1.6-shaped boards (`gsd.milestone.roadmapPath` set, `gsd.milestone.id` missing) and emits `BOARD_MILESTONE_ID_MISSING` with the exact migration command pre-filled.
- [ ] **MIG-02**: `aof boards repair` infers the missing `gsd.milestone.id` from the stored `roadmapPath` plus GSD state; when exactly one milestone matches, AOF auto-attaches; when ambiguous, AOF emits the fix-it command without modifying state — never silently auto-picks.
- [ ] **MIG-03**: A captured v1.6 board fixture (`test/fixtures/v1-6-board.json`) exercises the migration path end-to-end in BDD; regression for "v1.6 board breaks on first v1.7 sync" is permanent.
- [ ] **MIG-04**: `validateBoardShape` surfaces missing `gsd.milestone.id` as a warning (not error) during a deprecation window so users see the migration prompt before a hard fail.

### Test surface + Windows parity

- [ ] **TEST-01**: A `MockGSDTools` test double under `test/support/` returns values captured from real `gsd-tools.cjs` output under `test/fixtures/gsd-sdk/<scenario>/`; AOF unit tests inject it at the adapter boundary, not the `boards.mjs` boundary.
- [ ] **TEST-02**: A new integration suite `test:integration:sdk-contract` boots a real `GSDTools` against a controlled `.planning/` fixture and asserts JSON-over-process shapes.
- [ ] **TEST-03**: BDD scenarios at `test/integration/features/boards.feature` gain SDK-path siblings to every fallback-path scenario; `AOF_TEST_GSD_SDK_FIXTURE=<name>` env scaffolds the SDK path the way `AOF_TEST_GSD_RUNTIME_STATUS` scaffolds the fallback path.
- [ ] **TEST-04**: `test:integration:ps` (Windows PowerShell runner) exercises the SDK adapter path with a project rooted at a path containing a space; UNC and BOM scenarios surface as warnings via doctor.
- [ ] **TEST-05**: A parity unit test asserts SDK-path and CLI-fallback-path produce identical `gsd.milestone.binding.status` transitions for the same logical input.
- [ ] **TEST-06**: `.gitattributes` enforces LF line endings for `.aof/**/*.json` and `.planning/**/*.md` so `canonicalFingerprint` outputs match across Linux CI and Windows runs.

---

## v1.8+ Requirements

Acknowledged and deferred.

### Event streaming + UI

- **EVT-01**: AOF surfaces SDK `GSDEvent` stream (`PhaseStart`, `ToolCall`, `AssistantText`, `CostUpdate`) through the setup UI via `WSTransport`.
- **EVT-02**: The boards UI shows live phase execution progress and cost without polling BOARD.json.

### Milestone creation runner

- **CREATE-01**: When the SDK ships a `MilestoneCreationRunner` analogous to `InitRunner`, AOF adopts it via `createMilestoneFromObjective(objective)` and removes the interactive runtime-CLI handoff.

### Backend ecosystem

- **BACK2-01**: AOF ships a second real `BoardBackend` implementation (local-only, hosted, or external tracker) once a concrete demand and target shape exist.

### Typed handlers as SDK promotes them

- **PROMO-01**: When `state.milestone-switch` becomes a typed `GSDTools` method, AOF's adapter swaps the `exec("state milestone-switch")` escape hatch.
- **PROMO-02**: `phase.add` / `phase.add-batch` typed wrappers adopted if AOF later lets users author phases from the boards UI.

---

## Out of Scope

Explicitly excluded from v1.7.

| Feature | Reason |
|---------|--------|
| Forking or vendoring `@gsd-build/sdk` to add a milestone-creation runner | Permanent maintenance burden; PROJECT.md decision is to defer the runner, not invent one |
| Re-implementing GSD's state/roadmap/phase logic AOF-side | Recreates the surface the SDK itself wraps; locks AOF into shadowing GSD's evolution |
| Implicit `.planning/ROADMAP.md` fallback when `--milestone` is missing | The silent-drift footgun this milestone exists to kill |
| `gsd-sdk query` CLI shellouts as a second integration path | Two seams = two bug surfaces; everything reachable via CLI is also reachable via `GSDTools.exec` |
| Adopting `GSDEventStream` in v1.7 without a UI consumer | Partial adoption adds no user value; deferred to v1.8 |
| Markdown-regex roadmap parsing as "fallback when SDK fails" | Would mask SDK failures and defeat the typed-state guarantee |
| Treating runtime CLI and SDK execution as equal-weight peers | Defeats the typed-seam value prop |
| Shipping `BoardBackend` with two real backend implementations | YAGNI; stub second backend distracts from GSD hardening |
| Migrating to TypeScript for the AOF CLI itself | The SDK's `.d.ts` already gives editor-level types in `.mjs`; full TS migration is a separate decision |
| AOF-side `aof boards milestone create <id>` that invokes a composite spawn + SDK orchestration | Recreates the brittle pattern v1.7 deletes; hand off to runtime CLI cleanly instead |

---

## Traceability

Locked by the roadmapper on 2026-05-16. Every v1.7 requirement maps to exactly one phase (Phase 33–38). 100% coverage, no orphans, no duplicates.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SDK-01 | Phase 33 | Pending |
| SDK-02 | Phase 33 | Pending |
| SDK-03 | Phase 33 | Pending |
| SDK-04 | Phase 33 | Pending |
| SDK-05 | Phase 33 | Pending |
| SDK-06 | Phase 33 | Pending |
| SDK-07 | Phase 33 | Pending |
| SDK-08 | Phase 33 | Pending |
| SDK-09 | Phase 33 | Pending |
| DIAG-05 | Phase 33 | Pending |
| SYNC-01 | Phase 34 | Pending |
| SYNC-02 | Phase 34 | Pending |
| SYNC-03 | Phase 34 | Pending |
| SYNC-04 | Phase 34 | Pending |
| SYNC-05 | Phase 34 | Pending |
| SYNC-06 | Phase 34 | Pending |
| SYNC-07 | Phase 34 | Pending |
| LIFE-01 | Phase 34 | Pending |
| LIFE-02 | Phase 34 | Pending |
| LIFE-03 | Phase 34 | Pending |
| LIFE-04 | Phase 34 | Pending |
| LIFE-05 | Phase 34 | Pending |
| MIG-02 | Phase 34 | Pending |
| MIG-04 | Phase 34 | Pending |
| BACK-01 | Phase 35 | Pending |
| BACK-02 | Phase 35 | Pending |
| BACK-03 | Phase 35 | Pending |
| BACK-04 | Phase 35 | Pending |
| BACK-05 | Phase 35 | Pending |
| MIG-03 | Phase 36 | Pending |
| TEST-01 | Phase 36 | Pending |
| TEST-02 | Phase 36 | Pending |
| TEST-03 | Phase 36 | Pending |
| TEST-04 | Phase 36 | Pending |
| TEST-05 | Phase 36 | Pending |
| TEST-06 | Phase 36 | Pending |
| EXEC-01 | Phase 37 | Pending |
| EXEC-02 | Phase 37 | Pending |
| EXEC-03 | Phase 37 | Pending |
| EXEC-04 | Phase 37 | Pending |
| DIAG-01 | Phase 38 | Pending |
| DIAG-02 | Phase 38 | Pending |
| DIAG-03 | Phase 38 | Pending |
| DIAG-04 | Phase 38 | Pending |
| DIAG-06 | Phase 38 | Pending |
| MIG-01 | Phase 38 | Pending |

**Coverage:**
- v1.7 requirements: 46 total
- Mapped to phases (locked): 46
- Unmapped: 0
- Duplicates: 0

**Per-phase counts:**
- Phase 33 (SDK Adapter Foundation): 10 requirements
- Phase 34 (Board Lifecycle Migration And Typed Sync): 14 requirements
- Phase 35 (BoardBackend Seam): 5 requirements
- Phase 36 (Test Surface Migration And Windows Parity): 7 requirements
- Phase 37 (Runtime Fallback Hardening And Collapse): 4 requirements
- Phase 38 (Doctor, Observability, And Milestone Closeout): 6 requirements

---

*Requirements defined: 2026-05-16*
*Last updated: 2026-05-16 after roadmapper locked Phase 33–38 mapping*
