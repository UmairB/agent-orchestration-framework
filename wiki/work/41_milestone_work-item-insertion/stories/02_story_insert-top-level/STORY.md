---
type: story
number: 02
slug: insert-top-level
title: "insert-milestone & insert-uat — place a new top-level driver at a target position P via the engine, count-gated so a costly re-order is confirmed and automation is never deadlocked"
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
# 02 · insert-milestone & insert-uat — top-level placement

## User story

As an **operator whose roadmap gained work that belongs beside existing items, not at the tail**,
I want `aof work insert-milestone <slug> --at P` and `aof work insert-uat <slug> --at P` to **frame the
new driver at position `P`** and re-index every top-level item at/after `P` up by one,
so that discovered-mid-flight work lands **where it belongs in the roadmap** — with all `depends` edges
and nested-story `parent`s still resolving and `aof work validate` green — instead of my renumbering
folders and chasing references by hand.

<!-- ADR-005 story 2 (the top-level number-space axis). insert-milestone and insert-uat share ONE story
     because they are ONE axis: identical top-level-driver placement mechanics (same engine call, same
     depends/parent-rewrite consequences), differing only in which template they scaffold. Depends on
     story 01's engine. Independent of story 03. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` ADR-002 / ADR-004 / ADR-005:

1. **Two thin CLI commands — `aof work insert-milestone <slug> --at <P> [--yes]` and `aof work
   insert-uat <slug> --at <P> [--yes]`** — each a thin wrapper over the story-01 engine, mirroring
   `commands/validate.mjs`'s thin-over-engine shape (registered on command-core, dispatched from
   `cli.mjs`, `--json` envelope). Covered by the existing `acd-work-command-cli-bijection` guard.
2. **Placement + scaffold (ADR-002):** the command runs the engine to open the slot at `P` in the
   **top-level** space, then scaffolds the new item's skeleton from `.aof/templates/work/<type>/` INTO
   slot `P` with correct identity frontmatter (`number = P`, `type`, `slug`, `created`/`updated` =
   today) — the SAME templates `add-milestone`/`add-uat` use. For `insert-uat`, `depends:` framing is
   authored as `add-uat` does today.
3. **The re-order is correct + validate-green (ADR-003 Tier 1):** after the insert, the new item
   occupies `P`, every pre-existing top-level item that was `≥ P` moved up by exactly one, every
   `depends` and nested-story `parent` still resolves, and `aof work validate` is green with no manual
   repair.
4. **Count-gated confirmation (ADR-004):** the command computes the shift count via the engine
   primitive; below a documented threshold it proceeds automatically; at/above it warns the operator
   the re-order is costly and requires explicit intent. `--yes` (alias `--force`) asserts intent for a
   non-interactive caller and proceeds regardless of count. Above-threshold **without** `--yes` on a
   non-interactive caller **fails LOUD and coded** — never hangs on a prompt. The shift count is always
   reported in the `--json` envelope.
5. **Prose framing stays PO/prompt-authored on top (ADR-002):** the CLI produces a valid,
   correctly-numbered, correctly-referenced skeleton; the objective/scope/framing prose is authored via
   the same `aof-product-owner` path `add-*` uses. The renumber is never an LLM step.

## Tasks

<!-- Authored at `aof:refine 41 --autonomous` (Three Amigos). Each is a tasks/NN_<slug>.feature. Kept
     independent of stories 01/03's tasks. -->

- [x] `tasks/00_insert-top-level-places-and-scaffolds.feature`
- [x] `tasks/01_insert-uat-depends-framing.feature`
- [x] `tasks/02_count-gated-confirmation-and-yes-override.feature`
- [x] `tasks/03_shift-count-reported-in-json-envelope.feature`

## Notes

- **Depends on story 01** (the engine API). **Independent of story 03** — disjoint number space
  (top-level vs nested) and disjoint command files; a mechanical merge has no conflicting hunk.
- `insert-milestone` and `insert-uat` are one story because they are one axis; `insert-story` is a
  separate story because it is the other axis (ADR-005).
- **`--json` envelope shape → ADR-006** (refine-time reconciliation): beyond ADR-004's `{ shifted, at, space }`,
  the envelope also echoes `created: { ref, type, slug, parent }`, and for `insert-uat` its post-shift-resolved
  `created.depends` — the black-box channel the depends-framing scenarios read (`find`/`validate` never surface
  `depends`). See ADR-006 for specifics.
