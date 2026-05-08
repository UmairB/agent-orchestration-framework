# Phase 13: Code-Bearing Asset Files - Research

## RESEARCH COMPLETE

## Objective

Research what is needed to plan Phase 13 well: preserving associated helper/code files owned by global asset directories, validating them safely, rendering them with directory-shaped runtime assets, and tracking them in lock state.

## Phase Scope

Phase 13 covers requirements:

- **CODE-01:** Global assets can own associated files under their asset directory.
- **CODE-02:** Rendering preserves associated files for runtime asset shapes that require directories, such as skills with helper scripts.
- **CODE-03:** Validation rejects associated files that escape the asset directory or would overwrite unrelated generated output.

Setup UI support, milestone-wide verification hardening, distribution, vendoring, versioning, and non-skill associated-file semantics remain out of scope.

## Current Implementation Findings

### Config And Resolver

- `src/dsl.mjs` resolves resources from project and referenced global configs.
- Resource identity and source scope are preserved through `_aofSource`.
- The resolver currently reads the primary body file and runtime overrides, but it does not inspect or preserve other files in the asset directory.
- A `files` array can be normalized and carried on resolved resources with enough source path metadata for rendering.

### Validation

- `src/config-inspect.mjs` validates primary body files and override files.
- Referenced global validation only checks referenced global resources, which is the right boundary for associated files.
- Associated file validation should resolve paths relative to the resource asset directory, reject absolute paths, reject `..` escapes, reject the primary body file, reject directories, and handle symlinks conservatively.

### Rendering

- `src/adapters.mjs` currently renders one output per resource per selected runtime.
- Skill output paths are directory-shaped for both concrete runtimes:
  - `.claude/skills/<id>/SKILL.md`
  - `.codex/skills/<id>/SKILL.md`
- Associated files can be rendered by adding additional desired outputs under the skill output directory.
- Single-file resources should not silently drop associated files; Phase 13 should either reject or defer them clearly.

### Render Plan And Lock

- `src/render-plan.mjs` already handles output conflict grouping, create/update/delete/drift planning, writes, and lock entries for desired outputs.
- Associated helper files should become desired outputs before `groupDesiredOutputs()` so conflicts are detected with all generated files.
- Lock entries already persist `output.resource`; associated outputs need metadata tying them to the owning resource and global source scope.
- Existing `writeText()` and `hashContent()` are text-oriented, which fits Python scripts, templates, Markdown examples, and other helper text files.

### Tests And BDD

- Unit coverage should extend `test/config-inspect.test.mjs` for unsafe associated-file paths.
- Render planning coverage should extend `test/render-plan.test.mjs` for helper outputs, lock entries, and conflict detection.
- BDD lifecycle coverage should add a global skill with a helper script referenced by a project, then assert the helper renders under the Codex/Claude skill directory and appears in the lock.

## Recommended Plan Shape

1. Add `files` model/schema/validation and associated-file source resolution.
2. Render skill associated files into runtime skill directories and include them in render-plan conflict/lock behavior.
3. Add BDD/docs/completion artifacts and run full verification.

## Risks

- Implicit directory scans could copy unrelated drafts or secrets.
- Associated files that escape the asset directory could overwrite arbitrary project files.
- Copying helper files outside the render-plan path would bypass dry-run, drift, and lock behavior.
- Supporting non-skill resources too early could silently misrepresent runtime behavior because current agents/rules/commands are single-file outputs.

