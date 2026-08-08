---
type: story
number: 03
slug: app-shell-and-entry
title: "The three pages become one application — a thin entry, a shell with named regions, and navigation that has never existed"
parent: 45
status: done
owner: product-owner
created: 2026-08-06
updated: 2026-08-08
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 03 · Three pages become one application — the shell and the entry rewrite

## User story

As the operator moving between the fleet, a board and my configuration,
I want the three surfaces to know about each other — one frame, one place to click, one address bar
that tells me where I am,
so that getting from "what is my fleet doing" to "open that board" stops being an act of URL
archaeology.

The honesty test the milestone sets itself applies squarely here: an outsider should not be able to
tell what changed except that the address bar now means something and the pages know about each
other. Every surface renders exactly what it renders today, inside the frame.

## Tasks

<!-- The tasks that satisfy this story, each a tasks/NN_<slug>.feature whose scenarios are the
     acceptance criteria. A task is done when its @executable feature is green. Keep tasks
     independent of OTHER stories' tasks; sequential within this story is fine. -->

- [x] `tasks/00_entry-selects-a-surface.feature` — the entry mounts, applies the legacy redirect and
      selects a surface; it defines none itself
- [x] `tasks/01_shell-regions.feature` — the five named regions in order, the chrome budget, and the
      surface owning scroll inside a bounded content box
- [x] `tasks/02_navigation.feature` — real links between the four surfaces, the active one marked
      without relying on colour, deep-link parameters preserved across a move
- [x] `tasks/03_unmatched-path-and-fullscreen.feature` — an unknown path renders the 404 surface
      *inside* the shell; fullscreen is one shell-owned slot and is not a route
- [ ] `tasks/04_app-shell-visual-review.feature` — a person judges the shell against the mock at four
      viewports on every route

## Notes

**Order.** Depends on `45/01` (the route table). `45/04` depends on this one — pointing an advertised
URL at a path the entry cannot yet serve is a regression, so the URL migration lands after this.

**This story carries the `main.tsx` split** (ARCHITECTURE health finding 1, **required**).
`ui/src/main.tsx` is 1,267 lines and is *both* the application entry and the config-editor surface —
the render root is the last six lines of a file whose other 1,260 lines are `<App>`. With a router
that stops being untidy and becomes structurally wrong: the entry must select a surface and cannot
credibly do so from inside one. `<App>` moves to `ui/src/config/App.tsx`; `main.tsx` becomes mount +
`legacyRedirectFor` + render the shell. This is a **move, not a re-skin** — SPEC's "re-skinning the
config editor is out of scope" is honoured exactly, and `acd-ui-single-route-table` is the ratchet
that keeps the entry surface-free.

**The shell lands in `ui/src/app/`** beside the route module — neither surface's folder. This
part-pays TECH_DEBT 18a by establishing the shared layer; it explicitly does **not** migrate the
seven existing `fleet → board` imports, which is 18a's own fix and would be a scope explosion here.

**The regions are DESIGN.md's, not this story's to invent** — R1 notice rail, R2 top bar (48px),
R3 surface bar (conditional, ≤768px), R4 content (the one `<main>`, the mount point), R5 overlay.
Total chrome is capped at **88px** because the desktop app's window is 760×520, which must leave
≥432px of content.

**Two design gaps this story closes** (DESIGN.md): **DG-45-1** — the fleet and board paint *different*
brand marks in the same bar position ([Fleet.tsx:283-285](../../../../../ui/src/fleet/Fleet.tsx#L283-L285)
vs [Board.tsx:425-427](../../../../../ui/src/board/Board.tsx#L425-L427)); the shell paints one.
**DG-45-2** — `z-50` currently means three unrelated things; the shell owns a named ladder and `z-50`
becomes fullscreen alone.

**The scope control stays inside `<Fleet>`** — the shell owns the *bar*, not scope semantics, and
fills a right-anchored surface slot. `?scope=` is a fleet contract end-to-end and would be inert on
three of four routes. Consequence accepted: the top bar is deliberately non-uniform right of the
slot, bounded by two rules — everything left of the slot is byte-identical on every route, and the
slot can never push the nav.

**The mock is pending.** `mocks/app-shell.png` is named as the conformance source of truth and the
operator is supplying it; DESIGN.md's binding checklist is the interim baseline and the mock
supersedes it wherever the two differ. The `@uat` task below is judged against whichever is current
at review time — and if the mock lands showing a **dark** shell, that is outside this milestone's
ramp and comes back as its own design gap with its own token work, not as a silent re-skin.

Governing ADRs: **002** (the four paths, unknown path renders in-shell), **005** (the three named
regions, bounded content box, one fullscreen mechanism).
