# Phase 25 Research: Asset Reference Placeholders

**Date:** 2026-05-14
**Status:** Complete

## Existing Seams

- Runtime paths are centralized in `src/adapters.mjs` through `resourcePath()`, `workflowOutputPath()`, and `workflowRuntimePath()`.
- Resource primary content already passes through `contentFor()`, where `{{files.*}}` placeholders are expanded.
- Workflow files are rendered before resources by `renderConfigOutputs()`, but `renderWorkflow()` currently writes the workflow body unchanged.
- Config validation already scans resource body/path/override text for associated-file placeholders through `resourceReferenceTexts()`.
- `validateReferencedGlobals()` loads referenced global resources/workflows without scanning unrelated global drafts, which matches the Phase 25 global-reference requirement.

## Decisions Applied

- Implement one shared asset reference helper for parsing, indexing, validation support, and path expansion.
- Support only `{{skills.<id>}}` and `{{workflows.<id>}}`.
- Expand placeholders to generated runtime file paths:
  - `{{skills.ci}}` -> `.codex/skills/ci/SKILL.md` or `.claude/skills/ci/SKILL.md`
  - `{{workflows.audit}}` -> `.codex/aof/workflows/audit.md` or `.claude/aof/workflows/audit.md`
- Validate references in local and referenced global resources/workflows before apply writes.
- Keep project-doc placeholder support out of scope for Phase 25.

## Risks

- Validation and rendering must share the same ID normalization and runtime path rules, otherwise a config could validate but render a different path.
- Runtime overrides need runtime-scoped validation so a Codex-only override can reference Codex-only assets without forcing Claude compatibility.
- Workflow body validation needs source-base tracking for referenced global workflow files.
