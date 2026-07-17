---
type: story
number: 03
slug: insert-story
title: "insert-story — place a new story at a target local position SS under a milestone via the engine's nested axis, best-effort-updating the milestone ## Stories checklist"
parent: 41
status: done
owner: product-owner
created: 2026-07-16
updated: 2026-07-16
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs (ARCHITECTURE.md).
-->
# 03 · insert-story — nested placement

## User story

As an **operator refining a milestone who discovers a story that belongs before existing siblings**,
I want `aof work insert-story <slug> --at SS [under milestone NN]` to **frame the new story at local
position `SS`** and shift that milestone's nested stories at/after `SS` up by one,
so that the story lands **in the right order within its milestone** — with the milestone's `## Stories`
checklist kept consistent and `aof work validate` green — instead of my renumbering `stories/` folders
by hand.

<!-- ADR-005 story 3 (the nested SS number-space axis). Lower-risk than story 02: parent is unchanged
     (same milestone), stories carry no depends, so the validate-green cost is near-zero; the only human
     surface is the milestone ## Stories checklist (ADR-003 Tier 2, best-effort). Depends on story 01's
     engine. Independent of story 02. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` ADR-002 / ADR-003 / ADR-005:

1. **A thin CLI command — `aof work insert-story <slug> --at <SS> [under milestone NN] [--yes]`** — a
   thin wrapper over the story-01 engine on its **nested** axis, mirroring the `validate.mjs`
   thin-command shape (command-core registration, `cli.mjs` dispatch, `--json` envelope). Covered by the
   `acd-work-command-cli-bijection` guard.
2. **Placement + scaffold (ADR-002):** the command runs the engine to open the slot at `SS` in the
   target milestone's `stories/` space, then scaffolds the new `STORY.md` (+ empty `tasks/`) from
   `.aof/templates/work/story/` with correct identity frontmatter (`number = SS`, `type: story`,
   `slug`, `parent = NN`, `created`/`updated` = today) — the SAME template `add-story` uses.
3. **Nested re-order is correct + validate-green (ADR-003 Tier 1):** after the insert, the new story
   occupies `SS`, every pre-existing nested story that was `≥ SS` moved up by exactly one, each shifted
   story's frontmatter `number` matches its folder, `parent` still resolves to the milestone, and `aof
   work validate` is green with no manual repair.
4. **`## Stories` checklist kept consistent (ADR-003 Tier 2, best-effort):** the command updates the
   milestone SPEC `## Stories` bullets so a reader sees the new story and the shifted refs — a stale
   bullet is a human-doc nit, NOT a validate failure, and must not make the insert "fail."
5. **Count-gated confirmation (ADR-004):** same guard as story 02 — count via the engine primitive,
   threshold at the command boundary, `--yes` for non-interactive intent, above-threshold-without-`--yes`
   on a non-interactive caller fails LOUD and coded; the shift count is in the `--json` envelope.

## Tasks

<!-- Authored at `aof:refine 41 --autonomous` (Three Amigos). Each is a tasks/NN_<slug>.feature. Kept
     independent of stories 01/02's tasks. -->

- [x] `tasks/00_insert-story-places-and-scaffolds.feature`
- [x] `tasks/01_nested-shift-preserves-parent-and-validate-green.feature`
- [x] `tasks/02_stories-checklist-best-effort-update.feature`
- [x] `tasks/03_count-gated-confirmation-and-yes-override.feature`

## Notes

- **Depends on story 01** (the engine API). **Independent of story 02** — the nested `SS` space is
  disjoint from the top-level space, and the command file is separate.
- Lower-risk than story 02: `parent` unchanged, no `depends`, so the only real reference work is the
  best-effort `## Stories` update (ADR-003 Tier 2).
- **Nested selector + envelope → ADR-006** (refine-time reconciliation): the nested engine call takes a
  REQUIRED `parent` (milestone number) — the command's `--under NN` maps onto it — and the `--json` envelope
  echoes `created: { ref, type, slug, parent }` so the new story's placed ref is outsider-observable. See
  ADR-006 for specifics.
