---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Canonical status lives on SPEC.md / each STORY.md.
  COMPACTED at Accept (2026-06-20): the blow-by-blow build log is archived; durable decisions live in
  ARCHITECTURE.md (ADRs); findings + accept live in VERIFICATION.md; lessons live in RETROSPECTIVE.md.
-->
# 04 · Round-trip Proof — State

## Status: DONE (accepted 2026-06-20)

All three stories `done`; milestone `done`; `aof work next 04` → "everything is done". The round-trip
proved the loop composes: `aof work init` + the bundled ACD actors drive a milestone refine → continue →
verify to `done`.

- `00_story_roundtrip-harness` — the frozen harness (`test/support/roundtrip-harness.mjs`) + 3 fitness
  functions + `acd-roundtrip-registration` no-drift meta-test.
- `01_story_install-proof` — `@executable` cold-install proof (`test/roundtrip-install-proof.test.mjs`, 13 cases).
- `02_story_loop-proof` — `@executable` spine (`test/roundtrip-loop-proof.test.mjs`, 21 cases) + the one
  `@uat` round-trip sign-off, driven in a **real adopting repo** and signed **ACCEPT** ([UAT.md](UAT.md)).

## Where the durable record lives (pointers, not restatements)

- **Design decisions →** [ARCHITECTURE.md](ARCHITECTURE.md) ADR-001…005 + the fitness-function table.
- **Evidence, findings, accept →** [VERIFICATION.md](VERIFICATION.md). Two non-blocking findings, routed
  per ADR-004: **F-01 → milestone 06** (RED-until-built fitness functions reding the shared suite);
  **F-02 → milestone 01** (`aof work init` writes no `.gitignore` baseline — PO decision: self-contained
  nested `.gitignore` under `.aof/`, possibly `.claude/`).
- **Lessons →** [RETROSPECTIVE.md](RETROSPECTIVE.md) R1–R4.

## Durable build decisions (not ADRs — preserved here for the next milestone)

- **Arch-test registration is keyed by test file, not ADR prose** (story 00 / task 03): a meta arch-test
  asserts each `acd-roundtrip-*.test.mjs`'s exported arch-tests are in the runner's assembled `tests` set
  (which `scripts/test.mjs` exports), wired into both `scripts/test.mjs` and `scripts/test-unit.mjs`.
- **Defect / blocked states are test-side fixture perturbations, not harness API** (story 02): the frozen
  `seedSampleMilestone` seeds the clean base; loop-proof tests apply validate-defect rows and the `next`
  blocked row as fixture edits, and **scope** `next` to the held milestone. The frozen 3-export harness
  contract (ADR-005) is never widened.

<!-- ARCHIVED at compaction: the day-by-day build/review blow-by-blow (refine → build → review, all three
     lenses PASS, suites green) and the `## Feedback (for retro)` running notes. The feedback graduated
     into RETROSPECTIVE.md R1–R4; the narrative's durable residue is the pointers above. -->
