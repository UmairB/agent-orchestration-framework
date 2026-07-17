---
type: story
number: 00
slug: work-ui-rename
title: "aof work board → aof work ui — the deliberate CLI serve-verb rename; the frozen /api/work envelope + milestone-03's board stay byte-identical"
parent: 25
status: done
owner: product-owner
created: 2026-07-01
updated: 2026-07-02
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
  Break-down stage (aof:refine 25): the user story + the ownership map are set; the task
  `.feature` contract is authored later via Three Amigos (`aof:refine 25/00`).
-->
# 00 · `aof work board` → `aof work ui` — the deliberate serve-verb rename

## User story

As an operator who drills from the fleet view into a single work stream's board — and as the ACD discipline
that treats milestone 03's registered board + its **frozen `/api/work` envelope** as load-bearing,
I want `aof work board` renamed to **`aof work ui`** — the CLI serve verb *only* (a deliberate ACD change,
PRD §8, **not** a drive-by), leaving the frozen `/api/work` envelope and `board-ui.mjs` **byte-identical**,
so that the per-stream board becomes the coherently-named **drill-in target** the fleet view (story 02) links
into, while milestone 03's structural guarantees — one same-origin server, write-isolation, the registry-only
door, the route↔command bijection — all **carry forward GREEN, unchanged**.

<!-- This is the SMALLEST, most isolated of the three moves and the FOUNDATION the fleet view drills into.
     ADR-001 confirmed against source: the board is a CLI-only serve verb (NOT a registry command), so the
     rename is a cli.mjs surface edit — it does NOT touch board-ui.mjs's 6 frozen /api/work routes, nor the
     `?mode=board` serve param, nor setup-ui.mjs. Graph-isolated: board-serve.mjs ← cli.mjs (1) → setup-ui.mjs
     (1), touching NO mesh module. Fully PARALLEL with story 01 (disjoint functions in the one shared file
     cli.mjs — workCommand's board branch vs mesh-identity.mjs). -->

## Tasks

Contract authored `2026-07-02` via Three Amigos (`aof:refine 25/00 --autonomous` cascade — PO headline
Scenarios, `aof-qa` Examples/tables, `aof-developer` feasibility). All flags resolved; suite green.

- [x] **[00 · the verb rename](tasks/00_work-ui-verb-rename.feature)** `@cli @work @board @executable` — `aof work ui`
      launches the board; `aof work board` falls through to the unknown-sub help (exit 1, stderr, `Unknown work
      command "board".`); `--port` + the busy-port refusal carry forward; both usage surfaces read `ui`.
      **Dev-locked:** the rename is FAITHFUL — top-level usage keeps `[--port]`, the work-help keeps `[--port 4180]`
      (the two real source shapes, `cli.mjs:2423`/`:359`); default port `4180`; the `?mode=board` serve param
      unchanged. *Build reminder:* the stale `aof work board` comment at `src/terminal-ws.mjs:52` rides this diff.
- [x] **[01 · the board serves unchanged](tasks/01_board-serves-unchanged.feature)** `@cli @work @board @executable` —
      launched under the renamed verb, the **eight** frozen `/api/work` routes answer byte-identically: 7 GET
      (list/doc/tasks/run-status/validate/doctor/**next**) + POST **feedback**, the one-origin static+API+terminal,
      and the frozen error envelope (not-found 404, ref-not-found 404, empty/malformed-json 400, payload-too-large
      413 at the `>1_000_000`-byte cap). **Dev-corrected:** ADR-001/SPEC's "six routes" is an undercount — real
      count is eight (see STATE reconciliation).
- [ ] **[02 · operator docs renamed](tasks/02_operator-docs-renamed.feature)** `@docs @work @board @manual` — the live
      operator surfaces (`README.md:23/:84/:149`) read `aof work ui`; the historical records (`wiki/work/**`, the
      PRD that *specifies* the rename) keep their wording — the sweep excludes `wiki/work` **and** `wiki/planning`.

_Fitness function this story owns (arch-test — structural invariant, never a `.feature`):_

- [ ] **`acd-work-ui-rename-complete`** (ADR-001, WRITE at build — the XOR/consistency form, suite-safe) — in
      `workCommand` (isolated body, comments discounted, the bijection-grep idiom): `subcommand === "board"` is
      ABSENT **iff** `subcommand === "ui"` is PRESENT (exactly one of the two branch literals). It flips to the
      renamed side automatically when the rename lands — the "it actually happened" proof.

_Fitness functions this story CARRIES FORWARD green, unchanged (they target `board-ui.mjs`/`setup-ui.mjs`,
which the rename does not touch — the proof the rename is envelope-safe):_

- [ ] **`acd-board-single-server`**, **`acd-board-write-isolation`**, **`acd-work-ui-no-core-import`**,
      **`acd-work-command-route-coverage`**, **`acd-work-command-cli-bijection`** — all stay GREEN with no
      edit (the `03/ADR-001` one-server, `03/ADR-004` write-isolation, `08/ADR-004 inv.3` registry-only-door,
      `15/ADR-005` route-bijection guarantees are unmoved by an operator-facing verb rename).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) **ADR-001** (the deliberate serve-verb rename;
the board is a CLI-only serve verb, so the frozen envelope + m03's registered board stay byte-identical) and
[DESIGN.md](../../DESIGN.md) (`aof work ui` is **visually unchanged** from m03's board — no new mock/baseline;
its conformance baseline stays `03/DESIGN.md` + `21/DESIGN.md`).

**Dependencies:** none — fully independent, **parallel with story 01**. Story 02 (`aof mesh ui`) depends on
THIS story for the drill-in target name (`aof work ui`, the renamed verb it links/launches).
