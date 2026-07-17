---
type: story
number: 04
slug: worker-state-push
title: "Worker live-state stream to control node — a worker holds a persistent WebSocket to the control node and streams work-state so the machine-wide view is real-time"
parent: 34
status: done
owner: product-owner
created: 2026-07-05
updated: 2026-07-05
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 04 · Worker live-state stream to control node — the control node is always current

## User story

As a control-node operator, I want each **worker** node to hold a live connection to my control node and
stream its work-state as it happens, so that `aof mesh ui` on the control node shows every worker's progress
**in real time** — not eventually, and without me pulling a git clone of each worker's bus by hand.

<!-- The cross-machine, real-time complement to stories 01/02 (which are intra-machine + eventual). Closes
     the gap found at 33/verify (a worker writes only to its own store; nothing carried its progress to the
     control node) with a LIVE STREAM rather than eventual git convergence. Inherits ADR-007 — including its
     honest reckoning: this reinstates a persistent-connection server on the control node, the class of
     machinery 33/ADR-002 eliminated. Deliberate, operator-chosen, for real-time visibility. canonical local work records remain truth; the stream is the only cross-machine sync path. -->

## Tasks

<!-- Contract authored `2026-07-05` via `aof:refine 34/04` (Three Amigos, PO/QA inline + an aof-developer
     feasibility pass). Four `@executable` units over injected transports/tickers (the 33 fixtured precedent)
     + one `@manual` real-two-machine soak (the connection lifecycle only manifests across two live machines,
     ADR-007). Fitness units below are arch-tests (structural → never a behaviour feature). -->

- [x] [`tasks/00_worker-role-and-control-address.feature`](tasks/00_worker-role-and-control-address.feature)
  — `@executable` — mesh role (worker/control/standalone) from config + resolving the control node's fabric
  dial address, with a clean stream retry state when the control node is not on the fabric.
- [x] [`tasks/01_worker-stream-client.feature`](tasks/01_worker-stream-client.feature) — `@executable` — the
  persistent client: snapshot-first-then-deltas frame order, reconnect with growing/capped backoff, and
  failure-isolation (a stream fault never blocks/rolls back a local work write).
- [x] [`tasks/02_control-node-stream-server.feature`](tasks/02_control-node-stream-server.feature) —
  `@executable` — the always-on server: tailnet-only admission, apply snapshot+deltas into the global store,
  redaction before store, and per-worker stream liveness (live/stale/disconnected).
- [x] [`tasks/03_reconnect-and-freshness.feature`](tasks/03_reconnect-and-freshness.feature) —
  `@executable` — stream retry, reconnect-snapshot reconciliation, and the
  live/stale/never-connected freshness labelling.
- [ ] [`tasks/04_live-stream-two-machine-soak.feature`](tasks/04_live-stream-two-machine-soak.feature) —
  `@manual` — the real worker(macOS)→control(Windows) live stream over Tailscale: UI updates in real time,
  survives a severed connection + reconciles, and marks a stopped worker stale (latencies recorded).
  **Deferred human gate** — validated at `aof:verify` (the live per-mutation delta feed + two-machine run
  are the only parts not covered by the `@executable` 00–03 lanes; see STATE Feedback).

## Fitness units (proposed)

- `acd-worker-stream-single-predicate` — the worker/control-node role test uses the ONE shared mesh-role
  predicate; no command privately re-derives it from `config.mesh`.
- `acd-worker-stream-fabric-addressed` — the stream target is resolved via `mesh-fabric`, never a
  committed/hand-derived URL — preserving 33's "addresses come from the fabric" invariant.
- `acd-worker-stream-non-blocking` — a stream outage/failure never changes the local work command's
  result/error semantics (ADR-004 failure isolation, extended to the live stream).
- `acd-control-stream-tailnet-only` — the control-node stream server admits only tailnet peers and applies
  redaction (ADR-005) before any streamed field enters the global store.

## Notes

