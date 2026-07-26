---
type: milestone
number: 37
slug: spike-chore-item-types
title: "Spike & Chore Work-Item Types — lightweight item types for investigation and housekeeping"
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
depends: [0, 1]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 37 · Spike & Chore Work-Item Types

## Objective

The work stream models everything as `milestone | story | task | uat` (the closed vocabulary in
[`src/work.mjs`](../../../src/work.mjs) — `ITEM_RE`). Two common kinds of real work have nowhere honest
to live. **Investigative** work — answer an unknown, reduce a risk, before committing to a build. And
**housekeeping** work — docs, file moves, yaml/config edits: real, but non-functional. Today both get
mis-filed as stories/tasks and dragged through a Three-Amigos refine + behavioural-verify ceremony that
was built for *shippable behaviour*, or they happen off-book and untracked.

This milestone adds **`spike`** and **`chore`** as first-class, lightweight work-item types — each with
lifecycle treatment that fits its nature rather than forcing the story/task machinery onto it.

- A **spike** is a time-boxed investigation whose deliverable is a **recorded finding/decision**
  (RESEARCH-shaped), not shippable code. Its "done" is *the unknown is resolved / the risk is
  characterised* — **not** "tests green." Any code it produces is a throwaway prototype.
- A **chore** is **minimal-ceremony** housekeeping. It skips refine and behavioural verification, carries
  a **definition-of-done checklist**, and closes when that checklist is ticked **and** `aof work validate`
  stays green (no regression). No `.feature`, no acceptance scenarios.

An outsider can verify the objective is met when `aof:add-spike <slug>` and `aof:add-chore <slug>`
scaffold items that `aof work validate` accepts as valid; a spike closes on a recorded finding (not a
green test suite); a chore closes on its ticked checklist + a green validate; and **neither** type is
routed through story/task refine or behavioural verification. The existing `milestone`/`story`/`task`/`uat`
semantics are unchanged — this is purely additive.

## Scope

In scope:
- **`spike` item type** — a vocabulary entry + scaffold. Time-boxed investigation; deliverable is a
  recorded finding/decision; "done" = the unknown is resolved. Throwaway code by nature.
- **`chore` item type** — a vocabulary entry + scaffold. Minimal-ceremony: intent + a **definition-of-done
  checklist**; closes when the checklist is ticked **and** `aof work validate` is green. No `.feature`, no
  behavioural verify, no Three-Amigos refine.
- **Extend the closed item-type vocabulary** — `ITEM_RE` in `src/work.mjs` plus the tag/type validators
  admit `spike` and `chore`; folder↔frontmatter and the `aof work validate` depends-graph treat them
  correctly.
- **Scaffold commands + templates** — `aof:add-spike` / `aof:add-chore` skill commands and their doc
  templates, delivered through the ACD asset bundle, mirroring `aof:add-task` / `aof:add-story`.
- **Lifecycle treatment per type** — how each flows through validate / board / verify: a spike is
  verified by *finding-recorded*; a chore by *checklist + validate-green*. Neither passes through refine or
  behavioural (`.feature`) verification.
- **Roadmap emission of `spike` (`aof:shatter`)** — alongside the milestones it already frames, shatter
  frames a `spike` driver when a PRD chunk is a blocking unknown to de-risk *before* a milestone, wiring the
  backward-only `depends` edge to it. Added at refine per user direction (ADR-004). **Spike only** —
  shatter does **not** frame `chore`s (housekeeping is discovered during work, created ad-hoc via
  `aof:add-chore`, not shattered from product strategy).

Out of scope:
- **Performing** any actual spike investigation or chore housekeeping — this milestone ships the *types*,
  not work done with them.
- **Whether spike/chore are top-level drivers or nested adhoc items** (top-level number vs. inside a
  milestone) and whether they participate in the `depends` ordering graph — settled at refine, not framed
  here.
- **Changing `milestone` / `story` / `task` / `uat` semantics** — this milestone is additive only.
- **A `bug` item type** — `@bug` is already a universal *tag* in `src/work.mjs`, not being promoted to an
  item type here.
- **Board / Notion projection shaping for the new types** — surfaced at refine only if the projection
  needs per-type rendering; not framed here.

## Stories

<!-- Broken down `2026-07-09` via `aof:refine 37 --autonomous`. Stories drawn from the codebase-graph
     coupling (ARCHITECTURE.md "Story boundaries"): `src/work.mjs` is the stream god-node (35 importers),
     so ONLY story 00 edits it — a by-type split would collide on ITEM_RE. The by-layer cut is engine (00)
     → bundle assets (01) + skill/board (02), 01 & 02 parallel after 00. Story 03 (shatter emits the new
     types at roadmap scale) added at refine per user direction; depends 00+01. Every contract authored
     (Three Amigos) in the same pass. -->

- [x] [`00 · vocabulary-and-validation`](stories/00_story_vocabulary-and-validation/STORY.md) — admit
  `spike`/`chore` to `ITEM_RE`, `recordDoc` (→`SPIKE.md`/`CHORE.md`), `isDriver`, the `nextWork`
  item-is-the-work branch, and the `validateWork` native path. **Foundation, edits `src/work.mjs` only**
  (ADR-001/002/003). Depends: none.
- [x] [`01 · scaffold-commands-and-templates`](stories/01_story_scaffold-commands-and-templates/STORY.md) —
  `aof:add-spike`/`aof:add-chore` commands + `SPIKE.md`/`CHORE.md` templates, via the ACD asset bundle,
  mirroring `add-task`/`add-story`. **Sibling files only** (ADR-002). Depends: 00 (parallel to 02).
- [x] [`02 · lifecycle-and-verify`](stories/02_story_lifecycle-and-verify/STORY.md) — the per-type verify
  path (spike: finding-recorded; chore: checklist + validate-green), the refine/behavioural bypass, and the
  minimal board type-badge. **Skill + board files only** (ADR-003). Depends: 00 (parallel to 01).
- [x] [`03 · shatter-emits-spike`](stories/03_story_shatter-emits-spike/STORY.md) — alongside the milestones
  it already frames, `aof:shatter` frames a `spike` (de-risk-before-commit) driver and wires the
  backward-only `depends` edge. Spike only — **not** `chore` (housekeeping is ad-hoc). **`shatter.md` skill
  file only** (ADR-004). Depends: 00, 01 (parallel to 02).

## Dependencies

- **00 · work-cli** — supplies the item-type vocabulary (`ITEM_RE`), the folder↔frontmatter identity
  model, and the `aof work validate` graph that `spike` and `chore` extend.
- **01 · acd-asset-bundle** — the templates + skill-command bundle that houses the `aof:add-*` commands and
  will house the new `SPIKE` / `CHORE` doc templates (mirroring `aof:add-task` / `aof:add-story`).
