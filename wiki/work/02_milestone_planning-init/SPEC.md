---
type: milestone
number: 02
slug: planning-init
title: "Planning Init (the bought seam)"
status: not-started
owner: product-owner
created: 2026-06-16
updated: 2026-06-16
---
# 02 · Planning Init (the bought seam)

## Objective

Stand up the bought planning seam: `aof planning init` installs the pm-skills planner and records
pinned-sha provenance, so a PRD can be produced upstream and shattered into milestones downstream —
without aof owning the planning method.

## Scope

In scope:
- `aof planning init` — register the marketplace, install the recommended pm-skills plugins, write a
  provenance manifest (source / sha / plugins).
- Confirm the `aof:shatter` seam consumes the resulting `PRD-*.md` (shatter itself is already authored).

Out of scope: the planner's internals (bought, not owned); delivery (00 / 01).

## Stories

<!-- to be broken down — `aof:refine 02` -->

## Dependencies

- None — the planning seam is independent of the delivery CLI.
