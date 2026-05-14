---
phase: 24
type: research
status: complete
researched: 2026-05-12
---

# Phase 24 Research: Workflow Asset Model

## Research Question

What needs to be understood to plan first-class workflow assets well in the current AOF codebase?

## Executive Summary

Phase 24 should add workflows as a top-level config collection that is resolved, validated, rendered, and lock-tracked alongside resources. The clean implementation path is to introduce a workflow model in `src/model.mjs`, resolve workflows in `src/dsl.mjs`, validate local and referenced global workflows in `src/config-inspect.mjs`, then render workflow files and workflow-backed wrapper bodies from `src/adapters.mjs`.

The risky parts are not the markdown rendering itself. The risky parts are preserving existing simple-asset behavior from Phase 23, extending global references without regressing resource references, and making wrapper default-body generation deterministic enough for BDD coverage.

## Existing Code Seams

### Model And Schema

- `src/model.mjs` owns runtime metadata, resource kinds, default body filenames, and runtime capability status.
- `schemas/aof.schema.json` currently has top-level `resources`, `globalRefs`, `packages`, `mcpServers`, `hooks`, `projectDocs`, and `settings`.
- There is no top-level `workflows` collection yet.
- Resource IDs currently use `normalizeId()` from `src/fs.mjs`; workflow IDs should reuse the same normalization.

Recommended plan:
- Add `WORKFLOW_BODY_FILE = "WORKFLOW.md"` or equivalent exported model metadata.
- Add schema `$defs.workflow` and top-level `workflows`.
- Add `workflow` and argument metadata fields to `$defs.resource`, keeping `additionalProperties: true` compatible.
- Extend `globalRef.kind` to include `workflow`.

### Config Loading And Global References

- `src/dsl.mjs` has three important layers:
  - `resolveConfig()` resolves project config into normalized runtime-ready structures.
  - `loadProjectConfig()` merges referenced global resources into the resolved project config.
  - `normalizeGlobalRefs()` restricts refs to `skill`, `agent`, and `rule`.
- Referenced globals currently pull from `globalConfig.resources` only.

Recommended plan:
- Resolve local workflows into `config.workflows`.
- Resolve referenced global workflows into the same `config.workflows` array with `_aofSource.scope = "global"`.
- Keep global resources and global workflows separate internally so a local resource cannot collide with a global workflow accidentally unless it is a workflow ID collision.
- Extend `normalizeGlobalRefs()` to allow `kind: "workflow"` and update missing/conflict checks accordingly.

### Validation

- `src/config-inspect.mjs` owns structural validation and referenced-global validation.
- Phase 23 added `validateResourceCapabilities()` and `validateSimpleAssetArguments()`.
- Simple asset arguments are currently rejected for any valid resource kind.

Recommended plan:
- Add `validateWorkflow()` for top-level workflow entries:
  - object shape
  - required `id`
  - runtime array
  - body or `path`
  - file path stays inside workspace and exists
  - `argumentHint` string when present
  - `arguments` array with unique non-empty `name`, optional `description`, optional boolean `required`
- Update simple argument validation to skip resources that have `workflow` set.
- Add wrapper validation:
  - `resource.workflow` references an existing local or referenced global workflow.
  - wrapper effective runtimes are all included in workflow runtimes.
  - wrapper `argumentOverrides` keys exist in the workflow `arguments`.
  - wrapper argument override shape is metadata-only.
- Diagnostic codes should be stable:
  - `missing-workflow`
  - `workflow-runtime-mismatch`
  - `invalid-workflow-argument`
  - `duplicate-workflow`
  - `missing-workflow-file`

### Rendering And Lock State

- `src/adapters.mjs` renders resources to runtime roots and returns desired outputs.
- `src/render-plan.mjs` groups desired outputs and handles drift-aware create/update/delete.
- Output metadata already carries resource kind/id/scope/package metadata.

Recommended plan:
- Render workflows before wrapper resources for each requested runtime.
- Workflow output paths:
  - `.claude/aof/workflows/<id>.md`
  - `.codex/aof/workflows/<id>.md`
- Workflow output metadata should use `resource: { kind: "workflow", id, scope/global metadata }` so lock entries are traceable.
- Wrapper body generation should occur in `renderResource()`/content helper:
  - explicit resource body wins.
  - absent body plus `workflow` generates runtime-specific default text with the resolved runtime workflow path.
  - generated defaults include `argumentHint`/named argument guidance when present.
- Avoid implementing `{{workflows.<id>}}` content placeholder expansion in Phase 24; that belongs to Phase 25.

### Setup UI And Editor API

- `src/config-editor.mjs` currently loads/saves resources, global refs, expanded sections, and exposes capabilities.
- Global UI currently supports `skill`, `agent`, and `rule`.
- Full Simple vs Workflow-backed UX is Phase 26, but Phase 24 needs API-level validity.

Recommended plan:
- Include `workflows` in `loadEditableConfig()` payloads.
- Preserve existing resource save behavior.
- It is acceptable for Phase 24 to support workflow editing through expanded config sections or a minimal API shape, rather than a polished UI workflow mode.
- `validateEditableResource()` must allow argument metadata when `workflow` is set and must reject invalid workflow-backed wrapper shape through project/global config validation where possible.

### CLI And Scaffolding

- `src/scaffold.mjs` only scaffolds resources.
- CLI integration features already include file-backed asset fixtures and global reference fixtures.

Recommended plan:
- Phase 24 does not need a dedicated `aof assets add workflow` command unless it is cheap and fits existing scaffolding.
- BDD can create workflows through config fixtures directly.
- If scaffolding is added, it should write `.aof/assets/workflows/<id>/WORKFLOW.md` and update top-level `workflows`, not `resources`.

## Testing Strategy

### Unit Tests

- `test/model.test.mjs`: workflow body file/model export if added.
- `test/config-inspect.test.mjs`: workflow structural validation, wrapper binding validation, global workflow refs, argument override validation.
- `test/adapters.test.mjs` and `test/render-plan.test.mjs`: workflow outputs, wrapper default bodies, source/lock metadata, stale workflow cleanup.
- `test/config-editor.test.mjs` and `test/setup-ui.test.mjs`: payload/validation compatibility.

### BDD Tests

Add lifecycle scenarios for:
- Render project workflow to `.claude/aof/workflows/<id>.md` and `.codex/aof/workflows/<id>.md`.
- Render Claude command and Codex skill wrappers sharing one workflow.
- Reject missing workflow references.
- Reject workflow runtime mismatch.
- Reject wrapper argument override for undeclared workflow argument.
- Render referenced global workflow and wrapper.

PowerShell parity should be updated in `test/integration/cli.ps1` for every new shared feature step.

## Planning Recommendation

Use three implementation waves:

1. **Workflow model and validation foundation** — schema/model/DSL/global ref validation.
2. **Workflow rendering and wrapper defaults** — generated workflow outputs, lock metadata, default wrapper bodies, stale cleanup.
3. **API/docs/BDD parity hardening** — setup/editor payload compatibility, README, Node BDD, PowerShell BDD, final coverage.

This split keeps the first wave focused on preventing invalid configs before rendering, the second wave focused on output behavior, and the third wave focused on user-visible confidence.

## RESEARCH COMPLETE
