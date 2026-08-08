---
type: story
number: 02
slug: static-serve-history-fallback
title: "A refreshed path renders instead of 404ing — one static-serving leaf, one traversal guard, and a fallback that never masks a missing asset"
parent: 45
status: done
owner: product-owner
created: 2026-08-06
updated: 2026-08-07
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 02 · A refreshed path renders — one static-serving leaf for both origins

## User story

As the operator who reloads the page or opens a deep link,
I want the address I am on to still be there after a refresh,
so that a URL is something I can share and come back to, rather than something that only works if I
never touch the address bar.

And, as the person who has to trust this thing: I want a deploy that is missing a JavaScript file to
**say so**. Today the fleet origin answers every missing file with the HTML page, so a broken build
arrives as a blank screen and a console error a hundred lines from its cause.

## Tasks

<!-- The tasks that satisfy this story, each a tasks/NN_<slug>.feature whose scenarios are the
     acceptance criteria. A task is done when its @executable feature is green. Keep tasks
     independent of OTHER stories' tasks; sequential within this story is fine. -->

- [x] `tasks/00_one-traversal-guard.feature` — `safeStaticPath` is defined once, imported by both
      servers, and still refuses every traversal attempt on both origins
- [x] `tasks/01_history-fallback.feature` — an extension-less path serves the app shell on the board
      and config-editor origins, and `/api/*` is never swallowed by it
- [x] `tasks/02_missing-asset-still-404s.feature` — a request for a file that does not exist returns
      404 on **both** origins, including the fleet origin whose fallback is unconditional today

## Notes

**Order.** Parallel-eligible from day one alongside `45/01`. It touches no `ui/` file at all, and it
ships value on its own: `/board` stops 404ing on refresh before any router exists.

**One handler, two origins.** [board-serve.mjs:20](../../../../../src/board-serve.mjs#L20) delegates
to `serveSetupUi`, so the single fix in `src/setup-ui.mjs` reaches the board **and** the config
editor. Graph-cited coupling (built 2026-08-06, 15,644 nodes / 21,352 edges):
`board-serve.mjs ← commands/work-ui.mjs` and `mesh-ui-serve.mjs ← commands/mesh-ui.mjs` — one
command-layer entry each, no shared dependent, which is what makes this story safe to run alone.

**This story tightens a live behaviour, it does not only add one.**
[mesh-ui-serve.mjs:563-567](../../../../../src/mesh-ui-serve.mjs#L563-L567) falls back to
`index.html` **unconditionally** today. ADR-004 puts both origins behind the same predicate, so this
is a deliberate narrowing of existing fleet behaviour. Any existing test that asserts the old
unconditional fallback is a test to update **with a stated reason**, never one to route around.

**The security finding that rides with it.** `safeStaticPath` — the directory-traversal guard in
front of both static roots — is defined **twice, byte-identically**
([setup-ui.mjs:269-280](../../../../../src/setup-ui.mjs#L269-L280) and
[mesh-ui-serve.mjs:873-884](../../../../../src/mesh-ui-serve.mjs#L873-L884); `diff` exits 0).
Hardening one copy leaves the other origin unprotected and nothing would say so. It folds into
`src/static-serve.mjs` beside the fallback predicate — a deletion plus an import at each of the two
sites this story already edits. **Required** of this story, not optional tidying.

Governing ADR: **004**. Fitness function: `test/arch/acd-spa-fallback-never-masks.test.mjs`.
