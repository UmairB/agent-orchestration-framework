---
type: milestone
number: 45
slug: ui-app-shell-routing
title: "UI app shell & path routing — three pages become one application"
status: in-progress
owner: product-owner
created: 2026-08-02
updated: 2026-08-06
origin: ../../planning/PRD-web-ui-restructure.md
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 45 · UI app shell & path routing — three pages become one application

## Objective

`ui/` is not an application. It is three unrelated roots sharing one bundle, selected by a query
parameter at the render root — `?mode=fleet` → `<Fleet>`, `?mode=board` → `<Board>`, anything else →
the config editor `<App>` ([main.tsx:1261](../../../ui/src/main.tsx#L1261)). There is no router, no
shell, and no navigation between the three.

This milestone makes it an application: **real URL paths behind a shared shell**, so that every
surface the rest of this arc adds has a `/` to be built on and a `/fleet` to be moved to. It delivers
no new product behaviour — every surface reachable today stays reachable and behaves identically. Its
success condition is that an outsider cannot tell what changed except that the address bar now means
something and the three pages know about each other.

Origin: [PRD — Web UI Restructure](../../planning/PRD-web-ui-restructure.md), milestone
`ui-app-shell-routing`.

**One PRD premise is corrected here, measured 2026-08-02.** The PRD states that *both* static servers
404 a client-side path on refresh. The fleet server does not — it already falls back to `index.html`
([mesh-ui-serve.mjs:528-533](../../../src/mesh-ui-serve.mjs#L528-L533)), so `/fleet` deep-linked on
`:4181` renders today. The gap is `safeStaticPath` in
[setup-ui.mjs:269](../../../src/setup-ui.mjs#L269), reached via
[:130](../../../src/setup-ui.mjs#L130) — a literal file lookup with no fallback — and that one handler
backs **both** the board and the config editor, because `board-serve.mjs` delegates to `serveSetupUi`
([board-serve.mjs:20](../../../src/board-serve.mjs#L20)). So this is one server-side fix, not two.

## Scope

**One further correction, measured at refine (2026-08-06).** This SPEC says "three pages"; there are
**four** entry values. `?mode=assets` — produced by `aof assets ui`
([assets-ui.mjs:45](../../../src/commands/assets-ui.mjs#L45), and as `VITE_AOF_UI_MODE`) — falls
through the ternary's `else` to `<App>`, exactly as no-mode does. It is a real entry point and it
gets a real path (ADR-002: `/config`), so the route table is four paths, not three.

In scope:

- **A router and real paths.** `/` (the terminals home's future address), `/fleet`, and the board's
  existing surface as paths rather than `?mode=` values. The render-root ternary at
  [main.tsx:1261](../../../ui/src/main.tsx#L1261) is replaced, not wrapped.
- **A shared app shell** — top bar, group chip, scope/nav — that the three surfaces mount inside, and
  which gives the arc its navigation between them. The shell owns the layout primitives milestone 46's
  terminal control consumes.
- **The SPA history fallback on `setup-ui.mjs`'s static handler**, so a client-side path deep-linked or
  refreshed on the board/config origin renders instead of 404ing. The fleet server already has this;
  confirm it with a test rather than assuming it, so the behaviour is pinned on both origins.
- **Back-compatible `?mode=` redirects.** Every existing entry point keeps working: the legacy
  `?mode=fleet` / `?mode=board` URLs, the `/api/mesh/board-url` consumers, the in-app cross-links that
  currently hard-code `http://127.0.0.1:4181/?mode=fleet`
  ([Board.tsx:331](../../../ui/src/board/Board.tsx#L331),
  [DetailPanel.tsx:212](../../../ui/src/board/DetailPanel.tsx#L212),
  [:798](../../../ui/src/board/DetailPanel.tsx#L798)), and the Rust desktop app's entry URLs.
- **`?scope=` survives.** It is a deep-link contract with existing consumers; the router carries it
  through untouched. Whether it is subsumed by milestone 47's repo filter is 47's question, not this
  one.

Out of scope:

- **Re-skinning the config editor (`<App>`).** It gets a route and a place in the shell; its own views
  are untouched.
- **Reworking the desktop app's views.** Only the entry URLs this routing change touches.
- **Any new surface.** `/` may render a placeholder or the existing default; the terminals home is
  milestone 49. Shipping a route with nothing behind it yet is correct here.
- **Moving the fleet surface's *content*.** `/fleet` renders today's `<Fleet>` unchanged; the repo
  filter is milestone 47.
- **Merging the origins.** Boards stay per-workspace on their own ephemeral-port servers. Whether
  terminal *sockets* cross that boundary is spike 44's question.

## Stories
- [ ] `01_story_route-model` — one pure, framework-free table that says what a URL means, and what
      every legacy URL becomes.
- [ ] `02_story_static-serve-history-fallback` — a refreshed path renders instead of 404ing: one
      static-serving leaf, one traversal guard, and a fallback that never masks a missing asset.
- [ ] `03_story_app-shell-and-entry` — the three pages become one application: a thin entry, a shell
      with named regions, and navigation that has never existed.
- [ ] `04_story_advertised-entry-points` — the servers, the desktop app and the in-app links stop
      advertising `?mode=` and start advertising paths.

**Boundaries and order.** `01` and `02` are parallel-eligible from day one and share nothing:
everything in `ui/` waits on the route module, and nothing in `src/` waits on anything. `03` needs
`01`'s table; `04` needs `03`, because an advertised URL pointing at a path the entry cannot yet serve
is a worse regression than the one this milestone fixes. Coupling read from the codebase graph
(built 2026-08-06, 15,644 nodes / 21,352 edges, egress none): `src/board-serve.mjs ←
src/commands/work-ui.mjs` and `src/mesh-ui-serve.mjs ← src/commands/mesh-ui.mjs` — one command-layer
entry each and no shared dependent, which is what makes `02` safe to run alone; and `board-serve.mjs`
imports `setup-ui.mjs`, which is why one fallback fix covers two origins. The graph's `.tsx` edge
coverage is partial (`main.tsx` reports only self-edges), so the `ui/` boundaries were drawn by
reading source and the graph's silence there was treated as unknown, never as absence.

## Dependencies

None. This is the arc's foundation: it depends on nothing and gates 46 and 47.

Note the ordering it implies rather than declares — 48 (`fleet-session-identity`) is a wire-shape
change with no UI surface, so it carries no dependency on this milestone and is parallel-eligible from
day one.
