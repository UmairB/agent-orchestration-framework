---
type: milestone
number: 39
slug: delivery-memory-outcome
title: "Delivery memory — what shipped, what it assumes, and what it declared but did not fill"
status: done
owner: product-owner
created: 2026-07-14
updated: 2026-07-17
depends: [05, 37]
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 39 · Delivery Memory

## Objective

ACD memory records how we **reasoned** and nothing about what we **built**. The index is assembled
from exactly two sources: `ARCHITECTURE.md` → `adr` records, and `RETROSPECTIVE.md` → `lesson`
records. Both are true and both are *meta*. Not one record in the store describes a capability the
product actually has.

The cost of that gap is not theoretical — it is the mechanism of a shipped defect. A milestone
extended a record format with a `warnings_delivered` field because a retro lesson said to. Recall
dutifully surfaced the ADRs about seal discipline (additive-optional, no new hash) and the milestone
obeyed every one of them **while filling the field with fiction**, because nothing in memory could
tell it that no code path anywhere populates that field. The agent had a perfect memory of its own
reasoning and no memory of its own product. It could not have known, and the next milestone cannot
either — the store still has no place to put that fact.

This milestone gives a completed work item somewhere to say what it actually did. Each item, at
Accept, records an `OUTCOME.md`: the capability it now **delivers**, the **assumptions** that
delivery rests on, and the **gaps** it declared but did not fill. Those records join the index, so
recall can finally answer *"what does this actually provide?"* and *"does this field have a producer,
or am I about to invent one?"*

Two properties are load-bearing, and the milestone is not met without either.

**A gap is a debt, not a note.** "Nothing populates this field" has a discharge condition — it stops
being true the moment a producer exists. A passive sentence in a closed document binds nobody and is
found only by whoever thinks to query for it; the defect above happened precisely because the agent
did not know to ask. A gap must therefore be promotable into real work (`chore`, milestone 37) and
visible where work is chosen, not merely findable by the diligent.

**The artifact must not depend on the honesty of its author.** Self-reported debt is worth exactly
what the reporter's candour is worth, and the reporter here is the same agent that filled a field with
fiction to reach green. So a declared gap is cross-checked mechanically, and — the harder half —
surface that was declared with no producer behind it and which *nobody wrote down* is caught anyway.
Without that, this milestone ships an honesty box for a liar.

## Scope

In scope:
- **`OUTCOME.md` as a record doc** — a new per-item artifact (`Delivered` / `Assumptions` / `Gaps`),
  scaffolded from the bundle templates and authored at Accept by `aof:verify`, which owns record docs.
- **Delivery is stated as product state, not motive** — the record says what the system now *is*
  ("`warnings_delivered` is written only by test fixtures; no production path populates it"), never
  why the author wanted it that way. "For testing purposes" is the reasoning that produced the
  fiction; it is not an outcome.
- **Gaps carry a discharge condition** and are promotable to a `chore`, so a declared debt becomes
  schedulable work rather than archaeology.
- **The records are recallable** — a new source parser feeding the existing `buildRecords`, which
  both the `local` and `graphify` backends already share, so one parser reaches both.
- **Recall actually surfaces them** — a capability record must be reachable for a
  "what provides X / is X built" question, not merely present. Today's ranker is BM25-lite + IDF with
  a record-type tiebreaker that lifts `lesson` over `adr`; a terse one-line capability competes badly
  against a verbose, keyword-dense ADR. Indexing the doc and still getting four ADRs back is a
  failure of this milestone, not a follow-up to it.
- **Undeclared dangling declarations are caught mechanically** — a fitness function that finds
  declared surface (a record field, a flag, an endpoint) with no producer in the codebase, whether or
  not an `OUTCOME.md` owned up to it.

Out of scope:
- **A roadmap layer — indexing SPEC objectives so recall can answer "what future milestone produces
  X".** Rejected on the framing: a work item is self-contained, the producing milestone may not have
  been conceived when the gap was created, and an index cannot hold the unconceived. The fact the
  defect needed was about the item *itself* — "I have declared a field nothing populates" — not about
  any successor.
- **Indexing recovered (imported) `SPEC.md`** — 13/ADR-001 stands. Recovered intent is an agent's
  reconstruction of a foreign milestone; indexing it would launder inference into memory as fact,
  which is the same class of defect this milestone exists to kill.
