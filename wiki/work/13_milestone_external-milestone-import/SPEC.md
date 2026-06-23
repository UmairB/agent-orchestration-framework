---
type: milestone
number: 13
slug: external-milestone-import
title: "External Milestone Import — ingest existing milestones as agent knowledge"
status: done
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
depends: [05, 10]
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 13 · External Milestone Import — ingest existing milestones as agent knowledge

## Objective

Give aof a way to **learn from milestones it didn't run**. Today aof's knowledge is bounded by work
done *inside* its own stream; a wealth of prior art — milestones delivered in other repos, some
aof-shaped, most not — is invisible to the ACD agents. This milestone adds a **new aof command that
ingests an existing milestone from a given repo and incorporates it as reference knowledge**: it
recovers the milestone's intent and what it actually delivered into a normalized, legible form, then
indexes that into aof's memory / recall backend so the agents can ground future planning, refinement,
and review in real precedent instead of starting cold.

The import is **knowledge, not managed work** — an imported milestone never becomes a
refinable / continuable / verifiable aof work item; it informs the agents, it is not driven to done.
It is a **one-time snapshot**: re-running re-imports fresh; there is no live link or incremental sync,
and the source repo is never mutated.

An outsider can verify the objective is met when: pointing the command at an external repo's milestone
— whether aof-structured or arbitrary — produces a recoverable knowledge record for it, that record is
recall-able through aof's memory seam, and a later `refine` / review run can surface the imported
precedent — with **no managed work item created** and **no source touched**.

## Scope

In scope:
- **A new aof import command** — the seam that ingests an existing milestone from a given repo. The
  load-bearing deliverable: a capability nothing invokes grounds nothing (the milestone-05 / -11
  "wire the seam into the loop" precedent), so the win is import reaching memory, not mere parsing.
- **Source-shape tolerance** — handles both aof-structured milestones and arbitrary repos (README,
  docs, ADRs, commit history). Recovers what is *present*; never fabricates SPEC/stories/tasks the
  source never had ("absence is information").
- **A normalized per-milestone knowledge record** — *working hypothesis*: a recovered SPEC-like
  "what it set out to do" plus an OUTPUT-like "what it delivered / decided / learned". The exact
  artifact shape (and whether `OUTPUT.md` is a new doc type or a reuse) is resolved at `refine`.
- **Indexing into the memory / recall backend** (the 05 / 10 seam) so imported precedent is
  recall-able by the ACD agents at the decision points where prior art helps.
- **One-time snapshot semantics** — re-run to refresh; read-only on the source.

Out of scope:
- **Importing as a managed work item** — no `refine` / `continue` / `verify` over an imported
  milestone; knowledge only. The import grounds the agents; it does not become work to drive.
- **Live sync / change-detection / incremental refresh** — one-time snapshot only; a synced/live
  link is deferred to a later milestone.
- **Authoring new work or product strategy from the import** — it grounds agent judgment; it does
  not plan, gate, or mutate the work stream.
- **General-purpose document ingestion** beyond milestone-scoped knowledge — the unit of import is a
  milestone, not arbitrary content.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 13.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-06-22` (`aof:refine 13 --autonomous`) into **four** stories — **00 is the spine; 01 / 02
fan out from its two frozen contracts (the materialize artifact shape + the import-store layout) in
parallel, and 03 (fitness) is authored in parallel against the frozen ADRs** (the critical path is 00
only). See [ARCHITECTURE.md](ARCHITECTURE.md) (5 ADRs + the fitness-function table) for the resolved
decisions. The four open `refine` questions are settled: **(1)** the artifact is a **pair** — a recovered
`SPEC.md` (legible intent, *not* indexed) + an `ARCHITECTURE.md`/`RETROSPECTIVE.md`-shaped knowledge
artifact reusing the 05 heading conventions, so the **EXISTING** parsers index it with **no new
`OUTPUT.md` doc type and no new parser** (ADR-001). **(2)** The command is top-level `aof import milestone
<repo> <selector>`, a registered `import:milestone` Command, read-only on the source via the
`planning-init` `git`-argv-spawn idiom, with `--dry-run` (ADR-002). **(3)** It feeds the **existing** 05/10
memory store by **extending the indexer's scan** to the import store — no bespoke store, no direct
index-JSON write, graphify reached only by the backend via the 09 commands (ADR-003). **(4)** Materialized
imports live in a dedicated `.aof/` import store **outside `workDir`**, git-ignored, non-`NN_type_slug`, so
the work-item resolver never treats an import as managed/refinable work (ADR-004). The minimal
load-bearing slice (the SPEC's "import reaching memory") is `00 → 02` over an aof-structured source.

- [x] **00 · [import-command-and-materialize](stories/00_story_import-command-and-materialize/STORY.md)** —
  the registered `import:milestone` command + CLI face + `--dry-run`, the read-only source-access seam, and
  the **frozen** materialize artifact pair + `.aof/` import-store layout (ADR-001/002/004). **The spine /
  critical path.**
- [x] **01 · [source-shape-recovery](stories/01_story_source-shape-recovery/STORY.md)** — the recovery
  heuristics that turn an aof-structured OR arbitrary source repo into story 00's frozen artifact set,
  recovering what is present and marking what is absent — never fabricating (ADR-001/005). _Collect the
  user's example repos here._
- [x] **02 · [import-into-memory](stories/02_story_import-into-memory/STORY.md)** — extend `buildRecords`'
  scan to the import store + trigger a backend `reindex` so imported precedent is **recall-able** through
  the unchanged `aof work memory` verbs (ADR-003). **The load-bearing "import reaches memory" win.**
- [x] **03 · [import-fitness](stories/03_story_import-fitness/STORY.md)** — the six enforcing arch-tests
  (artifact-shape, read-only-source, indexer-extends-scan, no-graphify-spawn, not-a-work-item,
  derived-index); the contract is the ARCHITECTURE.md fitness table (no `.feature`, mirrors 05/03 & 10/03).

## Dependencies

- **05 · work-memory** — the memory store the recovered knowledge lands in; import is a producer for
  it.
- **10 · graphify-memory-backend** — the graph-grounded recall seam the agents reach imported
  precedent through; import feeds this backend rather than a bespoke side-channel.
