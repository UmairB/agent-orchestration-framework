# AOF

## What This Is

AOF is a repo-local abstraction layer for coding assistant setup. It lets users define assistant-facing assets once, in an `.aof/` workspace, then initialize and synchronize concrete assistant runtimes such as Claude Code and Codex.

The current codebase provides a Node.js CLI, Claude/Codex render adapters, a setup UI configuration editor, and GSD installer delegation. `.aof/` is the durable source of truth for configuration, assets, runtime overrides, and install state, while generated `.claude/` and `.codex/` folders are treated as output.

## Current State

v1 shipped on 2026-05-07 as the assistant configuration foundation. v1.1 shipped on 2026-05-08 as the aligned core hardening milestone. v1.2 shipped on 2026-05-09 as the Global Asset Library milestone. v1.3 shipped on 2026-05-09 as interactive CLI hardening. v1.4 shipped on 2026-05-11 as the namespaced CLI contract. v1.5 shipped on 2026-05-14 as Runtime Semantics And Workflow Assets. v1.6 shipped on 2026-05-15 as Task Management. v1.7 shipped on 2026-05-17 as the Typed GSD SDK Backend, replacing brittle slash-command scraping for board sync/execution with typed SDK-backed state, explicit milestone binding, backend capabilities, SDK fixtures, runtime fallback labeling, and board doctor observability.

The milestone archives are recorded in `.planning/MILESTONES.md`, with roadmap, requirements, and audit snapshots under `.planning/milestones/`.

## Last Shipped Milestone: v1.7 Typed GSD SDK Backend

**Shipped:** 2026-05-17

**Delivered:**
- Single typed GSD SDK adapter boundary with pinned dependency, surface probing, structured `GsdSdkError` wrapping, injected tool paths, and dispatch logging.
- Explicit board↔milestone binding for sync, attach, repair, and manual-task gates, including v1.6 board migration and drift detection.
- Internal `BoardBackend` seam with GSD as the real v1.7 implementation and a null backend for deterministic tests.
- Captured SDK fixtures, real SDK contract tests, SDK-path BDD coverage, PowerShell parity, and LF-stable board fingerprints.
- SDK-first board assignment execution through `runPhase()` with typed execution records and fallback-only runtime CLI handling.
- `aof boards doctor` with toolchain version drift, missing tools, lock metadata, Windows checks, and structured remediation hints.

## Current Milestone

No active milestone is open. Start the next milestone with `$gsd-new-milestone` after selecting the next product slice.

## Core Value

Users can configure assistant skills, commands, agents, rules/instructions, workflows, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

## Requirements

### Validated

