---
type: story
number: 02
slug: order-work
title: "Order work by dependency"
parent: 00
status: done
owner: product-owner
created: 2026-06-17
updated: 2026-06-17
schema: 1
aofVersion: 0.1.0
---
# 02 · Order work by dependency

## User story

As an ACD command (and a developer asking "what's next?"),
I want `aof work next [range]` to return the first actionable item in dependency order — drilling a milestone into its first unfinished story, treating a uat session as the work itself, and reporting `ready` / `blocked` (naming what it waits on) / `done` —
so that work is picked up in a valid order automatically and a blocked item surfaces its unmet dependency instead of being started early.

## Tasks

- [x] `tasks/00_next-actionable.feature` — first not-done driver whose deps are done, drilled to its first unfinished story
- [x] `tasks/01_blocked-and-range.feature` — blocked item names its unmet deps; range scoping

## Notes

Consumes story 00's discovery engine; independent of `validate-stream` (00/01). Shares the depends-graph
reading with `validate`, but for *ordering/gating* rather than integrity — a deliberately separate concern.
