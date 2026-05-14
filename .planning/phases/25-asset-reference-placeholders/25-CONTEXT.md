# Phase 25: Asset Reference Placeholders - Context

**Gathered:** 2026-05-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 25 adds validated runtime-aware path placeholders for asset-to-asset references. Authors should be able to write strict placeholders such as `{{skills.ci}}` and `{{workflows.audit}}` in supported AOF-authored content, and AOF should expand those placeholders to the correct generated runtime path for the runtime being rendered.

This phase is about path references in generated content, not invocation semantics and not new asset kinds. It must preserve the Phase 23 command/skill boundary and the Phase 24 workflow model: Codex commands remain invalid, workflows remain top-level `workflows[]`, and wrapper-to-workflow binding remains `workflow: "<id>"`.

</domain>

<decisions>
## Implementation Decisions

### Placeholder Syntax
- **D-01:** Support strict plural placeholder namespaces only: `{{skills.<id>}}` and `{{workflows.<id>}}`.
- **D-02:** Do not support aliases such as `{{skill.<id>}}`, `{{workflow.<id>}}`, `{{claude.skills.<id>}}`, or path-like forms in Phase 25.
- **D-03:** Placeholder ids should use the same normalized asset/workflow ids AOF already accepts. Validation should reject malformed or unknown placeholder references with stable diagnostics.
- **D-04:** Keep existing `{{files.<name>}}` behavior separate and asset-local. Phase 25 should not change associated-file placeholder semantics.

### Runtime Path Semantics
- **D-05:** Placeholders expand to generated runtime file paths, not assistant invocation strings.
- **D-06:** `{{skills.<id>}}` should resolve to the runtime skill body path for the current render target, for example `.codex/skills/ci/SKILL.md` or `.claude/skills/ci/SKILL.md`.
- **D-07:** `{{workflows.<id>}}` should resolve to the runtime workflow path, for example `.codex/aof/workflows/audit.md` or `.claude/aof/workflows/audit.md`.
- **D-08:** Do not add `{{commands.<id>}}` in Phase 25. Commands are Claude-only and adding a command namespace risks reopening the Codex command ambiguity resolved in Phase 23.

### Validation Rules
- **D-09:** Validation should inspect every runtime where the referencing text can render and fail if the referenced asset/workflow is unavailable for that runtime.
- **D-10:** Runtime-specific overrides should be validated against the override runtime, not against every resource runtime.
- **D-11:** Project-local and referenced global skills/workflows should participate in the same reference index.
- **D-12:** Validation should distinguish malformed placeholder syntax, missing reference, and runtime mismatch cases.
- **D-13:** Apply/render should keep a defensive guard that throws if an unresolved reference reaches rendering, but normal user-facing failures should come from validation before writes.

### Allowed Surfaces
- **D-14:** Support placeholders in resource primary bodies and runtime overrides for skills, commands, agents, and rules.
- **D-15:** Support placeholders in workflow bodies, because workflows are shared process text and may need to point at supporting skills or other workflow files.
- **D-16:** Support placeholders in explicitly authored wrapper bodies. Generated default workflow-backed wrappers already emit resolved workflow paths directly and do not need placeholder syntax.
- **D-17:** Defer placeholders in `projectDocs[]` unless implementation proves it is trivial and covered by tests. Project docs are a separate expanded primitive path and should not expand silently without BDD coverage.

### Testing And Docs
- **D-18:** Add focused unit tests for parser/extraction, validation, and rendering.
- **D-19:** Add Node BDD and PowerShell parity for valid skill/workflow references and invalid missing/runtime-mismatch references.
- **D-20:** README should document the exact supported syntax and explicitly state that placeholders produce paths, not invocations.

