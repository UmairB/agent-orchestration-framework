---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 26 · Distributed Runs + Leasing — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (Phase 2 — fleet-safe execution). Stories to be broken down — `aof:refine 26`.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- This is the PRD's **primary spike (A2)**: the relay-grant vs git-commit ordering protocol that makes
  leasing race-safe (KR2) while keeping correctness independent of the relay. Blocked until milestone 19
  (run records), 20 (restart-scan reclaim + `next`), and 23 (the relay fast-path) are in.
- Open for refine: the lease-of-record file format + the relay-grant→git-commit sequence; how `runs/`
  partitions by node so merges stay add-only; how `aof work next` becomes mesh-aware (lease check); and
  how milestone 20's restart-time backstop scan generalises to a **fleet** orphan scan over stale peers.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `VERIFICATION.md`
