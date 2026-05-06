# Phase 1: `.aof` Workspace Model - Context

**Gathered:** 2026-05-06T15:39:30+01:00
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 1 establishes `.aof/` as the repo-local source of truth for AOF configuration, source asset bodies, runtime targeting, runtime override data, and lock/install state. It covers the workspace model and compatibility/migration path from the existing root `aof.config.json`; runtime rendering into `.claude/` and `.codex/` is primarily Phase 2, except where Phase 1 must define model semantics that rendering will later consume.

</domain>

<decisions>
## Implementation Decisions

### `.aof/` Workspace Shape
- **D-01:** The primary config entry point is `.aof/aof.config.json`.
- **D-02:** Source asset bodies are file-backed by default under `.aof/assets/<kind>/<id>/...`.
- **D-03:** Runtime-specific override data lives beside the asset it modifies, for example `.aof/assets/<kind>/<id>/overrides/claude.json` and `.aof/assets/<kind>/<id>/overrides/codex.json`.
- **D-04:** Lock/install state lives at `.aof/aof.lock.json`.

### Root Config Compatibility
- **D-05:** When both root `aof.config.json` and `.aof/aof.config.json` exist, `.aof/aof.config.json` is authoritative and the root file is legacy.
- **D-06:** `aof init` must not silently migrate an existing root `aof.config.json`.
- **D-07:** Phase 1 should add an explicit `aof migrate` command for root config reconciliation.
- **D-08:** After successful migration, leave root `aof.config.json` untouched and warn that `.aof/aof.config.json` is now authoritative.

### Asset Model
- **D-09:** `.aof/aof.config.json` stores asset metadata with `path` pointing to each file-backed asset body.
- **D-10:** Add one shared `rule` asset kind for natural-language assistant guidance.
- **D-11:** Claude `rule` assets render to `.claude/rules/*.md`, including `paths` frontmatter where provided.
- **D-12:** Codex `rule` assets render into `AGENTS.md` or nested `AGENTS.md`.
- **D-13:** Codex `.codex/rules/*.rules` is a separate future execution-policy asset type, not part of Phase 1's shared `rule` kind. Generated `AGENTS.md` may reference those policy files later for awareness.
- **D-14:** Shared `rule` assets support a generic `paths` field.
- **D-15:** Generated asset body files use kind-specific defaults: `SKILL.md`, `COMMAND.md`, `AGENT.md`, and `RULE.md`.

### Runtime Overrides And Capabilities
- **D-16:** Runtime overrides may change runtime-specific metadata and rendering fields, but not asset identity: `id`, `kind`, and shared ownership remain stable.
- **D-17:** Unsupported runtime behavior must be handled capability-by-capability, not by one global fallback rule.
- **D-18:** Phase 1 should establish a central runtime capability table for Claude Code and Codex.
- **D-19:** The capability table should cover `skill`, `command`, `agent`, `rule` guidance, path-scoped rules, and future Codex execution-policy rules as distinct capabilities.
- **D-20:** Runtime capability data should live in a central source module, with schema/docs kept aligned from it.
- **D-21:** Runtime override files merge with shared metadata via shallow merge with explicit replacement fields.

### Verification
- **D-22:** BDD tests are required for all new functionality. This is a global decision, not only a Phase 1 preference.
- **D-23:** Phase 1 planning must include BDD coverage for `.aof/` init behavior, explicit `aof migrate`, config precedence, file-backed asset loading, rule rendering/model semantics, capability handling, and runtime overrides.

### the agent's Discretion
No areas were delegated to the agent's discretion. The user selected concrete decisions for all discussed areas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 1 goal, requirements, success criteria, and phase boundary.
- `.planning/PROJECT.md` — Product context, constraints, and source-of-truth decisions.
- `.planning/REQUIREMENTS.md` — v1 requirements mapped to Phase 1.
- `.planning/STATE.md` — Current phase state and project memory.