- ✓ CLI entry point exists for AOF commands through `bin/aof.mjs` and `src/cli.mjs` — existing
- ✓ Portable resources can render into Claude and Codex folder layouts through `src/adapters.mjs` — existing
- ✓ Built-in catalog items can be stored in a local SQLite catalog through `src/catalog.mjs` — existing
- ✓ Existing commands cover `init`, `apply`, `install`, and `catalog` flows — existing
- ✓ GSD can be delegated to its npm installer through `src/frameworks.mjs` — existing
- ✓ A setup UI exists for viewing and creating catalog skills and agents through `src/setup-ui.mjs` and `ui/src/main.tsx` — existing
- ✓ Unit and BDD-style integration tests cover core CLI behavior — existing
- ✓ AOF creates and owns repo-local `.aof/` workspace files for config, source assets, runtime overrides, and lock state — Phase 1
- ✓ Existing root `aof.config.json` can be explicitly migrated into `.aof/` with `aof migrate` — Phase 1
- ✓ Skills, commands, agents, and shared rules/instructions can be represented in the `.aof/` model with runtime targets and overrides — Phase 1
- ✓ AOF treats `.claude/`, `.codex/`, and future assistant folders as generated output from `.aof/` — Phase 2
- ✓ Runtime support is explicit in rendering behavior: Claude Code and Codex are the concrete v1 targets — Phase 2
- ✓ Lock state records what was installed or generated so changes are reproducible and auditable — Phase 2
- ✓ AOF manages GSD as a first-class framework package for Claude Code and Codex installs — Phase 3
- ✓ CLI supports automation-friendly commands and an interactive install-oriented workflow — Phase 3
- ✓ Setup UI acts as a configuration editor for valid `.aof/` config, including runtime targets, runtime capability visibility, and runtime-specific overrides — Phase 4
- ✓ Setup UI does not execute init/apply/install actions in v1; the CLI remains responsible for execution — Phase 4
- ✓ v1 milestone behavior is covered by unit tests, BDD integration tests, child-process smoke, setup UI API tests, and UI build checks — Phase 5
- ✓ Users can manage the first aligned-core lifecycle slice through first-class CLI commands for add, sync, validate, doctor, and clean — Phase 6
- ✓ Users can define MCP servers, hooks, project docs, and settings in `.aof/` alongside existing skills, commands, agents, and rules — Phase 7
- ✓ Expanded DSL primitives render to Claude Code and Codex project outputs through lock-owned generated files — Phase 7
- ✓ Users can see and enforce portability degradation warnings across Claude Code and Codex targets — Phase 8
- ✓ Framework packages support npm/git/file descriptors, explicit namespaces, dependency lock metadata, and pre-write conflict gates — Phase 9
- ✓ New lifecycle, package, adapter, and validation behavior is covered by split-domain BDD scenarios across Node and PowerShell runners — Phase 10
- ✓ Users can initialize or access a global AOF library at `~/.aof` — Phase 11
- ✓ Users can create global skills, agents, and rules in `~/.aof` — Phase 11
- ✓ Users can list and inspect global assets independently from project-local assets — Phase 11
- ✓ Users receive clear validation errors when a global asset is malformed or missing required files — Phase 11
- ✓ Project `.aof` configs can reference global assets by ID without copying them into the project workspace — Phase 12
- ✓ Missing global references and local/global ID conflicts produce clear validation errors — Phase 12
- ✓ `aof apply` and `aof sync` render referenced global assets into Claude Code and Codex outputs — Phase 12
- ✓ Runtime overrides on global assets are honored during rendering — Phase 12
- ✓ Lock and diagnostic output identify global asset source scope — Phase 12
- ✓ Global assets can own explicit associated files under their asset directory — Phase 13
- ✓ Rendering preserves associated files for skill runtime directories such as Codex skill helper scripts — Phase 13
- ✓ Validation rejects associated file escapes, missing files, directories, unsupported symlinks, primary-body duplication, and unsupported resource kinds — Phase 13
- ✓ Setup UI can switch between project-local `.aof` editing and global `~/.aof` editing — Phase 14
- ✓ Setup UI can create and edit global skills, agents, and rules — Phase 14
- ✓ Setup UI can add and remove project references to global assets without copying source files — Phase 14
- ✓ Setup UI labels project-local assets, global assets, and referenced global assets clearly — Phase 14
- ✓ v1.2 global asset behavior is covered by unit tests, Node BDD, Windows PowerShell BDD parity, setup UI API tests, and UI build checks — Phase 15
- ✓ Claude command assets render only to Claude command files, and Codex command targets are rejected with clear diagnostics — Phase 23
- ✓ Simple assets remain workflow-free and cannot use argument metadata — Phase 23
- ✓ Workflow assets can define shared process instructions and render to runtime-specific workflow locations — Phase 24
- ✓ Workflow-backed Claude command and Codex skill wrappers can reference the same workflow with runtime-appropriate argument guidance — Phase 24
- ✓ `{{skills.*}}` and `{{workflows.*}}` placeholders validate and expand to runtime-specific generated paths — Phase 25
- ✓ Setup UI supports Simple / Workflow-backed authoring, workflow-backed arguments, unsupported command runtime disabling, and reference insertion — Phase 26
- ✓ Runtime semantics and workflow-backed behavior are covered by Node BDD, PowerShell BDD, UI build, repo checks, and live GSD-style UAT — Phase 27
- ✓ AOF uses `@gsd-build/sdk@0.1.0` through a single adapter boundary for GSD state, roadmap, milestone, and phase execution calls — v1.7
- ✓ Board sync is explicitly bound to a typed GSD milestone and no longer imports `.planning/ROADMAP.md` implicitly — v1.7
- ✓ GSD-backed board create, attach, repair, sync, validation, and execution route through backend capabilities rather than provider literals — v1.7
- ✓ Runtime CLI execution is fallback-only for interactive workflows and is labeled when used — v1.7
- ✓ Board doctor diagnostics expose sync health, migration hints, SDK/tool version drift, missing tools, lock metadata, and Windows environment warnings — v1.7

