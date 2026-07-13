---
type: story
number: 01
slug: scaffold-commands-and-templates
title: "Scaffold commands & templates — aof:add-spike / aof:add-chore"
parent: 37
status: done
owner: product-owner
created: 2026-07-09
updated: 2026-07-10
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
-->
# 01 · Scaffold commands & templates

## User story

As a practitioner starting a spike or a chore,
I want `aof:add-spike <slug>` and `aof:add-chore <slug>` to scaffold a valid, minimal item folder from a
bundled template — mirroring `aof:add-task` / `aof:add-story`,
so that I get a correctly-shaped `SPIKE.md` / `CHORE.md` that `aof work validate` accepts immediately,
without hand-crafting frontmatter or guessing the section shape.

<!-- Sibling-files only story: `.claude/commands/aof/add-{spike,chore}.md` + `.aof/templates/work/
     {spike,chore}/{SPIKE,CHORE}.md`, delivered via the ACD asset bundle (milestone 01). Touches NO
     src/work.mjs. Depends on story 00 (the templates must instantiate to folders 00's validators accept). -->

## Tasks

- [x] `tasks/00_spike-template-and-command.feature` — the bundled `SPIKE.md` template instantiates to a
  folder that validates clean (frontmatter `type: spike` + `timebox`; `## Question`/`## Finding` sections);
  `/aof:add-spike <slug>` scaffolds it. *(@executable green; live `/aof:add-spike` run is @manual → UAT.)*
- [x] `tasks/01_chore-template-and-command.feature` — the bundled `CHORE.md` template instantiates to a
  folder that validates clean (frontmatter `type: chore`; a `## Definition of Done` checklist);
  `/aof:add-chore <slug>` scaffolds it. *(@executable green; live `/aof:add-chore` run is @manual → UAT.)*
- [x] `tasks/02_bundle-membership.feature` — the two commands + two templates are members of the ACD asset
  bundle (manifest + hashes), delivered alongside the existing `add-task`/`add-story` assets.

## Notes

- **Depends: 00** (parallel to 02). The templates must produce folders story 00's `validateWork` accepts —
  same frontmatter keys, same record-doc filename (`SPIKE.md`/`CHORE.md`), no `tasks/` required.
- Mirror the existing scaffold conventions: `.claude/commands/aof/add-task.md`, `add-story.md`,
  `.aof/templates/work/{story,uat}/`. Per ADR-002.
