---
type: milestone
number: 07
slug: design-conformance
title: "Design-Conformance Verification"
status: done
owner: product-owner
created: 2026-06-21
updated: 2026-06-22
depends: [01, 03]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 07 · Design-Conformance Verification

## Objective

The design-conformance loop is the weakest link in ACD's UI delivery. The designer is asked to compare
a built surface to "the mock", but in practice it has **neither a machine-readable mock nor a rendered
screenshot** to judge against — so it infers from code or guesses, and visual drift is only caught when
the operator manually screenshots the differences and pastes them back. The "looks right" verification
isn't self-sufficient.

This milestone makes that verification real. A mock, **when one exists, becomes a committed artifact
stored with the milestone** and is the source of truth the review reads; when none exists, the binding
checklist is mandatory and takes that role. The design-conformance review **renders the built surface
and returns a structured, evidence-backed verdict — or `INCONCLUSIVE` when there is no baseline** —
instead of a vibe-check. And the responsibility split is made explicit in the agents and commands: the
**designer judges fidelity** (read-only, from a screenshot), while **QA runs the browser harness** and
owns the regression that locks an approved baseline in.

Verifiable end state: a UI milestone can be taken from build to accept and have its visual fidelity
verified **without the operator manually comparing screenshots** — the review either confirms
conformance against a committed baseline, lists concrete design-gap findings, or honestly reports
`INCONCLUSIVE` and names the missing baseline as the gap to close.

## Scope

In scope:
- **Committed-mock convention** — at refine the designer elicits mocks from the user; any that exist are
  recorded with the milestone under `mocks/` and referenced in `DESIGN.md` as the conformance source of
  truth. No mock → the binding checklist is mandatory and is the source of truth.
- **Structured conformance verdict** — the review judges the built surface against the committed mock +
  binding checklist region-by-region (concrete fixes, not "looks fine"), rendered via Playwright against
  `work.ui.baseUrl` / `--url` at defined breakpoints, returning `INCONCLUSIVE` when no baseline exists
  (the principle borrowed from ecc's `browser-qa`).
- **Role split made real** in the agent + command contracts — designer = read-only fidelity judge from a
  rendered screenshot; QA = runs the browser harness, owns functional checks and the `toHaveScreenshot`
  regression that enforces the designer-approved baseline.
- **Optional a11y lane, owned by QA** — opt-in via an `a11y` entry in `work.tags.domains` (absent ≡ off);
  conformance level optionally recorded in `work.ui.a11y`. Absence is the decision (no a11y where it
  doesn't belong).
- **Bundle-drift fix** — the upgraded designer agent + `verify`/`continue` review steps + DESIGN template
  currently live only in `.claude/`; lift them into `src/bundle/` so new aof projects inherit the loop.

Out of scope:
- A full pixel-exact visual-regression suite — the `toHaveScreenshot` *seam* is defined here, but
  building out baselines as a hard gate is a QA-owned follow-on.
- ACD booting/serving the app — ACD never boots the app; the project serves it and ACD points at
  `work.ui.baseUrl` (unchanged).
- Authoring a design system / design tokens for any specific product — this is the verification
  machinery, not a token system.
- A performance / Core-Web-Vitals lane — that is the architect's fitness-function territory, not this
  milestone.
- Backfilling milestone 03's remote mock into a committed local file — the convention applies going
  forward; retrofitting 03 is optional, not required here.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 07.
     The milestone is accepted when all its stories are. Broken down 2026-06-21 (aof:refine 07
     --autonomous) into three INDEPENDENT stories, decoupled by the frozen responsibility-split
     contract (ARCHITECTURE.md ADR-001) and disjoint `src/bundle/` ownership; the only co-touched
     artifact is the derived `manifest.json` (ADR-005/006). See ARCHITECTURE.md for the ADRs + fitness
     functions. -->

- [x] `stories/00_story_designer-fidelity-judge` — the designer is a read-only fidelity judge of a
  rendered screenshot it is handed: region-by-region `CONFORMS`/`GAPS`/`INCONCLUSIVE` vs the committed
  mock + binding checklist, `INCONCLUSIVE`-when-no-baseline (no `Bash`). Owns
  `src/bundle/agents/aof-designer.md`. (ADR-001/002/003)
- [x] `stories/01_story_qa-browser-harness` — QA runs the Playwright browser harness, owns the
  `toHaveScreenshot` regression that locks the designer-approved baseline + the functional checks, and
  the optional opt-in a11y lane. Owns `src/bundle/agents/aof-qa.md` + the additive, closed
  `work.ui.a11y` schema block. (ADR-001/002/004)
- [x] `stories/02_story_review-wiring-and-convention` — `refine` elicits + commits the mock; the DESIGN
  template makes the binding checklist mandatory; `verify`/`continue` render the surface and hand the
  screenshot to the designer + spawn QA; and the whole loop lands in `src/bundle/` behind a drift guard.
  Owns `src/bundle/commands/{refine,verify,continue}.md` + `templates/milestone/DESIGN.md` + the drift
  guard. (ADR-002/003/005/006)

## Dependencies

- `01_milestone_acd-asset-bundle` — the designer agent, commands, templates, and schema this milestone
  changes are the ACD asset bundle.
- `03_milestone_work-board-ui` — its UI is the proving ground for the rendered conformance review and the
  first real test of the committed-mock convention.
