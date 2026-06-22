---
type: milestone
number: 10
slug: graphify-memory-backend
title: "Graphify Memory Backend — graph-grounded recall"
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
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

Broken down `2026-06-22` (`aof:refine 10`) into **four** stories — **00 is the spine; 01 / 02 / 03 fan out
from its frozen contract in parallel** (the critical path is 00 only). See [ARCHITECTURE.md](ARCHITECTURE.md)
(6 ADRs), [RESEARCH.md](RESEARCH.md) (§A–§O), and the runnable pre-refine [spike/](spike/FINDINGS.md) for
what each consumes. The load-bearing decisions are resolved: **(1)** graphify is a file-level ranking
SIGNAL, **not** the record source — `graph:query` is opaque (`09/ADR-001`) and graph nodes carry no line
(`source_location: null`, spike-confirmed), so the records come from the milestone-05 markdown parsers
(`source:line` spine intact) and the graph **re-ranks** them: **"graph-grounded recall" = "graph-reranked
recall over 05's records"** (ADR-001). **(2)** The extraction backend defaults to **`claude-cli`** — the
user's own Claude subscription (no metered key, no third-party key, no shim; graphify-native, spike-proven)
— surfaced + opt-in; **credential-local but NOT data-local** (prose is still sent to Anthropic for
inference; `ollama` is the only on-box option), aof states this plainly (ADR-003). **(3)** Graph scope =
work stream only; codebase grounding stays milestone 11 (ADR-006). Contracts are **not yet authored** — this
refine stopped at the break-down gate (no `--autonomous`); each story's task `.feature` files are authored
at its Contract stage (`aof:refine 10/SS`).

- [x] **00 · [graphify-backend-module](stories/00_story_graphify-backend-module/STORY.md)** — the graphify
  memory backend satisfying the frozen `{name, recall, reindex, status}` interface (`05/ADR-003`); the
  `$defs/memory` enum + `BACKEND_REGISTRY` wiring; `reindex` rebuilding the 05 records + (re)building the
  graph via `invoke("graph:build")`; the `{workspace}` seam-bridge (ADR-001/002/005). The spine. _done — 22 @executable green, @manual live build verified (275-node work-stream graph, claude-cli keyless), F-01 git-ignore fixed._
- [x] **01 · [graph-grounded-reranking](stories/01_story_graph-grounded-reranking/STORY.md)** — the pure
  re-ranker `recall` reads: the work-stream graph re-orders the 05 records by file relatedness, joined by
  `source_file`, on top of 05's base ranking (ADR-001). The value. Fixture-testable, no binary. _done — 13 @executable green; shared `graph-normalize.mjs` extracted (09 preserved); architect PASS._
- [x] **02 · [extraction-posture-and-fallback](stories/02_story_extraction-posture-and-fallback/STORY.md)** —
  the `claude-cli` extraction default + honest classification in `graph-build.mjs` + the binary-absent
  graceful degrade to un-graph-ranked 05 recall (ADR-003/004). Opt-in, never silently networked, never
  crashing. _done — 17 @executable green; claude-cli classified by knowledge; visible per-verb degrade; architect PASS._
- [x] **03 · [graphify-memory-fitness](stories/03_story_graphify-memory-fitness/STORY.md)** — the six
  enforcing arch-tests (records-from-parsers, derived-index, via-command, selection-enum, classified,
  binary-absent-degrades); the contract is the ARCHITECTURE.md fitness table (no `.feature` pass, mirrors
  05/03 and 09/03). Asserts against 00/01/02. _done — all 6 GREEN, mutation-verified non-vacuous; full suite 1067 ok / 0 fail._

## Dependencies

- **09 · graphify-command-core** — the backend answers through 09's registered graph commands (build /
  query) and relies on 09's Python-binary provisioning decision; it consumes the graphify contract,
  never graphify directly.
- **05 · work-memory** — implements 05's backend interface and plugs into its `memory.backend`
  selection seam; preserves 05's derived-index invariant. This milestone fills the semantic-backend
  slot 05 reserved by design.
