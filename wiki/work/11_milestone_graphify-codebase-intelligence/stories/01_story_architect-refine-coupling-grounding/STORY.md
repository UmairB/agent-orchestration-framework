---
type: story
number: 01
slug: architect-refine-coupling-grounding
title: "Architect + refine coupling grounding — the structural-review and story-boundary seams read real coupling"
parent: 11
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
---
# 01 · Architect + refine coupling grounding — actual coupling, not inferred

## User story

As the aof-architect doing structural review, and as refine drawing independent story boundaries,
I want a **codebase-graph coupling step** wired into the `aof-architect` agent prompt (inherited by both `aof:continue` step 3 and `aof:code-review` step 3) **and** into `aof:refine` step 2 "Break down" — *build the codebase graph fresh, run `aof graph query` for the actual call/dependency coupling, read the legible answer, and cite it* —
so that structural review judges **actual coupling** instead of grep-and-infer, and story boundaries **follow real dependencies** (the load-bearing property of an independent ACD story) — both reached through the registered 09 commands, advisory-only, and a silent no-op when graphify is absent.

<!-- The two COUPLING consumers, wired at two prompt sites. They share the SAME signal (graph:query)
     and the SAME story-00 convention; neither touches the PR-impact triage path (story 02). The
     aof-architect.md edit is in the AGENT prompt so it is inherited by BOTH review entry points
     (continue + code-review) with one edit (ADR-002). Refine's boundary grounding is command-specific
     (refine has no architect-review step at break-down) so it lives in refine.md step 2. -->

## Tasks

<!-- Contract authored 2026-06-22 via Three Amigos (`aof:refine 11 --autonomous`): PO headline Scenarios
     + aof-qa Examples/tagging + aof-developer feasibility. The wiring is prompt text — there is NO
     @executable render (the 09 command OUTPUT is the context, ADR-001/ADR-002), so the observable
     "agent cites graph-derived coupling" is @manual (live binary + an agent), exactly the 05/03
     read-hook split (its 01_refine-read-hook / 02_continue-read-hook were @manual). The prompt-content
     presence is pinned structurally by story 03's arch-tests, not by a scenario here. -->

- [x] **00 · [architect-structural-review-coupling](tasks/00_architect-structural-review-coupling.feature)** — `@manual`: the `aof-architect` agent, during structural review, builds the codebase graph fresh and queries actual coupling, then **cites graph-derived coupling** (who-calls/imports-whom, god-nodes) in its verdict — inherited by `aof:continue` step 3 and `aof:code-review` step 3; advisory (informs the verdict, never an auto-fail); silent no-op when graphify is absent (reviews on grep-and-infer as today). _`@manual` **CONFORMS** `2026-06-22` (`aof:verify`): a live `aof-architect` followed its wired `<codebase-graph-grounding>` step against graphify 0.8.44 — built fresh (275·549, builtAt visible), queried coupling, and cited graph-derived coupling (the `COMMANDS registry` hub, community 0/1, single-spawn-site invariant holding) as actual not inferred; advisory-only honoured (nothing auto-failed)._
- [x] **01 · [refine-boundary-coupling](tasks/01_refine-boundary-coupling.feature)** — `@manual`: `aof:refine` step 2 "Break down" consults the codebase graph for real coupling **before** drawing story boundaries, so the partition **follows real dependencies** (cited in the breakdown rationale / `ARCHITECTURE.md`); advisory (the agent draws the partition, the graph informs it — never auto-rewrites it); silent no-op when graphify is absent. _`@manual` signed off `2026-06-22` (`aof:verify`): the `refine.md` step-2 seam carries the full build-fresh → `aof graph query` → follow-coupling → cite → advisory → no-op step; the grounding **mechanism** is the same `graph:query` confirmed live in 01/00; the end-to-end refine-run was dogfooded at build (275·549 graph over `src/`)._

**Build + review (2026-06-22, `aof:continue 11`):** both seams wired — `src/bundle/agents/aof-architect.md`
gained the `<codebase-graph-grounding>` block (build-fresh → `aof graph query` → READ → cite as actual,
advisory, no-op when absent), inherited by BOTH `aof:continue` step 3 and `aof:code-review` step 3 (both
spawn aof-architect); `src/bundle/commands/refine.md` step 2 "Break down" gained the boundary-coupling step
mirroring the memory-recall hook shape. ZERO production code (ADR-002). The derived bundle manifest was
regenerated. **Architect: CONFORMS** (ADR-001 no-parse / ADR-004 advisory / ADR-005 via-commands+`src` scope
all explicit) and **dogfooded live** — built a 275-node/549-edge graph over `src/`, queried it, read the
markdown answer directly (aof never parsed it). **QA: PASS** (contract↔seam fidelity confirmed; the
inheritance Examples match reality). Both tasks are `@manual` (no `@executable` — the command OUTPUT is the
context, ADR-002); their agent-observed sign-off is recorded at `aof:verify`. Remaining for `done`: the
`@manual` live-binary + agent sign-off at `aof:verify`.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** agent reads the legible
`graph:query` answer, never parses, **ADR-002** the two prompt-wiring edits — `aof-architect.md` +
`refine.md` step 2, **ADR-003** build-fresh freshness, **ADR-004** advisory-only, **ADR-005** reach via
the 09 commands / the aof MCP `graph_query` tool + the codebase build scope). This story **owns** the edits
to [src/bundle/agents/aof-architect.md](../../../../../src/bundle/agents/aof-architect.md) (the
structural-review + story-boundary coupling step) and
[src/bundle/commands/refine.md](../../../../../src/bundle/commands/refine.md) step 2 (the boundary-coupling
step). It **consumes** story-00's convention (build-fresh / read-legible-output / advisory / no-op) and the
frozen 09 `graph:build` + `graph:query` commands unchanged; it adds **no production code** and reads
**no `graph.json`** (the agent reads the command's markdown answer — ADR-001).

**Independent because** both wired seams consume the SAME coupling signal (`graph:query`) and the SAME
story-00 convention, and neither touches story 02's `graph:triage` PR-impact path. The two edits ship
together because they are the same coupling consumer wired at two prompt sites. Couples to story 00 only
through the convention and to 09 only through the frozen command contract.

**Carry into the build:** the build target for the codebase graph is the repo's **source root** (e.g.
`src/`, where the call/dependency coupling the architect reasons about lives) — a prompt-step tuning detail
(ADR-005 leaves repo-root-vs-`src/` to the prompt), default `src/`; the agent surfaces the `builtAt`/`egress`
the 09 `BuildResult` already returns so freshness is visible. Mirror the SHAPE of `refine.md` step 1
"Decide"'s existing memory-recall hook (run-then-consider, no-op when off) for the step-2 boundary hook.
