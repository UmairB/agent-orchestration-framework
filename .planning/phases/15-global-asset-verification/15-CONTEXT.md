# Phase 15: Global Asset Verification - Context

**Gathered:** 2026-05-09
**Status:** Ready for research and planning

<domain>
## Phase Boundary

Phase 15 closes out the v1.2 Global Asset Library milestone by verifying and hardening the behavior shipped in Phases 11 through 14.

This phase is a verification and milestone-closeout phase, not a new feature phase. It covers coverage audit, missing test coverage, PowerShell parity, UI build verification, documentation verification, and milestone audit artifacts.

It should add code only when the audit finds a concrete product or test gap. Otherwise the work should focus on tests, documentation, verification artifacts, and v1.2 milestone closeout.

</domain>

<decisions>
## Implementation Decisions

### Verification Scope
- **D-01:** Verify the full v1.2 global asset slice: global workspace, global refs, rendering, lock metadata, runtime overrides, associated files, and setup UI.
- **D-02:** Map coverage back to all v1.2 requirements, with special attention to `TEST-01`, `TEST-02`, and `TEST-03`.
- **D-03:** Include both CLI and setup UI API behavior in the coverage audit.

### Required Commands
- **D-04:** `npm run test:unit` is required.
- **D-05:** `npm run ui:build` is required.
- **D-06:** `npm test` is required.
- **D-07:** `npm run test:integration:ps` is required on Windows.

### Coverage Audit
- **D-08:** Create a phase-local coverage matrix mapping v1.2 requirements to unit, BDD, UI API, build, and PowerShell coverage.
- **D-09:** Add tests only where the matrix finds a real coverage gap.
- **D-10:** Keep new tests focused on global library behavior, not unrelated cleanup.

### Hardening Bias
- **D-11:** Avoid feature expansion during Phase 15.
- **D-12:** Add code only to fix concrete verification gaps or defects found during audit.
- **D-13:** Preserve current CLI and UI behavior unless a test exposes a real mismatch with v1.2 requirements.

### PowerShell Parity
- **D-14:** Treat PowerShell integration parity as required for v1.2 closeout because this milestone is being developed on Windows.
- **D-15:** If PowerShell parity fails, fix the underlying issue or document an accepted blocker only if it is outside project control.

### Milestone Audit
- **D-16:** Produce a v1.2 milestone audit covering shipped behavior, evidence, residual risks, deferred scope, and next milestone candidates.
- **D-17:** Archive v1.2 roadmap and requirements snapshots after successful verification.
- **D-18:** Advance live planning state only after the milestone audit is complete.

### Deferred Scope
- **D-19:** Hosted distribution remains deferred.
- **D-20:** Cross-machine sync remains deferred.
- **D-21:** Version pinning remains deferred.
- **D-22:** Vendoring remains deferred.
- **D-23:** Runtime expansion remains deferred.
- **D-24:** UI execution remains deferred.

### the agent's Discretion
- Choose the exact coverage matrix file name and format.
- Choose whether to add one hardening test wave or split tests by domain based on audit findings.
- Choose the exact milestone archive file names, provided they are consistent with prior milestone archives.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning
- `.planning/PROJECT.md` - current v1.2 milestone state and active final verification requirement.
- `.planning/REQUIREMENTS.md` - `TEST-01` through `TEST-03` and all v1.2 requirements.
- `.planning/ROADMAP.md` - Phase 15 goal and success criteria.
- `.planning/STATE.md` - current project state and accumulated workflow notes.

### Prior Phase Context
- `.planning/phases/11-global-library-workspace/11-VERIFICATION.md`
- `.planning/phases/12-project-reference-rendering/12-VERIFICATION.md`
- `.planning/phases/13-code-bearing-asset-files/13-VERIFICATION.md`
- `.planning/phases/14-global-asset-setup-ui/14-VERIFICATION.md`
- `.planning/phases/10-bdd-parity-and-hardening/10-CONTEXT.md`

### Research
- `.planning/research/SUMMARY.md`
- `.planning/research/ARCHITECTURE.md`
- `.planning/research/PITFALLS.md`

### Current Implementation And Tests
- `src/workspace.mjs`
- `src/dsl.mjs`
- `src/config-inspect.mjs`
- `src/adapters.mjs`
- `src/render-plan.mjs`
- `src/config-editor.mjs`
- `src/setup-ui.mjs`
- `ui/src/main.tsx`
- `test/*global*` related unit coverage where present.
- `test/config-inspect.test.mjs`
- `test/render-plan.test.mjs`
- `test/setup-ui.test.mjs`
- `test/integration/features/lifecycle.feature`
- `test/integration/features/setup-ui.feature`
- `test/integration/cli.ps1`

</canonical_refs>

<code_context>
## Existing Coverage Highlights

- Phase 11 added global workspace path and `aof global ...` CLI coverage.
- Phase 12 added `globalRefs`, referenced global validation, rendering, and lock source scope coverage.
- Phase 13 added explicit associated-file validation, rendering, lock, dry-run, and BDD coverage.
- Phase 14 added setup UI scoped API, Project/Global UI, global resource editing, global skill helper-file editing, and project reference API coverage.
- `npm test` runs unit and Node BDD integration coverage.
- `npm run test:integration:ps` runs the PowerShell wrapper over the split feature suite.
- `npm run ui:build` validates the React setup UI build.

</code_context>

<specifics>
## Specific Verification Targets

Phase 15 should prove:

- `~/.aof` path resolution and override behavior.
- Global resource creation/list/show/validate behavior.
- Project `globalRefs` validation for missing refs and conflicts.
- Referenced global apply/sync rendering.
- Lock metadata preserves global source scope.
- Runtime overrides on global assets are honored.
- Associated files are validated, rendered, locked, drift-protected, and not copied into projects.
- Setup UI can edit project and global scopes distinctly.
- Setup UI can add/remove project global refs without copying source files.
- Setup UI build passes.
- Node and PowerShell integration runners agree on user-facing behavior.

</specifics>

<deferred>
## Deferred Ideas

- Hosted asset registry.
- Cross-machine global asset sync.
- Semantic version pinning.
- Vendoring global assets into projects.
- Runtime expansion beyond Claude Code and Codex.
- Browser execution of CLI commands.
- Binary associated files.
- Project-local overrides of global asset bodies or associated files.

</deferred>

---

*Phase: 15-Global Asset Verification*
*Context gathered: 2026-05-09*
