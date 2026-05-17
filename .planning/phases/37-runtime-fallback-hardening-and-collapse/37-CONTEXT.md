---
phase: 37
name: Runtime Fallback Hardening And Collapse
status: ready_for_planning
gathered: 2026-05-17
---

# Phase 37: Runtime Fallback Hardening And Collapse - Context

<domain>
## Phase Boundary

Make SDK phase execution the primary path for assigned phase tasks and demote runtime CLI spawning to explicit milestone-creation fallback only. This phase renames the fallback module, removes ROADMAP.md mtime scraping, labels every fallback invocation, and preserves existing board/task/UI execution record shape while adding typed SDK runner results.

</domain>

<decisions>
## Implementation Decisions

### SDK Phase Execution
- **D-01:** Add a typed SDK runner function in `src/gsd-sdk-adapter.mjs` for `runPhase(projectDir, phaseNumber, options)`. It should instantiate the SDK `GSD` class, call `runPhase`, and wrap SDK/runner failures through `GsdSdkError`.
- **D-02:** `assignTaskToAgent()` should call the SDK runner for phase-shaped tasks through an injectable execution boundary. Tests may inject a fake runner; production uses the adapter.
- **D-03:** Preserve the v1.6 board task summary shape: `task.execution.provider/status/phase/executionPath/updatedAt` stays byte-compatible for setup UI consumers. Store the full typed phase runner result in the execution record under an additive field such as `sdkResult`.
- **D-04:** A successful SDK result sets execution/task status to `complete`/`done`; a failed `PlanResult` or phase result sets execution/task status to `failed`/`blocked` and records SDK `error.subtype` and messages. A thrown adapter error also records a failed execution rather than silently keeping "running".
- **D-05:** Tests use deterministic fake phase runner results. Do not run real autonomous GSD phase execution from unit or BDD tests.

### Fallback Module Role
- **D-06:** Rename `src/gsd-runtime.mjs` to `src/gsd-runtime-fallback.mjs` and update imports/tests. Keep function names stable where that reduces churn, but module naming must make fallback status explicit.
- **D-07:** Runtime CLI fallback is only for interactive milestone creation/continuation (`aof boards create/repair` handoff and `boards milestone answer`). It is not a peer phase-execution path after this phase.
- **D-08:** Every runtime CLI fallback invocation should include `[fallback runtime=<runtime>] SDK path unavailable for <reason>` in returned stderr/lastOutput so users and tests can distinguish fallback from typed SDK work.
- **D-09:** Preserve Windows fallback safeguards (`shell: process.platform === "win32"` and CRLF-safe output parsing). Add a short `WINDOWS-FALLBACK` comment before the platform shell option.

### Completion Detection
- **D-10:** Delete `completedRoadmapPath` mtime probing. After runtime CLI fallback returns, use `loadGsdState()` to decide whether `.planning/ROADMAP.md` is present and therefore whether a completed runtime handoff can provide `.planning/ROADMAP.md`.
- **D-11:** If `loadGsdState()` fails after a runtime fallback spawn, classify the fallback invocation from exit code/output only and preserve the SDK-state failure in stderr/lastOutput instead of crashing the milestone answer path.

### Milestone Creation Handoff
- **D-12:** Do not add an AOF-side composite `aof boards milestone create` workflow that tries to fake a missing SDK milestone runner. Unknown milestone subcommands should remain instructional.
- **D-13:** Improve the unknown `boards milestone` guidance to make the handoff explicit: complete `$gsd-new-milestone`, then run `aof boards milestone attach ...`.

### Verification
- **D-14:** Add unit coverage for SDK phase-run success, SDK phase-run failure with `error.subtype`, fallback stderr labeling, and removal of mtime-based completion behavior.
- **D-15:** Add or adjust BDD only where user-visible fallback labeling or assignment completion changes. Keep existing board workflows stable.

</decisions>

<canonical_refs>
## Canonical References

- `.planning/ROADMAP.md` §Phase 37 — phase goal, success criteria, and notes.
- `.planning/REQUIREMENTS.md` §Execution — EXEC-01 through EXEC-04.
- `.planning/phases/33-sdk-adapter-foundation/33-CONTEXT.md` — adapter boundary, no AOF-side composite, and SDK-only access rules.
- `.planning/phases/35-boardbackend-seam/35-CONTEXT.md` — backend capability gating and Phase 37 deferral boundary.
- `node_modules/@gsd-build/sdk/dist/index.d.ts` — `GSD.runPhase()` surface.
- `node_modules/@gsd-build/sdk/dist/types.d.ts` — `PhaseRunnerResult`, `PhaseStepResult`, and `PlanResult` shapes.

</canonical_refs>

<code_context>
## Existing Code Insights

- `src/gsd-runtime.mjs` currently handles milestone runtime prompts, fallback CLI spawning, status classification, and `completedRoadmapPath()` mtime probing.
- `src/board-execution.mjs::assignTaskToAgent()` currently creates an execution record with GSD command strings and status `running`; it does not call SDK phase execution.
- `src/cli.mjs` and `src/setup-ui.mjs` import `continueGsdMilestone` from `src/gsd-runtime.mjs`; both need import updates after the rename.
- `test/boards.test.mjs` imports runtime prompt helpers from `src/gsd-runtime.mjs`; tests should move to fallback module naming.
- SDK 0.1.0 exposes `GSD.runPhase(phaseNumber, options?)` returning `PhaseRunnerResult`; `PlanResult.error.subtype` carries typed execution failure reasons.

</code_context>

<deferred>
## Deferred Ideas

- `aof boards doctor`, SDK/tools version drift, UNC warnings, BOM warnings, and JSON error sweep remain Phase 38.
- Event streaming via `GSDEventStream` remains v1.8 unless needed for a minimal execution record.
- Full setup UI live execution streaming remains out of scope.

</deferred>

