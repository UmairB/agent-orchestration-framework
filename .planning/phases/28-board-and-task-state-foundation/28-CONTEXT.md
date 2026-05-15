# Phase 28: Board And Task State Foundation - Context

**Gathered:** 2026-05-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 28 defines the project-local board/task state foundation for AOF task management. It delivers canonical board/task files, validation rules, a generated UI/API index, a new `aof boards ...` command namespace, and setup UI API foundations.

This phase does not implement GSD objective breakdown, automatic agent execution, or the full kanban UI. It must prepare metadata and extension points so Phases 29-31 can build on stable board/task semantics.

</domain>

<decisions>
## Implementation Decisions

### Task File Layout
- **D-01:** Canonical board/task state lives under `.aof/boards`.
- **D-02:** `.planning/` is GSD-owned and must not be repurposed as AOF's canonical task store.
- **D-03:** Phase 28 may reference `.planning/` artifacts from task metadata, but it should not interfere with GSD's planning directory structure.

### Lifecycle Model
- **D-04:** Use fixed lifecycle statuses for v1.6: `backlog`, `ready`, `in_progress`, `blocked`, and `done`.
- **D-05:** Do not add per-board custom columns in Phase 28. Stable internal statuses are needed for Phase 30 execution state and Phase 31 UI behavior.

### Index And Cache Contract
- **D-06:** Generate a rebuildable board/task index at `.aof/cache/boards/index.json`.
- **D-07:** Canonical `.aof/boards` files remain the source of truth; the cache is generated output.
- **D-08:** In Phase 28, stale index state is warning-only. Validation should surface stale cache diagnostics without blocking canonical file reads.

### CLI And Setup UI API Surface
- **D-09:** Add a new `aof boards ...` namespace for board and board-task operations.
- **D-10:** Expected command direction includes `aof boards list`, `aof boards create`, `aof boards show`, `aof boards validate`, `aof boards index`, `aof boards task add`, and `aof boards task move`.
- **D-11:** Setup UI API endpoints should mirror the same board/task operations rather than inventing separate semantics.
- **D-12:** Do not fold this under `aof assets`, `aof packages`, or `aof project`; boards are their own product object.

### Links To GSD Artifacts
- **D-13:** Task metadata should support structured optional refs such as roadmap phase, plan file, requirement IDs, source objective ID, and artifact paths.
- **D-14:** Use GSD agent skill injection as the preferred integration path for teaching GSD agents how to read/write `.aof/boards` and update task state.
- **D-15:** Runtime hooks may be investigated for progress observation, but Phase 28 and Phase 30 must not depend on undocumented arbitrary lifecycle callbacks.
- **D-16:** GSD CONFIGURATION.md documents `agent_skills` for injecting project-specific skills into GSD agent prompts at spawn time. It also documents hook toggles such as `hooks.context_warnings` and `hooks.workflow_guard`, but not a generic custom lifecycle-hook API.

### Archival And Removal Semantics
- **D-17:** Archiving a board preserves board and task history.
- **D-18:** Phase 28 should avoid destructive board deletion as the normal path. Archive is the primary removal semantic for boards.

### the agent's Discretion
- Choose the exact internal JSON shape and file split under `.aof/boards`, as long as it preserves canonical file-backed state, supports multiple boards, and remains easy to inspect and commit.
- Choose exact diagnostic code names for malformed boards, duplicate IDs, missing task refs, and stale index warnings.
- Choose the exact setup UI API route names consistent with existing `/api/config/...` style.
- Choose whether `aof boards index` rebuilds by default, validates only, or supports both with flags, as long as stale cache remains warning-only in Phase 28.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Milestone And Phase Scope
- `.planning/PROJECT.md` — v1.6 Task Management milestone intent and current product decisions.
- `.planning/REQUIREMENTS.md` — Phase 28 requirements for boards, tasks, state, and indexing.
- `.planning/ROADMAP.md` — Phase 28 goal, success criteria, and planned wave structure.
- `.planning/STATE.md` — current milestone state and locked initial decisions.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — CLI, setup UI, config, filesystem, and generated-output architecture.
- `.planning/codebase/STRUCTURE.md` — source/test layout and expected files for CLI/API/UI changes.
- `.planning/codebase/TESTING.md` — unit, BDD, PowerShell, and setup UI test expectations.

