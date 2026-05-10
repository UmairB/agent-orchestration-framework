# Phase 19: Assets Namespace Rewrite - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 19 implements the accepted `aof assets ...` command surface from Phase 18. It moves asset source management, global asset scope, project global references, rendering, validation, cleanup, and editor launch into the assets namespace.

This is a full migration phase, not a compatibility layer. Old top-level asset commands must stop executing and must not remain as aliases.

</domain>

<decisions>
## Implementation Decisions

### Migration Strategy
- **D-01:** Perform the full assets namespace migration in one pass.
- **D-02:** Do not ship staged compatibility, temporary aliases, or dual execution paths for asset commands.
- **D-03:** Removed top-level asset commands may fail with helpful replacement guidance, but they must not execute old behavior.

### Asset Commands
- **D-04:** Implement the full accepted assets command set now: `add`, `list`, `show`, `remove`, `use`, `unuse`, `apply`, `validate`, `clean`, and `ui`.
- **D-05:** `aof assets add skill|command|rule|agent` replaces project asset creation.
- **D-06:** `aof assets add --global skill|rule|agent` replaces reusable global asset creation.
- **D-07:** `aof assets use --global <kind> <id>` and `aof assets unuse --global <kind> <id>` own project references to global assets.

### Rendering And Cleanup
- **D-08:** `aof assets apply` fully replaces current asset rendering behavior from both old `apply` and the asset-rendering portion of old `sync`.
- **D-09:** `aof assets apply` renders all runtimes configured in the project by default; runtime flags narrow a single run.
- **D-10:** Preserve existing render planning, adapter warning, strict-mode, lock, global-reference, associated-file, and drift-protection semantics under the new command names.
- **D-11:** `aof assets clean` replaces old cleanup behavior and must preserve lock-owned cleanup safety.

### Editor Launch
- **D-12:** `aof assets ui` is the only CLI command in this phase that launches the local source asset editor.
- **D-13:** `aof install` must not launch the editor and must not remain as a working UI alias.
- **D-14:** Remove remaining catalog-backed setup UI launch dependency while preserving the current project/global source editing API.

### Removed Commands
- **D-15:** Asset-related removed top-level commands in this phase include `aof add`, `aof apply`, `aof sync`, `aof clean`, `aof global`, and `aof install`.
- **D-16:** These commands should fail with namespaced replacement hints and no asset, runtime output, lock, package, catalog, or SQLite side effects.

### the agent's Discretion
- The planner may split implementation into waves by command group, but the phase outcome must be the complete assets namespace migration.
- The planner may choose exact internal helper boundaries, as long as public behavior matches the Phase 18 CLI and BDD contracts.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Contract
- `.planning/phases/18-command-contract-audit/18-CLI-CONTRACT.md` - accepted public command contract for `aof assets ...`.
- `.planning/phases/18-command-contract-audit/18-BDD-CONTRACT.md` - required BDD scenarios and parity expectations for namespaced commands.
- `.planning/phases/18-command-contract-audit/18-COMMAND-INVENTORY.md` - current command inventory and replacement mapping.
- `.planning/phases/18-command-contract-audit/18-CONTEXT.md` - locked v1.4 namespace decisions.

### Project Planning
- `.planning/PROJECT.md` - v1.4 milestone goal and product decisions.
- `.planning/REQUIREMENTS.md` - ASSET-01 through ASSET-06 requirements.
- `.planning/ROADMAP.md` - Phase 19 goal and success criteria.
- `.planning/STATE.md` - current milestone state and recent context.

### Codebase Maps
- `.planning/codebase/STRUCTURE.md` - source layout and important CLI/render/UI files.
- `.planning/codebase/CONVENTIONS.md` - CLI parsing, error handling, filesystem, runtime selection, and testing patterns.
- `.planning/codebase/INTEGRATIONS.md` - current setup UI, filesystem, GSD installer, and removed catalog/SQLite integration notes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/scaffold.mjs`: existing project and global asset scaffolding should be reused under `aof assets add`.
- `src/render-plan.mjs` and `src/adapters.mjs`: existing render planning, runtime output mapping, associated files, adapter warnings, and lock ownership should be preserved under `aof assets apply`.
- `src/clean.mjs`: existing lock-owned cleanup and drift preservation should be preserved under `aof assets clean`.
- `src/config-inspect.mjs`: existing project/global validation and inspection functions should back `aof assets validate`, `list`, and `show` where applicable.
- `src/setup-ui.mjs` and `ui/`: existing project/global source editing API should be launched by `aof assets ui`.
- `src/prompt.mjs`: existing `@inquirer/prompts` wrapper and env-driven test inputs should be reused for partial `assets add` flows.

### Established Patterns
- `src/cli.mjs` owns command routing and `parseOptions()`; namespace routing should start there.
- User-facing failures throw `Error` with direct messages; `bin/aof.mjs` remains the catch/print boundary.
- Runtime flags already support `--codex`, `--claude`, and `--runtime` style narrowing.
- BDD integration features and PowerShell parity are the preferred checks for user-facing CLI behavior.

### Integration Points
- `src/cli.mjs` currently contains old top-level `add`, `apply`, `sync`, `clean`, `global`, and `install` flows that need replacement or removal.
- `test/integration/features/` currently contains old command scenarios that must be rewritten to `assets ...` behavior.
- `test/integration/cli.ps1` must keep parity for the externally visible assets namespace behavior.
- README/help text must be updated in the same implementation phase as command routing changes.

</code_context>

<specifics>
## Specific Ideas

The user explicitly confirmed: "Yep full migration."

Phase 19 should therefore avoid a partial migration that leaves users unsure whether old or new command names are authoritative.

</specifics>

<deferred>
## Deferred Ideas

- Package namespace migration belongs to Phase 20.
- Project diagnostics and migration namespace work belongs to Phase 21.
- Final live-repository verification and documentation sweep belongs to Phase 22.
- Reintroducing catalog/SQLite behavior remains deferred until there is a coherent catalog product path.

</deferred>

---

*Phase: 19-Assets Namespace Rewrite*
*Context gathered: 2026-05-10*
