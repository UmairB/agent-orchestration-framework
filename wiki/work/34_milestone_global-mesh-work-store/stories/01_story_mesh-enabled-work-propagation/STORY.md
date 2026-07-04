---
type: story
number: 01
slug: mesh-enabled-work-propagation
title: "Mesh-enabled work propagation — publish workspace snapshots to the global store only when enabled"
parent: 34
status: in-progress
owner: product-owner
created: 2026-07-04
updated: 2026-07-04
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · Mesh-enabled work propagation — local writes converge globally

## User story

As an operator working across multiple mesh-enabled workspaces on one control node, I want work changes from
each enabled workspace to publish into the global store automatically, so the mesh UI can answer the
machine-wide question without me manually opening each workspace.

## Tasks

- [ ] `tasks/00_mesh-enabled-predicate.feature` — `@executable` — global propagation uses one explicit
  `config.mesh.enabled === true` predicate; empty `mesh: {}` and hydrated identity alone are inert.
- [ ] `tasks/01_publish-after-successful-mutations.feature` — `@executable` — successful mutation
  commands publish exactly one workspace snapshot after canonical local writes succeed, while refused
  commands do not publish.
- [ ] `tasks/02_publish-failure-isolation.feature` — `@executable` — global publish failures become
  warnings/projection errors and never roll back a successful local work mutation.
- [ ] `tasks/03_launcher-convergence-publisher.feature` — `@executable` — the mesh launcher publishes an
  initial and periodic idempotent workspace snapshot, without stopping presence/sync loops on publish failure.
- [ ] **Fitness `acd-global-propagation-single-predicate`** — structural guard: every global propagation
  call checks the same exported mesh-enabled predicate; no command privately tests `config.mesh`.
- [ ] **Fitness `acd-global-publisher-single-seam`** — structural guard: mutation commands and launcher
  convergence call one shared publisher; no command writes SQLite/global descriptor files directly.

## Notes

Owns the explicit enablement predicate, idempotent workspace snapshot publisher, command integration after
successful work/run/mesh mutations, and periodic convergence from the mesh launcher/sync loop. Inherits
[ARCHITECTURE.md](../../ARCHITECTURE.md) ADR-002 and ADR-004.

This story depends conceptually on story 00's store API. It should preserve local-only behaviour for
workspaces where `config.mesh.enabled !== true`.
## Build Notes

Developer-amigo feasibility check:
- **Injection seam:** command tests should inject a fake publisher through command context or a shared
  helper dependency, matching existing `ctx.syncRunner` / `ctx.relayClient` precedents. This keeps
  post-mutation assertions hermetic and avoids touching the real global store.
- **Publish ordering:** the publisher must run after the owning local seam writes: run-store writes for
  `run-start` / `run-complete`, mesh issuance write for `mesh:issue`, and feedback append for
  `work:feedback`.
- **Failure posture:** a publish failure is observability, not local command failure. Preserve the local
  command's result/error semantics and attach propagation warnings without changing the canonical write.
- **Convergence path:** launcher publication is an at-least-once catch-up path for direct record-doc edits
  and missed command hooks; it must be idempotent because ticks repeat.
