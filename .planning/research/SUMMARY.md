# Project Research Summary: v1.8 AOF Boards Dogfood UAT

**Project:** AOF
**Domain:** Local developer-tool boards backed by GSD milestone state
**Researched:** 2026-05-18
**Confidence:** HIGH

## Executive Summary

v1.8 should be a dogfood milestone, not a broad new feature build. AOF already has the necessary board stack: file-backed canonical board state, typed GSD backend calls, board doctor/validation, setup UI routes, and a boards UI. The milestone should use those surfaces on the AOF repo itself, keep the resulting board state, and fix confirmed workflow failures.

The live board anchor already exists at `.aof/boards/coordination/BOARD.json`. It is GSD-backed, uses Codex runtime fallback for interactive milestone work, and is currently waiting for milestone attachment. After requirements and roadmap are approved, the board should be attached to `v1.8`, synced from `.planning/ROADMAP.md`, exercised through CLI and UI, and used for safe assignment/execution UAT.

The main risk is mistaking fixture coverage for live usability. The mitigation is to require an explicit UAT log, cross-check CLI/UI/API/canonical JSON state, and tie each confirmed finding to a fix, regression test, or documented deferral.

## Key Findings

### Recommended Stack

Use the existing stack only. No new dependencies are recommended.

**Core technologies:**
- Node.js ESM CLI: board command orchestration.
- `.aof/boards` JSON files: canonical board, task, and execution state.
- `@gsd-build/sdk` adapter boundary: typed state, roadmap, milestone, and phase execution integration.
- React/Vite boards UI: visual board UAT.
- Existing Node/BDD/PowerShell/UI build checks: regression and parity verification.

### Expected Features

**Must have:**
- Real `coordination` board remains project state.
- Board attaches to `v1.8` after roadmap approval.
- Sync creates phase tasks from the v1.8 roadmap.
- CLI and UI agree on board/task/binding/execution state.
- Doctor/validate/index commands produce actionable human and JSON output.
- Safe assignment/execution path is exercised.
- UAT findings are fixed or explicitly deferred with rationale.

**Should have:**
- UAT script/log with reproducible command/API/UI steps.
- Regression tests for every confirmed defect.
- Verification matrix mapping requirements to evidence.

**Defer:**
- New backend implementations.
- Global task hub behavior.
- Broad UI redesign not tied to UAT failures.
- Dependency additions.

### Architecture Approach

Keep the current architecture: canonical file-backed board state, typed GSD backend, explicit milestone binding, and CLI/UI surfaces over the same domain functions. The roadmap should be ordered so board sync happens only after requirements and roadmap approval.

**Major components:**
1. Board state and domain functions in `src/boards.mjs`.
2. GSD adapter/backend and assignment execution in `src/backends/gsd-backend.mjs` and `src/board-execution.mjs`.
3. CLI and setup UI surfaces in `src/cli.mjs`, `src/setup-ui.mjs`, and `ui/src/main.tsx`.

### Critical Pitfalls

1. **Fixture success masking live UX failure** — require actual UAT steps against the real board.
2. **Premature or wrong-milestone sync** — attach and sync explicitly with `v1.8`.
3. **Internal bridge skill leakage** — keep `aof-board-milestone-bridge` out of rendered AOF resources.
4. **CLI/UI state disagreement** — cross-check CLI output, UI API, and canonical files.
5. **Unbounded assignment execution** — use a safe phase or explicitly bounded execution path.

## Implications for Roadmap

Suggested phase structure:

### Phase 39: Board Dogfood Requirements And Live State Baseline
**Rationale:** Establish the real board and expected UAT evidence before changing behavior.
**Delivers:** Requirements, baseline board/doctor/validate output, and UAT log scaffold.
**Addresses:** Real board state, failure capture, verification expectations.

### Phase 40: Board Attachment And Sync UAT
**Rationale:** The board cannot become useful until the approved roadmap is attached and synced.
**Delivers:** `coordination` attached to v1.8, synced phase tasks, attach/sync regression coverage for any findings.
**Avoids:** Wrong milestone and premature sync pitfalls.

### Phase 41: Boards UI Dogfood
**Rationale:** The user-facing board workflow must work through the UI, not just CLI/API.
**Delivers:** UI/API parity checks, usability fixes for confirmed findings, UI build verification.
**Implements:** Board mode over canonical state.

### Phase 42: Assignment And Execution UAT
**Rationale:** Task assignment is the workflow that turns boards from tracking into execution.
**Delivers:** Safe assignment/execution evidence, failure handling, execution status updates, tests.
**Uses:** `src/board-execution.mjs` and SDK `runPhase()` path where safe.

### Phase 43: UAT Findings Hardening And Closeout
**Rationale:** Dogfood only matters if findings are resolved and verified.
**Delivers:** Finding fixes, regression suite, PowerShell parity as relevant, UAT report, milestone audit/archive.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Directly inspected local implementation. |
| Features | HIGH | User scope is clear and maps to existing board capabilities. |
| Architecture | HIGH | Current modules expose the required flows. |
| Pitfalls | HIGH | Risks are visible in current state and v1.7 design constraints. |

**Overall confidence:** HIGH

## Gaps To Address During Execution

- Determine whether a real assignment run is safe for the selected phase; otherwise use a controlled execution update and document the boundary.
- Verify visual UI behavior with the running boards UI once implementation reaches the UI dogfood phase.
- Watch dirty worktree state carefully; multiple existing changes predate this milestone initialization.

## Sources

### Primary
- `src/boards.mjs`
- `src/cli.mjs`
- `src/board-execution.mjs`
- `src/gsd-runtime-fallback.mjs`
- `src/setup-ui.mjs`
- `ui/src/main.tsx`
- `test/boards.test.mjs`
- `test/integration/features/boards.feature`
- `.aof/boards/coordination/BOARD.json`

---
*Research completed: 2026-05-18*
*Ready for roadmap: yes*
