---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 25 · Mesh UI — State

## Progress

<!-- Story-by-story, mirroring the SPEC Stories list. The source of truth for each story's status
     is its own STORY.md frontmatter; this is the at-a-glance roll-up. -->

- Framed `2026-06-29` by `aof:shatter` from
  [PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md)
  (the fleet-surface chunk — Phase 1). Stories to be broken down — `aof:refine 25`.

## Notes & decisions in flight

<!-- Surprises, corrections, mid-build discoveries. Decisions that prove durable graduate to ADRs at
     Accept — don't leave them only here. Strike-through corrected assumptions to keep history honest. -->

- The **`aof work board` → `aof work ui` rename** is a deliberate ACD change to milestone 03's registered
  command + its frozen-envelope fitness functions — **not a drive-by edit** (PRD §8). It must land after
  milestone 21's run-observability extension to the same board (hence `depends: 21`), so the rename
  carries 21 forward rather than forking the surface.
- Open for refine: how the rename touches the milestone-03 envelope while keeping its fitness functions +
  the milestone-08 bijection / no-UI-core-import guards green; the `aof mesh ui` layout (nodes + boards,
  drill-in) and the registered commands it reads (group registry from 24, presence from 23); whether the
  fleet view is its own face or an extension of the work UI.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `VERIFICATION.md`
