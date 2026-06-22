---
type: story
number: 03
slug: graph-fitness
title: "The graphify fitness functions — registration+CLI, no-face-spawn, binary-absent, privacy, graph.json, no-npx — as arch-tests"
parent: 09
status: in-review
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
---
# 03 · The graphify fitness functions — the load-bearing structural guarantee

## User story

As the architecture itself (the "graphify arrives as commands, faces are thin, the binary is provisioned, privacy is respected" guarantee),
I want the six structural invariants of ADR-006 — graph commands registered with a CLI form, no face spawning graphify, the binary-absent clean failure, the privacy boundary never widened, the result derived from `graph.json` not stdout, and the npx installer left untouched — enforced as CI arch-tests,
so that the contract is **durable**: a future change that adds a graph face spawning graphify, a `graph:*` command the CLI cannot run, a result parsed from stdout, a source-code egress, or an npx install of graphify fails CI loudly instead of silently re-introducing the drift.

## Tasks

<!-- This story's deliverable is the FITNESS FUNCTIONS of ADR-006 — arch-tests, NOT task `.feature`
     scenarios (structural invariants belong in the fitness-functions table, never inside a behaviour
     feature; see the ARCHITECTURE.md closing note). Its contract is therefore already fully specified by
     ADR-006's fitness-functions table — there is no Three-Amigos `.feature`-authoring pass to run;
     `aof:continue 09/03` authors the six arch-tests directly and they turn GREEN as 00/01/02 land.
     The six arch-tests are tracked here as the story's buildable units. -->

- [x] `test/arch/acd-graph-command-cli-bijection.test.mjs` — **registration + CLI bijection**: the three `graph:*` commands are in the same `listCommands()` registry, each with a `cli` adapter and a reachable `aof graph <verb>` dispatch — ADR-006 inv. 1
- [x] `test/arch/acd-graph-no-face-spawn.test.mjs` — **no face spawns graphify**: the only `graphify`-binary spawn in `src/` is in `src/graphify.mjs`; no skill/MCP/board face and no `graph:*` command spawns it — ADR-006 inv. 2
- [x] `test/arch/acd-graph-binary-absent.test.mjs` — **binary-absent clean failure**: `resolveGraphifyBinary()` returns a structured `{found:false,hint}` with install guidance, never an opaque ENOENT; the doctor check degrades to `warning`, never crashes — ADR-006 inv. 3
- [x] `test/arch/acd-graph-privacy-boundary.test.mjs` — **privacy not widened**: no aof path ships source code / AST to a backend; a null/absent backend passes no `--backend` flag (zero egress) — ADR-006 inv. 4
- [x] `test/arch/acd-graph-json-normalization.test.mjs` — **result from graph.json, not stdout**: the normalizer reads `links` (not `edges`), preserves `confidence`/`confidenceScore`, keeps `hyperedges` separate, against a real fixture; stdout is never parsed for data — ADR-006 inv. 5
- [x] `test/arch/acd-graphify-no-npx-install.test.mjs` — **npx installer untouched**: no aof code provisions graphify via npx and `src/frameworks.mjs` gains no Python/uv/pipx lane (GREEN-now regression guard) — ADR-006 inv. 6

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-006 — the load-bearing
deliverable**). This story **owns** the six arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It authors **no production code**.

**Independent because** it asserts against the **frozen** driver/registry (story 00) and the structural
surfaces of 01/02 (the doctor check, the rendered-face bodies) — but consumes **none of their internals**:
it source-greps the spawn surface, imports the registry, stubs PATH empty, and feeds a committed `graph.json`
fixture through the normalizer. Owning no production code, it cannot block — or be blocked by — the siblings'
internals; it goes GREEN once they land and stays load-bearing forever after. `acd-graphify-no-npx-install`
is GREEN now (a regression guard) — the other five are RED-until-built.

> **Note (a separately-tracked deliverable, not a behaviour story):** the SPEC names the enforcing
> fitness/doctor guarantees as load-bearing, so they get their own owner and review surface here. But the
> units are *arch-tests*, not `.feature` files — there is no Three-Amigos Contract pass; the contract is
> ADR-006 (mirrors milestone 08/03).

**Feasibility (developer amigo seat — confirmed at Contract):** buildable against the real seam — every test
reuses an existing house idiom: registry-import + CLI spawn-and-parse (`acd-work-command-cli-bijection`),
source-grep with the call-form-not-comment discipline (`acd-terminal-server-only`), and the fixture-driven
contract test. Five of the six target paths (`src/graphify.mjs`, `src/commands/graph-*.mjs`, the doctor check,
the face assets) are confirmed **absent** today — RED-until-built is the correct state; the sixth (no-npx) is
GREEN now and must stay green.
