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

## v1.2 — Global Asset Library

**Status:** Shipped 2026-05-09
**Started:** 2026-05-08
**Completed:** 2026-05-09
**Phases:** 11-15
**Requirements:** 22/22 complete
**Audit:** Passed

### Goal

Let users create reusable global AOF assets once in `~/.aof` and reference them from any project without copying them into project-local `.aof`.

### Delivered

1. Added `~/.aof` global source workspace resolution with `AOF_GLOBAL_HOME` test override support.
2. Added `aof global add/list/show/validate` flows for global skills, agents, and rules.
3. Added project `globalRefs` so local projects reference global assets without copying source files.
4. Rendered referenced global assets through `apply` and `sync` with source scope recorded in lock state.
5. Supported explicit associated files for code-bearing global skill assets, including validation and drift protection.
6. Added setup UI Project/Global scope support, global asset editing, global skill helper-file editing, and project global-reference management.
7. Completed unit, Node BDD, Windows PowerShell BDD, setup UI API, and UI build verification.

### Audit

- [v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md)

### Archives

- [v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)
- [v1.2-REQUIREMENTS.md](milestones/v1.2-REQUIREMENTS.md)
- [v1.2-MILESTONE-AUDIT.md](milestones/v1.2-MILESTONE-AUDIT.md)

### Known Deferred Items

- Hosted global asset discovery or publishing.
- Cross-machine synchronization of `~/.aof`.
- Vendoring global assets into project `.aof` snapshots.
- Semantic version pinning and upgrade workflows for global references.
- Runtime support beyond Claude Code and Codex.
- UI-driven execution for init/apply/install.

## v1.3 — Interactive CLI Hardening

**Status:** Shipped 2026-05-09
**Started:** 2026-05-09
**Completed:** 2026-05-09
**Phases:** 16-17
**Requirements:** 12/12 complete
**Audit:** Passed

### Goal

Harden AOF's live first-run behavior and replace rough typed prompts with keyboard-driven interactive CLI flows while keeping project/global asset creation explicit.

### Delivered

1. Removed active SQLite catalog initialization and eliminated first-run SQLite warnings.
2. Disabled seeded repository defaults so new projects start with empty `.aof` state.
3. Added explicit disabled-catalog guidance for catalog-backed commands.
4. Added `@inquirer/prompts` for runtime selection, confirmations, and asset creation prompts.
5. Added interactive `aof add` for project skills, commands, agents, and rules.
6. Added interactive `aof global add` for global skills, agents, and rules.
7. Preserved direct flag-based commands and deterministic BDD prompt inputs.

### Audit

- [v1.3-MILESTONE-AUDIT.md](milestones/v1.3-MILESTONE-AUDIT.md)

### Archives

- [v1.3-ROADMAP.md](milestones/v1.3-ROADMAP.md)
- [v1.3-REQUIREMENTS.md](milestones/v1.3-REQUIREMENTS.md)
- [v1.3-MILESTONE-AUDIT.md](milestones/v1.3-MILESTONE-AUDIT.md)

### Known Deferred Items

- `aof install --interactive` redesign.
- Hosted catalog or registry-backed asset discovery.
- Additional live-repository hardening when new concrete findings appear.

## v1.4 — Namespaced CLI Contract

**Status:** Active
**Started:** 2026-05-10
**Phases:** 18-22
**Requirements:** 0/22 complete

### Goal

Redesign AOF's CLI around durable product-area namespaces, review every command contract explicitly, remove legacy command ambiguity, and harden the rewritten CLI against live repository workflows.

### Planned Scope

1. Review every current command and subcommand before implementation.
2. Replace overloaded top-level asset commands with `aof assets ...`.
3. Replace GSD install flows with `aof packages ...`.
4. Keep `aof init` top-level and limited to project workspace initialization.
5. Remove legacy aliases instead of preserving deprecated command paths.
6. Validate the final command surface through live repository workflows and BDD coverage.

### Progress

- Phase 18: Command Contract Audit — pending discussion.
- Phase 19: Assets Namespace Rewrite — pending.
- Phase 20: Packages Namespace Rewrite — pending.
- Phase 21: Project And Diagnostics Commands — pending.
- Phase 22: Live Repository Verification — pending.
