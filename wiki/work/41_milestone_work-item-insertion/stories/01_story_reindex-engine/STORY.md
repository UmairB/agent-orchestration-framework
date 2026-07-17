---
type: story
number: 01
slug: reindex-engine
title: "Deterministic re-index engine — rename folders ≥ P, bump frontmatter number, and surgically rewrite depends/parent so the stream stays validate-green, with a pure shift-count primitive"
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
# 01 · Deterministic re-index engine — the shared foundation

## User story

As the **maintainer of an aof work stream who needs to slot new work into position**,
I want a **deterministic engine** that, given an insertion point `P` and a number space, renames every
`NN_type_slug` folder at/after `P` up by one, bumps each item's frontmatter `number`, and **surgically
rewrites the stored `depends`/`parent` references** that pointed at a shifted item — and can tell me
**exactly how many items would shift** before it runs,
so that the re-order the tool performs is **correct by construction** (never an off-by-one or a missed
reference the way a hand-renumber is), leaving `aof work validate` green with no manual repair.

<!-- This is the risk-carrying shared core (ADR-005 story 1). It has NO command surface — the three
     insert commands (stories 02, 03) wrap it. Proving the deterministic renumber+rewrite in isolation,
     against a fixture work-stream, is what lets the command families build in parallel on top of a
     trusted foundation. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` ADR-001 / ADR-003 / ADR-004:

1. **A new module `src/work-reindex.mjs`** exports the engine. It **imports `work.mjs`'s readers**
   (`listItems`, `parseFrontmatter`, `recordDoc`, and `ITEM_RE` — promoted to an export here, the one
   minimal touch of the god-node); `work.mjs` **never imports it back** (ADR-001; guarded by
   `acd-reindex-engine-blast-radius`).
2. **Slot-open** — indicatively `reindexForInsert(workDir, { at, space })`: renames every folder with
   `number ≥ P` in the target space up by exactly one (no gaps, no collisions), and bumps that item's
   frontmatter `number` to match its new folder.
3. **Reference rewrite (ADR-003 Tier 1, the validate-green guarantee):** every `parent` still resolves
   to its (possibly-renumbered) milestone; every `depends` still resolves to its (possibly-renumbered)
   top-level driver; the `depends` graph stays acyclic. No `depends`/`parent` value points at a number
   that no longer exists.
4. **Surgical frontmatter write (ADR-001):** the rewrite replaces ONLY the target line(s) (`number`,
   and any `depends`/`parent` pointing at a shifted item) via a targeted regex and reassembles the
   record doc byte-for-byte — mirroring `rollbackItemStatus`. It does **not** round-trip through
   `parseFrontmatter`/reserialize (18/ADR-007), does not reformat, does not drop comments, and does not
   bump `updated`.
5. **Two number-space axes (ADR-005):** the engine handles the **top-level** space (milestone/uat/…,
   which drags `depends` + nested-story `parent` rewrites) and the **nested** `stories/SS` space (only
   that milestone's nested stories shift; `parent` unchanged; no `depends`). Selected by `{ space }`.
6. **Count primitive (ADR-004):** a pure `countShiftedByInsert(workDir, { at, space })` returns how
   many items in the target space have `number ≥ P` — deterministic from `listItems`, reads no config,
   prompts nothing. The slot-open reuses this same primitive (one source of truth).
7. **Tested via the direct API against a fixture work-stream** — NO command surface in this story.
   After a slot-open, a fresh `aof work validate` over the fixture is green (folder ↔ `number`
   consistent, `parent`/`depends` resolve, acyclic).

## Tasks

<!-- Authored at `aof:refine 41 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. Kept independent of stories 02/03's tasks. -->

- [x] `tasks/00_slot-open-renames-and-bumps-number.feature`
- [x] `tasks/01_depends-and-parent-rewrite-stays-resolvable.feature`
- [x] `tasks/02_surgical-frontmatter-rewrite-is-byte-identical.feature`
- [x] `tasks/03_two-number-space-axes.feature`
- [x] `tasks/04_count-shifted-primitive.feature`

## Notes

- **Dependency shape (ADR-005):** this is the foundation. Stories 02 (`insert-top-level`) and 03
  (`insert-story`) both consume this engine and are independent of each other. Build this first.
- **The single `work.mjs` edit** the whole milestone requires — exporting `ITEM_RE` — belongs to this
  story (ADR-001).
- Fitness functions already committed green: `acd-reindex-resolution-folder-derived`,
  `acd-reindex-engine-blast-radius` (the latter arms the moment `work-reindex.mjs` lands).
- **Signature + rename order → ADR-006** (refine-time reconciliation): the engine's pinned signatures are
  `reindexForInsert(workDir, { at, space, parent })` / `countShiftedByInsert(workDir, { at, space, parent })`
  — `parent` (milestone number) REQUIRED when `space === "nested"`, absent for `"top-level"` — and folder
  renames MUST run in DESCENDING numeric order (highest number first) to avoid a slot collision. See ADR-006
  for specifics.
