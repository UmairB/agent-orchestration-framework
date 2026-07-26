---
doc: retrospective
---
<!--
  Milestone RETROSPECTIVE.md — distilled, carryable lessons from HOW execution went.
  One R<n> per lesson; append-only (never renumber). Reference refs, never restate them.
  Triaged from STATE ## Feedback notes + VERIFICATION Findings + blocker stops at aof:verify 39.
-->
# 39 · Delivery Memory — Retrospective

## R1 — When an ADR defers a shape to refine, its own fitness-function fixtures are part of that deferred contract
- **Kind:** near-miss · **Area:** contract/fitness · **Stage:** build (story 02, caught) · **Owner:** architect · **Raised by:** aof-developer
- **What happened:** the architect wrote `acd-outcome-record-frozen-shape` and `acd-outcome-single-index-seam` with a **bullet** grammar under `## Delivered`/`## Gaps`, but ADR-002 explicitly **deferred the OUTCOME.md grammar to refine**, where it was pinned as `### `-headings. The fixtures were never re-pinned when the shape landed, so they silently encoded a stale contract a `parseOutcome` built to the pinned grammar would have failed. Story 02 corrected the two inline fixtures (invariant logic untouched).
- **Why:** a deferred-shape ADR ships fitness fixtures that assume a provisional grammar; nothing forced them to be revisited when refine pinned the real one, so they tested a grammar nobody agreed to.
- **Lesson:** if an ADR defers a shape to refine, its fitness-function **fixtures** are part of the contract, not incidental scaffolding — re-pin them when the shape lands, or they quietly assert a grammar that was never adopted. A fixture that outlives the decision it encoded is a stale contract wearing a green check.
- **Carry:** none — fixtures re-pinned to the `### `-heading grammar and green through build + verify.
- **Refs:** STATE ## Feedback (arch-test fixture drift); ARCHITECTURE ADR-002; `test/arch/acd-outcome-record-frozen-shape.test.mjs`, `test/arch/acd-outcome-single-index-seam.test.mjs`; SPEC `## Stories` (pinned grammar).

## R2 — "Independent stories" is import-seam independence; parallel BUILD independence is a file/edit-region property
- **Kind:** near-miss · **Area:** planning/breakdown · **Stage:** refine → build · **Owner:** product-owner (breakdown) + architect (blast-radius) · **Raised by:** aof-developer
- **What happened:** the breakdown claimed 4 independent stories on a graph-verified 2-importer memory seam (the ARCHITECTURE blast-radius note) — true for the **design**. But the **build** shared three hot files: `insert-shared.mjs` (01+03), `local-retrieval.mjs` (02+03), and `scripts/test.mjs` (all four). That forced wave-serialisation (03 after 01+02) and orchestrator-owned `scripts/test.mjs` wiring instead of a clean 4-way parallel fan-out.
- **Why:** import-graph seam independence and edit-region independence are different properties that were treated as one; a story can be design-independent yet share a file another story also edits.
- **Lesson:** assess parallel-build independence at the **file/edit-region** level, not only the import-graph seam level — the two diverge. When a breakdown promises parallelism, name the files each story writes and check for overlap before scheduling waves; shared hot files (a test registry, a scaffold seam) predict serialisation the seam graph hides.
- **Carry:** none — build absorbed the serialisation; carry is the file-overlap check for the next "independent stories" claim.
- **Refs:** STATE ## Feedback (seam vs build independence); ARCHITECTURE blast-radius note; `src/commands/insert-shared.mjs`, `src/memory/local-retrieval.mjs`, `scripts/test.mjs`.

