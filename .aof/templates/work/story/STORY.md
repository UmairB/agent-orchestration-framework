<!-- aof-generated: bundle -->

---
type: story
number: NN
slug: <kebab-slug>
title: "<Story Title>"
parent: NN              # the milestone's number; OMIT when standalone
status: not-started
owner: product-owner
created: YYYY-MM-DD
updated: YYYY-MM-DD
schema: <schema-version>
aofVersion: <aof-version>
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH; a standalone story
  (no parent) is self-contained.
-->
# NN · <Story Title>

## User story

As a <role / beneficiary>,
I want <the capability this story delivers>,
so that <the real, challengeable benefit that justifies it>.

<!-- The "so that" must be a real benefit, not a reworded want. A standalone story's scope is its
     user story + its tasks; a milestone-bound story also serves the milestone Objective. -->

## Tasks

<!-- The tasks that satisfy this story, each a tasks/NN_<slug>.feature whose scenarios are the
     acceptance criteria. A task is done when its @executable feature is green. Keep tasks
     independent of OTHER stories' tasks; sequential within this story is fine. -->

- [ ] `tasks/00_<slug>.feature` — <one-line outcome>
- [ ] `tasks/01_<slug>.feature` — <one-line outcome>

## Notes

<!-- Anything story-specific not covered by the milestone docs. Keep light. -->
