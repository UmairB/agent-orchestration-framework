---
type: story
number: 03
slug: command-fitness
title: "The enforcing fitness functions — the CLI-as-source-of-truth bijection + the no-UI-core-import guard, as arch-tests"
parent: 08
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
schema: 1
aofVersion: 0.1.0
---
# 03 · The enforcing fitness functions — the load-bearing structural guarantee

## User story

As the architecture itself (the "the CLI is the single source of truth" guarantee),
I want the three structural invariants — every `/api/work*` route resolves to a registered command, every registered command has a CLI invocation, and the UI face imports no work-core/operation module except through the registry — enforced as CI arch-tests,
so that the pattern is **durable**: a future change that adds a UI route with no command, a command the CLI cannot run, or a direct core import into the UI server fails CI loudly instead of silently re-introducing the drift.

## Tasks

<!-- This story's deliverable is the FITNESS FUNCTIONS of ADR-004 — arch-tests, NOT task `.feature`
     scenarios (structural invariants belong in the fitness-functions table, never inside a behaviour
     feature; see the ARCHITECTURE.md closing note). Its contract is therefore already fully specified by
     ADR-004's fitness-functions table — there is no Three-Amigos `.feature`-authoring pass to run;
     `aof:continue 08/03` authors the four arch-tests directly and they turn GREEN as 00/01/02 land.
     The four arch-tests are tracked here as the story's buildable units. -->

- [x] `test/arch/acd-work-command-route-coverage.test.mjs` — **route → command surjection**: every `/api/work*` route the board serves maps to a registered command id (no UI route without a command) — ADR-004 inv. 1
- [x] `test/arch/acd-work-command-cli-bijection.test.mjs` — **command → CLI injection**: every registered command has a non-null `cli` adapter AND a reachable `aof work <sub>` dispatch (no command the CLI cannot run) — ADR-004 inv. 2
- [x] `test/arch/acd-work-ui-no-core-import.test.mjs` — **registry is the only door**: `board-ui.mjs` (and `setup-ui.mjs`'s work path) imports no work-core/operation module except `./command-core.mjs`, and runs no work-operation filesystem call itself — ADR-004 inv. 3
- [x] `test/arch/acd-work-command-no-subprocess.test.mjs` — **in-process boundary**: no `/api/work*` serving path spawns a subprocess to serve the operation — ADR-004 inv. 4 / ADR-001

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-004 — the load-bearing
deliverable**). This story **owns** the four arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It authors **no production code**.

**Independent because** it asserts against the **frozen registry** (story 00) — the bijection
(route↔command, command↔CLI form) and the no-core-import / in-process guards. It is RED until 01 / 02 land
but consumes **neither's code**: route-coverage source-greps `board-ui.mjs`'s route literals; cli-bijection
source-greps `cli.mjs`'s dispatch + spawns the CLI; no-core-import source-greps `board-ui.mjs`'s import
surface. Owning no production code, it cannot block — or be blocked by — the faces' internals; it simply
goes GREEN once they land, and stays load-bearing forever after.

> **Note (not a story, in the milestone-03 sense — a separately-tracked deliverable):** the SPEC names
> "the enforcing fitness function(s)" as a distinct load-bearing deliverable, so it gets its own owner and
> review surface here. But its units are *arch-tests*, not `.feature` files — there is no Three-Amigos
> Contract pass; the contract is ADR-004. (Cf. milestone 06 ADR-005, whose no-install guarantee was
> arch-tests-only with no story; here it is elevated to a tracked story because the SPEC elevates it.)

**Feasibility (developer amigo seat — confirmed at Contract):** buildable against the real seam. The house
idiom supplies each test's shape directly — `acd-board-single-server` (stand up `serveSetupUi` over a
fixture stream), `acd-work-list-contract` (CLI spawn-and-parse), `acd-terminal-server-only` (import-boundary
source-grep). All four target paths are confirmed **absent** today (RED-until-built is the correct state).