## R3 — A green happy-path suite is not evidence of robustness; the adversarial craft pass was load-bearing
- **Kind:** near-miss (recurring) · **Area:** test-design/review · **Stage:** build review · **Owner:** developer + reviewer · **Raised by:** craft review
- **What happened:** every `@executable` scenario exercised the **authored-and-filled** path and was green, yet a craft/adversarial pass found four real robustness bugs the happy path never touched: `promote-gap` accepting a missing `--discharge` (a chore born with an empty DoD); a foreign `## ` section after `## Gaps` minting spurious gap records; an **unauthored** template (`<Capability name>` placeholders) being indexed as real capabilities; and `extractGapParts` dropping any `- **Label:**` gap line that isn't Status/Discharge. All fixed at build review with regression tests.
- **Why:** the scenarios were shaped around the intended input, so they were structurally blind to the malformed/partial/unauthored inputs the same code must survive.
- **Lesson:** a green suite over the happy path proves the feature works when used correctly, not that it is robust — adversarial-input review (malformed, partial, unauthored, foreign-section) catches the exact class the tests were shaped around and cannot see. Budget the craft pass as a required gate, not a bonus. (Echoes 38/ADR-008 "only a producer-fed path is evidence" and 05/R2.)
- **Carry:** none — 12 confirmed fixes landed with regressions; carry is that the adversarial pass stays a standing gate.
- **Refs:** STATE ## Feedback (happy-path robustness); `src/commands/promote-gap-to-chore.mjs` (`--discharge` guard), `src/memory/local-indexing.mjs` (`splitSections` boundary, `PLACEHOLDER_TITLE_RE`, `extractGapParts`); 38/ADR-008; 05/R2.

## R4 — A bound fitness function must neutralise the signal it isolates, or it cannot go red for an over-bound value
- **Kind:** near-miss · **Area:** fitness/verification · **Stage:** build review · **Owner:** architect · **Raised by:** craft review
- **What happened:** `acd-outcome-capability-ranking-bounded`'s "tiebreaker-not-override" case used a **zero-term-overlap** capability against the ADRs, so the ranking gap was already decisive on content alone — any boost up to ~1.5 (a real override) still left the test green. The bound it claimed to prove (`TYPE_BOOST_CAPABILITY < TITLE_BOOST_PER_TERM`) was never actually exercised. Fixed by exporting the two constants and asserting `TYPE_BOOST_CAPABILITY < TITLE_BOOST_PER_TERM` **directly**, plus a fixture that neutralises the base-content signal.
- **Why:** the fixture let the content score, not the boost, decide the order — so the assertion passed for reasons unrelated to the bound, and an over-bound value would not have tripped it.
- **Lesson:** a bound-asserting fitness function must **neutralise the other signals** (here: equal base content) so only the isolated quantity decides the outcome, AND assert the numeric bound directly where the constants allow it — a bound FF that stays green for an over-bound value proves nothing. (05/R2, restated on a ranking bound: isolate the signal or you test the wrong property.)
- **Carry:** none — constants exported and the direct `<` assertion added; the FF now goes red for an over-bound boost.
- **Refs:** STATE ## Feedback (bound FF vacuity); `test/arch/acd-outcome-capability-ranking-bounded.test.mjs`; `src/memory/local-retrieval.mjs` (`TYPE_BOOST_CAPABILITY`, `TITLE_BOOST_PER_TERM` exports); 05/R2.

<!--
  NOT carried as R-entries (recorded elsewhere, by design):
  - The three honestly-declared boundaries (automated gap discharge has no producer; dangling-declaration
    coverage is record-format-fields only; per-capability assumption attribution) graduated into the
    milestone OUTCOME.md `## Gaps` as schedulable debt (status: open + discharge condition) — that IS this
    milestone's mechanism, not a retro lesson.
  - Carry-forward implementation gotchas (the `**Discharge condition:**`/statement blank-line grammar →
    `extractGapParts`; `rankRecords` default limit:5 truncation; the SCOPE_FLAGS↔SCOPE_FIELDS↔DOCS_BY_TYPE
    two-file seam-split, now guarded by `test/scope-flags-fields-agree.test.mjs`) are reference notes for
    future OUTCOME work — folded into memory via `aof work memory ingest`, not restated as process lessons.
  - The mid-build concurrent mesh-dispatch tree write (committed independently as bbfcb02) was an
    out-of-scope note, not a defect.
-->
