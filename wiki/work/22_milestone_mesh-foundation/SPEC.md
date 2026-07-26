---
type: milestone
number: 22
slug: mesh-foundation
title: "Mesh Foundation — node identity + the git-sync engine over the work stream"
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-06-30
depends: [08]
origin: wiki/planning/PRD-decentralized-agent-orchestration.md
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 22 · Mesh Foundation — node identity + the git-sync engine over the work stream

## Objective

The **durable substrate** of the decentralized agent-orchestration mesh (origin:
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), §7.2/§7.3).
It turns a single aof install into a **node** and makes the git-tracked work stream the mesh's bus —
without yet adding any live coordination.

Two moves. (1) **Node identity & capability advertisement**: each install gets a stable node id (host,
OS, supported runtimes `claude`/`codex`, available skills), published into the stream so work can later
be routed by capability. (2) **The git-sync engine**: a background pull/push loop on each node, on a
tunable cadence, that publishes its own records and reads back peers' — the mesh's *only* transport (no
daemon-to-daemon networking). Underpinning both is the **path-partitioning convention** — per-node /
per-run record files (e.g. `presence/<node>.json`, `runs/<node>/…`) so two nodes never edit the same
file and git merges are add-only, not three-way (the move that keeps git viable as a bus). All of it is
authored **as registered command-core commands** (`mesh:*` and the sync ops), so the CLI / board / node
faces inherit it through the one registry door — a node is "just another thin face" (PRD §3).

The load-bearing invariant: **git stays the system of record**; the sync engine *moves* records, it never
becomes a second authority. An outsider can verify the objective is met when two nodes on a shared remote
each publish their identity + records and render the other's — purely over git, no relay, no merge
conflict — which is exactly the "decentralization is mostly *using* git" thesis the PRD rests on (§3).

## Scope

In scope:
- **Node identity & capability advertisement** — a stable node id (host, OS, runtimes `claude`/`codex`,
  skills) published into the stream so work can later be routed by capability.
- **The git-sync engine** — a background pull/push loop per node on a tunable cadence; the mesh's only
  transport (no daemon-to-daemon networking).
- **The path-partitioning convention** — per-node / per-run record files so git merges are add-only,
  never three-way (the conflict-avoidance move that keeps git a clean bus).
- **`mesh:*` as commands first** — the node-identity + sync operations as registered command-core
  commands with stable `--json` contracts; CLI / board / node are thin faces (the milestone-08 bijection).

Out of scope:
- **The thin relay + presence/heartbeat** (the live substrate) — milestone 23.
- **Device-code group enrollment + the group registry** — milestone 24.
- **`aof mesh ui` / the `aof work board` → `aof work ui` rename** — milestone 25.
- **Distributed run records (the node dimension) + leasing** — milestone 26 (this milestone lays the
  partitioning convention; it does not yet extend the run record).
- **Any durable server / daemon / Postgres / auth control plane** — git is the only system of record
  (PRD §7.3 "Explicitly NOT").
- **Spawning / billing agents** — each node runs the operator's own local agent sessions (PRD A4).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 22.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-06-30` by `aof:refine 22 --autonomous`. The partition follows the codebase-graph coupling
(`ARCHITECTURE.md §Story break-down rationale`): the store mechanic is the dependency root (the `run-store.mjs`
spine role the graph confirms), and the two payload stories are independent parallel siblings touching only the
additive co-touched door (`command-core.mjs`'s `COMMANDS` array + `cli.mjs`'s `meshCommand` dispatcher — the
07/ADR-006 discipline).

- [x] **00 · [mesh-store, the path-partition convention & the `aof mesh` face contract](stories/00_story_mesh-store/STORY.md)** — THE SPINE. `src/mesh-store.mjs` (the single partition seam `meshDir`/`nodeRecordPath`, the frozen node-record schema, atomic per-node read/write), the `aof mesh` top-level CLI dispatcher skeleton, and the structural arch-tests (partition discipline, write-scope, the NEW `mesh:`-namespace bijection gate). The dependency root.
- [x] **01 · [node identity & capability advertisement](stories/01_story_node-identity/STORY.md)** — `src/node-identity.mjs` (deterministic node-id derivation + capability-descriptor assembly: host / OS / runtimes / skills) + the `mesh:identity` / `mesh:status` commands (publish/read this node; list the synced roster). Depends on 00; **parallel with 02**.
- [x] **02 · [the git-sync engine](stories/02_story_git-sync/STORY.md)** — `src/mesh-sync.mjs` + the `mesh:sync` command + the background-loop runner + the tunable cadence; the payload-agnostic git transport that moves records and never re-authors them (git stays the system of record). Depends on 00's partition convention; **parallel with 01**.

## Dependencies

- **08 · cli-command-core** — node identity and the git-sync engine arrive **as registered command-core
  commands** (`mesh:*` and the sync ops), inheriting 08's registry, the `{id,input,run,cli}→result`
  contract, the `--json` discipline, and the thin-face bijection. The mesh's "node is another thin face"
  premise (PRD §3) only holds because every capability already lives behind 08's one door. **This is the
  foundation's only genuine gate** — node identity + a git-sync loop work over whatever records the stream
  already holds (work items, node identity), so the milestone is parallel-eligible with the 19–21 arc.

_Not a dependency — consumed downstream:_ the foundation does **not** consume the run-lifecycle contract.
The git-sync engine is payload-agnostic (it moves whatever records exist), and the genuine 19-edge — the
path-partitioning that lets milestone 19's run log "[gain] a node dimension" (PRD §7.2 KF4) — lives on
**milestone 26**, which depends on 19 directly. Foundation-first sequencing (PRD §8, Phase 0 ships first)
is a scheduling preference applied at `aof:autonomous` time, not a build-gate of this milestone.

**Coherence seam with milestone 19 (refine-time cross-reference, NOT a `depends` edge — added 2026-06-29).**
This milestone authors the path-partition *convention* (`presence/<node>.json`, `runs/<node>/…`); milestone
19 has now **frozen** the run-record *store* with a single path seam — `runsDir(item)` /
`runRecordPath(item, runId)` (19/ADR-002) — deliberately shaped so a `<node>/` segment is a one-line additive
delta (`runs/<run-id>.json` → `runs/<node>/<run-id>.json`). When this milestone is refined, its
partition-convention ADR should **adopt 19's frozen `runs/<run-id>.json` seam as the reference shape** for the
run dimension of `runs/<node>/…`, so the convention (22) and the store (19) **provably compose at milestone
26** (which merges them). The two milestones stay parallel-eligible — this is a design-coherence cross-link
that prevents two divergent partition schemes, not a build gate.
