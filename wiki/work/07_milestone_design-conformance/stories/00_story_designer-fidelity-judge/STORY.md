---
type: story
number: 00
slug: designer-fidelity-judge
title: "The designer is a read-only fidelity judge of a rendered screenshot"
parent: 7
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · The designer is a read-only fidelity judge of a rendered screenshot

## User story

As the **designer agent** asked to verify a built UI surface,
I want to judge a **rendered screenshot I am handed** against a committed mock + the binding checklist,
region-by-region, and return a structured `CONFORMS` / `GAPS` / `INCONCLUSIVE` verdict — saying
`INCONCLUSIVE` and naming the missing baseline when I have nothing real to compare against,
so that the design-conformance verdict reflects **what actually paints** instead of an inference from
code or a vibe-check — and the "looks right" answer is honest, evidence-backed, and never invented.

<!-- The fidelity-judge HALF of the responsibility-split contract (ADR-001). Owns exactly one bundled
     file: `src/bundle/agents/aof-designer.md`. The designer stays STRUCTURALLY read-only (no `Bash`):
     it can never run the browser, so it judges an artifact the orchestration renders and hands it
     (ADR-001). The verdict shape + INCONCLUSIVE-without-baseline rule are ADR-002; the baseline it
     judges against (committed mock and/or mandatory binding checklist) is ADR-003. Independent of the
     QA + wiring stories: it implements its half of the FROZEN contract in one file, binding to the
     render→hand-off seam, not to who renders. -->

## Tasks

- [x] `tasks/00_read-only-judge.feature` — the bundled `aof-designer` carries NO `Bash`, judges a
  screenshot it is *handed*, and never runs the browser itself (its slice of the ADR-001 role split);
  when handed no screenshot it returns `INCONCLUSIVE`, not a guess
- [x] `tasks/01_structured-verdict.feature` — the designer returns a region-by-region, evidence-backed
  `CONFORMS` / `GAPS(list)` / `INCONCLUSIVE` verdict against the committed mock + binding checklist
  (ADR-002/003), with each `GAP` a concrete design-gap (region · expected-vs-observed · fix), and
  `INCONCLUSIVE` (naming the missing baseline) when there is no mock AND no checklist — never inferring
  from component code in place of a render

## Notes

Inherits the milestone ADRs (ARCHITECTURE.md). Owns `src/bundle/agents/aof-designer.md` only; lifts the
prototyped-in-`.claude/` designer upgrade into the **bundle** source of truth (ADR-005) and completes it
to the ADR-002 verdict contract. The designer's `tools:` list (`Read, Grep, Glob, Write, WebSearch,
WebFetch`) is the *structural* guarantee of the role split — it MUST NOT gain `Bash`. Its slice of
`acd-design-role-split` (designer-no-Bash + judge-from-provided-screenshot) and the designer-side verdict
markers read by `acd-conformance-verdict-contract` are the @executable backstop; the actual *quality* of a
CONFORMS-vs-GAPS call on a real surface is `@uat` (judgment, not structure).
