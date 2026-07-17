---
type: story
number: 01
slug: version-stamp-and-reader
title: "The version stamp & its reader — a work item that records the aof that made it, a schema integer that drives migration, and a born-stamp so new items are never stale-by-construction"
parent: 40
status: in-review
owner: product-owner
created: 2026-07-17
updated: 2026-07-17
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs (ARCHITECTURE.md).
-->
# 01 · The version stamp & its reader — the foundation

## User story

As the **maintainer of an aof work stream installed in someone else's repo**,
I want **every work item to record the aof schema that produced it** — a machine-comparable `schema`
integer that drives migration and a human-legible `aofVersion` provenance string — with new items
**born stamped** at scaffold time and unstamped items read as the pre-versioning baseline,
so that the stream can finally **say which aof produced it** and a migration engine has a deterministic
`item.schema → current` distance to compute against — the load-bearing fact the whole upgrade path
stands on.

<!-- This is the foundation (ADR-001/002/003/004). It has NO command surface — it is the version MODEL
     (constant + two frontmatter keys + reader + the transform-scoped writer primitive) that stories 02
     and 03 both build on. Everything lives in the god-node `work.mjs` (39 dependents) plus the scaffold
     seam; every touch is purely additive (new exports), so the blast radius does not grow. -->

## Acceptance criteria (outcome — detailed scenarios authored at refine, into the task `.feature`s)

Grounded in `ARCHITECTURE.md` ADR-001 / ADR-002 / ADR-003 / ADR-004:

1. **Two frontmatter keys, never one (ADR-001):** the record doc carries `schema` — a non-negative
   **integer**, the *only* field a migration selector reads — and `aofVersion` — a **string**, the aof
   package version that created the item (`packageVersionString()`, `asset-base.mjs:235`), never parsed
   for logic. The existing minimal `parseFrontmatter` (`work.mjs:314`) already parses both as scalars —
   **no parser change** (18/ADR-007 protected).
2. **One exported constant, `WORK_ITEM_SCHEMA_VERSION`, in `work.mjs` (ADR-001):** an integer, initial
   value **1**, mirroring `GLOBAL_WORK_SCHEMA_VERSION`'s single-constant idiom
   (`global-work-store.mjs:7`). It is the single declaration of "the current document shape".
3. **The unstamped baseline (ADR-003):** an item with **no `schema` key reads as schema `0`** — the
   pre-versioning baseline — mirroring `readSchemaVersion`'s null→needs-migration treatment
   (`global-work-store.mjs:80-87`). A non-integer `schema` coerces to `0` too.
4. **New items are born stamped (ADR-002):** the scaffold/insert render path writes
   `schema: <WORK_ITEM_SCHEMA_VERSION>` and `aofVersion: <packageVersionString()>` into the record
   doc's frontmatter at creation, so a freshly-created item is **never stale-by-construction**.
5. **The transform-scoped frontmatter writer (ADR-004):** a NEW export in `work.mjs` (indicatively
   `applyItemFrontmatter`) that rewrites **only the leading `---…---` block** (may add/rename/re-value
   keys) and reassembles the **body byte-for-byte** around it — the `rollbackItemStatus` slice idiom
   (`work.mjs:390-404`), NOT a `parseFrontmatter`+reserialize round-trip (18/ADR-007). It persists via
   the atomic `writeText` temp+rename seam. It is the primitive the registry's transforms (story 02)
   call — not a public "edit any frontmatter" verb.
6. **The rollback writer's bound is preserved verbatim (ADR-004):** `rollbackItemStatus` keeps its hard
   status-only, in-progress→not-started|blocked bound (`work.mjs:362-405`) untouched — two narrow
   writers, each bounded, never one wide mutator.
7. **`work.mjs` never gains a dependency on the upgrade engine** — every change here is additive
   (new constant, new reader coercion, new writer export); the 39-module blast radius does not grow.

## Tasks

<!-- Authored at `aof:refine 40 --autonomous` (Three Amigos: PO headline Scenarios + aof-qa Examples +
     aof-developer feasibility). Each is a tasks/NN_<slug>.feature whose @executable scenarios are the
     acceptance criteria. -->

- [x] `tasks/00_reader-schema-and-provenance.feature` — 8/8 green
- [x] `tasks/01_new-items-born-stamped.feature` — 5/5 green
- [x] `tasks/02_transform-scoped-writer-body-preserving.feature` — 13/13 green

## Notes

- **Dependency shape (ADR-005):** this is the foundation. Stories **02** (registry & upgrade) and **03**
  (staleness in validate) both consume this model and are independent of each other — build this first.
- **Backstamping the EXISTING stream is NOT here** — ADR-003 makes the `0 → 1` stamp transform a
  *registry* transform (story 02), run via `aof upgrade`, not a bespoke script. Story 01 makes NEW items
  born-stamped and defines the reader/writer the transform will use; existing items read as `0` until
  story 02's upgrade stamps them. This is the honest interim state.
- **Fitness function** `acd-work-item-schema-single-constant` (already committed, guard-if-present) arms
  the moment the constant + the coercion land: it asserts `WORK_ITEM_SCHEMA_VERSION` is a monotonic int,
  a missing `schema` reads as 0, and (once story 02 lands) the registry's highest `to` equals it.
- `acd-migration-writer-body-preserving` arms when `applyItemFrontmatter` lands.
