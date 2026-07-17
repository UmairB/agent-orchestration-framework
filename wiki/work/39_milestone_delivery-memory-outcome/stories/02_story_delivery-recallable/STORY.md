---
type: story
number: 02
slug: delivery-recallable
title: "Delivery recallable — parse OUTCOME into records and surface them over the ADRs"
parent: 39
status: not-started
owner: product-owner
created: 2026-07-16
updated: 2026-07-16
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
-->
# 02 · Delivery recallable

## User story

As an **agent about to extend a record format** (about to write `warnings_delivered`),
I want a "what provides X / is X built" recall to return the **capability** record for X — not four
verbose ADRs about seal discipline,
so that I learn the field has no producer *before* I invent one, and memory finally answers a product
question, not only a reasoning one.

<!-- Challengeable benefit: the SPEC makes "indexed AND surfaced" the single bar — "Indexing the doc
     and still getting four ADRs back is a failure of THIS milestone, not a follow-up to it." A record
     that is present but unreachable does not close the gap. -->

## Scope & contract

The full recall loop, on the graph-verified 2-importer memory seam (ARCHITECTURE blast-radius note):

- **`parseOutcome(text, meta)`** in `src/memory/local-indexing.mjs`, composed into `buildRecords`
  exactly as `parseAof` was (14/ADR-001) — so `capability` + `gap` records reach `local` AND
  `graphify` with one edit. Emits the frozen `MemoryRecord` (ADR-001 field mapping), records resolving
  to their own `OUTCOME.md:<heading-line>` `source`.
- **Bounded capability ranking** in `src/memory/local-retrieval.mjs` (ADR-003): a
  query-class-conditional `TYPE_BOOST_CAPABILITY` strictly `< TITLE_BOOST_PER_TERM (0.6)` — a
  tiebreaker, never a relevance override — plus the `area="delivery"` hard pre-filter as the
  deterministic agent-path escape hatch. Inert on decision/lesson-intent queries (ADR/lesson recall
  byte-for-byte unchanged).

The calibration gate (ADR-003): a capability record + four verbose keyword-dense ADRs all matching a
"what provides X" query → the capability returns **#1**; a decision-intent query still returns the
decisive ADR (the boost did not become an override).

## Tasks

<!-- Three-Amigos `.feature` scenarios + Examples authored 2026-07-16. Tags: @executable @cli @work
     @memory (the domain-twin 05/01/01_parse-architecture-adrs tag set). Parsed against a FIXTURE
     OUTCOME.md / fixture index in each Background — independent of story 01's authoring path. -->

- [ ] `tasks/00_parse-outcome-records.feature` — `parseOutcome` emits `capability` records from
  `## Delivered` and `gap` records from `## Gaps`, each the frozen `MemoryRecord` (EXACTLY
  `MEMORY_RECORD_FIELDS`, absent-for-type fields present-as-`""`), `area="delivery"`, a capability's
  `status=""` and a gap's `status` ∈ {open, discharged} (default open), assumptions folded into the
  nearest-preceding capability's searchable `text`, `source` resolving to `OUTCOME.md:<heading-line>`.
  Scenarios: capability field mapping; area-fixed + empty-string-present fields; gap field mapping with
  Status/discharge; assumption folds (not a standing record); one record per `### ` heading; reaches
  both backends via `buildRecords`; a `Scenario Outline` over gap Status values (incl. default-open).
- [ ] `tasks/01_capability-recall-surfaces.feature` — the ranking (ADR-003). **The calibration-gate
  scenario**: a capability record + four verbose keyword-dense ADRs on a "what provides X" query → the
  capability returns **#1**. Plus: a decision-intent query still returns the decisive ADR (tiebreaker,
  not override); the boost never inverts a decisively-stronger base match; the boost is inert on a
  non-capability query (ADR/lesson recall unchanged); `--area delivery` HARD pre-filters (ADRs excluded
  from the candidate set); a `Scenario Outline` over query-class → expected-top-record.

## Notes

<!-- Reads the pinned OUTCOME.md grammar (milestone SPEC `## Stories`) — parse against fixture
     OUTCOME.md, not the live verify authoring path, so this story is independent of story 01's code.

     Feasibility (developer lens, verified against real code 2026-07-16):
     - `buildRecords` (src/memory/local-indexing.mjs) is consumed by BOTH backends — graphify imports it
       directly (line ~37); local reaches it via reindex→buildIndex→buildRecords. So the "reaches both
       backends" scenario is truthful with the single parseOutcome edit.
     - `parseOutcome` must resolve `source:line` to the ABSOLUTE `### ` heading line in the whole
       OUTCOME.md WHILE distinguishing `## Delivered` vs `## Gaps` `### ` headings — a two-level parse the
       single-level `splitSections` gives absolute lines for but does not section-tag; a small compose.
     - "Nearest-preceding capability" for an Assumptions fold, given the grammar's single `## Assumptions`
       section after `## Delivered`, resolves to the LAST delivered capability. The 00-feature fixture
       attaches the assumption to that capability deliberately.
     - Ranking BOUNDEDNESS (TYPE_BOOST_CAPABILITY < 0.6) is a white-box constant owned by the
       acd-outcome-capability-ranking-bounded arch-test; the 01-feature asserts it OBSERVABLY only through
       its consequence (a decisive base match is never inverted). No black-box scenario reads the constant. -->
