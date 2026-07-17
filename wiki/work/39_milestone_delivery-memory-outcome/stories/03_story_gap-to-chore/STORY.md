---
type: story
number: 03
slug: gap-to-chore
title: "Gaps are schedulable debt — a discharge condition, promotable into a chore"
parent: 39
status: done
owner: product-owner
created: 2026-07-16
updated: 2026-07-17
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
-->
# 03 · Gaps are schedulable debt

## User story

As the **person choosing what to work on next**,
I want a declared gap ("nothing populates this field") to carry a discharge condition and be
promotable into a `chore` — so it appears where work is chosen, not only where someone thinks to
query,
so that a declared debt is *scheduled work with a close criterion*, not a passive note found by the
diligent (the mechanism of the original defect: the agent did not know to ask).

<!-- Challengeable benefit (SPEC "A gap is a debt, not a note"): a passive sentence in a closed
     document binds nobody. The gap must be promotable into real work (m37 chore) and its discharge
     condition IS the chore's close criterion — so "done" is mechanically checkable, not a judgment. -->

## Scope & contract

- **A gap carries its lifecycle** (ADR-001): the `gap` record's `status` is `open` | `discharged` and
  it states a **discharge condition** (the thing that makes "nothing populates this" stop being true).
  `recall --status open` returns open debt (the `applyScope` substring filter already serves this — no
  new scope machinery).
- **Promote a gap to a `chore`** (m37): a declared gap becomes a top-level `chore` whose
  `## Definition of Done` is seeded from the gap's discharge condition, and which traces back to the
  originating gap (so the debt and its scheduled discharge are linked). Reuses the existing chore
  scaffold seam (`aof work insert`-family / the `chore` template), not a new bespoke writer.
- A gap is `discharged` when its producer exists — the same condition the story-04 fitness function
  checks mechanically. This story makes the debt *schedulable*; story 04 makes an *undeclared* one
  *catchable*.

Depends (contract only, not code) on story 01's `## Gaps` grammar and ADR-001's `status` mapping.

## Tasks

<!-- Authored by the Three Amigos (QA owns the Examples tables). Both are behavioural, black-box
     acceptance targets for the in-progress milestone: parseOutcome / the gap record type / the
     promote seam are not built yet — these features are the contract that drives the build.
     Two FEASIBILITY FLAGS logged for the developer amigo (see task notes below). -->

- [x] `tasks/00_gap-carries-discharge.feature` — a `gap` record carries an `open`/`discharged` status
  (the reused `MemoryRecord.status`, ADR-001) and its discharge condition in recallable text;
  `aof work memory recall --status <status>` returns only debt in that lifecycle state (Examples over
  the open|discharged vocabulary; an adr's `Accepted` status is never open debt).
- [x] `tasks/01_promote-gap-to-chore.feature` — a declared open gap is promoted into a top-level `chore`
  whose `## Definition of Done` is seeded from the gap's discharge condition and which traces back to the
  originating gap; the chore is born `not-started` (closed later by `aof:verify`, never hand-ticked). A
  discharged gap has no debt to schedule (boundary).

## Notes

<!-- The chore is closed later by `aof:verify <chore-ref>` (ticked DoD), never hand-ticked — the same
     discipline as any chore. Discharge of the gap tracks the chore's completion. -->

<!-- FEASIBILITY FLAGS (QA feasibility pass, 2026-07-16) — for the developer amigo:
     (a) `--status` is NOT a recall scope flag today. `SCOPE_FLAGS` (src/work-memory.mjs:27) and
         `SCOPE_FIELDS` (src/memory/local-retrieval.mjs:47) are both ["area","stage","kind","owner",
         "item"] — no "status". So `recall --status open` is silently ignored (unknown flag) and
         `normalizeScope`/`applyScope` never filter on `status`. ADR-001's "applyScope already
         substring-matches status" refers to the MECHANISM (the else-branch `String(record[field])
         .includes(value)`), which is real — but `status` must be added to BOTH arrays for the filter
         to fire. Small additive change; no index-format/version impact. Task 00's recall scenarios
         are the acceptance TARGET, not current behaviour.
     (b) No cleanly-reachable seam scaffolds a `chore` today. The chore TEMPLATE exists
         (src/bundle/templates/chore/CHORE.md → `## Definition of Done` checklist, `status: not-started`),
         and the insert scaffold MECHANICS exist (src/commands/insert-shared.mjs runInsertTopLevel),
         but `DOCS_BY_TYPE` maps only milestone/uat — `chore` is absent, so runInsertTopLevel({type:
         "chore"}) throws. There is no `insert-chore` CLI verb; the only chore-creation path is the
         `add-chore.md` bundle PROMPT (agent Write), not a deterministic black-box seam. To reuse the
         scaffold (not a bespoke writer) the developer should wire chore into the insert seam
         (`DOCS_BY_TYPE.chore = ["CHORE.md"]` + a thin insert-chore command/verb) and have promotion
         call it, injecting the discharge condition into the DoD + a back-reference to the gap. -->
