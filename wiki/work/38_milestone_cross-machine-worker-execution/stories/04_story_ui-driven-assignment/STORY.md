---
type: story
number: 04
slug: ui-driven-assignment
title: "Assign a work item to a worker node from the UI"
parent: 38
status: in-progress
owner: product-owner
created: 2026-07-18
updated: 2026-07-18
schema: 1
aofVersion: 0.1.0
---

## User story

As the operator, I want to open a milestone/story (or any work item) in the fleet/board UI, pick a worker
node, and assign it — so that I dispatch real work to the mesh without ever touching the CLI, from the same
UI where the worker's terminal will live.

## Background

Requirement set by the operator 2026-07-18 during `aof:verify 38`'s live soak: *"I should be able to go
[to] the milestone and assign a milestone/story/etc to a worker node."* See `RESEARCH.md § 4.5`.

The dispatch verb already exists — `aof mesh assign <ref> --to <nodeId>` (`src/commands/mesh-assign.mjs`):
it resolves the ref, mints the `assigned` record in `global_assignments`, enforces the single-runner
uniqueness invariant, and runs the control-side repo-availability gate. This story does NOT re-implement
any of that — it puts a UI face on it.

**The constraint this bumps:** the fleet face (`src/mesh-ui-serve.mjs`) is **read-only by ADR-006** — it
serves `/api/mesh/status` GET only, with NO mutation route (a POST is a clean 405 today). A UI-driven
assign is therefore a deliberate, security-reviewed **mutation carve-out** — the first write route the
fleet face has ever had — wrapping the existing verb, not a new arbitration path.

## Tasks

<!-- Contract authored `2026-07-18` via `aof:refine 38 --autonomous` (Three Amigos). Refine DELIVERED the
     owed decisions: ARCHITECTURE ADR-012 (the fleet-face mutation carve-out — ONE write route
     `POST /api/mesh/assign {ref,nodeId}` wrapping `assignWork` verbatim; loopback-bound + same-origin
     local-admission, no auth token this story) + SECURITY T13 (hostile POST; the write route re-runs the
     verb's gates; cross-origin write refused). ADR-012 grounded on the seam's history: m27/ADR-006 shipped a
     fleet-face write route (`POST /api/mesh/issue`) later RETIRED, m35/ADR-007 then DEFERRED the UI-assign
     POST — this is the third, deliberate pass. Tasks 00–03 `@executable` over the REAL route + verb with an
     injected store seam; task 04 the real-UI `@manual` soak. -->

- [x] `tasks/00_fleet-face-assign-route.feature` — `@executable` — `POST /api/mesh/assign {ref,nodeId}` wraps
  the existing `assignWork` verb verbatim (no re-implemented arbitration) and mints the real
  `global_assignments` `assigned` record (read back through the real store); it is the ONLY mutation route on
  the fleet face — fitness `acd-fleet-face-single-mutation-route` (every other path/verb stays 405/404).
- [x] `tasks/01_assign-gates-hold-on-ui-path.feature` — `@executable` — the UI path re-runs the verb's gates:
  a Scenario Outline over unknown-node / non-member / unpublished / typo'd-ref → coded non-200 (never a 200 +
  phantom record), verb-exact code, nothing minted; plus the single-runner uniqueness invariant (a second
  assign of the same item is refused even to a different node). (T13)
- [x] `tasks/02_read-only-posture-preserved.feature` — `@executable` — the carve-out is exactly one route (a
  POST to any other fleet-face path is still 405/404 with a per-route `Allow`); the server stays loopback-bound
  with no terminal upgrade; a cross-origin write is refused (a same/cross-origin CSRF matrix, mechanism-agnostic
  so a build's admission choice can't invalidate it). (T13 / ADR-006)
- [x] `tasks/03_assign-affordance-renders.feature` — `@executable` — the work-item card's "assign to node"
  affordance renders from real UI production (ADR-008): the worker-node picker is producer-fed from the real
  `/api/mesh/status` roster (empty / one / live+stale states, empty-roster disabled), and the resulting
  `assigned` chip is fed by the real minted record through the m35/story-03 projection. (The full browser
  render + `toHaveScreenshot` baseline is the QA visual lane run at Review — no React harness ships in-repo.)
- [ ] `tasks/04_ui-assign-soak.feature` — `@manual` — the real-producer outsider check (ADR-008): open a REAL
  milestone/story in the REAL fleet/board UI, pick a REAL worker node from the live roster, click assign → a
  real `global_assignments` record is minted and the `assigned` chip appears, with NO CLI touched. Deferred
  human gate — closed at `aof:verify 38`.

## Notes

Verifiable independently of the terminal work: assigning mints the `global_assignments` record and the UI
reflects the `assigned` chip — proving the dispatch path — before story-05's terminal execution consumes it.
