---
doc: retrospective
ref: "05"
---
# 05 · Work Memory — Retrospective

Distilled lessons from how execution actually went. One `R<n>` per lesson; append-only, never
renumber. Clean catches with no process lesson are not entries — they live in VERIFICATION/STATE.
This milestone had **no blocker stops**; its one VERIFICATION finding (F1, the story-03 colliding-ids
injection gap) was a non-blocker design-gap resolved at the review gate before `in-review`. The lessons
below come from the Review-gate findings recorded in STATE `## Feedback (for retro)` (now archived);
R1–R4 are the seam's (stories 00–02), R5 is story 03's. Fittingly, these are the first lessons this
milestone's own memory backend will index for milestone 06+ — and at story 03's Accept the `verify`
ingest hook folded R5 in itself (recordCount 47 → 48), so the loop is now closing on its own output.

## R1 — A convenience verb that an ADR makes a seam composition but a story owns the content of must pin where the composition renders

- **Kind:** near-miss · **Area:** contract · **Stage:** refine→build · **Owner:** architect · **Raised by:** architect (Review gate)
- **What happened:** ADR-003 froze the backend interface at exactly `{ name, recall, reindex, status }`
  and made `brief` a *seam composition over `recall`*; but the story partition also gave story 02
  ownership of a richer `brief` digest (lesson/adr split + lessons-by-area). The two readings diverged:
  story 02's `brief()`/`renderBriefText()` were feature-green yet had **zero production callers**, while
  the CLI `brief` verb silently degraded to a scope-only `recall` record dump — a verb that was a
  no-op-equivalent of `recall`. Both stories' suites stayed green because no `@executable` scenario
  required the CLI to surface the rich digest (the one cross-story seam no scenario crossed).
- **Why:** "02 owns the brief digest" (partition) and "brief is a seam composition" (ADR-003) pointed at
  different homes for the same rendering, and no scenario sat on the seam between them.
- **Lesson:** when a convenience verb is a *seam composition* by ADR but a *story owns its content*, pin
  in the contract **where the composition's rendering lives**, and add a scenario that crosses that
  seam — or the verb ships green and inert. Resolved at the gate with no interface change: the seam
  composes the digest from the records `recall` already returns (`briefDigest` in
  `src/work-memory.mjs`), so ADR-003 stays at four methods and `brief` still reaches `backend.recall`.
- **Refs:** ADR-003, ADR-007; `src/work-memory.mjs` `briefDigest`; story 02 `renderBriefText` (now a
  consolidation candidate for the hooks follow-on).

## R2 — A fitness function that claims to isolate one signal must neutralise the others, or it proves the wrong property

