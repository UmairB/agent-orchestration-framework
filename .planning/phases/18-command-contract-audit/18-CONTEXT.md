# Phase 18: Command Contract Audit - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 18 defines the public CLI contract for the v1.4 rewrite before implementation. It must review every current command and subcommand, classify it as keep, move, replace, or remove, and produce a concrete replacement taxonomy with command purpose, arguments, missing-argument behavior, prompts, dry-run behavior, output, errors, and BDD expectations.

This phase does not implement the rewrite. Implementation belongs to later phases.

</domain>

<decisions>
## Implementation Decisions

### Top-Level Commands
- **D-01:** `aof init` remains top-level because it creates the AOF project workspace itself.
- **D-02:** `aof init` creates only `.aof/` project config/lock state. It must not create default assets, launch UI, render runtime output, install packages, or initialize catalog storage.
- **D-03:** All other product work moves under namespaces: `aof project ...`, `aof assets ...`, and `aof packages ...`.

### Project Namespace
- **D-04:** Use `project`, not `workspace`, for project-level inspection, validation, diagnostics, and migration.
- **D-05:** Proposed project commands are `aof project show`, `aof project validate`, `aof project doctor`, and `aof project migrate`.
- **D-06:** `aof project show` replaces the current `aof config show` concept.
- **D-07:** `aof project validate` replaces top-level project validation.
- **D-08:** `aof project doctor` replaces top-level diagnostics.
- **D-09:** `aof project migrate` replaces top-level migration and must clearly explain before/after behavior and what remains untouched.

### Assets Namespace
- **D-10:** All asset operations move under `aof assets ...`.
- **D-11:** Supported project asset creation commands are `aof assets add skill [id]`, `aof assets add command [id]`, `aof assets add rule [id]`, and `aof assets add agent [id]`.
- **D-12:** Global is a scope flag, not a product namespace. Use `--global` rather than `aof assets global ...`.
- **D-13:** Supported global asset creation commands are `aof assets add --global skill [id]`, `aof assets add --global rule [id]`, and `aof assets add --global agent [id]`.
- **D-14:** Partial commands should prompt for missing values. For example, `aof assets add skill` prompts for id and details while keeping kind fixed.
- **D-15:** Include asset inspection and removal commands in the contract: `aof assets list`, `aof assets list --global`, `aof assets show skill <id>`, `aof assets show --global skill <id>`, `aof assets remove skill <id>`, and `aof assets remove --global skill <id>`.
- **D-16:** Include project reference commands for global assets: `aof assets use --global skill <id>` and `aof assets unuse --global skill <id>`.
- **D-17:** `aof assets apply` renders assets for all configured project runtimes by default. Runtime flags such as `--codex`, `--claude`, or `--runtime codex,claude` narrow a single run.
- **D-18:** `aof assets validate` validates asset configuration, including referenced global assets.
- **D-19:** `aof assets clean` removes lock-owned generated asset outputs while preserving drift protection.
- **D-20:** `aof assets ui` starts the source asset editor. No install command may launch the editor.

### Packages Namespace
- **D-21:** GSD is a managed package/tooling integration, not an assistant asset.
- **D-22:** Managed package work moves under `aof packages ...`.
- **D-23:** `aof packages add gsd` declares GSD package intent in `.aof/aof.config.json` and must not run networked installer code.
- **D-24:** `aof packages install gsd` executes the GSD installer with explicit network/package-code boundary output.
- **D-25:** `aof packages install` installs all configured packages.
- **D-26:** `aof packages install --from-lock` replays package install intent from lock state.
- **D-27:** Include package inspection and removal commands in the contract: `aof packages list`, `aof packages show gsd`, `aof packages remove gsd`, and `aof packages validate`.
- **D-28:** `--dry-run` for package install previews installer commands without running networked code.

