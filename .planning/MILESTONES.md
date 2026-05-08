# Milestones: AOF

## v1 — Assistant Configuration Foundation

**Status:** Shipped 2026-05-07
**Phases:** 1-5
**Plans:** 15
**Requirements:** 32/32 complete
**Audit:** Passed

### Delivered

AOF now lets users define assistant-facing assets once in `.aof/`, render them to Claude Code and Codex, manage lock state and GSD install intent, edit configuration through the setup UI, and verify the full v1 behavior through unit, BDD, smoke, and UI build checks.

### Key Accomplishments

1. Established `.aof/` as the repo-local source of truth for configuration, source assets, runtime overrides, and lock state.
2. Added runtime rendering, dry-run planning, drift protection, stale pruning, deterministic Codex rule merging, and lock replay behavior.
3. Added automation-friendly CLI inspection/install flows plus interactive setup selection and GSD package intent handling.
4. Reworked the setup UI into a `.aof` configuration editor with runtime capability visibility and config-only execution boundaries.
5. Hardened diagnostics, setup UI request/static handling, cross-platform smoke coverage, and closeout verification.

### Archives

- [v1-ROADMAP.md](milestones/v1-ROADMAP.md)
- [v1-REQUIREMENTS.md](milestones/v1-REQUIREMENTS.md)
- [v1-MILESTONE-AUDIT.md](milestones/v1-MILESTONE-AUDIT.md)

### Known Deferred Items

None.

## v1.1 — Aligned Core Hardening

**Status:** Shipped 2026-05-08
**Started:** 2026-05-07
**Completed:** 2026-05-08
**Phases:** 6-10
**Requirements:** 22/22 complete
**Audit:** Tech debt accepted - missing Nyquist validation artifacts for phases 6-10

### Goal

Turn AOF's shipped Claude/Codex configuration foundation into a stricter aligned-core DSL and CLI lifecycle that is easier to validate, synchronize, diagnose, and extend.

### Planned Scope

1. Add first-class CLI lifecycle commands for scaffold, sync, validate, doctor, and clean.
2. Expand `.aof/` primitives to cover MCP servers, hooks, project docs, and settings.
3. Formalize adapter degradation warnings, inlining behavior, pass-through extensions, and strict mode.
4. Add framework package source descriptors, namespace enforcement, dependency lock state, and conflict detection.
5. Expand BDD coverage for lifecycle, primitives, packages, and degradation behavior.

### Progress

- Phase 6: CLI Lifecycle Commands — complete 2026-05-07.
- Phase 7: Expanded DSL Primitives — complete 2026-05-07.
- Phase 8: Adapter Degradation Policy — complete 2026-05-08.
- Phase 9: Framework Package Semantics — complete 2026-05-08.
- Phase 10: BDD Parity And Hardening — complete 2026-05-08.

### Audit

- [v1.1-MILESTONE-AUDIT.md](milestones/v1.1-MILESTONE-AUDIT.md)

### Archives

- [v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)
- [v1.1-REQUIREMENTS.md](milestones/v1.1-REQUIREMENTS.md)
- [v1.1-MILESTONE-AUDIT.md](milestones/v1.1-MILESTONE-AUDIT.md)

### Known Deferred Items

- Formal Nyquist validation artifacts were not generated for phases 6-10. Product requirements and cross-phase flows are complete; this is accepted process debt.
- Browser E2E, additional runtimes, Rust/native core, UI execution, hosted registry, external package archive extraction, and task management remain future scope.
