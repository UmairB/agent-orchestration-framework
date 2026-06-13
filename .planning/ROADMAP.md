# Roadmap: AOF

**Created:** 2026-05-06
**Last updated:** 2026-05-22 after phase 41 planning

## Milestones

- ✅ **v1 Assistant Configuration Foundation** — Phases 1-5, shipped 2026-05-07. Archive: [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- ✅ **v1.1 Aligned Core Hardening** — Phases 6-10, shipped 2026-05-08. Archive: [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Global Asset Library** — Phases 11-15, shipped 2026-05-09. Archive: [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Interactive CLI Hardening** — Phases 16-17, shipped 2026-05-09. Archive: [v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 Namespaced CLI Contract** — Phases 18-22, shipped 2026-05-11. Archive: [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Runtime Semantics And Workflow Assets** — Phases 23-27, shipped 2026-05-14. Archive: [v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md)
- ✅ **v1.6 Task Management** — Phases 28-32, shipped 2026-05-15. Archive: [v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md)
- ✅ **v1.7 Typed GSD SDK Backend** — Phases 33-38, shipped 2026-05-17. Archive: [v1.7-ROADMAP.md](milestones/v1.7-ROADMAP.md)
- 🔄 **v1.8 AOF Boards Dogfood UAT** — Phases 39-43, active. Goal: use `aof boards` on AOF itself as a real planning/execution board and fix confirmed UAT findings.

## Phases

<details>
<summary>✅ Shipped Milestones (Phases 1-38)</summary>

Detailed milestone roadmaps are archived under `.planning/milestones/`.

- v1: Phases 1-5 — Assistant Configuration Foundation
- v1.1: Phases 6-10 — Aligned Core Hardening
- v1.2: Phases 11-15 — Global Asset Library
- v1.3: Phases 16-17 — Interactive CLI Hardening
- v1.4: Phases 18-22 — Namespaced CLI Contract
- v1.5: Phases 23-27 — Runtime Semantics And Workflow Assets
- v1.6: Phases 28-32 — Task Management
- v1.7: Phases 33-38 — Typed GSD SDK Backend

</details>

### Phase 39: Board Dogfood Requirements And Live State Baseline

**Goal:** Establish the real `coordination` board as the v1.8 dogfood anchor, capture baseline board health, and prepare UAT evidence tracking before behavior changes.

**Requirements:** BOARD-01, CLI-01, CLI-02, CLI-03, CLI-04, FIX-01

**Success criteria:**

1. The `coordination` board is confirmed as real project state with its canonical `.aof/boards/coordination/BOARD.json` preserved.
2. Baseline CLI output is captured for `aof boards list`, `show`, `validate`, `index`, and `doctor` in human and JSON forms where supported.
3. Baseline output is compared against canonical board JSON and any mismatches are logged as UAT findings.
4. A v1.8 UAT log exists with finding IDs, repro steps, severity, expected behavior, and resolution status.

### Phase 40: Board Attachment And Sync UAT

**Goal:** Attach the live `coordination` board to milestone `v1.8`, sync roadmap phases into phase-backed tasks, and verify milestone binding failures and success paths.

**Requirements:** BOARD-02, BOARD-03, BOARD-04

**Success criteria:**

1. `aof boards milestone attach coordination --milestone v1.8 --roadmap .planning/ROADMAP.md` binds the board to the active milestone.
2. `aof boards sync coordination --milestone v1.8` creates one board task per v1.8 roadmap phase.
3. Sync before attach, missing milestone arguments, and wrong milestone arguments produce clear human and JSON errors with next actions.
4. Board doctor reports the expected binding and task sync health after attach/sync.

### Phase 41: Boards UI Dogfood

**Goal:** Use `aof boards ui` against the real board and verify the UI/API surface stays consistent with CLI output and canonical board files.

**Requirements:** UI-01, UI-02, UI-03, UI-04

**Plans:** 0/3 plans complete

Plans:

- [ ] 41-01-PLAN.md — TypeScript UI build + server startup + mount-time API verification
- [ ] 41-02-PLAN.md — Sync bug fix + sync round-trip + task status mutation round-trip + execution reads
- [ ] 41-03-PLAN.md — Evidence documentation + UAT log update + requirements completion

**Success criteria:**

1. The boards UI opens for the AOF repo and displays the `coordination` board and synced phase tasks.
2. UI state for task columns, binding status, execution status, and next actions matches CLI/API/canonical JSON.
3. Supported task moves or state updates made through the UI persist to canonical board files.
4. Repair, sync, assignment, and incomplete-state feedback is actionable when surfaced in the UI.
5. Any confirmed UI defects receive targeted regression coverage and `npm run ui:build` verification.

### Phase 42: Assignment And Execution UAT

**Goal:** Validate that synced phase tasks can move from tracking to execution through configured agents, execution records, and safe status updates.

**Requirements:** EXEC-01, EXEC-02, EXEC-03, EXEC-04

**Success criteria:**

1. `aof boards agents` lists configured board agents for the AOF project.
2. A synced phase task can be assigned to a configured agent when the selected execution path is safe.
3. Assignment writes an execution record and updates the task summary without corrupting board state.
4. Blocked, waiting, failed, and complete execution statuses can be inspected and updated.
5. If full live `runPhase()` execution is unsafe for the selected task, the boundary is documented and a controlled execution-status path is verified instead.

### Phase 43: UAT Findings Hardening And Closeout

**Goal:** Resolve confirmed dogfood findings, verify the complete v1.8 board workflow, and close the milestone with traceable evidence.

**Requirements:** FIX-02, FIX-03, FIX-04, VER-01, VER-02, VER-03, VER-04

**Success criteria:**

1. Every confirmed UAT finding is linked to a fix, regression test, or explicit deferral with rationale.
2. Internal bridge assets are verified not to leak into rendered Claude or Codex runtime assets.
3. Affected UAT steps are rerun after fixes and recorded as passing or explicitly deferred.
4. Focused board unit/integration tests pass after fixes.
5. UI build/API verification and PowerShell parity checks run when touched surfaces require them.
6. The milestone closes with a UAT report, requirement coverage, roadmap traceability, and archive-ready planning artifacts.

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
| v1.7 Typed GSD SDK Backend | 33-38 | 19/19 | 46/46 | Complete | 2026-05-17 |
| v1.8 AOF Boards Dogfood UAT | 39-43 | 3/3 (phase 41) | 0/24 | Planning | — |

## Next

Start with Phase 39: Board Dogfood Requirements And Live State Baseline.
