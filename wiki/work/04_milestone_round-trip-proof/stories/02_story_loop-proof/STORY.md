---
type: story
number: 02
slug: loop-proof
title: "Loop proof — the bundled actors compose into a working loop"
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
# 02 · Loop proof — the bundled actors compose into a working loop

## User story

As a framework maintainer,
I want the seeded sample milestone driven through refine → continue → verify with the **bundled** ACD commands and agents until it reaches `done`, with the deterministic spine (`validate` gating, `next` dependency-ordering) proven in CI and the agent loop signed off once with captured evidence,
so that I have standing proof the shipped methodology and tooling actually compose end-to-end — not just unit-by-unit.

<!-- The "loop side" of the round-trip. Two surfaces by ADR-003:
       @executable — the CLI spine: `aof work validate` gates a seeded stream, `aof work next` returns
                     the correct dependency-ready item across seeded states.
       @manual/@uat — the irreducibly agent-driven pass: actually run the bundled /aof:refine →
                     /aof:continue → /aof:verify on the fixture, capture evidence, sign off in UAT.md.
     No @executable/fitness scenario may assert agent-AUTHORED content (ADR-003) — those carry
     @manual/@uat. Consumes the harness's createRoundTripRepo() + seedSampleMilestone() (ADR-005). -->

## Tasks

<!-- Contracted (Three Amigos) 2026-06-20. The spine scenarios are `@executable`; the run-the-real-loop
     feature is one `@uat` lane (ADR-003). Defect/blocked states are applied as test-side fixture
     perturbations on the seeded sample — the frozen harness API is not extended (see STATE.md). -->

- [x] `tasks/00_validate-gates.feature` — `@executable`: `aof work validate` passes a clean seeded stream and reports each real defect class (folder↔frontmatter, tag-vocabulary, depends cycle/missing-target)
- [x] `tasks/01_next-orders.feature` — `@executable`: `aof work next` returns the correct `{state, ref}` across seeded states — first story, skip-to-next, accept-the-milestone, break-down, blocked-on-unmet-depends, done
- [x] `tasks/02_roundtrip-signoff.feature` — `@uat`: a person runs the bundled refine→continue→verify on the fixture to `done`, consuming (not re-proving) the CI spine; evidence + sign-off in `UAT.md` _(signed off ACCEPT 2026-06-20 — driven in a real adopting repo; F-02 logged → 01)_

## Notes

Inherits the milestone ADRs. **Independent of `01_story_install-proof`** — the only coupling is the
frozen harness API (`createRoundTripRepo` + `seedSampleMilestone`, plus the installed bundle); this
story never imports the install-proof story's code. Depends on `00_story_roundtrip-harness`.

This story carries the milestone's only human gate: the `@manual`/`@uat` round-trip sign-off proves what
CI structurally cannot (that the agents *reason* the loop to completion). Per ADR-004, any gap either
surface exposes routes back to milestones **00/01** via `aof:feedback` — it is logged, not patched in
place here.
