# Phase 2: Runtime Rendering And Lock State - Context

**Gathered:** 2026-05-06T00:00:00+01:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 2 renders `.aof/` assets into Claude Code and Codex runtime folders, treats `.claude/` and `.codex/` as generated output, preserves dry-run behavior, and writes reproducible lock state. It covers generated-file ownership, drift/stale-file handling, deterministic merged runtime outputs, and framework intent recording. It does not implement the full interactive CLI/install flow for GSD; that belongs to Phase 3.

</domain>

<decisions>
## Implementation Decisions

### Lock State
- **D-01:** `.aof/aof.lock.json` should primarily be a generated manifest after `aof apply`.
- **D-02:** The lock manifest should record each generated file path, source asset id, source asset kind, target runtime, content hash, and generation timestamp.
- **D-03:** When `aof apply` finds a previously generated runtime file whose current content hash differs from the prior lock entry, treat it as drift.
- **D-04:** Drifted files should be warned about and skipped by default; overwriting them requires an explicit force flag.
- **D-05:** Phase 2 should record managed framework intent in the lock, but only as intent: declared framework package, target runtimes, scope, version or range when known, and dry-run/install intent.
- **D-06:** Phase 2 should not implement full framework install-result tracking or new GSD execution behavior; that remains Phase 3 scope.

### Generated Output
- **D-07:** Generated files should include a small generated-by marker where the target file format allows it.
- **D-08:** Exact generated-file ownership and drift detection should come from `.aof/aof.lock.json`, not from marker parsing alone.
- **D-09:** When a source asset is removed or retargeted, `aof apply` should prune stale runtime files only if the prior lock says AOF generated them and they have not drifted.
- **D-10:** Stale files that have drifted should not be deleted by default.
- **D-11:** If multiple Codex `rule` assets target the same `AGENTS.md`, AOF should produce one deterministic generated file.
- **D-12:** Merged Codex `AGENTS.md` output should use stable section order by asset id, with each section clearly labeled.

### Dry Run
- **D-13:** `aof apply --dry-run` should show an action plan with reasons.
- **D-14:** Dry-run output should classify each affected file as create, update, delete, skip, or drift-warning.
- **D-15:** Dry-run output should include the file path, runtime, source asset, and reason for the action.
- **D-16:** Dry-run should run the same ownership, hash, drift, and stale-file analysis as real apply.
- **D-17:** Dry-run must not write runtime files, delete stale files, or update `.aof/aof.lock.json`.
- **D-18:** Dry-run may report the would-be lock manifest summary, but the persisted lock remains unchanged.

### the agent's Discretion
No areas were delegated to the agent's discretion. The user selected concrete decisions for all discussed areas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 2 goal, requirements, success criteria, and boundary.
- `.planning/PROJECT.md` — Product context, source-of-truth decisions, runtime constraints, and active requirements.
- `.planning/REQUIREMENTS.md` — REND-01 through REND-04, FRAM-04, CLI-03, and CLI-04.
- `.planning/STATE.md` — Current project state and Phase 2 focus.
- `.planning/phases/01-aof-workspace-model/01-CONTEXT.md` — Locked Phase 1 decisions for `.aof/` workspace shape, asset model, rule mapping, runtime overrides, and capability table.

### Codebase Maps
- `.planning/codebase/ARCHITECTURE.md` — Existing CLI, apply, adapter, DSL, filesystem, and framework module boundaries.
- `.planning/codebase/INTEGRATIONS.md` — Local filesystem runtime roots, SQLite catalog, and framework installer boundaries.
- `.planning/codebase/TESTING.md` — Existing unit and BDD integration harness; BDD coverage remains required.
- `.planning/codebase/CONVENTIONS.md` — Module style, filesystem helper use, CLI option parsing, rendering patterns, and current consistency issues.

### Current Implementation
- `src/cli.mjs` — Existing `apply` orchestration, dry-run option flow, runtime parsing, and command output behavior.
- `src/adapters.mjs` — Runtime-specific render targets and existing rendering behavior.
- `src/dsl.mjs` — `.aof/` config loading, file-backed assets, runtime target validation, and override handling.
- `src/fs.mjs` — Shared write helpers and dry-run action metadata.
- `src/frameworks.mjs` — Existing GSD installer command construction and Phase 2 framework intent boundary.
- `src/model.mjs` — Central runtime/resource/capability model established in Phase 1.
- `schemas/aof.schema.json` — Config schema that must remain aligned with Phase 2 lock/render behavior where applicable.
- `test/integration/cli.feature` — BDD scenarios to extend for rendering, dry-run, drift, pruning, and lock behavior.
- `test/adapters.test.mjs` — Existing adapter tests to extend for merged outputs and markers.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/adapters.mjs`: Existing runtime target path rendering should be extended for deterministic merged outputs and generated markers.
- `src/cli.mjs`: Existing `apply` flow is the integration point for render planning, drift checks, dry-run output, and lock writing.
- `src/dsl.mjs`: Existing `.aof/` config parsing and runtime override handling should remain the input boundary.
- `src/fs.mjs`: Existing dry-run-aware write helper can inform the action plan shape, but Phase 2 needs pre-write analysis for drift and stale files.
- `src/frameworks.mjs`: Existing GSD installer metadata should be represented as lock intent without expanding install execution in Phase 2.
- `src/model.mjs`: Central capability/resource definitions from Phase 1 should drive runtime render support rather than duplicating resource rules.

### Established Patterns
- CLI behavior is implemented in small ESM modules with direct `Error` messages for user-facing failures.
- Config parsing belongs in `src/dsl.mjs`; runtime output belongs in `src/adapters.mjs`; low-level file IO belongs in `src/fs.mjs`; command orchestration and reporting belong in `src/cli.mjs`.
- Tests use Node's built-in assertion harness plus BDD-style integration scenarios in `test/integration/cli.feature`.
- New user-facing CLI behavior must have BDD coverage.

### Integration Points
- `aof apply` should build a render action plan before writing so dry-run and real apply share the same analysis path.
- Lock loading/writing belongs under `.aof/aof.lock.json`, following Phase 1's source-of-truth decision.
- Runtime folders `.claude/` and `.codex/` are output targets only; apply should avoid treating them as source data.
- Generated output pruning must be based on prior lock ownership plus hash verification.

</code_context>

<specifics>
## Specific Ideas

- Use lock entries as the source of truth for ownership, current content hash comparison, drift detection, and stale-file pruning.
- Prefer a shared render-plan/action-plan abstraction so `--dry-run` and real `apply` cannot diverge.
- Use stable asset-id ordering for merged `AGENTS.md` sections to make output reproducible and reviewable.
- Keep generated markers small and format-appropriate; do not rely on markers as the only ownership mechanism.

</specifics>

<deferred>
## Deferred Ideas

- Full managed GSD install flow, interactive install behavior, and framework install-result tracking remain Phase 3 scope.
- Codex `.codex/rules/*.rules` execution-policy assets remain a separate future asset type, as decided in Phase 1.

</deferred>

---

*Phase: 2-Runtime Rendering And Lock State*
*Context gathered: 2026-05-06T00:00:00+01:00*