### the agent's Discretion
- Choose whether placeholder extraction lives in `src/adapters.mjs`, `src/config-inspect.mjs`, or a small shared helper module, as long as validation and rendering use the same rules.
- Choose exact diagnostic code names if they are stable and clearly separate malformed, missing, and runtime mismatch cases.
- Choose exact BDD fixture names and helper structure consistent with current integration patterns.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.5 Planning
- `.planning/PROJECT.md` - current v1.5 milestone intent and product decisions.
- `.planning/REQUIREMENTS.md` - REF-01 through REF-04 define the Phase 25 requirement boundary.
- `.planning/ROADMAP.md` - Phase 25 goal and success criteria.
- `.planning/STATE.md` - current milestone state and Phase 24 completion context.

### Prior Runtime And Workflow Decisions
- `.planning/phases/23-runtime-capability-contract/23-CONTEXT.md` - locked decisions for Codex command rejection, simple assets, and argument marker validation.
- `.planning/phases/23-runtime-capability-contract/23-VERIFICATION.md` - evidence that Phase 23 behavior passed and should not regress.
- `.planning/phases/24-workflow-asset-model/24-CONTEXT.md` - locked decisions for workflow declarations, workflow generated paths, wrapper binding, and argument metadata.
- `.planning/phases/24-workflow-asset-model/24-VERIFICATION.md` - evidence that Phase 24 workflow behavior passed and should not regress.

### Codebase Maps
- `.planning/codebase/STACK.md` - Node/ESM CLI and React setup UI stack.
- `.planning/codebase/ARCHITECTURE.md` - module boundaries for config, validation, rendering, setup UI, and lock-aware apply.
- `.planning/codebase/CONVENTIONS.md` - validation, filesystem, rendering, BDD, and documentation conventions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/adapters.mjs` already expands `{{files.<name>}}` placeholders during runtime rendering and owns runtime output path logic for skills and workflows.
- `src/config-inspect.mjs` already extracts `{{files.*}}` placeholders, scans inline/file-backed/override text, and validates generated runtime path references.
- `src/dsl.mjs` already resolves local and referenced global resources/workflows into one render config.
- `src/model.mjs` centralizes supported resource kinds, global reference kinds, and runtime metadata.
- `test/integration/features/lifecycle.feature`, `test/integration/steps/shared-cli.steps.mjs`, and `test/integration/cli.ps1` are the right BDD surfaces for CLI-visible placeholder behavior.

### Established Patterns
- Validation should catch user-facing config errors before `aof assets apply` writes generated files.
- Runtime-specific overrides are shallow-merged and should be validated against their own runtime-specific effective body.
- Generated files and stale cleanup flow through `render-plan` and lock state; placeholder expansion should affect content hashes naturally.
- BDD is required for new user-visible behavior, with PowerShell parity when CLI scenarios change.

### Integration Points
- Add a reference index spanning local plus referenced global skills and workflows.
- Expand placeholders after runtime overrides are merged and while the renderer knows the current runtime.
- Validate placeholders in file-backed source bodies and override bodies, including global referenced assets.
- Keep generated workflow-backed wrapper defaults as direct resolved paths; explicit wrapper bodies may use placeholders.

</code_context>

<specifics>
## Specific Ideas

### Supported examples

```markdown
Use the CI skill at {{skills.ci}}.
Follow the audit workflow at {{workflows.audit}}.
```

Expected runtime output examples:

```text
.codex/skills/ci/SKILL.md
.claude/skills/ci/SKILL.md
.codex/aof/workflows/audit.md
.claude/aof/workflows/audit.md
```

### Invalid examples

```markdown
{{skill.ci}}
{{commands.ci}}
{{skills.missing}}
{{workflows.audit}}  // invalid when the referencing runtime is not included by audit workflow runtimes
```

</specifics>

<deferred>
## Deferred Ideas

- `{{commands.<id>}}` remains out of scope unless a later phase explicitly designs Claude-only command references without Codex ambiguity.
- Project-doc placeholder support is deferred unless Phase 25 implementation finds a low-risk path with explicit tests.
- Setup UI insertion controls for `{{skills.*}}` and `{{workflows.*}}` remain Phase 26.
- Live UAT with GSD-style command/skill/workflow examples remains Phase 27.

</deferred>

---

*Phase: 25-Asset Reference Placeholders*
*Context gathered: 2026-05-14*

