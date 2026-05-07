# Phase 8: Adapter Degradation Policy - Context

**Gathered:** 2026-05-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 8 formalizes how AOF reports, records, and enforces unsupported or lossy runtime behavior across the existing Claude Code and Codex adapters. It should introduce a shared adapter-warning model, command output behavior, strict-mode gates, and BDD-covered warning semantics without adding new runtimes, broad new primitive kinds, package dependency semantics, or UI execution.

</domain>

<decisions>
## Implementation Decisions

### Warning Surfaces
- **D-01:** Adapter degradation warnings must be emitted in both diagnostics and render flows: `validate`, `doctor`, `apply`, and `sync`.
- **D-02:** Use one shared warning object everywhere. Commands may format it differently, but the underlying data should include the same fields and warning codes.
- **D-03:** `apply --dry-run` and `sync --dry-run` should print adapter warnings before create/update/delete actions so users see portability issues before planned file effects.
- **D-04:** Adapter warnings should be computed at command time, not persisted in `.aof/aof.lock.json`. The lock remains focused on generated files, framework intent, and install attempts.

### Strict Mode
- **D-05:** `--strict` should fail every command that emits adapter warnings: `validate --strict`, `doctor --strict`, `apply --strict`, and `sync --strict`.
- **D-06:** For non-dry-run `apply --strict` and `sync --strict`, adapter warnings are a pre-write gate. No generated files or lock updates should happen when strict adapter warnings are present.
- **D-07:** `--force` does not bypass strict adapter warnings. `--force` remains about drift overwrite behavior only.
- **D-08:** Phase 8 should add `--strict` support to `apply` and `sync`, not only diagnostics commands, so ADPT-04 is delivered as user-facing behavior.

### Classification Rules
- **D-09:** Existing Codex rule guidance rendering to `AGENTS.md` is an intentional mapped output. It should remain informational, not warning-worthy.
- **D-10:** For common command hooks, if one runtime cannot represent a field directly, AOF should warn and skip that runtime's hook while continuing to render supported runtimes.
- **D-11:** Runtime-specific extension objects such as `hook.codex`, `mcpServer.claude`, and `settings.codex` are silently ignored by non-matching runtimes. This is expected namespaced pass-through behavior, not degradation.
- **D-12:** Unsupported future primitive/runtime combinations should warn and skip output by default. Strict mode promotes those warnings to command failure.

### Warning Detail And User Experience
- **D-13:** Each adapter warning should include full actionable detail: warning code, severity, config path, primitive kind/id, runtime, generated path when known, reason, and remediation.
- **D-14:** Human CLI output should use a compact grouped `adapter-warnings:` block before `apply`/`sync` actions and in `validate`/`doctor` output.
- **D-15:** JSON output should expose adapter warnings in a top-level `adapterWarnings` array for stable CI parsing across `validate`, `doctor`, `apply --dry-run`, and `sync --dry-run`.
- **D-16:** Remediation hints should be prescriptive when safe, for example "move this field under `codex`" or "remove `runtimes: [\"codex\"]` for this hook."

### the agent's Discretion
No areas were delegated to the agent's discretion. The user selected concrete decisions for all discussed areas.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/ROADMAP.md` — Phase 8 goal, requirements, success criteria, and milestone boundary.
- `.planning/REQUIREMENTS.md` — ADPT-01 through ADPT-04 and v1.1 traceability.
- `.planning/PROJECT.md` — Product context, runtime scope, source-of-truth decisions, and v1.1 aligned-core goal.
- `.planning/STATE.md` — Current project state and accumulated memory.

### Prior Context And Verification
- `.planning/phases/04-ui-configuration-editor/04-CONTEXT.md` — Existing capability badge, mapped/unsupported UI semantics, and no-execution boundary.
- `.planning/phases/05-verification-and-hardening/05-CONTEXT.md` — Strict/tolerant diagnostics, BDD and build verification policy, and structured diagnostic expectations.
- `.planning/phases/06-cli-lifecycle-commands/06-CONTEXT.md` — Top-level lifecycle command decisions, `--strict` behavior for diagnostics, dry-run expectations, and human/JSON output policy.
- `.planning/phases/07-expanded-dsl-primitives/07-01-SUMMARY.md` — Expanded DSL model and validation behavior.
- `.planning/phases/07-expanded-dsl-primitives/07-02-SUMMARY.md` — Runtime rendering for MCP, hooks, docs, settings, and explicit Phase 8 deferral for rich/lossy hook behavior.
- `.planning/phases/07-expanded-dsl-primitives/07-03-SUMMARY.md` — Setup UI expanded-section editing and docs.
- `.planning/phases/07-expanded-dsl-primitives/07-VERIFICATION.md` — Phase 7 requirement evidence and remaining Phase 8 boundary notes.

