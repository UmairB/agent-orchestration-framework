---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited. Shared by the stories.
  Behaviour (observable outcomes) lives in task .feature files; a structural invariant lives here as a
  FITNESS FUNCTION (an arch-test), never as a Gherkin scenario.
-->
# 39 · Delivery Memory — Architecture Decisions

ACD memory today indexes exactly two sources — `ARCHITECTURE.md` → `adr` and `RETROSPECTIVE.md` →
`lesson`. Both are *meta*; not one record describes a capability the product has. That gap was the
mechanism of the `warnings_delivered` defect: recall had a perfect memory of the milestone's reasoning
and no memory of its product, so it could not tell the agent that no code path populates the field. This
milestone adds an `OUTCOME.md` per-item record (Delivered / Assumptions / Gaps), authored at Accept,
indexed through the EXISTING shared seam, recallable, with gaps promotable to a `chore` and a fitness
function that catches declared-surface-with-no-producer even when nobody wrote it down.

The seam this milestone extends is small and its blast radius is graph-verified (fresh `graph build src`,
1907 nodes / 4900 edges): `src/memory/local-indexing.mjs` (home of `buildRecords` + the source parsers) is
imported by **exactly two** modules — `src/memory/local-backend.mjs` and `src/memory/graphify-backend.mjs`
(`graph impact` confirms `imported/called by ← (2)`). `src/memory/local-retrieval.mjs` (home of
`rankRecords` + `MEMORY_RECORD_FIELDS`) is likewise imported by exactly those two and imports nothing. So
a new source parser and a ranking change here reach BOTH backends with one edit each — the 05/ADR-007
localised-additive model holds. By contrast `src/work.mjs` is a god-node (`imported/called by ← 38`), which
is why `OUTCOME.md` is deliberately kept OFF the `recordDoc` primary-record-doc seam (ADR-004).

## Recalled prior-architecture context (acknowledged)

`aof work memory recall … --area architecture --block` (backend=graphify) surfaced these near-misses. Each
is honoured or consciously departed from below:

- **05/ADR-005** — the frozen `MemoryRecord` shape + derived index at `.aof/aof.memory.index.json`, absent
  fields present-as-`""`. **HONOURED** by ADR-001: delivery records are the same frozen shape, no field
  added.
- **05/ADR-006** — length-normalised (BM25-lite) ranking + a record-type boost that is a *tiebreaker, never
  a relevance override*; scope filters are a hard pre-filter BEFORE ranking. **HONOURED** by ADR-003: the
  capability lift is a bounded, query-class-conditional tiebreaker plus an existing hard pre-filter — not a
  new blanket override.
- **05/ADR-007** — adding a source is a localised additive change. **HONOURED** by ADR-001/ADR-002:
  `parseOutcome` composes into `buildRecords`, reaching both backends with no graphify-only parser.
- **13/ADR-001** — reuse the 05 doc conventions so EXISTING parsers index a new doc with NO new parser.
  **CONSCIOUSLY DEPARTED FROM** in ADR-002: a delivery record is genuinely new-shaped (a capability/gap is
  not an ADR or a lesson), so it earns a new `parseOutcome` and new record types. The departure is narrow —
  the *record shape* (05/ADR-005) is untouched; only the parser + `recordType` vocabulary grow.
- **14/ADR-001** — an `AOF.md` digest as a NEW indexed source, "summarise-and-point, never
  duplicate-as-authority", one section = one record with a resolving `source:line`. **HONOURED** by
  ADR-001: an OUTCOME record's `source` resolves to its own `OUTCOME.md` heading line; the record
  summarises the delivered/gapped surface and points, it never becomes a second authority over the code.
- **05/R2** — "a fitness function that claims to isolate one signal must neutralise the others, or it
  proves the wrong property." **HONOURED** by the ADR-003 and ADR-005 arch-tests (non-vacuous, with a
  planted-negative self-check).
- **38/ADR-008** — "wherever we do not own the PRODUCER, the contract test must be fed a REAL captured
  payload; a green suite is not evidence a feature works, only a producer-fed path is." This is the
  intellectual parent of ADR-005: the dangling-declaration check is exactly "a declared surface with no
  producer is a lie a green suite will not catch."

---

