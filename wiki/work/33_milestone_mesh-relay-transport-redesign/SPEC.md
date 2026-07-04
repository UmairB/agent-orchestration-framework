---
type: milestone
number: 33
slug: mesh-relay-transport-redesign
title: "Mesh Relay/Transport Redesign — a mesh-VPN-native fleet (Tailscale-first)"
status: in-progress
owner: product-owner
created: 2026-07-04
updated: 2026-07-04
depends: [22, 23, 24, 25, 26, 27]
origin: wiki/work/32_uat_whole-mesh-acceptance/SESSION.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 33 · Mesh Relay/Transport Redesign — a mesh-VPN-native fleet (Tailscale-first)

## Objective

The mesh must actually deliver **"issue anywhere, run anywhere, watch from one place"** across real
machines — the whole-product promise UAT 32 tried and could not confirm. That gate (rejected
`2026-07-04`) exposed that the current coordination model is the **wrong abstraction for a mesh-VPN
fabric**: a hub-and-spoke relay (a central control-node WebSocket **broker** + **device-code
enrollment** + **git-remote grant** + a **loopback bind needing tunnels**) that re-solves reachability,
NAT-traversal, and node identity — work a mesh VPN (Tailscale / WireGuard) **already does**. On that
fabric every node has a stable, directly-reachable address and NAT is handled, so the broker + tunnel
+ device-code machinery is redundant overhead that also never became operable (no launcher shipped).

This milestone reworks the mesh's **coordination + transport + identity** layer to be native to that
fabric. Success is outsider-verifiable: **a fresh operator can stand up a ≥2-node, cross-OS fleet over
Tailscale and see every node + assign and run work end-to-end — with no hand-derived URLs, no tunnels,
no device-code dance, and no shared/inherited node identity.** The parts (18–28) already work in
isolation; this makes them add up to the product.

## Scope

In scope:
- **A runnable relay/coordination launcher** — the "launcher's job" that was specified but never
  shipped (`command-core.mjs`: the long-lived serve is "the launcher's job"; m28 node mode is
  "everything but mesh relay"). Whatever coordination process the new model needs must be operator-
  runnable, not a library-only seam (UAT 32 · F-3201).
- **A mesh-VPN-native reachability/transport model** — nodes are directly addressable on the fabric;
  presence + issuance ride that direct addressability rather than a central broker + tunnel-punching.
  The fabric assumption (Tailscale/WireGuard) is made **explicit and pinned** before the coordination
  layer is built. Absorbs the "relay provider" idea (F-3202) into the topology decision (F-3204).
- **Per-install node identity** — derived from hostname, persisted to a **git-ignored sidecar**
  (`.aof/mesh/identity.json`), with `config.mesh` split into **fleet-shared** (committed:
  `relay.controlNode`/successor, transport config) vs **per-install** (git-ignored: `nodeId`, `salt`).
  Identity is never inherited on clone; self-heals on a hostname/nodeId mismatch. A **fitness function
  forbids per-install identity (`nodeId`/`salt`) in committed config** (UAT 32 · F-3203).

Out of scope:
- **Re-accepting milestones 18–28** — their own gates stand; this reworks the *integration*, not the
  parts. The record-store, partition convention, run lifecycle, and issuance model are **reused**.
- **Non-VPN fabrics beyond a pluggable seam** — raw-LAN / public-tunnel providers may be a later story;
  the core targets the mesh-VPN case that motivated the redesign.
- **The UAT 32 re-run itself** — re-running the whole-mesh acceptance gate happens *after* this lands;
  it is not this milestone's build work.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 33.
     The milestone is accepted when all its stories are. -->

Broken down `2026-07-04` by `aof:refine 33 --autonomous`. The **Decide** stage pinned the fabric FIRST
(`STATE §Notes`): a researcher established the Tailscale realities ([RESEARCH.md](RESEARCH.md)) and the
architect recorded the load-bearing decisions ([ARCHITECTURE.md](ARCHITECTURE.md), ADR-001..004). The
deciding call — **ADR-002: the central WebSocket broker is ELIMINATED as the presence/liveness transport;
the fabric IS the discovery+liveness plane** (implementing operator finding F-3204) — **collapses SPEC's
provisional 3-way split (launcher / transport / identity) into TWO stories**: with the broker gone there is
no separate "launcher over a broker", so the launcher (F-3201) becomes a per-node presence+sync daemon that
is one deliverable of the fabric-native transport story. The partition follows the fresh codebase-graph
coupling (1296 nodes / 3524 edges): `node-identity.mjs` (2 dependents) cuts cleanly away from the relay/
presence bus, while the fabric seam + presence cutover + broker retirement are one import-tight unit. The two
stories are **file-disjoint** with a soft ordering edge (identity first, so the transport joins peers on
trustworthy per-install ids). Contracts (task `.feature` files) are authored per story via Three Amigos.

- [ ] **00 · [per-install node identity](stories/00_story_per-install-node-identity/STORY.md)** — the
  clean-cut, independent fix for **F-3203**: split `config.mesh` into fleet-shared (committed) vs per-install
  identity (`nodeId`/`salt` → the git-ignored sidecar `.aof/mesh/identity.json`); derive from hostname;
  hydrate onto `config.mesh` at `loadWorkspace` so downstream readers are unchanged; committed `mesh.nodeId`
  stays a back-compat fallback + a `doctor` migrate-warn; self-heal on a hostname/nodeId mismatch. Identity is
  never inherited on clone; restores the m22 one-node-per-path partition invariant. **DoD: un-skip
  `acd-mesh-identity-not-committed`.** Sequenced FIRST.
- [ ] **01 · [fabric-native transport + coordination launcher](stories/01_story_fabric-native-transport/STORY.md)**
  — the topology rewrite closing **F-3201 / F-3202 / F-3204**: the NEW `src/mesh-fabric.mjs` seam
  (`probeFabric` / `selfAddress` / `resolvePeers` over `tailscale status --json`, joined to aof nodeId by
  hostname; Tailscale-only shipped, other fabrics a clean refusal); the presence fast-path cutover (fabric
  peer-map liveness replacing the relay cache); the **retirement of the `ws@8` broker** + subscriber + cache +
  the relay auth-gate arch-tests; and the operator-runnable **per-node presence+sync daemon** serve verb with
  per-fabric guidance + the macOS App-Store preflight. Git presence/sync stay the durable floor, untouched.
  **DoD: un-skip `acd-fabric-single-seam`; retire the four relay arch-tests.** Sequenced after 00 (soft edge).

## Dependencies

- **Milestones 22–27** (mesh foundation → control-node relay → enrollment → mesh-ui → leasing →
  issuance/routing) — this reworks their relay/transport/identity layer; their record-store, partition
  convention, and issuance model are the reused substrate.
- **UAT 32 · whole-mesh-acceptance** — the origin. Findings **F-3201/F-3202/F-3203/F-3204** scope this
  milestone; UAT 32 is `blocked` pending it and is re-run after this is accepted.
