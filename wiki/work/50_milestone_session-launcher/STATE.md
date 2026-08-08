---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 50 · Session launcher — State

## Progress

**Framed 2026-08-02** (`aof:shatter wiki/planning/PRD-web-ui-restructure.md`). Not broken down.

- [ ] stories — to be broken down (`aof:refine 50`)

## Notes & decisions in flight

- **The allowlist edit is the risk, not the PTY spawn.** Two fitness functions pin the fleet face's
  write surface to exactly `/api/mesh/assign`. This milestone must add a *named* entry to both and keep
  the bound a bound — never loosen either to a pattern. Treat that edit as its own reviewable story.
- **The PRD's `depends` for this milestone was `fleet-session-identity` + `interactive-terminals`.**
  With interactivity merged into 49 at shatter, that becomes `[48, 49]` — same gate, one fewer driver.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
