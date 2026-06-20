---
type: story
number: 02
slug: local-backend-retrieval
title: "Local backend — recall/brief ranking + scope filters"
parent: 05
status: done
owner: product-owner
created: 2026-06-19
updated: 2026-06-19
---
# 02 · Local backend — recall/brief ranking + scope filters

## User story

As an architect or developer about to make a decision,
I want `recall`/`brief` to surface the most relevant prior lesson or ADR first — scope-filtered (area / stage / kind / owner / item) and then ranked so a short on-point lesson beats a long, term-heavy ADR,
so that "we already learned this" reaches me at the moment it would save a repeat mistake, instead of being buried under noise — which is the difference between memory that improves the next milestone and memory nobody trusts.

<!-- The spike's headline finding: ranking, not parsing, is the hard part (F1). This story owns that
     hard part — and the documented ceiling where a semantic backend (MemPalace) later earns its keep. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 05/02`, Contract stage). Each task is done when
     its @executable feature is green. Features are behavioural over a hand-authored FIXTURE INDEX of
     MemoryRecords (frozen ADR-005) — no parser code (story 01), no argv/dispatch (story 00). -->

- [x] `tasks/00_scope-prefilter.feature` — scope filters (area/stage/kind/owner/item) intersected (AND) and applied as a hard pre-filter before scoring; empty scope = all candidates; empty-string-present lesson-only/adr-only fields; no-match case.
- [x] `tasks/01_ranking-no-inversion.feature` — the spike's F1 inversion does not recur: a short on-point lesson ranks at/above a long term-heavy adr; title-match + record-type boosts; highest-score-first; truncation to `limit` (default 5).
- [x] `tasks/02_recall-result-shape.feature` — `recall` returns `{ query, scope, records[], text }` over a fixture; scope echoed; each record a MemoryRecord + numeric `score`; text view projects the same records.
- [x] `tasks/03_brief-digest.feature` — `brief` surfaces the lesson/adr split (counts) + recent-lessons-by-area digest; `--item NN` scopes the brief to one milestone.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md). This story **owns**: the local
backend's `recall` (returning the **frozen `RecallResult`** — ADR-004), `brief` (the lesson/ADR split
+ recent-lessons digest — ADR-007), **first-class scope filters as a hard pre-filter** (F2), and
**BM25-lite length-normalised ranking + title/record-type boosts** (ADR-006) so raw term repetition in
a longer record cannot outrank a shorter, denser match.

**Independent because** it *reads* the **frozen index format** (ADR-005) from a hand-authored **fixture
index** — the milestone-02 "story-01-against-a-PRD-fixture" pattern — so it needs no parser code from
story 01; and it implements `recall` against the **frozen interface** (ADR-003), not the seam dispatch
(story 00). Tests assert *ranked order under scope* (the `acd-memory-ranking` fitness function), not
mere membership. Couples to 00/01 only through ADR-003/004/005.

**Feasibility (developer amigo seat):** proven. The spike already ran recall/ranking over the real
00–04 stream and surfaced R1/R2 and the F1 inversion that ADR-006 fixes; this story builds against a
fixture index with no dependency on 00/01 code. The backend module does not exist in `src/` yet — it
is built at `aof:continue`. No genuine feasibility concern.

**Contract boundary honoured:** the universal invariants (`acd-memory-ranking`,
`acd-memory-recall-contract`) live in the ARCHITECTURE Fitness-functions table and are NOT restated as
universal rules in these features. The features instead pin concrete, example-driven behaviour
(this fixture + this query → this ranked order / these surviving ids / this result shape), including
the spike's exact inversion case — complementing, not duplicating, the arch-tests.
