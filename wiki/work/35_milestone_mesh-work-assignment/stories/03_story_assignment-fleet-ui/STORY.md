---
type: story
number: 03
slug: assignment-fleet-ui
title: "Assignment lifecycle in the fleet UI — the read-only fleet view renders assignments advancing assigned→accepted→running→done/failed, live on the 5s poll"
parent: 35
status: done
owner: product-owner
created: 2026-07-08
updated: 2026-07-09
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 03 · Assignment lifecycle in the fleet UI — watch the dispatch advance

## User story

As a **control-node operator watching `aof mesh ui`**, I want each assignment to show up in the fleet view
and advance through `assigned → accepted → running → done|failed` as the worker picks it up and runs it —
with a state I can read at a glance (colour AND label together) — so that I can watch dispatch happen in
real time without tailing a log or SSHing to the worker, while the UI stays strictly read-only.

<!-- The READ-ONLY UI story. It extends the GET /api/mesh/status shape to carry assignment rows and renders
     them in the React fleet, mirroring the existing run-state chip ramp. It adds NO write route — assign is
     CLI-only (ADR-007). "Live" is the existing 5s poll of the store-backed status endpoint. INDEPENDENT of
     stories 01/02: it renders whatever assignment rows exist in the store, so it can be built and tested
     against Story 00's rows alone. -->

## Tasks

<!-- Contract authored `2026-07-08` via `aof:refine 35 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). `@executable` for the status shape, the read-only invariant, and
     the pure state-selection helpers; a `@uat` visual review (the designer's flag — a render is needed or
     the design review returns INCONCLUSIVE). DESIGN.md's binding checklist is the conformance source. -->

- [x] [`tasks/00_status-shape.feature`](tasks/00_status-shape.feature) — `@executable` — extend
  `GET /api/mesh/status` (through the `global-mesh-query` composition seam + `shapeGlobalStatus`) to carry
  the assignment rows — per work-item and per node — read from `global_assignments`; the read shape only, no
  new write branch.
- [x] [`tasks/01_lifecycle-render.feature`](tasks/01_lifecycle-render.feature) — `@executable` — the pure
  state-selection helpers that map an assignment row to its chip (state → label + mark + token + motion per
  DESIGN.md's ramp): `assigned/accepted/running/done/failed`, only `running` pulses; a `reclaimed`/stale
  assignment reads as `failed` + a `· reclaimed` note (degraded-visible); colour AND label always travel
  together; the keep-last-good idiom (a silent poll never tears the card).
- [x] [`tasks/02_read-only-invariant.feature`](tasks/02_read-only-invariant.feature) — `@executable` — the
  mesh UI serve face exposes NO assignment write route: every non-GET/HEAD is a 405, the `upgrade` is
  destroyed, and no `/api/mesh/assign` (or `/api/mesh/issue`) mutating handler exists — the extended status
  shape adds no write branch (ADR-007, re-arming the m34 read-only posture).
- [ ] [`tasks/03_fleet-visual-review.feature`](tasks/03_fleet-visual-review.feature) — `@uat` — render the
  populated fleet showing at least a `running` and a `failed`/`reclaimed` assignment; a read-only
  design-conformance judgement against [DESIGN.md](../../DESIGN.md)'s binding checklist (the source of truth
  in the absence of a committed mock). **Deferred design gate** — judged at `aof:verify`.

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md) — this story arms:

- `acd-mesh-ui-read-only` (ADR-007) — the mesh UI serve face exposes no assignment write route; non-GET →
  405; upgrade destroyed; the extended status shape added no mutating handler (re-arms the m34 read-only
  guarantee over the new shape).

## Notes

Inherits **ADR-007** (assign is CLI-only; the fleet UI stays read-only and renders lifecycle; "live" is the
existing 5s poll — no UI WebSocket). Inherits [DESIGN.md](../../DESIGN.md) — the fleet-view binding checklist
is the conformance source of truth for the `@uat` visual review (no committed mock exists; the checklist is
the baseline).

**Depends:** Story 00 (the `global_assignments` rows it renders) — NOT stories 01/02. It reads whatever
assignment rows exist, so it forks off Story 00 and runs in parallel with the transport/execution spine (the
maximal parallelism the coupling permits).

**Rendering facts (from the UI map):** the fleet view is a client-side React + Tailwind SPA
(`ui/src/fleet/Fleet.tsx`) served by `mesh-ui-serve.mjs`, updating by POLLING `GET /api/mesh/status` every
5s (no UI WebSocket/SSE). Primary attachment: `GlobalMilestoneCard`'s attention row (per work item);
secondary: `NodeCard`'s "what it's running" row (per node). The assignment chip mirrors the existing
run-state `CHIP_RAMP` (`ui/src/board/runs.mjs`) — reuse the `RunStateChip` primitive + token map.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: tasks 00–02 stay `@executable` (no browser), task 03 `@uat`.** No retag.

- **Extending `shapeGlobalStatus` is additive.** It is a PURE function of `{ paths, workProjection, registry,
  now }` returning a fixed object literal (`global-mesh-query.mjs:71-161`, zero I/O) — attaching an
  `assignment(s)` field onto each item/node row alters no existing field's meaning (a reader that ignores it
  is unaffected). Testable headlessly: plant projection + assignment inputs, call the function, assert the
  shape — no live SQLite, no server.
- **The read-only invariant test drives the real serve face** over injected `globalStoreOptions`
  (`serveMeshUi`, `mesh-ui-serve.mjs:75-95`); the route table (`:99-216`) is GET/HEAD `status` + `board-url`
  + static, `sendMethodNotAllowed` on every non-GET, `upgrade` unconditionally destroyed — no
  `/api/mesh/assign` handler exists and the extension threads only the READ path. Buildable exactly as tagged.
- **`@uat` render** via cached `ms-playwright` Chromium driven directly (`--headless=new --screenshot=<ABSOLUTE
  forward-slash path>`) — `npx playwright` is policy-blocked (the design-render discipline). The proven m34
  pattern applies unchanged.
- **Wire field name:** the render (tasks 01/03) binds to whatever field name Story 00 freezes on the
  `items`/`nodes` rows — the contracts assert behaviour, not key spelling.
- **Build-order:** `03 → 00` ONLY. Fully parallel to stories 01/02 (it renders whatever assignment rows exist
  in the store; no live channel or worktree needed).
