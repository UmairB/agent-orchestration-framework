---
doc: retrospective
---
<!--
  Milestone RETROSPECTIVE.md — distilled, carryable lessons from HOW execution went.
  One R<n> per lesson; append-only (never renumber). Reference refs, never restate them.
  Triaged from STATE ## Feedback notes + VERIFICATION Findings + blocker stops at aof:verify 37.
-->
# 37 · Spike & Chore Work-Item Types — Retrospective

## R1 — A "single-editor of the god-node" partition must count LOGICAL vocabulary seams, not physical files
- **Kind:** near-miss · **Area:** contract/architecture · **Stage:** build (caught at review) · **Owner:** architect (story boundaries) · **Raised by:** aof-architect (story 00 review) + aof:feedback
- **What happened:** ARCHITECTURE's story-boundary rule was "story 00 edits `src/work.mjs` ONLY" (the graph-derived god-node partition — `work.mjs` has 35 importers). But the item-type vocabulary is physically **copied in four files**: `src/work.mjs`, `src/work-doctor.mjs` (`ITEM_RE`/`recordDoc`/`isDriver`), `src/work-doctor-coherence.mjs` (`recordDocFor`), and — surfaced by the architect review — `src/commands/migrate-folder.mjs` (`ITEM_RE`). Left stale, `aof work doctor` orphan-flags every `NN_spike_*`/`NN_chore_*` folder, and migrate's `nextFreeSlot` skips a top-slot spike/chore → a possible duplicate driver number. Story 00 + the review folded **all four** copies in (verified: doctor treats a spike folder clean; migrate counts it), so no functional gap shipped.
- **Why:** the partition rule counted *files touched*, not *logical invariants replicated*. The vocabulary is one logical seam physically smeared across four modules, so "only edit work.mjs" silently under-scoped the change.
- **Lesson:** when a boundary rule names a single editor for a god-node, first enumerate every physical copy of the invariant it owns — a graph edge count doesn't reveal copy-paste duplication. Better still, **single-source it**: export `ITEM_RE`/`isDriver` from `work.mjs` (`recordDoc` already exported), import in doctor + migrate-folder, collapsing four copies to one and making parity-drift structurally impossible.
- **Carry:** a follow-up **`chore`** — a fitting first customer of the very type this milestone adds — to single-source the vocabulary and add a `nextFreeSlot` regression test (a top-slot spike counts). Deferred to that chore.
- **Refs:** STATE ## Feedback (quadruplicated seam); `src/work.mjs`, `src/work-doctor.mjs`, `src/work-doctor-coherence.mjs`, `src/commands/migrate-folder.mjs`; ARCHITECTURE story-boundaries.

## R2 — A validation *message* pinned by a locked, accepted `.feature` is contract surface, not cosmetics
- **Kind:** blocker (self-inflicted, reverted) · **Area:** process/contract · **Stage:** build (story 00 review) · **Owner:** orchestrator · **Raised by:** aof-architect (flagged the string stale but recommended DEFERRING)
- **What happened:** during story 00 review the orchestrator reworded the `depends` validation message in `src/work.mjs` ("milestone/uat item" → "top-level driver") to reflect spike/chore now being valid targets — the architect had flagged the wording as stale but explicitly recommended *deferring* the change for blast-radius reasons. The reword broke `test/roundtrip-loop-proof.test.mjs`, which asserts milestone 04's **locked, accepted** `.feature` (`04_.../00_validate-gates.feature`) pinning the exact old string. **Reverted.**
- **Why:** a user-facing validation string looked like cosmetics, but a locked downstream contract pins it verbatim — changing it silently renegotiates milestone 04's accepted acceptance criteria.
- **Lesson:** a validation/error message is part of any locked `.feature` that pins it — it cannot be changed by a later milestone without renegotiating that milestone's contract first. **Trust the reviewer's "defer" when the concern is cross-milestone blast-radius**, even for a one-word "obvious" fix.
- **Refs:** STATE ## Feedback (C1 blast radius); `test/roundtrip-loop-proof.test.mjs`; `04_milestone_round-trip-proof/.../00_validate-gates.feature`.

## R3 — An `@executable` scenario whose only harness is a deferred follow-on reads as suite-covered when it isn't
- **Kind:** near-miss · **Area:** process/test-coverage · **Stage:** verify · **Owner:** QA (browser harness) · **Raised by:** aof:verify (F-3701)
- **What happened:** the board type-badge scenario (`02/02_refine-bypass-and-board-badge.feature`) is tagged `@executable`, but there is **no UI test harness** for the board render — it was verified by `npm run ui:build` (exit 0) + code inspection, so the badge is not locked against visual regression. The tag implies suite coverage the scenario doesn't yet have.
- **Why:** the board render has no `toHaveScreenshot`/DOM-assertion harness (a QA-owned follow-on, scoped out here), yet the scenario carries the `@executable` tag rather than `@manual`.
- **Lesson:** when a scenario's only verification is a not-yet-built harness, tag it `@manual` (or flag it) until the harness lands — an `@executable` tag with no runner is a silently-uncovered claim (kin to milestone 35's R4 "imported-but-unspread fitness function"). Land the harness with the scenario, or downgrade the tag.
- **Refs:** VERIFICATION F-3701; `ui/src/board/{api.ts,model.ts,BoardLanes.tsx}`; STATE story-02 note (board harness follow-on).
