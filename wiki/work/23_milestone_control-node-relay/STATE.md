---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 23 · Control Node + Thin Relay — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (the live-substrate chunk — Phase 1). Stories to be broken down — `aof:refine 23`.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- The relay is a **cache/accelerator, never a system of record** — the hard invariant to defend in the
  ADR: every signal it carries has a durable git counterpart, so killing it loses liveness, not data.
  Blocked until milestone 22 (node identity + git-sync substrate) and milestone 20 (the single-node
  heartbeat + stale-detection this presence extends to the fleet).
- Open for refine: the relay's transport + wire envelope; the control-node nomination / re-nomination
  protocol; how presence extends milestone 20's single-node heartbeat + stale-detection into a fleet
  signal over the relay (the genuine `23 → 20` seam); the staleness threshold; and the relay-liveness
  spike on a 3-node fleet (validates the ≤ 5 s / ≤ 30 s bound of KR1 + PRD A1/A5).

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `VERIFICATION.md`
