# Phase 16: Next Milestone Selection - Context

**Gathered:** 2026-05-09
**Status:** Waiting for milestone direction

<domain>
## Phase Boundary

Phase 16 starts the next milestone after v1.2 Global Asset Library shipped. There is no active milestone selected yet, so this discussion phase should choose the next milestone theme before research, requirements, roadmap, or implementation planning begins.

The phase should not start implementation. Its output is a selected milestone direction, initial scope boundaries, and explicit deferrals.

</domain>

<current_state>
## Current Product State

- v1 Assistant Configuration Foundation shipped on 2026-05-07.
- v1.1 Aligned Core Hardening shipped on 2026-05-08.
- v1.2 Global Asset Library shipped on 2026-05-09.
- AOF now has `.aof/` source-of-truth configuration, Claude Code and Codex rendering, lifecycle CLI commands, expanded DSL primitives, adapter warnings, framework packages, global reusable assets, global references, associated files, setup UI Project/Global scopes, and cross-runner BDD coverage.
- There are no active requirements in `.planning/PROJECT.md`.

</current_state>

<candidate_directions>
## Candidate Milestone Directions

### Option 1: UI Execution And Guided Operations

Let setup UI move beyond config editing into safe execution workflows for `init`, `apply`, `sync`, `validate`, `doctor`, `install`, and `clean`.

Likely focus:
- Browser-triggered preview/apply operations with explicit confirmation.
- Structured command progress, output, diagnostics, and failure display.
- Execution safety boundaries for local server process commands.
- UI build plus setup UI API BDD coverage.

Main risk:
- This crosses the previous v1 execution boundary. It needs careful command authorization, process lifecycle, and failure-state design.

### Option 2: Runtime Expansion

Add one or more new concrete assistant runtimes beyond Claude Code and Codex.

Likely focus:
- Runtime capability model cleanup.
- Adapter implementation for the selected runtime.
- Degradation warnings and lock ownership for the new runtime.
- BDD coverage for runtime-specific render outputs.

Main risk:
- The right runtime target must be selected up front, and unsupported runtime semantics can expand scope quickly.

### Option 3: Hosted Or Synced Asset Distribution

Move beyond local `~/.aof` reuse into discovery, sync, or package distribution for global assets.

Likely focus:
- Package/source descriptors for global asset libraries.
- Pull/update flows.
- Provenance and trust boundaries.
- Conflict and version policy.

Main risk:
- Hosted discovery, sync, and trust/version semantics are broad. This may need a smaller first slice.

### Option 4: Global Asset Versioning And Vendoring

Add explicit snapshot/version workflows for global references.

Likely focus:
- Pinning global references to versions or revisions.
- Vendoring a global asset into project `.aof` as an explicit copy.
- Upgrade/diff workflows.
- Lock and diagnostic traceability.

Main risk:
- Requires a version identity model for local files before hosted distribution exists.

### Option 5: Task Management And Agent Orchestration Foundation

Start the long-term kanban/task-management direction.

Likely focus:
- Task/project data model.
- Agent assignment metadata.
- Progress/status tracking.
- CLI/UI surfaces for task lifecycle.

Main risk:
- This is a major product shift from assistant asset configuration and should be scoped as a foundation-only milestone.

### Option 6: Native Core / Packaging Hardening

Improve installation, distribution, performance, and operational robustness without changing core product scope.

Likely focus:
- CLI packaging/distribution.
- Data migration hardening.
- Performance and large-config behavior.
- Possible Rust/native-core spike only if scoped as research.

Main risk:
- Could become an internal engineering milestone with less immediate user-facing value.

</candidate_directions>

<recommended_path>
## Recommended Default

Option 1, UI Execution And Guided Operations, is the most direct next step because the setup UI now edits nearly all important configuration, but users still must switch to the CLI for execution. A careful preview-first UI execution milestone would build on existing lifecycle commands, setup UI API tests, and BDD infrastructure without requiring new runtime semantics or hosted distribution.

If the priority is ecosystem breadth instead of workflow completion, Option 2 is the next strongest candidate.

</recommended_path>

<decisions_needed>
## Decisions Needed

1. Select the Phase 16 milestone direction.
2. Decide whether the next milestone should be a full product milestone or a research/spike milestone.
3. Confirm whether BDD remains required for all new user-facing behavior.
4. Confirm whether PowerShell integration remains required for milestone closeout.

</decisions_needed>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/PROJECT.md`
- `.planning/ROADMAP.md`
- `.planning/REQUIREMENTS.md`
- `.planning/STATE.md`
- `.planning/MILESTONES.md`

### Recent Milestone Archives
- `.planning/milestones/v1.2-MILESTONE-AUDIT.md`
- `.planning/milestones/v1.2-ROADMAP.md`
- `.planning/milestones/v1.2-REQUIREMENTS.md`

### Prior Phase References
- `.planning/phases/10-bdd-parity-and-hardening/10-CONTEXT.md`
- `.planning/phases/14-global-asset-setup-ui/14-VERIFICATION.md`
- `.planning/phases/15-global-asset-verification/15-VERIFICATION.md`

</canonical_refs>

<deferred>
## Deferred Until Selection

- No v1.3 requirements are created yet.
- No Phase 16 implementation plan is created yet.
- No code changes should be made until the milestone direction is selected and planned.

</deferred>

---

*Phase: 16-Next Milestone Selection*
*Context gathered: 2026-05-09*
