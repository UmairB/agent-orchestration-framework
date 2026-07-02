---
type: milestone
number: 25
slug: mesh-ui
title: "Mesh UI — aof work ui rename + the aof mesh ui fleet surface"
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-07-02
depends: [03, 21, 23, 24]
origin: wiki/planning/PRD-decentralized-agent-orchestration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 25 · Mesh UI — `aof work ui` rename + the `aof mesh ui` fleet surface

## Objective

The **fleet surface** — the "one mission-control view of the whole fleet" (origin:
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), §7.1/§7.2 KF7).
With nodes publishing identity (milestone 22), live presence over the relay (23), and a group roster (24),
this milestone finally **renders** them.

Two moves. (1) **Rename `aof work board` → `aof work ui`** — a single work stream's board (its items, runs,
and milestone-21 run history/state), the per-project drill-in target. This is a **deliberate ACD change**
that touches milestone 03's registered board command **and its frozen-envelope fitness functions** — not a
drive-by edit (PRD §8 flags it explicitly). (2) **Add `aof mesh ui`** — the **read-only** fleet surface
that sits *on top* of the work UIs: the **nodes** (presence + what each is running) and **every board
being worked on** across the group, each drillable into its `aof work ui`. It reads the **group registry**
(24) + **live presence** (23) and drills into a board via that board's own git. Everything routes through
registered commands, preserving the thin-face + frozen-envelope discipline (milestones 03 / 08 / 21).

An outsider can verify the objective is met when, from any node, `aof mesh ui` shows the fleet's nodes and
active boards, a peer's change is reflected within KR1's bound, a board drills into its renamed
`aof work ui`, and the milestone-03 board envelope plus the milestone-08 bijection / no-UI-core-import
fitness functions **stay green through the rename**.

## Scope

In scope:
- **`aof work board` → `aof work ui` rename** — the per-stream board renamed; milestone 03's registered
  command, its frozen `/api/work` envelope, and its fitness functions carried forward **deliberately**.
- **`aof mesh ui`** — the read-only fleet view: nodes (presence + active runs) **and** every board being
  worked on, each drillable into its `aof work ui`.
- **Group-registry + presence rendering** — the fleet view reads the group roster (24) + live presence
  (23); it carries no run logic of its own (thin face).
- **`aof mesh status`** — the CLI mirror of the fleet view.

Out of scope:
- **Issuing / assigning / routing work from the fleet view** — milestone 27 (this milestone renders
  read-only; the issue/assign affordance arrives there).
- **Authoring presence / the group registry** — milestones 23 / 24 (this milestone only *renders* them).
- **Distributed run records + leasing shown per node** — milestone 26 (rendered once it exists).
- **A broader interactive board redesign** — the board stays read-mostly; only the *name* and the *fleet
  layer above it* change.
