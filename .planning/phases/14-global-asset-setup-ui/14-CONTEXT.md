# Phase 14: Global Asset Setup UI - Context

**Gathered:** 2026-05-09
**Status:** Ready for research and planning

<domain>
## Phase Boundary

Phase 14 extends the setup UI so users can create, edit, distinguish, and reference reusable global assets from the browser-based configuration editor.

This phase remains a configuration-editing phase. The UI must not run `apply`, `sync`, framework installers, or other terminal-side execution. CLI commands remain responsible for applying generated runtime files.

The phase covers project/global scope switching, global asset editing, project `globalRefs` management, read-only display of referenced globals in project context, source-scope labeling, and basic global skill associated-file editing.

It does not add hosted distribution, cross-machine sync, version pinning, vendoring, UI execution, binary associated files, implicit helper-file scanning, or associated-file support for non-skill resources.

</domain>

<decisions>
## Implementation Decisions

### Scope Model
- **D-01:** The setup UI uses an explicit top-level Project / Global toggle.
- **D-02:** Project scope edits the current repository `.aof` workspace.
- **D-03:** Global scope edits the user global `~/.aof` workspace.
- **D-04:** The UI and API must label source scope clearly enough that users do not confuse project-local assets, global assets, and project references to global assets.

### Global Asset Editing
- **D-05:** Phase 14 supports creating and editing global `skill`, `agent`, and `rule` assets.
- **D-06:** Global `command` editing is deferred unless it falls out naturally from existing generic resource editing without expanding user-facing scope.
- **D-07:** Global asset editing should reuse the existing file-backed asset editor conventions where possible.

### Project References
- **D-08:** Global assets have a “Use in this project” action from Global scope.
- **D-09:** The action writes a top-level project `globalRefs` entry shaped as `{ kind, id }`.
- **D-10:** Adding a reference must not copy global source files into project `.aof`.
- **D-11:** Project scope displays referenced global assets separately from project-local assets.
- **D-12:** Referenced globals are read-only in Project scope, with support for removing the project reference.

### Associated Files
- **D-13:** Phase 14 adds basic associated-file editing for global skills only.
- **D-14:** Associated-file UI is an explicit path list plus text body editor.
- **D-15:** Associated-file UI must not scan directories, upload binary files, or support symlinks.
- **D-16:** Associated file paths follow Phase 13 rules: relative to the global asset directory, contained inside that directory, and not the primary body file.

### API And Validation
- **D-17:** Setup UI API endpoints should accept or encode explicit scope: `project` or `global`.
- **D-18:** Project-only API support is needed for adding/removing `globalRefs`.
- **D-19:** Save actions should return the same structured diagnostics shape used by current setup UI validation.
- **D-20:** Global edits validate the global config and global asset files; project reference edits validate referenced globals, missing refs, and local/global conflicts.

