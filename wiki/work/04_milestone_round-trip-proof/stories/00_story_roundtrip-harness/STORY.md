---
type: story
number: 00
slug: roundtrip-harness
title: "Round-trip harness — the frozen shared contract"
parent: 4
status: done
owner: product-owner
created: 2026-06-20
updated: 2026-06-20
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · Round-trip harness — the frozen shared contract

## User story

As a framework maintainer proving aof's own machinery,
I want a single round-trip harness that spins up a throwaway isolated repo, runs the **real** `aof work init`, and seeds the sample milestone behind a frozen API,
so that the install-proof and loop-proof stories build in parallel against one stable contract — never re-deriving setup and never risking my working tree.

<!-- This is the milestone's shared locked contract — the technique milestone 01 used (install-manifest
     schema, ADR-004/005) to let independent stories parallelise. Here the coupling point is the harness
     API, not a schema. Frozen surface (ARCHITECTURE.md ADR-005):
       createRoundTripRepo()    -> { dir, cleanup }
       installBundle(dir, opts) -> structured initWork result
       seedSampleMilestone(dir) -> { milestoneRef, storyRefs }
     Isolation (ADR-001) and reuse-not-reimplementation (ADR-002) are this story's load-bearing
     invariants; the three milestone-04 fitness functions turn GREEN when the harness is built to them. -->

## Tasks

<!-- Contracted (Three Amigos) 2026-06-20: PO headlines + aof-qa case matrices + aof-developer
     feasibility pass. Each `.feature` below is the authored contract. Tasks here are structural
     plumbing; most of the proof is the fitness functions flipping GREEN. -->

- [x] `tasks/00_isolated-repo.feature` — `createRoundTripRepo()` makes a `mkdtemp` + `git init` repo under the OS temp root, the repo is a usable git repo and empty-of-bundle before install, and `cleanup()` is idempotent (observable outcomes; isolation-as-invariant is ADR-001's fitness function)
- [x] `tasks/01_real-install.feature` — `installBundle(dir, opts)` delegates to the shipped `initWork` and passes its structured result through (`{actions, manifest, manifestPath, guarded, …}`); guarded/force and runtime selection observable (ADR-002)
- [x] `tasks/02_seed-sample-milestone.feature` — `seedSampleMilestone(dir)` writes the minimal deterministic fixture, returns `{ milestoneRef, storyRefs }` matching the seeded folders, resolvable + clean-validating through the work verbs (ADR-004)
- [x] `tasks/03_register-arch-tests.feature` — wire the three `acd-roundtrip-*` fitness functions into the runner so they run forever in CI; registration keyed by test file via a meta arch-test (deferred from Decide so the suite isn't RED before the harness exists)

## Notes

Inherits the milestone ADRs. **No dependency on its sibling stories** — it *is* the contract they consume.
Depends only on milestone **01** (uses the shipped bundle + `initWork`). Build this first (it is `00`,
ahead of `01`/`02` by number, which is the intended build order).

The three milestone-04 fitness functions (`acd-roundtrip-isolation`, `acd-roundtrip-reuses-shipped-code`,
`acd-roundtrip-harness-contract`) are written and RED by design (ARCHITECTURE.md). This story makes them
GREEN — and the `register-arch-tests` task is what keeps them green forever in CI.

**Build constraints (from the developer feasibility pass, 2026-06-20):**
- The `seedSampleMilestone` fixture must seed **≥2 stories** with fully valid frontmatter (folder-matching
  `type`/`number`/`slug`, valid `status`, **`created` + `updated`**, each story's `parent` resolving to the
  milestone) so `aof work validate` returns zero findings; use fixed strings (no `Date.now()`) so the seed
  is byte-identical across repos and the returned refs are stable in value and order.
- `installBundle` must **pass `initWork`'s result through verbatim** — do not throw on a 2nd no-force install
  (it returns `{ guarded: true, manifestWritten: false, … }`).
- Registration meta-test: the runner names tests by ADR prose, not file slug — assert each
  `acd-roundtrip-*.test.mjs`'s exported arch-tests are in the runner's assembled `tests` set (export it),
  and wire the three into **both** `scripts/test.mjs` and `scripts/test-unit.mjs`.
