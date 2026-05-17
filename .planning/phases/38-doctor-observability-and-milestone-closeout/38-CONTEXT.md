---
phase: 38
name: Doctor, Observability, And Milestone Closeout
status: ready_for_planning
gathered: 2026-05-17
mode: autonomous_smart_discuss
---

# Phase 38: Doctor, Observability, And Milestone Closeout - Context

<domain>
## Phase Boundary

Ship the final v1.7 diagnostic and observability layer over the typed GSD SDK backend: add `aof boards doctor`, make board command JSON failures structured and actionable, surface SDK/tools drift and Windows environment risks, record SDK/tool metadata in lock state, and close the milestone with audit/archive artifacts.

</domain>

<decisions>
## Implementation Decisions

### Doctor Scope
- Build a dedicated board doctor surface, separate from `aof project doctor`, because Phase 38 diagnostics are about board-to-GSD health rather than generic config/render health.
- The default human output should be a compact pass/fail ladder with stable check ids, severity, message, and `next:` hint where applicable.
- JSON output should return the same check objects plus an aggregate `ok` boolean; tests should assert codes rather than brittle prose.
- Doctor is a reporter over existing board/backend/adapter state. It may compose existing functions and add small metadata probes, but should not duplicate roadmap sync business logic.

### v1.6 Migration Diagnostics
- Detect v1.6-shaped boards where `gsd.milestone.roadmapPath` exists but `gsd.milestone.id` is missing.
- Emit `BOARD_MILESTONE_ID_MISSING` as a warning with an exact `aof boards milestone attach <board-id> --milestone <milestone-id> --roadmap <path>` next hint when inference is possible.
- If the milestone id cannot be inferred safely, still emit the migration warning but use `<milestone-id>` in the remediation command; never auto-pick in doctor.
- Reuse the existing repair/attach behavior for mutations. Doctor itself stays read-only.

### Structured JSON Errors
- Sweep board subcommands touched in v1.7 for `--json` parity, prioritizing sync, milestone attach/status/answer, repair, assignment, execution, and doctor.
- Structured errors should use `{ ok: false, code, message, expected?, actual?, next? }` consistently.
- Usage errors can remain human-oriented unless they already map to a typed board lifecycle error; do not inflate this phase into a CLI framework rewrite.
- Setup UI structured error helpers should remain compatible with the same error shape but do not need a new UI component in this phase.

### SDK And Tool Observability
- Add a small adapter-owned toolchain metadata probe that reports bundled `@gsd-build/sdk` version, resolved `gsd-tools.cjs` path, and best-effort tools version.
- `SDK_VERSION_DRIFT` is a warning, not a blocker. `GSD_TOOLS_MISSING` is an error when the resolved tools path is unavailable.
- Record SDK/tool metadata additively under `.aof/aof.lock.json` without changing existing lock consumers.
- Keep `src/gsd-sdk-adapter.mjs` the only module that imports `@gsd-build/sdk`; any doctor code should call adapter functions.

### Windows Checks
- Doctor should include Windows-oriented checks without making Linux/macOS noisy: node-on-PATH, UNC project path warning, and BOM detection where adapter/tool stdout or relevant `.planning` files are read.
- Use warnings for UNC and BOM risks unless a concrete read/parse failure occurs.
- Preserve Phase 36/37 line-ending and fallback safeguards; this phase reports risks, it should not undo them.

### Closeout
- After implementation verification, produce Phase 38 summaries and verification, then run the milestone audit/archive workflow.
- Milestone closeout should not broaden scope into v1.8 event streaming, setup UI live execution, or SDK milestone creation runners.

### the agent's Discretion
All lower-level implementation choices are at the agent's discretion when they preserve these constraints, existing CLI style, and v1.7 requirement coverage.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/boards.mjs` already owns board shape validation, `BoardLifecycleError`, milestone attach/repair/sync, v1.6 migration warnings, and structured `toJSON()` errors.
- `src/cli.mjs` already has `aof project doctor`, `printJson()`, `isStructuredError()`, `structuredErrorDetails()`, and board command handlers with scattered `--json` support.
- `src/gsd-sdk-adapter.mjs` already exposes `gsdSdkVersion()`, `resolveGsdToolsPath()`, dispatch logging, `GsdSdkError`, and wrapped `GSDTools` calls.
- `src/lock.mjs` has additive read/write helpers and lock merge patterns suitable for recording toolchain metadata.
- Existing BDD in `test/integration/features/boards.feature` and PowerShell parity in `test/integration/cli.ps1` are the right home for doctor and JSON parity scenarios.

### Established Patterns
- CLI commands usually return human output by default and `{ ok: true, ... }` / typed payloads for `--json`.
- Board lifecycle errors carry stable codes and `next` hints; user-facing tests assert those codes/hints.
- Adapter boundary tests use injected tools or captured fixtures; BDD uses env fixtures rather than invoking real GSD phase execution.
- Lock state changes are additive and preserve unknown/prior fields where possible.

### Integration Points
- Add `boards doctor` to the boards command router, help text, and BDD runners.
- Add a board doctor function beside `validateBoards()` / lifecycle helpers in `src/boards.mjs` or a closely scoped board diagnostics module if that keeps the file smaller.
- Add adapter metadata functions to `src/gsd-sdk-adapter.mjs`; call them from doctor and from adapter boot paths that can safely update lock metadata.
- Update tests for unit coverage, Node BDD, PowerShell BDD, and supply-chain/boundary verification.

</code_context>

<specifics>
## Specific Ideas

- Keep the doctor ladder dense and operational: `PASS/WARN/FAIL code message`, with `next:` only when useful.
- Prefer exact remediation commands over paragraphs.
- Keep all Phase 38 behavior read-only except explicit lock metadata recording tied to adapter boot.

</specifics>

<deferred>
## Deferred Ideas

- v1.8 event streaming and setup UI live execution progress.
- SDK-native milestone creation runner adoption.
- Broad project-wide doctor rewrite beyond the board/GSD checks required for v1.7.
- Automatic doctor fix mode for v1.6 board migration.

</deferred>