- **Kind:** near-miss · **Area:** architecture · **Stage:** build→verify · **Owner:** architect · **Raised by:** architect (Structural review)
- **What happened:** `acd-memory-ranking` test 3 ("length normalisation alone keeps the dense match
  competitive") forced both records to `adr` to drop the record-type boost, but left the short record a
  query-term-packed *title* — so it passed on the **title** boost, not on length-normalisation. With
  titles equalised, BM25-lite length-norm *alone* actually inverts (LONG 1.430 > SHORT 1.337) because
  the query terms saturate in both docs. The ranking math (k1/b, IDF, divide-by-zero guards) is correct
  and the *behaviour* honours ADR-006 via the combined signal stack, but the test (and the ADR-006
  invariant text) attributed the anti-inversion guarantee to length-normalisation in isolation, which
  is false.
- **Why:** a test meant to isolate one signal left a second signal (the title match) live, so it proved
  a property the system doesn't have and gave false confidence in *which* mechanism does the work.
- **Lesson:** to credit one signal, a fitness function must actually neutralise every other signal;
  otherwise reword it to assert the honest combined property. Partly resolved at the gate: test 3 now
  asserts "with the record-type boost removed, length-norm + title-match hold the dense match at/above
  the long padded record." **Carried:** the ADR-006 *invariant text* still credits length-norm alone —
  left unedited (ADRs are immutable / superseded-not-edited); the wording correction is owed to a
  superseding ADR crediting the combined length-norm + title + record-type stack.
- **Refs:** ADR-006; `test/arch/acd-memory-ranking.test.mjs` (test 3).

## R3 — A `@executable` test that reaches for a new engine must be matched by a declared dependency, not a transitive one

- **Kind:** near-miss · **Area:** build · **Stage:** build · **Owner:** developer · **Raised by:** automated craft pass (Review gate)
- **What happened:** story 00's schema-validation tests validate a config against
  `schemas/aof.schema.json` via `ajv` (the most faithful test of ADR-002's "unknown backend fails the
  enum"), but `ajv` was only present transitively. A clean install could resolve it away and turn the
  suite red with no source change.
- **Why:** a new test-time engine was used without a matching `devDependencies` entry, leaning on a
  transitive resolution that is not part of the contract.
- **Lesson:** when a test reaches for a new engine, declare it at build time. Fixed: `ajv` declared in
  `devDependencies`.
- **Refs:** ADR-002; `package.json` `devDependencies`; `test/work-memory-seam.test.mjs`.

## R4 — A green `@executable` suite over a well-formed corpus does not prove robustness; the parser is one compact record away from corruption

- **Kind:** near-miss · **Area:** architecture · **Stage:** build→verify · **Owner:** developer · **Raised by:** code-reviewer (craft pass)
- **What happened:** a craft pass surfaced several green-suite-invisible defects, all masked by the
  well-formed milestone-01 corpus the features exercised: `--limit abc/-1/0` silently corrupted results
  (`slice(0, "abc")` → `[]`, `slice(0, -1)` dropped the lowest-ranked record); RETROSPECTIVE meta-line
  parsing keyed off `**Kind:**` alone (a future R-entry omitting `Kind` would zero `area/stage/owner`);
  the ADR `inlineField` terminator only stopped at a blank line or a dash-prefixed `- **`, so a
  non-dash field (`**Decision.**`) not blank-separated would swallow the next field(s); and
  `status.recordCount` read the persisted field rather than the live array. Each is invisible while the
  input stays pristine — exactly the R2-line-endings near-miss class, one layer up in the parser.
- **Why:** scenarios assert behaviour over a curated, well-formed fixture/corpus, so input-validation
  and malformed-input paths are never driven — they are robustness, not behaviour.
- **Lesson:** budget a deliberate craft/adversarial pass over the "the input is well-formed" assumptions
  (option validation, missing optional fields, non-blank-separated fields, stale on-disk state) — a
  green behavioural suite will not find them. All four hardened at the gate; a wired
  CLI→seam→local→disk integration suite (`test/memory-integration.test.mjs`) was added and the
  tautological `ingest == reindex` assertion retired by driving `ingest` through the real verb.
- **Refs:** `src/work-memory.mjs` (`--limit`); `src/memory/local-indexing.mjs` (meta-line, `inlineField`
  terminator, `status.recordCount`); `test/memory-integration.test.mjs`.

## R5 — A render's `@executable` test must exercise the dominant shape of the real corpus, not a convenient fixture, or it passes while the artifact is unusable

- **Kind:** near-miss · **Area:** code · **Stage:** build→verify · **Owner:** developer · **Raised by:** aof-qa (behavioural review, story 03 gate)
- **What happened:** the first `renderRecallBlock` (the read-hook injection block) led each line with a
  bare record `id`. But record ids **collide across milestones** — `R1`, `R2`, `ADR-002` recur in every
  milestone's RETROSPECTIVE/ARCHITECTURE — so a real recalled block routinely held two indistinguishable
  `R1 · near-miss · …` lines and the agent could not tell which milestone a lesson came from without
  hand-parsing the `source` path. The sibling `renderRecallText` already carried the `m<item>`
  qualifier; the block render had silently dropped it. The task-00 `@executable` suite was green because
  its fixtures used **unique ids** — and structural review reused the same unique-id fixtures, so it
  missed the defect; only the behavioural (black-box, real-corpus) pass surfaced it.
- **Why:** the render was tested against a convenient fixture (unique ids) whose dominant property
  differs from the real corpus (colliding ids), so the one property that makes the block usable — line
  disambiguation — was never asserted.
- **Lesson:** when a render will run over a known corpus, its `@executable` test must reproduce that
  corpus's *dominant shape* (here: colliding ids across milestones), not a shape chosen for test
  convenience — otherwise the suite is green while the artifact is unusable. The same R2-class trap
  ("the test proves the wrong property") one layer up, in fixture design. Fixed at the gate: the id
  field is now `id (m<item>)`, the task-00 fixture uses colliding ids, and lines are matched by their
  unique `source`.
- **Refs:** ADR-004; `src/work-memory.mjs` `renderRecallBlock`; `test/memory-recall-block.test.mjs`;
  rhymes with R2 (proving the wrong property) and R4 (well-formed corpus hides defects).
