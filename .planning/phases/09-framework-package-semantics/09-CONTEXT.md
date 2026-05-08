# Phase 9: Framework Package Semantics - Context

**Gathered:** 2026-05-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 9 upgrades the existing thin `packages[]` / GSD installer path into a package model for framework-supplied assistant assets. The phase is limited to package source descriptors, namespace enforcement, direct dependency metadata, resolved lock state, and pre-write generated-output conflict checks for the current Claude Code and Codex runtimes.

</domain>

<decisions>
## Implementation Decisions

### Package Descriptor Shape
- **D-01:** Preserve compatibility with current string package sources such as `source: "npm:get-shit-done-cc@latest"` while adding a structured package source descriptor form.
- **D-02:** Normalize both forms into one internal representation before validation, install planning, lock writing, or conflict checks.
- **D-03:** Structured descriptors must cover npm, git, and local file sources so `PKG-01` is not limited to npm-only installer semantics.

### Namespace Enforcement
- **D-04:** Package namespaces are explicitly required. Do not silently derive the namespace from package `id` as the only accepted behavior.
- **D-05:** Namespaces must be applied to package-emitted files before any write planning or lock update so conflicts are detected against the final generated paths.
- **D-06:** The namespace is package ownership metadata as well as a path-safety mechanism; downstream work should preserve it in diagnostics and lock state where useful.

### Dependency And Lock Semantics
- **D-07:** Lock state should record direct resolved package metadata for each configured package: package id, namespace, source type, requested source, resolved version/ref/path, selected runtimes, scope, and direct dependency metadata.
- **D-08:** Do not expand this phase into a full transitive package-manager dependency graph. That is beyond the current milestone.
- **D-09:** Existing framework install attempt recording remains useful but should sit alongside resolved package metadata rather than being the only package-related lock state.

### Conflict Policy
- **D-10:** Conflicting generated output claims must fail before writes and before lock mutation.
- **D-11:** Conflict diagnostics must identify the packages or local primitives involved, including namespace/package context when a package claim is involved.
- **D-12:** Known safe merges can remain special-cased, such as the existing Codex `AGENTS.md` rule merge, but package conflicts should not introduce implicit priority or override behavior in this phase.

### the agent's Discretion

The user accepted the recommended defaults for all discussed gray areas. The agent has discretion over exact schema field names and code organization as long as the decisions above, existing CLI compatibility, and Phase 9 requirements are preserved.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/PROJECT.md` - v1.1 milestone scope, package semantics objective, compatibility/security decisions, and deferred non-goals.
- `.planning/REQUIREMENTS.md` - `PKG-01` through `PKG-04`, the authoritative Phase 9 requirement statements.
- `.planning/ROADMAP.md` - Phase 9 goal and success criteria.
- `.planning/STATE.md` - current project state and prior workflow notes, including the local `gsd-sdk query` limitation.

### Prior Phase Decisions
- `.planning/phases/06-cli-lifecycle-commands/06-CONTEXT.md` - sync/install/dry-run/network-boundary decisions that package semantics must preserve.
- `.planning/phases/07-expanded-dsl-primitives/07-RESEARCH.md` - top-level DSL primitive model and lock-owned generated-output path patterns.
- `.planning/phases/08-adapter-degradation-policy/08-CONTEXT.md` - adapter warning policy; warnings are command-time policy, while Phase 9 package resolution belongs in lock state.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` - current CLI, render, lock, sync, and framework module boundaries.
- `.planning/codebase/CONVENTIONS.md` - established CLI parsing, rendering, and warning patterns.
- `.planning/codebase/CONCERNS.md` - package execution is a supply-chain boundary; keep install/network behavior explicit.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/frameworks.mjs`: Current GSD framework install planning, source-to-package-name conversion, prior install skip logic, lock replay, and simulated install testing.
- `src/render-plan.mjs`: Current desired-output grouping, lock manifest creation, drift protection, and the existing safe Codex `AGENTS.md` rule merge.
- `src/lock.mjs`: Lock versioning, hash helpers, lock read/write, and framework install attempt merging.
- `src/sync.mjs`: Combined generated-output and framework installer planning path; keeps installers network-disabled unless `--install` is passed.
- `src/config-inspect.mjs`: Current package validation and doctor/config inspection surfaces.
- `schemas/aof.schema.json`: Current schema allows `packages[]` with `id`, `source`, and `runtimes`, but only as a permissive thin package shape.

### Established Patterns
- CLI commands print human-readable summaries and support JSON where existing commands already do.
- `apply` and `sync` plan writes first, then execute; strict failures and drift warnings happen before side effects.
- `.aof/aof.lock.json` is the durable audit record for generated files and framework/package intent.
- Runtime support remains Claude Code and Codex for v1.1; broader runtime expansion is deferred.
- UI v1 edits valid config only; CLI owns apply/sync/install execution.

### Integration Points
- Package descriptor parsing and normalization should connect to config loading/validation before `planFrameworkInstall` or render planning uses package data.
- Package-emitted outputs, once modeled, need to pass through the same generated-output grouping and pre-write conflict path as local primitives.
- Lock manifest creation needs to include resolved package metadata without breaking existing generated file entries or install attempt history.
- Doctor/config inspection should expose package intent/resolution issues in the same diagnostics style as current validation and package-intent checks.

</code_context>

<specifics>
## Specific Ideas

The user accepted the recommended defaults after asking for the question to be clarified. No additional examples or external references were provided during discussion.

</specifics>

<deferred>
## Deferred Ideas

None - discussion stayed within phase scope.

</deferred>

---

*Phase: 9-Framework Package Semantics*
*Context gathered: 2026-05-08*
