---
type: story
number: 04
slug: ui-driven-assignment
title: "Assign a work item to a worker node from the UI"
parent: 38
status: done
owner: product-owner
created: 2026-07-18
updated: 2026-07-24
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

<!-- RE-OPENED `2026-07-24` (`aof:continue 38/04`) after the live two-machine soak (task 04) FAILED, raising
     BLOCKER F21 (the route resolved every ref against the DAEMON's own workspace — a global surface resolving a
     per-item fact from its own local context, the ADR-010 "Gap A" class for the third time in this milestone)
     and F22 (a `200 ok` produced no acknowledgment at all). The owed decisions were taken BEFORE this build:
     the ARCHITECTURE ADR-012 AMENDMENT (wire shape `{ref,nodeId,workspaceId}`, all REQUIRED; the sanctioned
     resolution seam; four coded refusals; a PRE-mint identity assertion; invariants 5 + 6) and the DESIGN
     §Surface 2 Amendment (A7/A8 — the `Sent` acknowledgment + the ONE silent success re-load). Tasks 05 and 06
     are those contracts; task 00's narrative was amended for the changed wire shape, its assertions unchanged. -->

- [x] `tasks/00_fleet-face-assign-route.feature` — `@executable` — `POST /api/mesh/assign {ref,nodeId,workspaceId}` wraps
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
  human gate — closed at `aof:verify 38`. **RUN `2026-07-24` and FAILED — it raised BLOCKER F21 + F22, closed
  by tasks 05/06 below; the soak itself is owed again on the fixed build.**
- [x] `tasks/05_assign-targets-the-items-own-workspace.feature` — `@executable` — **BLOCKER F21** (ADR-012
  AMENDMENT, invariants 5 + 6): `POST /api/mesh/assign` requires `workspaceId` on the wire and resolves the ref
  against the **ITEM's OWN** workspace (`queryGlobalMeshStatus` → `status.workspaces[]` → `projectRoot`), never
  the daemon's launch dir; four coded refusals (`invalid-workspace` 400 / `workspace-not-found` 404 /
  `workspace-not-local` 409 / `workspace-id-mismatch` 409), each minting nothing, none a fallback; the mint's
  target asserted PRE-mint with the verb-identical derivation. Driven in a **TWO-workspace** fixture with the
  soak's own colliding `ref 18` — the configuration a single-workspace fixture structurally cannot express —
  plus the REAL production `<Fleet/>` putting `m.item.workspaceId` on the wire. Fitness
  `acd-fleet-assign-targets-item-workspace` RED → GREEN.
- [x] `tasks/06_assign-acknowledges-on-success.feature` — `@executable` — **F22** (DESIGN §Surface 2 Amendment
  2026-07-24, A7/A8/A9/A10): a 2xx puts the SAME button into a `muted`, disabled **`Sent`** with the picker
  frozen on the chosen node, held **exactly one poll interval** and then decayed to the terminal resting state
  with nothing persisting; and the surface fires **exactly ONE** additional **silent, keep-last-good** status
  re-load so region 5's m35 `assigned` chip lands within a round trip. A refusal keeps the inline `destructive`
  error with no hold and no re-load. Driven both through the pure state machine
  (`ui/src/fleet/assign-affordance.mjs`) **and** through the REAL, unmodified production `<Fleet/>` mounted
  headlessly against the REAL face on a controllable clock (the F-38.06e lesson: a reducer-only lane proves
  nothing production can drive). **EXTENDED `2026-07-24`** with **DG-14 / F-38.04f** (DESIGN §Surface 2
  Amendment 2026-07-24 (b); the new `timed out (no answer)` States row): a hung POST is a **REFUSAL, not a
  limbo** — it times out at **2 × `POLL_MS`** into the existing `refused` presentation verbatim, reading
  `no answer — timed out` (never "not sent": a timed-out POST may have succeeded server-side), the message
  stands and a re-click is permitted, and a **late 2xx is TERMINAL** — honoured only by A8's one silent
  re-load, never by resurrecting `Sent`.
- [x] `tasks/07_assign-row-geometry-holds.feature` — `@executable` — **DG-13 / F-38.04g** (DESIGN §Surface 2
  Amendment 2026-07-24 (b), the amended **A10** "rhythm is binding geometry"; DG-11 re-scoped in): the assign
  row's geometry holds in every state — the action's width is **FIXED**, sized to its longest label
  (`Assigning…`), so a label swap cannot move another element; the picker keeps a **floor** of ≥14ch of the
  node id plus the chevron and **never collapses to a bare chevron**; the **message slot is the element that
  yields**, truncating with the full server sentence in its native `title`; its copy is ranked **outcome >
  holder > all else** and is shaped from the verb's **coded envelope** (`already assigned → <holder>`); and
  **region 5** spends its width on the chip's `→ <target>` in FULL before the workspace name. A separate task
  file from 06 because it is not the affordance's state axis — it binds every state at once and reaches into
  the footer/attention cluster. **Structural/class facts only; the PIXEL verdict is the re-render owed to the
  designer.**

## Notes

Verifiable independently of the terminal work: assigning mints the `global_assignments` record and the UI
reflects the `assigned` chip — proving the dispatch path — before story-05's terminal execution consumes it.
