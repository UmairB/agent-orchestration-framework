---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 39 · Delivery Memory — State

## Progress

- [x] Framed 2026-07-14.
- [x] Refined 2026-07-16 (`aof:refine 39 --autonomous`) — Decide (6 ADRs + 5 fitness-function
  arch-tests) + Break-down (4 independent stories) + all task contracts authored (Three Amigos). Status
  → `in-progress`. Next: `aof:continue 39` to build.

## Notes & decisions in flight

**Framing (2026-07-14).** Raised from feedback on the `warnings_delivered` defect: memory is
`backend=graphify`, `records=109`, recall works — and every hit is a decision. The index is built from
`ARCHITECTURE.md` + `RETROSPECTIVE.md` only; it carries no product state at all.

**Rejected during framing — the roadmap layer.** The first shape proposed indexing SPEC objectives +
status for *every* milestone, so recall could answer "M24 delivers warnings and is not started". It
was rejected: a work item is self-contained, the producing milestone may not exist when the gap is
created, and you cannot index the unconceived. The correction that unlocked the design — the fact the
defect needed was about the *authoring* item ("I have declared a field nothing populates"), not about
any successor. Recorded here because it is the kind of plausible-but-wrong idea that will be proposed
again.

**Rejected during framing — filing gaps in `RETROSPECTIVE.md`.** A retro entry is *closed* ("we
learned X"); it is inert history, which is why it indexes cleanly. "Nothing populates this field" is
*open* — it stays true until a producer exists. Filing it in the retro decays it into narrative and
surfaces it on recall as "a process lesson from M22", which is exactly the useless-hit shape that
started this.

### Refinement (2026-07-16) — decisions taken + build-time flags

**Breakdown — 4 independent stories**, sharing only the record-shape contract (ADR-001/002) + the
OUTCOME.md section grammar pinned in SPEC `## Stories`, so they build in parallel. Graph-verified
boundaries: the memory seam (`local-indexing`/`local-retrieval`) is imported by exactly the two
backends; `work.mjs` is the god-node kept off the `recordDoc` seam (ADR-004). 01 = the artifact; 02 =
parse + surface (the full recall loop); 03 = gaps → schedulable chore; 04 = the dangling-declaration
fitness function.

**All five open questions below are now resolved by ADRs** — record shape → ADR-001 (reuse frozen
`MemoryRecord`, no `INDEX_VERSION` bump, gap state reuses `status`); one/two types → ADR-002 (two:
`capability` + `gap`, assumptions fold into the capability); ranking → ADR-003 (bounded
query-class-conditional type-boost `< TITLE_BOOST_PER_TERM` + `area="delivery"` hard pre-filter, NOT a
new retrieval path); authoring → ADR-004 (`aof:verify` only, `OUTCOME.md` never a `recordDoc` primary);
dangling detection → ADR-005 (record-format fields the tractable case; flags/endpoints out of scope).
Scope/honesty → ADR-006 (driver-level milestone-minimum; recall makes fiction visible, only the fitness
function *prevents*).

**Default decisions taken (`--autonomous`, non-critical):**
- **OUTCOME.md grammar** pinned at refine (the 01↔02 interface the architect deferred). Assumptions
  fold into the **nearest-preceding `### ` capability in document order** — unambiguous for the common
  single/few-capability case; per-capability nesting is a sanctioned grammar refinement if multi-
  capability attribution is ever needed. Both stories 01 + 02 build on this reading.
- **03: `discharged` gap is not promotable** (QA-added boundary) — already-discharged debt has nothing
  to schedule. Accepted as the defensible contract.

**Build-time feasibility flags (verified against real code by the Three Amigos — for `aof:continue`):**
1. **`stripBundleMarker` (`insert-shared.mjs`) won't strip a frontmatter-less `OUTCOME.md`** — its
   `(?=---)` lookahead requires a frontmatter fence; `OUTCOME.md` has none (ADR-004). The developer
   generalises the strip (relax the lookahead) — do NOT add a `---` fence. Story 01's 00-feature has a
   deliberately-RED scenario driving this.
2. **`verify.md` needs the Accept-juncture authoring step** (milestone-Accept in `<process>`, beside
   STATE compaction / RETROSPECTIVE / `memory ingest`) — arms the `acd-outcome-authored-by-verify`
   fitness function's `verify.md` grep. Plus routine bundle-descriptor + asset-manifest regen for the
   new template.
3. **`status` must be added to `SCOPE_FLAGS` (`work-memory.mjs`) + `SCOPE_FIELDS`
   (`local-retrieval.mjs`)** for `recall --status open` to fire. ADR-001's "applyScope already matches
   status" is the *mechanism* (the substring else-branch); the flag/field wiring is the additive edit
   (no version bump). Story 03/task-00 drives it.
4. **`chore` has no insert seam today** — `DOCS_BY_TYPE` (`insert-shared.mjs`) maps only
   milestone/uat, no `insert-chore` verb. Story 03/task-01's promote-to-chore wires `chore` into the
   existing insert seam (`DOCS_BY_TYPE.chore` + a thin `insert-chore`), reusing the scaffold — not a
   bespoke writer.
5. **04 producer-detection** must match object-shorthand AND explicit-key write-sites, detect on
   *assignment* syntax not bare substring (false-negative risk), keep the `warnings_delivered` planted-
   negative synthetic (never added to the frozen field set), and name the arch-test to satisfy the
   `acd-outcome-dangling-declaration-present` self-activation grep (`\b39\b` + producer/dangling/
   declared, not `(present)`/`assignment`). The three 39 arch-tests are on disk but not yet wired into
   `scripts/test.mjs` — the developer wires all three during the build.

### Open questions for `aof:refine` (RESOLVED 2026-07-16 — see the refinement note above; pointers left for the record)

- **Record shape.** A gap needs at least a discharge condition and an open/discharged state. The
  frozen `MemoryRecord` (05/ADR-005) has a fixed field set with absent-type fields present-as-`""`.
  Do gaps reuse the existing `status` field (today adr-only), or does the shape gain a field — which
  is a breaking index-format change and an `INDEX_VERSION` bump? Decide before any parser is written.
- **One record type or two?** `Delivered` and `Assumptions` are standing facts; a `Gap` is a debt with
  a discharge condition. They may want different types (and different ranking treatment) rather than
  one `outcome` type carrying all three sections.
- **Ranking.** `rankRecords` is BM25-lite + IDF + a title boost + a record-type tiebreaker (`lesson`
  over `adr`, at equal relevance only). A one-line capability will lose to a verbose ADR on raw term
  density. Is a "what provides X" question a *distinct retrieval path*, or a boost? This is plausibly
  the largest piece of work in the milestone and must not be discovered late.
- **Who authors `OUTCOME.md`.** Per the established rule, `aof:verify` owns record docs — evidence
  subagents have `Write` and have been observed to clobber records and fabricate decisions. The
  authoring path must not hand this file to a developer subagent.
- **Undeclared-gap detection.** What class of "declared surface with no producer" is statically
  reachable? Record-format fields are the motivating case and look tractable; flags/endpoints may not
  be. Scope this honestly — a fitness function that only catches the easy case is still worth
  shipping, but say so rather than implying full coverage.

### Known boundary — this does not prevent the defect

An `OUTCOME.md` authored at Accept is written *after* the fiction is committed. It makes the fiction
**visible** (having to type "nothing populates this" is a real forcing function) and it stops the next
milestone compounding it. Genuine *prevention* of a dangling field is the fitness function, not
recall. The milestone must not be sold internally — or in its own VERIFICATION — as preventing the
class of bug that produced it.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off
