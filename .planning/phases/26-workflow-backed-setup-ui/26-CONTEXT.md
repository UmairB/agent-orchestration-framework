# Phase 26 Context: Workflow-Backed Setup UI

**Date:** 2026-05-14
**Status:** Complete

## Goal

Update setup UI editing so users can intentionally choose Simple or Workflow-backed asset authoring, configure argument metadata only in workflow-backed mode, avoid unsupported Codex command targets, and insert supported skill/workflow references from known assets.

## Locked Defaults

- Simple mode is represented by absence of `resource.workflow`.
- Workflow-backed mode is represented by `resource.workflow`.
- Simple mode blocks argument metadata and argument-looking content.
- Workflow-backed mode supports `argumentHint`, `arguments`, and `argumentOverrides`.
- Workflow asset definitions continue to be edited through the existing expanded section JSON editor for Phase 26; resource wrappers get first-class controls.
- Codex remains disabled/blocked for command resources via the existing capability contract, with clearer UI control behavior.
- Reference insertion offers known project-local and referenced global `skills` plus known `workflows`, inserting strict `{{skills.<id>}}` and `{{workflows.<id>}}` placeholders.

## Scope

- `src/config-editor.mjs`
- `src/setup-ui.mjs` only if API routing needs no new endpoint
- `ui/src/main.tsx`
- setup UI unit and BDD tests

## Out Of Scope

- Visual workflow-builder UI for creating workflow assets beyond the existing sections JSON editor.
- Executing apply/install from the UI.
