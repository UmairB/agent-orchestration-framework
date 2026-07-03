---
type: milestone
number: 26
slug: distributed-runs-leasing
title: "Distributed Runs + Leasing — node-dimensioned runs, no double-work"
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-07-03
depends: [19, 20, 23]
origin: wiki/planning/PRD-decentralized-agent-orchestration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 26 · Distributed Runs + Leasing — node-dimensioned runs, no double-work

## Objective

**Phase 2 — fleet-safe execution** (origin:
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), §7.2 KF4/KF5, A2).
Once the fleet is visible, two nodes can race for the same queued item; this milestone makes execution
fleet-safe. It is the PRD's **primary spike** (A2: the relay-grant vs git-commit ordering).

Three moves. (1) **Distributed run records**: reuse milestone 19's derived run log, adding a **node
dimension**, path-partitioned per node/run (`runs/<node>/<run-id>.json`) so concurrent nodes touch
different files and git merges stay add-only. (2) **Lease / claim**: a node claims a queued run via
**relay fast-path arbitration** backed by a **git lease-of-record**; the loser detects the lease and
stands down; **`aof work next` becomes mesh-aware** (won't claim a leased item). Correctness **never
depends on the relay** — its loss only slows arbitration to the git cadence. (3) **Fleet orphan reclaim**:
extend milestone 20's restart-time backstop scan into a **fleet** scan — a peer's run orphaned by a crash
(stale heartbeat) is reclaimable, not left wedged.

An outsider can verify the objective is met when, under two nodes racing **100 contested claims, 0 cases
of both executing** (KR2), and a crashed node's in-flight run is reclaimed by a peer rather than left
stuck.

## Scope

In scope:
- **Distributed run records** — milestone 19's run log gains a node dimension, path-partitioned per
  node/run so git merges are add-only (PRD §7.2 KF4).
- **Lease / claim** — relay fast-path arbitration + a git **lease-of-record**; the loser stands down;
  `aof work next` honors leases (mesh-aware `next`). KR2's mechanism.
- **Fleet orphan reclaim** — milestone 20's restart-scan generalised to a fleet scan: a peer's orphaned
  run (stale heartbeat) is reclaimable.
- **Relay-independent correctness** — the git lease-of-record is authoritative; relay loss only slows
  arbitration to the git cadence (PRD A2).

Out of scope:
- **Presence / heartbeat + the relay itself** — milestone 23 (consumed here for the fast-path + staleness,
  not authored).
- **Issuing / targeting / routing work across nodes** — milestone 27 (this milestone arbitrates claims on
  already-queued runs; it does not enqueue cross-node).
- **The run-lifecycle contract** (item/run split, state machine, base records) — milestone 19 (extended
  here with a node dimension, not re-authored).
- **A durable server / network sweep for reclaim** — reclaim is a git/relay-driven fleet scan, not a
  server poll (PRD §7.3).

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 26.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

- [x] `stories/00_story_node-dimensioned-run-records/` — the git substrate: the fourteen-key record +
  `runs/<node>/` partition made real in `run-store`, the union readers, the sync root-set
  (`syncMesh(workspace, { roots })`), the RESERVED `leaseClaimPath`, and the R3 `.gitattributes` pin
  (ADR-001/ADR-002; fitness #1–#5). No lease, no relay — the dependency root the siblings build against.
- [x] `stories/01_story_lease-of-record/` — the lease mechanics, git-only: `src/mesh-lease.mjs`
  (per-contender claim files, remote-history-order arbitration, presence as the lease clock,
  fail-closed stand-down) + mesh-aware `work:next` (the optional injected leaseView: live ⇒ skip,
  stale ⇒ reclaimable) + the additive `mesh:status` lease render (ADR-003/ADR-005; fitness #6–#8).
- [x] `stories/02_story_claim-integration-fleet-reclaim/` — the A2 join: the frozen claim sequence in
  `work:run-start` (local claim → best-effort relay intent → authoritative git sync → hold/stand-down),
  the lease release at `work:run-complete`, the `kind:"lease"` wire overlay (zero relay change), the
  dual-staleness fleet orphan reclaim, and the KR2 `@manual` soak (ADR-004/ADR-006; fitness #9–#12).

## Dependencies

- **19 · work-run-lifecycle** — the durable run records and the `queued → running → done / failed /
  cancelled` state machine this milestone extends with a node dimension; without that derived log there
  is nothing to partition or lease.
- **20 · autonomous-run-resilience** — this milestone generalises 20's retry / attempt-ceiling /
  restart-scan reclaim to the fleet: `aof work next` (the loop's claim point 20 hardens) becomes
  mesh-aware, and the restart-time backstop scan becomes a **fleet** orphan scan.
- **23 · control-node-relay** — the relay supplies the **fast-path** claim arbitration (advisory mutual
  exclusion) that tightens the commit-then-push race window; the authoritative lease is still committed to
  git, so correctness survives the relay's absence.
