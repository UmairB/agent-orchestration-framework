# Phase 8 Research: Adapter Degradation Policy

## Scope

Phase 8 formalizes how AOF reports unsupported, skipped, or lossy runtime adapter behavior for the existing Claude Code and Codex targets. It does not add new runtimes, new primitive kinds, package dependency semantics, or UI execution.

The phase context in `08-CONTEXT.md` locks the policy decisions. This research translates those decisions into implementation seams in the current codebase.

## Current Implementation Map

### Runtime rendering

- `src/adapters.mjs` renders resources and expanded primitive outputs.
- `renderConfigOutputs()` filters by requested runtime and each primitive's `runtimes` list.
- `renderRuntimeConfigOutputs()` currently filters MCP servers and hooks per runtime without producing warnings.
- `renderProjectDocs()` maps `projectDocs` to root `AGENTS.md` for Codex and `CLAUDE.md` for Claude.
- Rules already have a deliberate Codex mapping to `AGENTS.md`; Phase 8 decision D-09 says that mapping remains intentional and should not become a warning.

### Runtime config helpers

- `src/runtime-config.mjs` applies runtime-specific extension objects through `runtimeExtension(value, runtime)`.
- Non-matching runtime extension objects are already ignored by construction.
- Vendor-neutral `settings` fields such as `model`, `trust`, and `autoCompact` are validated in `src/config-inspect.mjs` but are not currently rendered unless placed under `settings.claude` or `settings.codex`.

### Validation and health reporting

- `src/config-inspect.mjs` owns `validateConfig()`, `inspectConfig()`, and `doctorConfig()`.
- Validation diagnostics use `{ severity, path, message, code }`.
- `doctorConfig()` already computes render actions to report generated-output drift.
- This is the best location for command-time warning collection after the config is structurally valid.

### CLI behavior

- `src/cli.mjs` already parses `--strict`.
- `validate` and `doctor` currently fail strict mode only for validation/health warnings.
- `apply` and `sync` currently parse `--strict` but do not use it.
- `apply --dry-run` and `sync --dry-run` are already side-effect-free for runtime files and lock state.
- `apply` and `sync` need a pre-write strict gate before generated file writes, lock writes, or package installers.

### Lock state

- `src/render-plan.mjs` creates lock manifests from desired outputs and actions.
- Phase 8 decision D-04 says adapter warnings must be computed at command time and not stored in `.aof/aof.lock.json`.
- Therefore adapter warnings should not be added to `createLockManifest()`.

### Setup UI and editable config

- `src/config-editor.mjs` returns validation diagnostics and capability metadata to the setup UI.
- Existing `capabilityDiagnostics()` is resource-oriented and not the same as Phase 8 adapter warnings.
- The setup UI can expose adapter warnings in review data without adding shell execution.

## Proposed Architecture

Add a shared pure analyzer, likely `src/adapter-warnings.mjs`, with a function such as:

```js
collectAdapterWarnings(config, options)
```

Inputs:

- normalized config from `loadConfig()` or `resolveConfig()`
- requested runtimes from CLI/options
- target/global output context where generated path is known

Output:

```js
{
  code,
  severity: "warning",
  path,
  kind,
  id,
  runtime,
  generatedPath,
  reason,
  remediation
}
```

This keeps the warning object shared across CLI human output, JSON output, doctor reports, and UI review surfaces.

## Warning Categories

### Unsupported or skipped runtime behavior

Use for a primitive or feature requested for a runtime that cannot represent it. The command should skip that runtime-specific output by default, render supported runtimes, and fail before writes under `--strict`.

Candidate codes:

- `adapter.unsupported-runtime-feature`
- `adapter.skipped-runtime-output`

### Lossy or mapped behavior

Use where AOF renders the user's intent into a less precise target. Decision D-09 excludes existing Codex rule guidance to `AGENTS.md` from warning output because that is an intentional first-class mapping in the current product.

Candidate code:

- `adapter.lossy-runtime-mapping`

### Ignored non-matching runtime extension

Runtime-namespaced extension objects such as `hook.codex`, `mcpServer.claude`, and `settings.codex` are supposed to pass only to their matching runtime. Non-matching runtimes should ignore them silently.

No warning should be emitted for this case.

### Vendor-neutral setting gaps

Top-level `settings.model`, `settings.trust`, and `settings.autoCompact` currently validate but do not render through a shared mapping. Phase 8 should either:

- add safe direct mappings where semantics are equivalent, or
- emit adapter warnings when a requested runtime cannot represent the neutral setting.

The plan should prefer warnings over inventing semantics.

## Command Output Contract

Human output should include a compact block before planned write/action output:

```text
adapter-warnings:
- [adapter.unsupported-runtime-feature] hooks[0] runtime=codex source=hook:test-after-write output=.codex/config.toml
  reason: ...
  remediation: ...
```

JSON output should include top-level `adapterWarnings` for:

- `validate --json`
- `doctor --json`
- `apply --dry-run --json` if JSON output is introduced for dry-run, or the dry-run JSON paths currently supported
- `sync --dry-run --json` if JSON output is introduced for dry-run, or the dry-run JSON paths currently supported

The current CLI only has JSON for validate/doctor/install paths. For apply/sync, Phase 8 can satisfy D-15 by adding JSON output for dry-run previews if the implementation keeps default human output unchanged.

## Strict Mode Contract

`--strict` should fail every command that emits adapter warnings:

- `validate --strict`
- `doctor --strict`
- `apply --strict`
- `sync --strict`

For `apply` and `sync`, strict failure must happen before:

- generated file writes
- stale file deletes
- lock writes
- framework installer execution

`--force` should only affect drift handling and must not bypass adapter strict failures.

## Test Strategy

Unit tests should cover the pure analyzer first:

- shared warning object shape
- unsupported or skipped runtime feature warnings
- lossy mapping warnings where policy defines them
- silent non-matching runtime extension pass-through
- generated path inclusion when known
- no lock-state mutation

Command and BDD tests should cover:

- `validate` human and JSON adapter warnings
- `doctor` human and JSON adapter warnings
- `apply --dry-run` warning ordering before actions
- `sync --dry-run` warning ordering before actions
- `apply --strict` and `sync --strict` fail before writes and lock updates
- `--force --strict` still fails

UI/API tests should cover:

- editable config review payload includes `adapterWarnings`
- runtime-specific extensions do not produce warning noise
- setup UI review surfaces can render warning data without adding execution routes

## Risks

- The current code has several silent filters. Implementing warnings by changing render functions directly could create inconsistent command behavior. A shared analyzer reduces that risk.
- Existing validation stops config loading when errors exist. Adapter warnings should be computed only when structural validation permits a normalized config; otherwise users would see noisy or misleading adapter output.
- Adding apply/sync JSON output could change user-facing behavior if done too broadly. Keep JSON support limited and explicit.
- Strict mode must run before action execution, not merely set `process.exitCode` after actions have already been planned or printed.

## Research Conclusion

Phase 8 should be implemented as a shared warning analyzer plus command integrations. Rendering should remain deterministic and mostly unchanged except where an unsupported runtime feature must be skipped explicitly. Warning collection belongs at command time, outside lock generation, with strict mode enforced as a pre-write gate.
