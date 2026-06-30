---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 28 · Cross-Platform Console App — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (Phase 4 — install anywhere). Stories to be broken down — `aof:refine 28`.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- Mechanically **independent** of the mesh internals — it bundles whatever the build contains. Its one
  hard edge is the `relay` mode (milestone 23) the "one binary, two modes" deliverable must package; PRD
  §8 still sequences it last so the *shipped* binary carries the full mesh. Parallel-eligible once 23 lands.
- Open for refine: SEA vs `pkg` bundling; the per-OS signing / notarization path; the one-line installer;
  and how `node` / `relay` modes are selected from the single binary.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `VERIFICATION.md`