### Codebase Maps
- `.planning/codebase/STACK.md` — Node/Vite stack, runtime constraints, and scripts.
- `.planning/codebase/ARCHITECTURE.md` — CLI/module boundaries and existing init/apply/catalog/install flows.
- `.planning/codebase/INTEGRATIONS.md` — Filesystem, SQLite catalog, framework installer, and runtime output boundaries.
- `.planning/codebase/TESTING.md` — Existing unit and BDD-style integration harness; BDD expansion is required.

### Current Implementation
- `src/cli.mjs` — Existing command dispatch, `init`, `apply`, `install`, root config and lock writes.
- `src/dsl.mjs` — Existing config loading, resource normalization, runtime validation, and file-backed body support.
- `src/adapters.mjs` — Existing Claude/Codex runtime definitions and resource rendering.
- `schemas/aof.schema.json` — Existing root config schema to evolve for `.aof/` workspace model.
- `aof.config.json` — Current legacy root config example that migration must preserve/reconcile.

### Runtime Docs Referenced In Discussion
- `https://code.claude.com/docs/en/memory` — Claude Code `CLAUDE.md`, `.claude/CLAUDE.md`, and `.claude/rules/*.md` behavior, including path-scoped rules.
- `https://developers.openai.com/codex/guides/agents-md` — Codex `AGENTS.md` / `AGENTS.override.md` custom instruction discovery and precedence.
- `https://developers.openai.com/codex/rules` — Codex `.codex/rules/*.rules` execution-policy rules; separate from natural-language guidance.
- `https://www.reddit.com/r/ClaudeAI/comments/1piuih6/claude_rules_clauderules_are_here/` — User-provided reference that surfaced current Claude `.claude/rules/` support.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/dsl.mjs`: Already supports `resource.path` and file-backed body resolution, which should be extended rather than replaced for `.aof/assets/...`.
- `src/adapters.mjs`: Already centralizes runtime output roots and resource path rendering; Phase 1 should introduce a stronger central runtime/capability model before Phase 2 expands rendering.
- `schemas/aof.schema.json`: Existing schema already models `resources[]`, `packages[]`, `runtimes`, and free-form additional properties; it is the natural place to align validation with the new central capability module.
- `test/integration/cli.feature`: Existing BDD-style feature file should be expanded for all new user-facing CLI behavior.

### Established Patterns
- CLI behavior is implemented in small ESM modules with local option parsing in `src/cli.mjs`.
- Config parsing and normalization belong in `src/dsl.mjs`; filesystem writing belongs in `src/fs.mjs`; runtime-specific output belongs in `src/adapters.mjs`.
- Existing tests use a lightweight Node assertion harness and BDD integration scenarios rather than a third-party test framework.
- Current root `aof.config.json` and `aof.lock.json` are legacy project files once `.aof/` exists.

### Integration Points
- `aof init` must create `.aof/` for new projects but refuse silent migration when a root `aof.config.json` already exists.
- New `aof migrate` command must read the legacy root config and create `.aof/aof.config.json`, file-backed assets, overrides if needed, and `.aof/aof.lock.json` without mutating the root config.
- `aof apply` and config discovery must prefer `.aof/aof.config.json` when present.
- Runtime capability data should be centralized so CLI validation, schema/docs, adapters, and later UI capability display do not drift.

</code_context>

<specifics>
## Specific Ideas

- Use `.aof/assets/<kind>/<id>/` as the durable ownership unit for source assets.
- Use `overrides/claude.json` and `overrides/codex.json` inside each asset directory.
- Treat natural-language `rule` assets and Codex command execution `.rules` files as different asset families.
- Allow generated Codex `AGENTS.md` content to reference Codex policy rule files when that future asset type exists.

</specifics>

<deferred>
## Deferred Ideas

- Codex `.codex/rules/*.rules` support is deferred as a separate future execution-policy asset type. It should not be conflated with Phase 1 natural-language `rule` guidance.

</deferred>

---

*Phase: 1-`.aof` Workspace Model*
*Context gathered: 2026-05-06T15:39:30+01:00*
