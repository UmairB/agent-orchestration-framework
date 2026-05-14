# Phase 26 Research: Workflow-Backed Setup UI

**Date:** 2026-05-14
**Status:** Complete

## Existing UI/API Surface

- `src/config-editor.mjs` owns setup UI payloads and save semantics.
- `saveEditableResource()` writes file-backed resource bodies and runtime override files.
- `saveEditableSections()` already persists top-level `workflows[]`.
- `loadEditableConfig()` already includes `workflows` and referenced global resources.
- `ui/src/main.tsx` renders a real React setup app with resource editor, runtime checkboxes, overrides, associated files, JSON section editor, and review panel.
- Capability payload already marks `command.codex` as `unsupported-fail`.

## Implementation Shape

- Extend editable resource payloads with workflow and argument metadata.
- Save workflow-backed resources without forcing a body path when the wrapper body is intentionally blank.
- Keep associated files on skill/command resources, but they remain tied to file-backed wrappers.
- Add resource editor mode controls and workflow selection.
- Add argument controls only when workflow-backed mode is active.
- Add reference insertion buttons beside body editors.
- Disable unsupported runtime toggles at the checkbox level while preserving validation diagnostics.

## Verification

- Unit tests for config-editor save/load and validation.
- Setup UI HTTP tests for workflow-backed resource save payloads.
- Setup UI BDD scenarios for API behavior.
- `npm run ui:build` because frontend files change.
