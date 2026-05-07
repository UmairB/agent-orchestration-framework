# Phase 6: CLI Lifecycle Commands - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 6 adds first-class lifecycle CLI commands for the existing AOF source-of-truth model: scaffold primitives, reconcile package intent plus generated outputs, validate source, diagnose project health, and clean generated outputs safely. It should improve the CLI surface around the shipped `.aof/` model without adding new DSL primitive kinds, broad runtime support, package dependency semantics, UI execution, or Rust migration.

</domain>

<decisions>
## Implementation Decisions

### Command Shape
- **D-01:** Phase 6 primary commands are top-level lifecycle commands: `aof add`, `aof sync`, `aof validate`, `aof doctor`, and `aof clean`.
- **D-02:** Keep `aof apply` as the existing write command. `aof sync` may compose it, but Phase 6 should avoid `compile` rename churn or a new `compile` alias.
- **D-03:** `aof validate` and `aof doctor` are the intended top-level command surface. `aof config validate|doctor` are not part of the primary Phase 6 contract; planning may decide whether to leave old paths temporarily, but they should not be documented as equal surfaces.
- **D-04:** Help output should be lifecycle-first: present `init`, `add`, `apply`, `sync`, `validate`, `doctor`, and `clean` before secondary/supporting commands such as `install`, `catalog`, and `config`.

### Sync Semantics
- **D-05:** `aof sync` should reconcile declared package intent plus generated runtime outputs. It should not be merely a renamed `apply`.
- **D-06:** `aof sync` must not run networked package installers by default. It should print exact package install commands or next steps, with an explicit opt-in flag such as `--install` for installer execution.
- **D-07:** `aof sync --dry-run` should show the full package reconciliation, generated-output actions, lock preview, and exact installer commands while writing nothing.
- **D-08:** If generated output drift is detected, `sync` should match current `apply` behavior: warn, preserve drifted files, continue safe actions, and keep drift auditable.

### Scaffold Model
- **D-09:** `aof add <kind> <id>` should write a file-backed asset plus update `.aof/aof.config.json`; newly scaffolded prompt/body content should live in files, not inline JSON.
- **D-10:** `aof add` should be flag-first and scriptable. Primary shape: `aof add <kind> <id> [--runtime claude,codex] [--description ...]`. Missing required values should fail with clear messages.
- **D-11:** `aof add` should fail on collision unless `--force` is passed. It must check both config resource identity and target asset paths and report the exact conflicting id/path.
- **D-12:** Phase 6 only needs minimal built-in skeletons for existing v1 kinds: `skill`, `command`, `agent`, and `rule`. Richer catalog-backed or named template systems are future work.

### Clean Safety
- **D-13:** `aof clean` should delete only generated outputs listed in `.aof/aof.lock.json`; it must not delete arbitrary `.claude/`, `.codex/`, or related runtime trees by convention alone.
- **D-14:** `aof clean` should preserve drifted files by default. Matching lock-owned files can be deleted; files whose current hash differs from the lock hash should warn and skip.
- **D-15:** After deleting files, `aof clean` should update `.aof/aof.lock.json` by removing deleted generated file entries while preserving package/framework intent and install attempts. Drifted skipped files should remain represented.
- **D-16:** `aof clean --dry-run` should provide a full preview of delete, skip, drift-warning, and lock-change actions without writing.

### Diagnostics Split
- **D-17:** `aof validate` should validate `.aof/aof.config.json`, referenced asset files, schema and semantic rules, supported kinds/runtimes, and source shape. It should not own generated-output drift, package drift, or assistant availability.
- **D-18:** `aof doctor` should check project health beyond validation: validation result, stale legacy config, generated-output drift, package/install intent, lock/package drift, writable outputs, and suggested next commands.
- **D-19:** `aof validate` and `aof doctor` should exit non-zero on errors. Warnings pass by default; `--strict` can promote warnings to failures.
- **D-20:** Both commands should use human-readable output by default and support `--json` for automation.

### the agent's Discretion
No areas were delegated to the agent's discretion. The user selected concrete decisions for all discussed areas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 6 goal, requirements, success criteria, and phase boundary.
- `.planning/REQUIREMENTS.md` — CLI-05 through CLI-09 and v1.1 traceability.
- `.planning/PROJECT.md` — Product context, core value, source-of-truth decisions, runtime scope, and current milestone boundary.
- `.planning/STATE.md` — Current project state and accumulated memory.

### Prior Phase Context
- `.planning/phases/02-runtime-rendering-and-lock-state/02-CONTEXT.md` — Generated-output, lock ownership, dry-run, drift, stale pruning, and framework intent decisions.
- `.planning/phases/03-cli-and-gsd-framework-flow/03-CONTEXT.md` — Config inspection, GSD install, lock replay, interactive CLI, JSON output, and network boundary decisions.
- `.planning/phases/05-verification-and-hardening/05-CONTEXT.md` — Regression safety net, strict/tolerant diagnostics, final verification, and cross-platform test policy.