- **Real-time push to a web client** — visibility is poll/refresh + relay presence, not a WebSocket
  event stream (PRD §7.3).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 25.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-07-01` by `aof:refine 25`. The partition follows the codebase-graph coupling
([ARCHITECTURE.md §Recommended story partition](ARCHITECTURE.md); graph freshly built — 1174 nodes / 3162
edges) — the three moves fall on **three near-disjoint seams** (`aof graph impact`): the board serve-face
(`board-serve.mjs ← cli.mjs` only, isolated from all mesh code), the fleet data seam (`mesh-identity.mjs` /
`mesh:status` ← `command-core` → `mesh-store`, `mesh-presence`), and a greenfield fleet web face. **00** is the
isolated **serve-verb rename** (the drill-in target the fleet view links into); **01** is the **fleet data
model** — `mesh:status` extended to the whole-fleet aggregate + the `aof mesh status` CLI mirror (the ONE
registered command both faces consume, ADR-002); **02** is the **`aof mesh ui`** web surface — a thin
serve-face over that command, closing over both. **Parallelism:** 00 ∥ 01 (fully parallel — disjoint
functions, even in the one shared file `cli.mjs`), then 02 sequences after both (it needs 00's renamed drill
target + 01's fleet aggregate). Contracts (task `.feature` files) are authored per story via Three Amigos at
`aof:refine 25/SS`.

**Contracts authored `2026-07-02`** (`aof:refine 25 --autonomous` cascade — the full Three Amigos fanned out
per story): **12 task features** (00 → 3, 01 → 3, 02 → 6), all 15 QA feasibility flags resolved with
source-checked developer verdicts; `aof work validate` PASS. All three stories → `in-progress`. (Every m25
arch-test is green; the suite's only 3 reds are pre-existing milestone-24 WIP — see [STATE.md](STATE.md).)
Key dev-locked decisions: the `mesh:status` boards entry is `{ ref, owner, activeRuns }` (union enumeration,
first-wins owner, owner omitted when ownerless); the fleet face is a new `src/mesh-ui-serve.mjs` on port **4181**
reusing `ui/dist` `?mode=fleet`; the board→ui rename is FAITHFUL (per-surface usage shapes preserved). Two build
constraints pinned: the boards projection must own its own `readRegistry` try/catch + shape-guard (readRegistry
tolerates only ENOENT today); the stale `src/terminal-ws.mjs:52` comment rides the rename diff.

- [x] **00 · [the `aof work board` → `aof work ui` rename](stories/00_story_work-ui-rename/STORY.md)** — the
  deliberate ACD serve-verb rename (PRD §8): `cli.mjs`'s `subcommand === "board"` → `"ui"` +
  `workBoardCommand` → `workUiCommand` + the usage/log lines. The board is a **CLI-only serve verb**, so the
  frozen `/api/work` envelope + `board-ui.mjs` stay **byte-identical** and m03's board guards carry forward
  green (ADR-001). Contract authored `2026-07-02` (3 task features). **Reconciliation (dev feasibility read):
  the frozen envelope is EIGHT `/api/work` routes, not six** — 7 GET (list/doc/tasks/run-status/validate/doctor/**next**)
  + POST **feedback**; ADR-001's "six" undercounts `next` + `feedback` (see [STATE.md](STATE.md) §Notes). Owns
  `acd-work-ui-rename-complete`; carries `acd-board-single-server` /
  `acd-board-write-isolation` / `acd-work-ui-no-core-import` / `acd-work-command-route-coverage` unchanged.
  **Independent — parallel with 01.**
- [x] **01 · [the fleet data model + `aof mesh status` CLI mirror](stories/01_story_fleet-status/STORY.md)** —
  EXTEND `mesh:status` (`src/commands/mesh-identity.mjs`) to aggregate the whole fleet: nodes
  (`readNodeRecords`) + presence/staleness (`readPresenceRecord`/`isNodeStale`) + registered boards
  (`readRegistry`, the m24 roster, absence-tolerant) + per-board active runs (m21's `work:run-status` READ),
  rendered as the `aof mesh status` CLI mirror. The ONE registered data command both faces consume — no second
  data path (ADR-002); degrades to the node roster when the m24 seam is absent. Owns
  `acd-mesh-ui-single-data-command` (phase 1). **Independent — parallel with 00** (consumes the m24 story-00
  `readRegistry` seam via `depends: 24`, but not hard-blocked on it).
- [x] **02 · [the `aof mesh ui` fleet web surface](stories/02_story_fleet-ui/STORY.md)** — NEW
  `src/mesh-ui-serve.mjs` (the `board-serve.mjs` sibling) + the `meshCommand` `subcommand === "ui"` branch +
  `meshUiCommand` + the `GET /api/mesh/status` route (`invoke("mesh:status")`) + the fleet web bundle (Nodes
  cards + Boards tiles, drill-in to `aof work ui`). Its OWN thin serve-face over the registry, read-only
  (ADR-003/004). Owns `acd-mesh-ui-no-core-import` / `acd-mesh-ui-single-server` / `acd-mesh-ui-write-isolation`
  + phase 2 of `acd-mesh-ui-single-data-command`. **Depends on 00 + 01** (the renamed drill target + the fleet
  aggregate) — sequences after both. Mock owed at `mocks/mesh-ui.png` (user-generated from DESIGN Appendix A).

## Dependencies

- **03 · work-board-ui** — supplies the board surface and the frozen `/api/work` envelope this milestone
  renames; the rename edits 03's registered command and its frozen-envelope fitness functions **directly**
  (the deliberate ACD change PRD §8 Phase 1 calls out).
- **21 · board-run-observability** — **genuine consumption, not just ordering**: the fleet view's
  per-board run display (each board's "running ♥4s", drill-in to run history / current-run state) **is
  milestone 21's run-observability surfaced fleet-wide**. `aof mesh ui` shows at the group level exactly
  what 21 builds per board, through the same registered commands. (And the `aof work board → aof work ui`
  rename lands after 21's board extension, carrying it forward rather than forking it.)
- **23 · control-node-relay** — the fleet view renders **live presence** over the relay (each node's
  "what it's running" + staleness).
- **24 · group-enrollment** — the fleet view reads the **group registry** (roster of nodes + registered
  boards) that 24 authors; without it there is no fleet to show.
