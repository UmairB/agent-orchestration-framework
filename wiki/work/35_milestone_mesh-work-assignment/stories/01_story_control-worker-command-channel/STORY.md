---
type: story
number: 01
slug: control-worker-command-channel
title: "Control→worker command channel — the milestone-34 WebSocket carries a targeted directive down to one worker and an assignment-status frame back up, admitted-peer-only"
parent: 35
status: done
owner: product-owner
created: 2026-07-08
updated: 2026-07-09
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH / SECURITY.
-->
# 01 · Control→worker command channel — the dispatch direction, over the one stream

## User story

As a **control-node operator**, I want the assignment I minted to travel down the *same* persistent
WebSocket my worker already holds — targeted to exactly that one worker, never broadcast — and the
worker's progress to travel back up the same socket, so that dispatch rides one connection (no second
socket, no git-bus), reaches only the node I named, and lands each lifecycle transition in the store the
moment the worker reports it.

<!-- The TRANSPORT story. It makes 34/ADR-007's anticipated control→worker channel real: a nodeId→ws
     targeting map on the server, a `directive` down-frame, a worker-side receive listener, and an
     `assignment-status` up-frame the control node write-throughs into ADR-001's record. It is a THIN seam:
     it delivers a PARSED directive to a handler seam (story 02 implements the handler) and persists a
     status frame. It does NOT run work. Admission is the trust boundary the whole channel rests on. -->

## Tasks

