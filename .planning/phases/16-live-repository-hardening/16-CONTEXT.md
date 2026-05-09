# Phase 16: Live Repository Hardening - Context

**Gathered:** 2026-05-09
**Status:** Waiting for live repository target

<domain>
## Phase Boundary

Phase 16 starts a hardening milestone after v1.2 Global Asset Library shipped. The goal is to test AOF against a real repository instead of only synthetic fixtures, then fix the issues that appear in realistic project structure, existing assistant folders, generated output drift, and setup workflows.

This phase should prioritize evidence from a live repository over new feature expansion. Changes should be driven by concrete failures, rough edges, confusing diagnostics, unsafe behavior, or missing coverage found during live-repo testing.

</domain>

<intent>
## User Intent

- Revert the generic "next milestone selection" direction.
- Do hardening work.
- Test AOF against a live repository.
- Remove SQLite for now because AOF is not currently using it for a real product path.
- Remove repo defaults; project and global assets should be explicit, not seeded built-ins.
- Create a separate phase for a more interactive CLI.

</intent>

<candidate_scope>
## Candidate Hardening Scope

### Live Repository Smoke

- Run AOF inspection, validation, dry-run sync/apply, and setup UI load against the selected live repository.
- Capture current repo shape, existing `.aof`, `.claude`, `.codex`, and root config state.
- Avoid destructive writes unless explicitly approved or performed in a disposable copy/worktree.

### Realistic Migration And Drift

- Exercise legacy/root config detection and migration behavior if the live repo has old config.
- Verify generated output ownership, drift warnings, stale cleanup previews, and lock behavior against real files.
- Confirm AOF does not overwrite unrelated assistant files.

### Setup UI Hardening

- Start setup UI against the live repo.
- Verify it loads current config, global references, adapter warnings, and diagnostics cleanly.
- Fix request handling, diagnostics, or rendering issues discovered by live data.

### CLI Diagnostics Hardening

- Improve unclear errors found during live-repo validation.
- Ensure `validate`, `doctor`, `config show`, `sync --dry-run`, and `clean --dry-run` give actionable output.

### Regression Coverage

- Turn every live-repo defect into focused unit or BDD coverage where practical.
- Keep BDD required for user-facing behavior.
- Keep PowerShell parity for milestone closeout if behavior touches integration scenarios.

</candidate_scope>

<safety>
## Safety Defaults

- Use a disposable copy or git worktree for live-repo mutation tests.
- Start with read-only commands and dry runs.
- Do not run destructive commands such as clean/apply without a reversible test setup.
- Preserve unrelated user changes.
- Treat `.claude/` and `.codex/` as generated output only when AOF lock ownership proves it.

</safety>

<decisions_needed>
## Decisions Needed

1. Which live repository should Phase 16 test against?
2. Should tests run directly in that repository, in a temporary copy, or in a separate git worktree?
3. Are write operations allowed after dry-run review, or should Phase 16 remain dry-run only against the live repo?
4. Should Phase 16 become the start of a v1.3 hardening milestone, or remain a single hardening phase before selecting v1.3?

</decisions_needed>

<recommended_path>
## Recommended Path

Use a disposable copy or git worktree of the selected live repository. Start with:

1. `aof doctor`
2. `aof validate`
3. `aof config show --json`
4. `aof sync --dry-run`
5. setup UI load and config fetch

Then prioritize fixes by severity:

1. Data-loss or overwrite risks.
2. Incorrect validation/rendering behavior.
3. Broken setup UI load/save behavior.
4. Confusing diagnostics.
5. Missing regression coverage.

</recommended_path>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

- `.planning/PROJECT.md`
- `.planning/STATE.md`
- `.planning/milestones/v1.2-MILESTONE-AUDIT.md`
- `.planning/phases/15-global-asset-verification/15-VERIFICATION.md`
- `README.md`
- `src/cli.mjs`
- `src/config-inspect.mjs`
- `src/render-plan.mjs`
- `src/setup-ui.mjs`
- `test/integration/features/lifecycle.feature`
- `test/integration/features/setup-ui.feature`

</canonical_refs>

<deferred>
## Deferred Unless Live Testing Proves Otherwise

- Hosted asset distribution.
- Runtime expansion.
- Global asset version pinning.
- Task management.
- Native rewrite or packaging overhaul.
- Broad UI execution feature work.

</deferred>

---

*Phase: 16-Live Repository Hardening*
*Context gathered: 2026-05-09*
