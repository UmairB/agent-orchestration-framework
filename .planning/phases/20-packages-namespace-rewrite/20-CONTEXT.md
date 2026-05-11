# Phase 20: Packages Namespace Rewrite - Context

**Gathered:** 2026-05-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 20 implements the accepted `aof packages ...` command surface from Phase 18. It moves managed package declaration, inspection, validation, installer execution, and lock replay into the packages namespace, with GSD as the concrete v1.4 package.

This is a full migration phase for package behavior. Old top-level `aof install ...` behavior must not return as an alias, and package execution must not be reachable through `aof assets apply`.

</domain>

<decisions>
## Implementation Decisions

### Migration Strategy
- **D-01:** Perform the full packages namespace migration in one pass for GSD package intent and installer execution.
- **D-02:** Do not ship staged compatibility, temporary aliases, or dual execution paths for package commands.
- **D-03:** Removed top-level package commands may fail with helpful replacement guidance, but they must not execute old behavior.

### Package Commands
- **D-04:** Implement `aof packages add gsd` to declare package intent in `.aof/aof.config.json`.
- **D-05:** `packages add gsd` must not run `npm`, `npx`, or any networked/package-code installer.
- **D-06:** Implement `aof packages list`, `aof packages show gsd`, and `aof packages validate` for package inspection and validation.
- **D-07:** Implement `aof packages remove gsd` to remove package intent from config without uninstalling generated/runtime files.

### Installer Execution
- **D-08:** Implement `aof packages install gsd` to execute GSD installer commands through the existing installer planning/execution machinery.
- **D-09:** Implement `aof packages install` with no package id as "install all configured installable packages"; for v1.4 this means configured GSD intent.
- **D-10:** Implement `aof packages install --from-lock` to replay package install intent from `.aof/aof.lock.json`.
- **D-11:** Preserve explicit network/package-code boundary output before any non-dry-run installer execution.
- **D-12:** Preserve simulated framework installer statuses in tests and lock attempt metadata.
- **D-13:** `--dry-run` for package install must preview commands and state that no network or installer commands will run.

### Runtime And Scope Flags
- **D-14:** Preserve runtime narrowing flags for package add/install where existing GSD installer planning supports them: `--codex`, `--claude`, and `--runtime`.
- **D-15:** `--global` on package install means runtime-home install scope for the external installer, not global AOF asset source scope.
- **D-16:** `packages add gsd` may record runtime targets and package source, but runtime-home global install scope is an execution concern unless the existing package schema already represents it safely.

### Removed And Rejected Paths
- **D-17:** Old `aof install gsd` and `aof install --from-lock` must remain removed-command failures.
- **D-18:** `aof assets apply --install` must continue failing and pointing to `aof packages install`.
- **D-19:** `aof sync --install` must continue failing and pointing to explicit `assets apply` plus `packages install`.

### Out Of Scope
- **D-20:** Do not reintroduce catalog/SQLite/package discovery behavior.
- **D-21:** Do not implement hosted package registries, package downloads/extraction, uninstall semantics, or package UI execution in this phase.
- **D-22:** Project namespace cleanup remains Phase 21.

### the agent's Discretion
- The planner may decide whether to extract package config editing helpers from `src/cli.mjs` or keep the first pass local, but public behavior must match the Phase 18 contract.
- The planner may choose exact human/JSON payload details for list/show/validate, as long as they expose package id, namespace, source, runtimes, configured intent, and relevant lock attempts.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase Contract
- `.planning/phases/18-command-contract-audit/18-CLI-CONTRACT.md` - accepted public command contract for `aof packages ...`.
- `.planning/phases/18-command-contract-audit/18-BDD-CONTRACT.md` - required package BDD scenarios and parity expectations.
- `.planning/phases/18-command-contract-audit/18-COMMAND-INVENTORY.md` - current command inventory and replacement mapping.
- `.planning/phases/18-command-contract-audit/18-CONTEXT.md` - locked v1.4 namespace decisions.
- `.planning/phases/19-assets-namespace-rewrite/19-VERIFICATION.md` - package behavior deferred from assets phase and removed-command baseline.

### Project Planning
- `.planning/PROJECT.md` - v1.4 milestone goal and product decisions.
- `.planning/REQUIREMENTS.md` - PKG-01 through PKG-04 requirements.
- `.planning/ROADMAP.md` - Phase 20 goal and success criteria.
- `.planning/STATE.md` - current milestone state and recent context.

### Codebase Maps
- `.planning/codebase/STRUCTURE.md` - source layout and important CLI/package files.
- `.planning/codebase/CONVENTIONS.md` - CLI parsing, error handling, filesystem, runtime selection, and testing patterns.
- `.planning/codebase/INTEGRATIONS.md` - current GSD installer and package integration notes.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli.mjs`: currently contains old internal `frameworkInstallCommand`, `installFromLockCommand`, and removed command routing; Phase 20 should expose the reusable behavior through `aof packages ...`.
- `src/frameworks.mjs`: existing GSD command planning, lock replay planning, dry-run behavior, simulated installer execution, and prior-attempt skip logic.
- `src/packages.mjs`: existing package descriptor normalization and validation utilities.
- `src/config-inspect.mjs`: existing package validation and doctor checks.
- `src/render-plan.mjs` and `src/lock.mjs`: existing package/framework intent and install attempt lock metadata.
- `test/integration/features/packages.feature`: current package behavior and removed old install/sync expectations.
- `test/frameworks.test.mjs` and `test/packages.test.mjs`: unit coverage for installer planning and package descriptors.

### Established Patterns
- `src/cli.mjs` owns command routing and `parseOptions()`; namespace routing should start there.
- User-facing failures throw `Error` with direct messages; `bin/aof.mjs` remains the catch/print boundary.
- Runtime flags already support `--codex`, `--claude`, and `--runtime` style narrowing.
- BDD integration features and PowerShell parity are required for user-facing CLI behavior.

### Integration Points
- Package add/remove writes `.aof/aof.config.json` and must preserve unrelated config sections.
- Package install writes `.aof/aof.lock.json` attempt metadata and must not mutate package config.
- Package dry-run writes neither config nor lock state.
- Package install should remain testable without real npm through existing framework status simulation.

</code_context>

<specifics>
## Specific Ideas

Phase 20 should keep the user-facing distinction sharp:

```text
aof packages add gsd                # declare intent only, no network
aof packages install gsd --dry-run  # preview installer commands, no network
aof packages install gsd            # execute installer with warning boundary
aof packages install --from-lock    # replay lock install intent
```

For now, GSD is the only package with installer execution semantics. Generic package descriptors can remain validated and recorded as package intent, but installer execution beyond GSD is out of scope unless existing code already supports a safe no-op/preview.

</specifics>

<deferred>
## Deferred Ideas

- Package discovery/catalog/SQLite behavior.
- Hosted registries or package publishing.
- Package archive extraction and vendoring.
- Package uninstall/runtime cleanup semantics.
- UI-driven package add/install execution.
- Project namespace cleanup, including removing top-level `validate`, `doctor`, `migrate`, `config`, and `catalog`, remains Phase 21.

</deferred>

---

*Phase: 20-Packages Namespace Rewrite*
*Context gathered: 2026-05-10*
