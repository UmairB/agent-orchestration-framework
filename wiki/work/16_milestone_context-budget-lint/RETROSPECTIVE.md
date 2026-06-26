---
doc: retrospective
updated: 2026-06-25
---
<!--
  Milestone RETROSPECTIVE.md — the distilled lessons from how execution actually went.
  One R<n> per lesson; APPEND, never renumber. Reference findings/ADRs/commits, never restate.
  Source: STATE ## Feedback (for retro) + VERIFICATION ## Findings + blocker stops.
  Clean findings with no process lesson stay in VERIFICATION — they are NOT retro entries.
-->
# 16 · Context-Budget Lint — Retrospective

## R1 — Calibrating a default threshold against "the repo's real artifacts" must enumerate the WHOLE corpus, not a sampled subset

- **Kind:** near-miss · **Area:** process (calibration) · **Stage:** refine (default set in ADR-005) → caught at build/verify · **Owner:** architect · **Raised by:** developer (build) + verify (F1)
- **What happened.** ADR-005 set the ARCHITECTURE.md default budget to **700** on the stated basis that
  "the largest healthy ADR log in-repo is m13 at 631 lines," and STATE's documented-default note claimed
  running `aof work doctor` over this repo "yields ZERO `doc-over-budget` findings." Both rested on a
  survey that **under-counted**: `02_milestone_planning-init/ARCHITECTURE.md` is **725 lines** — so the
  moment the group was wired into the live registry, `aof work doctor` over this repo surfaced exactly one
  real finding (725 > 700 for m02). The build did **not** silently retune the default to bury it.
- **Why.** The calibration survey looked at a subset of ARCHITECTURE.md files (the recent/large milestones)
  rather than enumerating every artifact of the kind being budgeted, so the "max healthy length" anchor and
  the "zero findings" claim were derived from incomplete data.
- **Lesson.** When you calibrate a threshold against "the real, healthy artifacts of kind X in this repo,"
  enumerate the **entire** corpus of kind X (`grep -c` every `ARCHITECTURE.md`), not a hand-picked subset —
  the max you anchor on is only as honest as the set you measured. And the right reflex when the live check
  then fires is what happened here: **flag, don't silently retune** — a `warn` on the single longest doc is
  honest signal, and whether 725 (m02) is genuine bloat to trim or the default should move to ~750 is a
  product decision, not a calibration cover-up. The behavioural/fitness tests run over temp fixtures and are
  unaffected either way, so the open decision blocks nothing.
- **Refs:** ADR-005 (the 700 default + calibration narrative); VERIFICATION `@finding-F1`; STATE §Feedback
  "Calibration miss in ADR-005 / STATE defaults"; live `aof work doctor` over m02's `ARCHITECTURE.md`.

  <!-- Open follow-up (carried, not a contract change): decide trim-m02 vs raise-architecture-default-to-750.
       Belongs to a future refine/backlog entry, not this milestone. -->
