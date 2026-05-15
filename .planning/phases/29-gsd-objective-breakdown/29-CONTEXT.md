---
phase: 29
name: "GSD Objective Breakdown"
status: discussed
autonomous: true
created: 2026-05-15
---

# Phase 29 Context: GSD Objective Breakdown

## Goal

Let users turn a deliverable objective into reviewable board tasks using GSD planning semantics, while preserving `.aof/boards` as canonical task state.

## Decisions

- Use a proposal-first workflow: generated tasks are written to a proposal file and are not added to a board until the user explicitly applies the proposal.
- Store proposals under `.aof/boards/<board-id>/proposals/<proposal-id>.json`.
- Keep the first implementation deterministic and local. It should not require network access or an external GSD subprocess.
- Treat generated task IDs as stable, objective-derived IDs.
- Applying a proposal must fail on existing task ID collisions unless a later phase explicitly adds a merge/force policy.
- Task refs must preserve objective/proposal provenance and links to planning artifacts when known.
- Refresh/regeneration produces a new proposal that references the earlier proposal; it must not overwrite board tasks.

## Scope

In scope:

- CLI proposal generation, show/review, apply, and refresh commands.
- Proposal file model and validation through focused unit tests.
- Board task creation from accepted proposals.
- BDD coverage for review-before-apply and collision protection.

Out of scope:

- Agent assignment/execution.
- Visual kanban UI.
- Calling external GSD agents or mutating `.planning/` structure.
