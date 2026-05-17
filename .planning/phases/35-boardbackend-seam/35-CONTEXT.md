# Phase 35: BoardBackend Seam - Context

**Gathered:** 2026-05-17
**Status:** Ready for planning

<domain>
## Phase Boundary

Extract a minimal `BoardBackend` seam from the working Phase 34 board lifecycle implementation. This phase preserves the Phase 34 GSD behavior while routing provider lookup and selected capability checks through a small backend registry. It must not redesign board lifecycle, introduce user-facing backend configuration, or move runtime fallback hardening forward from Phase 37.

</domain>

<decisions>
## Implementation Decisions

### Backend Seam Shape
- The first `BoardBackend` interface is strict and minimal: exactly `loadState`, `analyzeRoadmap`, `assertMilestone`, `syncBoardFromMilestone`, plus `kind` and `capabilities`.
- Extract the seam from the working Phase 34 code only; keep observable behavior byte-compatible wherever possible.
- Unsupported providers fail with structured `BACKEND_UNSUPPORTED` and a list of supported backend kinds.
- BOARD.json reshaping is minimal in Phase 35. Keep GSD-specific fields in their existing Phase 34 locations unless a small seam adapter requires a compatibility wrapper.

### Backend Registry And Resolution
- Add a tiny registry with `resolveBackend(name)` and register only `gsd` as the real backend.
- Backend modules should live under `src/backends/`, with `index.mjs`, `gsd-backend.mjs`, and a test-only null backend module if needed.
- Backend capabilities are represented as a `Set` of string capabilities on backend objects.
- `board-execution.mjs` should route only capability gating through the backend seam, such as assignment support, while preserving execution behavior otherwise.

### Test Backend Scope
- The null backend implements the same four methods with deterministic no-op/test responses and explicit unsupported capability gaps.
- Use the null backend in unit tests only, to prove board code routes through the backend seam without touching GSD tools.
- The null backend can be exported from production code, but must be documented as test-only and unsupported for real users.
- Retest only seam-level routing and unsupported capability behavior through the null backend; do not duplicate every Phase 34 sync test.

### Compatibility And Deferral Boundaries
- Phase 35 should not change observable CLI/API output except for structured unsupported-backend errors.
- Milestone creation fallback does not move into the backend interface; Phase 37 owns runtime fallback hardening.
- Do not add user-facing backend configuration. `executionProvider` registry lookup is the only backend selection surface.
- Documentation should be short and code-level: the seam is internal and not stable in v1.7.

### the agent's Discretion
- Exact helper names, module-local adapter functions, and test fixture naming are at the agent's discretion.
- The planner may choose whether `syncBoardFromMilestone` delegates to existing Phase 34 board sync code or returns a narrow operation helper, as long as the public behavior and four-method interface remain stable.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase And Requirements
- `.planning/ROADMAP.md` §Phase 35 — phase goal, success criteria, notes, and anti-over-abstraction warning.
- `.planning/REQUIREMENTS.md` §Backend Interface — BACK-01 through BACK-05.
- `.planning/PROJECT.md` §Current Milestone v1.7 — typed SDK backend intent and backend abstraction direction.

### Upstream Phase 34 Contract
- `.planning/phases/34-board-lifecycle-migration-and-typed-sync/34-CONTEXT.md` — locked lifecycle and binding behavior decisions.
- `.planning/phases/34-board-lifecycle-migration-and-typed-sync/34-VERIFICATION.md` — confirms Phase 34 typed sync behavior passed.
- `src/boards.mjs` — working lifecycle implementation to extract from, not redesign.
- `src/gsd-sdk-adapter.mjs` — typed SDK adapter consumed by the GSD backend.

### Existing Code To Modify
- `src/backends/` — new backend seam modules.
- `src/boards.mjs` — route GSD lifecycle operations through backend resolution where appropriate.
- `src/board-execution.mjs` — replace literal GSD assignment gating with backend capability checks.
- `src/cli.mjs` — preserve output, add structured unsupported-backend behavior if a non-GSD provider is encountered.
- `src/setup-ui.mjs` — preserve existing API shape while using backend-routed board functions.

### Test Surfaces
- `test/boards.test.mjs` — seam and lifecycle unit expectations.
- `test/board-execution.test.mjs` — assignment capability gating.
- `test/integration/features/boards.feature` — user-facing output must stay stable.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/boards.mjs` already owns board lifecycle, typed binding state, SDK-driven sync, validation, and structured `BoardLifecycleError`.
- `src/gsd-sdk-adapter.mjs` already provides the typed GSD operations that the real GSD backend should compose.
- `src/board-execution.mjs` already centralizes task assignment and execution records; Phase 35 should touch only provider/capability gating.

### Established Patterns
- Public CLI behavior is tested through Node BDD scenarios; avoid output churn unless required by the phase.
- Configuration and validation errors prefer structured codes and actionable messages.
- Existing tests use injected tools/fixtures at boundaries instead of importing external SDK internals in board code tests.

### Integration Points
- `executionProvider` currently carries `"gsd"` as the concrete provider; Phase 35 turns that into a registry lookup.
- `boards.mjs` currently imports the adapter directly; the GSD backend should become the adapter-composing layer.
- `board-execution.mjs` currently has GSD-specific provider checks; those should become capability checks.

</code_context>

<specifics>
## Specific Ideas

- Preferred unsupported-backend code: `BACKEND_UNSUPPORTED`.
- Preferred capability string for assignment: `assignTask`.
- Preferred capability string for milestone sync if needed: `syncMilestone`.
- Keep the real backend named `gsd`.
- Keep the null backend clearly labeled unsupported/test-only.

</specifics>

<deferred>
## Deferred Ideas

- Runtime fallback hardening and milestone creation handoff stay in Phase 37.
- Rich backend configuration, UI selection, and public backend authoring docs are deferred.
- A second real backend is out of scope for v1.7.

</deferred>

---

*Phase: 35-BoardBackend Seam*
*Context gathered: 2026-05-17*

