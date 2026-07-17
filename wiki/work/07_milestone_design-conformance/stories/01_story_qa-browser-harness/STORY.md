---
type: story
number: 01
slug: qa-browser-harness
title: "QA runs the browser harness and owns the regression + the optional a11y lane"
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
# 01 · QA runs the browser harness and owns the regression + the optional a11y lane

## User story

As **QA** in the ACD loop,
I want to own the **browser harness** — running Playwright, owning the `toHaveScreenshot` visual-regression
that locks the designer-approved baseline, and running an **optional, opt-in a11y check** — distinct from
the designer who only *judges* the rendered result,
so that "works right" and "the machinery that renders/regresses" sit with the role that has the tools to
run them (`Bash`), the responsibility split is **real and enforceable**, and a11y is verified where it
belongs and silently absent where it doesn't.

<!-- The run-the-browser HALF of the responsibility-split contract (ADR-001). Owns
     `src/bundle/agents/aof-qa.md` + the additive, closed `work.ui.a11y` schema block in
     `schemas/aof.schema.json` (ADR-004). QA has `Bash` (it runs Playwright); the designer does not —
     that tool boundary IS the split. The `toHaveScreenshot` regression locks the baseline the designer
     approved (the SEAM is defined here; building out baselines as a hard gate is a QA-owned follow-on,
     SPEC out-of-scope). a11y is opt-in via `work.tags.domains` containing `a11y` (absent ≡ off) with the
     level in `work.ui.a11y` (default WCAG 2.1 AA). Independent of the designer + wiring stories: owns its
     own agent file + an additive closed schema block; depends on the FROZEN contract shape, not their
     bodies. The schema change touches `schemas/aof.schema.json`, which only this story edits. -->

## Tasks

- [x] `tasks/00_qa-runs-the-harness.feature` — the bundled `aof-qa` carries `Bash`, runs the Playwright
  browser harness, and owns the `toHaveScreenshot` visual-regression that locks the designer-approved
  baseline + the functional checks (its slice of the ADR-001 role split); browser/`toHaveScreenshot`
  ownership lives in QA's contract, never the designer's
- [x] `tasks/01_a11y-lane-config.feature` — the a11y lane is **opt-in** via `work.tags.domains` containing
  `a11y` (absent ≡ off), and the conformance level lives in a NEW additive, **closed**
  (`additionalProperties:false`) `work.ui.a11y` block peer to `baseUrl` (`level` ∈ `A`/`AA`/`AAA`,
  default `AA`); an absent block validates, an unknown key under it fails (Ajv-2020) — Examples table over
  valid/invalid configs
- [x] `tasks/02_qa-runs-a11y.feature` — when the lane is on, QA runs the a11y check (axe-core injected via
  Playwright) as part of its harness and logs violations as findings against the recorded level; the
  designer never runs it (no `Bash`)

## Notes

Inherits the milestone ADRs (ARCHITECTURE.md). Owns `src/bundle/agents/aof-qa.md` + `schemas/aof.schema.json`
(the `work.ui.a11y` block). The a11y schema task mirrors the `acd-headroom-config-schema` precedent
(additive, closed, absent ≡ off) — its enforcement is `acd-a11y-config-schema`. QA's slice of
`acd-design-role-split` (QA-has-Bash + owns-harness/`toHaveScreenshot`) is the @executable backstop for the
role split; a *real* axe-core run against the served app needs the browser + the running app → `@manual`/
`@uat`, not a CI invariant. Regenerate `src/bundle/manifest.json` via `scripts/generate-bundle-manifest.mjs`
after the agent-body change (the derived manifest is the only artifact co-touched with the other stories,
contained by `acd-bundle-manifest-hashes` — ADR-005/006).
