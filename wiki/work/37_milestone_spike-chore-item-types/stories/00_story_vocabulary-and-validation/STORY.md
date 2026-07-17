---
type: story
number: 00
slug: vocabulary-and-validation
title: "Vocabulary & structural validation — admit spike/chore to the engine"
parent: 37
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · Vocabulary & structural validation

## User story

As an ACD practitioner tracking investigative and housekeeping work,
I want the work engine to recognise `spike` and `chore` as valid top-level driver types — enumerated,
ordered in the `depends` graph, each with its own record doc and structural validation,
so that these folders are first-class citizens of `aof work` (found, sequenced, validated) instead of
folder-shaped items the engine rejects or mis-classifies as needing break-down.

<!-- This is the FOUNDATION story: the only one that edits the god-node `src/work.mjs` (35 importers —
     see ARCHITECTURE.md "Story boundaries"). Stories 01 and 02 build on the vocabulary it lands.
     The internal structural invariants (isDriver true, recordDoc mapping, nextWork uat-shaped return,
     ITEM_RE shape) are locked by fitness functions FF-3701..3706 in test/arch/ — the .feature tasks
     below capture the OBSERVABLE CLI behaviour, not those invariants. -->

## Tasks

<!-- Each a tasks/NN_<slug>.feature whose scenarios are the acceptance criteria. Authored at refine
     (Three Amigos). A task is done when its @executable feature is green. -->

- [x] `tasks/00_admit-and-enumerate.feature` — `aof work find`/`list` enumerate a `NN_spike_<slug>` /
  `NN_chore_<slug>` folder as its type; the original four types still resolve.
- [x] `tasks/01_drivers-ordering-and-next.feature` — spike/chore are `depends` targets, participate in the
  acyclic graph, and `aof work next` surfaces a ready one as the actionable item itself (never
  "needs break-down"), respecting `depends`.
- [x] `tasks/02_record-doc-and-structural-validate.feature` — a well-formed spike (`SPIKE.md`) / chore
  (`CHORE.md`) folder validates clean with no `tasks/`/`.feature`; malformed frontmatter and unresolved
  `depends` are flagged.

## Notes

- **Depends: none** — foundational. Edits `src/work.mjs` only (`ITEM_RE`, `recordDoc`, `isDriver`,
  `nextWork` item-is-the-work branch, `validateWork` native branch). Per ADR-001/002/003.
- `nextWork` must return spike/chore through the **candidacy-guarded, uat-shaped** ready-return (ADR-001,
  FF-3705 — honours 26/ADR-007), never a fresh unguarded return.
