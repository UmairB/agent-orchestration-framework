# Phase 23: Runtime Capability Contract - Research

**Researched:** 2026-05-12
**Question:** What must be understood to plan Phase 23 well?

## Executive Summary

Phase 23 is a local architecture correction rather than an external integration. The current model says `command.codex` is `native`, and render planning will produce `.codex/commands/<id>.md` if asked. Validation currently checks only whether a runtime id is known, not whether a resource kind is supported by that runtime. The setup UI already has capability diagnostics driven by `CAPABILITIES`, so changing the central model can carry through to the UI save path, but CLI validation must be explicitly wired to the same capability contract.

The key implementation risk is apply behavior: `aof assets apply` loads resolved config, collects adapter warnings, creates a render plan, and writes actions without first calling `validateConfig()`. Codex command rejection therefore needs an apply preflight validation gate, not only a `project validate` improvement.

## Existing Implementation Facts

### Capability Model

- `src/model.mjs` defines `CAPABILITY_STATUS` and `CAPABILITIES`.
- `CAPABILITIES.command.codex` currently reports `native`.
- Existing model tests in `test/model.test.mjs` already assert selected capability status values and should add command/Codex coverage.

### CLI And Validation

- `src/config-inspect.mjs` owns `validateConfig()` and `validateResource()`.
- `validateRuntimes()` only validates runtime names and non-empty arrays.
- Resources without explicit `runtimes` resolve to all supported runtimes elsewhere, so a command missing `runtimes` must be treated as implicitly targeting Codex.
- `src/cli.mjs` uses `validateConfig()` for `aof project validate` and `aof assets validate`.
- `aof assets apply` does not call `validateConfig()` before `createRenderPlan()`, so apply-time rejection requires a new preflight gate in `assetsApplyCommand()`.

### Setup UI

- `src/config-editor.mjs` exposes `capabilitiesPayload()` and `capabilityDiagnostics(resource)`.
- `validateEditableResource()` already appends `capabilityDiagnostics(resource)`, and `unsupportedFail` diagnostics are blocking errors.
- `ui/src/main.tsx` reads capability status from the payload for badges. A central capability change should affect labels/status without a broad UI rewrite.

### Rendering And Lock Cleanup

- `src/adapters.mjs` renders any `kind: "command"` to `commands/<id>.md` regardless of runtime.
- `src/render-plan.mjs` compares desired outputs with lock entries and deletes stale lock-owned files when they are no longer desired and not drifted.
- Once config is valid and command resources target only Claude, a Codex-only apply should produce no command desired output; stale `.codex/commands/*` entries already in the lock can be deleted by existing stale-output logic.
- A defensive render guard for Codex commands is still useful to prevent direct `createRenderPlan()` calls from reintroducing `.codex/commands/*`.

### Simple Asset Argument Detection

- Simple assets currently have no formal mode field; all existing resources are simple by default.
- Content can come from `body`, `prompt`, `instructions`, file-backed `path`, and runtime overrides.
- Runtime overrides may be inline objects or external JSON files and are already read during validation for identity checks.
- Phase 23 can add validation that detects obvious argument markers in effective source content without defining the workflow-backed config model yet.

## Recommended Planning Shape

Use two implementation plans:

1. Shared capability and validation contract.
   - Update `CAPABILITIES`.
   - Add reusable resource/runtime capability validation in CLI config inspection.
   - Keep setup UI validation aligned through the same status model.
   - Add simple argument marker diagnostics.
   - Cover unit tests.

2. Apply/render and BDD hardening.
   - Add apply preflight validation before render planning.
   - Add a defensive render guard against Codex command output.
   - Verify stale lock-owned `.codex/commands/*` cleanup after config correction.
   - Add BDD scenarios for Codex rejection, Claude-only rendering, no `.codex/commands/*`, and simple argument diagnostics.

## Risks And Mitigations

- **Risk:** Adding validation for implicit default runtimes could break existing command configs that omitted `runtimes`.
  **Mitigation:** This is required by Phase 23. Diagnostic should say command assets must target `["claude"]` explicitly.

- **Risk:** Apply preflight could surface unrelated existing validation errors before rendering.
  **Mitigation:** That is consistent with the new hard rejection policy. Keep diagnostics readable and preserve `--json` behavior where available.

- **Risk:** Argument marker detection may false-positive on prose that merely mentions `$ARGUMENTS`.
  **Mitigation:** Phase 23 intentionally treats obvious markers as validation guidance because simple mode must not imply argument handling.

- **Risk:** Direct render-plan unit tests may start failing if they still create Codex command desired outputs.
  **Mitigation:** Update tests to use Claude for command rendering and add an explicit test that Codex command render planning throws.

## Verification Targets

- `npm run test:unit`
- `npm test`
- `npm run test:integration:ps`
- Focused manual smoke:
  - `node bin/aof.mjs assets apply --codex` with a Codex command config fails and writes no `.codex/commands/*`.
  - `node bin/aof.mjs assets apply --claude` with a Claude command config writes `.claude/commands/<id>.md`.

---

*Phase: 23-Runtime Capability Contract*
