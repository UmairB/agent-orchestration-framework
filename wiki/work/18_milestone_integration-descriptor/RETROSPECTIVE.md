---
doc: retrospective
updated: 2026-06-27
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; APPEND, never renumber. Reference findings/ADRs/commits, never restate.
  Source: STATE ## Feedback (for retro) + VERIFICATION ## Findings + blocker stops.
  Clean findings with no process lesson stay in VERIFICATION — they are NOT retro entries.
-->
# 18 · Per-folder integration descriptor — Retrospective

> Fresh log for the **re-framed** milestone 18 (`integration-descriptor`). The prior
> `notion-parent-grouping` build's R1–R4 are out-of-tree (superseded with that design); its R4
> "extending the shared `parseFrontmatter` is a blast-radius hazard" was a load-bearing **input** to this
> milestone's discrete-JSON-file + parser-revert design (SPEC §Supersedes), not a carried entry.

## R1 — When an ADR supersedes a *mechanism*, the rewrite must sweep the old mechanism's vocabulary out of registration/import-site comments — they are covered by neither behavioural tests nor arch-tests

- **Kind:** defect (doc drift) · **Area:** process (rewrite hygiene) · **Stage:** build → caught at build Review · **Owner:** developer · **Raised by:** structural review (operator) + QA craft (C4)
- **What happened.** ADR-003/004 replaced the superseded `notion.parent`-in-`SPEC.md`-frontmatter mechanism
  with the `.integrations.json` descriptor, but two doc-comments kept describing the dead mechanism:
  `command-core.mjs:63-67` still read "Records a milestone PHASE parent in its committed SPEC.md frontmatter,"
  and `notion-sync-work.mjs` carried a "story-00 stub" comment. The shipped `associate` writes
  `.integrations.json`, never frontmatter — so the comments actively misdescribed the code.
- **Why.** A mechanism rewrite changes code that the green `@executable` suite and the fitness arch-tests both
  exercise — but **comments are not assertions**. Nothing in the test corpus reads a doc-comment, so stale
  mechanism vocabulary survives a fully-green rewrite invisibly.
- **Lesson.** When an ADR supersedes a *mechanism* (not just an implementation), `grep` the codebase for the
  **old mechanism's vocabulary** (here: `frontmatter`, `SPEC.md`, `parent key`, `stub`) across registration
  and import sites, and refresh those comments **as part of the rewrite** — not as a follow-up. A rewrite is
  not done when the tests are green; it is done when nothing left in the tree still speaks the dead mechanism.
- **Refs:** ADR-003/004; VERIFICATION `@finding-M18-S1`; `command-core.mjs`, `notion-sync-work.mjs`.

## R2 — An opt-in gate that only rules out an *absent* config block needs a sibling check for a *present-but-shapeless* one; a green `@executable` suite that exercises only valid configs leaves the error path unguarded

- **Kind:** defect (robustness) · **Area:** code (fail-honestly) · **Stage:** build → caught at build Review (craft) · **Owner:** developer · **Raised by:** developer (craft review)
- **What happened.** `notion-sync-work` correctly short-circuits when the `work.integrations.notion` block is
  **absent** (the opt-in no-op). But a *present-but-shapeless* block — a hand-edited `boards` registry with no
  `default` — made `resolveNotionRouting` return `{ board: undefined }`, and the next line dereferenced
  `routing.board.dataSourceId` and crashed with a raw `TypeError`. The `@executable` features only ever build
  **valid** configs, so this entire failure path was invisible to a green suite.
- **Why.** Two blind spots compounded: (1) an absence-check and a shapelessness-check are *different* guards —
  ruling out `null` does not rule out "present but resolves to nothing"; (2) behavioural acceptance scenarios
  authored from the happy contract don't fabricate malformed config, so the honest-error path had no scenario
  and no test.
- **Lesson.** For any opt-in gate, pair the *absent-block* check with a *present-but-shapeless* sibling that
  fails **honestly** — a named command error (here `no-board-resolved`, 17/ADR-004), never a raw `TypeError`
  on the next deref. And treat "the green suite only feeds valid input" as a standing coverage smell: the
  malformed-but-present config is the case the contract scenarios won't write for you. (Carried as
  VERIFICATION `@finding-M18-Q`: the `no-board-resolved` path is fixed in src but still has no regression
  test — land one in the deferred hardening pass.)
- **Refs:** VERIFICATION `@finding-M18-C1` (+ M18-Q); `notion-sync-work.mjs:170-177`; `routing.mjs` resolver.
