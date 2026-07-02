---
type: story
number: 02
slug: fleet-ui
title: "aof mesh ui — the read-only fleet web surface; its own thin serve-face over the registry, drilling into each board's aof work ui"
parent: 25
status: done
owner: product-owner
created: 2026-07-01
updated: 2026-07-02
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
  Break-down stage (aof:refine 25): the user story + the ownership map are set; the task
  `.feature` contract is authored later via Three Amigos (`aof:refine 25/02`).
-->
# 02 · `aof mesh ui` — the read-only fleet web surface

## User story

As an operator on any node who wants the **mission-control view of the whole fleet** — the nodes with their
live presence and what each is running, and every board being worked on across the group, each drillable into
its own board,
I want **`aof mesh ui`**: its OWN thin serve-face (a sibling to `aof work ui`, **not** an extension) — one
`http.createServer` on `127.0.0.1` serving a fleet web bundle that reaches fleet data **ONLY** through
`invoke("mesh:status")` (story 01) and drills into each board via that board's renamed **`aof work ui`**
(story 00),
so that from any node I see the fleet's nodes + active boards, a peer's change reflects within the presence
bound, and the read-only render carries **no run/issue logic of its own** (issuing/assigning is milestone 27)
— the frozen board envelope untouched and the board's isolation guards **mirrored** onto the new face.

<!-- This is the THIN RENDERER that closes over both seams — the greenfield fleet web face. ADR-003: its own
     thin serve-face (resolving the STATE open question), NOT an extension of the work UI. The graph shows the
     board serve-face is isolated, so the new sibling adds no coupling beyond command-core.mjs. It DRILLS into
     a board via a link to that board's `aof work ui` (not an embed, not a proxy). MUST SEQUENCE after BOTH
     story 00 (the drill-in target name) and story 01 (the mesh:status aggregate it renders). -->

## Tasks

Contract authored `2026-07-02` via Three Amigos (`aof:refine 25 --autonomous` cascade — PO Scenarios, `aof-qa`
Examples/tables + the browser (Playwright / `toHaveScreenshot`) lane design, `aof-developer` feasibility). All 5
flags resolved. **Dev-locked:** fleet default port **4181** (clears assets-ui 4177/4178 + board 4180); the face
**reuses `ui/dist` with `?mode=fleet`** + the board's `ui-build-missing` friendly-refusal guard; a failed silent
re-poll **keeps last-good** (the m03 `load({silent})` precedent); a never-run board tile reads the m21 family
literal **"No runs yet"**; the peer drill-in is an **honest-locality** affordance (no peer serve-URL exists on
the tree, so a peer-only board shows a copyable `aof work ui` hint attributed to the owner node, never a dead
link).

- [x] **[00 · the fleet serve-face](tasks/00_mesh-ui-serve.feature)** `@cli @work @distribution @executable` — `aof mesh
      ui` stands up ONE `127.0.0.1` server on port 4181; `GET /api/mesh/status` → `invoke("mesh:status")` deep-equals
      the CLI `--json`; the `/api/mesh` namespace is disjoint from `/api/work` (a board request is a 404); unknown
      route + missing-bundle are friendly refusals, not crashes.
- [ ] **[01 · the NODES region](tasks/01_mesh-ui-renders-nodes.feature)** `@ui @work @distribution` — one card per
      roster node (identity + presence-age line + active-runs count + capability footer), the locked 3-state
      presence ramp (live teal / stale muted-grey / no-presence dashed), the run-count line (0→idle, 1→"1 run",
      n→"n runs"), and the page loading/error/empty states. 4 `toHaveScreenshot` candidates (bind to
      `mocks/mesh-ui.png` once committed + designer-CONFORMS).
- [ ] **[02 · the BOARDS region](tasks/02_mesh-ui-renders-boards.feature)** `@ui @work @distribution` — one tile per
      registered board (name + "on `<nodeId>`" owner + the m21 run-state chip verbatim), the running pulse +
      in-flight details, the never-run "No runs yet" tile, the no-boards placeholder. 4 `toHaveScreenshot`
      candidates.
- [ ] **[03 · board drill-in](tasks/03_board-drill-in.feature)** `@ui @work @distribution` — a local board's
      `Open board →` hands off to that board's own `aof work ui` (a link, never an embed/proxy); a peer-only board
      gets the honest-locality hint naming the owner node; the fleet face issues no `/api/work` on drill-in's behalf.
- [ ] **[04 · fleet reflects a peer change](tasks/04_fleet-reflects-peer-change.feature)** `@ui @work @distribution` —
      a peer's change shows on refresh within the m23 bound + one poll; the `⟳` re-polls in place (non-tearing,
      scroll preserved, keep-last-good on a failed silent poll); the client opens no event stream (poll-only).
- [ ] **[05 · the fleet view is read-only](tasks/05_fleet-view-is-read-only.feature)** `@ui @work @distribution` — every
      write-method (incl. the would-be m27 `/api/mesh/issue`,`/assign`) is rejected; rendering mutates no file; no
      `/ws/terminal` upgrade; no mutating control on the page (only drill-ins + `⟳`).

_Fitness functions this story owns (SPECIFY'd in ARCHITECTURE §Fitness Functions; authored HERE at build —
they target the not-yet-existing `mesh-ui-serve.mjs`, so they are RED-until-module by design):_

- [ ] **`acd-mesh-ui-no-core-import`** — `mesh-ui-serve.mjs` imports NO mesh-core/operation module
      (`mesh-store`/`mesh-presence`/`mesh-registry`/`mesh-sync`/`./commands/*`) except `./command-core.mjs`;
      no operation fs write (mirror `acd-work-ui-no-core-import` / `08/ADR-004 inv.3`).
- [ ] **`acd-mesh-ui-single-server`** — served by exactly ONE `http.createServer` bound to `127.0.0.1`; the
      fleet routes live under `/api/mesh*` and NEVER `/api/work*` (mirror `acd-board-single-server`).
- [ ] **`acd-mesh-ui-write-isolation`** — the fleet face performs ZERO fs write and NO shell-out; serves no
      `/ws/terminal` and no write route (mirror `acd-board-write-isolation` + ADR-004 read-only).
- [ ] **`acd-mesh-ui-single-data-command`** (phase 2, story 01 wrote phase 1) — the face's only fleet-data
      reach is `invoke("mesh:status")` (no direct `mesh-store`/`mesh-registry` import).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) **ADR-003** (its own thin serve-face over the
registry; drills into `aof work ui`) + **ADR-004** (read-only; no new threat surface; issue/assign is m27) and
[DESIGN.md](../../DESIGN.md) (the `aof mesh ui` binding checklist + the paste-ready mock brief, Appendix A).

**The mock is owed** at [`mocks/mesh-ui.png`](../../mocks/) — the user generates it from DESIGN.md Appendix A
and commits it as the locally-readable conformance source of truth; until it lands, the DESIGN.md binding
checklist is the baseline the review judges against.

**Dependencies:** **depends on story 00 + story 01** — on **00** for the drill-in target name (`aof work ui`,
the renamed verb it links/launches) and on **01** for the `mesh:status` fleet aggregate it renders. Must
**sequence after both**; it has no other cross-story dependency.
