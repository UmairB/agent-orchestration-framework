---
type: milestone
number: 50
slug: session-launcher
title: "Session launcher — start a session on a node, bound to a repo"
status: not-started
owner: product-owner
created: 2026-08-02
updated: 2026-08-02
depends: [48, 49]
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
# 50 · Session launcher — start a session on a node, bound to a repo

## Objective

There is no "start a terminal" verb anywhere in the fleet. `/api/mesh/assign` dispatches a *work item*
plus a lifecycle phase (`refine | continue | verify | autonomous`,
[mesh-assignment-directive.mjs:28](../../../src/mesh-assignment-directive.mjs#L28)) to a node; it cannot
open a bare shell. [terminal-ws.mjs](../../../src/terminal-ws.mjs) spawns PTYs, but only on a board
server, only inside that server's `projectDir`, and only for a resolved item `ref`.

So the fleet UI is a monitor with exactly one verb. This milestone gives it the second: **new session,
bound to a chosen node and repo/workspace** (optionally an item ref), appearing in the terminals-home
grid like any other session the moment it exists.

Origin: [PRD — Web UI Restructure](../../planning/PRD-web-ui-restructure.md), milestone
`session-launcher`.

## Scope

In scope:

- **The "new session" affordance** on the terminals home: pick a node, pick a repo/workspace, optionally
  attach an item ref. It composes with the grid rather than living in its own page.
- **A named spawn route added to the fleet face's bounded write allowlist.** The fleet face's write
  surface is bounded *on purpose* and is fitness-locked by
  [mesh-ui-read-only-contract.test.mjs](../../../test/mesh-ui-read-only-contract.test.mjs) and
  [mesh-ui-write-isolation-bounded.test.mjs](../../../test/mesh-ui-write-isolation-bounded.test.mjs).
  This milestone adds a **named entry**, updating those tests deliberately — so the bound stays a bound
  rather than quietly becoming "the fleet is writable now". A route added without touching the allowlist,
  or an allowlist loosened to a pattern, both fail this milestone's intent.
- **The worker-side directive** that opens a PTY in the chosen repo/worktree. Distinct from an
  assignment directive: it carries no lifecycle phase and runs no work item.
- **Registration with a routable id**, through milestone 48's session index, so a launched session is
  addressable and renderable by exactly the same path as one started any other way. A launcher that
  produces a second class of session defeats its own purpose.
- **Honest failure.** A node that cannot spawn, a repo that does not exist on the chosen node, a
  worktree that cannot be created — each fails with a stated reason, never a spinner that ends in an
  empty grid slot.

Out of scope:

- **An agent-facing session API.** herdr lets *agents* spawn panes and wait on each other's
  dependencies. aof's equivalent would be command-core operations for session spawn/attach — that
  belongs with the orchestration arc, not the web UI.
- **Changing what an assignment is.** `/api/mesh/assign` keeps its shape and its meaning; this is a
  sibling verb, not a generalisation of it.
- **Session templates, saved layouts of sessions, or bulk spawn.** One session at a time.
- **Multi-user auth or per-user entitlement.** Single-operator over the existing mesh credential, as
  everywhere else in this arc.
- **Making the fleet face generally writable.** Named additions only.

## Stories

<!-- Populated at the Break-down stage (refine). -->

To be broken down — `aof:refine 50`.

## Dependencies

- **48 · fleet-session-identity** — a launched session must register with a routable id through the same
  index every other session uses. Without it the launcher would have to invent its own addressing and
  become the second source of truth 48 exists to prevent.
- **49 · terminals-home** — the launcher's affordance lives on that surface, and a session you cannot
  type into is not worth spawning. Since interactivity is delivered in 49 (merged from the PRD's
  `interactive-terminals`), this single edge carries what the PRD split across two.