## ADR-001: Delivery records reuse the frozen `MemoryRecord`; a gap's open/discharged state reuses the existing `status` field — NO `INDEX_VERSION` bump

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The STATE open question: a gap needs a discharge condition and an open/discharged state; does
it reuse the frozen `MemoryRecord`'s existing `status` field (today populated only for `adr` records, from
the ARCHITECTURE `**Status:**` line, and present-as-`""` everywhere else — 05/ADR-005), or does the shape
gain a field, which is a breaking index-format change requiring an `INDEX_VERSION`/`GRAPHIFY_INDEX_VERSION`
bump and a re-index of every stored corpus? The forces: 05/ADR-005 froze `MEMORY_RECORD_FIELDS`
(recordType, id, item, itemSlug, title, area, stage, kind, owner, status, summary, text, source); a new
field is a real cost — two version constants move in lockstep (`INDEX_VERSION` in `local-indexing.mjs`,
`GRAPHIFY_INDEX_VERSION` in `graphify-backend.mjs`), and every consumer that asserts the exact field set
(`acd-memory-recall-contract`, the graphify records test) must be revised. The `status` field is already
"the record's standing" — for an `adr` it is `Accepted`/`Superseded`; a gap's `open`/`discharged` is the
same category (a lifecycle token on the record).

**Decision.** Delivery records are the SAME frozen `MemoryRecord`; no field is added, so `INDEX_VERSION`
and `GRAPHIFY_INDEX_VERSION` STAY at `1`. Field mapping:

- A **capability** record (from `## Delivered`): `recordType="capability"`; `title` = the delivered
  capability's name (dense on the vocabulary a "what provides X" query uses — load-bearing for ADR-003);
  `area="delivery"` (a NEW area value that distinguishes product records from `architecture` ADRs and
  enables the ADR-003 hard pre-filter); `summary` = the one-line delivered statement (the display gist);
  `text` = title + delivered statement + its assumptions (searchable); `status=""` (a standing fact has no
  lifecycle token); `stage/kind/owner=""` (lesson-only); `source` = `OUTCOME.md:<heading-line>`.
- A **gap** record (from `## Gaps`): `recordType="gap"`; `title` = the declared-but-unfilled surface (e.g.
  "warnings_delivered field"); `area="delivery"`; `summary` = the gap statement + its discharge-condition
  gist; `text` = title + gap statement + discharge condition (searchable); **`status` = `open` |
  `discharged`** — the reused field; `stage/kind/owner=""`; `source` = `OUTCOME.md:<heading-line>`.

Reusing `status` is not a semantic stretch and it buys retrieval for free: `applyScope` already
substring-matches `status`, so `recall --status open` returns open debt with zero new scope machinery. An
additive field would cost the lockstep version bump + a full re-index for a filter the reused field already
serves. If a FUTURE need genuinely cannot map onto the frozen fields, THAT is when the field is added and
BOTH version constants bump together — this ADR pins the trigger, not a blanket "never add".

**Invariant.** Every `parseOutcome` record carries EXACTLY `MEMORY_RECORD_FIELDS` — no field added, none
omitted (absent-for-type fields present-as-`""`). `INDEX_VERSION === GRAPHIFY_INDEX_VERSION === 1`; the two
constants move only in lockstep. A `gap` record's open/discharged lifecycle lives in `status`, never in a
new field. (Fitness: `test/arch/acd-outcome-record-frozen-shape.test.mjs`.)

---

## ADR-002: Two delivery record types — `capability` and `gap`; Assumptions fold into the capability they qualify

**Status:** Accepted
**Date:** 2026-07-16

