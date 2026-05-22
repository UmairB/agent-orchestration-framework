---
phase: 39
name: Board Dogfood Requirements And Live State Baseline
status: ready_for_planning
gathered: 2026-05-18
mode: self_discuss
---

# Phase 39: Board Dogfood Requirements And Live State Baseline - Context

**Gathered:** 2026-05-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Establish the real `coordination` board as the v1.8 dogfood anchor: confirm it is valid durable project state, commit it to git, capture baseline CLI output for every board command, compare output against canonical BOARD.json, and create the milestone-wide v1.8 UAT log with any mismatch findings. No new board functionality is implemented in this phase — this is observation and evidence capture only.

</domain>

<decisions>
## Implementation Decisions

### Board Pre-Existing State
- **D-01:** The `coordination` board was created and synced to milestone v1.8 during v1.7 development. Treat this as **valid baseline state** — do not reset or recreate it. Document the pre-existing sync in the UAT log as expected context, not a finding.
- **D-02:** The baseline capture phase is the natural anchor for Phase 40's idempotent re-attach/sync tests. Phase 39 documents what already exists; Phase 40 verifies re-run behavior against that state.

### Board Git Commit
- **D-03:** `.aof/boards/` and `.aof/skills/` are currently untracked. Phase 39 must commit both as part of establishing durable project state. The bridge skill at `.aof/skills/aof-board-milestone-bridge/` is committed as internal-only state; it must NOT be referenced in `.aof/aof.config.json` resources.
- **D-04:** The `.aof/.gitignore` untracked file (from git status) should be reviewed and committed if it protects generated cache files from accidental tracking (e.g., `.aof/cache/`). Include this in the Phase 39 commit.

### Baseline Evidence Format
- **D-05:** Capture CLI output in a single `39-BASELINE-OUTPUT.md` file in the phase directory. Structure it as one section per command, each containing the human-readable output followed by the `--json` output (where supported). This makes both human review and future regression comparison easy.
- **D-06:** Commands to capture: `aof boards list`, `aof boards show coordination`, `aof boards validate`, `aof boards index`, `aof boards doctor` — each in human and JSON forms where the command supports `--json`. Also capture `aof boards milestone status coordination` if that command exists.
- **D-07:** Additionally capture `aof assets validate --dry-run` (or the equivalent validation command) to document that the bridge skill is NOT rendered as output at baseline. This creates the clean-state snapshot that Phase 43's FIX-03 verification references.

### UAT Log Scope And Lifetime
- **D-08:** Create **one milestone-wide UAT log** at `.planning/phases/39-board-dogfood-requirements-and-live-state-baseline/39-UAT-LOG.md`. This is the authoritative finding tracker for all of v1.8.
- **D-09:** Finding IDs use the scheme `UAT-XX` (e.g., `UAT-01`, `UAT-02`). Later phases add findings to this file in-place; they do NOT create separate UAT logs. Phase 43 derives the final UAT REPORT from this log.
- **D-10:** UAT log schema per finding: `ID`, `Phase discovered`, `Command/surface`, `Severity` (critical/high/medium/low), `Summary`, `Repro steps`, `Expected behavior`, `Actual behavior`, `Status` (open/fixed/deferred), `Resolution` (link or description when resolved).

