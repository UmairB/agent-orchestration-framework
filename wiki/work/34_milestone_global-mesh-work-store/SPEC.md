---
type: milestone
number: 34
slug: global-mesh-work-store
title: "Global Mesh Work Store — machine-wide work visibility for the control node"
status: in-progress
owner: product-owner
created: 2026-07-04
updated: 2026-07-05
depends: [22, 25, 26, 27, 33]
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 34 · Global Mesh Work Store — machine-wide work visibility for the control node

## Objective

The mesh work plane must become **machine-wide on the control node**, not scoped to whichever workspace
started `aof mesh ui`. An operator should be able to open the mesh UI from any directory on the control
machine and see the work state for every mesh-enabled workspace known to that machine, plus the control
and worker-node details needed to understand where work can run.

Success is outsider-verifiable: with mesh support enabled in two or more workspaces on the same control
node, changing work in either workspace propagates to a global AOF location, the default `aof mesh ui`
shows the combined machine-wide view, and `aof mesh ui --local` narrows the view to the current
workspace only.

## Scope

In scope:
- **Global work propagation gate** — work changes propagate to a global `.aof` location only when mesh
  support is enabled for the workspace. Non-mesh workspaces keep today's local-only behaviour.
- **Machine-wide work store** — define and implement the global store under the existing global AOF
  home, with a clear source-of-truth boundary between workspace record docs and global indexed state.
- **Node registry details in global AOF** — the global location records enough control-node and
  worker-node detail to power fleet-level work visibility and operator diagnosis without scanning one
  workspace at a time.
- **Global mesh UI default** — `aof mesh ui` serves the machine-wide control-node view by default.
- **Local mesh UI filter** — `aof mesh ui --local` serves only the current workspace's work details,
  preserving the existing focused-workspace workflow.
- **Worker → control-node live state stream** (added `2026-07-05`, ADR-007) — a worker holds a persistent
  WebSocket to the control node and streams its work-state as it happens, so the control node's machine-wide
  view is **real-time up-to-date** for every remote worker (not eventually-reconciled). The WebSocket stream is the cross-machine sync path; if it is down, the control view is stale until the reconnect snapshot converges it. This **reinstates a continuously-running
  WebSocket server on the control node** — the class of persistent-connection machinery 33/ADR-002
  *eliminated* — as a deliberate, operator-chosen reversal for real-time visibility; 33/ADR-002 is amended
  accordingly (see ADR-007). Consequence: the control node must run an always-on daemon.
- **Store engine decision** — evaluate SQLite for the global work store during refine, including
  concurrency, migration, recovery, and whether the store is authoritative or a rebuildable projection.

Out of scope:
- **Changing non-mesh work-stream semantics** — `aof work` remains workspace-local unless mesh is enabled.
- **Replacing the canonical work record docs before an ADR** — `wiki/work` item docs remain the canonical
  authored records unless refine records a deliberate source-of-truth change.
- **Cloud or cross-control-node aggregation** — this milestone is machine-wide on one control node, not
  a hosted fleet service.
- **Accepting a specific database engine without comparison** — SQLite is a strong candidate, not a
  pre-approved implementation choice.

## Stories

Broken down `2026-07-04` by `aof:refine 34`. Decide stage produced [ARCHITECTURE.md](ARCHITECTURE.md),
[RESEARCH.md](RESEARCH.md), and [DESIGN.md](DESIGN.md). The core decisions:

- Global mesh state lives under `AOF_GLOBAL_HOME` or the default user-global `.aof` folder (`~/.aof`), never project `.aof` or AppData/Application Support defaults.
- Global propagation is explicitly gated by `config.mesh.enabled === true`; empty `mesh: {}` is inert.
- SQLite is accepted only as a rebuildable projection and only through a no-new-dependency runtime path.
- Node/workspace details are materialized as operator-readable JSON descriptors as well as indexed rows.
- `aof mesh ui` is global by default; `aof mesh ui --local` filters to the current workspace.

Story boundaries follow the codebase graph: `mesh-ui-serve.mjs` is a small serve face, while `workspace.mjs`
and `work.mjs` are shared core seams. The store substrate is the dependency root; propagation and node
registry can proceed independently after it; UI scope switches consume the resulting query surface.

- [x] **00 · [global store substrate](stories/00_story_global-store-substrate/STORY.md)** — path geometry
  under global AOF, SQLite projection, schema versioning, rebuild, and query API.
- [x] **01 · [mesh-enabled work propagation](stories/01_story_mesh-enabled-work-propagation/STORY.md)** —
  explicit enablement gate plus idempotent workspace snapshot publishing after successful mutations and
  from the mesh launcher propagation loop.
- [x] **02 · [global node registry](stories/02_story_global-node-registry/STORY.md)** — global control/
  worker node and workspace descriptors, freshness, capabilities, fabric address, and safe redaction.
- [x] **03 · [mesh UI global scope](stories/03_story_mesh-ui-global-scope/STORY.md)** — `aof mesh ui`
  global by default, `--local` current-workspace filter, and the UI/API scope switch.
- [x] **04 · [worker live-state stream to control node](stories/04_story_worker-state-push/STORY.md)** —
  added `2026-07-05` (ADR-007): a worker holds a persistent WebSocket to the control node's fabric address and
  streams work-state (snapshot-then-deltas, reconnect+heartbeat); the control node runs an always-on WebSocket
  server that applies the stream into the global store in real time; tailnet-only admission; the WebSocket stream is the cross-machine sync path. **Reinstates the persistent-connection server 33 eliminated** (ADR-007). Contracts
  authored at `aof:refine 34/04`.


## Dependencies

- **Milestone 22 · mesh foundation** — supplies mesh node identity and mesh command conventions.
- **Milestone 25 · mesh UI** — supplies the existing UI serving surface that becomes global by default.
- **Milestone 26 · distributed runs** — supplies the run records that the global view must aggregate. The retired 27-era issuance/lease bus is not part of this milestone.
- **Milestone 33 · mesh relay/transport redesign** — establishes the current fabric-native mesh model
  this milestone extends rather than re-litigating transport.

## Remaining Build Questions

- Does the packaged runtime expose an acceptable SQLite implementation on every supported platform, or does
  story 00 need a clean unsupported-runtime refusal path?
- What exact workspace id should the projection use: absolute-path hash, persisted generated id, or a
  project-config identity field?
- What freshness window should mark a workspace/node descriptor stale in the global UI?
