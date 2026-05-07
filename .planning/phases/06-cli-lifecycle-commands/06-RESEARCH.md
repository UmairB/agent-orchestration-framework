# Phase 6: CLI Lifecycle Commands - Research

**Researched:** 2026-05-07
**Status:** Complete

## Objective

Research how to plan Phase 6 well: first-class lifecycle CLI commands for `add`, `sync`, `validate`, `doctor`, and `clean` over the existing `.aof/` source-of-truth model.

## Existing Implementation Summary

AOF already has most lower-level building blocks needed for Phase 6:

- `src/cli.mjs` routes `init`, `apply`, `migrate`, `install`, `catalog`, and `config` commands. It owns `parseOptions()`, runtime parsing, output formatting, and help text.
- `src/config-inspect.mjs` already implements validation and doctor diagnostics under `aof config validate|doctor`.
- `src/render-plan.mjs` already computes generated-output actions (`create`, `update`, `delete`, `skip`, `drift-warning`), protects drift, prunes stale lock-owned outputs, groups colliding outputs, and creates lock manifests.
- `src/lock.mjs` already provides lock read/write and content hashing.
- `src/workspace-writer.mjs` and `src/config-editor.mjs` already know the `.aof/assets/<kind>/<id>/<BODYFILE>` file-backed layout.
- `test/integration/cli.feature` and `test/integration/cli.mjs` already cover the user-facing CLI through BDD-style scenarios and should be extended for all new lifecycle behavior.

## Planning Implications

### Command Surface

Top-level `validate` and `doctor` should reuse `src/config-inspect.mjs` rather than duplicating diagnostics. `aof config validate|doctor` can remain temporarily for compatibility if the implementation cost is small, but help output should make the lifecycle commands primary.

### Sync

`sync` is best implemented as a composition layer over existing render planning and framework package planning:

1. Resolve config from `.aof/`.
2. Plan framework/package commands from declared package intent.
3. Plan generated output actions via `createRenderPlan()` and `planApplyActions()`.
4. Print a full human-readable plan in dry-run mode.
5. In normal mode, write safe generated outputs and lock state.
6. Do not run networked package installers unless an explicit flag such as `--install` is passed.

The plan should preserve current drift behavior from `apply`: warn and skip drifted files by default, with `--force` available for overwrite behavior where already supported.

### Add

`aof add` should be implemented around a reusable scaffold helper rather than burying file writes in `src/cli.mjs`. It should:

- Validate kind/id/runtimes using `src/model.mjs` and `normalizeId()`.
- Generate minimal skeleton body content for `skill`, `command`, `agent`, and `rule`.
- Write file-backed source assets under `.aof/assets/...`.
- Add a resource metadata entry to `.aof/aof.config.json`.
- Fail on config or file collisions unless `--force` is passed.

The setup UI's `saveEditableResource()` already overwrites upsert-style, but Phase 6 wants stricter CLI scaffold semantics, so a separate helper is cleaner.

### Clean

`aof clean` should use `.aof/aof.lock.json` as the ownership boundary. Existing stale deletion logic lives inside `planApplyActions([], previousLock, ...)`, but clean also needs to rewrite the lock by removing deleted file entries while preserving package intent and install attempts. A dedicated clean planner can reuse lock hash helpers and action naming without forcing a fake empty config path.

### Diagnostics

`validate` should stay source-focused. `doctor` should remain broader project health. `--strict` should be added where warnings can be promoted to failures. `--json` should exist for automation while preserving human-readable defaults.

## Suggested Plan Decomposition

1. **Wave 1: Top-level diagnostics and lifecycle help**
   - Lift `validate` and `doctor` to top-level commands.
   - Add `--strict`.
   - Reorganize help output around lifecycle commands.
   - Extend BDD coverage for top-level diagnostics.

2. **Wave 2: Add scaffold command**
   - Add reusable scaffold helper.
   - Route `aof add`.
   - Add BDD coverage for file-backed scaffold, collision failure, and runtime/description flags.

3. **Wave 3: Sync and clean commands**
   - Add sync composition over package/render planning.
   - Add clean planner/executor over lock-owned outputs.
   - Add BDD and focused unit coverage for dry-run, drift, lock updates, and no-network default.

## Risks And Watchpoints

- `src/cli.mjs` is already large. Keep new command-specific logic in helper modules where possible.
- `aof sync` and `aof apply` should not diverge on generated-output safety rules.
- `clean` must never delete unowned runtime directories.
- Existing BDD steps may need new assertions for lock file entries being removed or preserved.
- The requirements coverage footer was corrected during discuss-phase; keep future counts checked mechanically.

## RESEARCH COMPLETE