Inherits [ARCHITECTURE.md](../../ARCHITECTURE.md) **ADR-007** (the live-stream decision, the connection
lifecycle, and the honest reckoning that it reinstates the persistent-connection server 33 eliminated — with
the required amendment to 33/ADR-002). Reuses the 33 fabric seam (`mesh-fabric`) for address resolution and
the 33 launcher (`mesh serve`) as the server host — now an **always-on** daemon on the control node. Depends
conceptually on story 00 (global store paths) and story 01 (the shared publisher/redaction path) — the stream
carries the SAME snapshot/deltas the local publisher produces, applied to the remote store through the same
redaction.

**Carry to 33:** when this story lands, add a supersession/amendment note to 33/ADR-002 so "the broker is
eliminated" reads honestly as "eliminated for presence; a work-state stream server is reintroduced in 34."

**Open at refine** (ADR-007 open questions): WebSocket vs SSE; server on `mesh serve` vs a dedicated daemon;
the delta schema + snapshot-reconcile-on-reconnect contract; how much of 33's deleted broker code is
re-implemented vs. resurrected; and the live/stale/never-connected UI treatment. Given 33/F-3302, budget
explicitly for testing the connection lifecycle across two real machines — not just fixtures.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Verdict: all 5 tasks stay as tagged** — tasks 00–03 confirmed genuinely `@executable` against the real
tree (every seam present, socket-free + wall-clock-free), task 04 confirmed irreducibly `@manual`. No retag.
Two build-order/infrastructure flags to carry into build (neither is a blocker):

- **Flag (task 01) — the persistent fake channel is NET-NEW test infrastructure.** The injected-client
  *pattern* is precedented (`mesh-relay-client.mjs:107-214` `createRelayClient`), but that fake is **one-shot**
  (connect → send one frame → dispose, `pushPresenceSignal:67-93` "holds no long-lived socket"). The worker
  stream client needs a **persistent, multi-frame, reconnecting** channel, so a new test double is required —
  an ordered frame recorder + a scriptable mid-stream drop/throw. Buildable (strictly simpler than the real
  thing), but budget for it (exactly the ADR-007 "testability cost"). The backoff ticker follows the launcher's injected ticker shape (no wall-clock); the backoff schedule is a pure `attempt → delay` function. `ws@8` is present (`package.json:38`)
  and already the production ws transport (`mesh-relay-client.mjs:27`).
- **Flag (task 02) — a HARD build-order dependency on stories 34/00–02.** Task 02 applies streamed frames
  "through the SAME publisher + redaction path (ADR-004/ADR-005)" — that global-store publisher + redaction do
  **not exist in `src/` yet** (only `mesh-store.mjs`'s unrelated per-node git record). So **story 04 build must
  follow 34/00–02**, or task 02 needs an interim publisher interface/fake. Also: the tailnet admission is **new
  logic** (peer-on-tailnet via the fabric, NOT `serveRelay`'s credential/roster gate) — but `serveRelay`'s
  injected-predicate shape (`mesh-relay.mjs:307-313`, `isGroupConnection`) is the exact pattern to copy for
  injecting the admission predicate.
- **Note — a concrete server shape + a SECOND test path exist.** `serveRelay` (`mesh-relay.mjs:309-499`) is a
  live, tested `http.createServer` + `WebSocketServer` accept loop (still wired by the m24 enrollment/invite/
  revoke commands — "parked" for the *liveness* path per 33, not deleted). It is a concrete shape to **adapt**
  (re-implement against the redacting publisher, ADR-007 open Q4). And its test suites
  (`test/mesh-relay-auth-gate.test.mjs`, `mesh-relay-broker-fanout.test.mjs`) drive **real in-process ws
  sockets over ephemeral `port:0`** — a legitimate second `@executable` path alongside the fake channel, if the
  fake proves awkward for the bidirectional multi-frame stream. Both routes are socket-free of a *real network*
  and wall-clock-free.

**Sequencing:** build 04 AFTER 34/00 (store paths) + 34/01 (publisher) + 34/02 (redaction/registry) — the
stream is the delivery mechanism for the SAME snapshot those stories produce.
