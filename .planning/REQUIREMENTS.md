# Requirements: AOF v1.8 AOF Boards Dogfood UAT

**Defined:** 2026-05-18
**Core Value:** Users can configure assistant skills, commands, agents, rules/instructions, workflows, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## v1.8 Requirements

Requirements for the AOF Boards Dogfood UAT milestone. Each requirement maps to exactly one roadmap phase.

### Board Lifecycle

- [x] **BOARD-01**: User can keep the real `coordination` board as durable AOF project state for v1.8.
- [x] **BOARD-02**: User can attach `coordination` to milestone `v1.8` and `.planning/ROADMAP.md`.
- [x] **BOARD-03**: User can sync `coordination` from the v1.8 roadmap into phase-backed board tasks.
- [x] **BOARD-04**: User receives clear errors when syncing before attach or with the wrong milestone.

### CLI UAT

- [x] **CLI-01**: User can run `aof boards list/show/validate/index/doctor` against the real board.
- [x] **CLI-02**: User can inspect human and JSON output for board health and next actions.
- [x] **CLI-03**: User can verify CLI output matches canonical `.aof/boards` state.
- [x] **CLI-04**: User can capture command-level UAT evidence with repro steps and outcomes.

### Boards UI

- [x] **UI-01**: User can open `aof boards ui` and view the real `coordination` board.
- [x] **UI-02**: User can verify UI board/task/binding state matches CLI and API state.
- [x] **UI-03**: User can move tasks or update visible board state through the UI where supported.
- [x] **UI-04**: User can see actionable repair/sync/assignment feedback when board state is incomplete or unhealthy.

### Assignment And Execution

- [ ] **EXEC-01**: User can list configured board agents for the AOF project.
- [ ] **EXEC-02**: User can assign a synced phase task to a configured agent when safe.
- [ ] **EXEC-03**: User can inspect execution records and task execution summaries after assignment.
- [ ] **EXEC-04**: User can update execution status for blocked/waiting/complete handoff states.

### Findings And Fixes

- [x] **FIX-01**: User can record every confirmed UAT finding with ID, repro, severity, and expected behavior.
- [ ] **FIX-02**: User can trace each confirmed finding to a fix, regression test, or explicit deferral.
- [ ] **FIX-03**: User can verify internal bridge assets do not leak into rendered runtime assets.
- [ ] **FIX-04**: User can rerun affected UAT steps after fixes and see passing results.

### Verification

- [ ] **VER-01**: User can run focused board unit and integration tests after fixes.
- [ ] **VER-02**: User can run UI build/API verification when UI files or board UI behavior change.
- [ ] **VER-03**: User can run PowerShell parity checks for changed board CLI behavior.
- [ ] **VER-04**: User can close the milestone with a UAT report, requirement coverage, and roadmap traceability.

## Future Requirements

Deferred to future milestones. Tracked but not in the current roadmap.

### Task Management Expansion

- **TASK-01**: User can synchronize task boards across projects or a global task hub.
- **TASK-02**: User can configure richer board execution policies before assignment runs.
- **TASK-03**: User can use alternative non-GSD execution backends for board tasks.

### Board UI Expansion

- **BUI-01**: User can use event-streamed SDK lifecycle output inside the boards UI.
- **BUI-02**: User can perform broader board analytics or reporting beyond milestone UAT needs.

## Out of Scope

Explicitly excluded from v1.8.

| Feature | Reason |
|---------|--------|
| Disposable-only board testing | User selected a real board; this milestone must dogfood durable AOF board state. |
| New dependency adoption | Research found no required package additions, and supply-chain rules require restraint. |
| New real board backend | v1.8 validates the GSD backend built in v1.7 rather than expanding backend scope. |
| Global task hub | Important future direction, but outside the live AOF repo dogfood slice. |
| Broad UI redesign | Only confirmed UAT failures should drive UI changes in this milestone. |
| Unbounded automatic phase execution | Assignment/execution UAT must be safe and bounded for the live repo. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| BOARD-01 | Phase 39 | Complete |
| BOARD-02 | Phase 40 | Complete |
| BOARD-03 | Phase 40 | Complete |
| BOARD-04 | Phase 40 | Complete |
| CLI-01 | Phase 39 | Complete |
| CLI-02 | Phase 39 | Complete |
| CLI-03 | Phase 39 | Complete |
| CLI-04 | Phase 39 | Complete |
| UI-01 | Phase 41 | Complete |
| UI-02 | Phase 41 | Complete |
| UI-03 | Phase 41 | Complete |
| UI-04 | Phase 41 | Complete |
| EXEC-01 | Phase 42 | Pending |
| EXEC-02 | Phase 42 | Pending |
| EXEC-03 | Phase 42 | Pending |
| EXEC-04 | Phase 42 | Pending |
| FIX-01 | Phase 39 | Complete |
| FIX-02 | Phase 43 | Pending |
| FIX-03 | Phase 43 | Pending |
| FIX-04 | Phase 43 | Pending |
| VER-01 | Phase 43 | Pending |
| VER-02 | Phase 43 | Pending |
| VER-03 | Phase 43 | Pending |
| VER-04 | Phase 43 | Pending |

**Coverage:**

- v1.8 requirements: 24 total
- Mapped to phases: 24
- Unmapped: 0

---
*Requirements defined: 2026-05-18*
*Last updated: 2026-05-18 after roadmap creation*
