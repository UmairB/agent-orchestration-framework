---
type: story
number: 02
slug: global-node-registry
title: "Global node registry — control and worker node descriptors under global AOF"
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
# 02 · Global node registry — inspectable control and worker details

## User story

As a control-node operator, I want global AOF to contain inspectable node and workspace descriptors, so I can
see which nodes exist, what roles/capabilities they have, where they were last seen, and which workspaces they
can service without opening each workspace by hand.

## Tasks

- [ ] [00 · node descriptor materialization](tasks/00_node-descriptor-materialization.feature)
- [ ] [01 · workspace descriptor materialization](tasks/01_workspace-descriptor-materialization.feature)
- [ ] [02 · descriptor redaction](tasks/02_descriptor-redaction.feature)
- [ ] [03 · freshness and query API](tasks/03_freshness-and-query-api.feature)

## Fitness units

- `acd-global-node-descriptors-redact-secrets` — global node/workspace descriptors and SQLite rows must not
  contain raw relay credentials, pending invite material, token/hash fields, or secret-looking additive keys.
- `acd-global-node-registry-projection-only` — query APIs for global node/workspace detail read from the
  global projection/index and descriptor files, not by opening every workspace on each UI request.

## Notes

Owns global node/workspace descriptor materialization, descriptor redaction, freshness/staleness fields, and
the relationship between control-node role, worker nodes, fabric address, and workspace membership. Inherits
[ARCHITECTURE.md](../../ARCHITECTURE.md) ADR-005.

This story can build in parallel with story 01 after story 00 defines the global store paths and projection
API.

Build guidance:
- Compose existing mesh signals instead of creating a second identity model: node records from `mesh-store`,
  presence/staleness from `mesh-presence`, fabric peer data from `mesh-fabric`, and control-node nomination
  from `mesh-registry`.
- Descriptor files are derived and operator-readable. They should be replaced from the current snapshot,
  while SQLite remains the query index.
- Redaction is part of descriptor assembly, before both JSON write and SQLite upsert.
