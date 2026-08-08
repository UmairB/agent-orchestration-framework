---
type: story
number: 04
slug: advertised-entry-points
title: "Every door still opens — the servers, the desktop app and the in-app links stop advertising `?mode=` and start advertising paths"
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
# 04 · Every door still opens — the advertised URLs become paths

## User story

As the operator who arrives from a CLI line, the desktop tray or a link inside the app,
I want every one of those doors to land me on a real path,
so that the address bar means the same thing however I got here, and the old link in my bookmarks
still works.

The failure this prevents is the ugly one: a product that has paths *and* keeps printing the legacy
query URL, so half the addresses in circulation are the new truth and half are a compatibility
shim nobody remembers to remove.

## Tasks

<!-- The tasks that satisfy this story, each a tasks/NN_<slug>.feature whose scenarios are the
     acceptance criteria. A task is done when its @executable feature is green. Keep tasks
     independent of OTHER stories' tasks; sequential within this story is fine. -->

- [x] `tasks/00_servers-advertise-paths.feature` — the board, fleet and assets servers and the
      `/api/mesh/board-url` route all emit path URLs, with that route's body shape left additive
- [x] `tasks/01_in-app-cross-links.feature` — the three hard-coded cross-links between board and fleet
      point at paths
- [ ] `tasks/02_desktop-entry-and-no-literals-left.feature` — the desktop app opens a path, and no
      `?mode=` surface literal survives anywhere in `ui/`, `src/` or `app/desktop/`

## Notes

**Order.** Depends on `45/03`. Every producer here is an independently revertible leaf, but none of
them may land before the entry can serve the new paths — an advertised URL that 404s is a worse
regression than the one this milestone fixes.

**The producers, measured 2026-08-06 — this is the complete list:**

| Producer | Site | Emits today |
|---|---|---|
| board server | [board-serve.mjs:41](../../../../../src/board-serve.mjs#L41), [:62](../../../../../src/board-serve.mjs#L62) | `http://127.0.0.1:PORT/?mode=board` |
| fleet server | [mesh-ui-serve.mjs:143](../../../../../src/mesh-ui-serve.mjs#L143), [:736](../../../../../src/mesh-ui-serve.mjs#L736) | `...?mode=fleet&scope=<scope>` |
| assets UI | [assets-ui.mjs:45](../../../../../src/commands/assets-ui.mjs#L45), [:117](../../../../../src/commands/assets-ui.mjs#L117) | `...?mode=assets` |
| board-url route | [mesh-ui-serve.mjs:278](../../../../../src/mesh-ui-serve.mjs#L278), consumed at [fleet/api.ts:286](../../../../../ui/src/fleet/api.ts#L286) | a page URL with `#ref` |
| desktop app | [supervisor.rs:44](../../../../../app/desktop/crates/app/src/supervisor.rs#L44) | `MESH_UI_URL` const, `?mode=fleet&scope=global` |
| board → fleet | [Board.tsx:416](../../../../../ui/src/board/Board.tsx#L416), [DetailPanel.tsx:270](../../../../../ui/src/board/DetailPanel.tsx#L270) | `http://127.0.0.1:4181/?mode=fleet...` |
| fleet → board | [Fleet.tsx:1398](../../../../../ui/src/fleet/Fleet.tsx#L1398) | `/?mode=board` |

**`?scope=` and `#ref` are carried, not dropped.** The fleet URL keeps its scope parameter and the
board-url keeps its fragment — they move to the path form, they do not lose their payload.

**Do not reshape `/api/mesh/board-url`.** Spike 44 (done) settled that milestone 46 adds an **origin**
field to that same route's JSON body, over the same lazy-launch seam. Change the URL it returns;
leave room for the additive field.

**The desktop change needs a Rust build** (`node scripts/install-local.mjs --desktop`, Windows only)
and `supervisor.rs`'s doc comment at :37-44 — which warns that `/` renders BLANK — is retired by this
milestone and must be rewritten, not left contradicting the code beneath it.

**File-overlap flag.** This story edits `Board.tsx`, `DetailPanel.tsx` and `Fleet.tsx` for their
`href`s while `45/03` edits the first and third for their brand marks (DG-45-1). Different regions of
the same files; sequence them (03 then 04) and re-read before editing.

Governing ADRs: **002** (the path each producer targets), **003** (the legacy URLs those producers
stop emitting keep working through the redirect). Fitness function:
`test/arch/acd-no-surface-mode-url-literal.test.mjs` — this story is what takes it green.
