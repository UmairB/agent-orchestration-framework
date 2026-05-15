# Requirements: AOF

**Defined:** 2026-05-15
**Milestone:** v1.6 Task Management
**Core Value:** Users can configure assistant skills, commands, agents, rules/instructions, workflows, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## v1.6 Requirements

### Boards

- [ ] **BOARD-01**: User can create more than one kanban board in a project.
- [ ] **BOARD-02**: User can tie each board to a deliverable or objective.
- [ ] **BOARD-03**: User can view board columns for task lifecycle states such as backlog, ready, in progress, blocked, and done.
- [ ] **BOARD-04**: User can archive or remove a board without deleting unrelated project planning history.

### Tasks

- [ ] **TASK-01**: User can create tasks with title, description, status, priority, and deliverable context.
- [ ] **TASK-02**: User can move tasks between lifecycle states.
- [ ] **TASK-03**: User can link tasks to GSD roadmap, phase, or plan artifacts when those links exist.
- [ ] **TASK-04**: User can inspect task history, including status changes, assignment changes, and execution outcomes.

### State And Indexing

- [ ] **STATE-01**: User can rely on project-local files as the canonical task and board state.
- [ ] **STATE-02**: User gets a generated task index/cache that can be rebuilt from canonical files.
- [ ] **STATE-03**: User receives validation errors for malformed boards, duplicate IDs, missing task references, and stale index state.
- [ ] **STATE-04**: User-facing commands and UI APIs read through the index/cache when possible while preserving file-backed correctness.

### GSD Breakdown

- [ ] **GSD-01**: User can ask AOF/GSD to break a deliverable objective into a roadmap or task set.
- [ ] **GSD-02**: User can review generated tasks before they are added to a board.
- [ ] **GSD-03**: User can keep generated tasks linked to the objective and originating GSD planning artifacts.
- [ ] **GSD-04**: User can regenerate or refresh task breakdowns without silently overwriting manually edited tasks.

### Agent Execution

- [ ] **EXEC-01**: User can assign a task to an available agent.
- [ ] **EXEC-02**: Assigning a task to an agent automatically starts the GSD execution workflow for that task.
- [ ] **EXEC-03**: User can see task execution state, including queued, running, blocked, failed, and complete.
- [ ] **EXEC-04**: User can inspect execution logs or handoff details for a task.
- [ ] **EXEC-05**: Failed or blocked task execution preserves enough context for a user or agent to resume safely.

### Setup UI

- [ ] **UI-01**: User can view project kanban boards in the setup UI.
- [ ] **UI-02**: User can create, edit, move, assign, and archive tasks from the setup UI.
- [ ] **UI-03**: User can see live or refreshed progress indicators for assigned tasks.
- [ ] **UI-04**: User can distinguish canonical task state from generated index/cache status in diagnostics.

### Verification And Hardening

- [ ] **HARD-01**: BDD scenarios cover board and task creation, movement, validation, and indexing.
- [ ] **HARD-02**: BDD scenarios cover GSD objective breakdown into reviewable board tasks.
- [ ] **HARD-03**: BDD scenarios cover agent assignment triggering execution state transitions.
- [ ] **HARD-04**: Setup UI tests cover board display, task editing, assignment, and progress rendering.
- [ ] **HARD-05**: Live UAT verifies a project deliverable can be broken down into tasks, assigned to agents, and tracked through the board.

## Future Requirements

### Global Task Hub

- **GTASK-01**: User can aggregate task boards across projects in global `~/.aof`.
- **GTASK-02**: User can synchronize project task state into a global index or database.
- **GTASK-03**: User can search, filter, and triage tasks across projects.

### Execution Policy

- **POLICY-01**: User can configure whether assignment auto-runs, queues for approval, or only records ownership.
- **POLICY-02**: User can set per-agent concurrency limits and task routing policies.

### Collaboration

- **COLLAB-01**: User can share board state with teammates without relying on local-only execution metadata.
- **COLLAB-02**: User can assign tasks to humans as well as agents.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Cross-project/global task dashboard | v1.6 starts with project-local boards; global sync needs stable project semantics first. |
| SQLite as the canonical store | Files remain canonical to match existing GSD/AOF planning workflows; cache/index is generated. |
| Human team workflow management | The immediate goal is agent-backed project execution, not a general collaboration product. |
| Arbitrary third-party issue tracker sync | External tracker integrations can build on stable board/task semantics later. |
| UI execution for asset/package install flows | v1.6 execution scope is task/agent execution, not broad CLI action execution. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOARD-01 | Phase 28 | Pending |
| BOARD-02 | Phase 28 | Pending |
| BOARD-03 | Phase 28 | Pending |
| BOARD-04 | Phase 28 | Pending |
| TASK-01 | Phase 28 | Pending |
| TASK-02 | Phase 28 | Pending |
| TASK-03 | Phase 28 | Pending |
| TASK-04 | Phase 28 | Pending |
| STATE-01 | Phase 28 | Pending |
| STATE-02 | Phase 28 | Pending |
| STATE-03 | Phase 28 | Pending |
| STATE-04 | Phase 28 | Pending |
| GSD-01 | Phase 29 | Pending |
| GSD-02 | Phase 29 | Pending |
| GSD-03 | Phase 29 | Pending |
| GSD-04 | Phase 29 | Pending |
| EXEC-01 | Phase 30 | Pending |
| EXEC-02 | Phase 30 | Pending |
| EXEC-03 | Phase 30 | Pending |
| EXEC-04 | Phase 30 | Pending |
| EXEC-05 | Phase 30 | Pending |
| UI-01 | Phase 31 | Pending |
| UI-02 | Phase 31 | Pending |
| UI-03 | Phase 31 | Pending |
| UI-04 | Phase 31 | Pending |
| HARD-01 | Phase 32 | Pending |
| HARD-02 | Phase 32 | Pending |
| HARD-03 | Phase 32 | Pending |
| HARD-04 | Phase 32 | Pending |
| HARD-05 | Phase 32 | Pending |

**Coverage:**
- v1.6 requirements: 30 total
- Mapped to phases: 30
- Unmapped: 0

---
*Requirements defined: 2026-05-15*
