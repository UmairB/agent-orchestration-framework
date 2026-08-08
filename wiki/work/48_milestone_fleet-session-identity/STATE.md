---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 48 · Routable session identity — State

## Progress

**Framed 2026-08-02** (`aof:shatter wiki/planning/PRD-web-ui-restructure.md`). Not broken down.

- [ ] stories — to be broken down (`aof:refine 48`)

## Notes & decisions in flight

- **This is the arc's real critical path, not the terminal work.** It carries no dependency and no UI,
  so it is parallel-eligible immediately — but 49 and 50 both wait on it. Starting it late serialises
  the home screen behind it.
- **Precedent to follow:** `sessions[]` on the presence record was itself an additive growth (m38 story
  00, ADR-001/002) — five keys, `sessions` inserted before `aofVersion`, `[]` never omitted. Grow it the
  same way rather than inventing a new wire convention.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
