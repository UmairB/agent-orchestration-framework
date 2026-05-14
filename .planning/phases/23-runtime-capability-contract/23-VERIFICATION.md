---
phase: 23
type: verification
status: passed
verified: 2026-05-12
---

# Phase 23 Verification: Runtime Capability Contract

## Verdict

Passed.

## Requirement Coverage

| Requirement | Result | Evidence |
|-------------|--------|----------|
| RTS-01 | Pass | Claude command resources require `runtimes: ["claude"]` and render to `.claude/commands/<id>.md`. |
| RTS-02 | Pass | Codex command resources fail validation through CLI, setup UI validation, and render guards. |
| RTS-03 | Pass | Validation/apply diagnostics explain unsupported Codex commands before generated writes occur. |
| RTS-04 | Pass | Codex skill resources remain valid and are covered by model/config tests. |
| SIMPLE-01 | Pass | Existing simple skill, command, agent, and rule rendering stays direct and workflow-free. |
| SIMPLE-02 | Pass | Simple resources reject explicit argument-like fields. |
| SIMPLE-03 | Pass | Simple resource bodies and overrides reject argument-looking markers with workflow-backed guidance. |

## Verification Commands

- `npm run test:unit` passed.
- `npm test` passed.
- `npm run test:integration:ps` passed.

## Notes

- UI build was not rerun because Phase 23 changed server-side setup validation and capability payload behavior, not UI source assets.
- The PowerShell integration command prints a local profile warning about missing `posh-git`; the test command exits successfully.
