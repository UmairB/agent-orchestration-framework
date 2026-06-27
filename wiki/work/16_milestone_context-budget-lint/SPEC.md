---
type: milestone
number: 16
slug: context-budget-lint
title: "Context-Budget Lint — a doc-bloat health metric for agent context"
status: done
owner: product-owner
created: 2026-06-25
updated: 2026-06-25
depends: [15]
origin: wiki/planning/PRD-work-artifact-health.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 16 · Context-Budget Lint — a doc-bloat health metric for agent context

## Objective

aof generates and feeds long-form markdown — SPEC / ARCHITECTURE / STORY — to every downstream agent.
The best-practice catalog's single loudest rule is "keep agent context lean": a 600-line SPEC poisons
every agent that reads it. The `work:doctor` engine (milestone 15) carries the structural-health groups
but no signal for *context bloat* — an artifact can be perfectly coherent and still far too long to be a
good agent input.

This milestone adds a **doc-bloat check-group** to the existing `work:doctor` command: per-artifact
line / size budgets for the long-form context docs agents consume, warning when an artifact exceeds a
configurable budget. It registers as a new check-group in the *same* registered command — inheriting the
`--json` / `--strict` contract and the CLI / board / MCP faces milestone 15 built — and is otherwise
independent of the other check-groups (parallel-eligible once the doctor foundation exists).

An outsider can verify it: a milestone carrying an over-budget SPEC / ARCHITECTURE / STORY surfaces a
severity-tagged, coded doc-bloat finding through the unchanged `aof work doctor` surface; an artifact
within budget yields none; and the budget is configurable rather than a baked-in constant.

## Scope

In scope:
- **A doc-bloat check-group plugged into the milestone-15 `work:doctor` command** — per-artifact line /
  size budgets for the long-form context docs (SPEC / ARCHITECTURE / STORY) agents consume, warning when
  an artifact exceeds a configurable budget (the catalog's "keep CLAUDE.md lean" rule, generalized to
  ACD artifacts). Findings carry the same **severity** + stable machine-code shape the milestone-15
  engine already defines.
- **Inherited faces, no new door** — the new group surfaces through milestone 15's existing `--json`
  envelope, `--strict` promotion, and CLI / board / MCP faces; the budget is read from config, not
  hard-coded.

Out of scope:
- **The `work:doctor` foundation itself** — the command, its `--json` / `--strict` contract, and the five
  structural check-groups are **milestone 15 · work-doctor-core**, not this milestone.
- **`.claude/rules/` lazy-loaded context rendering** — rendering per-path, lazy-loaded rules is a
  complementary `assets` / render arc, not a health check; captured in the PRD's adjacent-techniques list.
- **Auto-repair / `--fix` and agent-layer semantic checks** — the same exclusions milestone 15 draws;
  doctor stays read-only and deterministic, the agent-layer stays in `/aof:validate`.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 16.
     Broken down by `aof:refine 16 --autonomous` (2026-06-25); see ARCHITECTURE.md ADR-007 for why this is
     a SINGLE non-splittable story (one check family plugged into the m15 engine; faces inherited free).
     The milestone is accepted when its story is. -->

- [x] **00 · [doc-bloat-check-group](stories/00_story_doc-bloat-check-group/STORY.md)** — the configurable
  context-budget lint: a snapshot extension recording per-artifact line counts (ADR-002), a
  `budgetsFromConfig` resolver with documented defaults (spec 300 · architecture 700 · story 150) + the
  `budgets` schema block (ADR-005/006), and the pure `budgetGroup` fn in a new module
  `src/work-doctor-budget.mjs` appended to `CHECK_GROUPS` (ADR-001) — emitting a `doc-over-budget` warn
  finding, anchored at the over-budget file, for any SPEC/ARCHITECTURE/STORY over its budget. No new
  command, no new face.

## Dependencies

- **15 · work-doctor-core** — this milestone registers a new check-group in the `work:doctor` command
  that milestone 15 authors, and inherits its `--json` / `--strict` contract and CLI / board / MCP faces.
  Without the doctor command and its per-finding severity / machine-code shape there is no surface to plug
  a doc-bloat group into. Otherwise independent of milestone 15's other check-groups — parallel-eligible
  once the foundation lands.
