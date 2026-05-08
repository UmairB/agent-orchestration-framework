# Phase 12: Project Reference Rendering - Context

**Gathered:** 2026-05-08
**Status:** Ready for research and planning

<domain>
## Phase Boundary

Phase 12 lets project `.aof` configs reference reusable global assets from `~/.aof` and includes those referenced assets in validation, diagnostics, rendering, `sync`, `apply`, and lock state.

This phase implements project reference resolution and runtime output for referenced global skills, agents, and rules. It does not implement associated helper/code file copying for asset directories, setup UI global editing, hosted distribution, vendoring, or version pinning. Those remain Phase 13, Phase 14, or future milestone work.

</domain>

<decisions>
## Implementation Decisions

### Project Reference Shape
- **D-01:** Use a dedicated top-level project config section named `globalRefs`.
- **D-02:** Each reference should be explicit and object-shaped: `{ "kind": "skill" | "agent" | "rule", "id": "asset-id" }`.
- **D-03:** Do not represent global references by copying full global resource objects into project `resources`.
- **D-04:** Do not overload `resources[].source` in this phase; keep project-local `resources` source-owned by the project workspace.

### Reference Ownership And Overrides
- **D-05:** The global asset remains the source of truth; project configs reference it without copying body text, paths, or overrides.
- **D-06:** Runtime overrides declared on the global asset are honored during rendering.
- **D-07:** Project-local overrides of global assets are deferred; they need a separate ownership model and should not block reference rendering.

### Conflict And Missing Reference Policy
- **D-08:** A missing referenced global asset is a validation error for the project.
- **D-09:** A local project resource and referenced global asset with the same `kind:id` is a validation error.
- **D-10:** Duplicate `globalRefs` entries for the same `kind:id` are validation errors.
- **D-11:** Unreferenced malformed global assets do not fail project validation; only referenced assets are loaded and validated through the project path.

### Rendering And Lock Metadata
- **D-12:** Referenced global resources render alongside project-local resources in `aof apply` and `aof sync`.
- **D-13:** Internal resolved resources should preserve source scope so diagnostics and lock state can distinguish project-local, global, and package-generated outputs.
- **D-14:** Lock file resource entries for referenced global assets should record `scope: "global"` and enough source identity to audit the global origin.
- **D-15:** Human and JSON diagnostics should expose referenced global assets separately from local resources where practical.

### the agent's Discretion
- Choose exact helper names and module boundaries.
- Choose whether the resolver is a new module or an extension of `src/dsl.mjs`, provided call sites stay simple.
- Choose exact lock metadata field names as long as source scope and global asset identity are clear and stable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/PROJECT.md` - v1.2 milestone goal, validated Phase 11 requirements, and active global-reference requirements.
- `.planning/REQUIREMENTS.md` - Phase 12 requirements `GREF-01` through `GREF-04` and `GRND-01` through `GRND-04`.
- `.planning/ROADMAP.md` - Phase 12 goal and success criteria.
- `.planning/STATE.md` - Current project state and accumulated workflow notes.

### Prior Phase Context
- `.planning/phases/11-global-library-workspace/11-CONTEXT.md` - global workspace shape and `aof global ...` command decisions.
- `.planning/phases/11-global-library-workspace/11-VERIFICATION.md` - completed Phase 11 behavior and verification evidence.
- `.planning/phases/08-adapter-degradation-policy/08-CONTEXT.md` - diagnostic and strict-mode conventions.
- `.planning/phases/09-framework-package-semantics/09-CONTEXT.md` - source descriptor and lock/audit thinking.
- `.planning/phases/10-bdd-parity-and-hardening/10-CONTEXT.md` - BDD coverage expectations.

### Research
- `.planning/research/SUMMARY.md` - global asset library stack additions and watch-outs.
- `.planning/research/ARCHITECTURE.md` - proposed global reference data flow.
- `.planning/research/PITFALLS.md` - source-of-truth, ID collision, lock ambiguity, and missing-reference risks.

### Current Implementation
- `src/workspace.mjs` - project and global workspace path helpers.
- `src/paths.mjs` - `AOF_GLOBAL_HOME` and default `~/.aof` path resolution.
- `src/dsl.mjs` - config loading, resource body resolution, runtime overrides.
- `src/config-inspect.mjs` - validation, inspection, doctor diagnostics, and global validation helpers.
- `src/adapters.mjs` - runtime rendering and resource metadata passed into render plans.
- `src/render-plan.mjs` - output grouping, conflict detection, and lock manifest creation.
- `src/sync.mjs` - sync path that must use the same resolved global-resource graph as apply.
- `src/cli.mjs` - command call sites for apply, sync, validate, doctor, config show, and global commands.
- `schemas/aof.schema.json` - project config schema that should add `globalRefs`.
- `test/integration/features/lifecycle.feature` - BDD scenarios that currently cover global asset CRUD and should add project reference rendering.

</canonical_refs>

<code_context>
## Existing Code Insights

### Phase 11 Foundation
- `globalWorkspacePaths()` returns `~/.aof` paths and supports `AOF_GLOBAL_HOME` for tests.
- `inspectGlobalConfig()` and `validateGlobalConfig()` validate the global library independently.
- `aof global add/list/show/validate` already creates and inspects global skills, agents, and rules.

### Resolver Pressure
- `loadConfig(configPath)` currently resolves only one config file and returns a flattened config with `resources`.
- `resolveResource()` already reads file-backed bodies and runtime overrides relative to the config directory, which can work for global assets if called with the global config directory.
- `applyCommand()` and `sync.mjs` both load configs before rendering, so reference resolution should be shared rather than patched separately.

### Validation Pressure
- `validateConfig()` currently validates only the project config file and intentionally ignores unrelated global drafts.
- Phase 12 needs project validation to load only referenced global assets, report missing references, report malformed referenced assets, and reject local/global conflicts.
- `inspectConfig()` should expose global references and source scope without making unreferenced global library health a project error.

### Rendering Pressure
- `renderConfigOutputs()` already renders whatever resources are present in the normalized config.
- `resourceMetadata()` currently records package scope but local resources have no explicit scope metadata.
- `createLockManifest()` persists `output.resource` directly, so preserving source scope before rendering is the cleanest way to put global identity into lock state.
- `groupDesiredOutputs()` reports conflicts as `local:` or `package:` today; global resources need a distinct description for diagnostics.

</code_context>

<specifics>
## Specific Ideas

Example project config shape:

```json
{
  "name": "project",
  "resources": [],
  "globalRefs": [
    { "kind": "skill", "id": "shared-review" },
    { "kind": "rule", "id": "team-standards" }
  ]
}
```

Resolved global resources should behave like regular resources for rendering while carrying source metadata such as:

```json
{
  "scope": "global",
  "kind": "skill",
  "id": "shared-review",
  "globalConfigPath": "~/.aof/aof.config.json"
}
```

The exact lock field names can differ, but the outcome must let a user inspect `.aof/aof.lock.json` and tell that a generated file came from a referenced global asset.

</specifics>

<deferred>
## Deferred Ideas

- Project-specific overrides of global assets.
- Referencing global commands; Phase 12 follows the Phase 11 global asset boundary of skills, agents, and rules.
- Copying/vendoring a global asset into project `.aof`.
- Version pins or semver ranges on global references.
- Associated helper/code file rendering for global asset directories.
- Setup UI support for adding global references.

</deferred>

---

*Phase: 12-Project Reference Rendering*
*Context gathered: 2026-05-08*