### Codebase Maps
- `.planning/codebase/STACK.md` — Node ESM CLI stack, npm scripts, runtime assumptions, and dependency boundaries.
- `.planning/codebase/ARCHITECTURE.md` — Current CLI command dispatch, init/apply/install/catalog flows, module boundaries, and extensibility points.
- `.planning/codebase/CONVENTIONS.md` — CLI option parsing, filesystem helper pattern, error handling, test harness, and current consistency issues.

### Current Implementation
- `src/cli.mjs` — Command router, help text, option parsing, existing `apply`, `config validate|doctor`, `install --from-lock`, and interactive install behavior.
- `src/config-inspect.mjs` — Existing validation and doctor diagnostics to lift or adapt into top-level commands.
- `src/render-plan.mjs` — Existing render action planning, drift protection, stale deletion, lock manifest, and output path collision behavior.
- `src/lock.mjs` — Lock read/write/hash helpers needed for `sync` and `clean`.
- `src/workspace.mjs` — `.aof/` path resolution and legacy config precedence.
- `src/workspace-writer.mjs` — Existing `.aof/` config and file-backed asset writer behavior to reuse for `aof add`.
- `src/model.mjs` — Supported v1 kinds/runtimes and capability definitions.
- `src/frameworks.mjs` — Existing package install planning/execution and network-boundary behavior.
- `test/integration/cli.feature` — Existing BDD scenarios to extend for `add`, `sync`, `validate`, `doctor`, and `clean`.
- `test/integration/cli.mjs` — Node BDD runner and step definitions for new lifecycle scenarios.
- `test/integration/cli.ps1` — PowerShell BDD runner to preserve cross-platform behavior where relevant.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.mjs` already has the command router, `parseOptions()`, `parseRuntimes()`, `formatApplyAction()`, `applyCommand()`, and config/doctor handlers that Phase 6 can compose or split.
- `src/config-inspect.mjs` already performs source validation and project-health checks; it is the natural base for top-level `validate` and `doctor`.
- `src/render-plan.mjs` already plans create/update/delete/skip/drift-warning actions, groups desired outputs, protects drift, deletes stale lock-owned outputs, and creates lock manifests.
- `src/lock.mjs` already computes file hashes and persists lock state; `clean` should use the same ownership/hash semantics rather than inventing a second model.
- `src/workspace-writer.mjs` and the Phase 1 `.aof/` asset layout should be reused for `aof add` scaffolding.
- `test/integration/cli.feature` already covers many CLI flows and should remain the primary behavior contract for new lifecycle commands.

### Established Patterns
- Human-readable output is default; `--json` exists where automation needs stable structure.
- Dry-run paths should be side-effect-free and print exact planned operations.
- Expected CLI failures throw direct `Error` messages and are caught once by `bin/aof.mjs`.
- Boolean flags are explicitly listed in `parseOptions()`, and value flags support both `--key=value` and `--key value`.
- New user-facing CLI behavior requires BDD coverage, with focused unit tests for lower-level planning helpers.

### Integration Points
- `aof sync` should compose package intent planning, render planning, apply execution, and lock writing without running networked installers unless explicitly requested.
- `aof clean` should operate from `.aof/aof.lock.json` file entries, use current file hashes to distinguish matching from drifted files, and rewrite the lock after safe deletions.
- `aof add` should update `.aof/aof.config.json` and create source files under `.aof/assets/<plural>/<id>/`, matching existing v1 layout.
- `aof validate` and `aof doctor` should become top-level lifecycle commands while reusing existing diagnostic logic where possible.
- Help text should be reorganized so lifecycle commands are prominent without adding a full command-specific help system in this phase.

</code_context>

<specifics>
## Specific Ideas

- Treat `sync` as "make the repo match `.aof/` intent" while preserving the network execution boundary.
- Keep Phase 6 conservative: improve lifecycle ergonomics without renaming `apply`, adding new primitive kinds, or building a template system.
- Use `--strict` consistently for warnings-as-failures where commands produce warning diagnostics.

</specifics>

<deferred>
## Deferred Ideas

- `compile` command or alias for `apply` — deferred to avoid rename churn in Phase 6.
- Catalog-backed or named templates for `aof add` — defer until the lifecycle is stable.
- Interactive-first scaffold flow — future UI or later CLI enhancement.
- New DSL primitive kinds, package dependency semantics, runtime expansion, and Rust migration — covered by later v1.1 phases or future milestones.

</deferred>

---

*Phase: 6-CLI Lifecycle Commands*
*Context gathered: 2026-05-07*
