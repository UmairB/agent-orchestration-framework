---
type: story
number: 02
slug: lifecycle-and-verify
title: "Lifecycle & verify treatment — per-type close, no refine/behavioural ceremony"
parent: 37
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
-->
# 02 · Lifecycle & verify treatment

## User story

As a practitioner closing a spike or a chore,
I want `aof:verify` to accept each on its own terms — a spike when its finding is recorded, a chore when
its Definition-of-Done checklist is ticked and `aof work validate` is green — and `aof:refine` /
behavioural `.feature` verification to never be imposed on either,
so that lightweight work closes without the Three-Amigos + green-test ceremony built for shippable
behaviour.

<!-- Skill + board files only: the per-type verify path in `aof:verify`, the refine/behavioural bypass in
     `aof:refine`, and the minimal board type-badge. Touches NO src/work.mjs. Depends on story 00
     (the engine must accept the types before the skills can dispatch on them). Per ADR-003. -->

## Tasks

- [x] `tasks/00_spike-verify-finding-recorded.feature` — `aof:verify <spike>` accepts on a filled
  `## Finding` (unknown resolved), not on tests-green; an empty finding is not accepted; no scenario run.
  *(@manual → verified at `aof:verify`; implemented in `verify.md` per-type dispatch.)*
- [x] `tasks/01_chore-verify-checklist-and-validate.feature` — `aof:verify <chore>` accepts only when every
  `## Definition of Done` box is ticked AND `aof work validate` is green; an unticked box or a red validate
  blocks acceptance. *(@manual → verified at `aof:verify`; implemented in `verify.md`.)*
- [x] `tasks/02_refine-bypass-and-board-badge.feature` — `aof:refine` refuses/redirects a spike/chore (no
  Three-Amigos, no break-down); behavioural `.feature` verify is never applied; the board renders a
  spike/chore type badge (minimal — no new lane). *(refine bypass @manual; board badge implemented in
  `ui/src/board/` — `@executable` but no UI harness, render/type-check-verified via `npm run ui:build`.)*

## Notes

- **Depends: 00** (parallel to 01). Verify/refine dispatch is **skill-orchestrated** (ADR-003) — the engine
  only guarantees structural validity; the lifecycle lives in the skill bundle + `src/board-ui.mjs`.
- Board/Notion per-type rendering beyond a label/badge is **deferred, out of scope** (ADR-003 default).
