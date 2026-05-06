# Phase 1: `.aof` Workspace Model - Research

**Researched:** 2026-05-06
**Status:** Complete

## Research Question

What does the planner need to know to implement Phase 1 well: establish `.aof/` as the source of truth for config, assets, runtime targets, runtime overrides, and lock state while preserving current CLI behavior?

## Current Codebase Facts

- AOF is a Node.js 20+ ESM CLI. `bin/aof.mjs` delegates to `src/cli.mjs`.
- `src/cli.mjs` owns command routing and currently supports `init`, `apply`, `install`, and `catalog`.
- `aof init` currently writes root `aof.config.json`, renders selected catalog resources immediately, and writes root `aof.lock.json`.
- `src/dsl.mjs` already normalizes resource IDs, validates `kind` and `runtimes`, and resolves file-backed bodies via `path`.
- `src/adapters.mjs` owns runtime output roots and render paths for `skill`, `command`, and `agent`.
- `schemas/aof.schema.json` currently allows `resources[]`, `packages[]`, `items[]`, and `runtimes[]`, with resource kinds limited to `skill`, `command`, and `agent`.
- The BDD integration harness in `test/integration/cli.feature` and `test/integration/cli.mjs` is intentionally black-box and already isolated with temp project/data directories.

## External Runtime Facts

- Claude Code now documents project instructions through `CLAUDE.md`, `./.claude/CLAUDE.md`, and modular `.claude/rules/*.md` files.
- Claude `.claude/rules/*.md` files may include `paths` frontmatter for path-scoped rules.
- Codex natural-language guidance is `AGENTS.md` / `AGENTS.override.md`, discovered hierarchically.
- Codex `.codex/rules/*.rules` files are command execution policy rules for sandbox escalation, not natural-language assistant guidance.

## Planning Implications

### Central Workspace And Capability Model

Phase 1 should introduce a central source module for workspace paths, resource kinds, runtime IDs, capability support, default asset filenames, and override merge policy. This avoids copying constants across:

- `src/dsl.mjs`
- `src/adapters.mjs`
- `schemas/aof.schema.json`
- future UI capability display
- documentation

Suggested module boundary:

- `src/model.mjs` or `src/workspace.mjs`
- Exports `RUNTIMES`, `RESOURCE_KINDS`, `CAPABILITIES`, `WORKSPACE_PATHS`, helper functions for `.aof` config/lock discovery, asset default paths, and allowed override fields.

### Backward Compatibility And Migration

The user chose explicit migration:

- `.aof/aof.config.json` is authoritative when present.
- Root `aof.config.json` is legacy.
- `aof init` must not silently migrate root config.
- Add `aof migrate` for explicit conversion.
- Leave root `aof.config.json` untouched after migration and warn.

This means config discovery should be factored before changing command behavior. `aof apply` should prefer `.aof/aof.config.json` by default when it exists, but still support `--config`.

### Asset Model

The durable source asset shape should be:

```text
.aof/
  aof.config.json
  aof.lock.json
  assets/
    skills/<id>/SKILL.md
    commands/<id>/COMMAND.md
    agents/<id>/AGENT.md
    rules/<id>/RULE.md
      overrides/
        claude.json
        codex.json
```

`aof.config.json` should keep asset metadata and point to body files with `path`. This preserves explicit ordering, runtime targets, and package declarations while keeping large bodies diffable.

### Runtime Overrides

Runtime override files should:

- shallow-merge with shared metadata
- replace fields explicitly rather than deep-merge nested objects
- not change identity fields such as `id`, `kind`, or shared ownership
- be validated per runtime

The planner should ensure tests cover both valid and invalid override attempts.

### Rule Capability Mapping

The shared `rule` kind is natural-language assistant guidance:

- Claude target: `.claude/rules/*.md`, preserving `paths` frontmatter when provided.
- Codex target: `AGENTS.md` or nested `AGENTS.md` generation strategy.
- Codex `.codex/rules/*.rules`: separate future execution-policy asset type, not Phase 1 `rule`.

Since Phase 2 owns full runtime rendering, Phase 1 should at minimum implement the data model and enough rendering/model behavior to prove the mapping is coherent in tests.

### BDD Requirement

The user made BDD tests mandatory for all new functionality. Phase 1 implementation plans must add or update scenarios in `test/integration/cli.feature` and extend `test/integration/cli.mjs` step support where needed. Unit tests should supplement BDD tests, but cannot replace them.

## Risks And Mitigations

- **Risk:** Scattered constants cause drift between parser, renderer, schema, and UI.
  **Mitigation:** Add central model/capability module first and migrate existing modules to use it.

- **Risk:** `aof init` migration behavior surprises existing users.
  **Mitigation:** Refuse silent migration when root config exists without `.aof/`; require `aof migrate`.

- **Risk:** Codex "rules" naming causes model confusion.
  **Mitigation:** Treat Codex `.codex/rules/*.rules` as execution policy, separate from natural-language `rule` guidance.

- **Risk:** Phase 1 overreaches into full rendering.
  **Mitigation:** Implement model, parsing, migration, and minimal renderer support needed by tests; leave broader render/lock expansion for Phase 2.

## Recommended Plan Shape

1. Workspace discovery, init, migration, and BDD coverage.
2. Central model/capability table, asset parsing, schema, overrides, and unit/BDD coverage.
3. Runtime mapping for `rule`, docs, adapter alignment, lock location, and final verification.

## RESEARCH COMPLETE