### Active

No active requirements. The next milestone should define fresh requirements.

### Out of Scope

- Browser-executed init/apply/install actions — v1 UI is a config editor; execution remains in the CLI.
- Full kanban/task management — important future direction, but not part of v1 assistant configuration foundation.
- Assigning tasks to agents or tracking agent execution progress — deferred until the core `.aof/` model and runtime adapters are stable.
- Runtime support beyond Claude Code and Codex — design should not block future assistants, but v1 ships concrete support for these two.
- Treating generated `.claude/` and `.codex/` folders as source of truth — they are synchronized output from `.aof/`.
- Cross-project/global task hub synchronization — v1.6 starts with project-local boards and a forward-compatible state boundary.

## Context

AOF currently exists as a compact Node.js 20+ ESM CLI. The root package exposes the `aof` binary, stores core behavior in `src/*.mjs`, and includes a Vite/React workspace under `ui/`.

The existing architecture is modular:

- `src/cli.mjs` orchestrates commands and option parsing.
- `src/catalog.mjs` is currently disabled pending a coherent catalog product path.
- `src/adapters.mjs` renders portable resources into Claude and Codex layouts.
- `src/dsl.mjs` loads and normalizes AOF config.
- `src/frameworks.mjs` delegates framework installs, currently including GSD.
- `src/setup-ui.mjs` serves a local setup UI and catalog API.
- `ui/src/main.tsx` provides the browser-based `.aof/` configuration editor surface.

The codebase map in `.planning/codebase/` identifies several important design pressures:

- Runtime and resource-kind definitions are currently duplicated across modules.
- The current root `aof.config.json` model and desired `.aof/` workspace model need reconciliation.
- The setup UI now supports editing `.aof/` skills, commands, agents, rules, runtime targets, capability visibility, and runtime-specific overrides.
- Framework installation is present but should become a managed part of `.aof/` state.
- Rules/instructions require runtime-aware modeling because support is not symmetric across assistants.
- The reviewed architecture document at `C:\Users\Umair\Downloads\architecture-design-vendor-neutral-coding-assistant-dsl.html` informed v1.1: CLI lifecycle commands, MCP/hooks/project-doc/settings primitives, framework package dependencies and conflict detection, graceful degradation policy, and shared BDD scenarios.

The long-term product direction includes task management: kanban boards, task assignment to agents, progress visibility, and orchestration. That future should inform the data model enough to avoid painting the project into a corner, but v1 should prioritize assistant asset configuration and runtime synchronization.

v1.4 responds to live first-run and command review findings from v1.3. The existing top-level CLI has become overloaded: `install` can mean opening an editor or installing a framework, `add` only applies to assets, `global` is a scope rather than a product area, and catalog/SQLite terminology remains visible despite not being an active product path. The rewrite should treat command names as a public contract, not a thin wrapper over current implementation structure.

## Constraints

