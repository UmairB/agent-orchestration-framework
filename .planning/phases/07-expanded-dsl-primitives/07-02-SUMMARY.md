---
phase: 7
plan: 2
subsystem: runtime-rendering
tags:
  - dsl
  - rendering
  - runtime-config
  - lock
key-files:
  created:
    - src/runtime-config.mjs
    - .planning/phases/07-expanded-dsl-primitives/07-02-SUMMARY.md
  modified:
    - src/adapters.mjs
    - src/dsl.mjs
    - test/adapters.test.mjs
    - test/render-plan.test.mjs
    - test/dsl-primitives.test.mjs
    - test/integration/cli.feature
    - test/integration/cli.mjs
requirements-completed:
  - DSL-01
  - DSL-02
  - DSL-03
  - DSL-04
  - DSL-05
completed: 2026-05-07
---

# Phase 7 Plan 2: Runtime Rendering Summary

Expanded DSL primitives now render into Claude Code and Codex project outputs through the same generated-output path as existing resources, so apply/sync dry-run, lock ownership, stale pruning, and drift protection remain centralized.

## What Changed

- Added `src/runtime-config.mjs` with deterministic JSON and TOML builders for runtime config output.
- Rendered MCP declarations to root `.mcp.json` for Claude and `.codex/config.toml` for Codex.
- Rendered command hooks to `.claude/settings.json` and `.codex/config.toml`.
- Rendered project docs to root `AGENTS.md` and `CLAUDE.md` with deterministic section ordering.
- Added project doc `{{include path/to/file.md}}` expansion during config loading with missing-file, cycle, absolute-path, and path-traversal guards.
- Routed expanded primitive outputs through adapter descriptors so render-plan locking and drift checks apply without a parallel write path.
- Added BDD coverage for applying expanded DSL primitives end to end.

## Verification

| Command | Result |
|---------|--------|
| `npm run test:unit` | Passed |
| `npm test` | Passed |

## Deviations from Plan

- `src/dsl.mjs` was modified in addition to the planned file set so project doc include macros can be resolved while loading config. This keeps `createRenderPlan()` and adapter rendering synchronous and avoids a separate file-read path during output generation.
- `src/render-plan.mjs` did not need code changes because expanded primitive outputs are aggregated before reaching the render-plan grouping step.

## Self-Check: PASSED

- Existing resource rendering remains unchanged.
- Expanded outputs are represented as lock-owned generated files.
- Root `AGENTS.md`, `CLAUDE.md`, and `.mcp.json` receive the same drift protection as other generated files.
- Runtime-specific extension objects are only passed to their matching runtime output.
