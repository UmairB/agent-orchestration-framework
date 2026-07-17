---
type: story
number: 01
slug: outcome-record-doc
title: "Outcome record doc — what a completed item delivered, assumed, and left"
parent: 39
status: not-started
owner: product-owner
created: 2026-07-16
updated: 2026-07-16
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# 01 · Outcome record doc

## User story

As the **agent authoring the next milestone** (the one who will be tempted to fill a declared field
with fiction),
I want each completed item to record, at Accept, an `OUTCOME.md` stating the capability it now
**delivers**, the **assumptions** that delivery rests on, and the **gaps** it declared but did not
fill — as product *state*, never as motive,
so that the store gains somewhere to say what the product actually *is*, and I can later ask "what
provides X?" instead of inventing a producer.

<!-- The benefit is challengeable: without this artifact there is NO place in memory for product
     state — the index is assembled from ARCHITECTURE (adr) + RETROSPECTIVE (lesson) only. This story
     owns the ON-DISK shape (the 01↔02 interface); story 02 makes it recallable. -->

## Scope & contract

Owns the artifact, not the index. Delivers:

- **A bundle template** `OUTCOME.md` (`## Delivered` / `## Assumptions` / `## Gaps`) matching the
  section grammar pinned in the milestone SPEC `## Stories`, source-of-truth
  `src/bundle/templates/<type>/OUTCOME.md`, bundled to `.aof/templates/work/<type>/OUTCOME.md`, LF-pinned
  by the existing `.gitattributes` `.aof/templates/**/*.md text eol=lf` rule and carrying the leading
  bundle marker the `insert-shared.mjs#stripBundleMarker` idiom strips.
- **Authored at Accept by `aof:verify`** (ADR-004) — the `verify.md` bundle prompt instantiates and
  fills `OUTCOME.md` at the same Accept point it compacts STATE / triggers RETROSPECTIVE / runs
  `memory ingest`. Content is **product state, not motive**: "`warnings_delivered` is written only by
  test fixtures; no production path populates it" — never "for testing purposes".
- **`recordDoc` is untouched** (ADR-004) — `OUTCOME.md` is an ADDITIONAL artifact, never the primary
  record doc; no developer/evidence subagent authors it.

Driver-level, milestone-minimum (ADR-006). Per-story OUTCOME is a sanctioned follow-on, not this story.

## Tasks

<!-- Authored by the Three Amigos (QA leading the .feature scenarios + Examples), 2026-07-16. -->

- [ ] `tasks/00_outcome-template.feature` — `@executable`: the milestone `OUTCOME.md` template ships at
  both the source (`src/bundle/templates/milestone/OUTCOME.md`) and bundled
  (`.aof/templates/work/milestone/OUTCOME.md`) paths, opens on the pinned `# NN · … — Outcome` title,
  carries all three pinned sections in the SPEC `## Stories` grammar, and honours the leading-marker
  strip + LF discipline every bundle template carries.
- [ ] `tasks/01_verify-authors-outcome.feature` — `@manual`: `aof:verify` instantiates + authors
  `OUTCOME.md` at Accept (not at insert), stating **product state, not motive** (the product-vs-motive
  Examples table); `@executable`: an item's primary record doc stays its identity doc and a co-present
  `OUTCOME.md` never becomes the record doc `validate`/`recordDoc` resolve.

## Notes

<!-- Interface with story 02: the pinned OUTCOME.md grammar in the milestone SPEC is the contract
     `parseOutcome` reads. If a task changes a heading/label, it changes the SPEC grammar too. -->

<!-- FEASIBILITY FLAG for the developer amigo (QA feasibility pass, 2026-07-16): the OUTCOME.md
     template opens on `# NN · … — Outcome` with NO `---` frontmatter (ADR-004 — it carries no
     identity). Today's `insert-shared.mjs#stripBundleMarker` anchors its strip on a `(?=---)`
     frontmatter-fence lookahead, so it will NOT strip the leading `<!-- aof-generated: bundle -->`
     marker from a frontmatter-less OUTCOME.md — verified: the marker survives as line 1. The developer
     must generalise the strip (e.g. relax the lookahead to any first content line) and/or apply a
     marker-tolerant strip in the verify-authoring path. Do NOT bolt a `---` fence onto OUTCOME.md —
     that violates ADR-004 and the pinned grammar. Authoring hook: `verify.md` currently never mentions
     OUTCOME.md; add the instantiate+author step at the milestone-Accept juncture in `<process>` (step 5
     / progress_tracking), NOT in `<spike-chore>` — that satisfies the acd-outcome-authored-by-verify
     fitness function's verify.md grep. -->