**Context.** `Delivered` and `Assumptions` are standing facts; a `Gap` is a debt with a discharge
condition and an open/discharged state. The STATE open question: one `outcome` type carrying all three
sections, or distinct types with different ranking treatment? Retrieval has exactly two intents here:
*"what provides X / is X built"* (wants the capability) and *"what is still owed / does this field have a
producer"* (wants the gap). A gap needs treatment a standing fact does not: an open/discharged lifecycle
(ADR-001's `status`), promotability into a `chore` (story 03), and a distinct ranking posture for
"what's owed" queries. A single `outcome` type would blur the "is it built" vs "is it still owed" line the
whole milestone exists to draw. Three types (adding `assumption`) over-fragments: an assumption has no
retrieval intent that the delivery it qualifies does not already serve — "what does X rest on" is answered
by surfacing X's capability record, whose searchable `text` includes the assumption.

**Decision.** TWO record types: `capability` and `gap`.

- `## Delivered` → `capability` records. `## Assumptions` are indexed ONTO the capability they qualify as
  searchable `text` context — an assumption is not independently recallable debt, it is a qualifier on a
  standing delivery. (Guardrail for ADR-003: an assumption enriches the capability's `text` but the
  capability's `title`/`summary` stay the delivered statement, so folding assumptions in does not dilute
  the dense term-signal the ranking relies on.)
- `## Gaps` → `gap` records, each carrying a discharge condition + the `open`/`discharged` `status`
  (ADR-001) and the promotion path to a `chore` (story 03 / milestone 37).

Both types are emitted by one new `parseOutcome(text, meta)` in `src/memory/local-indexing.mjs`, composed
into `buildRecords` exactly as `parseAof` was (14/ADR-001) — so both types reach `local` AND `graphify`
with the single edit the graph-verified 2-importer blast radius guarantees.

**Invariant.** `buildRecords` remains the SINGLE shared record-source seam both backends consume; no
graphify-only parser exists and `parseOutcome` lives in `local-indexing.mjs`, not in a backend. A delivery
record therefore reaches graphify with no backend-specific code. (Fitness:
`test/arch/acd-outcome-single-index-seam.test.mjs`.)

---

## ADR-003: Capability retrieval is a bounded, query-class-conditional type-tiebreaker in `rankRecords` plus a `area:"delivery"` hard pre-filter — NOT a new retrieval path

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The SPEC's flagged central risk: "Indexing the doc and still getting four ADRs back is a
failure of this milestone." Today's ranker (`rankRecords`, 05/ADR-006) is BM25-lite + IDF +
`TITLE_BOOST_PER_TERM=0.6` + `TYPE_BOOST_LESSON=0.15` (a *tiebreaker* that lifts `lesson` over `adr` at
equal relevance only). The naive fear is that a terse one-line capability loses to a verbose keyword-dense
ADR on raw term density. But 05/ADR-006's BM25 length-normalisation (B=0.75) + saturation (K1=1.2) already
DISCOUNT a padded ADR's repetition, and a short record dense on the query terms is exactly what
length-normalisation rewards — so a *well-authored* capability is already competitive in the base ranking.
The genuine tension is with 05/ADR-006's boundary: a boost big enough to flip a real density gap would BE
the blanket relevance override that ADR forbids. Resolving that tension honestly is the design here — not a
bigger boost, and not a brittle natural-language "intent classifier" as a separate retrieval path.

**Decision.** Three composing mechanisms, all inside the existing ranking model:

1. **Authoring discipline (story 01).** A capability record's `title` is the capability name and its
   `summary` is the one-line delivered statement, so on a "what provides X" query it earns the strong
   `TITLE_BOOST_PER_TERM` (0.6/term) and rates highly under length-normalisation — it starts at or near the
   top of the base ranking BEFORE any type boost.
2. **A query-class-conditional capability type-boost in `rankRecords` (story 02).** A new
   `TYPE_BOOST_CAPABILITY`, applied ONLY when the query carries a capability-intent trigger (a small,
   explicit lexical set — provide(s)/provided, built/is-built, deliver(s), capability, producer/who-writes,
   does-X-exist), calibrated STRICTLY below one title-match term (`< TITLE_BOOST_PER_TERM = 0.6`), exactly
   like `TYPE_BOOST_LESSON` and graphify's `GRAPH_BOOST_MAX=0.3`. It breaks the residual tie against a
   co-matching ADR; it CANNOT invert an ADR the base ranking already scores decisively higher, and it is
   inert on non-capability (decision/lesson-intent) queries so ADR/lesson recall is byte-for-byte
   unchanged.
3. **A deterministic hard pre-filter escape hatch (05/ADR-006-pure).** Because capability/gap records carry
   `area="delivery"`, the agent-issued capability recall block MAY scope `--area delivery` (a HARD
   pre-filter applied before scoring, so ADRs are excluded from the candidate set entirely). This is the
   guaranteed floor for the agent path; the boost handles the unscoped ad-hoc query. Making `recordType` a
   scope dimension (adding it to `SCOPE_FIELDS`) is a sanctioned, additive follow-on if a
   type-exact filter is wanted — it does not touch the frozen record shape.

Story 02's acceptance test is the calibration gate: a capability record + four verbose keyword-dense ADRs
all matching a "what provides X" query → the capability returns #1; a self-check confirms a decision-intent
query still returns the decisive ADR (the boost did not become an override). This is one story, not two:
`parseOutcome` and the ranking change live on the same 2-importer seam (`local-indexing.mjs` +
`local-retrieval.mjs`) and are meaningless apart — indexing a record nobody can surface, or a boost with no
record type to lift.

**Invariant.** Any capability ranking lift is a BOUNDED tiebreaker: the capability boost constant is
strictly less than `TITLE_BOOST_PER_TERM` (it cannot override a clearly stronger base match), mirroring the
`TYPE_BOOST_LESSON < TITLE_BOOST_PER_TERM` boundary that holds today. A well-authored terse capability
ranks at or above a verbose keyword-dense ADR on a capability query. (Fitness:
`test/arch/acd-outcome-capability-ranking-bounded.test.mjs`.)

---

## ADR-004: `OUTCOME.md` is authored EXCLUSIVELY by the `aof:verify` path at Accept, and is an ADDITIONAL artifact — never the `recordDoc` primary

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The load-bearing authoring rule: `aof:verify` owns record docs; evidence/developer subagents
(aof-developer has `Write`) have been observed to clobber records and fabricate decisions — the very
failure mode (`warnings_delivered` filled to reach green) this milestone exists to counter. Self-reported
delivery written by the same agent that fabricated a field is worth its candour. Separately, `recordDoc`
in `src/work.mjs` is the item's PRIMARY record doc (milestone→SPEC.md, story→STORY.md, …) and it feeds
`validate`/`rollbackItemStatus`/`readMeta` across a graph-verified **38** dependents — it requires its
mapped doc to carry the item's identity frontmatter. `OUTCOME.md` carries Delivered/Assumptions/Gaps, not
identity, and is authored at Accept, not at insert. Wiring it into `recordDoc` would therefore both break
`validate` (an OUTCOME.md has no identity frontmatter) and blast a change through those 38 dependents.

**Decision.** `OUTCOME.md` is an ADDITIONAL per-item artifact, NOT a `recordDoc` primary — `recordDoc`
stays exactly as-is and never returns `OUTCOME.md`. It is authored EXCLUSIVELY by the `aof:verify` path at
Accept (the party that already owns record docs, runs the retrospective, and folds lessons into memory via
`aof work memory ingest`), never handed to an evidence/developer subagent. Scaffold seam: the template's
source of truth is `src/bundle/templates/<type>/OUTCOME.md` (Delivered / Assumptions / Gaps), bundled to
`.aof/templates/work/<type>/OUTCOME.md` — already covered by the existing `.gitattributes` LF pin
(`.aof/templates/**/*.md text eol=lf`) and by the leading-bundle-marker strip idiom
(`insert-shared.mjs#stripBundleMarker`). `aof:verify` instantiates it at Accept at the same point it
compacts STATE / triggers RETROSPECTIVE / runs `memory ingest`, so the new records join the index in the
same Accept transaction. Because authoring is Accept-time, the scaffold does NOT go through the insert-time
`insert-shared.mjs` path (which writes only identity-bearing primary docs).

**Invariant.** `recordDoc` never returns `OUTCOME.md` for any item type (OUTCOME stays an additional
artifact, not the primary record doc). The only bundle prompt that instantiates the `OUTCOME.md` template
is `verify.md`; no agent prompt (aof-developer, etc.) authors it. (Fitness:
`test/arch/acd-outcome-authored-by-verify.test.mjs`.)

---

## ADR-005: The dangling-declaration fitness function — contract + an honest scope boundary (record-format fields tractable; flags/endpoints out of scope)

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The SPEC's harder half: "surface that was declared with no producer behind it and which
*nobody wrote down* is caught anyway" — otherwise the milestone "ships an honesty box for a liar." The
STATE open question: what class of "declared surface with no producer" is statically reachable?
Record-format fields are the motivating tractable case (the defect was a record-format field,
`warnings_delivered`, with no writer); flags/endpoints may not be. This must be scoped HONESTLY — a check
that only catches the easy case is worth shipping, but must not imply full coverage. The nearest prior art
is `test/arch/acd-assignment-state-has-producer.test.mjs` (35/ADR-001): "no state exists without a writer",
proven by (a) a single source-of-truth enum, (b) grepping the dedicated writer call-sites, (c) a planted
producerless-state self-check. Story 04 GENERALISES that idiom from a state enum to a record-format field
set. (This ADR SPECIFIES the invariant contract; the product fitness function is story 04's deliverable —
it is NOT implemented here.)

**Decision.** The dangling-declaration fitness function's CONTRACT: given (i) a declared field set drawn
from a single source of truth (a frozen field list / enum, e.g. `MEMORY_RECORD_FIELDS`, an assignment
record schema, an OUTCOME-declared record format) and (ii) a bounded set of producer modules, the check
computes the set of declared fields with ZERO producer write-site and FAILS RED on any non-empty result. A
field is "declared" if it is in the single-source field list; it "has a producer" if some writer in the
bounded module set assigns it. Statically reachable BECAUSE the field set is an explicit enumerable list and
producers are grep-able assignment sites in a bounded, same-language module set. **Honest scope boundary —
what it does NOT cover:** CLI flags, HTTP endpoints, config keys, and wire-format fields whose producers are
dynamic, computed, template-generated, reflective, or cross-language are NOT statically enumerable in
general and are OUT of scope. The check catches the MOTIVATING class — a record-format field with no writer,
exactly `warnings_delivered` — and says so plainly; it makes no claim over flags/endpoints. Non-vacuity is
mandatory (05/R2): the check must pass a real clean field set AND a PLANTED producerless field must trip the
same detector.

**Invariant.** A dangling-declaration fitness function (record-format-field-has-a-producer, story 04's
deliverable) EXISTS under `test/arch/` and is wired into the assembled runner registry — its BEHAVIOUR is
story 04's, its PRESENCE is a milestone invariant, and once the delivery-memory machinery lands
(`parseOutcome` exported) its presence is non-optional (the honesty half cannot be dropped). (Fitness:
`test/arch/acd-outcome-dangling-declaration-present.test.mjs`.)

---

## ADR-006: Driver-level (milestone-minimum) `OUTCOME.md`, and the milestone must NOT be sold as preventing the class of bug that produced it

**Status:** Accepted
**Date:** 2026-07-16

**Context.** The STATE "Known boundary": an `OUTCOME.md` authored at Accept is written AFTER the fiction is
committed. It makes the fiction VISIBLE (having to type "nothing populates this field" is a real forcing
function) and it stops the NEXT milestone compounding it (recall can now answer "what provides X"), but it
does not PREVENT the dangling field in the authoring milestone — that is the fitness function's job
(ADR-005), not recall's. The milestone must not be sold — internally or in its own VERIFICATION — as
preventing the class of bug that produced it. Separately, which item types get an OUTCOME must be decided:
driver-level (milestone) is the motivating case; per-story is a plausible extension.

**Decision.** `OUTCOME.md` is authored at driver level — **milestone at minimum** (the motivating,
load-bearing case). Per-story OUTCOME authoring is a sanctioned follow-on, NOT required for this milestone;
a story's delivery rolls up into its milestone's OUTCOME. Honouring the SPEC out-of-scope list: no roadmap
/ SPEC-objective indexing, no indexing of recovered imported `SPEC.md` (13/ADR-001 stands), no 00–38
backfill, and `RETROSPECTIVE.md` stays process ("how we work") while `OUTCOME.md` is product ("what we
built"). The prevention honesty is a first-class decision, not a footnote: recall makes fiction VISIBLE and
non-compounding; the ADR-005 fitness function is the only genuine PREVENTION. VERIFICATION for this
milestone must state that boundary explicitly.

**Invariant.** No arch-test (this ADR is a scope + honesty decision, enforced by the ADR-001/002/003/005
fitness functions and by the SPEC out-of-scope list, not a distinct structural constraint). The prevention
boundary is asserted in prose in the milestone VERIFICATION at Accept.
