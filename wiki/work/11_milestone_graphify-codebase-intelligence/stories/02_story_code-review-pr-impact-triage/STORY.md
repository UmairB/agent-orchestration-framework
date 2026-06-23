---
type: story
number: 02
slug: code-review-pr-impact-triage
title: "Code-review PR-impact triage — surface graph:triage's ranked queue as review context"
parent: 11
status: in-review
owner: product-owner
created: 2026-06-22
updated: 2026-06-23
---
# 02 · Code-review PR-impact triage — the ranked queue as advisory review context

## User story

As the reviewer in `aof:code-review`,
I want `aof graph triage` wired into step 3 "Review" — *run the triage over the PR, surface the ranked impact queue as context when handing the diff to `aof-architect`* —
so that the structural review is **ranked by real PR-impact** (which changed modules are highest-impact / most-coupled) instead of reviewing the diff blind to blast-radius — reached through the registered 09 `graph:triage` command, **advisory-only** (ranking context for the reviewer, never an auto-block on the merge gate), and a silent no-op when graphify is absent.

<!-- The PR-impact triage consumer — the ONLY seam that uses graph:triage. It touches ONLY
     code-review.md step 3; the triage signal is unused by story 01's coupling seams. It shares only
     story-00's convention. graph:triage is CLI-only (09/ADR-001: no MCP triage tool, no stable --json),
     so this seam runs the CLI command and the agent reads the opaque ranked-queue markdown — never
     parsed by aof (ADR-001). -->

## Tasks

<!-- Contract authored 2026-06-22 via Three Amigos (`aof:refine 11 --autonomous`): PO headline Scenarios
     + aof-qa Examples/tagging + aof-developer feasibility. Prompt text — NO @executable render (the
     command OUTPUT is the context, ADR-001/ADR-002); the observable "code-review surfaces a triage queue
     for a real PR" is @manual (live binary + a real PR + an agent). The advisory-only boundary (the
     triage never auto-blocks the merge) is pinned structurally by story 03's
     acd-codebase-grounding-advisory arch-test, not by a scenario here. -->

- [x] **00 · [code-review-triage-grounding](tasks/00_code-review-triage-grounding.feature)** — `@manual`: `aof:code-review` step 3, when spawning `aof-architect` on the PR diff, runs `aof graph triage [--pr N]` and **surfaces the ranked impact queue** as review context; the queue is **advisory** (the reviewer's verdict and the existing merge gate — CI-green + no-blocking-finding, step 6 — are unchanged; the triage is never an auto-block input — ADR-004); silent no-op when graphify is absent (reviews unranked, as today). _`@manual` signed off `2026-06-22` (`aof:verify`): the `code-review.md` step-3 seam carries build-fresh → `aof graph triage` (plain = `prs --triage`; `--pr N` = single-PR drill-down, stated honestly) → READ → advisory (merge gate unchanged; no wire into `autoComplete`) → no-op. Live `aof graph triage` returned legible ranked-queue markdown — **mechanism CONFORMS**; "for a real PR" content unobservable (0 open PRs against `main` to rank)._

**Build + review (2026-06-22, `aof:continue 11`):** `src/bundle/commands/code-review.md` step 3 wired —
when handing the PR diff to aof-architect, build the codebase graph fresh + run `aof graph triage` (the
ranked queue; `--pr N` = single-PR drill-down, stated honestly per the verified `src/graphify.mjs:180-187`
behaviour), surface the ranked queue as **advisory** context; the step-6 merge gate is **unchanged** (no
wiring into `work.codeReview.autoComplete`). ZERO production code (ADR-002). **Architect: CONFORMS**
(ADR-004 advisory / ADR-001 agent-reads-opaque-markdown). **QA: PASS** (the Examples table matches the real
command arg-mapping). Task is `@manual` (no `@executable`); agent-observed sign-off at `aof:verify`.
Remaining for `done`: the `@manual` live-binary + real-PR + agent sign-off at `aof:verify`.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** the triage queue is opaque
markdown the agent reads, never parsed, **ADR-002** the one prompt-wiring edit — `code-review.md` step 3,
**ADR-004** advisory-only / the merge gate is unchanged, **ADR-005** reach via the 09 `graph:triage`
command — CLI-only). This story **owns** the edit to
[src/bundle/commands/code-review.md](../../../../../src/bundle/commands/code-review.md) step 3 (the
`graph:triage` PR-impact step). It **consumes** story-00's convention and the frozen 09 `graph:triage`
command unchanged; it adds **no production code** and parses **nothing** (the agent reads the ranked-queue
markdown — ADR-001).

**Independent because** it touches ONLY `code-review.md` step 3 and consumes the `graph:triage` signal —
which neither the architect nor refine coupling seam (story 01) uses. It shares only story-00's convention;
no overlap with 01's `graph:query` coupling path.

**Carry into the build (verified at refine — `src/graphify.mjs:180-187`):** the triage verbs are
**mutually exclusive** at the spawn — `aof graph triage` (no pr) → `graphify prs --triage` = the **ranked
PR-impact queue** (the ranking the reviewer surfaces); `aof graph triage --pr N` → `graphify prs N` = a
**single-PR impact drill-down, NOT a ranked queue** (`--pr N` suppresses `--triage`). So the step's primary
surface is the plain `aof graph triage` ranked queue; `--pr N` is the optional drill-down — the contract's
Examples state this honestly (do not assume `--pr N` returns a ranked queue). Surface the queue **without
re-ordering the existing finding/merge flow** — it is added context in step 3, not a new gate in step 6.
Keep the advisory line explicit in the prompt so the boundary is legible to the reviewer and to story 03's
arch-test.
