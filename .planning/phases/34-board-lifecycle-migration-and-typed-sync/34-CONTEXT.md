# Phase 34: Board Lifecycle Migration And Typed Sync - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Route GSD-backed board sync, milestone attach, and repair through the Phase 33 SDK adapter so `aof boards sync <board-id> --milestone <milestone-id>` becomes the explicit typed contract. This phase removes implicit ROADMAP.md parsing from sync, adds typed milestone binding state under BOARD.json, preserves v1.6 boards through a safe repair path, and makes only compact additive setup UI display changes.

</domain>

<decisions>
## Implementation Decisions

### Sync Contract And Errors
- **D-01:** `aof boards sync <board-id>` without `--milestone` MUST hard-fail with structured code `MILESTONE_MISSING_ARG`; it must not infer, inspect, or fall back to `.planning/ROADMAP.md`. The error must include an exact next command: `aof boards sync <id> --milestone <milestone-id>`.
- **D-02:** `aof boards sync <id> --milestone <id>` MUST use SDK `RoadmapAnalysis` from the Phase 33 adapter as the only source of phase truth. Delete `parseRoadmapPhases` and `nextBoldValue` from the sync path; no markdown fallback is allowed on SDK failure.
- **D-03:** SDK analysis failure during sync is a real typed failure, not a fallback trigger. It should surface through structured errors from the adapter/board layer so Phase 38 doctor can audit coverage.
- **D-04:** `aof boards sync <id> --milestone <id> --dry-run --json` MUST report per-phase `{phaseId, action: "create" | "keep" | "drift"}` without writing tasks or BOARD.json.
- **D-05:** Re-sync MUST be idempotent. `binding.status = "synced"` flips only after every required task/BOARD write succeeds.

### Board Binding State
- **D-06:** `gsd.milestone.binding.status` is the canonical readiness field after Phase 34. New code gates sync/task readiness on `binding.status`; legacy `gsd.milestone.status` remains only for backward compatibility and display during migration.
- **D-07:** Supported binding statuses are the minimal lifecycle set: `pending-attachment`, `attached`, `synced`, `drift`, and `error`. Use `error` only when a typed SDK failure is persisted.
- **D-08:** `binding.fingerprint` is a stable hash of the bound milestone's normalized phase identity list from SDK `RoadmapAnalysis`, using `{phaseId, title/name, goal}`. Do not hash full raw SDK output because unrelated metadata changes would create noisy drift.
- **D-09:** Partial sync failures MUST NOT mark the board synced. Persist `binding.status = "error"` with a structured reason/error code so retry is diagnosable.
- **D-10:** `binding.sdkVersion` is written alongside binding state so later diagnostics can explain which SDK surface produced the cached board state.

### v1.6 Migration Behavior
- **D-11:** `repair` auto-binds a v1.6-shaped board only when exactly one SDK milestone matches the stored `gsd.milestone.roadmapPath` or computed phase fingerprint.
- **D-12:** Ambiguity includes multiple candidate milestones, no candidate, fingerprint mismatch, or a roadmap path that cannot be mapped cleanly. In all ambiguous cases, `repair` emits the exact manual `aof boards milestone attach ...` command and makes no binding guess.
- **D-13:** During the deprecation window, `validateBoardShape` surfaces missing `gsd.milestone.id` on v1.6-shaped boards as a warning with a migration command. Sync still hard-fails until the board is attached.
- **D-14:** Once a board is bound, `repair` normalizes old `gsd.taskCreation.syncCommand` values from `aof boards sync <id>` to `aof boards sync <id> --milestone <milestone-id>`.

### Minimal UI Display
- **D-15:** The setup UI shows binding status next to the existing milestone status, for example `milestone: waiting_for_user · binding: pending-attachment`. Do not replace the existing milestone status because runtime milestone creation state is still useful during migration.
- **D-16:** Drift and error states are displayed as short labels only: `binding: drift` or `binding: error`. Detailed diagnostics stay in CLI output and Phase 38 doctor.
- **D-17:** Phase 34 adds no setup UI API routes. Existing board APIs return additive `binding` fields; existing sync/repair endpoints keep their current route shape.
- **D-18:** The UI change stays utilitarian: compact status text only. No new badges, layout panels, routes, or interactions.

### the agent's Discretion
- Internal helper names, exact object-normalization helpers, and how to stage board writes are at the agent's discretion as long as the public behavior above and existing codebase patterns are preserved.
- The planner may decide whether binding migration helpers live in `src/boards.mjs` or a small internal helper module, but Phase 34 should not introduce the Phase 35 `BoardBackend` abstraction early.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase And Requirements
- `.planning/ROADMAP.md` §Phase 34 — phase goal, success criteria, notes, and UI hint.
- `.planning/REQUIREMENTS.md` §Sync — SYNC-01 through SYNC-07 typed sync requirements.
- `.planning/REQUIREMENTS.md` §Lifecycle — LIFE-01 through LIFE-05 create/attach/repair requirements.
- `.planning/REQUIREMENTS.md` §Migration — MIG-02 and MIG-04 v1.6 migration requirements.
- `.planning/PROJECT.md` §Current Milestone v1.7 — typed GSD SDK backend intent and no slash-command scraping direction.

