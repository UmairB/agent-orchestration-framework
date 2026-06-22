---
type: milestone
number: 11
slug: graphify-codebase-intelligence
title: "Graphify Codebase Intelligence — grounding for the ACD agents"
status: not-started
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
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

- [ ] _to be broken down — `aof:refine 11`_

## Dependencies

- **09 · graphify-command-core** — the agents reach the graph only through 09's registered commands
  (query / triage) and rely on its Python-binary provisioning decision. Independent of milestone 10
  (graph memory backend) — both consume the 09 contract and can build in parallel.