- **Runtime scope**: v1 supports Claude Code and Codex concretely — keeps implementation focused while proving the adapter model.
- **Source of truth**: `.aof/` must own config, source assets, overrides, and lock state — prevents drift between assistant-specific generated folders.
- **Execution boundary**: UI v1 edits configuration only; CLI executes init/apply/install — avoids browser-side process execution complexity in the first milestone.
- **Framework scope**: GSD is the only required managed framework package in v1 — aligns with current code and user priority.
- **Compatibility**: Existing CLI behavior and tests should be preserved or migrated intentionally — the project already has BDD scenarios users may rely on.
- **Security**: Local setup UI and filesystem writes must be treated carefully — assistant config can affect developer tooling behavior.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| `.aof/` is the repo-local source of truth | Users need one durable place for config, assets, overrides, and lock state | Implemented in Phase 1 |
| `.claude/` and `.codex/` are generated output | Avoids hand-maintained runtime drift | Implemented in Phase 2 |
| v1 targets Claude Code and Codex | These are the immediate assistant runtimes to support concretely | Model implemented in Phase 1; rendering expanded in Phase 2 |
| v1 includes core assets plus GSD framework management | Skills, commands, agents, rules/instructions, and GSD are the core value slice | Core asset model implemented in Phase 1 |
| Automation-friendly and guided CLI flows are first-class | Users need predictable script output and a safe terminal path for setup | Implemented in Phase 3 |
| UI v1 is a configuration editor only | Keeps execution in the CLI while making config creation easier | Implemented in Phase 4 |
| Runtime overrides are first-class | Assistant capabilities differ, especially around rules/instructions | Implemented in Phase 1; render behavior verified in Phase 2 |
| v1 closeout uses explicit verification hardening | Milestone confidence depends on regression coverage across CLI, UI API, rendering, lock, and build paths | Implemented in Phase 5 |
| Kanban/task management is future scope | Important long-term direction, but depends on a stable `.aof/` foundation | — Pending |
| v1.1 focuses on aligned-core hardening before new runtimes or Rust migration | The architecture review surfaced core gaps that should be solved before broad adapter expansion or a language port | Implemented across Phases 6-10 |
| CLI lifecycle commands are first-class before deeper DSL expansion | Users need a safe operational path for adding, syncing, validating, diagnosing, and cleaning `.aof/` projects | Implemented in Phase 6 |
| Expanded primitives are top-level DSL sections | MCP servers, hooks, project docs, and settings are structurally different from prompt-like resources and need direct runtime config rendering | Implemented in Phase 7 |
| Adapter warnings are command-time policy, not lock state | Warnings describe portability and fidelity for the current command target; lock state stays focused on generated files and framework intent | Implemented in Phase 8 |
| Framework packages require explicit namespaces and source descriptors | Package-owned outputs need deterministic ownership, conflict detection, and replayable lock metadata | Implemented in Phase 9 |
| BDD scenarios are split by product domain and shared by Node and PowerShell runners | Future core/runtime changes need user-facing behavioral parity across runner implementations | Implemented in Phase 10 |
| `~/.aof` is the user-global AOF source workspace | Reusable assets need a runtime-neutral home distinct from project `.aof` and generated assistant output folders | Implemented in Phase 11 |
| `aof global ...` is the source-library command namespace | Global source asset operations should not overload runtime-output `--global` behavior | Implemented in Phase 11 |
| Project global references use top-level `globalRefs` | Source ownership stays explicit and project-local `resources` remain project-owned | Implemented in Phase 12 |
| Global reference rendering preserves source scope in lock state | Users need to audit whether generated outputs came from project-local assets, global assets, or packages | Implemented in Phase 12 |
| Associated asset files are explicit manifest entries | Helper code should be deliberate, reviewable, and constrained to the asset directory rather than discovered by scanning | Implemented in Phase 13 |
| Phase 13 associated-file rendering is skill-only | Skills are the directory-shaped runtime asset needed for helper code now; other resource kinds remain single-file until a concrete runtime shape requires more | Implemented in Phase 13 |
| Setup UI uses explicit Project / Global scope | Source ownership must stay visible so users do not accidentally edit global assets while intending project-local changes | Implemented in Phase 14 |
| Setup UI references globals without copying | The selected v1.2 behavior is reference-first reuse; project configs own `globalRefs`, not global source snapshots | Implemented in Phase 14 |
| v1.2 closeout requires cross-runner global asset verification | Global reuse touches path resolution, config loading, rendering, lock state, setup UI APIs, and Windows path handling | Implemented in Phase 15 |
| v1.4 is a full CLI rewrite with no legacy aliases | The command surface was early enough to fix directly; preserving confusing aliases would have locked in the wrong contract | Implemented in v1.4 |
| CLI commands are grouped by product area | AOF will grow beyond assets, so commands need namespaces such as `assets` and `packages` instead of overloaded top-level verbs | Implemented in v1.4 |
| `aof init` remains top-level | Project initialization creates the AOF workspace itself and is not an asset or package operation | Implemented in v1.4 |
| GSD is managed under `aof packages` | GSD is a managed package/tooling integration, not an assistant asset | Implemented in v1.4 |
| Codex command assets are invalid | Codex does not support commands; mapping commands into skills makes authoring ambiguous | Implemented in v1.5 |
| Workflows are optional shared process assets | Simple skills/commands should stay lightweight, while complex runtime-specific wrappers need a shared core file | Implemented in v1.5 |
| Simple assets do not support arguments | Argument handling differs by runtime and belongs in workflow-backed wrappers, not simple direct assets | Implemented in v1.5 |
| Generated workflow files live under runtime `.aof/workflows/` folders | Workflow files are generated AOF-owned support files, separate from user-facing command/skill wrappers | Implemented in v1.5 |
| Runtime path placeholders use `{{skills.*}}` and `{{workflows.*}}` only | Explicit namespaces keep references unambiguous and avoid unsupported command references | Implemented in v1.5 |
| v1.6 task boards are project-local first | The immediate user workflow is managing tasks for one project deliverable; global aggregation can build on stable project semantics later | Implemented in v1.6 |
| Task files remain canonical and indexes are generated | This preserves GSD/AOF's file-backed workflow while allowing fast setup UI queries | Implemented in v1.6 |
| Assigning an agent starts execution automatically | The selected workflow should reduce manual steps once task ownership is explicit | Implemented in v1.6 |
| v1.7 standardizes on `@gsd-build/sdk` over slash-command shellouts | The SDK exposes typed reads/mutations and phase execution; slash-command output scraping is brittle, runtime-coupled, and conflates execution with state | Implemented in v1.7 |
| Board sync must be typed against a specific milestone | Implicit ROADMAP.md syncing silently re-shapes board tasks if GSD state moves; explicit `--milestone <id>` binding makes drift detectable and recoverable | Implemented in v1.7 |
| Board create/repair owns GSD milestone attachment | Board objective is the natural seed for a backing milestone; without typed attachment, boards drift into a half-state where sync cannot reason about identity | Implemented in v1.7 |
| GSD is one execution backend, not the only one | Treating GSD behind a backend interface preserves the option to add alternatives without rewriting board lifecycle code | Implemented in v1.7 |
| Runtime CLIs (claude/codex) become fallback only | Interactive workflows that require a real conversation still need a runtime, but typed state/identity operations must not depend on terminal output scraping | Implemented in v1.7 |

## Next Milestone Goals

Potential follow-ups include SDK-event-streamed UI lifecycle output, single-call SDK milestone creation from objective once the SDK exposes a runner, alternative non-GSD execution backends, global task synchronization, broader runtime support, UI-driven asset/package execution, hosted package discovery, external package archive extraction, and Rust/native-core migration.

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check -> still the right priority?
3. Audit Out of Scope -> reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-17 after shipping v1.7 Typed GSD SDK Backend*
