---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 35 · Mesh Work Assignment — Architecture Decisions

> Inputs: `SPEC.md` (an operator on the control node assigns a resolvable work item to a named worker; the
> worker runs it in an isolated git worktree and streams progress back; no git-bus, no issuance-over-git),
> `STATE.md` (this is the retired issuance/routing capability rebuilt on the WS + global-store transport —
> "watch that this does not smuggle the git-bus back in"), the milestone-34 substrate (global store,
> worker→control WS stream, `mesh.repo.published` markers), the milestone-33 tailnet admission boundary, and
> the milestone-26 distributed-run records. Behavioral checklist mined from
> `reference/retired-dispatch-tests/README.md` (assignment record + lifecycle, targeting, revocation,
> single-runner arbitration, staleness/liveness, reclaim, withdraw, the UI decision) — SEMANTICS transferred,
> the git-bus MECHANISM discarded.
>
> **Codebase-graph grounding.** `aof graph build src` ran at refine time and reported **1459 nodes / 3964
> edges / 121 files (all cached/unchanged — the graph reflects current source), egress none**. `aof graph
> impact` on the six files this milestone touches returned (dependents `←`, dependencies `→`):
> - `src/global-work-store.mjs` **← 7** (`commands/mesh-repo`, `control-stream-server`, `global-mesh-query`,
>   `global-node-registry`, `global-work-publisher`, `mesh-launcher`, `mesh-ui-serve`); **→ 2**
>   (`work`, `workspace`). **This is the hub.** Its schema and its DELETE-ALL-then-reinsert snapshot cycle
>   (`publishWorkspaceSnapshot`, verified at `global-work-store.mjs:204`) are load-bearing for seven modules,
>   so a new assignment table must NOT be swept by that cycle (ADR-001).
> - `src/global-work-publisher.mjs` **← 7**; the ONE write seam (`acd-global-publisher-single-seam`).
> - `src/control-stream-server.mjs` **← 1** (`mesh-launcher`); **→ 3** (`global-node-registry`,
>   `global-work-store`, `mesh-presence`). Single inbound edge ⇒ the launcher is the only wiring site for the
>   nodeId→ws targeting map (ADR-002). Verified: it holds each worker's `ws` in the `wss.on("connection")`
>   closure with NO `nodeId → ws` map (`control-stream-server.mjs:306`).
> - `src/worker-stream-client.mjs` **← 1** (`mesh-launcher`); **→ 0** (cleanly isolated). Send-only today —
>   no receive listener exists (`worker-stream-client.mjs`, the transport seam has `connect/send/close/onDrop`
>   but no `onMessage`). Story 01 adds the down-channel receive here.
> - `src/run-store.mjs` **← 6** (`run-complete`, `run-retry`, `run-start`, `run-status`, `mesh-presence`,
>   `mesh-store`); **→ 1** (`fs` only) — cleanly isolated from every mesh module. The assignment's execution
>   REUSES this machinery (ADR-004); the store stays mesh-blind.
> - `src/mesh-ui-serve.mjs` **← 1** (`cli`); **→ 4** (`asset-base`, `board-serve`, `global-mesh-query`,
>   `global-work-store`). It reads the store through the `global-mesh-query` composition seam and is
>   strictly read-only (zero write routes, 405 on non-GET, upgrade destroyed — verified `mesh-ui-serve.mjs`).
>   Story 03 extends the read shape, never the write posture (ADR-007-of-this-milestone).
>
> **One stale edge, noted (advisory, not decisional).** The graph reports a phantom
> `src/commands/mesh-issue.mjs → global-work-publisher` edge. That file **does not exist** on disk (verified:
> `ls src/commands/mesh-*.mjs` and `grep -rl mesh-issue src/` both return empty), nor does any git-bus module
> (`grep -rln 'mesh-lease\|mesh-issuance\|mesh-sync\|leaseClaimPath' src/` returns nothing). The graph carries
> a leftover node from history; the source tree is already clean of the retired mechanism. This is exactly the
> smuggle-back-in that ADR-003 and `no-git-bus-return` guard against — the tree is clean today and the fitness
> function keeps it clean.

---

## ADR-001: The assignment record is a first-class entity in a NEW `global_assignments` table (schema v2→v3), with dedicated writers and a NAMED PRODUCER for every lifecycle state — it is NEVER swept by the snapshot cycle

**Status:** Accepted
**Date:** 2026-07-08