### What Counts As A Finding
- **D-11:** Log a finding when: (a) a command exits non-zero against the valid board, (b) a human-output field contradicts the canonical BOARD.json value, (c) human and `--json` outputs are inconsistent for the same command, (d) output is missing a required next-action hint for a known unhealthy state, or (e) the bridge skill or any internal asset appears in `aof assets validate` rendered output.
- **D-12:** Do NOT log findings for: expected formatting differences between human/JSON (they're different formats by design), commands that don't support `--json` yet (those would be scope creep), or "nice to have" output improvements unrelated to correctness.

### Bridge Skill Leak Baseline
- **D-13:** Phase 39 baseline capture MUST verify the bridge skill is not in the rendered asset list. Run `aof assets validate` (or `aof project validate`) and confirm `.aof/skills/aof-board-milestone-bridge` does not appear as a resource that would be rendered to `.claude/` or `.codex/`. If it does appear, log it immediately as `UAT-01` with severity critical.

### Claude's Discretion
- Exact CLI invocation flags (e.g., `--json` vs `--format json`) — follow what the existing CLI implements.
- Order of command capture in `39-BASELINE-OUTPUT.md` — start with `list`, then `show`, `validate`, `index`, `doctor`.
- Whether to use `node bin/aof.mjs` or a locally installed `aof` binary — use whatever is available in the project.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Board State
- `.aof/boards/coordination/BOARD.json` — The canonical board state file. Baseline output must match values in this file.
- `.aof/boards/coordination/tasks/` — Per-phase task files (phase-39.json through phase-43.json). Already created from v1.7 sync.

### Internal Bridge Skill
- `.aof/skills/aof-board-milestone-bridge/SKILL.md` — Internal GSD injection skill. Must be committed but NOT referenced in `.aof/aof.config.json` resources.

### Phase Requirements
- `.planning/REQUIREMENTS.md` — v1.8 requirements. Phase 39 covers BOARD-01, CLI-01, CLI-02, CLI-03, CLI-04, FIX-01.

### Phase Roadmap
- `.planning/ROADMAP.md` — Phase 39 success criteria and milestone context.

### Board Implementation
- `src/boards.mjs` — Board lifecycle functions: `listBoards`, `getBoard`, `validateBoards`, `doctorBoards`, `writeBoardIndex`.
- `src/cli.mjs` — Board command handlers: `boardsListCommand`, `boardsShowCommand`, `boardsValidateCommand`, `boardsDoctorCommand`, `boardsIndexCommand`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `aof boards list` already supports `--json` — use it for baseline JSON capture.
- `aof boards show <id>` supports `--json` — captures full board state as JSON.
- `aof boards validate` — validates all boards; use for bridge skill leak check (D-13).
- `aof boards doctor` — added in Phase 38; captures toolchain health. Key output for baseline.
- `aof boards index` — writes `.aof/cache/boards/index.json`; baseline should verify this succeeds.
- `src/boards.mjs` exports `BoardLifecycleError` with stable codes — look for these in JSON output.

### Established Patterns
- Board commands emit `{ ok: true/false, ... }` structured JSON for `--json` flag.
- Doctor output follows `PASS/WARN/FAIL code message` ladder with `next:` hints.
- UAT log pattern: v1.4 has `.planning/phases/22-live-repository-verification/22-UAT-LOG.md` as prior art for structure.

### Integration Points
- Phase 39 does NOT modify `src/boards.mjs` or `src/cli.mjs`. This phase is observation-only.
- Baseline evidence file goes in `.planning/phases/39-*/` — not in production source.
- UAT log lives in `.planning/phases/39-*/` but is updated by Phases 40-43.
- Git commit of `.aof/boards/` and `.aof/skills/` is the only production change in Phase 39.

</code_context>

<specifics>
## Specific Ideas

- Use the v1.4 UAT log at `.planning/phases/22-live-repository-verification/22-UAT-LOG.md` as the format template for the v1.8 UAT log. It has the right columns and finding structure.
- The `coordination` board already has a complete baseline: `status: "synced"`, milestone id `v1.8`, 5 phase tasks. The baseline output file should document this as the expected clean state.
- The `.aof/.gitignore` untracked file likely guards `.aof/cache/` from being committed. Verify and include it in the Phase 39 commit.

</specifics>

<deferred>
## Deferred Ideas

- Idempotent re-attach and re-sync testing — Phase 40 scope.
- Board UI dogfood — Phase 41 scope.
- Agent assignment and execution UAT — Phase 42 scope.
- Broad UAT fix implementation — Phase 43 scope.
- Any new board command functionality surfaced during baseline review — log as finding first; fix in Phase 43.

</deferred>

---

*Phase: 39-Board-Dogfood-Requirements-And-Live-State-Baseline*
*Context gathered: 2026-05-18*
