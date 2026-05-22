---
phase: 40
name: Board Attachment And Sync UAT
status: ready_for_planning
gathered: 2026-05-19
mode: self_discuss
---

# Phase 40: Board Attachment And Sync UAT - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Attach the live `coordination` board to milestone `v1.8`, sync roadmap phases into phase-backed tasks, and verify all error paths (sync-before-attach, missing milestone arg, wrong milestone ID). This phase also closes the Phase 39 straggler items — baseline artifacts and git commit of `.aof/boards/` and `.aof/skills/` were not delivered in Phase 39's empty execute step and must be completed here before any attach/sync UAT begins.

</domain>

<decisions>
## Implementation Decisions

### Phase 39 Straggler Handoff
- **D-01:** Phase 39 execute step completed in 111ms with zero planResults — the baseline artifacts were never written. The following are still untracked per git status: `.aof/boards/`, `.aof/skills/`, `.aof/.gitignore`, `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/`. Phase 40 must begin by completing these deliverables in a dedicated "baseline commit" wave before running any attach/sync tests.
- **D-02:** The baseline CLI capture (`39-BASELINE-OUTPUT.md`) and v1.8 UAT log (`39-UAT-LOG.md`) specified in Phase 39 CONTEXT.md decisions D-05 through D-10 must be produced in Phase 40's first wave. All baseline evidence files go in `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/` as originally specified.
- **D-03:** The git commit for `.aof/boards/`, `.aof/skills/`, `.aof/.gitignore`, `.planning/phases/39-*/`, `.planning/milestones/v1.7-UAT.md`, and `src/internal-skills.mjs` (all untracked from git status) must be made in the baseline wave. The bridge skill at `.aof/skills/aof-board-milestone-bridge/` is committed as internal-only state and must NOT be referenced in `.aof/aof.config.json` resources.

### Re-Attach Behavior On Already-Synced Board
- **D-04:** `attachBoardMilestoneRoadmap` sets `status: "ready_to_sync"` and `syncedAt: null` unconditionally — it resets sync state even on boards already in `status: "synced"`. Running `aof boards milestone attach coordination --milestone v1.8 --roadmap .planning/ROADMAP.md` will overwrite `gsd.milestone.status` from `"synced"` to `"ready_to_sync"` and clear `syncedAt` without any warning. This is a UAT finding candidate.
- **D-05:** Log the re-attach state-reset behavior as a UAT finding if the CLI output contains no warning about overwriting synced state. Severity: medium (data loss risk, but re-runnable). Do NOT fix in Phase 40; defer to Phase 43.
- **D-06:** After re-attach, run `aof boards sync coordination --milestone v1.8` immediately to restore the synced state. The board must end Phase 40 in a clean synced state for Phase 41 UI dogfood.

### Disposable Board For Error Path Testing
- **D-07:** Do NOT test error paths (MILESTONE_NOT_BOUND, MILESTONE_ID_MISMATCH, MILESTONE_MISSING_ARG) against the live `coordination` board. That board carries Phase 40's own execution record — detaching or corrupting it would break the board's own state.
- **D-08:** Create a temporary disposable board named `test-attach-uat` for all error path tests. Use `aof boards create test-attach-uat --title "Test Attach UAT" --objective "Error path testing"` with `gsd` execution provider. After all error paths are verified, remove the test board with `aof boards remove test-attach-uat` (or equivalent cleanup).
- **D-09:** Error paths to verify on the disposable board:
  - `MILESTONE_MISSING_ARG`: `aof boards sync test-attach-uat` (no `--milestone` flag)
  - `MILESTONE_NOT_BOUND`: `aof boards sync test-attach-uat --milestone v1.8` (no prior attach)
  - `MILESTONE_ID_MISMATCH`: attach test board to `v1.8`, then sync with `--milestone v1.9`
  
  Each must be tested in both human and `--json` forms. Verify that `--json` output includes `{ ok: false, code: "...", message: "...", next: "..." }`.

### Sync Idempotency And Execution Record Safety
- **D-10:** After re-attach resets sync state, re-running sync on the live `coordination` board will re-process all 5 phases. The sync must NOT overwrite execution records in `.aof/boards/coordination/executions/`. Verify before/after `git diff` shows no changes to `executions/phase-39.json` (status: complete) or `executions/phase-40.json` (status: running).
- **D-11:** If sync does overwrite execution records, log as a critical finding. Severity: critical (data loss of running execution state). This would need an immediate fix in Phase 40 before proceeding to Phase 41.
- **D-12:** Task files in `.aof/boards/coordination/tasks/` may be legitimately updated by sync (e.g., updated phase goal or success criteria from the roadmap). This is expected — track the diff but do not log as a finding unless task `status` or `history` is reset.

### GSD SDK Assertion Dependency
- **D-13:** `attachBoardMilestoneRoadmap` calls `assertBoardMilestone` via the GSD SDK adapter before writing any state. If the SDK adapter probe fails, attach will fail. The happy path for v1.8 uses the GSD SDK installed in this environment (v1.7 shipped the adapter). Test happy path first.
- **D-14:** SDK unavailability error testing is out of scope for Phase 40 (requires artificially breaking the environment). If the happy-path attach fails with an SDK error, log it as a blocker finding and do not proceed to error-path testing until resolved.

