# Phase 9 Pattern Map: Framework Package Semantics

## Closest Existing Analogs

### Config normalization

- `src/dsl.mjs` resolves resources, project docs, MCP servers, hooks, and settings into normalized runtime-ready objects.
- Phase 9 package normalization should follow this pattern: validate structure separately in `src/config-inspect.mjs`, then normalize for runtime use in `src/dsl.mjs` or a shared helper.

### Semantic diagnostics

- `src/config-inspect.mjs` accumulates diagnostics with `{ severity, path, message, code }`.
- Package namespace/source/dependency validation should use this same diagnostic shape.

### Installer planning

- `src/frameworks.mjs` returns pure installer plan items with `argv`, `command`, `runtime`, `scope`, `packageSource`, and skip metadata before executing anything.
- New package source descriptors should feed this planner rather than bypass it.

### Generated-output ownership

- `src/adapters.mjs` emits desired output objects with `path`, `runtime`, `resource`, `source`, `content`, and `hash`.
- Package-owned outputs should use the same object shape with richer `source` metadata, not a separate write pipeline.

### Conflict and drift gates

- `src/render-plan.mjs` groups desired outputs by normalized path before write planning and preserves drifted lock entries.
- Phase 9 conflict handling belongs before `planApplyActions()` and should preserve the existing Codex `AGENTS.md` merge exception.

### BDD fixtures

- `test/integration/cli.mjs` uses small fixture writers such as `writeAofProject()` and scenario-specific step handlers.
- Phase 9 scenarios should extend these helpers for package descriptors and package-output claims rather than creating separate integration harness code.

## Files Likely To Change

- `src/packages.mjs` - new shared package descriptor, dependency, resolved metadata, and source normalization helpers.
- `src/dsl.mjs` - normalize `packages[]` through the new package model.
- `src/config-inspect.mjs` - package validation, doctor checks, and config inspection details.
- `src/frameworks.mjs` - installer spec generation from normalized package source descriptors.
- `src/render-plan.mjs` - package lock metadata and conflict diagnostic improvements.
- `src/sync.mjs` - use normalized package data for install plans and lock preview.
- `src/cli.mjs` - package diagnostic/preview output if needed.
- `schemas/aof.schema.json` - package source descriptor, namespace, and dependency schema.
- `test/frameworks.test.mjs`, `test/render-plan.test.mjs`, `test/config-inspect.test.mjs`, `test/schema.test.mjs`, `test/integration/cli.feature`, `test/integration/cli.mjs` - focused coverage.

