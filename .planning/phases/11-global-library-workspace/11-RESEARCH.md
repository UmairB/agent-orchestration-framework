# Phase 11: Global Library Workspace - Research

## RESEARCH COMPLETE

## Objective

Research what is needed to plan Phase 11 well: establishing `~/.aof` as AOF's user-global source workspace with explicit `aof global ...` commands for create, list, inspect, and validate behavior.

## Phase Scope

Phase 11 covers requirements:

- **GLIB-01:** User can initialize or access a global AOF library at `~/.aof`.
- **GLIB-02:** User can create global skills, agents, and rules in `~/.aof`.
- **GLIB-03:** User can list and inspect global assets independently from project-local assets.
- **GLIB-04:** User receives clear validation errors when a global asset is malformed or missing required files.

Project references, render integration, associated helper-file rendering, and setup UI support are later phases.

## Current Implementation Findings

### Path And Workspace Model

- `src/paths.mjs` currently resolves OS-specific app data for catalog storage through `defaultDataDir()` and `defaultDbPath()`.
- `src/workspace.mjs` owns project workspace shape: `.aof/aof.config.json`, `.aof/aof.lock.json`, and `.aof/assets`.
- Phase 11 should add a global source workspace helper that resolves to `path.join(os.homedir(), ".aof")`, distinct from the app-data/catalog path.
- Tests already cover app-data behavior in `test/paths.test.mjs`; this is the right place to add `defaultGlobalWorkspaceDir()` or equivalent path coverage.

### Asset Creation

- `src/scaffold.mjs` already creates file-backed resources under `assets/<kind>/<id>/<BODY.md>` and updates `aof.config.json`.
- The existing scaffold path accepts all resource kinds, including `command`, but Phase 11 scope is only skills, agents, and rules.
- Reusing `scaffoldResource()` likely requires making workspace path resolution injectable or adding a new global-specific wrapper that targets `~/.aof` while preserving collision and skeleton behavior.
- `aof global add` should avoid legacy-project checks because the global workspace has no legacy root project config concept.

### Validation And Inspection

- `src/config-inspect.mjs` validates a config by locating a project config with `findProjectConfig()` and resolving file-backed resource paths relative to the config directory.
- The core validation logic already supports the global workspace layout if it can be pointed at `~/.aof/aof.config.json`.
- `aof global validate` should validate the whole global library and use the same structured diagnostic style as `validate` / `config validate`.
- Phase 11 does not need project validation to resolve global references yet; that belongs to Phase 12. The important decision is preserved: project validation should not fail because unrelated global drafts are malformed.

### CLI Surface

- `src/cli.mjs` dispatches top-level commands in `run(argv)`.
- Existing `--global` is already used for runtime-global output scope in `apply`, `sync`, and `install`, so Phase 11 should add an explicit `global` command namespace.
- Candidate commands:
  - `aof global add <kind> <id> [--runtime ...] [--description ...] [--force] [--dry-run]`
  - `aof global list [--json]`
  - `aof global show <kind> <id> [--json]`
  - `aof global validate [--json] [--strict]`
- Help text should mention the namespace without changing current command behavior.

### Tests And BDD

- Unit tests are registered manually in `scripts/test-unit.mjs`.
- Existing path coverage is in `test/paths.test.mjs`; workspace coverage is in `test/workspace.test.mjs`; diagnostics coverage is in `test/config-inspect.test.mjs`.
- BDD lifecycle scenarios live in `test/integration/features/lifecycle.feature` and route through `test/integration/steps/lifecycle.steps.mjs` to shared CLI steps.
- Phase 11 should add lifecycle BDD scenarios for global add/list/validate behavior so the command shape is user-facing and protected.

## Recommended Plan Shape

1. Add the global workspace path/model helpers and tests.
2. Add reusable global scaffold/inspect functions and CLI commands.
3. Add validation/list/show behavior, BDD coverage, docs/help updates, and final verification.

## Risks

- Overloading app-data paths with source workspace paths would confuse catalog storage with global asset source.
- Reusing `--global` for source-library operations would conflict with existing runtime-output semantics.
- Letting global validation silently scan files instead of honoring `~/.aof/aof.config.json` would violate the canonical manifest decision.
- Implementing project-reference validation in Phase 11 would blur the Phase 12 boundary.

