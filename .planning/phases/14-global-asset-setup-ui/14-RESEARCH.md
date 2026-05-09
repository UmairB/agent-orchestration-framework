# Phase 14 Research: Global Asset Setup UI

**Date:** 2026-05-09
**Status:** Complete

## Current UI/API Surface

- `src/setup-ui.mjs` serves a project-scoped setup API:
  - `GET /api/config`
  - `PUT /api/config/resources/:kind/:id`
  - `PUT /api/config/sections`
  - `GET /api/capabilities`
- `src/config-editor.mjs` owns editable project config load/save behavior and writes file-backed project assets under `.aof/assets/...`.
- `ui/src/main.tsx` assumes one editable project payload and does not model source scope, `globalRefs`, referenced globals, or associated files.
- Existing setup UI tests cover project resource saves, expanded section saves, API hardening, and adapter warning payloads.

## Existing Global Building Blocks

- `src/workspace.mjs` exposes `globalWorkspacePaths()` and project `workspacePaths()`.
- Global source config is `~/.aof/aof.config.json`, with `AOF_GLOBAL_HOME` available for tests.
- Global assets use the same `assets/<plural>/<id>/<BODY.md>` convention as project assets.
- Project configs reference global assets through top-level `globalRefs`.
- `loadProjectConfig()` resolves referenced global resources for rendering, validation, and lock metadata.

## Implementation Implications

- The safest implementation is to reuse the existing editable-resource shape and add a scope parameter to the editor API internals.
- Existing project endpoints should remain backward compatible and continue to imply `project` scope.
- New scoped endpoints can expose global config without changing old clients.
- Project reference operations should mutate only the project config's `globalRefs`, never global files and never project asset copies.
- Referenced global resources should be exposed to the UI as read-only records with `source: "global"` and a reference state.
- Associated files require extending the editable resource payload with text `files` entries and saving them only for global skills in this phase.

## Suggested Build Order

1. Add scoped config-editor helpers and setup UI routes.
2. Add global resource save/load and skill associated-file save/load.
3. Add project `globalRefs` add/remove API and referenced-global read-only payloads.
4. Update the React UI with a Project / Global toggle, source labels, reference actions, and skill associated-file editor.
5. Add setup UI unit/API tests, BDD scenarios, UI build verification, and docs.

## Risks

- Accidental global edits if the UI does not make scope visible at the nav, list, editor, and save button.
- Hidden copy semantics if “Use in this project” writes asset files instead of only `globalRefs`.
- Save regressions if existing project-scoped endpoints are changed instead of preserved.
- Associated-file path escapes if UI validation diverges from Phase 13 server-side validation.

