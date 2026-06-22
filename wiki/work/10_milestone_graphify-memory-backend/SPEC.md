---
type: milestone
number: 10
slug: graphify-memory-backend
title: "Graphify Memory Backend — graph-grounded recall"
status: not-started
owner: product-owner
created: 2026-06-21
updated: 2026-06-21
depends: [05, 09]
origin: wiki/planning/PRD-graphify-integration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 10 · Graphify Memory Backend — graph-grounded recall

## Objective

Make graphify a **selectable backend behind `aof work memory`**, fulfilling the slot milestone 05
deliberately left open: *"richer semantic backends (e.g. MemPalace) plug in behind the same verbs
later without touching a single agent prompt."* graphify is a concrete fill for that slot. This
milestone's backend answers `recall` / `brief` / `ingest` / `reindex` / `status` by querying a
graphify graph built over the work stream (`wiki/work/**` — the RETROSPECTIVE R-entries and
ARCHITECTURE ADRs the local backend already indexes) and optionally the codebase — so recall becomes
**graph-grounded** rather than BM25-lite, while the agent-facing verb surface stays byte-for-byte
unchanged (the whole point of 05's backend-agnostic seam).

The backend reaches graphify **through the registered graph commands from milestone 09** — no bespoke
second integration. It is selected with `memory.backend = graphify` in `.aof/aof.config.json` and
falls back gracefully when graphify's binary is absent. The load-bearing constraint carries over from
05: memory is a **derived index** — the graph is fully rebuildable from the `.md` source and holds no
fact absent from it; without that, the graph becomes the drift vector ACD exists to defend against.

An outsider can verify the objective is met when, with `memory.backend = graphify`, an agent building
milestone N+1 recalls a lesson first written in milestone N via graph-grounded retrieval, **and** a
fitness function confirms the graph holds nothing absent from its `.md` source.

## Scope

In scope:
- **A graphify memory backend** implementing the milestone-05 backend interface
  (`recall` / `brief` / `ingest` / `reindex` / `status`), dispatched to through the existing
  `memory.backend` selection — no change to the verb surface or any agent prompt.
- **Graph construction over the work stream** — the RETROSPECTIVE R-entries and ARCHITECTURE ADRs
  across `wiki/work/**` (the local backend's existing sources), reached via the milestone-09 graph
  commands; optionally extended to the codebase.
- **The derived-index invariant for the graph backend** — `reindex` fully reconstructs the graph from
  source; a fitness function asserts the backend holds no fact absent from its live `.md` source
  (the same guarantee 05 enforces for the local index).
- **Config + fallback** — `memory.backend = graphify` selection; a graceful no-op / fallback when
  graphify's binary is unavailable (surfaced by `aof project doctor`).

Out of scope:
- **Replacing the zero-dependency local backend** — it stays the default; graphify is an opt-in
  alternative behind the same verbs.
- **Changing the `aof work memory` verb surface or any agent prompt** — unchanged by contract; that is
  exactly what 05's seam buys.
- **Codebase-graph grounding for the ACD agents** — structural review / story-boundary / PR-triage is
  milestone 11 (both 10 and 11 consume 09 independently).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 10.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

- [ ] _to be broken down — `aof:refine 10`_

## Dependencies

- **09 · graphify-command-core** — the backend answers through 09's registered graph commands (build /
  query) and relies on 09's Python-binary provisioning decision; it consumes the graphify contract,
  never graphify directly.
- **05 · work-memory** — implements 05's backend interface and plugs into its `memory.backend`
  selection seam; preserves 05's derived-index invariant. This milestone fills the semantic-backend
  slot 05 reserved by design.
