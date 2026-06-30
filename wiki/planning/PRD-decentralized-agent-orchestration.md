# PRD — Decentralized Agent Orchestration (the aof mesh)

> Planning PRD for turning aof from a single-operator, file-based work runner into a **decentralized,
> multi-node agent-orchestration framework** — a cross-platform console app you install on every machine,
> where each node runs its own agents, every node can *see* what the others are working on, and work can
> be issued and routed from any workstation. Upstream of ACD: this is a seam `aof:shatter` consumes to lay
> out the milestone roadmap.
>
> **This document consciously amends the scope boundary of
> [PRD-work-run-orchestration](./PRD-work-run-orchestration.md).** That arc fixed aof as *single-operator,
> no server*. This one keeps the **data-ownership** principle — the durable source of truth stays in **your
> git** — but lifts **single-operator → multi-node** and *consciously relaxes the absolute no-server line*:
> a **thin, stateless relay** carries the *ephemeral* coordination layer (live presence, claim signaling)
> while git remains the system of record. It still rejects the heavy platform half (durable server / daemon
> fleet / Postgres / auth control plane) the prior PRD called Multica's moat. The run-lifecycle foundation
> (milestones 19–21) is **reused, not replaced**: run records simply gain a node dimension and sync over git.
>
> **Decided (§7.4):** **(#1) git-of-record + thin relay** — git is durable truth; the relay adds real-time
> but holds no system-of-record, so the fleet degrades to git-only sync if it's absent. **(#2) a nominated
> control node** hosts the relay and is the issuing + enrollment hub — a re-nominate-able *role*, not special
> hardware, and not a durability SPOF (git stays replicated to every node). **(#3) device-code enrollment** —
> a machine joins a group by entering a short-lived 6-digit code the control node issues.

## 1. Summary

aof becomes a decentralized agent-orchestration **mesh**: a cross-platform console app where each machine
is a **node** that runs its own agent sessions, publishes what it's doing into a shared git-anchored work
stream, and reads back what every other node is doing. Machines join a **group** with a 6-digit code; one
node is nominated the **control node**, hosting a thin stateless **relay** for the real-time layer (live
presence, fast claim arbitration) and minting the join codes. Durable truth lives in **your git** — lose
the relay or the control node and the fleet falls back to git-only sync, losing liveness, not data. From
any node you get one "mission control" view of the whole fleet, and from the control node you issue and
route work to it. This document specifies that product and the path from today's single-operator CLI to the
mesh.

## 2. Contacts

| Name | Role | Comment |
|---|---|---|
| Umair Butt | Product owner / lead | Owns the vision; resolved the substrate, control-node, and trust forks (§7.4). |
| _aof command core_ | Technical precedent | Milestone 08 — every capability ships as a registered command; CLI / board / MCP / **node** are thin faces. |
| _TBD_ | Early users | The solo multi-machine operator and the small trusted squad (§5) — recruit 2–3 for the Phase-1 dogfood. |

## 3. Background

**Context.** aof today is a single-operator CLI. The work stream (`.aof/` + `wiki/work/`, all git-tracked)
is the source of truth; `aof:autonomous` loops `refine → build → verify` over `aof work next`; the board
([board-ui.mjs](../../src/board-ui.mjs)) is a read-mostly viewer; and the in-flight run-lifecycle arc
(milestones 19–21) is adding durable, resumable, observable **runs**. Everything assumes **one operator on
one machine**.

**Why now.** Three things have just become true at once. (1) The **command core (milestone 08)** makes every
operation a registered command behind one door, so a *node* is just another thin face — the orchestration
already lives in the right place. (2) The **run-lifecycle arc (19–21)** is making runs durable derived
artifacts *in the work stream* — the exact unit a second machine would need to observe. (3) The work stream
is **already a distributed, replicated data structure** by virtue of git: decentralization is mostly a
matter of *using* that fact rather than building infrastructure. The expensive half (durable runs, command
core) is being built anyway; the mesh is the high-leverage step that turns it into a fleet.

**What changed in the ask.** The prior strategy stopped at single-operator on principle — the platform half
(durable server, daemon fleet, Postgres, auth control plane) was Multica's moat and out of scope. The new
requirement keeps the *data-ownership* principle but asks for the *outcome* a platform usually buys: see
other agents, issue work across machines, run anywhere. The resolved design keeps durable truth in **your
git** and adds only the lightest coordination it can't get from git alone — a **stateless relay on a
nominated control node** for real-time liveness, plus 6-digit-code group enrollment. The heavy platform
half (untrusted/cross-org auth, multi-tenancy) stays a clearly-bounded later fork, not the first release.

## 4. Objective

**Objective.** Let an operator install one cross-platform console app on every machine, run agents on each
as a node, join them into a group with a 6-digit code, and from any node see the whole fleet's live
activity — issuing and routing work from the nominated control node — **with no durable server: git is the
system of record and the control node hosts only a stateless relay.** This makes aof a *decentralized
agent-orchestration framework*, not just a local runner, while preserving its file-based, you-own-the-data
DNA.

Why it matters: it turns N isolated aof installs into one coordinated fleet without taking on a SaaS control
plane — the differentiator against Multica-style managed platforms (§6). It compounds the 19–21 investment
(durable runs become *fleet-wide* observability for free) and unlocks parallel agent work that today
requires humans to manually avoid stepping on each other.

**Key Results (SMART).**
- **KR1 — Fleet visibility.** From any node, the mesh view reflects a peer's change within **≤ 5 s over the
  relay** (and **≤ 30 s on the git-only fallback**), for ≥ 95% of changes across a 3-machine
  (Windows + macOS + Linux) test fleet.
- **KR2 — No double-work.** Under two nodes racing for the same queued item, **0 cases of both executing
  it** across 100 contested claims — the loser detects the lease and stands down.
- **KR3 — Cross-machine issuance.** Work issued/assigned on node A is picked up and run on an eligible node
  B with **no manual file shuffling**, in ≤ 2 sync intervals, for ≥ 95% of issued items.
- **KR4 — Install-anywhere.** A signed, single-command install produces a working node on Windows, macOS,
  and Linux with **no Node.js/toolchain prerequisite** for the end user.
- **KR5 — You still own the data.** All durable state lives in the operator's own git; the relay is
  **stateless, self-hosted, and holds no system-of-record** — kill it (or the control node) mid-fleet and
  the mesh degrades to git-only sync with **0 lost runs or history**, only reduced liveness.
- **KR6 — Frictionless join.** A new machine joins the fleet by entering a single **6-digit code** (no
  manual key/cred copying) and appears in the mesh view within **≤ 1 min**, on all three OSes.

## 5. Market Segment(s)

Segments are defined by the job-to-be-done, not company size.

- **The solo multi-machine operator.** Runs agents on a beefy desktop, a laptop, and a home server. Job:
  *"orchestrate my own fleet from wherever I'm sitting — kick off work on the big box from the couch, see
  it finish."* Constraint: it's all one trusted person; no auth needed, but cross-machine visibility is the
  whole point.
- **The small trusted squad (2–6 engineers).** Share a work stream; each runs agents on their own machine.
  Job: *"coordinate parallel agent work without stepping on each other, and without paying for / trusting a
  SaaS control plane."* Constraint: trust boundary = "who can push to our git remote"; real-time-ish, not
  hard-real-time.
- **The sovereignty-sensitive builder.** Will not put a cloud control plane between themselves and their
  agents (regulated, air-gapped-ish, or just principled). Job: *"agent orchestration I fully own — my git,
  my machines, no third-party server holding my work."* Constraint: everything must run on infra they
  already control.

Out-of-segment (for now): large untrusted-multi-tenant orgs needing per-user authz, audit, and hard
real-time — that's the platform half, the deferred fork (§7.4 / §8).

## 6. Value Proposition(s)

- **Decentralized data, no SaaS tax.** Durable truth is your git, replicated to every node — no single
  point of failure for your *data*, and any runner can drop off without taking the fleet down. Coordination
  routes through a control node *you* nominate and can re-nominate; lose it and your data is untouched. Pain
  avoided: vendor lock-in, a managed control plane, your work living on someone else's box.
- **Cross-machine "mission control" on infrastructure you own.** See every node, its presence, and its live
  runs — real-time via a relay you host, durably backed by git. The observability a managed platform sells,
  without surrendering the platform.
- **Issue and route work across the fleet.** Enqueue or target work from any workstation; an eligible node
  claims and runs it, with the durable, resumable, self-healing runs from the 19–21 arc — now fleet-wide.
- **Install anywhere, one tool.** A cross-platform console binary: same aof on Windows, macOS, Linux, no
  toolchain to set up.
- **You still own everything.** The work stream stays plain files in your repo — diff-able, auditable,
  pruneable, portable. Decentralization adds nodes, not opacity.

**Value curve vs the prior art (Multica = Go server + daemon + Postgres + auth, a managed control plane):**
aof deliberately scores *low* on "managed/hosted" and "hard-real-time," and *high* on "serverless,"
"you-own-the-data," "git-native," and "install-anywhere." We win the operator who wants the orchestration
*mechanics* without the platform — not the enterprise who wants a hosted multi-tenant product.

## 7. Solution

### 7.1 UX / Prototypes

All surfaces are thin faces over the command core (milestone 08). The board is **renamed
`aof work board` → `aof work ui`** (one work stream's board), and a new fleet surface — **`aof mesh ui`** —
sits **on top** of it:

- **`aof work ui`** (the renamed board) — a single work stream's board: its items, runs, and (milestone 21)
  run history/state. Per-project, durable in that project's git. This is the drill-in target.
- **`aof mesh ui`** — the fleet/group surface **above** the work UIs. Shows (a) the **nodes** (machines,
  presence, what each is running) and (b) **every board currently being worked on** across the group, each
  drillable into its `aof work ui`. Work is issued/assigned into a board from here.
- **The CLI** mirrors it: `aof mesh status`, `aof mesh ui`, `aof mesh invite` / `aof mesh join <code>`
  (enrollment), `aof mesh issue <ref> [--to <node|cap>]` (from the control node), and `aof work next`
  becoming mesh-aware (won't claim a leased item).

```
┌─ aof mesh ui · group "umair-fleet" ────── synced 8s ago ──┐
│ NODES (3 online, 1 stale)                                  │
│  ★ umair-desktop   win    control · relay    ♥ 4s          │
│  ● umair-mbp       macos  busy · 1 run        ♥ 9s          │
│  ● build-server    linux  idle                ♥ 7s          │
│  ◌ old-laptop      macos  stale ♥ 6m — reclaim?            │
├────────────────────────────────────────────────────────────┤
│ BOARDS being worked on   (drill in → aof work ui)         │
│  aof          ▸ umair-desktop   19/02 build   running  ♥ 4s│
│  let-shield   ▸ umair-mbp       20/01 verify  running  ♥ 9s│
│  voice-vox    ▸ —               queued 21/03  [assign ▸]   │
├────────────────────────────────────────────────────────────┤
│ join a machine:   aof mesh join 482-913                    │
└────────────────────────────────────────────────────────────┘
```

### 7.2 Key Features

1. **Node identity & capability advertisement.** Each install has a stable node id (host, OS, supported
   runtimes `claude`/`codex`, available skills). Published into the stream so work can be routed by
   capability.
2. **Git-sync engine.** A background loop on each node pulls peer records and pushes its own on a tunable
   cadence. The mesh's only transport; no daemon-to-daemon networking.
3. **Presence / heartbeat.** Each node periodically writes a heartbeat record (node id, timestamp, active
   runs) and pushes it. "See what other agents are working on" = render peers' presence + run records.
   Stale heartbeat → shown stale; a peer's orphaned run is reclaimable (extends milestone 20's restart
   scan to a *fleet* scan).
4. **Distributed run records.** Reuse milestone 19's derived run log, adding a `node` dimension; records
   are **path-partitioned per node/run** so concurrent nodes touch different files and git merges cleanly
   (the key move that keeps git viable as a bus).
5. **Lease / claim.** A node claims a queued run via relay fast-path arbitration backed by a git
   **lease-of-record**; the loser stands down. `aof work next` honors leases. KR2's mechanism; correctness
   never depends on the relay (its loss only slows arbitration to the git cadence) — the primary spike (A2).
6. **Work issuance & routing.** From any node, enqueue a new run or **target** one at a node/capability;
   eligible nodes pick it up via mesh-aware `next`.
7. **`aof mesh ui` — the fleet surface.** Nodes (presence + what they run) **and every board being worked
   on** across the group, each drillable into its `aof work ui`. A group-level **node/board registry** is
   the new durable artifact (its own lightweight git stream of record). All through registered commands,
   preserving the thin-face + frozen-envelope discipline (milestones 03/08/21). The per-stream board is
   renamed `aof work board` → **`aof work ui`**.
8. **Cross-platform console app.** Package the Node CLI into signed, self-contained binaries for Windows /
   macOS / Linux (no Node prerequisite) — today it's an npm-linked dev install.
9. **Control node (a role).** One nominated node hosts the relay, is the issuing/visibility hub, and is the
   enrollment authority. Re-nominate-able to any node; its loss pauses liveness / new issuance / new joins
   but never durable state (git-replicated).
10. **Device-code group enrollment.** `aof mesh invite` (on the control node) mints a short-lived 6-digit
    code; `aof mesh join <code>` admits a machine to the group and issues its mesh credential (relay auth +
    stream identity). Group membership is the v1 trust boundary.

### 7.3 Technology (the chosen spine: git-of-record + thin relay)

- **Durable substrate: git is the system of record.** The shared work-stream remote *is* the mesh's
  authoritative state — run records, work items, leases-of-record, history. Decentralized, you-own-the-data,
  reuses machinery aof already has. If everything else fails, git alone keeps the fleet correct (degraded to
  poll cadence).
- **Two levels of git-of-record (the mesh federates boards).** Each **board** (work stream) keeps its own
  git holding its items + runs — unchanged. The **group** gets its own small durable registry — the roster
  of nodes and the set of registered boards — naturally another lightweight git stream of record. `aof mesh
  ui` reads the group registry + live presence and drills into a board via that board's git (`aof work ui`).
  The relay and control node operate at the **group** level, across boards.
- **Live substrate: a thin, stateless relay on the nominated control node (§7.4 #1/#2).** A lightweight
  self-hosted broker — hosted by the **control node** — carries *ephemeral* signals only: presence/heartbeat
  and "node X is claiming run Y," for sub-5-s visibility and fast claim arbitration. It persists **nothing
  authoritative** (every signal has a durable counterpart in git), so it is a cache/accelerator, never a
  durability SPOF. Absent relay / control node ⇒ git-only fallback, no data loss.
- **Enrollment: device-code group join on the control node (§7.4 #3).** The control node is the enrollment
  authority: `aof mesh invite` mints a short-lived 6-digit code; a new machine runs `aof mesh join <code>`,
  presents it to the control node's relay endpoint, and on match is admitted to the group and issued a mesh
  credential (relay auth + stream identity). No password infra, no manual key copying — device-authorization
  style (cf. GitHub device flow / Tailscale auth keys).
- **Leasing = relay fast-path + git lease-of-record.** The relay brokers near-instant mutual exclusion
  (advisory claim); the authoritative lease is still committed to git. This tightens the commit-then-push
  race window (assumption A2) without making correctness depend on the relay.
- **Conflict avoidance by path partitioning.** Per-node / per-run record files (e.g.
  `runs/<node>/<run-id>.json`, `presence/<node>.json`) so two nodes never edit the same file → git merges
  are add-only, not three-way.
- **Console app packaging.** Node single-executable application (SEA) or `pkg`-style bundling; signing/
  notarization per OS; one-line installer. The relay ships as the same binary in a `relay` mode (any
  node/box can host it) — no separate product to install.
- **Reuse, don't rebuild.** Command core (08) hosts the new `mesh:*` / extended `work:run-*` commands; the
  node runtime and relay are faces; MCP `serve` seam can expose the same to other clients later.
- **Explicitly NOT (held from the prior PRD):** no *durable* server, daemon fleet, Postgres, or auth
  control plane — the relay is stateless ephemeral signaling, not a system of record. aof does **not**
  spawn/bill agents; each node runs the operator's own local agent sessions.

### 7.4 Assumptions (flag for validation)

- **A1 — git is a good-enough *durable* bus.** Push/pull at a ~10–30 s cadence is acceptable for syncing the
  authoritative state (runs, items, leases-of-record). The relay (not git) covers sub-5-s liveness, so git
  is no longer on the latency-critical path. *Risk:* high-frequency tiny commits / merge volume. **Spike:**
  measure on a 3-node fleet. Mitigation: path partitioning + cadence tuning + batching.
- **A2 — leasing is race-safe.** Relay fast-path arbitration + a git **lease-of-record** prevents
  double-work (KR2); correctness never depends on the relay (its loss only slows arbitration to the git
  cadence). *Risk:* the relay-grant vs git-commit ordering protocol. **Primary spike.**
- **A3 — trust = group membership via device code.** A machine is admitted to the group by entering a
  short-lived 6-digit code the control node issues; admission grants a mesh credential (relay auth + stream
  identity). v1 is single-group / trusted-operator — git remote access is provisioned alongside. *Risk:* the
  code-issuance / credential-revocation flow needs care; untrusted/cross-org authz is deferred (§8 Phase 5+).
- **A4 — operators run their own agents per node.** aof orchestrates each node's local agent session; it
  does not become a runner that spawns and bills agent processes (held from the prior PRD).
- **A5 — push for liveness, poll for durability.** Presence + claim signals are pushed over the relay
  (real-time); the durable run/board state still syncs by poll/refresh over git (consistent with milestone
  21). Loss of the relay degrades cleanly to poll-only.

**Key decisions (all resolved):**
1. **Substrate — ✅ git-of-record + thin stateless relay.** Git is durable truth; the relay accelerates
   liveness + leasing and holds no system-of-record.
2. **Symmetry — ✅ a nominated control node.** Not pure P2P: nodes are equal *runners* (any node runs agents
   and can view the fleet), but one node is nominated the **control node** — it hosts the relay, is the
   issuing/visibility hub, and is the enrollment authority. A re-nominate-able **role**, not special
   hardware, and **not a durability SPOF** (git stays replicated; lose the control node and durable truth is
   intact — only liveness, new issuance, and new joins pause until one is back). The control node *is* the
   relay host (natural consolidation).
3. **Trust scope — ✅ device-code group enrollment.** A machine joins a **group** (fleet) by entering a
   short-lived **6-digit code** the control node issues (`aof mesh invite` → `aof mesh join <code>`),
   device-authorization style. Valid code + control-node admission ⇒ a group member, issued a mesh
   credential. v1 is single-group / trusted-operator; untrusted, cross-org, multi-tenant authz is the
   Phase-5+ platform fork.

## 8. Release

Relative timeframes; foundation-first; each phase is independently valuable and shatter-able into milestones.

- **Phase 0 — Foundation (already roadmapped).** Land the run-lifecycle arc (milestones **19 → 20 → 21**)
  as specified: durable runs, autonomous resilience, board observability. The mesh consumes all three; no
  mesh work starts until 19 ships. *No change to existing plans.*
- **Phase 1 — Group, control node, and the mesh UI.** Rename `aof work board` → **`aof work ui`**; add node
  identity, the git-sync engine (durable pull/render), a nominated **control node** hosting the **thin
  stateless relay** (live presence/heartbeat), **device-code enrollment** (`aof mesh invite` / `join`), and
  **`aof mesh ui`** — the fleet view of nodes + every board being worked on (read-only), each drillable into
  its `aof work ui`. Delivers KR1 + KR6 and the headline "see what other agents are working on." *Validates
  A1 (git durable cadence) + the relay liveness path; lands relay + enrollment early so Phase-2 leasing can
  lean on the relay. Note: the rename touches milestone 03's registered board command + its frozen-envelope
  fitness functions — a deliberate ACD change, not a drive-by edit.*
- **Phase 2 — Distributed runs + leasing.** Run records gain the node dimension; claim = relay fast-path
  arbitration + a git **lease-of-record**; `aof work next` becomes mesh-aware. Delivers KR2 (no double-work)
  and fleet-wide orphan reclaim. *Validates A2 (the relay-grant vs git-commit protocol).*
- **Phase 3 — Issuance & routing.** Issue/assign work from the control node (and view from any node);
  capability targeting; board "issue/assign" affordance. Delivers KR3.
- **Phase 4 — Cross-platform console app.** Signed self-contained binaries + one-line install for Windows /
  macOS / Linux (node + relay are one binary, two modes). Delivers KR4.
- **Phase 5+ — Platform fork (only if validated need).** Beyond single-group/trusted: untrusted & cross-org
  peers, real authn/authz + credential revocation at scale, audit, multi-tenant isolation — the heavy
  platform half the prior PRD deferred. Explicitly **not** in the first product.

First version = **Phases 1–4** (the git-of-record mesh with a control node + thin relay: group enrollment,
real-time visible fleet, no double-work, cross-machine issuance, install-anywhere). Anything needing a
*durable* server, scaled auth, or multi-tenancy stays in Phase 5+ behind an explicit decision.

---

### Provenance & next step

Derived from the operator's vision (cross-platform console app + decentralized orchestration + see-other-
agents + issue-from-a-workstation), grounded against the command-core (08), the run-lifecycle arc (19–21),
and the deliberate single-operator boundary of [PRD-work-run-orchestration](./PRD-work-run-orchestration.md)
— which this PRD consciously extends. **All three forks are resolved** (§7.4): git-of-record + thin relay,
a nominated control node, and device-code group enrollment. **Next:** `aof:shatter` this PRD into framed
milestones with `depends` edges onto milestone 19 (the run-lifecycle foundation Phase 1 consumes).
