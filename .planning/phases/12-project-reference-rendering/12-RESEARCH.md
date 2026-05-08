# Phase 12: Project Reference Rendering - Research

## RESEARCH COMPLETE

## Objective

Research what is needed to plan Phase 12 well: resolving project `globalRefs` from `~/.aof`, validating referenced assets, rendering them into Claude Code and Codex outputs, and preserving source scope in diagnostics and lock state.

## Phase Scope

Phase 12 covers requirements:

- **GREF-01:** User can reference global assets by ID from a project `.aof` config without copying the asset into the project.
- **GREF-02:** User receives clear validation errors when a project references a missing global asset.
- **GREF-03:** AOF detects local/global asset ID conflicts and requires an explicit resolution rather than silently choosing one.
- **GREF-04:** Project diagnostics show whether each rendered asset came from project-local source or the global library.
- **GRND-01:** `aof apply` renders referenced global assets into Claude Code and Codex outputs alongside local project assets.
- **GRND-02:** `aof sync` includes referenced global assets in validation, warning analysis, and render planning.
- **GRND-03:** Lock state records global asset source scope for generated outputs.
- **GRND-04:** Runtime overrides on global assets are honored during rendering.

Associated helper-file rendering, setup UI support, distribution, vendoring, and versioning are out of scope for this phase.

## Current Implementation Findings

### Global Workspace

- `src/workspace.mjs` now exposes `globalWorkspacePaths()` and `workspacePathsForRoot()`.
- `src/paths.mjs` resolves `~/.aof` through `defaultGlobalWorkspaceDir()` and supports `AOF_GLOBAL_HOME`.
- Phase 12 should reuse this path rather than adding a second global locator.

### Config Loading

- `src/dsl.mjs` currently loads a single config file and resolves local file-backed resources relative to that config.
- A global resolver can load project config and global config separately, then resolve only the referenced global resources with the global config directory as the base path.
- The clean implementation shape is likely a small resolver layer that returns a normalized project config with combined resources plus metadata, while leaving `loadConfig()` behavior stable for callers that do not need global references.

### Validation

- `src/config-inspect.mjs` already has whole-file validation logic that can validate either project or global config when pointed at a config path.
- Project validation must not call `validateGlobalConfig()` wholesale because that would fail on unrelated global drafts.
- Validation should inspect the raw project `globalRefs`, validate reference shape, load the global manifest if needed, match referenced `kind:id`, validate only referenced global resources and their body/override files, and detect local/global conflicts.
- Schema coverage should add `globalRefs` so config editor and external tooling see the accepted shape.

### Rendering

- `src/adapters.mjs` renders resources from the normalized config and already honors runtime overrides through `mergeRuntimeOverride()`.
- If resolved global assets carry `_aofSource` or similar metadata, `resourceMetadata()` can add global scope to `output.resource` before lock creation.
- `src/render-plan.mjs` conflict messages and lock entries currently understand package metadata but not global source metadata.
- `groupDesiredOutputs()` should describe global assets distinctly when output paths collide.

### Apply And Sync

- `applyCommand()` loads config through `loadConfig()`, collects adapter warnings, builds a render plan, and writes lock state.
- `src/sync.mjs` has its own combined plan path and must use the same reference-resolved config as apply.
- `validate`, `doctor`, and `config show` need project diagnostics and inspection output to include global references/source scope.

### BDD And Unit Coverage

- Existing Phase 11 BDD scenarios already create global assets through `aof global add`.
- Phase 12 BDD should add a project config with `globalRefs`, render referenced assets, assert no copy into project `.aof/assets`, assert runtime output exists, assert lock source scope, and assert missing/conflicting references fail with useful text.
- Unit tests should cover resolver behavior with `AOF_GLOBAL_HOME`, conflict detection, missing references, runtime overrides from global assets, and lock metadata.

## Recommended Plan Shape

1. Add `globalRefs` schema/model validation and a shared project config resolver that can load referenced global resources.
2. Wire apply, sync, validate, doctor, config inspection, adapter warnings, and render planning through the shared resolved config.
3. Add lock/source metadata, conflict diagnostics, BDD scenarios, docs, and final verification.

## Risks

- Flattening global resources too early can erase source scope and make lock state ambiguous.
- Validating the entire global library from project commands violates the Phase 11 validation boundary.
- Allowing silent local/global precedence makes generated output unpredictable.
- Implementing project-specific overrides now could blur ownership and complicate Phase 14 UI semantics.

