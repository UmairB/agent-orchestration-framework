---
type: milestone
number: 41
slug: work-item-insertion
title: "Work-item insertion & re-index"
status: done
owner: product-owner
created: 2026-07-16
updated: 2026-07-16
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 41 · Work-item insertion & re-index

## Objective

The work stream numbers items by append order — the next `NN` is always `max + 1`, so every new
milestone, story, or UAT lands at the tail. Concurrent work streams break that assumption: work
discovered mid-flight belongs *beside* related items in the roadmap, not appended after everything
that came later. Today the only way to slot an item into position is to renumber folders by hand and
chase every reference that points at them — error-prone and validate-breaking.

This milestone adds `insert-milestone`, `insert-story`, and `insert-uat`: each frames a new item at a
**target position** and then re-indexes every subsequent item up by one, keeping the work stream
valid throughout. The outcome is verifiable by an outsider: after inserting at position `P`, the new
item occupies `P`; every pre-existing item that was `≥ P` has shifted up by exactly one; all
machine-readable references (`depends`, `parent`, milestone→story checklists, ROADMAP rows) still
point at the right items; and `aof work validate` is green with no manual repair.

## Scope

In scope:
- **Three insert commands** — `insert-milestone`, `insert-story`, `insert-uat` — that scaffold a
  framed item at a caller-given target position, reusing the framing logic of their `add-*`
  counterparts; they differ only in *placement*, not in what they scaffold.
- **Integrity-preserving re-index** of every item at/after the insertion point: rename the
  `NN_type_slug` folders, bump frontmatter `number`, and rewrite all **machine** references —
  `depends` edges, `parent`, milestone→story checklist bullets, and ROADMAP.md rows — so nothing
  dangles.
- **Count-gated confirmation** — when only a handful of items must shift, proceed automatically; when
  many must shift, warn the user that the re-order is costly and confirm intent before proceeding.
- **Validate-green invariant** — the command leaves `aof work validate` passing (folder↔frontmatter,
  closed tag vocabulary, depends graph) as its acceptance bar.

Out of scope:
- **Prose cross-reference rewriting** — human mentions like "see milestone 34" or "#34" inside doc
  bodies are *not* rewritten; machine references are the correctness surface. Deferred; may be a
  follow-up best-effort sweep.
- **`insert-chore` / `insert-spike`** — not requested. The re-index machinery is shared and can
  extend to these item types later without redesign.
- **Moving / re-ordering an existing item** — this milestone only *inserts new* items; renumber-in-
  place of already-present work is a separate capability.
- **Concurrent-insert safety** — single-actor assumption; locking two simultaneous inserts is not in
  scope.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 41.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down by `aof:refine 41` (2026-07-16); partition rationale in `ARCHITECTURE.md` ADR-005 —
the two number spaces plus their shared engine. Stories 02 ∥ 03 are independent siblings on story 01.

- [x] `41/01` — `01_story_reindex-engine` — the deterministic renumber + `depends`/`parent` rewrite
  core + shift-count primitive (`src/work-reindex.mjs`); the shared foundation, no command surface.
- [x] `41/02` — `02_story_insert-top-level` — `insert-milestone` + `insert-uat` (top-level driver
  placement, one axis) with the count-gated confirmation guard. Depends on `41/01`.
- [x] `41/03` — `03_story_insert-story` — `insert-story` nested-story placement (the `SS` axis),
  best-effort `## Stories` update. Depends on `41/01`; independent of `41/02`.

## Dependencies

- **`add-milestone` / `add-story` / `add-uat`** — insert reuses their scaffolding/framing logic; the
  insert commands are placement wrappers over the same authoring path.
- **`aof work validate`** (folder↔frontmatter, depends graph) — the green bar the re-index must
  preserve; it defines "did the re-index stay honest".
- **ROADMAP.md** — the roadmap index whose numbered rows must stay consistent after a shift.

## Accept decision

**ACCEPTED — `aof:verify 41` (2026-07-16).** All three stories `done`. The single lane in scope
(`@executable`) is green — `node scripts/test.mjs` → exit 0, 2576 ok / 0 not-ok, both m41 fitness
functions armed+green — and `aof work validate 41` → PASS. No `@manual`/`@uat` lane exists (foundational
CLI/engine milestone, no UI). Two deferred non-blocker findings (F-4101 pad-width non-uniformity across
a 2→3 digit boundary; F-4102 inline-only `depends` rewrite) — no blocker open. Full record in
`VERIFICATION.md`; lessons distilled to `RETROSPECTIVE.md` and folded into memory.