### Removed Commands
- **D-29:** This is a full rewrite with no legacy aliases.
- **D-30:** Remove top-level `aof add`, `aof apply`, `aof sync`, `aof clean`, `aof validate`, `aof doctor`, `aof global`, `aof install`, `aof catalog`, and `aof config`.
- **D-31:** Remove `sync` entirely. The explicit replacement is `aof assets apply` for rendering and `aof packages install` for installer execution.
- **D-32:** Removed commands should not execute or alias. They may fail with a helpful targeted error that points at the new namespace, for example `aof assets add skill`, `aof packages add gsd`, or `aof project doctor`.

### Help And Output Contract
- **D-33:** Help output should be grouped by product area: project setup, assets, packages, and project diagnostics.
- **D-34:** Help examples must show common workflows, not just syntax.
- **D-35:** Success output should state exactly what changed and the next useful command.
- **D-36:** Error output should name the invalid command/argument and show the nearest valid namespace command.
- **D-37:** Dry-run output should be explicit about no writes, no installer execution, and which files or commands would be affected.

### the agent's Discretion
- The planner may decide exact option names for non-controversial flags where they already exist, but must preserve accepted semantics: configured runtimes by default, narrowing flags for one run, no legacy aliases, no catalog side effects.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/PROJECT.md` - v1.4 milestone goal and locked command namespace decisions.
- `.planning/REQUIREMENTS.md` - Phase 18 requirements CLI-01 through CLI-04 and downstream namespace requirements.
- `.planning/ROADMAP.md` - Phase 18 boundary and success criteria.
- `.planning/STATE.md` - current milestone state and v1.4 user decisions.

### Codebase Maps
- `.planning/codebase/STRUCTURE.md` - current source layout and important files for CLI changes.
- `.planning/codebase/CONVENTIONS.md` - CLI option parsing, error handling, runtime selection, testing, and documentation patterns.
- `.planning/codebase/INTEGRATIONS.md` - current GSD installer, setup UI, and catalog integration notes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.mjs`: current command router and help text; Phase 18 planning should use it to enumerate the old command surface.
- `src/scaffold.mjs`: existing project/global asset scaffolding behavior to preserve under `aof assets`.
- `src/sync.mjs`, `src/clean.mjs`, and `src/render-plan.mjs`: current render/clean/lock behavior that the assets namespace must preserve later.
- `src/frameworks.mjs` and `src/packages.mjs`: current package intent and GSD installer behavior that should move under `aof packages`.
- `src/setup-ui.mjs` and `ui/`: current editor launch/API surface that should be exposed through `aof assets ui`.

### Established Patterns
- `src/cli.mjs` uses `parseOptions()` with explicit boolean flags and positional args in `options._`.
- User-facing failures throw `Error` with direct messages; `bin/aof.mjs` handles top-level printing.
- Runtime flags already support `--codex`, `--claude`, and `--runtime` style narrowing in existing flows.
- BDD integration features are the preferred place for user-facing command contracts.

### Integration Points
- Command taxonomy changes start in `src/cli.mjs`.
- User-facing behavior changes need BDD coverage in `test/integration/features/` and PowerShell parity where applicable.
- README and help text must be updated in the same phase that changes command contracts.

</code_context>

<specifics>
## Specific Ideas

Accepted draft command map:

```text
aof init

aof project show
aof project validate
aof project doctor
aof project migrate

aof assets add skill [id]
aof assets add command [id]
aof assets add rule [id]
aof assets add agent [id]
aof assets add --global skill [id]
aof assets add --global rule [id]
aof assets add --global agent [id]
aof assets list [--global]
aof assets show [--global] <kind> <id>
aof assets remove [--global] <kind> <id>
aof assets use --global <kind> <id>
aof assets unuse --global <kind> <id>
aof assets apply
aof assets validate
aof assets clean
aof assets ui

aof packages add gsd
aof packages list
aof packages show gsd
aof packages remove gsd
aof packages validate
aof packages install [gsd]
aof packages install --from-lock
```

</specifics>

<deferred>
## Deferred Ideas

- Reintroducing catalog/SQLite behavior remains deferred until there is a coherent catalog product path.
- Hosted discovery, distribution, cross-machine global sync, and UI-driven command execution remain future milestones.

</deferred>

---

*Phase: 18-Command Contract Audit*
*Context gathered: 2026-05-10*
