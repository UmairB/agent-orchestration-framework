# Milestones: AOF

## v1.6 — Task Management

**Status:** Shipped 2026-05-15
**Started:** 2026-05-15
**Completed:** 2026-05-15
**Phases:** 28-32
**Requirements:** 30/30 complete
**Audit:** Passed with accepted process debt

### Goal

Add project-local kanban boards for deliverable-scoped task management, with GSD-backed milestone/phase synchronization, agent assignment, execution state, and a dedicated board UI.

### Delivered

1. Added file-backed `.aof/boards/<id>/BOARD.json` board state, task files, validation, and generated board index/cache.
2. Added objective breakdown and proposal application for board tasks using GSD planning semantics.
3. Added phase-linked task assignment and execution records with GSD ceremony command tracking.
4. Added a separate `aof boards ui` surface with kanban columns, board navigation, progress visibility, and GSD sync/repair actions.
5. Hardened GSD-backed board lifecycle: board objectives are mandatory, manual task creation is blocked until GSD sync rules are satisfied, and sync no longer imports the active roadmap implicitly.
6. Added CLI-only board cleanup through `aof boards remove <id>` with `--dry-run`.
7. Added supply-chain safety defaults and lockfile audit checks for the new UI dependency surface.

### Progress

- Phase 28: Board And Task State Foundation — complete 2026-05-15.
- Phase 29: GSD Objective Breakdown — complete 2026-05-15.
- Phase 30: Agent Assignment And Execution — complete 2026-05-15.
- Phase 31: Kanban Setup UI — complete 2026-05-15.
- Phase 32: Task Management Verification — complete 2026-05-15.

### Archives

- [v1.6-ROADMAP.md](milestones/v1.6-ROADMAP.md)
- [v1.6-REQUIREMENTS.md](milestones/v1.6-REQUIREMENTS.md)
- [v1.6-MILESTONE-AUDIT.md](milestones/v1.6-MILESTONE-AUDIT.md)

### Known Deferred Items

- Per-phase Nyquist `VALIDATION.md` artifacts are accepted process debt for this milestone because milestone-level UAT was selected for closeout.
- Global task hub, configurable execution policy, human collaboration, external tracker sync, and SQLite canonical storage remain future/out-of-scope items.

---

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

**Status:** Complete
**Started:** 2026-05-10
**Phases:** 18-22
**Requirements:** 22/22 complete

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

- Phase 18: Command Contract Audit — complete 2026-05-10.
- Phase 19: Assets Namespace Rewrite — complete 2026-05-10.
- Phase 20: Packages Namespace Rewrite — complete 2026-05-10.
- Phase 21: Project And Diagnostics Commands — complete 2026-05-11.
- Phase 22: Live Repository Verification — complete 2026-05-11.

### Delivered So Far

1. Completed a command-by-command audit and accepted the namespaced command contract.
2. Replaced asset source commands with `aof assets add/list/show/remove/use/unuse`.
3. Replaced asset rendering, validation, cleanup, and editor launch with `aof assets apply/validate/clean/ui`.
4. Removed old `add`, `global`, `apply`, `sync`, `clean`, and `install` execution paths with replacement guidance and no side effects.
5. Updated BDD, README, help output, and planning artifacts for the assets namespace.
6. Replaced GSD install flows with `aof packages add/list/show/remove/validate/install`.
7. Preserved explicit network/package-code boundaries for package installer execution and moved lock replay to `aof packages install --from-lock`.
8. Moved project inspection, validation, diagnostics, and migration to `aof project show/validate/doctor/migrate`.
9. Kept `aof init` as the only top-level product command and removed init-time guided/default asset creation.
10. Removed old `validate`, `doctor`, `migrate`, `config`, and `catalog` execution paths with no-side-effect guidance.
11. Hardened live repo workflows with friendlier CLI output, source-only init guidance, generated-output `.gitignore` files, setup UI cleanup, command/skill additional files, runtime path placeholders, and associated-file validation.

## v1.5 — Runtime Semantics And Workflow Assets

**Status:** Shipped 2026-05-14
**Started:** 2026-05-11
**Completed:** 2026-05-14
**Phases:** 23-27
**Requirements:** 24/24 complete
**Audit:** Passed

### Goal

Align AOF's Claude/Codex adapter semantics with real runtime capabilities and introduce optional workflow-backed assets for shared process logic with runtime-specific wrappers.

### Planned Scope

1. Make Claude the only runtime that renders command assets; reject Codex command targets with clear diagnostics.
2. Preserve simple direct asset authoring while disallowing argument handling in simple mode.
3. Add optional workflow assets that render shared process files per runtime.
4. Add runtime-aware `{{skills.<id>}}` and `{{workflows.<id>}}` placeholders with validation.
5. Update setup UI authoring so users choose Simple or Workflow-backed mode and only workflow-backed assets expose arguments.
6. Verify with BDD and live GSD-style examples where Claude commands and Codex skills share workflow files.

### Delivered

1. Reconciled command semantics with real runtimes: Claude commands render to `.claude/commands/*`; Codex command targets are rejected.
2. Preserved simple direct assets while blocking argument metadata and argument-looking content outside workflow-backed mode.
3. Added first-class workflow assets rendered under `.claude/aof/workflows/` and `.codex/aof/workflows/`.
4. Added workflow-backed Claude command and Codex skill wrappers with runtime-appropriate argument guidance.
5. Added validated `{{skills.*}}` and `{{workflows.*}}` runtime path placeholders across resources, overrides, workflows, and referenced globals.
6. Updated setup UI authoring with Simple / Workflow-backed modes, argument controls, unsupported runtime disabling, and reference insertion.
7. Verified the milestone through Node BDD, PowerShell BDD parity, UI build checks, repo check, and live GSD-style UAT.

### Progress

- Phase 23: Runtime Capability Contract — complete 2026-05-12.
- Phase 24: Workflow Asset Model — complete 2026-05-14.
- Phase 25: Asset Reference Placeholders — complete 2026-05-14.
- Phase 26: Workflow-Backed Setup UI — complete 2026-05-14.
- Phase 27: Workflow Runtime Verification — complete 2026-05-14.

### Audit

- [v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md)

### Archives

- [v1.5-ROADMAP.md](milestones/v1.5-ROADMAP.md)
- [v1.5-REQUIREMENTS.md](milestones/v1.5-REQUIREMENTS.md)
- [v1.5-MILESTONE-AUDIT.md](milestones/v1.5-MILESTONE-AUDIT.md)

### Known Deferred Items

- Closeout open-artifact audit reported historical Phase 22 `22-UAT-LOG.md` status as unknown with 0 pending scenarios. Recorded in STATE.md as non-blocking historical audit noise.
