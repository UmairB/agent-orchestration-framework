# Phase 13: Code-Bearing Asset Files - Context

**Gathered:** 2026-05-08
**Status:** Ready for research and planning

<domain>
## Phase Boundary

Phase 13 supports associated helper/code files owned by global asset directories and renders those files with directory-shaped runtime assets, starting with skills. This lets a global skill include files such as Python scripts, templates, examples, or supporting Markdown alongside `SKILL.md`.

This phase is limited to associated-file preservation, validation, render planning, conflict prevention, and lock traceability. It does not add setup UI controls, project-local overrides for global assets, hosted distribution, sync across machines, vendoring, semantic versions, or associated files for runtime shapes that are currently single files.

</domain>

<decisions>
## Implementation Decisions

### Associated File Declaration
- **D-01:** Associated files are explicit in the resource manifest through a `files` array.
- **D-02:** Each `files` entry is a relative path from the asset directory, where the asset directory is the directory containing the resource body file.
- **D-03:** Do not infer associated files by scanning the asset directory in Phase 13.
- **D-04:** The primary body file and runtime override files are not associated files; they keep their existing handling.

### Supported Asset Shapes
- **D-05:** Phase 13 renders associated files for `skill` resources because Claude and Codex skills are directory-shaped runtime assets.
- **D-06:** Associated files on agents, rules, and commands are deferred unless the implementation can prove a runtime directory shape without ambiguity.
- **D-07:** Global skills are the priority, but the implementation may support local file-backed skills through the same code path if that is simpler and safe.

### Validation And Safety
- **D-08:** Associated file paths must be relative, must stay inside the asset directory, and must not target the primary body file.
- **D-09:** Associated file entries must resolve to regular files; missing files, directories, and path escapes are validation errors.
- **D-10:** Symlinks should be rejected or resolved safely so associated files cannot escape the asset directory.
- **D-11:** Render planning must detect associated-file output conflicts before writes and must not overwrite unrelated generated output.

### Rendering And Lock Metadata
- **D-12:** Associated files render into the runtime skill directory preserving their relative path.
- **D-13:** Associated file outputs participate in the same create/update/delete/drift protection and lock manifest as generated markdown outputs.
- **D-14:** Lock metadata should identify associated files as outputs from the owning resource and preserve global source scope when the owner is global.
- **D-15:** Dry-run output should show associated file creates/updates/deletes through existing apply/sync action formatting.

### the agent's Discretion
- Choose the exact internal metadata field names for associated file outputs.
- Choose whether to represent associated file content as text output objects or add a small file-output abstraction, provided hashing, lock, and writes remain deterministic.
- Choose whether validation lives in `config-inspect.mjs`, a helper module, or both, as long as diagnostics are structured.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/PROJECT.md` - current v1.2 milestone state and active code-bearing asset requirement.
- `.planning/REQUIREMENTS.md` - Phase 13 requirements `CODE-01` through `CODE-03`.
- `.planning/ROADMAP.md` - Phase 13 goal and success criteria.
- `.planning/STATE.md` - current project state and accumulated workflow notes.

### Prior Phase Context
- `.planning/phases/11-global-library-workspace/11-CONTEXT.md` - global workspace shape and manifest decisions.
- `.planning/phases/12-project-reference-rendering/12-CONTEXT.md` - `globalRefs`, source ownership, and lock traceability decisions.
- `.planning/phases/12-project-reference-rendering/12-VERIFICATION.md` - completed global reference rendering and remaining Phase 13 gap.
- `.planning/phases/10-bdd-parity-and-hardening/10-CONTEXT.md` - BDD coverage expectations.

### Research
- `.planning/research/SUMMARY.md` - global asset library feature table stakes and associated-file watch-outs.
- `.planning/research/ARCHITECTURE.md` - integration points for config loading, validation, adapters, render plan, and setup UI.
- `.planning/research/PITFALLS.md` - untracked code files, source-of-truth confusion, and lock ambiguity risks.

### Current Implementation
- `src/dsl.mjs` - resolves local and referenced global resources, body files, runtime overrides, and `_aofSource`.
- `src/config-inspect.mjs` - validates file-backed resources and referenced globals.
- `src/adapters.mjs` - renders runtime resource outputs and resource metadata.
- `src/render-plan.mjs` - groups desired outputs, detects conflicts, writes files, and creates lock manifests.
- `src/scaffold.mjs` - asset directory conventions under `assets/<kind-plural>/<id>/BODY.md`.
- `src/fs.mjs` - text write helper used by render execution.
- `test/render-plan.test.mjs` - output planning, conflict, drift, and lock tests.
- `test/config-inspect.test.mjs` - validation diagnostics tests.
- `test/integration/features/lifecycle.feature` - BDD lifecycle scenarios for global assets and global references.

</canonical_refs>

<code_context>
## Existing Code Insights

### Asset Source Shape
- Project and global assets use the same layout: `assets/<kind-plural>/<id>/<BODY.md>`.
- Resource manifests currently record the primary body file through `resource.path`.
- Phase 12 attaches source metadata to resolved global resources via `_aofSource`, including global scope and config path.

### Rendering Shape
- `adapters.mjs` currently emits one text output per resource per runtime.
- Skills already render as directories: `.codex/skills/<id>/SKILL.md` and `.claude/skills/<id>/SKILL.md`.
- Commands, agents, and most rules currently render as single markdown files.
- Codex rules may merge into one `AGENTS.md`, so associated files on rules would be ambiguous in this phase.

### Render Plan Shape
- `render-plan.mjs` hashes text content, detects output path conflicts, plans create/update/delete/skip/drift actions, writes files, and records lock entries.
- Associated file outputs should reuse this path so drift protection and lock ownership stay consistent.
- Existing conflict grouping is path-based, so associated files can participate naturally if they are rendered as desired outputs with paths, hashes, content, and resource metadata.

### Validation Shape
- `config-inspect.mjs` already resolves file-backed resource paths relative to the owning config directory.
- Global reference validation validates only referenced global resource entries and their file-backed body/override files.
- Associated file validation should follow the same project-scoped behavior: referenced global assets are checked, unrelated global drafts are not.

</code_context>

<specifics>
## Specific Ideas

Example global skill resource:

```json
{
  "kind": "skill",
  "id": "research-helper",
  "path": "assets/skills/research-helper/SKILL.md",
  "files": [
    "scripts/search.py",
    "templates/query.md"
  ],
  "runtimes": ["codex"]
}
```

The associated files should render to:

```text
.codex/skills/research-helper/SKILL.md
.codex/skills/research-helper/scripts/search.py
.codex/skills/research-helper/templates/query.md
```

For global references, these outputs should carry the same `scope: "global"` lock source identity as the generated `SKILL.md`.

</specifics>

<deferred>
## Deferred Ideas

- Implicit directory scanning or repair/import of unlisted helper files.
- Binary file handling beyond text/code/helper files.
- Associated files for agents, rules, and commands unless a runtime directory target is added.
- Setup UI controls for uploading, editing, or listing associated files.
- Project-local overrides of global associated files.
- Vendoring global associated files into project `.aof`.

</deferred>

---

*Phase: 13-Code-Bearing Asset Files*
*Context gathered: 2026-05-08*
