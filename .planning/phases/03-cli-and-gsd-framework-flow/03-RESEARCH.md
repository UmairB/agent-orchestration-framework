# Phase 3 Research: CLI And GSD Framework Flow

**Researched:** 2026-05-07
**Status:** Complete

## Scope

Phase 3 should make AOF usable from scripts and from a simple guided terminal flow. The implementation needs to cover config inspection, validation, doctor checks, GSD install preview/execution, install attempt recording, and lock replay while preserving the Phase 2 rendering and lock boundaries.

## Current Implementation Findings

### CLI Routing

`src/cli.mjs` has a small synchronous command router for `init`, `apply`, `migrate`, `install`, and `catalog`. This is the right integration point for `config show|validate|doctor`, `install --from-lock`, `install --interactive`, `--json`, and installer dry-run output.

`parseOptions()` already handles `--dry-run`, `--force`, runtime flags, and `--interactive`. It does not yet expose `--json` or `--from-lock`.

### Config Loading And Validation

`src/dsl.mjs` already validates several Phase 3 semantic constraints while resolving config:

- config must be a JSON object
- resource kinds must be known
- runtime arrays must be non-empty and contain supported runtimes
- file-backed resource paths and override paths are read relative to the config directory

The module currently throws on the first validation failure. Phase 3 inspection commands need structured diagnostics, so the implementation should either add a non-throwing validator beside the resolver or factor resolver validation into reusable diagnostic helpers.

### Rendering And Drift Data

`src/render-plan.mjs` can already compute desired outputs, compare them with lock state, report create/update/delete/skip/drift-warning actions, preserve drifted lock entries, and record framework intent. `config doctor` should reuse this plan path for generated-output drift summaries instead of duplicating lock/file hash logic.

### Lock State

`src/lock.mjs` currently provides `readLock`, `writeLock`, content hashing, and `LOCK_VERSION = 2`. Phase 3 should extend the lock manifest shape with framework install attempt history while preserving Phase 2 `files` and `frameworks` fields. Attempt history should be appended or merged without losing render lock data.

### GSD Installer

`src/frameworks.mjs` already has a `gsd` framework entry and constructs one `npx get-shit-done-cc@latest <runtime-flag> <scope-flag>` command per runtime. Dry-run returns command strings without spawning.

The missing pieces are config-aware package resolution, one-run CLI overrides, boundary output before real networked execution, skip/force behavior based on successful lock attempts, per-runtime attempt recording, failure aggregation, retry command output, and replay from lock.

### Catalog And Interactive Selection

`src/catalog.mjs` has a built-in `gsd` framework catalog item and `itemsToConfig()` already converts selected framework items to `packages`. `src/prompt.mjs` has simple selection and runtime prompts with test hooks. Phase 3 interactive flow should build on these rather than adding a profile builder or UI-style editor.

## Recommended Architecture

### 1. Add A Config Inspection Module

Introduce a small module such as `src/config-inspect.mjs` responsible for:

- loading the preferred `.aof/aof.config.json` config path
- producing a normalized show payload
- returning validation diagnostics without throwing after the first issue
- producing doctor diagnostics and suggested next commands

This keeps CLI output formatting in `src/cli.mjs` and keeps config semantics testable without shelling out.

### 2. Keep Framework Command Planning Separate From Execution

Extend `src/frameworks.mjs` around a command plan shape:

- package id/source/version or range
- runtime
- scope
- argv/command string
- skipped status and skip reason when lock state already has a successful matching attempt

Real execution should consume this plan and return per-runtime attempt records. Tests should be able to exercise command planning and simulated execution without invoking npm or the network.

### 3. Extend Lock Manifest Conservatively

Add a `frameworkInstallAttempts` array or equivalent append-only field to `.aof/aof.lock.json`. Keep Phase 2 fields intact:

- `version`
- `generatedAt`
- `runtimes`
- `files`
- `frameworks`

Attempt records should include command, runtime, scope, status/exit status, timestamp, and package source or version/range. Partial failures should still write attempts.

### 4. Implement Replay As Explicit Install Planning

`aof install --from-lock` should read framework intent and/or recorded attempts from `.aof/aof.lock.json`, derive exact commands, and support `--dry-run`. Replay should not infer from generated runtime folders.

### 5. Keep Interactive V1 Narrow

`aof install --interactive` should:

1. load or initialize catalog data
2. collect selected items and runtimes
3. include a simple GSD choice
4. show proposed config changes, render plan, and framework install plan
5. confirm before writing `.aof/`
6. confirm before writing runtime files
7. confirm before running GSD

Existing configs should be inspected first and proposed changes shown before modifying `.aof/aof.config.json`.

## Testing Strategy

Use focused unit tests for config diagnostics, framework install planning, lock attempt merging, skip/force policy, and replay planning.

Extend BDD scenarios in `test/integration/cli.feature` and `test/integration/cli.mjs` for:

- `aof config show`
- `aof config show --json`
- `aof config validate` success and failure
- `aof config doctor` health output and JSON output
- `aof install gsd --dry-run` exact commands and no side effects
- config-declared GSD package intent
- real install simulation with attempt records
- partial failure attempt recording and overall non-zero failure
- retry command output
- skip successful prior install unless `--force`
- `aof install --from-lock --dry-run`
- `aof install --interactive` with existing prompt test hooks and new confirmation test hooks

Networked installer tests should use a simulation hook or injected executor. No test should run real `npx`.

## Risks And Mitigations

- **Risk:** Validation commands duplicate resolver behavior and drift over time.
  **Mitigation:** Share validation helpers between `resolveConfig()` and non-throwing diagnostics.

- **Risk:** Install attempt records overwrite render lock data.
  **Mitigation:** Add lock merge helpers and unit tests that preserve `files` and `frameworks`.

- **Risk:** Real installer tests accidentally execute npm.
  **Mitigation:** Make execution injectable or gated by an explicit test-only simulation environment variable.

- **Risk:** Interactive flow becomes a full asset editor.
  **Mitigation:** Keep v1 to catalog item selection, runtimes, GSD choice, previews, and confirmations.

## RESEARCH COMPLETE

