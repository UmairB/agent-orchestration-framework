# Phase 21: Project And Diagnostics Commands - Context

**Gathered:** 2026-05-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 21 implements the accepted `aof project ...` command surface from Phase 18. It moves project configuration inspection, validation, diagnostics, and legacy root-config migration into the project namespace while keeping `aof init` as the only retained top-level product command.

This is a full migration phase for project and diagnostics commands. Old top-level diagnostics/config/migration commands must stop executing and must not remain as aliases.

</domain>

<decisions>
## Implementation Decisions

### Migration Strategy
- **D-01:** Perform the full project namespace migration in one pass.
- **D-02:** Do not ship staged compatibility, temporary aliases, or dual execution paths for project/config/diagnostic commands.
- **D-03:** Removed commands may fail with helpful replacement guidance, but they must not execute old behavior.

### Top-Level Init
- **D-04:** Keep `aof init` as the only active top-level product command.
- **D-05:** `aof init` creates only the project `.aof` workspace, config, and lock state for selected runtimes.
- **D-06:** `aof init` must not create default assets, launch the UI, render runtime outputs, install packages, initialize catalog storage, or import SQLite-backed catalog behavior.
- **D-07:** Init next-step output must guide users to namespaced commands: `aof assets ...`, `aof packages ...`, and `aof project ...`.

### Project Commands
- **D-08:** Implement `aof project show` as the project-level replacement for `aof config show`.
- **D-09:** Implement `aof project validate` as the project-level replacement for top-level `aof validate`.
- **D-10:** Implement `aof project doctor` as the project-level replacement for top-level `aof doctor` and `aof config doctor`.
- **D-11:** Implement `aof project migrate [dir]` as the project-level replacement for top-level `aof migrate [dir]`.
- **D-12:** Preserve existing JSON, strict-mode, diagnostics, global-reference validation, adapter warning, drift summary, package intent, and stale legacy config behavior under the new names.

### Migration Output
- **D-13:** `aof project migrate` must clearly explain before/after paths and state that the legacy root `aof.config.json` remains untouched.
- **D-14:** `--dry-run` must preview writes without changing project files.
- **D-15:** Existing `.aof/aof.config.json` protection and `--force` behavior must be preserved.

### Removed Commands
- **D-16:** Removed project/config commands include `aof validate`, `aof doctor`, `aof migrate`, and `aof config ...`.
- **D-17:** Removed commands should fail with targeted replacement hints and no config, lock, asset, runtime output, package, catalog, or SQLite side effects.

### Catalog Boundary
- **D-18:** `aof catalog ...` remains removed until a coherent catalog product path is intentionally reintroduced.
- **D-19:** Catalog commands must not import `node:sqlite`, open catalog storage, create catalog files, or print SQLite warnings.
- **D-20:** Catalog failure output should explain that active source assets now live under project/global `.aof` workspaces and point to relevant `aof assets ...` commands.

### the agent's Discretion
- The planner may decide whether to keep project command implementations inside `src/cli.mjs` or extract project command helpers, but public behavior must match the Phase 18 contract.
- The planner may decide exact human output phrasing, as long as command scope and replacements are unambiguous.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Contract
- `.planning/phases/18-command-contract-audit/18-CLI-CONTRACT.md` - accepted public command contract for top-level init and `aof project ...`.
- `.planning/phases/18-command-contract-audit/18-BDD-CONTRACT.md` - required project BDD scenarios and removed-command parity expectations.
- `.planning/phases/18-command-contract-audit/18-COMMAND-INVENTORY.md` - current command inventory and replacement mapping.
- `.planning/phases/18-command-contract-audit/18-CONTEXT.md` - locked v1.4 namespace decisions.
- `.planning/phases/19-assets-namespace-rewrite/19-VERIFICATION.md` - removed asset command baseline and setup UI/catalog side-effect baseline.
- `.planning/phases/20-packages-namespace-rewrite/20-VERIFICATION.md` - removed install/package command baseline and package namespace behavior.

### Project Planning
- `.planning/PROJECT.md` - v1.4 milestone goal and product decisions.
- `.planning/REQUIREMENTS.md` - PROJ-01 through PROJ-04 requirements.
- `.planning/ROADMAP.md` - Phase 21 goal and success criteria.
- `.planning/STATE.md` - current milestone state and recent context.

### Codebase Maps
- `.planning/codebase/STRUCTURE.md` - source layout and important CLI/config files.
- `.planning/codebase/CONVENTIONS.md` - CLI parsing, error handling, filesystem, runtime selection, and testing patterns.
- `.planning/codebase/INTEGRATIONS.md` - current setup UI, filesystem, GSD installer, and removed catalog/SQLite integration notes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.mjs`: currently owns top-level `init`, `migrate`, `validate`, `doctor`, `config`, and `catalog` routing. Phase 21 should route project behavior through `aof project ...` and turn removed paths into non-executing failures.
- `src/config-inspect.mjs`: existing `inspectConfig`, `validateConfig`, and `doctorConfig` functions should back `aof project show`, `validate`, and `doctor`.
- `src/paths.mjs`: existing `.aof` and legacy root config path helpers should continue to back init/migrate behavior.
- `test/integration/features/lifecycle.feature`: contains current project/config/migration/doctor/catalog scenarios that must be migrated to the accepted command names.
- `test/integration/cli.ps1`: must keep PowerShell parity for externally visible project namespace behavior.

### Established Patterns
- `src/cli.mjs` owns command routing and `parseOptions()`; namespace routing should start there.
- User-facing failures throw `Error` with direct messages; `bin/aof.mjs` remains the catch/print boundary.
- BDD integration features and PowerShell parity are required for user-facing CLI behavior.
- Removed commands should fail before doing work or importing modules that can produce catalog/SQLite side effects.

### Integration Points
- `aof project validate` and `aof project doctor` must preserve existing adapter warning and strict-mode behavior.
- `aof project show --json` must remain automation friendly.
- `aof project migrate` must preserve existing legacy root migration safety.
- README/help text must be updated in the same implementation phase as command routing changes.

</code_context>

<specifics>
## Specific Ideas

Accepted command surface:

```text
aof init [dir] [--claude] [--codex] [--runtime claude,codex] [--force] [--dry-run]
aof project show [--json]
aof project validate [--json] [--strict]
aof project doctor [--json] [--strict]
aof project migrate [dir] [--force] [--dry-run]
```

Removed command replacements:

```text
aof validate        -> aof project validate
aof doctor          -> aof project doctor
aof migrate         -> aof project migrate
aof config show     -> aof project show
aof config validate -> aof project validate
aof config doctor   -> aof project doctor
aof catalog ...     -> no active replacement; use aof assets ... for source assets
```

</specifics>

<deferred>
## Deferred Ideas

- Catalog/SQLite-backed discovery remains deferred until there is a coherent catalog product path.
- Final live-repository verification and documentation sweep belongs to Phase 22.
- Hosted registries, catalog-backed defaults, and package discovery remain out of scope.

</deferred>

---

*Phase: 21-Project And Diagnostics Commands*
*Context gathered: 2026-05-11*
