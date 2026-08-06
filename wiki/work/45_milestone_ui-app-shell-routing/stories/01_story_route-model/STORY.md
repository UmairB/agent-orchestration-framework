---
type: story
number: 01
slug: route-model
title: "The route model — one pure, framework-free table that says what a URL means, and what every legacy URL becomes"
parent: 45
status: in-review
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
# 01 · The route model — one pure table that says what a URL means

## User story

As the operator who lives in this UI,
I want every address the product has ever handed me — the ones in my bookmarks, the ones the CLI
printed, the one the desktop tray opens — to have exactly one stated meaning,
so that no URL I already hold quietly stops working, and no surface added later has to guess where
it lives.

The benefit is challengeable and it is not "a router exists". Today the meaning of a URL is six lines
of ternary at [main.tsx:1261](../../../../../ui/src/main.tsx#L1261) that no test can reach, and the
answer to "what does `?mode=assets` do" is *read the source*. After this story the answer is a pure
module that `node:test` interrogates directly, and a URL that stops working is a red test rather than
a bug report.

## Tasks

<!-- The tasks that satisfy this story, each a tasks/NN_<slug>.feature whose scenarios are the
     acceptance criteria. A task is done when its @executable feature is green. Keep tasks
     independent of OTHER stories' tasks; sequential within this story is fine. -->

- [x] `tasks/00_route-table.feature` — a path resolves to exactly one named surface; an unknown path
      resolves to the shell's 404 surface, never to a redirect
- [x] `tasks/01_legacy-mode-redirect.feature` — `legacyRedirectFor(url)` maps every `?mode=` URL the
      product has ever advertised onto its path, removing `mode` and nothing else
- [x] `tasks/02_query-and-fragment-passthrough.feature` — `?scope=`, unknown query parameters and the
      `#ref` fragment survive both a match and a redirect, untouched

## Notes

**Order.** This story and `45/02` are both parallel-eligible from day one — neither depends on
anything. `45/03` (the shell and entry rewrite) depends on this one; `45/04` depends on `45/03`.

**The module is `ui/src/app/routes.mjs`** — ADR-001. `ui/src/app/` is a new folder and it is
deliberately neither surface's: a shared primitive placed into `board/` or `fleet/` is refused at
review (ARCHITECTURE health finding 2 / TECH_DEBT 18a).

**Framework-free is a contract, not a style.** The module imports no React and is loadable by
`node:test` — this repo has no React test harness, so a route module that can only be exercised
through a component is a route module with no tests. Pinned by
`test/arch/acd-route-logic-framework-free.test.mjs`.

**This story renders nothing.** It lands, is fully exercised, and is imported by nobody — a
zero-blast-radius stage. That is why it goes first.

Governing ADRs: **001** (hand-rolled table; `react-router-dom` rejected), **002** (the four paths,
`/assets` forbidden because it is the bundle's own asset directory, unknown path renders the 404
surface), **003** (one pure `legacyRedirectFor`, applied exactly once at the entry), **006** (path
router — every non-`mode` parameter and the fragment pass through).
