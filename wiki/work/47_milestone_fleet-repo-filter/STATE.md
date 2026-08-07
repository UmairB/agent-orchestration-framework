---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 47 · /fleet with a repo filter — State

## Progress

**Framed 2026-08-02** (`aof:shatter wiki/planning/PRD-web-ui-restructure.md`). Not broken down.

- [ ] stories — to be broken down (`aof:refine 47`)

## Notes & decisions in flight

- **The earliest visible win of the arc** — depends only on 45, and on nothing else. Schedule it in
  parallel with 46/48 rather than behind them.
- **Open at framing:** whether `?scope=global|local` survives the repo filter. PRD recommendation is
  keep both initially (scope is a live deep-link contract), revisit after soak. Settle at refine and
  record the decision.
- **Inherited from m45 (recorded here so this milestone's refine meets it — m45/STATE F-45-04-1,
  routed 2026-08-07):** two connected fleet-surface defects this milestone owns as the surface's new
  owner. **(a)** `Fleet.tsx`'s local-board "Open board →" drill-in dead-ends: its href is RELATIVE
  (`/board` after m45), so on the fleet origin it resolves to `:4181`, which deliberately 404s
  `/api/work` — the board page loads but cannot load its stream. Likely fix: resolve through
  `GET /api/mesh/board-url` (the route the peer-board branch and `Fleet.tsx:528`'s live drill-in
  already use). **(b)** That link is currently UNREACHABLE anyway (m45 QA F-45-04-QA-3): since
  m34/ADR-006 the fleet face's `/api/mesh/status` payload carries no `boards` key, so `BoardsRegion`
  always renders its empty placeholder — the producer that computes the aggregate
  (`mesh:status --json`) is not the one the face serves. Fixing (b) without (a) ships a visible
  broken link; fix them together or sequence (a) first.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
