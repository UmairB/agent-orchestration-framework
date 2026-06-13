<!--
  SPEC.md — answers ONE question: why are we doing this, and what's in/out of scope?
  Owner: product-owner.  Part of the spine (always present).
  Does NOT contain: how it's built (→ ARCHITECTURE.md), what was learned (→ RESEARCH.md),
  or the detailed outcomes (→ tasks/*.feature). This frames; the feature files specify.
-->
# NNN · <Milestone Name> — Spec

## Goal

<!-- One or two paragraphs. What capability does this milestone deliver, and why now?
     State the intent an outsider could verify was met — not the implementation. -->

## Scope

In scope:

- **<ID-01>** — <a deliverable, described as an outcome, not a task>
- **<ID-02>** — <...>

Out of scope:

- <explicitly excluded thing> — <one-line reason / where it's deferred to>

## Layers & responsibilities

<!-- Which architectural layers this touches, and what changes (or notably does NOT change)
     in each. Keep it to responsibilities; decisions go in ARCHITECTURE.md. -->

- **@<layer> @<refinement>** — <responsibility>

## Acceptance

<!-- A checklist that POINTS AT the feature files. Do NOT restate scenario text here
     (reference, never restate). Each line should map to one acceptance surface. -->

- [ ] <outcome> — see `tasks/<area>.feature`
- [ ] <outcome> — see `tasks/<area>.feature`

## Dependencies

- <prior milestone / external dependency> — <why it's needed>
