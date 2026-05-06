# Requirements: AOF

**Defined:** 2026-05-06
**Core Value:** Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## v1 Requirements

### Workspace

- [x] **WORK-01**: User can initialize a repo-local `.aof/` workspace. — Validated in Phase 1.
- [x] **WORK-02**: User can store AOF configuration, source assets, runtime overrides, and lock state under `.aof/`. — Validated in Phase 1.
- [x] **WORK-03**: User can migrate or reconcile existing root `aof.config.json` data into the `.aof/` model. — Validated in Phase 1.

### Assets

- [x] **ASST-01**: User can define assistant skills once in AOF. — Validated in Phase 1.
- [x] **ASST-02**: User can define assistant commands once in AOF. — Validated in Phase 1.
- [x] **ASST-03**: User can define assistant agents once in AOF. — Validated in Phase 1.
- [x] **ASST-04**: User can define shared rules/instructions once in AOF. — Validated in Phase 1.
- [x] **ASST-05**: User can assign runtime targets per asset. — Validated in Phase 1.

### Runtime Overrides

- [x] **RTOV-01**: User can define shared defaults for an asset. — Validated in Phase 1.
- [x] **RTOV-02**: User can define Claude Code-specific overrides. — Validated in Phase 1.
- [x] **RTOV-03**: User can define Codex-specific overrides. — Validated in Phase 1.
- [ ] **RTOV-04**: User can see when an asset capability is runtime-specific or unsupported for a target runtime.

### Rendering

- [ ] **REND-01**: User can render `.aof/` assets into Claude Code folder layout.
- [ ] **REND-02**: User can render `.aof/` assets into Codex folder layout.
- [ ] **REND-03**: Generated `.claude/` and `.codex/` files are treated as output, not source of truth.
- [ ] **REND-04**: User can dry-run rendering before writing files.

### Frameworks

- [ ] **FRAM-01**: User can declare GSD as a managed framework package in AOF.
- [ ] **FRAM-02**: User can install or preview GSD setup for Claude Code.
- [ ] **FRAM-03**: User can install or preview GSD setup for Codex.
- [ ] **FRAM-04**: Lock state records managed framework install intent.

### CLI

- [ ] **CLI-01**: User can run automation-friendly commands for init, apply, install, and catalog/config inspection.
- [ ] **CLI-02**: User can use an interactive install-oriented flow.
- [ ] **CLI-03**: User receives clear output about what files will be written or changed.
- [ ] **CLI-04**: User can reproduce an install from lock state.

### UI

- [ ] **UI-01**: User can edit `.aof/` configuration through the setup UI.
- [ ] **UI-02**: User can create and edit skills, commands, agents, and rules/instructions in the UI.
- [ ] **UI-03**: User can configure runtime targets and runtime-specific overrides in the UI.
- [ ] **UI-04**: UI clearly shows runtime capability differences before config is applied.
- [ ] **UI-05**: UI v1 writes valid configuration but does not execute init/apply/install actions.

### Verification

- [ ] **VERI-01**: Existing CLI behavior remains covered by unit and BDD integration tests.
- [ ] **VERI-02**: `.aof/` config parsing, rendering, runtime overrides, and lock state are covered by tests.
- [ ] **VERI-03**: UI configuration editing paths are covered by build or targeted tests.

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Task Management

- **TASK-01**: User can create kanban boards for project/task tracking.
- **TASK-02**: User can assign tasks to assistant agents.
- **TASK-03**: User can see agent execution progress.

### Runtime Expansion

- **RUNT-01**: User can add additional assistant runtimes through an adapter/plugin model.
- **RUNT-02**: User can execute init/apply/install actions from the setup UI.
- **RUNT-03**: User can target assistants beyond Claude Code and Codex.

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Treating `.claude/` or `.codex/` as source of truth | Runtime folders should be generated output from `.aof/` to avoid drift |
| Full task management in v1 | Kanban and agent task assignment depend on a stable assistant configuration foundation |
| UI execution of install/apply commands in v1 | CLI remains the execution boundary while UI focuses on valid config creation |
| Concrete support for assistants beyond Claude Code and Codex in v1 | Focuses implementation on the immediate runtimes while keeping the model extensible |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| WORK-01 | Phase 1 | Complete |
| WORK-02 | Phase 1 | Complete |
| WORK-03 | Phase 1 | Complete |
| ASST-01 | Phase 1 | Complete |
| ASST-02 | Phase 1 | Complete |
| ASST-03 | Phase 1 | Complete |
| ASST-04 | Phase 1 | Complete |
| ASST-05 | Phase 1 | Complete |
| RTOV-01 | Phase 1 | Complete |
| RTOV-02 | Phase 1 | Complete |
| RTOV-03 | Phase 1 | Complete |
| RTOV-04 | Phase 4 | Pending |
| REND-01 | Phase 2 | Pending |
| REND-02 | Phase 2 | Pending |
| REND-03 | Phase 2 | Pending |
| REND-04 | Phase 2 | Pending |
| FRAM-01 | Phase 3 | Pending |
| FRAM-02 | Phase 3 | Pending |
| FRAM-03 | Phase 3 | Pending |
| FRAM-04 | Phase 2 | Pending |
| CLI-01 | Phase 3 | Pending |
| CLI-02 | Phase 3 | Pending |
| CLI-03 | Phase 2 | Pending |
| CLI-04 | Phase 2 | Pending |
| UI-01 | Phase 4 | Pending |
| UI-02 | Phase 4 | Pending |
| UI-03 | Phase 4 | Pending |
| UI-04 | Phase 4 | Pending |
| UI-05 | Phase 4 | Pending |
| VERI-01 | Phase 5 | Pending |
| VERI-02 | Phase 5 | Pending |
| VERI-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 32 total
- Mapped to phases: 32
- Unmapped: 0

---
*Requirements defined: 2026-05-06*
*Last updated: 2026-05-06 after Phase 1 verification*
