---
type: milestone
number: 25
slug: mesh-ui
title: "Mesh UI — aof work ui rename + the aof mesh ui fleet surface"
status: not-started
owner: product-owner
created: 2026-06-29
updated: 2026-06-29
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

_To be broken down — `aof:refine 25`._

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
