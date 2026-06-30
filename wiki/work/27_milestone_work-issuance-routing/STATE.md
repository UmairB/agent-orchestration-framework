---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 27 · Cross-Machine Issuance & Routing — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (Phase 3 — issuance & routing). Stories to be broken down — `aof:refine 27`.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- The capstone of the functional mesh: work issued / assigned on one node, claimed and run on another
  with no manual file shuffling (KR3). Blocked until milestone 25 (the fleet view to issue from) and 26
  (the lease path that picks issued work up without double-running) are in.
- Open for refine: the `aof mesh issue <ref> [--to <node|cap>]` contract; capability-targeting against
  the node-identity descriptor from milestone 22; the board-level issue/assign affordance on `aof mesh
  ui`; and how an issued run threads the 19–21 durable/resumable run record fleet-wide.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `VERIFICATION.md`
