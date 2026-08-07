---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 49 · The terminals home — State

## Progress

**Framed 2026-08-02** (`aof:shatter wiki/planning/PRD-web-ui-restructure.md`). Not broken down.

- [ ] stories — to be broken down (`aof:refine 49`)

## Notes & decisions in flight

- **Merged at shatter** (operator decision, 2026-08-02): the PRD's separate `interactive-terminals`
  milestone is folded in. Its premise — that typing into a terminal reverses a test-enforced invariant —
  was measured false on 2026-08-02: m42 item 6 already shipped the input path and rewrote the arch-test
  from *no sink exists* to *the sink is tuple-bound, content-blind, byte-bounded and session-exact*.
  Extending a proven pattern to a second surface does not warrant its own milestone, and read-only-first
  would have been a needless two-step.
- **The one real deliberate act that survives** is amending invariant 4 of
  `acd-fleet-terminal-input-constrained` ("THE FLEET PAGE STAYS A MONITOR"). Rewrite it; never delete it,
  never let it fail silently. Give it its own story boundary at refine.
- **Open at framing:** grid versus list-plus-focus at scale. PRD recommendation — build the grid, but
  make the live-socket count an explicit bounded number rather than an emergent one. Settle at refine.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