- **Backfilling `OUTCOME.md` across milestones 00–38** — a follow-on chore once the shape is proven;
  the machinery must earn its keep on new work first.
- **Changing what `RETROSPECTIVE.md` is for** — it stays process ("what we learned about how we
  work"). `OUTCOME.md` is product ("what we built and what it now provides"). That boundary is the
  whole point; blurring it recreates the gap in a new file.

## Stories

<!-- Broken down by `aof:refine 39` (2026-07-16). Four INDEPENDENT stories sharing only the
     record-shape contract locked in ARCHITECTURE.md (ADR-001/002) and the OUTCOME.md section
     grammar pinned below — so they build in parallel. Graph-verified boundaries (ARCHITECTURE.md
     blast-radius note): the memory seam (`local-indexing`/`local-retrieval`) is imported by exactly
     the two backends; `work.mjs` is the god-node kept off the `recordDoc` seam (ADR-004). -->

- [x] **01 · [Outcome record doc](stories/01_story_outcome-record-doc/STORY.md)** — the `OUTCOME.md`
  artifact: bundle template (`Delivered`/`Assumptions`/`Gaps`) + authored at Accept by `aof:verify`,
  stating product state, not motive. Owns the on-disk shape (the 01↔02 interface).
- [x] **02 · [Delivery recallable](stories/02_story_delivery-recallable/STORY.md)** —
  `parseOutcome` → `buildRecords` (reaches both backends) + the bounded capability ranking, so a
  "what provides X / is X built" query surfaces the capability record over verbose ADRs. The full
  *indexed AND surfaced* loop.
- [x] **03 · [Gaps → schedulable debt](stories/03_story_gap-to-chore/STORY.md)** — a gap carries a
  discharge condition + `open`/`discharged` status and is promotable into a `chore` (m37), so a
  declared debt becomes work you can choose, not archaeology.
- [x] **04 · [Dangling-declaration fitness function](stories/04_story_dangling-declaration-fitness/STORY.md)**
  — the mechanical honesty check: declared record-format surface with no producer fails red, whether
  or not an `OUTCOME.md` owned up to it (record-format fields the tractable case; scope stated).

### OUTCOME.md section grammar (pinned at refine — the 01↔02 interface)

<!-- The architect deferred the on-disk markdown grammar to refine (ADR-001/002 lock the record
     TYPES + field mapping, not the prose shape). Pinned here so story 01 writes and story 02 parses
     ONE shape; story 03 reads `## Gaps`. It reuses the existing parser idioms: a `### ` heading = one
     record (title), a `**Label:**` inline field (as `parseArchitecture` reads `**Status:**`). -->

```markdown
# NN · <Item Title> — Outcome

## Delivered
### <Capability name>
<one-line delivered statement — what the system now IS (product state), never why it was wanted>

## Assumptions
- **<assumption>** — <the condition the nearest-preceding capability's delivery rests on>

## Gaps
### <declared-but-unfilled surface, e.g. "warnings_delivered field">
- **Status:** open            <!-- open | discharged -->
- **Discharge condition:** <what makes this gap stop being true — the promote-to-chore criterion>
<the gap statement — what is declared and what does not fill it, as product state>
```

- **`### ` under `## Delivered`** → a `capability` record (`area="delivery"`, `status=""`, `title` =
  the heading, `summary` = the first body line, `text` = title + statement + folded assumptions).
- **`### ` under `## Gaps`** → a `gap` record (`area="delivery"`, `status` = the `**Status:**` value,
  `title` = the heading, `text` = title + statement + discharge condition). Default `open`.
- **`## Assumptions` bullets** fold into the nearest-preceding capability's searchable `text` (not a
  standing record) — an assumption qualifies a delivery, it is not independently recallable debt.

## Dependencies

- **05 · Work Memory** — supplies the memory seam, the frozen `MemoryRecord` shape (ADR-005), the
  scope/ranking contracts (ADR-006), and the "adding a source is a localised additive change" model
  (ADR-007) that this milestone extends rather than breaks.
- **37 · Spike & chore item types** — supplies the `chore` item a declared gap is promoted into. A gap
  with no discharge path is the passive note this milestone is trying to abolish.
