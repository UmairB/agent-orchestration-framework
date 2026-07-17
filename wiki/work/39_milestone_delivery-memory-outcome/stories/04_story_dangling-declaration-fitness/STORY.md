---
type: story
number: 04
slug: dangling-declaration-fitness
title: "Dangling-declaration fitness function — declared surface with no producer fails red"
parent: 39
status: not-started
owner: product-owner
created: 2026-07-16
updated: 2026-07-16
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
-->
# 04 · Dangling-declaration fitness function

## User story

As the **reviewer trusting the delivery record**,
I want a fitness function that fails red when a declared record-format field has no producer in the
codebase — whether or not an `OUTCOME.md` owned up to it,
so that the honesty box does not depend on the honesty of its author: a field declared with no writer
(exactly `warnings_delivered`) is caught mechanically, even the one nobody wrote down.

<!-- Challengeable benefit (SPEC "The artifact must not depend on the honesty of its author"): a
     self-reported gap is worth the reporter's candour — and the reporter is the same agent that
     filled a field with fiction. Without a mechanical cross-check this milestone "ships an honesty box
     for a liar." This story is the genuine PREVENTION half (ADR-005/006); recall only makes it visible. -->

## Scope & contract

- **The fitness function** (ADR-005 contract): given (i) a declared field set from a single source of
  truth (a frozen field list / enum, e.g. `MEMORY_RECORD_FIELDS`) and (ii) a bounded set of producer
  modules, compute the fields with ZERO producer write-site and FAIL RED on any non-empty result.
  Generalises the `test/arch/acd-assignment-state-has-producer.test.mjs` idiom (35/ADR-001) from a
  state enum to a record-format field set. Lives under `test/arch/` and is wired into the assembled
  runner registry (`scripts/test.mjs`).
- **Non-vacuity is mandatory** (05/R2): the check passes a real clean field set AND a PLANTED
  producerless field trips the same detector — so it proves it can fail, not just that it is green.
- **Honest scope boundary** stated in the test + VERIFICATION: record-format fields are the tractable,
  statically-reachable case; CLI flags, HTTP endpoints, config keys, and dynamic/computed/reflective/
  cross-language producers are explicitly OUT of scope. The check catches the motivating class and
  claims nothing more.

Independent of stories 01–03: reads a single-source field list + greps producer sites; needs no
`OUTCOME.md` present. (The milestone-presence invariant is already asserted inert-green by the
architect's `test/arch/acd-outcome-dangling-declaration-present.test.mjs`; this story makes it live.)

## Tasks

<!-- Authored by the Three Amigos (QA owns the Scenario/Examples). Feasibility confirmed against real
     code: MEMORY_RECORD_FIELDS (src/memory/local-retrieval.mjs) × its producer parsers
     (src/memory/local-indexing.mjs) — all 13 fields have a producer write-site today (clean set is
     green); warnings_delivered exists nowhere in src/ (the planted-negative is synthetic). -->

- [ ] `tasks/00_dangling-declaration-ff.feature` — the fitness function passes a clean field set, fails
  red on a declared-field-with-no-producer (the `warnings_delivered`-shape planted-negative, tripping
  the SAME detector), catches an undeclared dangling field with no `OUTCOME.md` present, asserts the
  honest in-scope-vs-out-of-scope declaration-class boundary (Examples table), and is wired into the
  assembled runner.

## Notes

<!-- Prevention, not recall (ADR-006): this is the only genuine prevention of a dangling field in the
     authoring milestone. VERIFICATION must not sell recall as the preventer. -->