### Upstream Phase 33 Contract
- `.planning/phases/33-sdk-adapter-foundation/33-CONTEXT.md` — locked adapter decisions for SDK-only access, error wrapping, dispatch logging, and no markdown fallback.
- `.planning/phases/33-sdk-adapter-foundation/33-VERIFICATION.md` — confirms Phase 33 adapter exports and tests passed.
- `src/gsd-sdk-adapter.mjs` — Phase 34 must consume this module rather than importing `@gsd-build/sdk`.

### Existing Code To Modify
- `src/boards.mjs` — board storage, create/repair/attach/sync, validation, current markdown parser to remove.
- `src/cli.mjs` — `aof boards sync`, `aof boards repair`, and `aof boards milestone attach` user-facing output and JSON behavior.
- `src/setup-ui.mjs` — existing board API endpoints; return additive binding fields without new routes.
- `ui/src/main.tsx` — compact display of milestone and binding status.

### Test Surfaces
- `test/boards.test.mjs` — unit expectations for board lifecycle and sync behavior.
- `test/integration/features/boards.feature` — BDD scenarios for GSD-backed board sync, repair, attach, and task assignment.
- `test/integration/steps/boards.steps.mjs` and `test/integration/steps/boards.steps.ps1` — Node and PowerShell step implementations that need parity updates.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/gsd-sdk-adapter.mjs` exports `loadGsdState`, `analyzeGsdRoadmap`, `assertMilestone`, `listMilestonePhases`, `gsdSdkVersion`, and `GsdSdkError`; Phase 34 should route all SDK reads through these functions.
- `src/boards.mjs` already centralizes BOARD.json shape, task writes, canonical fingerprinting, board validation, and GSD milestone attach/sync behavior.
- `src/fs.mjs` provides the JSON/text write helpers used throughout the project.
- Existing BDD harnesses already support both Node and PowerShell integration scenarios; Phase 34 should update both where user-facing CLI behavior changes.

### Established Patterns
- CLI commands throw `Error` instances caught at the entry point; JSON mode prints structured payloads when command handlers provide them.
- Board state is file-canonical under `.aof/boards/<id>/BOARD.json` plus task files, with generated index/cache behavior layered on top.
- Existing setup UI board routes are thin wrappers over `src/boards.mjs`; the UI should receive additive fields from existing APIs instead of new route families.
- Tests use a custom `node:assert/strict` harness with exported `{name, run}` objects plus BDD feature files for CLI workflows.

### Integration Points
- `src/boards.mjs::createBoard` needs to record GSD-backed boards as `binding.status = "pending-attachment"` without spawning runtime CLI work during creation.
- `src/boards.mjs::attachBoardMilestoneRoadmap` must verify the milestone through `assertMilestone()` before writing BOARD.json.
- `src/boards.mjs::syncBoardFromGsdRoadmap` should be renamed/reworked to a milestone-driven sync function and route through SDK roadmap analysis.
- `src/boards.mjs::repairBoard` owns the v1.6 auto-bind path and sync command normalization.
- `src/boards.mjs::validateBoardShape` owns deprecation-window warnings for missing `gsd.milestone.id`.
- `src/cli.mjs` and `src/setup-ui.mjs` import the sync/repair/attach functions and must preserve existing command/API ergonomics while adding typed errors and binding fields.
- `ui/src/main.tsx` needs only compact display text for `binding.status`.

</code_context>

<specifics>
## Specific Ideas

- Preferred missing-milestone error code: `MILESTONE_MISSING_ARG`.
- Preferred v1.6 warning code: `BOARD_MILESTONE_ID_MISSING`.
- Preferred sync drift code family from the roadmap: `BOARD_MILESTONE_DRIFT`.
- Example compact UI text: `milestone: waiting_for_user · binding: pending-attachment`.
- Example normalized sync command after binding: `aof boards sync delivery --milestone v1-7`.

</specifics>

<deferred>
## Deferred Ideas

- Phase 38 owns full `aof boards doctor` diagnostics and detailed drift/error explanation.
- Phase 35 owns the `BoardBackend` seam; do not extract it early in Phase 34.
- Phase 37 owns runtime fallback hardening and milestone creation handoff cleanup.
- Rich UI affordances, badges, panels, or new setup UI routes are deferred; Phase 34 ships compact display only.

</deferred>

---

*Phase: 34-Board Lifecycle Migration And Typed Sync*
*Context gathered: 2026-05-17*

