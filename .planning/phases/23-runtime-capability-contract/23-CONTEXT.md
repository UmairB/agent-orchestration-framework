# Phase 23: Runtime Capability Contract - Context

**Gathered:** 2026-05-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 23 aligns AOF's resource-kind capability model with the real Claude Code and Codex runtime semantics.

The phase should make command support explicit and enforceable: Claude Code supports command assets; Codex does not. Codex command targeting must be rejected instead of being rendered, skipped silently, or mapped into Codex skills.

This phase also preserves simple asset authoring. Simple skills, commands, agents, and rules should continue to render directly from their asset body without introducing workflow files. Workflow assets, workflow-backed wrappers, `{{skills.*}}`, and `{{workflows.*}}` placeholders belong to later v1.5 phases unless a narrow validation hook is needed to keep Phase 23 coherent.

</domain>

<decisions>
## Implementation Decisions

### Runtime Capability Contract
- **D-01:** Claude command assets are supported and render only to `.claude/commands/<id>.md`.
- **D-02:** Codex command assets are unsupported and must be a validation error, not a warning-and-skip behavior.
- **D-03:** AOF must not map `kind: "command"` into Codex skills. Users who want Codex behavior must author `kind: "skill"` explicitly.
- **D-04:** Runtime capability metadata should represent `command.codex` as unsupported-fail so CLI, validation, setup UI payloads, and tests share one support matrix.
- **D-05:** Existing mapped/lossy capability behavior for other resources, such as Codex rules, should remain unchanged.

### Diagnostics And Apply Behavior
- **D-06:** Config validation should fail when a command resource targets Codex, whether Codex is listed directly in `runtimes` or selected through the default all-runtimes behavior.
- **D-07:** Apply must fail before writing runtime output when validation finds unsupported Codex command targeting.
- **D-08:** Apply must never create `.codex/commands/*`.
- **D-09:** Once the user fixes the source config so the command no longer targets Codex, normal apply/lock cleanup should remove previously AOF-owned stale `.codex/commands/*` files if they are present in the lock.
- **D-10:** Do not mutate generated output from an invalid current config just to clean stale files; require a valid config before normal apply proceeds.

### Simple Asset Authoring
- **D-11:** Simple assets remain the default and do not require workflow files.
- **D-12:** Simple assets must reject explicit argument configuration. If new config fields are needed later for workflow arguments, they must not be accepted on simple assets in this phase.
- **D-13:** Simple asset validation should detect obvious argument-dependent content and return guidance. Detection should cover at least `$ARGUMENTS`, `{{GSD_ARGS}}`, `argument-hint`, and `{{args...}}` style placeholders.
- **D-14:** Argument detection should inspect the effective source content, including file-backed bodies and runtime overrides where practical.
- **D-15:** The diagnostic should explain that argument handling belongs to workflow-backed assets, not simple assets.

### Capability Surfacing
- **D-16:** Phase 23 should update the core capability model, config validation, apply behavior, CLI diagnostics, focused unit tests, and BDD coverage.
- **D-17:** Existing setup UI capability payloads and labels should reflect the updated support matrix if they are already driven by `CAPABILITIES`.
- **D-18:** Larger setup UI authoring changes, such as Simple vs Workflow-backed mode controls and argument fields, stay in Phase 26.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### v1.5 Planning
- `.planning/PROJECT.md` - current v1.5 milestone intent and product decisions.
- `.planning/REQUIREMENTS.md` - RTS-01 through RTS-04 and SIMPLE-01 through SIMPLE-03.
- `.planning/ROADMAP.md` - Phase 23 goal and success criteria.
- `.planning/STATE.md` - current milestone state and recent UAT context.

### Prior Implementation Context
- `.planning/phases/18-command-contract-audit/18-CLI-CONTRACT.md` - accepted namespaced CLI contract.
- `.planning/phases/19-assets-namespace-rewrite/19-VERIFICATION.md` - current `aof assets ...` behavior baseline.
- `.planning/phases/22-live-repository-verification/22-CONTEXT.md` - recent UAT context and generated output expectations.

### Codebase Maps
- `.planning/codebase/STACK.md`
- `.planning/codebase/ARCHITECTURE.md`
- `.planning/codebase/CONVENTIONS.md`

</canonical_refs>

<code_context>
## Existing Code Insights

