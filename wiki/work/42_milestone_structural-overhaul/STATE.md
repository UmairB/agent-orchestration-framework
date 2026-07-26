---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 42 · Structural overhaul — one home, one door, no silence — State

## Progress

- Framed 2026-07-26 from TECH_DEBT.md items 0–7 (operator direction: rewrite-to-a-designed-shape
  over further adhoc fixes). Stories not yet broken down — next: `aof:refine 42`.

## Notes & decisions in flight

- 2026-07-26 (pre-refine): debt item 6's doc/run legs were paid down ahead of the milestone —
  projection schema v5 (`work_item_docs`/`work_item_runs`), the worker's `worktree-content` frame,
  and the `work:doc`/`work:run-status` projection fallback. Unit-verified only; live two-machine
  verification pending (needs deploy + operator restarts). The board's embedded console leg remains
  for wave (b). Refine should fold this into the wave-(b) story rather than re-planning it.

- Sequencing is load-bearing, not stylistic: wave (a) (logs, no-silent-catch, green gate) is the
  verification substrate — without it, no later rewrite's success is observable. Do not reorder.
- The soak stays up throughout; any stage that would require stopping both nodes needs a re-think
  before it needs a schedule.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
