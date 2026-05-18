# Pitfalls Research: v1.8 AOF Boards Dogfood UAT

**Domain:** Live dogfood of AOF's GSD-backed boards on AOF itself
**Researched:** 2026-05-18
**Confidence:** HIGH

## Critical Pitfalls

### 1. Treating fixture coverage as live UAT

Existing board tests cover many paths, but the milestone exists because fixture success is not enough. A live board in the AOF repo can expose command wording, stale state, UI clarity, Windows path behavior, and workflow timing issues.

**Prevention:** Require a UAT log with actual commands/API/UI steps and outcomes against `.aof/boards/coordination`.

### 2. Syncing before roadmap attachment

The live board currently has `pending-attachment` binding and no roadmap path. Running sync before roadmap approval should fail clearly.

**Prevention:** Roadmap phase order must put requirements/roadmap approval before board attach/sync. Requirements should explicitly test the failure message before attach and success after attach.

### 3. Losing milestone identity

v1.7 fixed implicit roadmap sync. v1.8 must not regress by letting `coordination` sync against stale v1.7 state, a normalized `v1-8`/`v1.8` mismatch, or the wrong roadmap.

**Prevention:** Test attach/sync/doctor with explicit `--milestone v1.8`; verify JSON output includes expected/actual details on mismatch.

### 4. Internal bridge skill leaking as a user asset

The roadmapper bridge skill exists under `.aof/skills/aof-board-milestone-bridge`, but project memory says it must stay out of `.aof/aof.config.json` resources so AOF apply/install does not render it into runtime assets.

**Prevention:** Validate config resources remain empty or intentional; add regression coverage if leakage is observed.

### 5. UI and CLI disagreeing

The setup UI has board routes and a board mode frontend. The canonical source is JSON under `.aof/boards`, so any UI-only state or stale index assumptions would damage trust.

**Prevention:** Cross-check CLI output, UI API payloads, and canonical files after each important operation.

### 6. Assignment runs too much work

Assigning a phase task can call SDK `runPhase()`. On a real repo this may execute significant planning or code work.

**Prevention:** Use a bounded/safe phase for live assignment. If a real run is too risky, verify assignment wiring with a controlled execution update and record why full run was deferred.

### 7. UAT findings becoming vague backlog notes

The user selected "fix findings". If findings are only logged, the milestone fails its own purpose.

**Prevention:** Each finding needs an ID, repro, severity, resolution decision, code/test link, and verification result.

### 8. Dirty worktree confusion

The repo already has uncommitted board-related code and planning state. New milestone artifacts must not revert unrelated changes or hide ownership.

**Prevention:** Keep commits scoped. Before each commit, stage only intended files and verify with `git diff --cached --name-only`.

## Warning Signs

- `aof boards sync coordination` succeeds without `--milestone`.
- `aof boards doctor coordination` reports healthy before attachment.
- UI shows a task count different from `aof boards show coordination`.
- Board JSON points at v1.7 after v1.8 roadmap creation.
- UAT log lists failures without linked fixes or explicit deferrals.
- AOF apply renders `aof-board-milestone-bridge` into `.codex/skills` or `.claude/skills`.

## Phase-Level Prevention

| Risk | Phase should handle |
|------|---------------------|
| Premature sync or wrong milestone | Board Attachment And Sync UAT |
| UI/CLI disagreement | Boards UI Dogfood |
| Unsafe assignment | Assignment And Execution UAT |
| Findings without fixes | UAT Findings And Hardening |
| Weak closeout evidence | Verification And Milestone Closeout |

## Sources

- Current dirty worktree status
- `.aof/boards/coordination/BOARD.json`
- `src/boards.mjs`
- `src/board-execution.mjs`
- `src/setup-ui.mjs`
- `ui/src/main.tsx`
- `.planning/STATE.md` memory

---
*Pitfalls research completed: 2026-05-18*