### Capability Model
- `src/model.mjs` owns `RUNTIMES`, `RESOURCE_KINDS`, `CAPABILITY_STATUS`, and `CAPABILITIES`.
- `CAPABILITIES.command.codex` currently reports `native`; Phase 23 should change this to unsupported-fail and update tests.
- `test/model.test.mjs` already asserts capability status values and is the right place for the model-level regression.

### Validation And Diagnostics
- `src/config-inspect.mjs` owns config validation through `validateConfig()` and `validateResource()`.
- `validateRuntimes()` currently checks only whether runtimes exist, not whether the resource kind is representable by each runtime.
- `src/config-editor.mjs` already has `capabilityDiagnostics(resource)` for setup UI save validation; this likely needs to stay aligned with config validation so UI and CLI report the same unsupported Codex command problem.
- `src/adapter-warnings.mjs` handles warnings for lossy or skipped mappings. Codex command rejection should not be modeled as an adapter warning because Phase 23 requires a hard validation failure.

### Rendering
- `src/adapters.mjs` owns render planning and resource output paths.
- `resourcePath(runtime, resource)` currently renders all command assets to `commands/<id>.md` for every runtime. After validation hardens, this should never be reached for Codex commands, but the planner may still add a defensive guard.
- `renderResource(runtime, adapter, resource)` currently renders command frontmatter with `aof-invocation: ${adapter.commandPrefix}${resource.id}`. That remains valid for Claude commands.
- Associated files for command assets now render flat beside the command markdown. Preserve that behavior for Claude commands.

### Setup UI
- `src/setup-ui.mjs` exposes `/api/capabilities`.
- `src/config-editor.mjs` exposes `capabilitiesPayload()` and `capabilityDiagnostics()`.
- `ui/src/main.tsx` displays capability badges from the capability payload. Phase 23 should only adjust existing labels/diagnostics caused by the central model change; new authoring workflows belong to Phase 26.

### Tests
- `test/integration/features/lifecycle.feature` is the primary BDD feature file for CLI lifecycle and asset apply scenarios.
- `test/integration/cli.ps1` must preserve PowerShell parity when external CLI behavior changes.
- `test/render-plan.test.mjs`, `test/config-inspect.test.mjs`, `test/config-editor.test.mjs`, and `test/integration/cli-child-process.test.mjs` are likely focused regression targets.

</code_context>

<specifics>
## Specific Scenarios To Cover

### Codex command rejection

Config shaped like this should fail validation and apply:

```json
{
  "resources": [
    {
      "kind": "command",
      "id": "ci",
      "runtimes": ["codex"],
      "body": "Run CI"
    }
  ]
}
```

Expected behavior:
- `aof project validate` or `aof assets validate` reports an error explaining that command assets are not supported for Codex.
- `aof assets apply --codex` fails before writing output.
- `.codex/commands/ci.md` is not created.

### Claude-only command rendering

Config shaped like this should continue to render:

```json
{
  "resources": [
    {
      "kind": "command",
      "id": "ci",
      "runtimes": ["claude"],
      "body": "Run CI"
    }
  ]
}
```

Expected behavior:
- `aof assets apply --claude` creates `.claude/commands/ci.md`.
- `aof assets apply --codex` does not create a Codex command file.

### Default runtimes and command assets

If a command resource omits `runtimes`, the current default behavior selects all supported runtimes. Under Phase 23, that should be invalid because the implicit Codex target is unsupported. Users must make command resources explicit with `runtimes: ["claude"]`.

### Simple argument markers

Simple asset content containing any of these should produce validation guidance:

```text
$ARGUMENTS
{{GSD_ARGS}}
argument-hint
{{args.phase}}
```

The message should tell users to use workflow-backed assets for arguments. The exact workflow config model is deferred to Phase 24.

</specifics>

<deferred>
## Deferred Ideas

- First-class workflow asset model and generated workflow locations.
- Runtime-specific workflow wrappers for Claude commands and Codex skills.
- `{{skills.<id>}}` and `{{workflows.<id>}}` placeholder expansion.
- Setup UI Simple vs Workflow-backed authoring mode.
- Argument metadata rendering for workflow-backed Claude command frontmatter and Codex skill body guidance.

</deferred>

---

*Phase: 23-Runtime Capability Contract*
*Context gathered: 2026-05-12*