### the agent's Discretion
- Choose exact route names and payload shapes, provided scope is explicit and backward compatibility for existing project endpoints is preserved.
- Choose exact visual layout for the Project / Global switch and referenced-global section, provided source scope is visible at selection and save points.
- Choose whether associated-file editing is one inline panel or a subordinate list/editor, provided it is usable for small helper scripts and templates.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/PROJECT.md` - current v1.2 milestone state and active setup UI requirement.
- `.planning/REQUIREMENTS.md` - Phase 14 requirements `GUI-01` through `GUI-04`.
- `.planning/ROADMAP.md` - Phase 14 goal and success criteria.
- `.planning/STATE.md` - current project state and accumulated workflow notes.

### Prior Phase Context
- `.planning/phases/11-global-library-workspace/11-CONTEXT.md` - global workspace path, config, and CLI asset operations.
- `.planning/phases/12-project-reference-rendering/12-CONTEXT.md` - project `globalRefs`, validation semantics, and source scope.
- `.planning/phases/13-code-bearing-asset-files/13-CONTEXT.md` - explicit `files` model and associated-file safety rules.
- `.planning/phases/13-code-bearing-asset-files/13-VERIFICATION.md` - completed associated-file rendering and remaining UI gap.
- `.planning/phases/10-bdd-parity-and-hardening/10-CONTEXT.md` - BDD coverage expectations.

### Research
- `.planning/research/SUMMARY.md` - global asset library table stakes.
- `.planning/research/ARCHITECTURE.md` - setup UI integration point and global data flow.
- `.planning/research/PITFALLS.md` - source-of-truth and UI scope confusion risks.

### Current Implementation
- `src/setup-ui.mjs` - current HTTP API for project config editing and setup UI static serving.
- `src/config-editor.mjs` - current editable project config loader/saver and validation helper.
- `src/workspace.mjs` - project and global workspace path helpers.
- `src/cli.mjs` - current `aof global ...` command behavior and project reference operations.
- `src/dsl.mjs` - project config loading, global reference resolution, associated files, and source metadata.
- `src/config-inspect.mjs` - validation behavior for global configs and referenced globals.
- `ui/src/main.tsx` - current React setup UI.
- `test/setup-ui.test.mjs` - setup UI API unit coverage.
- `test/integration/features/setup-ui.feature` - setup UI API BDD coverage if present.
- `test/integration/features/lifecycle.feature` - existing global asset and global reference BDD coverage.

</canonical_refs>

<code_context>
## Existing Code Insights

### Current Setup UI API
- `GET /api/config` loads editable project config only.
- `PUT /api/config/resources/:kind/:id` saves a project-local resource.
- `PUT /api/config/sections` saves expanded project config sections.
- Current endpoints are project scoped by default and should remain backward compatible.

### Current Config Editor Shape
- `loadEditableConfig(projectDir)` returns resources, packages, expanded sections, diagnostics, adapter warnings, capabilities, and next commands.
- `saveEditableResource(projectDir, input)` writes file-backed assets under project `.aof/assets/...`.
- Resource editing currently supports body and runtime overrides but not associated files.
- Current editor payload does not expose `globalRefs` or referenced global resources.

### Current UI Shape
- React UI has a left nav for resource kinds, expanded DSL sections, and review.
- The asset editor is a form over `EditableResource`.
- The UI already uses runtime capability badges, validation panels, and source config path display.
- Phase 14 should avoid a landing page or explanatory marketing view; the first screen remains the working editor.

### Current Global Library Shape
- Global source workspace is `~/.aof` or `AOF_GLOBAL_HOME` in tests.
- Global config is `~/.aof/aof.config.json`.
- Global asset body files use the same `assets/<plural>/<id>/<BODY.md>` convention.
- Project config references globals through top-level `globalRefs`.

### Current Associated File Shape
- Resource manifests can include `files`.
- Phase 13 renders associated files for `skill` resources only.
- Associated files are text content, explicit manifest entries, and validated for containment.
- The UI should preserve the manifest/body relationship rather than inventing implicit scans.

</code_context>

<specifics>
## Specific Ideas

Example UI API payload for scoped config loading:

```json
{
  "scope": "global",
  "configPath": "C:/Users/Umair/.aof/aof.config.json",
  "resources": [
    {
      "kind": "skill",
      "id": "research-helper",
      "body": "...",
      "files": [
        { "path": "scripts/search.py", "body": "print('search')\n" }
      ]
    }
  ]
}
```

Example project reference action:

```json
{
  "kind": "skill",
  "id": "research-helper"
}
```

Resulting project config fragment:

```json
{
  "globalRefs": [
    { "kind": "skill", "id": "research-helper" }
  ]
}
```

Project view should show:

- Project-local assets: editable.
- Referenced global assets: read-only, source labeled `global`, with a remove-reference action.
- Missing/conflicting refs: visible diagnostics in the same review surface as other validation issues.

</specifics>

<deferred>
## Deferred Ideas

- Browser execution of apply/sync/install.
- Global command editing unless explicitly scoped later.
- Binary associated file upload or management.
- Implicit directory scanning for associated files.
- Symlink support.
- Project-local overrides for global asset bodies or associated files.
- Vendoring a global asset into project `.aof`.
- Hosted registry, publishing, cross-machine sync, or version pinning.

</deferred>

---

*Phase: 14-Global Asset Setup UI*
*Context gathered: 2026-05-09*
