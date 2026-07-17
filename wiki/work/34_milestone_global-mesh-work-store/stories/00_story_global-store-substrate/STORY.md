---
type: story
number: 00
slug: global-store-substrate
title: "Global store substrate — path geometry, SQLite projection, schema versioning, rebuild"
parent: 34
status: done
owner: product-owner
created: 2026-07-04
updated: 2026-07-05
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 00 · Global store substrate — one machine-wide projection home

## User story

As a control-node operator, I want AOF to have one global mesh work store under the global AOF home, so every
mesh-enabled workspace on this machine can publish into a shared, rebuildable projection without changing the
canonical workspace work records.

## Tasks

- [x] `tasks/00_global-mesh-paths.feature` — `@executable` — global mesh path geometry derives from
  `globalWorkspacePaths()` / `AOF_GLOBAL_HOME`, is independent of the current project directory, and keeps
  project `.aof` distinct from global mesh state.
- [x] `tasks/01_sqlite-store-open-and-migrate.feature` — `@executable` — the projection store opens under
  the global mesh work root, creates/migrates schema version metadata, and refuses cleanly when SQLite is
  unavailable or the schema is newer than this build supports.
- [x] `tasks/02_rebuild-workspace-projection.feature` — `@executable` — publishing a workspace snapshot
  idempotently replaces that workspace's derived rows, removes stale rows, preserves other workspaces, and
  leaves canonical work record docs untouched.
- [x] `tasks/03_projection-query-api.feature` — `@executable` — the query API returns global and
  workspace-scoped work views, includes projection freshness/errors, and exposes no mutation surface.
- [x] **Fitness `acd-global-mesh-paths-home`** — structural guard: no global mesh store path is derived
  from `os.homedir()` or a literal `~/.aof`; production code must route through the single global mesh path
  helper.
- [x] **Fitness `acd-global-store-no-native-dep`** — structural guard: this story does not add a native
  SQLite npm dependency; package metadata remains unchanged unless a later ADR explicitly authorizes a
  dependency change and supply-chain audit.

## Notes

Owns the global mesh path helper, store open/migrate/rebuild mechanics, schema versioning, and projection
query API. Inherits [ARCHITECTURE.md](../../ARCHITECTURE.md) ADR-001 and ADR-003.

Graph grounding: this story should touch the global path seam (`workspace.mjs` / `paths.mjs`) and a new store
module. It should not change `mesh-ui-serve.mjs` beyond later stories' query usage.
## Build Notes

Developer-amigo feasibility check:
- **SQLite availability is the risk.** The contract deliberately allows a structured `sqlite-unavailable`
  refusal when no supported runtime SQLite implementation exists. Do not add a native npm package as part of
  this story; that would violate ADR-003 and `acd-global-store-no-native-dep`.
- **Projection authority boundary is clear.** All scenarios treat SQLite as derived state. Canonical work
  docs stay in each workspace's `work.dir`; rebuild replaces projection rows from a snapshot.
- **Testability is preserved.** `AOF_GLOBAL_HOME` gives hermetic global-store fixtures. Workspace snapshots
  can be fixture directories read through `work.mjs` seams; no real operator home or machine-wide store is
  needed for executable tests.
- **UI is intentionally out of this story.** Story 03 consumes the query API; this story should not import
  or modify `mesh-ui-serve.mjs` except indirectly through later integration.