### Board Doctor Post-Attach/Sync Verification
- **D-15:** After completing attach + sync on the live board, run `aof boards doctor coordination` and `aof boards doctor coordination --json` to confirm doctor reports:
  - Binding status: `synced`
  - Task count: 5
  - No FAIL-severity checks
  
  Any FAIL or unexpected WARN items after a fresh attach+sync must be logged as UAT findings.

### Claude's Discretion
- Exact CLI invocation: use `node bin/aof.mjs` if a locally installed `aof` binary is not available.
- Board creation command for the test board: use `aof boards create` with `--execution-provider gsd` if that flag exists; otherwise inspect the board creation command signature from `src/cli.mjs`.
- Cleanup of the test board: use `aof boards remove test-attach-uat` if that command exists; otherwise delete the directory manually as a last resort.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Board State (Live)
- `.aof/boards/coordination/BOARD.json` — Live canonical board. Already has `gsd.milestone.id: "v1.8"` and `status: "synced"`. Phase 40 attach will reset it to `ready_to_sync`; sync will restore it.
- `.aof/boards/coordination/executions/phase-39.json` — Status: complete. Must be unchanged by sync.
- `.aof/boards/coordination/executions/phase-40.json` — Status: running. Must be unchanged by sync.
- `.aof/boards/coordination/tasks/` — Phase-39 through phase-43 task files already exist.

### Phase 39 Artifact Destinations (To Be Created In Phase 40 Wave 1)
- `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-BASELINE-OUTPUT.md`
- `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-UAT-LOG.md`

### Internal Bridge Skill
- `.aof/skills/aof-board-milestone-bridge/SKILL.md` — Must be committed in the baseline wave but must NOT appear in `aof assets validate` rendered output.

### Board Implementation
- `src/boards.mjs` — `attachBoardMilestoneRoadmap` (lines ~304-352), `syncBoardFromGsdRoadmap` (lines ~402-540). Study the re-attach state reset and sync idempotency logic before planning.
- `src/cli.mjs` — `boardsMilestoneAttachCommand` (line ~424), `boardsSyncCommand` (line ~287), error code paths in `syncBoardFromGsdRoadmap`.

### Phase Requirements
- `.planning/REQUIREMENTS.md` — Phase 40 covers BOARD-02, BOARD-03, BOARD-04 (currently all Pending).

### Phase 39 Context (Straggler Spec)
- `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-CONTEXT.md` — D-05 through D-10 specify the exact baseline artifact format. Phase 40 must fulfil these decisions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Re-Attach Resets Sync State
- `attachBoardMilestoneRoadmap` in `src/boards.mjs` line 334: sets `status: "ready_to_sync"` and `syncedAt: null` unconditionally. No guard for already-synced boards. Re-attach on `coordination` (currently `status: "synced"`) will reset it.
- The CLI output on successful attach (`console.log("Attached board...")`) provides no warning about lost sync state.

### Sync Error Codes Are Well-Structured
- `MILESTONE_MISSING_ARG` — triggered when `--milestone` arg is absent
- `MILESTONE_NOT_BOUND` — triggered when `board.gsd.milestone.id` is empty (requires board with no milestone binding)
- `MILESTONE_ID_MISMATCH` — triggered when requested milestone differs from board's configured milestone
- All three use `BoardLifecycleError` with a `next:` hint. JSON output path via `printStructuredJsonError`.

### Sync Is Idempotent For Task Existence
- `syncBoardFromGsdRoadmap` uses `syncActions` to detect existing tasks; it only creates tasks not already present. Existing task `id` collisions are skipped.
- However, task file metadata (goal, requirements, successCriteria) may be updated to match current roadmap values. This is expected drift resolution, not a bug.
- Execution records in `.aof/boards/coordination/executions/` are NOT touched by sync — they're a separate directory. Verify this holds.

### Board Create Command
- `aof boards create` is available — check `boardsCreateCommand` in `src/cli.mjs` for required flags to create a GSD-backed board without going through the interactive milestone creation flow.

### Established Pattern
- Phase 39 CONTEXT.md D-10 specifies UAT log schema: `ID`, `Phase discovered`, `Command/surface`, `Severity`, `Summary`, `Repro steps`, `Expected behavior`, `Actual behavior`, `Status`, `Resolution`.
- Use the v1.4 UAT log at `.planning/phases/22-live-repository-verification/22-UAT-LOG.md` as format template.

</code_context>

<specifics>
## Specific Ideas

- Wave 1 (Phase 39 stragglers): Run baseline CLI capture, write 39-BASELINE-OUTPUT.md and 39-UAT-LOG.md, commit all untracked `.aof/` and `.planning/phases/39-*` files.
- Wave 2 (Happy path): Attach `coordination` to v1.8, verify attach output, run sync, verify sync output, run doctor, verify doctor shows clean state. Commit updated board state.
- Wave 3 (Error paths): Create disposable test board, run all three error path scenarios (human + JSON), log findings, clean up test board.
- After wave 3: If no Phase 40 blocker findings, update REQUIREMENTS.md traceability for BOARD-02/03/04 and commit.

</specifics>

<deferred>
## Deferred Ideas

- Boards UI dogfood (Phase 41 scope).
- Agent assignment and execution UAT (Phase 42 scope).
- Fixing the re-attach state-reset behavior if confirmed as a finding (Phase 43 scope unless critical).
- Board create command investigation beyond what's needed for the disposable test board (Phase 43 scope).
- SDK unavailability error path testing (environment-level risk; not part of Phase 40 UAT scope).

</deferred>

---

*Phase: 40-Board-Attachment-And-Sync-UAT*
*Context gathered: 2026-05-19*
