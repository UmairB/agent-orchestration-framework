---
type: milestone
number: 11
slug: graphify-codebase-intelligence
title: "Graphify Codebase Intelligence — grounding for the ACD agents"
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-07-03
depends: [09]
origin: wiki/planning/PRD-graphify-integration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 11 · Graphify Codebase Intelligence — grounding for the ACD agents

## Objective

Give aof's ACD agents the **codebase grounding they currently lack** by wiring a graphify codebase
knowledge graph into the agent loop — reached through the registered graph commands (milestone 09),
never a bespoke agent-side integration. Today the aof-architect reviews structure by grep-and-infer
and refine draws story boundaries from reading; a real call / dependency graph replaces guesswork with
fact. Three decision points consume it: the **architect** reads the graph during structural review
(actual coupling, not inferred); **refine** consults it when drawing independent story boundaries (so
boundaries follow real coupling, the load-bearing property of an ACD story); and **code-review**
surfaces graphify's `prs --triage` PR-impact ranking.

The surface is **advisory and derived-from-source** — it grounds agent judgment; it does not auto-act,
gate, or mutate work or PRs. The wiring follows the milestone-05 precedent (its story 03 "wire the
seam into the loop"): a capability nothing calls grounds nothing, so the win is the hooks into
`refine` / `continue` / `code-review`, not just the availability of a graph.

An outsider can verify the objective is met when a structural-review or refine run cites graph-derived
structure for a real change, and a code-review run surfaces a triage ranking for a PR — all reached via
`aof graph …` commands, with no automated action taken on the findings.

## Scope

In scope:
- **A codebase-graph surface** reached through the milestone-09 graph commands (query / triage over
  the repo), consumed by the architect (structural review), refine (story-boundary drawing), and
  code-review (PR-impact triage).
- **The wiring into the bundled `refine` / `continue` / `code-review` commands** so the grounding
  actually reaches the agents at the decision point (the milestone-05 "wire the seam into the loop"
  precedent) — the load-bearing deliverable, not mere availability.
- **Graph freshness / derivation** — the consumed graph is built from current source via 09's
  commands; staleness is visible, not silently served.

Out of scope:
- **Auto-acting on graph findings** — advisory only; no automated gate, merge, or work mutation. The
  agent decides; the graph informs.
- **The memory / recall seam** — that is milestone 10; both 10 and 11 fan out from 09 independently.
- **New graphify capabilities** beyond its published surface (query, `prs --triage`, call-graph
  export).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 11.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-06-22` (`aof:refine 11 --autonomous`) into **four** stories — **00 is the spine; 01 / 02
fan out from its frozen convention in parallel; 03 (fitness) asserts against all three** (the critical path
is 00 only). See [ARCHITECTURE.md](ARCHITECTURE.md) (6 ADRs + a 4-row fitness table) for what each consumes.
The load-bearing decisions are resolved: **(1)** the grounding reaches all three consumers as
**agent-consumed command OUTPUT** (`graph:query` answers for coupling, `graph:triage` queue for PR-impact),
legible-to-an-agent and **never parsed by aof** — the crux that distinguishes 11 from 10 (10's consumer was
a *program* needing structured `graph.json`; 11's are *LLM agents* that read graphify's markdown natively),
ADR-001. **(2)** 11 is **pure prompt-wiring** over the existing 09 commands — **zero production code**; aof
adds no new module/command/helper/render (ADR-002). **(3)** Freshness is a **build-fresh-at-the-decision-point**
prompt discipline over `graph:build` (already returns `builtAt`/`egress`); the codebase graph is a
**git-ignored derived** artifact (ADR-003) — closing a cross-milestone gap (`graphify-out/` is un-ignored
today). **(4)** Advisory-only: no `graph:*` output feeds a gate/merge/work-mutation (ADR-004). Scope = the
**codebase** (`graph:build { path: src }`), distinct from 10's work-stream scope (ADR-005). Contracts
authored `2026-06-22` (Three Amigos: PO scenarios + QA examples/tagging + developer feasibility) for
00/01/02; 03's contract is the ADR-006 fitness table itself (four arch-tests, no `.feature` pass — mirrors
05/03, 09/03, 10/03).

- [x] **00 · [grounding-convention-and-discipline](stories/00_story_grounding-convention-and-discipline/STORY.md)** —
  the shared grounding convention (build-fresh → run the registered command → read the legible output → cite
  it) + the freshness/derivation discipline (git-ignore `graphify-out/`, closing the open gap) + the
  advisory-only boundary + the no-op-when-absent gate (ADR-002/003/004). The spine. 2 tasks.
- [x] **01 · [architect-refine-coupling-grounding](stories/01_story_architect-refine-coupling-grounding/STORY.md)** —
  the two coupling seams: the `aof-architect` agent prompt (structural review + story boundaries, inherited by
  `continue` + `code-review`) and `refine.md` step 2 read `graph:query` coupling (ADR-001/002). Consumes 00's
  convention. 2 tasks.
- [x] **02 · [code-review-pr-impact-triage](stories/02_story_code-review-pr-impact-triage/STORY.md)** — the
  PR-impact seam: `code-review.md` step 3 surfaces `graph:triage`'s ranked queue as advisory review context
  (ADR-001/004). Consumes 00's convention. 1 task.
- [x] **03 · [codebase-intelligence-fitness](stories/03_story_codebase-intelligence-fitness/STORY.md)** — the
  four enforcing arch-tests (ADR-006 — the load-bearing deliverable): no-parse, via-commands (no new
  spawn/module), advisory-only, derived/git-ignored. Asserts against 00/01/02; no `.feature` pass. 4 arch-tests.

## Dependencies

- **09 · graphify-command-core** — the agents reach the graph only through 09's registered commands
  (query / triage) and rely on its Python-binary provisioning decision. Independent of milestone 10
  (graph memory backend) — both consume the 09 contract and can build in parallel.
