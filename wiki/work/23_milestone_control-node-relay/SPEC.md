---
type: milestone
number: 23
slug: control-node-relay
title: "Control Node + Thin Relay — live presence over a stateless broker"
status: not-started
owner: product-owner
created: 2026-06-29
updated: 2026-06-29
depends: [20, 22]
origin: wiki/planning/PRD-decentralized-agent-orchestration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 23 · Control Node + Thin Relay — live presence over a stateless broker

## Objective

The **live substrate** of the mesh (origin:
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), §7.3/§7.4).
Git alone syncs at a ~10–30 s cadence — too slow for the headline "see what other agents are working on
*right now*." This milestone adds the one piece of coordination git can't give cheaply, and **nothing
more**: a thin, **stateless relay** hosted by a nominated **control node**, carrying *ephemeral* signals
only.

It introduces (1) the **control node as a role** — one nominated node hosts the relay and is the
liveness hub; re-nominate-able to any node, **not** special hardware and **not** a durability SPOF (git
stays replicated; lose it and only liveness pauses, never data); (2) the **thin relay** itself — a
lightweight self-hosted broker that ships as the same aof binary in a `relay` mode, persisting **nothing
authoritative** (every signal has a durable git counterpart), so it is a cache/accelerator, never the
system of record; and (3) **presence / heartbeat** — each node periodically writes a heartbeat (node id,
timestamp, active runs) pushed over the relay (sub-5-s) *and* into git (durable fallback); a stale
heartbeat renders the node stale. This is the PRD's **push-for-liveness, poll-for-durability** split (A5).

An outsider can verify the objective is met when a peer's change shows on another node within **≤ 5 s over
the relay** and **≤ 30 s with the relay killed**, a node that goes quiet is shown stale, and killing the
relay (or the control node) mid-fleet loses **liveness, not data** — the fleet degrades cleanly to
git-only sync (KR1, and the liveness half of KR5).

## Scope

In scope:
- **The thin stateless relay** — a lightweight self-hosted broker carrying *ephemeral* signals only;
  ships as the same aof binary in a `relay` mode (no separate product to install).
- **The control node as a role** — one nominated node hosts the relay and is the liveness hub;
  re-nominate-able; never a durability SPOF (git stays replicated).
- **Presence / heartbeat** — each node writes a heartbeat (node id, timestamp, active runs) pushed over
  relay + git; stale heartbeat → shown stale.
- **Push-for-liveness, poll-for-durability (PRD A5)** — presence pushed over the relay; durable state
  still syncs by git poll; relay loss degrades cleanly to poll-only.

Out of scope:
- **Device-code enrollment + the relay's credential issuance** — milestone 24 (this milestone stands the
  relay up; enrollment makes it joinable).
- **`aof mesh ui`** — milestone 25 renders presence visually; here it is exposed via `aof mesh status` +
  the records.
- **Lease / claim fast-path arbitration + fleet orphan reclaim** — milestone 26 (the relay's *second*
  signal class; this milestone carries presence, not claims).
- **The relay as a system of record** — it persists nothing authoritative; correctness never depends on
  it (PRD §7.3, A2).
- **Packaging the `relay`-mode binary for cross-OS install** — milestone 28.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 23.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

_To be broken down — `aof:refine 23`._

## Dependencies

- **22 · mesh-foundation** — builds directly on node identity (whose heartbeat is whose) and the git-sync
  engine + path-partitioning: `presence/<node>.json` is an add-only partitioned record git already
  carries durably, and the relay merely *accelerates* it to sub-5-s. No relay without the substrate
  underneath it.
- **20 · autonomous-run-resilience** — presence, heartbeat, and staleness are the **fleet face of
  milestone 20's liveness**. 20 builds the single-node heartbeat + stale-detection; this milestone
  *extends* them outward over the relay, rather than standing up a parallel heartbeat — which is what
  makes it a genuine edge, not just ordering. A node's "active runs" in its heartbeat reads the run
  records 20 sits on (milestone 19, transitively). The orphan **reclaim** that re-leases a stale peer's
  run lands later in milestone 26; the **presence + staleness** that detects it is built here, on 20.
