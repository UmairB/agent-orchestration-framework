<!-- aof-generated: bundle -->

---
type: story
number: 29
slug: migrate-command
title: "Migrate Command — adopt an existing folder as a managed aof work item"
status: in-progress
owner: product-owner
created: 2026-06-30
updated: 2026-06-30
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A standalone story (no parent) is self-contained.
-->
# 29 · Migrate Command — adopt an existing folder as a managed aof work item

## User story

As a developer adopting aof on a codebase that already has work underway,
I want a `migrate` command that converts an existing folder into a full aof work item — a real SPEC
(+ stories + tasks) under management — and, when some or all of that work is already done, has the
architect agent review what was delivered and flag the issues a developer can then pick up,
so that I can bring legacy and in-flight work under aof's managed lifecycle (refine / continue /
verify) instead of either restarting it from scratch or settling for `import`'s read-only knowledge
snapshot.

<!--
  The "so that" is the real benefit and the line that justifies a NEW command alongside import.
  The contrast is load-bearing and must survive into refinement:
    - `import`  → SUMMARISES a foreign folder into an AOF.md knowledge digest. Read-only on the
                  source, one-time snapshot, NEVER becomes a managed work item (knowledge only).
    - `migrate` → CONVERTS a folder INTO a full aof spec that IS managed work — refinable,
                  continuable, verifiable. The folder becomes the work item, not a digest of it.
  Already-done work is reconciled, not re-run: the architect reviews what exists and flags issues as
  developer-actionable findings, so migrate produces an honest starting state rather than pretending
  the work is greenfield.
-->

## Tasks

<!-- Authored by `aof:refine 29` (Three Amigos): each task is a tasks/NN_<slug>.feature whose scenarios
     are its acceptance criteria. Tick a box when its @executable feature is green. -->

- [ ] [00 — migrate produces a managed work item](tasks/00_migrate-produces-managed-item.feature)
      (the core seam: folder in → a real, managed milestone SPEC + stories + tasks under work.dir that
      resolves via `aof work find` and passes `aof work validate`; `--dry-run` previews; next free slot)
- [ ] [01 — migrate vs import, distinct outcome](tasks/01_migrate-vs-import-distinct-outcome.feature)
      (the load-bearing contrast: migrate writes MANAGED work into the stream — never an AOF.md digest,
      never the `.aof/imports/` store — and leaves import's behaviour untouched)
- [ ] [02 — already-done reconciled into findings](tasks/02_already-done-review-findings.feature)
      (detect delivered work so status reflects reality; the architect reviews it and records
      developer-actionable findings — an honest starting state, not greenfield)
- [ ] [03 — source-shape tolerance](tasks/03_source-shape-tolerance.feature)
      (read/normalise any source shape reusing import's recovery; never demand aof's layout; absence is
      information — a thin source recovers a thin item, an empty one is refused, nothing fabricated)

## Notes

Standalone for now; if migrate grows companion capabilities it can be regrouped under a milestone at
refinement. Relationship to milestone 13 (External Milestone Import) is deliberate contrast, not
overlap — migrate should reuse import's source-reading/normalization where sensible but diverges at
the outcome: a managed work item under aof's lifecycle, with architect review reconciling work that
is already (partially) done.

### Open questions (deferred to the architect at `aof:continue 29` — not pinned by this contract)

The contract pins the OBSERVABLE end-state (a managed item in the stream, derived from the source);
these mechanism decisions are genuinely architectural and are recorded as ADRs when the story is built:

- **In-place vs scaffold destination.** "The folder becomes the work item" (STORY.md) admits two
  mechanisms: relocate/adopt the source folder under `work.dir`, or re-express its work into a fresh
  scaffold under `work.dir` while leaving the source read-only. The features assert only that a managed
  item derived from the source lands under `work.dir` and the source is unchanged; the move-vs-copy call
  is the architect's. (Referenced from `tasks/01` and `tasks/00` comments.)
- **Where findings land.** Reconciliation findings (task 02) must EXIST and be developer-actionable;
  whether they live in a dedicated findings doc, the produced `STATE.md`, or a SPEC section is open.
- **Command id.** `aof migrate <folder>` registers one command in the frozen core; its exact id
  (`migrate` vs `migrate:folder`) is the developer/architect's call and is pinned by the bijection
  arch-test, not by a scenario.