<!-- Contract authored `2026-07-08` via `aof:refine 35 --autonomous` (Three Amigos: PO headline + aof-qa
     Examples + aof-developer feasibility). `@executable` over the INJECTED transport + injected
     peer-identity + injected clock (the 34/story-04 fixtured precedent — no live network); the real
     two-machine soak is milestone-level (story 02's `@manual`). Structural invariants → arch-tests. -->

- [x] [`tasks/00_directive-down-frame.feature`](tasks/00_directive-down-frame.feature) — `@executable` — the
  `directive` frame `{ kind, to, assignmentId, itemRef, workspaceId, at }`; the server-side `nodeId → ws`
  targeting map (populated in `wss.on("connection")`, cleared on close/error); `sendDirective(nodeId, …)`
  resolves EXACTLY one socket and writes to it — no fan-out; a target with no live socket surfaces a loud
  coded `assignment-target-not-connected` (ADR-002, 34/ADR-008).
- [x] [`tasks/01_directive-admission.feature`](tasks/01_directive-admission.feature) — `@executable` — a
  directive is honored ONLY over an admitted, live tailnet-peer connection (`isTailnetPeer`, 33/ADR-002); a
  directive frame from a non-peer connection is rejected (SECURITY T5); a directive whose issuer is in the
  registry `revocations` NEVER routes/executes (SECURITY T2 — the retired `revoked-issuer-filtered`
  invariant carried onto the WS transport).
- [x] [`tasks/02_assignment-status-uplink.feature`](tasks/02_assignment-status-uplink.feature) —
  `@executable` — the worker→control `assignment-status` frame `{ kind, nodeId, assignmentId, state, runId?, at }`;
  the control server ingests it and write-throughs the `accepted/running/done/failed` transition into
  ADR-001's dedicated writer — authored from the CONNECTION's authenticated `nodeId` (a node advances only
  its own assignment; `frame.nodeId` never overrides the connection identity, SECURITY T6); an unknown kind
  stays a no-op (never-crash).
- [x] [`tasks/03_control-dispatch-driver.feature`](tasks/03_control-dispatch-driver.feature) — `@executable` —
  the control-node launcher's periodic tick dispatches each `assigned` row whose target is a connected peer down
  the directive channel (the missing `dispatchDirective` call site — B1), exactly once (dispatch-once guard); the
  assign verb only mints, the driver dispatches (ADR-008). Added at Review to close the dispatch-plane gap.

## Fitness units (proposed)

Inherited from [ARCHITECTURE.md](../../ARCHITECTURE.md) and [SECURITY.md](../../SECURITY.md) — this story arms:

- `acd-directive-targets-one-peer` (ADR-002) — a node-targeted directive resolves ONE socket from the
  targeting map; no `wss.clients` / send-to-all fan-out branch exists.
- `acd-assignment-target-not-connected-loud` (ADR-002/34-ADR-008) — channel half: the "no live socket" miss
  emits a coded refusal, never a silent drop.
- `acd-directive-only-from-admitted-peer` (SECURITY T5) — a directive from a non-tailnet-peer connection is
  rejected.
- `acd-revoked-issuer-directive-never-executes` (SECURITY T2) — a directive from a revoked issuer never
  routes.
- `acd-assignment-status-authored-by-holder` (SECURITY T6) — the control writes an assignment's lifecycle
  only from the connection whose nodeId holds it (the `ownerNode ?? frameNode` precedence, control-stream-server.mjs:120-124).

## Notes

Inherits **ADR-002** (the targeted directive channel over the ONE m34 WS — never broadcast, never a second
socket, never git-bus) and the up-half of **ADR-001** (the `assignment-status` write-through path). Extends
the milestone-34 transport (`control-stream-server.mjs` server, `worker-stream-client.mjs` client): the
server gains the targeting map + `sendDirective`; the send-only worker client gains its FIRST receive
listener (its transport seam has `connect/send/close/onDrop` but no `onMessage` today — this story adds it).

**Depends:** Story 00 — the `assignment-status` ingest writes Story 00's record; the directive carries the
`assignmentId` Story 00 minted. Independent of stories 02/03 (it hands a parsed directive to a handler seam;
it does not run work or render UI).

**The channel seam it exposes to Story 02:** on receiving a `directive`, the worker client parses it and
invokes a handler callback (the execution seam); it also exposes a `sendAssignmentStatus(...)` emitter Story
02 calls to stream `accepted → running → done|failed` back up. This story delivers/accepts frames; Story 02
acts on them.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: all three tasks stay `@executable`** over the injected transport + injected peer-identity +
injected clock (the 34/story-04 fixtured precedent). No retag.

- **The `nodeId → ws` map + `sendDirective` are net-new prod code, small, wired at the ONE site.** The server
  holds each `ws` only in the `wss.on("connection")` closure and its liveness `registry`
  (`createStreamRegistry`, `control-stream-server.mjs:183-205`) has NO ws map today — add the `Map`
  populated/cleared in the existing `connection`/`close`/`error` handlers (`:306-335`, the sole wiring site,
  `control-stream-server ← 1` launcher).
- **The worker client's FIRST receive listener is a clean additive sibling to `onDrop`.** The transport seam
  is `{ connect, send, close, onDrop }` (`worker-stream-client.mjs:239-286`) with no `onMessage` anywhere;
  wire `ws.on("message", …)` in `connect()` and expose `onMessage(handler)` mirroring `onDrop` (`:282-284`)
  — zero behaviour change for a caller that never registers it.
- **The up-frame slots into the existing kind-ladder.** `applyStreamFrame`'s dispatch (`:139-147`, ending in
  the `unknown-frame-kind` no-op) is the exact site for `if (frame?.kind === "assignment-status")`; clone the
  `ownerNode ?? frameNode` connection-nodeId-wins precedence (`:120-124`) for T6. `isRevoked` is a plain
  array `.some()` (`mesh-registry.mjs:256-260`), cheap to fixture.
- **HARD build-order `01 → 00`:** task 02's `assignment-status` ingest write-throughs Story 00's
  `updateAssignmentState` writer — untestable without it. Tasks 00/01 carry `assignmentId` as an opaque
  string so *could* start concurrently with 00, but treat the story as gated on 00 per the spine (task 02 is
  the story's raison d'être).
- **Net-new infra to BUDGET — the milestone's biggest harness piece:** the persistent **bidirectional** fake
  channel — an ordered PER-SOCKET frame recorder (so "worker-a got exactly one frame, worker-b got none" is
  assertable) + a down-channel delivery path into `onMessage` + a scriptable mid-stream drop — extending the
  34/story-04 one-way fake. Shared across all three features.
