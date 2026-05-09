# Phase 17: Interactive CLI - Context

**Gathered:** 2026-05-09
**Status:** Proposed future phase

<domain>
## Phase Boundary

Phase 17 should replace AOF's current typed-line prompt helpers with a real interactive terminal experience. This is separate from Phase 16 live repository hardening, which removes the old SQLite/default catalog behavior and captures live-repo issues.

The goal is keyboard-driven selection and confirmation for local project and global asset workflows, not a return to repo defaults or catalog-backed seed items.

</domain>

<problem>
## Problem

The current prompt layer uses `readline` and asks users to type comma-separated numbers, ids, or `all`. In live use this feels rough:

- no arrow-key navigation
- no checkbox toggles
- no tab/space selection
- no clear focused item state
- no rich confirmation flow
- old prompt language still assumes "install items" and defaults

</problem>

<target_experience>
## Target Experience

- Arrow keys move through choices.
- Space toggles checkbox-style selections.
- Enter confirms.
- Tab can move between prompt controls where supported.
- Escape or Ctrl+C exits cleanly.
- Prompts are accessible enough for plain terminals and CI fallbacks.
- Non-interactive flags remain available for automation.
- Test-mode environment inputs remain supported for BDD.

</target_experience>

<candidate_implementation>
## Candidate Implementation

Use a maintained prompt library such as `@inquirer/prompts` for checkbox, select, confirm, and input prompts.

Keep a small wrapper in `src/prompt.mjs` so:

- CLI commands do not depend directly on a prompt package.
- Tests can keep deterministic env-driven input.
- Non-TTY mode can produce clear errors or require explicit flags.

</candidate_implementation>

<initial_scope>
## Initial Scope

1. Add an interactive prompt dependency.
2. Replace `selectRuntimes` with a checkbox prompt.
3. Add interactive project/global asset creation flows only where they are already supported by CLI commands.
4. Keep repo initialization empty by default unless the user explicitly creates project or global assets.
5. Add unit tests for prompt resolution and integration coverage for non-interactive fallbacks.

</initial_scope>

<out_of_scope>
## Out Of Scope

- Reintroducing built-in repo defaults.
- Reintroducing SQLite catalog storage.
- Hosted asset discovery.
- Browser setup UI execution.

</out_of_scope>

<canonical_refs>
## Canonical References

- `src/prompt.mjs`
- `src/cli.mjs`
- `test/prompt.test.mjs`
- `test/integration/features/lifecycle.feature`
- `.planning/phases/16-live-repository-hardening/16-CONTEXT.md`

</canonical_refs>

---

*Phase: 17-Interactive CLI*
*Context gathered: 2026-05-09*