**Context.** The global store (`global-work-store.mjs`, schema v2) is a REBUILDABLE PROJECTION of the
workspace record docs (34/ADR-003). Its single write seam, `publishWorkspaceSnapshot`, does
DELETE-ALL-then-reinsert of `work_items` for a workspace on every publish (`global-work-store.mjs:204`) —
`DELETE FROM work_items WHERE workspace_id = ?` then re-insert. That is correct BECAUSE work items are DERIVED
from the docs. **An assignment is not derived from any doc.** It is operator/worker-CREATED state (who was
told to run what, and how far it got). If assignments lived in `work_items` — or in any table the snapshot
cycle touches — the very next converge tick (34/ADR-004, the launcher's periodic re-publish) would wipe them.
This is the milestone's central data-contract hazard.

Prior-lesson recall (R2, m20): *an ADR that freezes a state-carrying key AND classifies it must ALSO name the
PRODUCER that SETS it — a frozen+classified key with no writer is a contract hole the Three Amigos catch
late.* The assignment record carries a `state` that is exactly such a classified, state-carrying key. This
ADR closes that hole up front by naming a sole producer per state.

**Decision.**
- **A new table.** Bump the global store schema **v2 → v3**. Add `global_assignments`, keyed by
  `assignment_id` (PRIMARY KEY). The v2 tables (`workspaces`, `work_items`, `projection_metadata`,
  `projection_errors`, `global_nodes`, `global_workspace_descriptors`, `global_node_workspaces`) are
  UNCHANGED; the migration is additive (a `CREATE TABLE IF NOT EXISTS` inside the existing `migrateSchema`
  transaction, then `INSERT OR REPLACE INTO aof_schema … version = 3`). A v2 store opened by a v3 build
  migrates forward; a v3 store opened by a v2 build already refuses (the existing `schema-unsupported` guard
  at `global-work-store.mjs:30`).
- **Dedicated writers, never the snapshot seam.** Assignment mutations go through NEW, dedicated functions
  (`insertAssignment` / `updateAssignmentState` — names indicative), each an atomic single-row `INSERT`/
  `UPDATE … WHERE assignment_id = ?`. `publishWorkspaceSnapshot` is NOT extended to touch
  `global_assignments`; no `DELETE FROM global_assignments` appears anywhere in the snapshot path. A snapshot
  cycle leaves every assignment row byte-identical.
- **The frozen record shape.** An assignment assembler returns EXACTLY this ordered key set (the retired
  6-key issuance record's shape, re-expressed on the WS/store transport and extended with the run link and
  reclaim provenance this milestone needs):

  `{ assignmentId, itemRef, workspaceId, targetNodeId, issuer, state, runId, assignedAt, updatedAt, reclaimedAt }`

  - `assignmentId` — the stable key; the worktree is keyed by it (ADR-004).
  - `itemRef` — the resolvable work ref (`NN` or `NN/SS`).
  - `workspaceId` — the store's canonical workspace id; `(workspaceId, itemRef)` is the arbitration key (ADR-003).
  - `targetNodeId` — the assigned worker (the `--to <nodeId>`).
  - `issuer` — the control node that issued it (provenance; the retired record's `issuer`).
  - `state` — the lifecycle state (below).
  - `runId` — the run record the worker minted for execution (null until `running`; the ADR-004 link).
  - `assignedAt` / `updatedAt` / `reclaimedAt` — ISO-8601 UTC-Z stamps (`reclaimedAt` null except on the
    reclaim path, mirroring the run record's `reclaimedAt`).
- **The lifecycle state set + its SOLE PRODUCER per state** (the R2/m20 contract, made explicit — this is a
  single source-of-truth enum, and every value maps to exactly one producer):

  | state       | classification        | SOLE producer                                                              |
  |-------------|-----------------------|----------------------------------------------------------------------------|
  | `assigned`  | control-created       | the control **assign verb** (`aof mesh assign <ref> --to <nodeId>`)         |
  | `accepted`  | worker-reported       | the **worker** (over an `assignment-status` frame; control writes through)  |
  | `running`   | worker-reported       | the **worker** (`assignment-status`; control writes through) — sets `runId` |
  | `done`      | worker-reported (term)| the **worker** (`assignment-status`; control writes through)                |
  | `failed`    | worker-reported (term)| the **worker** (`assignment-status`; control writes through)                |
  | `withdrawn` | control-created (term)| the control **withdraw verb** (`aof mesh assign <ref> --withdraw`)          |
  | `reclaimed` | control-created (term)| the control **reclaim path** (ADR-005, dual-staleness) — sets `reclaimedAt` |

  The worker-reported states are written into the store BY the control node (the worker has no store; it
  reports over the up-channel `assignment-status` frame, ADR-002, and control persists the transition). The
  producer is still singular: the worker is the sole SOURCE of `accepted/running/done/failed`; control is a
  faithful write-through, not a second authority.
- **Withdraw is a state write, never a delete** (mining the retired `mesh-issue-withdraw.mjs`: withdrawing
  flips `state → withdrawn`, never deletes the row). Same for `reclaimed`. Terminal rows are retained for
  audit; pruning (if ever) is a separate, explicit operation, never the snapshot cycle.

**Consequences.**
- Assignments survive every converge/snapshot tick — the data contract the whole milestone rests on
  (`assignments-survive-snapshot`).
- The R2/m20 hole is closed structurally: no assignment state exists without a named writer, and the mapping
  lives in ONE table/enum a fitness function can assert against (`assignment-state-has-producer`).
- The `runId` link makes the run record (ADR-004) the execution detail and the assignment the dispatch
  fact — no duplicated lifecycle, two records that reference each other by id.
- Schema v3 is a coordinated bump: any tool reading the store must tolerate the new table (additive, so a
  reader that ignores it is unaffected; a writer must be v3-aware).

---

## ADR-002: The control→worker directive channel is the ONE persistent m34 WebSocket — TARGETED to a single connected tailnet peer, never broadcast, never a git-bus

**Status:** Accepted
**Date:** 2026-07-08

**Context.** 34/ADR-007 established ONE persistent WS per worker (worker→control), and explicitly anticipated
this channel ("WS eases a future control→worker command channel", 34/ADR-007 open Q1). Today the server holds
each worker's `ws` only inside the `wss.on("connection")` closure (`control-stream-server.mjs:306`) — there is
NO `nodeId → ws` map, so the server cannot address ONE worker. The worker client is send-only
(`worker-stream-client.mjs`): its transport seam has `connect/send/close/onDrop` but no receive path. The
retired mechanism delivered directives as git-synced per-node files arbitrated by observing the merged git
state — the exact machinery `STATE.md` warns must not return.

**Decision.**
- **Reuse the one stream; do not open a second socket.** The directive rides the SAME persistent WS
  34/ADR-007 built. No new listener on the worker, no new server on control.
- **Add a targeting map on the server.** `control-stream-server.mjs` gains a `nodeId → ws` registry populated
  in `wss.on("connection")` (the nodeId is already resolved there, `meta.nodeId`) and cleared on
  `close`/`error`. A `sendDirective(nodeId, directive)` looks up exactly ONE socket and writes to it. There is
  no fan-out API — the server exposes no "send to all workers" for directives.
- **Two new frame kinds, payload-agnostic (the m34 wire is already extensible — new kinds ride it):**
  - **down:** `{ kind: "directive", to: <nodeId>, assignmentId, itemRef, workspaceId, at }` — control→worker.
  - **up:** `{ kind: "assignment-status", nodeId, assignmentId, state, runId?, at }` — worker→control; the
    control server ingests it and writes the lifecycle transition through ADR-001's dedicated writer.
  An unrecognised kind stays a no-op (the never-crash discipline `applyStreamFrame` already keeps,
  `control-stream-server.mjs:142`).
- **Admission IS the trust boundary; only a LIVE connected peer receives a directive.** A directive is sent
  only if `nodeId` resolves to a currently-connected socket in the targeting map, AND that node is in the
  tailnet roster (`isTailnetPeer`, 33/ADR-002 — the same predicate that admitted the worker's stream). The
  worker never re-authenticates the directive; being on the admitted stream IS the authorization.
- **The "target not connected" miss is LOUD (34/ADR-008).** If `--to <nodeId>` names a node with no live
  socket in the targeting map, the assign verb does NOT silently drop the directive. It surfaces a coded,
  operator-visible refusal (`assignment-target-not-connected`) through the launcher's existing `warnings`
  channel and the CLI's error path — the SAME first-class array that already carries
  `worker-stream-target-unresolved` (`mesh-launcher.mjs:314`). Silence is the defect, per 34/ADR-008.
- **Reject the relay-broadcast alternative.** A broadcast to all workers (the retired relay push shape,
  `relay-lease-fast-path.mjs`) cannot target ONE worker and would deliver a directive to nodes that were never
  assigned the work. The whole point of `--to <nodeId>` is single-target delivery.

**Consequences.**
- The channel is bidirectional over one socket, keeping 34/ADR-007's "one persistent connection per worker"
  invariant intact — no second connection lifecycle to test.
- The targeting map lives ONLY on the server, wired ONLY by the launcher (graph: `control-stream-server ← 1`,
  the launcher) — no new inbound edge, no fan-out surface (`directive-targets-one-peer`).
- A directive to an offline/unadmitted node fails loudly at the control node, before anything is sent — the
  operator learns "that worker is not connected" immediately, never a directive lost to the void.
- The git-bus stays dead: directives are WS frames, not synced files; arbitration is the store (ADR-003), not
  observed git state.

---

## ADR-003: Single-runner arbitration is a STORE UNIQUENESS INVARIANT, not a git-observed lease — at most one ACTIVE assignment per `(workspaceId, itemRef)`; the retired lease/issuance modules are NOT resurrected

**Status:** Accepted
**Date:** 2026-07-08

**Context.** The retired capability enforced "exactly one node runs an item" by racing per-node claim FILES,
git-syncing them, and arbitrating by OBSERVING the merged git state (`mesh-lease-claim-arbitration.mjs`,
`acd-lease-arbitration-git-observed.mjs`). `STATE.md`, the SPEC, and the reference README are unanimous: that
git-bus mechanism does NOT return. But the operator intent — one node, not two, runs a given item — must be
preserved. This milestone is operator-DIRECTED (the operator picks the node with `--to`), so there is no
racing to arbitrate; there is only the invariant that a second assignment for the same item cannot go ACTIVE
while one already is.

**Decision.**
- **Arbitration is a uniqueness rule in the store, enforced at the assign write.** At most ONE assignment per
  `(workspaceId, itemRef)` may be in a NON-TERMINAL (ACTIVE) state — where ACTIVE = `state ∈ {assigned,
  accepted, running}` and TERMINAL = `state ∈ {done, failed, withdrawn, reclaimed}`. The assign verb checks
  for an existing active assignment on `(workspaceId, itemRef)` and REFUSES a second one (a coded
  `assignment-already-active` refusal, naming the node that holds it), minting nothing — the same fail-closed
  posture the run-store's `duplicate-run` guard keeps (`run-store.mjs:264`).
- **Reassigning is: withdraw (or reach terminal), then assign.** To move an item to a different node, the
  operator withdraws the active assignment (→ `withdrawn`, terminal) or lets it reach `done`/`failed`; only
  then does a new `assigned` pass the uniqueness check. This makes double-assignment (ADR-004's "same ref
  assigned twice") a store refusal, not two colliding worktrees.
- **Explicitly DO NOT resurrect the git-bus lease machinery.** No module may import or re-create
  `mesh-lease.mjs`, `mesh-issuance.mjs`, `mesh-sync.mjs`, `commands/mesh-issue.mjs`, or a `leaseClaimPath`
  function. "Exactly one node runs" is the store's uniqueness invariant, observed over the store's own rows —
  NEVER a git-observed lease, a claim file, or a merged-git read. (The graph's phantom `mesh-issue.mjs` edge
  is a history leftover, not a live import — the tree is already clean; the fitness function keeps it so.)

**Consequences.**
- "Exactly one node runs an item" is a deterministic, in-process store check at assign time — no distributed
  race, no clock-based lease liveness for the ACTIVE decision (staleness enters ONLY on the reclaim path,
  ADR-005).
- The retired git-bus cannot creep back in: `no-git-bus-return` fails CI on the first import of any lease/
  issuance/sync module or `leaseClaimPath`.
- Because the operator directs the node, there is no "loser flips to released" arbitration (the retired
  `mesh-lease-claim-arbitration.mjs` racer semantics); there is one writer (the assign verb) and one invariant.

---

## ADR-004: One dedicated git worktree per assignment (keyed by `assignmentId`), under a defined mesh worktrees root; cleanup on `done`, retain-on-`failed`; the ref resolves against the worktree's OWN checkout; execution mints a node-partitioned run through the existing run-store

**Status:** Accepted
**Date:** 2026-07-08

**Context.** The headline capability: an accepted assignment runs in isolation so concurrent assignments (and
the worker's own local work) do not collide. NO worktree usage exists in `src/` today (entirely new). NO
headless execution driver exists in `src/` — execution is orchestrated by the skill/agent layer; the run-store
(`run-store.mjs`) only TRACKS run lifecycle. The run record is a first-class, node-partitioned entity with a
frozen 14-key schema, a `queued→running→done|failed|cancelled` state machine, atomic writes, and orphan
reclaim (`reclaimStaleRuns`) — proven machinery this milestone reuses rather than reinvents.

**Decision.**
- **One worktree per assignment, keyed by `assignmentId`.** On an accepted directive, the worker materializes
  a dedicated `git worktree add` for the target ref, under a defined **mesh worktrees root**:
  `<repo>/.aof/mesh/worktrees/<assignmentId>/`. Rationale for the location: it is INSIDE the repo's own
  `.aof/` (already git-ignored, already the home of `.aof/mesh/` state), so worktrees never pollute the
  working tree, are trivially discoverable per-repo, and are removed with the repo — not scattered under a
  machine-global temp dir divorced from the repo they belong to. Keying by `assignmentId` (not `itemRef`)
  guarantees a stable, collision-free path even across reassignments.
- **The ref resolves against the worktree's OWN checkout — resolution is repo-relative.** The worker resolves
  `itemRef` (loads the workspace, finds the item, drives execution) inside the worktree's checkout, never the
  worker's primary working copy. Concurrent assignments each see only their own worktree's state.
- **Repo guard first, loud on miss (34/ADR-008).** Before creating a worktree the worker checks it actually
  HAS the repo for `workspaceId` (resolved via `global_node_workspaces` + the local `mesh.repo.published`
  marker, 34/ADR-010). "This worker does not have this repo" is a LOUD, coded failure
  (`assignment-repo-unavailable`) reported up the channel as an `assignment-status` `failed`, never an opaque
  crash — the operator sees exactly why. (This gate is CHECKED control-side at assign time too, ADR-001/story
  00; the worker re-checks defensively at execution.)
- **Execution mints a node-partitioned run through the EXISTING run-store.** The worker calls `startRun(item,
  { node: <thisNodeId> })` (`run-store.mjs:294`) — the run lands under this node's partition
  (`runs/<node>/<runId>.json`, 26/ADR-001), heartbeats via `heartbeat` (`run-store.mjs:488`), and reaches
  terminal via `completeRun` (`run-store.mjs:416`). The assignment's `runId` (ADR-001) is that run's id. The
  run-store stays MESH-BLIND (graph: `run-store → fs` only) — the node id arrives as DATA, exactly as the
  fleet-reclaim path already passes it.
- **Lifecycle bracketing.** `assigned → accepted` (directive received, repo guard passed) `→ running`
  (worktree materialized, run minted, execution begun) `→ done|failed` (run reaches terminal, status streamed
  up). Each transition emits an `assignment-status` frame (ADR-002).
- **Cleanup + retention.** On `done`, the worktree is removed (`git worktree remove`). On `failed`, the
  worktree is RETAINED for inspection (a failed run is a debugging artifact, not garbage) — retention is
  bounded by an explicit retention default the Three Amigos pin (indicatively: retain failed worktrees,
  sweep them on a documented ceiling; a `done` worktree is removed immediately). The retention default lives
  as a documented constant, not scattered.
- **The runtime-invocation depth is a documented default the research + Three Amigos pin.** HOW the agent/
  skill layer is invoked headlessly inside the worktree is being resolved by a separate researcher. This ADR
  fixes the worktree + run-lifecycle BRACKETING (the structure); the invocation depth (which driver, what the
  brief carries) is a documented default that the research and the Three Amigos feasibility pin at build. The
  bracketing does not change whichever driver is chosen.
- **Double-assign is refused upstream.** ADR-003's uniqueness invariant means a second worktree for the same
  `(workspaceId, itemRef)` never gets created — the assign verb refuses before any directive is sent.

**Consequences.**
- Concurrent assignments are genuinely isolated: separate worktrees, separate node-partitioned runs, no
  shared working-tree state.
- No new run machinery: the run-store is reused verbatim (its reclaim, heartbeat, and atomic-write guarantees
  come for free) — `worktree-path-scoped` and the run reuse are structural.
- A worker without the repo fails loudly and specifically, never opaquely (34/ADR-008).
- A retained failed worktree is an inspectable forensic artifact; a bounded retention default keeps disk from
  growing unbounded.

---

## ADR-005: Reclaim of an assignment fires ONLY under DUAL staleness (worker presence stale AND run heartbeat stale), re-expressed on presence + the store — never on git

**Status:** Accepted
**Date:** 2026-07-08

**Context.** A worker can die mid-run. Its assignment would then sit `running` forever, its item never
re-offered. The retired `fleet-orphan-reclaim.mjs` solved this with a DUAL-STALENESS decision table
(presence stale AND run heartbeat stale ⇒ reclaim; fresh presence hands-off even with a stale heartbeat; no
presence record ⇒ unknown liveness ⇒ hands-off), arbitrated over git-synced records. The SEMANTICS transfer;
the git mechanism does not. This milestone already has both staleness clocks: presence
(`mesh-presence.isNodeStale`, default 90s, `mesh-presence.mjs:42`) and run heartbeat
(`run-store.isStale`, the `run.heartbeatAt` age, `run-store.mjs:508`) — the SAME two predicates the retired
table used, both already `import`ed and shared (never re-derived).

**Decision.**
- **Reclaim ONLY under DUAL staleness, strict `>`.** An assignment in a non-terminal state is reclaimed to
  `reclaimed` ONLY when the target worker's presence is stale (`isNodeStale`, default **90s**) AND the run's
  heartbeat is stale (`isStale`, documented default **15m** — the m20 `work.autonomous.heartbeatStaleMs`).
  Both use strict `>` — a value AT the threshold is still LIVE. This is the retired table's exact decision,
  re-expressed on presence records + the store (never git).
- **Presence precedence — the hands-off rows.** Fresh presence ⇒ hands-off even with a stale heartbeat (the
  worker is alive, the run is just quiet). No presence record ⇒ UNKNOWN liveness, NOT staleness ⇒ hands-off
  (the m23/KR2 guard — never treat missing-presence as stale; that would reclaim a possibly-live peer). Stale
  presence + fresh heartbeat ⇒ wait (conservative).
- **The reclaim action.** On dual staleness the control reclaim path (the SOLE producer of `reclaimed`,
  ADR-001) sets `state → reclaimed` and `reclaimedAt = now`, and force-fails the linked run via the existing
  `reclaimStaleRuns` machinery (`failureReason = runtime_offline`, retryable — a crashed host is infra, per
  20/ADR-002). The item's assignment is then eligible for re-assignment (ADR-003's uniqueness check now
  passes, the reclaimed assignment being terminal).
- **On the store + presence, never git.** The reclaim reads the presence records (`readPresenceRecord`) and
  the run heartbeat (`readRuns`), decides with the two shared predicates, and writes the store transition —
  there is no git observation, no claim-file lapse. The retired `mesh-lease-clock.mjs` / claim-file-lapses-
  by-rule semantics become "the store row transitions to `reclaimed` under the dual-staleness rule."

**Consequences.**
- A dead worker's assignment is recovered automatically, but only when BOTH clocks agree the worker is gone —
  the conservative posture that avoids reclaiming a live-but-quiet worker.
- The decision reuses the two staleness predicates already proven and shared, so the run layer and the node
  layer keep ONE staleness definition (no parallel heartbeat).
- `reclaimed` has a sole producer (the control reclaim path) and a distinguishing stamp (`reclaimedAt`),
  separating a reclaimed failure from an operator-reported one — exactly as the run record does.

---

## ADR-006: Accept posture is AUTO-ACCEPT within the tailnet boundary — the admission IS the trust boundary; the RCE consequence is covered by the security lens

**Status:** Accepted
**Date:** 2026-07-08

**Context.** SPEC framing question: does an admitted worker auto-accept and run, or require a local operator
confirm? Running assigned work is remote code execution on the worker. The trust boundary this milestone
inherits is 33/ADR-002 tailnet admission — the worker already accepts a stream ONLY from an admitted tailnet
peer (`isTailnetPeer`, `control-stream-server.mjs`), and that same admitted control node is the sole source of
directives (ADR-002).

**Decision.**
- **Auto-accept (documented default).** An admitted worker that receives a directive over its live admitted
  stream AUTO-ACCEPTS and runs it — no local operator confirmation step. Rationale: the admission is ALREADY
  the trust decision. A control node that can open the worker's admitted stream is, by 33/ADR-002, a trusted
  tailnet peer; adding a per-directive local confirm would neither strengthen the boundary (the same peer is
  already trusted for state ingest) nor be operable (a worker is typically unattended). This matches the
  retired capability's posture (`mesh-cross-node-issuance-kr3.mjs`: a directive issued on A is offered and RUN
  on target B, no B-side confirm).
- **The security lens covers the RCE consequence.** Auto-accept means the trust surface IS the tailnet
  admission — a compromised or malicious control node can make an admitted worker run arbitrary work. This is
  the SPEC's explicitly-flagged security-review trigger. A deeper threat model (what a compromised control
  node can make a worker run, sandboxing the execution) is OUT OF SCOPE here (SPEC out-of-scope: "a hardened
  remote-execution threat model beyond the existing tailnet admission boundary") and is flagged for the
  security review, not solved in this milestone.

**Consequences.**
- The dispatch plane works unattended: assign from control, the worker just runs it.
- The trust boundary is singular and documented (tailnet admission), not spread across a per-directive
  confirm the operator would have to service.
- The RCE surface is named and deferred to a security review, not silently accepted.

---

## ADR-007: The `assign` verb lives on the CLI; the fleet UI stays READ-ONLY (honors "read-only after m34") — a guarded same-origin+json POST is a deferred future affordance

**Status:** Accepted
**Date:** 2026-07-08

**Context.** The retired capability had a UI write route (`mesh-ui-issue-route.mjs`: `POST /api/mesh/issue`).
But milestone 34 made the fleet UI STRICTLY read-only: zero write routes, 405 on every non-GET, the WS
upgrade destroyed, and updates by POLLING `GET /api/mesh/status` every 5s — no UI push (verified
`mesh-ui-serve.mjs`: `sendMethodNotAllowed` on non-GET, `server.on("upgrade", … socket.destroy())`). The
reference README flags this directly: "the read-only fleet UI needs a deliberate answer for where assign
lives."

**Decision.**
- **`aof mesh assign` is the verb.** Assignment (assign, withdraw) is a CLI-only nested verb under `mesh`
  (a sibling of `aof mesh repo publish`, 34/ADR-010, and `aof mesh ui`). It reaches the store through
  dedicated assignment writers (ADR-001) and sends the directive through the control server's targeting map
  (ADR-002).
- **The fleet UI stays read-only and renders lifecycle only.** The fleet SPA renders assignments advancing
  `assigned → accepted → running → done|failed` by reading the extended `GET /api/mesh/status` shape (story
  03). It exposes NO assignment write route — the m34 read-only posture (405 on non-GET, upgrade destroyed,
  the `/api/mesh` disjoint namespace) is untouched.
- **Lifecycle advances "live" in the UI via the 5s poll, not a UI push.** An assignment's state advances in
  the store (control writes worker-reported transitions, ADR-001/002); the read-only UI reflects it within the
  m34 presence bound + one poll (5s). There is no UI WebSocket (m34 destroyed the upgrade); "live" here means
  "converges within one poll," matching how the fleet already shows work-state.
- **A guarded UI POST is DEFERRED, not designed.** A future same-origin + `application/json`-guarded
  `POST /api/mesh/assign` (the CSRF/same-origin guard the retired `acd-mesh-issue-route-same-origin.mjs`
  encoded) is noted as a possible future affordance — explicitly OUT of this milestone. Adding it would
  reverse the m34 read-only decision and must be its own ADR when/if it happens.

**Consequences.**
- The m34 read-only invariant is preserved verbatim; this milestone adds no write surface to the UI
  (`mesh-ui-read-only`).
- The operator's assign action is a deliberate CLI command (auditable, scriptable), matching `mesh repo
  publish`'s CLI-only shape.
- The UI's "live" feel is the existing 5s poll of the store-backed status endpoint — no new push channel to
  build or test.

---

## ADR-008: The control node DISPATCHES directives and RECLAIMS stale assignments on ONE periodic launcher tick — a sibling of the existing propagation/peer-poll tickers; the one-shot `aof mesh assign` verb writes the store row but does NOT itself dispatch

**Status:** Accepted
**Date:** 2026-07-09
**Context supersedes nothing — this ADR CLOSES a wiring gap ADR-002/ADR-005 left implicit (see below).**

**Context.** As-built review (2026-07-09) surfaced two control-side capabilities that were built, tested, and
green, yet had NO production call site:
- **Dispatch.** `dispatchDirective`/`sendDirective` (ADR-002, `control-stream-server.mjs`) exist and are
  exposed on the launcher's returned server handle (`control-stream-server.mjs`'s `dispatchDirective`), but
  nothing CALLS them. The `aof mesh assign` verb (`commands/mesh-assign.mjs`'s `assignWork`) mints an
  `assigned` row via `insertAssignment` and returns — it emits NO directive frame. The worker's receive seam
  (`worker-stream-client.mjs` `onDirective` → `mesh-worker-execution.mjs`) is correctly wired via
  `mesh-launcher.mjs`, so a directive that IS sent runs; but none is ever sent. The assign row sits `assigned`
  forever.
- **Reclaim.** `reclaimStaleAssignments` (ADR-005, `mesh-assignment-reclaim.mjs`) is the correct, fully-tested
  dual-staleness DECISION+ACTION function, but the graph shows it with ZERO dependents (`aof graph impact
  mesh-assignment-reclaim.mjs` → `← 0`) — no periodic scheduler invokes it. A worker that dies mid-run leaves
  its assignment `running` forever; the `@manual` task-05 soak ("kill the worker mid-run → assignment goes
  reclaimed") cannot converge live until something calls it on a tick.

ADR-002 built the directive CHANNEL and its targeting map; ADR-005 built the reclaim DECISION. Neither ADR
named the control-side DRIVER that invokes them against live state. The worker side has its driver (the
`onDirective` handler on the persistent stream); the control side did not. Both gaps are the SAME missing
seam — a control-side periodic driver — so this ADR closes them together.

The launcher already runs exactly this shape of loop for two other concerns: `propagationTicker` (re-publishes
the global work snapshot on a cadence) and `peerPollTicker` (re-reads `resolvePeers` and refreshes the stream
server's admission roster), both over the ONE injected-ticker seam (`intervalTicker()` default, an injected
manual ticker in tests — no wall-clock wait). The control tick is a third sibling over that same seam.

**Decision.**
- **ONE periodic control tick in `startLauncher`.** When this node's role is `control` and it has started the
  stream server, `startLauncher` starts ONE additional ticker (the `controlDispatchReclaimTicker`, an injected
  sibling of `propagationTicker`/`peerPollTicker`, defaulting to the same real `intervalTicker()` and
  options-gated exactly like every other launcher knob — a caller that supplies none of it, and every
  pre-existing launcher test, gets byte-identical behaviour). Each tick does TWO things against live store +
  connection state:
  1. **Dispatch.** Scan `global_assignments` for rows in state `assigned` whose `targetNodeId` is currently a
     connected admitted peer in the stream server's `directiveTargets` map, and for each,
     `streamServer.dispatchDirective(buildDirectiveFrame({ to: targetNodeId, assignmentId, itemRef,
     workspaceId, at }))` over the EXISTING ADR-002 channel. This is the missing call site for the
     `dispatchDirective` seam. A row whose target is NOT connected is left `assigned` (it dispatches on a later
     tick once the peer connects — never a silent drop, never a loud error here: the assign-time gate already
     surfaced "target not connected" loudly at assign time, ADR-002; the tick just waits for the peer). NO
     directive is sent to an unconnected/unadmitted node (admission is structural — `directiveTargets` is
     populated only post-admission, ADR-002/SECURITY T5).
  2. **Reclaim.** Call `reclaimStaleAssignments(store, workspace, workspaceId, { now })` (ADR-005) so any
     dual-stale assignment converges to `reclaimed` (force-failing its linked run) without a manual call. The
     injected `now`/thresholds discipline (22/R2) is preserved — the tick threads the launcher's `now`.
  Both halves are FAILURE-ISOLATED (the ADR-004 discipline every launcher ticker keeps): a store-read or
  dispatch fault on one tick is caught and the next tick simply re-attempts — never a daemon crash.
- **DISPATCH-ONCE semantics — the worker's `onDirective` dedupe is AUTHORITATIVE; the launcher's in-memory set
  is a best-effort optimization.** A row stays `assigned` until the worker's `accepted` uplink advances it
  (ADR-001/002), so a naive re-scan would re-dispatch the SAME `assignmentId` every tick until the uplink
  lands. Two guards, with a clear authority:
  - **Authoritative — the worker dedupes.** `mesh-worker-execution.mjs`'s directive handler IGNORES a duplicate
    directive for an `assignmentId` it is already acting on / already holds (an in-flight or already-terminal
    assignment on that worker). This is the guarantee the system RESTS on: because a control-node restart drops
    the launcher's in-memory "already-dispatched" set, a post-restart tick MAY re-dispatch an `assigned` row
    whose worker already accepted it — and that re-dispatch is SAFE precisely because the worker dedupes it.
    Re-dispatch after a launcher restart is acceptable IFF the worker dedupes (it does).
  - **Best-effort — the launcher's in-memory set.** The driver holds an in-memory `Set` of already-dispatched
    `assignmentId`s for THIS launcher lifetime, so within one launcher run it does not re-emit a directive on
    every tick while waiting for the `accepted` uplink (a bandwidth/noise optimization, not the correctness
    guarantee). The set is NOT persisted — it is deliberately rebuilt empty on restart, and correctness is
    restored by the worker-side dedupe above, not by persisting this set. (Once the worker's uplink advances
    the row OUT of `assigned`, the scan no longer selects it regardless of the set — the set only covers the
    `assigned`-but-not-yet-`accepted` window.)
- **"Live" means "within one control tick," not instantly — consistent with the milestone's model.** An
  assign converges to a running worker within one control-tick period (as the fleet UI's "live" already means
  "within one 5s poll", ADR-007, and the worker's stream liveness is a heartbeat window, 34/ADR-007). There is
  no instant push from the assign verb to the worker; the tick is the convergence unit. This matches the
  whole mesh's poll/tick-converged model — no new real-time guarantee is introduced or needed.
- **Rejected alternatives (recorded, briefly).**
  - **CLI→daemon IPC / the assign verb dispatches directly.** The one-shot `aof mesh assign` process is a
    SEPARATE, short-lived process; it has NO handle to the long-lived `--serve` daemon's in-memory
    `directiveTargets` map (that map lives only in the running launcher's memory, populated in
    `wss.on("connection")`). Bridging them would require net-new CLI→daemon IPC — a new socket/lifecycle to
    build and test — for no benefit over the tick, which already lives exactly where the map + tickers are.
    Rejected.
  - **The assign verb co-locating/short-circuiting to a server.** Would couple the CLI verb to server internals
    and duplicate the admission/targeting logic that already lives in the launcher. Rejected — the assign verb
    stays a pure store-writer (ADR-001/007), the launcher tick is the sole dispatcher.

**Consequences.**
- The dispatch plane works end-to-end unattended: assign writes a row; the next control tick dispatches it to
  the connected worker; the worker runs it and streams `accepted → running → done|failed` back (ADR-002/004);
  a dead worker's assignment is reclaimed on the same tick (ADR-005) — the SPEC's outsider-verifiable success
  (assign → worker runs in a worktree → fleet view advances live) is now reachable through the shipped command.
- The assign verb keeps its clean shape: a pure store-writer with a loud assign-time gate (ADR-001/003/007),
  NOT a dispatcher — one seam (the tick) owns dispatch, testable in-process over the injected ticker.
- The control node has ONE more tick over the SAME injected-ticker seam — no new lifecycle, no new socket, no
  new admission surface. Dispatch rides the ADR-002 channel; reclaim rides the ADR-005 decision; this ADR only
  adds the DRIVER that calls both.
- Correctness under restart rests on the worker's idempotent `onDirective`, not on persisting launcher state —
  the same at-least-once-delivery + idempotent-consumer shape the rest of the mesh already uses.

---

## Fitness functions

Each becomes an arch-test under `test/arch/acd-<name>.test.mjs` (an `archTests` array, source-text/AST grep
assertions with the m03 non-vacuous planted-violation self-check, registered in `scripts/test.mjs`), mirroring
the existing `acd-control-stream-tailnet-only`, `acd-global-publisher-single-seam`, and
`acd-fleet-reclaim-guarded` house style. Each is RED until the story that implements the guarded structure
turns it green. **These are SPECIFICATIONS, not implementations** — the executable test files are written at
build, not here.

1. **`acd-no-git-bus-return`** — *guards ADR-003.*
   - **Invariant:** no `src/` module imports or creates the retired git-bus lease/issuance/sync machinery.
   - **Assertion:** over every `src/**/*.mjs` (comments stripped), assert NO `import … from "./mesh-lease.mjs"`,
     `"./mesh-issuance.mjs"`, `"./mesh-sync.mjs"`, or `"./commands/mesh-issue.mjs"`, and NO definition/reference
     of a `leaseClaimPath` function. Self-check: a planted `import … "./mesh-lease.mjs"` string trips the
     detector.
   - **Turns green in:** Story 00 (RED-until: the guard is armed with the assignment table in place, proving
     the rebuild used no git-bus).

2. **`acd-assignment-state-has-producer`** — *guards ADR-001 / R2(m20).*
   - **Invariant:** every value in the assignment state set maps to exactly ONE named producer in a single
     source-of-truth table/enum; no state exists without a writer.
   - **Assertion:** load the single assignment-state → producer map (the enum/table the assembler and writers
     share). Assert its keys equal EXACTLY `{assigned, accepted, running, done, failed, withdrawn, reclaimed}`,
     each maps to a non-empty producer id, and the union of producers the codebase actually WRITES (grep the
     dedicated writer call sites for the state literals they set) is a subset of the mapped producers — no
     orphan state, no producerless state. Self-check: a planted state with no producer entry fails.
   - **Turns green in:** Story 00.

3. **`acd-assignment-record-frozen`** — *guards ADR-001.*
   - **Invariant:** the assignment assembler returns EXACTLY the frozen key set, in order.
   - **Assertion:** call the assembler with representative input; assert `Object.keys(record)` deep-equals
     `["assignmentId","itemRef","workspaceId","targetNodeId","issuer","state","runId","assignedAt",
     "updatedAt","reclaimedAt"]` (order-sensitive), mirroring `acd`-style frozen-key checks (the run record's
     14-key freeze, the presence record's 4-key freeze). Self-check: an assembler returning an extra/missing
     key fails.
   - **Turns green in:** Story 00.

4. **`acd-assignments-survive-snapshot`** — *guards ADR-001.*
   - **Invariant:** a `publishGlobalWorkSnapshot` / `publishWorkspaceSnapshot` cycle does not delete or alter
     any `global_assignments` row.
   - **Assertion (structural + behavioural):** (a) STRUCTURAL — grep the snapshot write path
     (`global-work-store.mjs` `publishWorkspaceSnapshot` body) for any statement touching `global_assignments`
     (`DELETE FROM global_assignments`, `INSERT … global_assignments`, `UPDATE global_assignments`); assert
     NONE exist. (b) BEHAVIOURAL — open a v3 store, insert an assignment, run a full snapshot publish for that
     workspace, assert the assignment row reads back byte-identical. Self-check: a planted
     `DELETE FROM global_assignments` in the snapshot path trips the structural grep.
   - **Turns green in:** Story 00.

5. **`acd-directive-targets-one-peer`** — *guards ADR-002.*
   - **Invariant:** a node-targeted directive is sent to a SINGLE connected peer socket, never broadcast.
   - **Assertion:** over `control-stream-server.mjs`, assert the directive send resolves ONE socket from the
     `nodeId → ws` targeting map (a `.get(nodeId)` / map lookup) and that no directive send iterates
     `wss.clients` / a "send to all" fan-out; assert `sendDirective` has no broadcast branch. A behavioural
     companion: with a two-worker registry, `sendDirective("worker-a", …)` writes to worker-a's socket only,
     worker-b's socket receives nothing. Self-check: a planted `for (const c of wss.clients) c.send(directive)`
     fails the no-fan-out assertion.
   - **Turns green in:** Story 01.

6. **`acd-assignment-target-not-connected-loud`** — *guards ADR-002 / 34-ADR-008.* (an ADR-implied addition)
   - **Invariant:** an assign to a node with no live socket surfaces a coded, operator-visible refusal — never
     a silent drop.
   - **Assertion:** the assign path, on an unresolved/disconnected target, produces a coded refusal
     (`assignment-target-not-connected`) routed through the launcher `warnings` channel / the CLI error path;
     grep asserts the code literal exists at the miss branch and that the miss branch does not `return`
     silently without emitting it. Behavioural: assigning to an absent nodeId yields the coded error, no
     directive frame sent. Self-check: a planted silent-`return` at the miss (no code emitted) fails.
   - **Turns green in:** Story 00 (control-side gate) + Story 01 (channel-side "not connected").

7. **`acd-assignment-repo-availability-loud`** — *guards ADR-004 / 34-ADR-008.* (an ADR-implied addition)
   - **Invariant:** "this worker does not have this repo" is a loud, coded failure, never an opaque crash.
   - **Assertion:** the worker execution path checks repo availability (via `global_node_workspaces` +
     `mesh.repo.published`) BEFORE creating a worktree, and on a miss emits a coded
     `assignment-repo-unavailable` `failed` up the channel; grep asserts the guard precedes the
     `git worktree add` call site and the coded literal is emitted on the miss branch. Behavioural: an
     assignment for an absent repo streams `failed` with that code, no worktree created. Self-check: a planted
     worktree-create-before-guard ordering fails.
   - **Turns green in:** Story 02 (worker-side guard). The control-side assign-time gate half is Story 00.

8. **`acd-assignment-worktree-path-scoped`** — *guards ADR-004.* (an ADR-implied addition)
   - **Invariant:** every worktree materialization joins the ONE defined mesh-worktrees root, keyed by
     `assignmentId` — no ad-hoc temp path.
   - **Assertion:** grep the worker execution module: every `git worktree add` target is built from a single
     worktree-path seam (a `meshWorktreePath(assignmentId)`-style helper joining
     `.aof/mesh/worktrees/<assignmentId>`), never a bare `os.tmpdir()` join or a hand-built path; the path
     seam references `assignmentId`. Self-check: a planted `git worktree add` off an `os.tmpdir()` path fails.
   - **Turns green in:** Story 02.

9. **`acd-assignment-arbitration-store-not-git`** — *guards ADR-003.* (an ADR-implied addition)
   - **Invariant:** single-runner arbitration is the store uniqueness check, not a git/lease read.
   - **Assertion:** the assign write path enforces "at most one ACTIVE assignment per `(workspaceId, itemRef)`"
     by querying `global_assignments` for an active row (`state IN (assigned, accepted, running)`) and refusing
     (`assignment-already-active`) — grep asserts the uniqueness query/refusal exists and that the arbitration
     path imports NO mesh-lease/issuance/sync module and reads no git state for the ACTIVE decision.
     Behavioural: a second assign on an item with an active assignment is refused, minting nothing. Self-check:
     a planted second-assign that succeeds while one is active fails.
   - **Turns green in:** Story 00.

10. **`acd-assignment-reclaim-dual-staleness`** — *guards ADR-005.* (an ADR-implied addition, mining
    `fleet-orphan-reclaim` semantics)
    - **Invariant:** an assignment is reclaimed ONLY under DUAL staleness (presence stale AND run-heartbeat
      stale), strict `>`; fresh presence and no-presence-record are hands-off.
    - **Assertion:** the reclaim decision ANDs `isNodeStale` (presence, IMPORTED from `mesh-presence`) with
      `isStale` (run heartbeat, IMPORTED from `run-store`) — grep asserts both predicates are imported (not
      re-derived) and the reclaim guard is a conjunction; a behavioural decision-table companion asserts the
      key rows (stale+stale ⇒ reclaim; fresh presence + stale heartbeat ⇒ hands-off; no presence record ⇒
      hands-off; exactly-AT presence threshold ⇒ still live). Self-check: a planted single-predicate (heartbeat
      only) reclaim, or a missing-presence-as-stale flip, fails.
    - **Turns green in:** Story 02.

11. **`acd-mesh-ui-read-only`** — *guards ADR-007-of-this-milestone (re-arms the m34 posture over the new
    status shape).*
    - **Invariant:** the mesh UI serve face exposes NO assignment write route — assign is CLI-only.
    - **Assertion:** over `mesh-ui-serve.mjs`, assert every non-GET/HEAD method on every route is a 405
      (`sendMethodNotAllowed`), the `upgrade` handler destroys the socket, and NO route matches
      `/api/mesh/assign`/`/api/mesh/issue` with a mutating handler; the extended status shape (story 03) added
      no write branch. Self-check: a planted `POST /api/mesh/assign` handler fails.
    - **Turns green in:** Story 03 (and re-arms the existing m34 read-only guarantee — enumerate the existing
      m34 UI read-only test's re-arm, as `acd-fleet-reclaim-guarded` enumerates its siblings).

12. **`acd-assignment-run-store-mesh-blind`** — *guards ADR-004.* (an ADR-implied addition)
    - **Invariant:** the run-store stays mesh-blind — the assignment execution reuses `startRun`/`completeRun`/
      `heartbeat` with the node id passed as DATA; the store imports no mesh/assignment module.
    - **Assertion:** `run-store.mjs` imports no `mesh-*`/`assignment` module (the existing
      `acd-fleet-reclaim-guarded` already asserts `run-store` imports no mesh module — enumerate/re-arm it) and
      the worker execution path calls `startRun(item, { node })` with the node id as an option, never a
      run-store rewrite. Self-check: a planted `import … mesh` in run-store fails.
    - **Turns green in:** Story 02 (re-arms the existing `acd-fleet-reclaim-guarded` store-blindness half).

13. **`acd-control-dispatch-reclaim-driver-wired`** — *guards ADR-008.* (added at as-built review, 2026-07-09
    — closes the dispatch + reclaim wiring gap ADR-002/ADR-005 left implicit)
    - **Invariant:** `startLauncher` wires ONE control-side periodic tick (a sibling of the existing
      `propagationTicker`/`peerPollTicker`, over the SAME injected-ticker seam) that, each tick, calls BOTH
      `dispatchDirective` (for `assigned` rows whose `targetNodeId` is a connected admitted peer in the stream
      server's `directiveTargets` map) AND `reclaimStaleAssignments` (ADR-005). The one-shot `aof mesh assign`
      verb / the CLI path does NOT itself dispatch a directive — the assign verb only writes the store row; the
      launcher tick is the SOLE dispatcher. Dispatch is at-most-once per `assignmentId` per launcher lifetime
      (the launcher's best-effort in-memory set) with the WORKER's `onDirective` dedupe as the authoritative
      guard (a re-dispatch after a control restart is safe because the worker ignores a duplicate directive for
      an assignment it already holds).
    - **Assertion (structural + behavioural):**
      (a) **STRUCTURAL — driver wired.** Over `mesh-launcher.mjs`, assert `startLauncher` starts a control tick
          over the injected-ticker seam (a `.start(...)` sibling of the propagation/peer-poll tickers) whose
          body reaches BOTH a `dispatchDirective(...)` call (via the stream server handle) AND a
          `reclaimStaleAssignments(...)` call. Assert the tick is role-gated to `control` and options-gated
          (an injected/absent ticker leaves pre-existing launcher behaviour byte-identical).
      (b) **STRUCTURAL — assign verb does NOT dispatch.** Over `commands/mesh-assign.mjs`, assert `assignWork`
          calls NO `dispatchDirective`/`sendDirective`/`buildDirectiveFrame` — the assign core is a pure
          store-writer (its only mesh-channel coupling is `insertAssignment`); dispatch lives ONLY in the
          launcher tick.
      (c) **BEHAVIOURAL — one tick dispatches a connected-peer `assigned` row exactly once and reclaims a
          dual-stale row.** Over the launcher's injected control ticker + an injected/fake stream-server handle
          (recording `dispatchDirective` calls) + a seeded store: an `assigned` row for a CONNECTED target is
          dispatched on the tick (one `buildDirectiveFrame` for that `assignmentId`); a SECOND tick (row still
          `assigned`, uplink not yet applied) does NOT re-dispatch it (the in-memory once-set); a row whose
          target is NOT connected is left `assigned`, no directive emitted; and a seeded dual-stale assignment
          is `reclaimed` by the same tick's `reclaimStaleAssignments` call.
      **Self-check (m03 non-vacuous):** (i) a planted `startLauncher` whose control tick calls
      `reclaimStaleAssignments` but NOT `dispatchDirective` (or vice-versa) trips the "calls BOTH" structural
      detector; (ii) a planted `assignWork` that itself calls `dispatchDirective` trips the "assign verb does
      not dispatch" detector; (iii) a planted driver that re-dispatches the same `assignmentId` on every tick
      (no once-guard) trips the behavioural "exactly once" assertion.
    - **Turns green in:** the ADR-008 driver task (the launcher-side dispatch/reclaim tick) — a fast-follow on
      Story 01 (`dispatchDirective`) + Story 02 (`reclaimStaleAssignments`), both of which supply the seams the
      tick calls.

---

## Story breakdown rationale

The partition (drawn from the graph coupling, refined here) follows the REAL edges: each story owns a
contiguous slice of the actual call/dependency graph, and cross-story dependencies follow the direction data
flows (record → channel → execution; record → UI). No boundary cuts a file from its importers.

- **Story 00 — Assignment record + assign/withdraw verb + repo-availability gate (FOUNDATION).**
  Owns the NEW `global_assignments` table (v3), the frozen assignment record + named-producer enum (ADR-001),
  the store uniqueness invariant (ADR-003), and the `aof mesh assign <ref> --to <nodeId>` / `--withdraw` verb
  with the control-side repo-availability gate. **Why the boundary follows the coupling:** `global-work-store`
  is THE HUB (← 7 dependents) — the schema change and the new writers must land here first, atomically, or
  seven modules are reasoning over a half-migrated store. The assign verb is a new CLI command (a sibling of
  `mesh repo publish`) with no inbound edges yet, so it is safely additive. This is the data-contract floor
  everything else builds on. **Depends:** nothing (foundational). **Turns green:** fitness 1, 2, 3, 4, 6
  (control half), 9.

- **Story 01 — Control→worker command channel (TRANSPORT ONLY).**
  Extends the m34 WS: the server-side `nodeId → ws` targeting map + the `directive` down-frame, the worker-side
  receive listener + a `sendAssignmentStatus` emitter, and control-side ingest of `assignment-status` frames →
  ADR-001's store writers. **Why the boundary follows the coupling:** `control-stream-server ← 1` (only the
  launcher) and `worker-stream-client ← 1` (only the launcher) — both are wired at exactly ONE site, so the
  targeting map and the receive listener are added without touching any other importer. The channel is a THIN
  seam: it hands a PARSED directive to a handler seam and accepts a status frame; it does NOT execute work
  (that is Story 02). Keeping transport separate from execution follows the real edge — the stream modules
  import no run/worktree machinery. **Depends:** Story 00 (the `assignment-status` ingest writes the ADR-001
  record; the directive carries the `assignmentId` Story 00 minted). **Turns green:** fitness 5, 6
  (channel half).

- **Story 02 — Isolated worker execution: git worktree + run lifecycle (the headline).**
  On an accepted directive: the worker-local repo guard, the dedicated git worktree keyed by `assignmentId`,
  the node-partitioned run mint/heartbeat/complete through the EXISTING run-store, the accepted→running→
  done|failed emission up the channel, worktree cleanup/retention, and the dual-staleness reclaim path.
  **Why the boundary follows the coupling:** `run-store ← 6, → fs only` — it is cleanly isolated from every
  mesh module, so execution REUSES it (node id as data) without a store rewrite, keeping it mesh-blind. The
  worktree machinery is entirely new (no `src/` worktree usage today), so it is a self-contained new module the
  worker calls — it does not cut through any existing importer. The reclaim path reuses the two shared
  staleness predicates (`isNodeStale` from `mesh-presence`, `isStale` from `run-store`), both already imported
  seams. **Depends:** Story 00 (the record it advances) + Story 01 (the channel seam it emits over — it
  consumes the parsed directive Story 01 hands to a handler). **Turns green:** fitness 7 (worker half), 8, 10,
  12.

- **Story 03 — Assignment lifecycle in the fleet UI (READ-ONLY render).**
  Extends the `GET /api/mesh/status` shape (via `global-mesh-query`) and renders assignments advancing
  `assigned → accepted → running → done|failed` in the read-only React fleet, mirroring the existing run-state
  chip ramp (colour + label always travel together). **Why the boundary follows the coupling:** `mesh-ui-serve
  ← 1` (cli), `→ global-mesh-query` — it reads the store ONLY through the query composition seam and never
  opens the store or writes. Extending the READ shape and the SPA render touches only the UI slice; it adds no
  write route (the m34 read-only posture is preserved). This story is INDEPENDENT of Stories 01/02 — it reads
  whatever assignment rows exist in the store, so it can be built and tested against Story 00's rows alone,
  in parallel with 01/02. **Depends:** Story 00 (the store rows it renders) — NOT 01 or 02. **Turns green:**
  fitness 11.

**Dependency edges (the partition's spine):** `00` is foundational; `01 → 00`; `02 → 00, 01`; `03 → 00`
(independent of 01/02). The only serial chain is the transport/execution spine (00 → 01 → 02); the UI (03)
forks off 00 and runs parallel to it — the maximal parallelism the coupling permits.

**Conscious departures from the drawn partition — none.** The partition as drawn from the graph holds: no
boundary cuts a file from its importers, and each depends-edge follows the actual data-flow direction. Two
grounding notes recorded rather than departures: (a) the graph's phantom `mesh-issue.mjs → publisher` edge is
a history leftover, not a live import — the source tree is already git-bus-clean (verified by grep), and
`acd-no-git-bus-return` keeps it so; (b) the runtime-invocation DEPTH inside the worktree (Story 02) is a
documented default the separate researcher + the Three Amigos feasibility pin at build — this milestone fixes
the worktree + run-lifecycle BRACKETING (ADR-004), which is invariant to whichever driver is chosen.

---

## Memory near-misses honored (surfaced from prior milestones)

- **R2 (m20) — a frozen+classified state-carrying key with no named writer is a contract hole.** Closed by
  ADR-001: every assignment lifecycle state names its SOLE producer in a single source-of-truth enum, and
  `acd-assignment-state-has-producer` fails CI if any state lacks a writer.
- **34/ADR-007 — workers hold ONE persistent live WS stream to the control node.** ADR-002 extends exactly
  that stream (no second socket) with the anticipated control→worker command channel; the targeting map is the
  only structural addition.
- **34/ADR-008 — a degraded state MUST emit an operator-visible signal; silence is the defect.** Honored in
  two places: ADR-002's "target not connected" surfaces a loud coded refusal
  (`acd-assignment-target-not-connected-loud`), and ADR-004's "worker does not have this repo" surfaces a loud
  coded failure (`acd-assignment-repo-availability-loud`) — neither ever fails opaquely.
