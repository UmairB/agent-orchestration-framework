---
type: milestone
number: 35
slug: mesh-work-assignment
title: "Mesh Work Assignment — control→worker dispatch (assign a work item to a node, run it in isolation)"
status: done
owner: product-owner
created: 2026-07-08
updated: 2026-07-09
depends: [26, 33, 34]
schema: 1
aofVersion: 0.1.0
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 35 · Mesh Work Assignment — control→worker dispatch

## Objective

The control↔worker relationship must become a real **dispatch plane**, not only an observability one.
After milestone 34 the mesh is *observe-only*: each worker streams its work-state **up** to the control
node, which aggregates and displays the fleet. The missing direction is the whole point of having a
control node and worker nodes — **the control node must be able to hand a unit of work to a specific
worker, and the worker must pick it up and run it.**

This milestone adds that direction: an operator on the control node **assigns a resolvable work item
(a milestone or story) to a named worker node**; the worker **receives the assignment over the existing
mesh WebSocket stream, runs it in an isolated git worktree, and streams progress + the result back** to
the control node, where it is recorded in the machine-wide global store (milestone 34) and shown in the
mesh UI. Success is outsider-verifiable: on a two-machine mesh, an operator assigns a story to the worker
from the control node, the worker begins running it in its own worktree without colliding with anything
else it is doing, and the control node's fleet view shows the assignment advance from *assigned* →
*running* → *done/failed* in real time — with **no git-bus and no issuance-over-git** anywhere in the path.

## Scope

In scope:
- **Assignment verb (control node)** — a command to assign a resolvable work ref to a specific worker
  node (e.g. `aof mesh assign <ref> --to <nodeId>`), recorded as a first-class assignment record in the
  milestone-34 global store. Explicit, operator-driven.
- **Control→worker command channel** — extend the milestone-34 WebSocket stream (today worker→control
  *state*) to also carry control→worker *directives*. ADR-007 anticipated exactly this ("WS eases a
  future control→worker command channel"); assignment rides that one persistent connection.
- **Isolated worker execution (git worktree)** — a worker that accepts an assignment materializes the
  target ref in a **dedicated git worktree** and runs the work there, so concurrent assignments (and the
  worker's own local work) do not collide. This is the direct answer to "does assigning work create a
  worktree?" — now **yes**.
- **Assignment lifecycle + fleet visibility** — an assignment moves through a defined lifecycle
  (assigned → accepted → running → done/failed), streamed back and rendered in the mesh UI's fleet view.
- **Repo availability resolution** — a worker can only run an assignment for a repo it actually has; the
  milestone-34 `mesh.repo.published` markers are the basis for "which repos live on which nodes." Resolve
  and clearly report the "worker does not have this repo" case rather than failing opaquely.

Out of scope:
- **Automatic scheduling / load-balancing** — a scheduler that *chooses* the node (by capability, queue
  depth, etc.). This milestone is explicit operator-directed assignment; auto-scheduling is a later
  milestone that builds on it.
- **Reviving the git-bus or issuance-over-git** — the retired milestone-26/27 leasing/issuance machinery
  is **not** resurrected. Its *intent* (route work to a node) is delivered here on the **WebSocket
  transport only**; the deleted per-node claim-file/git-sync mechanism stays deleted.
- **Cross-control-node / cloud federation** — one control node dispatching to its own workers, matching
  milestone 34's machine-wide (single control node) boundary.
- **A hardened remote-execution threat model beyond the existing tailnet admission boundary** — running
  assigned work is remote code execution; the tailnet-peer admission (33/ADR-002) is the trust boundary
  this milestone inherits. A deeper threat model (what a compromised control node can make a worker run)
  is flagged for a security review at refine, not fully solved here.

## Stories

<!-- Broken down `2026-07-08` via `aof:refine 35 --autonomous`. Four INDEPENDENT-by-construction stories
     drawn from the codebase-graph coupling (see ARCHITECTURE.md "Story breakdown rationale"): the record →
     channel → execution spine (00 → 01 → 02) plus the read-only UI (03) forking off 00 in parallel. Every
     contract authored (Three Amigos) in the same autonomous pass. -->

- [x] [`00 · assignment-record-and-verb`](stories/00_story_assignment-record-and-verb/STORY.md) — the
  `global_assignments` record (frozen 10-key + named-producer enum) + `aof mesh assign <ref> --to`/`--withdraw`
  + the control-side repo-availability gate. **Foundation** (ADR-001/003). Depends: none.
- [x] [`01 · control-worker-command-channel`](stories/01_story_control-worker-command-channel/STORY.md) — the
  targeted `directive` down-frame + `nodeId→ws` map, admitted-peer-only, and the `assignment-status` uplink
  write-through. **Transport** (ADR-002). Depends: 00.
- [x] [`02 · isolated-worker-execution`](stories/02_story_isolated-worker-execution/STORY.md) — the dedicated
  git worktree per assignment + node-partitioned run lifecycle + dual-staleness reclaim. **Headline**
  (ADR-004/005/006). Depends: 00, 01.
- [x] [`03 · assignment-fleet-ui`](stories/03_story_assignment-fleet-ui/STORY.md) — the read-only fleet view
  renders the lifecycle on the 5s poll (assign stays CLI-only). **UI** (ADR-007). Depends: 00 (parallel to 01/02).

## Dependencies

- **Milestone 26 · distributed runs** — supplies the run records/lifecycle an assignment's execution
  produces and reports.
- **Milestone 33 · mesh relay/transport redesign** — the fabric-native transport + tailnet admission
  boundary the control→worker channel rides and trusts.
- **Milestone 34 · global mesh work store** — the substrate: the global store assignments are recorded
  in, the worker→control WebSocket stream the command channel extends, and the `mesh.repo.published`
  registry that answers "which repos are on which nodes."

## Remaining framing questions (resolve at refine)

- **Granularity** — assign a milestone, a story, or down to a task? (Likely story-level to start.)
- **Accept posture** — does an admitted worker **auto-accept and run** an assignment, or require a local
  operator confirm? (Leaning auto-accept within the tailnet trust boundary, but it is a real fork.)
- **Worktree lifecycle** — one worktree per assignment; where it lives; cleanup/retention policy; behaviour
  when the same ref is assigned twice.
- **Repo delivery** — must the worker already have the repo (via `mesh.repo.published`), or can the control
  node convey enough for the worker to fetch/clone it?
- **Failure + reassignment** — worker goes offline mid-run, worktree/setup fails, or the operator revokes an
  assignment: what are the observable states and the recovery path?
