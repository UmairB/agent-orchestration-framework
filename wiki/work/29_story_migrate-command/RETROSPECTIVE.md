---
doc: retrospective
story: 29
updated: 2026-06-30
---
<!--
  Story RETROSPECTIVE.md — the distilled, carryable lessons from how story 29 actually ran.
  One R<n> per lesson; append-only (never renumber). Reference, never restate (the detail
  lives in STORY ## Resolved decisions / ## Deferred follow-ups and VERIFICATION ## Findings).
  Written by aof:retrospective at the close of aof:verify 29. The run was otherwise clean —
  first-pass green @executable + both @manual lanes CONFORMS on the first try, no blocker
  stops, no rework — so this records the single carryable reference lesson only.
-->
# 29 · Migrate Command — Retrospective

## R1 — Dogfood a recovery-reusing command on a README-less / non-standard-layout real repo
- **Kind:** reference · **Area:** process · **Stage:** verify · **Owner:** verify lane · **Raised by:** aof:verify 29 (architect @manual judgement)
- **What happened.** migrate reuses import's arbitrary-source recovery (`recoverArbitraryIntent` /
  `recoverArbitraryDecisions`, `src/import/recovery.mjs`). Verifying on two REAL repos exposed that the
  coverage is **README + `docs/adr`-centric**: `feynman-diagrams` (a 686-commit repo with a real PRD at
  `docs/feynman-explorer-prd.md` and architecture prose at `.planning/research/ARCHITECTURE.md`, but **no
  README**) recovered `intent=null` and `0 decisions` — honest "_Not recoverable_" markers, never
  fabrication, but coarser than the source actually warranted.
- **Why.** Fixture-based `@executable` rows all shape their sources README-first / `docs/adr`-first, so the
  coverage edge (PRD-as-intent, `.planning/**`-as-decisions) only shows on a real foreign-tool layout. The
  contract held throughout — task 03's rule "what is absent is *marked* not recoverable, never invented" —
  so this is a coverage enhancement, not a correctness defect.
- **Lesson.** When verifying any command that reuses the recovery engine, run the `@manual` lane on at least
  one **README-less, non-aof-layout** real repo — that is where recovery's arbitrary-source coverage gaps
  surface. The two coverage extensions (PRD/`.planning`-as-intent; `.planning/**` + `ARCHITECTURE.md`-by-name
  as decisions) are filed for a shared-recovery refinement. **Refs:** VERIFICATION ## Findings F29-1/F29-2;
  STORY ## Deferred follow-ups; `src/import/recovery.mjs`.
