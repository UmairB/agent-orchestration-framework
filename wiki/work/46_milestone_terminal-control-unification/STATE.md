---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 46 · One terminal control — State

## Progress

**Framed 2026-08-02** (`aof:shatter wiki/planning/PRD-web-ui-restructure.md`). Not broken down.

- [ ] stories — to be broken down (`aof:refine 46`)

## Notes & decisions in flight

- **The PRD's "two-and-a-half implementations" is stale** (measured 2026-08-02). m42 item 6 (`54f6bbf`)
  already collapsed the bolt-on widget — the dock is one component with a local lane and a `remote`
  mirror lane, already carrying the fit-vs-scale split and input on both lanes. Two implementations
  remain (dock + `FleetTerminalView`), and the dock is already close to the target design. The
  extraction is smaller than the PRD implies.
- **Watch the arch-test coupling.**
  [acd-fleet-terminal-input-constrained.test.mjs](../../../test/arch/acd-fleet-terminal-input-constrained.test.mjs)
  does source-analysis over *named* files. Moving the dock will move what it inspects — update its file
  list, never its invariants. Invariant 4 (fleet page wires no input) must still hold when this
  milestone accepts; reversing it belongs to 49.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