### Prior Phase Decisions
- `.planning/phases/25-asset-reference-placeholders/25-CONTEXT.md` — reference-index and generated-path validation patterns.
- `.planning/phases/26-workflow-backed-setup-ui/26-CONTEXT.md` — setup UI editing/API boundaries and workflow-backed mode decisions.
- `.planning/phases/27-workflow-runtime-verification/27-CONTEXT.md` — verification-first closeout behavior for runtime workflow semantics.

### GSD And Hook Context
- `https://github.com/gsd-build/get-shit-done/blob/main/docs/CONFIGURATION.md` — GSD config keys, especially `agent_skills`, hook toggles, and statusline behavior.
- `.codex/config.toml` — installed GSD Codex agent and SessionStart hook configuration.
- `.codex/hooks/gsd-workflow-guard.js` — example GSD workflow guard hook.
- `.codex/hooks/gsd-context-monitor.js` — example GSD context/progress-related hook.

### AOF Hook And Runtime Config Code
- `src/model.mjs` — supported runtimes, resource kinds, hook events, and hook types.
- `src/runtime-config.mjs` — Claude/Codex hook rendering and runtime config TOML/JSON generation.
- `src/dsl.mjs` — hook normalization and config loading.
- `src/config-inspect.mjs` — hook diagnostics and validation patterns.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.mjs` already uses product-area namespaces such as `assets`, `packages`, and `project`; `boards` should follow that routing style.
- `src/setup-ui.mjs` already exposes local HTTP API routes and structured JSON errors; board APIs should follow this pattern.
- `src/config-editor.mjs` already handles file-backed config editing, source writes, scoped payloads, diagnostics, and setup UI payload shaping.
- `src/fs.mjs` provides shared text/JSON filesystem helpers and ID normalization patterns.
- `ui/src/main.tsx` already loads setup UI payloads, shows diagnostics, and separates navigation sections for assets/packages/review.

### Established Patterns
- Project-local source of truth lives under `.aof/`; generated output/cache state should be rebuildable.
- User-facing behavior changes require BDD scenarios, with PowerShell parity when CLI commands change.
- Setup UI API changes belong in `src/setup-ui.mjs`; UI client changes belong in `ui/src/main.tsx`.
- Validation should catch malformed state before writes where possible, but stale generated cache is warning-only for this phase.
- Generated or derived state should be clearly distinguishable from canonical user-authored/source state.

### Integration Points
- Add a board/task model module rather than expanding asset config modules with unrelated task behavior.
- Add CLI routing for `aof boards ...` in `src/cli.mjs`.
- Add setup UI API routes for board listing, creation, task creation, task movement, validation, archive, and index rebuild/read.
- Add tests in unit modules for the board/task model and index generation.
- Add BDD scenarios for board/task lifecycle and index validation; PowerShell coverage is required for new CLI scenarios.

</code_context>

<specifics>
## Specific Ideas

### Canonical State

Canonical files should be inspectable under `.aof/boards`, not hidden in `.planning/` or a database.

### Generated Index

The generated index should live at:

```text
.aof/cache/boards/index.json
```

It should support fast setup UI/API reads and be rebuildable from canonical board/task files.

### Fixed Statuses

Use these internal statuses:

```text
backlog
ready
in_progress
blocked
done
```

### GSD Integration Direction

Prefer a generated/project-managed GSD skill that teaches relevant GSD agents how to read/write `.aof/boards`. Do not base the design on undocumented lifecycle hooks.

</specifics>

<deferred>
## Deferred Ideas

- GSD objective breakdown into board tasks belongs to Phase 29.
- Automatic agent execution on assignment belongs to Phase 30.
- Full kanban UI with task progress rendering belongs to Phase 31.
- Live UAT and milestone hardening belong to Phase 32.
- Global `~/.aof` task hub or SQLite canonical task state remains future scope.
- Per-board custom columns and configurable execution policy remain future scope unless a later phase explicitly scopes them.

</deferred>

---

*Phase: 28-Board And Task State Foundation*
*Context gathered: 2026-05-15*