### Codebase Maps
- `.planning/codebase/STACK.md` — Node ESM CLI stack, npm scripts, UI build, and dependency boundaries.
- `.planning/codebase/ARCHITECTURE.md` — CLI command dispatch, apply/sync/validate/doctor flows, module boundaries, and extension points.
- `.planning/codebase/CONVENTIONS.md` — CLI option parsing, diagnostic style, rendering pattern, test harness, and BDD conventions.
- `.planning/codebase/CONCERNS.md` — Duplicated runtime validation, setup UI capability gaps, and warnings/strict-mode-adjacent concerns.

### Current Implementation
- `src/model.mjs` — Capability status constants and current `CAPABILITIES` table including mapped/future/unsupported statuses.
- `src/adapters.mjs` — Runtime rendering dispatch for resources and expanded runtime config outputs.
- `src/runtime-config.mjs` — Claude/Codex config builders for MCP, hooks, project docs, and settings.
- `src/config-inspect.mjs` — Existing validation/doctor diagnostics and `--strict` command behavior to extend.
- `src/cli.mjs` — Command router, option parsing, human/JSON formatting, `validate`, `doctor`, `apply`, and `sync` entry points.
- `src/sync.mjs` — Sync planning/execution path where pre-write strict gating must integrate.
- `src/render-plan.mjs` — Desired output/actions path for apply/sync and dry-run action preview.
- `src/config-editor.mjs` — Setup UI capability diagnostics and editable config payload behavior.
- `test/integration/cli.feature` — User-facing BDD scenarios to extend for adapter warnings and strict failures.
- `test/integration/cli.mjs` — BDD runner and step definitions for new warning/assertion cases.
- `test/model.test.mjs`, `test/config-inspect.test.mjs`, `test/adapters.test.mjs`, `test/render-plan.test.mjs`, `test/setup-ui.test.mjs` — Focused unit coverage entry points likely to need Phase 8 additions.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/model.mjs` already centralizes capability status names: `native`, `mapped`, `unsupported-warning`, `unsupported-fail`, and `future`.
- `src/config-inspect.mjs` already emits structured diagnostics and has warning/error handling suitable for a shared adapter-warning bridge.
- `src/cli.mjs` already supports `--strict` for `validate` and `doctor`, and its `parseOptions()` boolean flag list can be extended for `apply` and `sync`.
- `src/render-plan.mjs` already centralizes apply/sync desired-output planning before writes, which is the right point for pre-write strict gates.
- `src/sync.mjs` already composes generated output actions, package intent, dry-run output, and lock preview.
- `src/config-editor.mjs` already exposes capability diagnostics for the setup UI and can reuse the same classification concepts.
- The BDD runner already has stdout/file/JSON lock assertions and can be extended with adapter-warning and pre-write failure scenarios.

### Established Patterns
- Human-readable output is default; JSON modes expose structured payloads where automation needs stable shape.
- Warnings pass by default; `--strict` promotes warning conditions to failure for diagnostic commands.
- Dry-run paths must be side-effect-free and should show the full plan before writes.
- Generated-output drift and strict adapter warnings are separate concerns; `--force` is already scoped to drift overwrite.
- Runtime-specific extension objects are valid escape hatches and should not create cross-runtime noise.

### Integration Points
- Adapter warning generation should sit close to config normalization/render planning so both diagnostics and render flows can reuse it.
- `validate`/`doctor` should report adapter warnings without requiring a render write.
- `apply`/`sync` should compute adapter warnings before file writes and before lock writes; in dry-run, warnings should print before actions.
- `apply --strict` and `sync --strict` should fail before executing actions when adapter warnings exist.
- JSON output should add a stable top-level `adapterWarnings` array in commands that expose JSON.

</code_context>

<specifics>
## Specific Ideas

- Treat Codex `AGENTS.md` rule rendering as a successful mapped behavior, not a degradation warning.
- Treat unsupported future primitive/runtime combinations as "warn and skip" by default so supported runtimes can still render.
- Keep remediation hints concrete when the safe fix is obvious.
- Keep the lock manifest clean: do not persist adapter warning state.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 8-Adapter Degradation Policy*
*Context gathered: 2026-05-07*
