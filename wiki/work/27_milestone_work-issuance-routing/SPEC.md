---
type: milestone
number: 27
slug: work-issuance-routing
title: "Cross-Machine Issuance & Routing — issue from the control node, claim anywhere"
status: done
owner: product-owner
created: 2026-06-29
updated: 2026-07-03
depends: [25, 26]
origin: wiki/planning/PRD-decentralized-agent-orchestration.md
---
<!--
  Milestone SPEC.md — the record doc. Answers ONE question: why + scope of this milestone.
  Owner: product-owner. A milestone GROUPS stories and holds their shared context
  (ARCHITECTURE / DESIGN / RESEARCH / UAT live in this folder too, conditionally).
  Does NOT contain: a per-story user story (→ each STORY.md) or acceptance criteria (→ task .feature).
-->
# 27 · Cross-Machine Issuance & Routing — issue from the control node, claim anywhere

## Objective

**Phase 3 — work flows across the fleet** (origin:
[PRD-decentralized-agent-orchestration](../../planning/PRD-decentralized-agent-orchestration.md), §7.2 KF6).
Until now a run is claimed where it already sits; this milestone lets work be **issued and routed across
machines**.

From any node you can enqueue a new run or **target** one at a node or a capability; from the **control
node** you issue / assign work into a board; an eligible node picks it up via the mesh-aware
`aof work next` and runs it with the durable, resumable, self-healing runs from the 19–21 arc — now
fleet-wide. **Capability targeting** routes by the node identity + capability advertisement from milestone
22 (supported runtime / skill). The `aof mesh ui` gains the **issue / assign affordance** ("work is
issued / assigned into a board from here").

An outsider can verify the objective is met when work issued / assigned on node A is **picked up and run
on an eligible node B with no manual file shuffling**, in ≤ 2 sync intervals, for ≥ 95% of issued items
(KR3).

## Scope

In scope:
- **Work issuance** — enqueue a new run from any node; issue / assign into a board from the control node.
- **Capability / node targeting** — target a run at a specific node or a capability (runtime / skill),
  routed via the node identity advertised in milestone 22.
- **Pick-up via mesh-aware `next`** — an eligible node claims the issued / targeted run through the
  milestone-26 leasing path; no manual file shuffling.
- **The issue / assign affordance** — the `aof mesh ui` surface (milestone 25) gains a board-level
  issue / assign control.

Out of scope:
- **The claim / lease mechanics that pick issued work up** — milestone 26 (consumed here, not re-authored).
- **The read-only fleet view + the `work ui` rename** — milestone 25 (this milestone adds the
  issue / assign affordance *onto* it).
- **Untrusted / cross-org issuance authz** — the Phase-5+ fork (PRD §8); v1 issuance is within the
  trusted group.
- **Cross-platform packaging of the issuing binary** — milestone 28.

## Stories

<!-- The stories that compose this milestone. Each is its own NN_story_<slug> item with parent: 27.
     Populated at the Break-down stage (refine); "to be broken down" until then. The milestone is
     accepted when all its stories are. -->

Broken down `2026-07-03` by `aof:refine 27 --autonomous`. The partition follows the codebase-graph
coupling ([ARCHITECTURE.md §Recommended story partition](ARCHITECTURE.md); graph freshly built — 1261
nodes / 3400 edges) and the milestone family's proven grain (**substrate/dependency-root → CLI end-to-end →
UI/integration**, the 3-story shape m22/m23/m26 all landed). Routing is a thin **composition of the four
DONE seams** (m22 identity, m24 registry/control-node, m25 fleet UI, m26 leasing) with one substrate
contract flowing through all three stories, so — unlike m25 (01∥02) or m26 (a git-pure sibling parallel to
the substrate) — the honest cut is a **three-link chain 00 → 01 → 02**, each sequenced on a real data
dependency, file-disjoint per story (no file owned by two). The **security-lens** work (SECURITY.md + its
fitness — the first cross-machine inbound write surface) was authored at Decide and converges into story 02.
Contracts (task `.feature` files) are authored per story via Three Amigos.

- [x] **00 · [the issuance directive substrate + the eligibility matcher](stories/00_story_issuance-directive-substrate/STORY.md)** —
  the git-pure dependency root: `src/mesh-issuance.mjs` (the frozen six-key `.mesh/issuance/<issuer>/<item-ref>.json`
  directive + `readIssuanceDirectives` + the pure `nodeSatisfiesTarget` matcher) + the RESERVED
  `issuanceDirectivePath` builder on `mesh-store.mjs` (ADR-001/ADR-003; fitness #2, #3). No command, no
  relay, no UI — provable over plain git fixtures. **The dependency root.**
- [x] **01 · [mesh:issue + mesh-aware-next routing pickup](stories/01_story_mesh-issue-routing-pickup/STORY.md)** —
  the CLI end-to-end over git: `aof mesh issue <ref> [--to <node|cap>]` (a registered `mesh:*` verb) + the
  directive WRITES + the UNIFIED candidacy view in `work:next` (routing filter + the m26 lease) + the
  **m26/ADR-007 every-ready-return fold-in** in `work.mjs` + the `mesh:status` issued render (ADR-002/ADR-004/
  ADR-005/ADR-001.3; fitness #1, #4, #5, #6). **Sequenced after 00.**
- [x] **02 · [the fleet-UI issue/assign affordance](stories/02_story_fleet-ui-issue-affordance/STORY.md)** —
  the UI/integration join + the security-lens story: `POST /api/mesh/issue` on the fleet face → `invoke("mesh:issue")`
  (the FIRST write route) + the `[assign ▸]` affordance + the deliberate flip of `acd-mesh-ui-write-isolation`
  to bounded-write (ADR-006; DESIGN.md; SECURITY.md; fitness #7 + the security fitness). **Depends on 01.**

## Dependencies

- **26 · distributed-runs-leasing** — issued / targeted work is picked up through the mesh-aware
  `aof work next` and the git lease-of-record from milestone 26; without fleet-safe claiming, routing
  would double-run. Routing *is* "enqueue + let an eligible node lease it," so it consumes the leasing
  path directly.
- **25 · mesh-ui** — issuance / assignment is surfaced from the fleet view ("issued / assigned into a
  board from here"); the issue / assign affordance extends the read-only `aof mesh ui` that 25 stands up.
  Issuing "from the control node" reaches the relay / control role through the 25 → 23 chain.
