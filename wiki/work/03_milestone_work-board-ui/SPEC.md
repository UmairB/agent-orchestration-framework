---
type: milestone
number: 03
slug: work-board-ui
title: "Work Board UI"
status: not-started
owner: product-owner
created: 2026-06-16
updated: 2026-06-16
depends: [00]
---
# 03 · Work Board UI

## Objective

Bring the work stream into the aof UI: see the milestone / story / task stream and act on it — add
feedback, validate, request a review — without dropping to the terminal.

## Scope

In scope:
- `aof work list --json` — the board's data source (the whole stream + statuses, one pass).
- A read-only board (milestones → stories → tasks, status chips) + an item detail panel
  (SPEC / VERIFICATION / RETROSPECTIVE, findings).
- Actions: **add feedback** (→ STATE `## Feedback (for retro)`), **validate**, **next**.

Out of scope: full code-review orchestration driven from the UI (agent-heavy; a later phase).

## Stories

<!-- to be broken down — `aof:refine 03` -->

## Dependencies

- **00 · Work CLI** — `aof work list` / `find` back the board (the UI renders CLI `--json`).
