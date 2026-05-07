# Requirements: AOF

**Defined:** 2026-05-07
**Milestone:** v1.1 Aligned Core Hardening
**Core Value:** Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## v1.1 Requirements

### CLI Lifecycle

- [x] **CLI-05**: User can scaffold a new `.aof/` primitive from the CLI without hand-editing JSON. Validated in Phase 6.
- [x] **CLI-06**: User can run one command that reconciles declared packages and generated runtime outputs. Validated in Phase 6.
- [x] **CLI-07**: User can validate `.aof/` configuration and DSL source files with machine-readable diagnostics. Validated in Phase 6.
- [x] **CLI-08**: User can diagnose project setup issues including stale lock state, package drift, missing assistant support, and unwritable outputs. Validated in Phase 6.
- [x] **CLI-09**: User can remove generated outputs owned by AOF without deleting source `.aof/` files. Validated in Phase 6.

### DSL Primitives

- [x] **DSL-01**: User can define MCP servers in `.aof/` and render them to supported Claude Code and Codex configuration outputs. Validated in Phase 7.
- [x] **DSL-02**: User can define common-core hooks in `.aof/` and render them to supported Claude Code and Codex hook outputs. Validated in Phase 7.
- [x] **DSL-03**: User can define project documentation in `.aof/` and render it to AGENTS.md and CLAUDE.md with deterministic include behavior. Validated in Phase 7.
- [x] **DSL-04**: User can define project-level settings in `.aof/` with vendor-neutral defaults and runtime-specific escape hatches. Validated in Phase 7.
- [x] **DSL-05**: User can continue using existing v1 skills, commands, agents, and rules through the expanded DSL model without migration regressions. Validated in Phase 7.

### Adapter Degradation

- [ ] **ADPT-01**: User receives explicit warnings when a primitive or feature is skipped for an unsupported runtime.
- [ ] **ADPT-02**: User receives explicit warnings when a primitive is inlined into a less precise runtime output.
- [ ] **ADPT-03**: User can use runtime-namespaced extensions that pass through only to matching targets.
- [ ] **ADPT-04**: User can promote adapter warnings to command failures with strict mode for CI use.

### Framework Packages

- [ ] **PKG-01**: User can install framework packages from npm, git, or local file sources through a consistent package descriptor.
- [ ] **PKG-02**: User can rely on package namespaces being enforced for emitted files to avoid path collisions.
- [ ] **PKG-03**: User can declare package dependencies and record resolved package versions in lock state.
- [ ] **PKG-04**: User is blocked before writes when multiple packages or local primitives would claim the same generated output path.

### Verification

- [ ] **BDD-01**: CLI lifecycle behavior for init, add, sync, validate, doctor, and clean is covered by BDD scenarios.
- [ ] **BDD-02**: Compile/render behavior for all v1.1 primitives is covered by BDD scenarios across Claude Code and Codex targets.
- [ ] **BDD-03**: Framework package install, dependency, lock, and conflict behavior is covered by BDD scenarios.
- [ ] **BDD-04**: Adapter degradation warnings and strict-mode failures are covered by BDD scenarios.

## Future Requirements

### Runtime Expansion

- **RUNT-03**: User can target assistants beyond Claude Code and Codex.
- **RUNT-04**: User can target Cursor path-scoped rules.
- **RUNT-05**: User can target Aider through AGENTS.md wiring.
- **RUNT-06**: User can target GitHub Copilot, Continue, Windsurf, or Gemini CLI from the same model.

### Runtime Core

- **CORE-01**: AOF can expose a Rust parser/compiler core after the TypeScript behavior is stabilized by BDD coverage.
- **CORE-02**: AOF can ship as a native single binary when the Rust core and CLI shell are mature.

### UI And Ecosystem

- **UI-06**: User can execute safe CLI actions from the setup UI.
- **ECO-01**: User can browse framework packages through a discovery UI or registry.
- **TASK-01**: User can create kanban boards for project/task tracking.
- **TASK-02**: User can assign tasks to assistant agents.
- **TASK-03**: User can see agent execution progress.

## Out of Scope

| Feature | Reason |
|---------|--------|
| Runtime support beyond Claude Code and Codex | v1.1 hardens the aligned core before adding more adapters. |
| Rust port or native binary | The architecture review recommends stabilizing TypeScript behavior and shared BDD coverage first. |
| UI execution of CLI actions | Still deferred until the CLI lifecycle is more complete and predictable. |
| Hosted package registry | Package distribution can use npm, git, and file sources for this milestone. |
| Assistant execution or orchestration | AOF manages configuration and generated files, not running coding assistants. |
| Prompt authoring assistance | The milestone improves the DSL and lifecycle, not prompt generation quality. |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| CLI-05 | Phase 6 | Complete |
| CLI-06 | Phase 6 | Complete |
| CLI-07 | Phase 6 | Complete |
| CLI-08 | Phase 6 | Complete |
| CLI-09 | Phase 6 | Complete |
| DSL-01 | Phase 7 | Complete |
| DSL-02 | Phase 7 | Complete |
| DSL-03 | Phase 7 | Complete |
| DSL-04 | Phase 7 | Complete |
| DSL-05 | Phase 7 | Complete |
| ADPT-01 | Phase 8 | Pending |
| ADPT-02 | Phase 8 | Pending |
| ADPT-03 | Phase 8 | Pending |
| ADPT-04 | Phase 8 | Pending |
| PKG-01 | Phase 9 | Pending |
| PKG-02 | Phase 9 | Pending |
| PKG-03 | Phase 9 | Pending |
| PKG-04 | Phase 9 | Pending |
| BDD-01 | Phase 10 | Pending |
| BDD-02 | Phase 10 | Pending |
| BDD-03 | Phase 10 | Pending |
| BDD-04 | Phase 10 | Pending |

**Coverage:**
- v1.1 requirements: 22 total
- Mapped to phases: 22
- Unmapped: 0

---
*Requirements defined: 2026-05-07*
*Last updated: 2026-05-07 after Phase 7 completion*
