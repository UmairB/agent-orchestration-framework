# Roadmap: AOF

**Created:** 2026-05-06
**Last updated:** 2026-05-15 after v1.6 roadmap creation

## Milestones

- ✅ **v1 Assistant Configuration Foundation** — Phases 1-5, shipped 2026-05-07. Archive: [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- ✅ **v1.1 Aligned Core Hardening** — Phases 6-10, shipped 2026-05-08. Archive: [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- ✅ **v1.2 Global Asset Library** — Phases 11-15, shipped 2026-05-09. Archive: [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- ✅ **v1.3 Interactive CLI Hardening** — Phases 16-17, shipped 2026-05-09. Archive: [v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- ✅ **v1.4 Namespaced CLI Contract** — Phases 18-22, shipped 2026-05-11. Archive: [v1.4-ROADMAP.md](milestones/v1.4-ROADMAP.md)
- ✅ **v1.5 Runtime Semantics And Workflow Assets** — Phases 23-27, shipped 2026-05-14. Archive: [v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md)
- 🚧 **v1.6 Task Management** — Phases 28-32, in progress.

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

## Progress

| Milestone | Phases | Plans | Requirements | Status | Shipped |
|-----------|--------|-------|--------------|--------|---------|
| v1 Assistant Configuration Foundation | 1-5 | 15/15 | 32/32 | Complete | 2026-05-07 |
| v1.1 Aligned Core Hardening | 6-10 | 16/16 | 22/22 | Complete | 2026-05-08 |
| v1.2 Global Asset Library | 11-15 | 15/15 | 22/22 | Complete | 2026-05-09 |
| v1.3 Interactive CLI Hardening | 16-17 | 3/3 | 12/12 | Complete | 2026-05-09 |
| v1.4 Namespaced CLI Contract | 18-22 | 9/9 | 22/22 | Complete | 2026-05-11 |
| v1.5 Runtime Semantics And Workflow Assets | 23-27 | 13/13 | 24/24 | Complete | 2026-05-14 |
| v1.6 Task Management | 28-32 | 3/15 | 12/30 | In progress | - |

## Phase Details

### Phase 28: Board And Task State Foundation ✅

**Goal:** Define the canonical project-local board/task file model, validation rules, CLI/API access, and generated index/cache.

**Requirements:** BOARD-01, BOARD-02, BOARD-03, BOARD-04, TASK-01, TASK-02, TASK-03, TASK-04, STATE-01, STATE-02, STATE-03, STATE-04

**Success Criteria:**
1. Projects can contain multiple deliverable-scoped boards with stable IDs and lifecycle columns.
2. Tasks can be created, moved, linked, archived, and inspected through file-backed state.
3. A generated index/cache can be rebuilt from canonical task files and used by UI/API callers.
4. Validation catches malformed board/task files, duplicate IDs, missing links, and stale index state.

**Plans:**
- ✅ [Wave 1: Board/task schema and canonical file layout](phases/28-board-and-task-state-foundation/28-01-PLAN.md)
- ✅ [Wave 2: Task index/cache generation and validation](phases/28-board-and-task-state-foundation/28-02-PLAN.md)
- ✅ [Wave 3: CLI and setup UI API foundation with BDD coverage](phases/28-board-and-task-state-foundation/28-03-PLAN.md)

**Verification:** [28-VERIFICATION.md](phases/28-board-and-task-state-foundation/28-VERIFICATION.md)

### Phase 29: GSD Objective Breakdown

**Goal:** Let users turn a deliverable objective into reviewable board tasks using GSD planning semantics.

**Requirements:** GSD-01, GSD-02, GSD-03, GSD-04

**Success Criteria:**
1. A deliverable objective can produce a proposed roadmap/task breakdown.
2. Generated tasks are reviewable before they are written to a board.
3. Accepted tasks retain links to the objective and originating GSD artifacts.
4. Regeneration protects manually edited tasks from silent overwrite.

**Plans:**
- Wave 1: Objective intake and GSD breakdown adapter
- Wave 2: Review/apply workflow for generated tasks
- Wave 3: Refresh, conflict handling, and BDD coverage

### Phase 30: Agent Assignment And Execution

**Goal:** Connect task assignment to GSD agent execution and persist progress, logs, failures, and resume context.

**Requirements:** EXEC-01, EXEC-02, EXEC-03, EXEC-04, EXEC-05

**Success Criteria:**
1. Users can assign a task to an available agent.
2. Assignment automatically starts the appropriate GSD execution workflow.
3. Task state records queued, running, blocked, failed, and complete execution states.
4. Execution logs and handoff context are inspectable and resumable.

**Plans:**
- Wave 1: Agent registry and assignment model
- Wave 2: Auto-run execution lifecycle integration
- Wave 3: Failure/resume state, logs, and BDD coverage

### Phase 31: Kanban Setup UI

**Goal:** Add the project kanban board surface to the setup UI with task editing, assignment, and progress visibility.

**Requirements:** UI-01, UI-02, UI-03, UI-04

**Success Criteria:**
1. The setup UI displays project boards and task columns without losing existing asset/package editing flows.
2. Users can create, edit, move, assign, and archive tasks from the UI.
3. Assigned tasks show refreshed progress and execution state.
4. Diagnostics distinguish canonical file state from generated index/cache state.

**Plans:**
- Wave 1: Board navigation and task column layout
- Wave 2: Task editing, movement, and assignment controls
- Wave 3: Progress/diagnostics rendering, UI build, and setup UI tests

### Phase 32: Task Management Verification

**Goal:** Harden the full task-management slice with BDD, UI tests, and live UAT against a real deliverable workflow.

**Requirements:** HARD-01, HARD-02, HARD-03, HARD-04, HARD-05

**Success Criteria:**
1. Node BDD covers board/task lifecycle, validation, and indexing.
2. BDD covers GSD objective breakdown into reviewable board tasks.
3. BDD covers agent assignment and execution state transitions.
4. Setup UI tests cover board display, task editing, assignment, and progress rendering.
5. Live UAT verifies a deliverable can be broken down, assigned to agents, and tracked through the board.

**Plans:**
- Wave 1: Coverage audit and missing BDD scenarios
- Wave 2: Setup UI and execution-progress verification
- Wave 3: Live UAT, documentation, and milestone hardening

## Next

Continue with Phase 29: GSD Objective Breakdown.
