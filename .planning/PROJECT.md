# AOF

## What This Is

AOF is a repo-local abstraction layer for coding assistant setup. It lets users define assistant-facing assets once, in an `.aof/` workspace, then initialize and synchronize concrete assistant runtimes such as Claude Code and Codex.

The current codebase provides a Node.js CLI, a SQLite-backed catalog, Claude/Codex render adapters, a setup UI configuration editor, and GSD installer delegation. `.aof/` is the durable source of truth for configuration, assets, runtime overrides, and install state, while generated `.claude/` and `.codex/` folders are treated as output.

## Core Value

Users can configure assistant skills, commands, agents, rules/instructions, and GSD framework setup once in `.aof/`, then reliably generate the correct Claude Code and Codex files without hand-maintaining assistant-specific folders.

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

### Active

- [ ] Define the next milestone scope.

### Out of Scope

- Browser-executed init/apply/install actions — v1 UI is a config editor; execution remains in the CLI.
- Full kanban/task management — important future direction, but not part of v1 assistant configuration foundation.
- Assigning tasks to agents or tracking agent execution progress — deferred until the core `.aof/` model and runtime adapters are stable.
- Runtime support beyond Claude Code and Codex — design should not block future assistants, but v1 ships concrete support for these two.
- Treating generated `.claude/` and `.codex/` folders as source of truth — they are synchronized output from `.aof/`.

## Context

AOF currently exists as a compact Node.js 20+ ESM CLI. The root package exposes the `aof` binary, stores core behavior in `src/*.mjs`, and includes a Vite/React workspace under `ui/`.

The existing architecture is modular:

- `src/cli.mjs` orchestrates commands and option parsing.
- `src/catalog.mjs` persists catalog items in SQLite.
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

The long-term product direction includes task management: kanban boards, task assignment to agents, progress visibility, and orchestration. That future should inform the data model enough to avoid painting the project into a corner, but v1 should prioritize assistant asset configuration and runtime synchronization.

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
*Last updated: 2026-05-07 after Phase 5 verification*
