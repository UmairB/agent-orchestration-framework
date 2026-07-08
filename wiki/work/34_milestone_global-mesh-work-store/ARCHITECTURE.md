---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 34 · Global Mesh Work Store — Architecture Decisions

> Inputs: `SPEC.md` (machine-wide mesh work visibility for the control node; global propagation only when
> mesh support is enabled; node details in the global AOF folder; `aof mesh ui` global by default and
> `--local` scoped to the current workspace), the current mesh substrate from milestones 22, 25, 26, 27,
> and the fabric-native redesign in milestone 33.
>
> Prior-lesson recall surfaced the global-store precedent from milestone 12: global state must derive from
> `defaultGlobalWorkspaceDir` / `AOF_GLOBAL_HOME`; the default is now the user-global `.aof` folder (`~/.aof`) rather than platform data directories. This milestone
> applies that precedent directly.
>
> Codebase graph grounding: `aof graph build src` completed at refine time with **1301 nodes / 3515 edges,
> egress none**. `aof graph impact` reported:
> - `src/mesh-ui-serve.mjs` has one dependent (`src/cli.mjs`) and imports `asset-base.mjs`,
>   `command-core.mjs`, and `work.mjs`. The UI default can change at the serve face without cutting through
>   the whole work engine, as long as data still enters through a narrow query surface.
> - `src/workspace.mjs` has 16 dependents and already owns `globalWorkspacePaths()`. Global mesh path
>   geometry belongs here or beside it, not in individual commands.
> - `src/work.mjs` has 19 dependents and owns work-stream reads plus `loadWorkspace`. Work propagation must
>   use a shared projection writer, not one-off writes spread across command modules.
> - `src/commands/mesh-identity.mjs`, `src/mesh-store.mjs`, and `src/global-node-registry.mjs` already depend on mesh/node/run state.
>   Node/workspace registry updates should reuse those data seams, not introduce a second identity model.

---

## ADR-001: Global mesh state lives under the global AOF workspace home; path geometry is derived from `globalWorkspacePaths()`, never hard-coded

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The requirement is machine-wide state: every mesh-enabled workspace on the control node should
contribute to one global work plane. AOF already has a global workspace home through `globalWorkspacePaths()`
and `defaultGlobalWorkspaceDir()`, with `AOF_GLOBAL_HOME` relocation support. Milestone 12 made store-first
global tooling depend on that seam.

**Decision.**
- The global mesh root is `<globalWorkspacePaths().workspaceDir>/mesh`. `AOF_GLOBAL_HOME` overrides it; otherwise the default global home is `~/.aof` on every supported OS.
- The work projection lives under `<global>/mesh/work/`.
- Node/workspace descriptors live under `<global>/mesh/nodes/` and `<global>/mesh/workspaces/`.
- No module may derive this with `os.homedir()` or a literal `~/.aof`; all paths route through a single
  global mesh path helper.

**Consequences.**
- Tests can relocate the whole global mesh store with `AOF_GLOBAL_HOME`, matching the existing global asset
  and managed-tool store precedent.
- The global store is machine-wide for the current user account, not repository-local and not system-wide
  across users.

---

## ADR-002: Mesh enablement is explicit; global propagation is gated and non-mesh workspaces remain local-only

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The current repository can contain `mesh: {}` without being a working mesh participant. Using
"mesh object exists" as the propagation gate would silently globalize ordinary workspaces.

**Decision.**
- Introduce an explicit enablement predicate: a workspace is mesh-enabled when `config.mesh.enabled === true`.
- For back-compat during the transition, a workspace with a configured fabric (`config.mesh.fabric`) or a
  hydrated `config.mesh.nodeId` may be treated as mesh-capable by doctor/migration guidance, but the global
  propagation writer uses the explicit predicate.
- Non-mesh work commands keep today's local-only behaviour and do not create global mesh store files.

**Consequences.**
- Operators opt into machine-wide visibility deliberately.
- Empty `mesh: {}` remains inert.
- `work doctor` should warn when a workspace appears mesh-configured but has not opted into global
  propagation, so migration is visible rather than surprising.

---

## ADR-003: The global work store is a rebuildable SQLite projection, not the canonical source of truth

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The canonical authored work records already live in each workspace's `work.dir`. A global store
must support cross-workspace query and UI speed, but it must not become a second editable work stream that can
drift from the record docs. The user proposed SQLite; the codebase currently has no SQLite npm dependency.

**Decision.**
- The global store is a projection. Canonical records remain the workspace `wiki/work` item docs plus mesh
  run records.
- The projection engine may use SQLite only through a runtime-provided SQLite implementation or another
  no-new-dependency path. This milestone must not add a native SQLite package just to create the store.
- If SQLite is unavailable in the packaged runtime, the projection layer refuses with a structured,
  actionable error rather than falling back silently to a different authority model.
- The store has a schema version table and a rebuild path that can delete/recreate derived rows from a
  workspace snapshot.

**Consequences.**
- Corruption recovery is simple: rebuild the projection from registered workspaces.
- Concurrency is handled at the projection boundary, not by editing canonical docs through SQLite.
- The implementation must include migration/rebuild tests, not just happy-path query tests.

---

## ADR-004: Propagation is snapshot-based and idempotent; work writers call one shared publisher

**Status:** Accepted
**Date:** 2026-07-04

**Context.** Work changes can originate through `aof work` commands, run lifecycle commands, feedback append,
or direct file edits later observed by a launcher/sync loop. A hook per command would drift quickly.

**Decision.**
- Add one projection publisher that takes a loaded workspace and writes an idempotent snapshot for that
  workspace into the global store.
- Commands that already mutate work/run/mesh records call the publisher after a successful mutation when
  the workspace is mesh-enabled.
- The mesh launcher/sync loop may also call the publisher periodically so direct record-doc edits converge
  without requiring every write path to be perfect on day one.

**Consequences.**
- Propagation is at-least-once and idempotent, not event-sourced.
- Failed global projection writes must not corrupt the local work command result; they surface as warnings
  or doctor findings, because canonical local writes already succeeded.

---

## ADR-005: Node details are persisted as global descriptors, with SQLite as index and JSON as operator-readable outline

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The user explicitly asked for control and worker node details to be outlined in the global AOF
folder. A pure SQLite file would be queryable but not inspectable.

**Decision.**
- Store the query index in SQLite.
- Also materialize operator-readable JSON descriptors under `<global>/mesh/nodes/<nodeId>.json` and
  `<global>/mesh/workspaces/<workspaceId>.json`.
- Node descriptors include node id, role hints, hostname, fabric address when known, last seen, capabilities,
  and workspace membership. Sensitive credentials are never copied into the global descriptor.

**Consequences.**
- Operators can inspect global mesh state without a special database browser.
- The JSON descriptors are derived artifacts; the SQLite projection remains the query surface.

---

## ADR-006: `aof mesh ui` reads the global projection by default; `--local` is an explicit workspace filter

**Status:** Accepted
**Date:** 2026-07-04

**Context.** The current `mesh-ui-serve.mjs` loads the current workspace and invokes `mesh:status`. The new
operator question is machine-wide: "what work exists across this control node?"

**Decision.**
- `aof mesh ui` serves global mode by default and queries the global projection.
- `aof mesh ui --local` keeps the existing focused workflow by applying a current-workspace filter.
- The serve face stays a thin UI/API layer. It must not import low-level work/run/mesh writers; it talks to
  a query surface.

**Consequences.**
- The CLI parsing change is intentionally user-visible.
- Existing local diagnostics remain available through `--local`.
- UI tests must assert both the default global scope and the local filter.

---

## ADR-007: Workers hold a persistent live stream to the control node for real-time work-state (this REINSTATES a persistent-connection server 33 eliminated — deliberately)

**Status:** Accepted
**Date:** 2026-07-05

**Context.** ADR-001..006 make the global store *machine-local*: each workspace publishes a snapshot into
*its own* machine's global store. That leaves a real gap (found at 33/verify): a **worker** node writes to
*its own* global store, which the control node never sees. As specified before this correction, remote worker progress could be left stranded in the worker's own global store. There is no per-workspace git bus fallback in the corrected design. The operator's requirement is stronger than eventual convergence: **the
control node must hold up-to-date, real-time work-state for every worker** — a live view, not a periodically
reconciled one. The chosen model is a **live stream**.

**Decision.**
- A node is a **worker** when `config.mesh.relay.controlNode` is set and ≠ this node's id (the inverse of the
  control-node predicate the 33 launcher probe already computes). Reuse that one predicate.
- A worker **opens and holds a persistent connection (WebSocket) to the control node** and **streams
  work-state updates as they happen**, so the control-node global store is continuously current. The
  control-node dial address is resolved via the 33 fabric seam (`mesh-fabric` `resolvePeers` → the peer whose
  `nodeId === controlNode` → its `dialAddress`) — never a hand-derived URL.
- The **control node runs a continuously-running WebSocket server** (part of its launcher / `mesh serve`
  daemon) that accepts worker connections and applies streamed updates into the global store through the SAME
  publisher + redaction path (ADR-004/ADR-005). It is up whenever the machine is acting as a control node,
  independent of whether anyone has `aof mesh ui` open.
- **Connection lifecycle (self-healing):** on connect and every reconnect the worker sends a **full snapshot
  first, then deltas**; the worker **reconnects with backoff** on drop and **heartbeats** so the control node
  can mark a worker's stream live/stale. A dropped stream never corrupts local truth; the control projection stays stale until the reconnect snapshot lands.
- Admission: accept a connection only from a **tailnet peer** (the fabric IS the admission boundary,
  33/ADR-002 — no device-code, no token). Redact secrets before anything enters the store (ADR-005).
- **Sync path:** WebSockets are the cross-machine mesh sync path. If the stream is down, local canonical work records remain correct, the control-node projection is visibly stale, and convergence happens when the worker reconnects and sends a fresh snapshot.

**Consequences — the honest reckoning (this is a big reversal, read it).**
- This **reinstates a continuously-running persistent-connection server on the control node** — precisely the
  CLASS of machinery **33/ADR-002 eliminated** (the ws@8 broker + `mesh-presence-subscriber` +
  `mesh-presence-cache` + the connection/auth lifecycle, all *deleted* in 33). It differs in PURPOSE (a
  work-state ingest stream, not a presence fan-out) and DIRECTION (workers → control, not control →
  subscribers), but it is the same shape: a long-lived socket server + clients + reconnect/heartbeat. **33's
  headline ("the fabric replaces the broker") now holds only for PRESENCE/liveness; real-time WORK-STATE gets
  a stream back.** 33/ADR-002 must be **formally amended** (a supersession note in 33's ADR ledger) when this
  lands, so the two milestones do not read as silently contradictory.
- **The answer to "must a server run continually on the control node?" is now YES** — the control node runs an
  always-on WebSocket daemon to be the aggregation point. (Workers run no listener; they are stream clients.)
  This is the opposite of a snapshot model's answer, and it is the cost of real-time.
- **Testability cost (note, given this project's history):** a persistent stream is materially harder to test
  than a one-shot write — connection lifecycle, reconnect, out-of-order/partial deltas, snapshot-vs-delta
  reconciliation, and heartbeat/staleness, much of which only manifests across two live machines. Budget for
  it in refine; do not let it become the next fixtures-hide-the-bug lane (the 33/F-3302 lesson).

**Alternatives considered and rejected (by explicit operator choice).** (a) One-shot snapshot POST per
mutation — near-real-time, no persistent server, rejected: the operator wants a continuous live view. (b) Pure per-workspace git-bus pull — rejected: it reintroduces the per-workspace approach the milestone is removing.

**Open questions for refine.** (1) WebSocket vs. SSE (workers only push, so either fits; WS eases a future
control→worker command channel). (2) Server on the `mesh serve` launcher vs. a dedicated control-node daemon
face. (3) The delta schema + the snapshot-reconcile-on-reconnect contract. (4) How much of 33's deleted broker
code is re-implemented vs. resurrected. (5) UI treatment of a worker whose stream is live vs. stale vs.
never-connected (fabric-visible only).

---

## ADR-008: The control-stream server's EADDRNOTAVAIL loopback fallback stays (never crash the daemon), but a loopback bind is a DEGRADED state that MUST emit an operator-visible signal — silence is the defect, not the fallback

**Status:** Accepted
**Date:** 2026-07-05
**Annotates:** ADR-007 (the always-on control-node stream server's bind posture). Does not supersede it.

**Context.** `listenOrDegradeToLoopback` (`src/control-stream-server.mjs`) binds the fabric-resolved
self-address; on `EADDRNOTAVAIL` specifically (the address is not assigned to a local interface) it retries
ONCE on `127.0.0.1` and resolves. This was added (review fix P1.6(b)) so a transient
tailscale-interface-not-ready race never takes down the control-node launcher. Any other fault (e.g.
`EADDRINUSE`) still rejects; it never binds `0.0.0.0` (ADR-007 / 33-ADR-002 admission-boundary invariant,
fitness `acd-control-stream-address-bound`).

Verify raised a real concern: on a control node whose self-address genuinely will not bind (a persistent
misconfig / stale self-address, not a race), the same fallback leaves the stream reachable ONLY on loopback.
Remote workers — the entire point of ADR-007's real-time cross-machine work-state — then cannot connect;
their streams silently fail against a server that reports itself "up". Local truth remains intact, but cross-machine convergence waits for WebSocket reconnect; ADR-007's real-time promise is silently broken with no operator signal.

**Decision.**
- **Keep the fallback; do NOT convert it to a refusal/crash.** A crash on a stream-only bind fault would
  violate ADR-007's "always-on daemon, independent of anyone watching" and would take the WHOLE launcher
  (presence + global propagation) down over a real-time-only degradation whose local truth is
  intact. The correct failure posture for a currency-carrying, retrying channel is degrade, not
  die.
- **Do NOT require the fallback to distinguish a transient race from a persistent misconfig at bind time.**
  The two are indistinguishable at the instant of the first `EADDRNOTAVAIL` (a race IS a misconfig that has
  not resolved yet), and a retry/settle loop adds lifecycle complexity ADR-007 already flagged as this
  milestone's testability risk. The distinction is observational, not decisional: a race clears on the next
  peer-poll re-bind opportunity; a misconfig persists — and PERSISTENCE is exactly what the signal below
  makes visible.
- **A loopback fallback is a DEGRADED state and MUST be observable.** The server, on taking the loopback
  path, records that it bound loopback-instead-of-`bindAddress` and exposes it on its returned handle (e.g. a
  `degraded: { code: "control-stream-loopback-fallback", requested: <bindAddress>, bound: "127.0.0.1" }`
  field). The launcher (`mesh-launcher.mjs`, the SOLE caller — graph-confirmed: one inbound edge) lifts that
  into its existing `warnings` channel, the SAME first-class array that already carries
  `worker-stream-target-unresolved` and `global-work-propagation-failed` to `mesh serve` / status / the
  global UI diagnostics region. Silence is the defect here — not the fallback.

**Consequences.**
- The real-time-degraded state is loud (a warning/diagnostic) without being fatal — the operator's real-time
  expectation is protected by visibility, not by a launcher-wide outage.
- Reuse of the launcher's existing `warnings` seam means no new surface and no new fan-out; the coupling stays
  exactly what the graph shows (`control-stream-server.mjs ← mesh-launcher.mjs`, one edge).
- A NON-degraded (normal) bind emits nothing, so healthy nodes stay quiet.
- This ADR implies a fitness function: `startControlStreamServer`, when its supplied `bindAddress` is
  non-loopback yet it ends up bound to loopback, MUST surface a machine-readable degraded signal on its
  handle (not merely a comment). To be written under `test/arch` when the follow-up lands.

**Alternatives rejected.** (a) Crash/refuse on a non-transient bind failure — rejected: violates always-on,
punishes a stream-only fault with a whole-daemon outage, and cannot in-band tell "non-transient" from "not yet
resolved". (b) Leave it silent because local truth remains intact — rejected: truth remaining local is necessary but
NOT sufficient; ADR-007's contract is cross-machine currency (real-time), and a silently-broken real-time promise is a
latent operator trap, precisely the fixtures-hide-the-bug / silent-degrade lane this project keeps getting
bitten by.

---

## ADR-009: The per-install node identity is MACHINE-WIDE (global AOF home), initialized once and hydrated into every workspace — amends 33/ADR-004's persist location

**Status:** Accepted
**Date:** 2026-07-05
**Amends:** 33/ADR-004 (per-install identity split). Does not supersede its *reason* (identity must not travel on clone); it moves the *persist location* from the per-workspace sidecar to the global home.

**Context.** This milestone's whole purpose is a machine-wide global work store keyed on `nodeId`. But identity (`nodeId` + `salt`) was persisted **per-workspace** (`.aof/mesh/identity.json` under each project's `aofDir`, 33/ADR-004). A global store keyed on a per-project id is **incoherent**: the same machine can resolve a different `nodeId` in different workspaces, so its work scatters across phantom nodes. This was the milestone's core gap; it was accepted anyway (RETROSPECTIVE R8 / VERIFICATION F-3405) and re-opened by operator order.

**Decision.**
- Identity lives in the **global AOF home**: `globalMeshPaths(...).identityPath` = `<AOF_GLOBAL_HOME>/mesh/identity.json` (ADR-001's `AOF_GLOBAL_HOME`-derived geometry). One identity per machine, **initialized once**.
- `loadWorkspace` **hydrates** `config.mesh.nodeId`/`salt` from the global identity for every workspace on the machine, and exposes it as `ws.identityPath` — the single mint target every minting caller (`mesh:identity`, `mesh:heartbeat`, the launcher) writes through.
- **Precedence:** global identity > legacy per-workspace sidecar (read-only fallback) > committed `config.mesh.nodeId` (back-compat) > hostname-derive (mints to the global home).
- **Back-compat:** a legacy per-workspace sidecar is honored as a read fallback and migrated up by `migrateIdentityToGlobal` (a `work doctor` warn — `mesh-identity-workspace-local` — flags it).

**Consequences.**
- The global work store is now coherent: one `nodeId` per machine across all its workspaces.
- **Strictly more clone-safe than 33/ADR-004** (the F-3203 concern): the global home is *outside any repo*, so a `git clone` can never carry identity at all — the per-workspace git-ignored sidecar was only a half-measure.
- New fitness `acd-global-node-identity-home` guards it structurally (identity resolves from the global home, never a per-workspace `aofDir`) — the check that was missing at the wrong accept.

---

## ADR-010: A repo joins the machine-wide store either implicitly (a work mutation on a mesh-enabled workspace) OR explicitly via `aof mesh repo publish`, which also writes a durable per-repo published marker

**Status:** Accepted
**Date:** 2026-07-08
**Extends:** ADR-002 (the propagation enablement predicate) and ADR-004 (the one shared publisher seam). Does not supersede either.

**Context.** ADR-002/004 make a workspace appear in the global store as a SIDE EFFECT: a work-mutating command (`run start`/`run complete`/`feedback`) or the launcher's converge tick calls the shared publisher when `config.mesh.enabled === true`. Operationally this left a gap the operator hit directly: there was **no verb to say "make this repo visible in the mesh now."** A repo that had never run one of those commands was simply invisible in `aof mesh ui`, with no obvious way to add it — and `mesh.enabled` (set into the *global* config by `aof mesh join`) is a machine-wide flag, not a per-repo record of which repos are actually mesh repos.

**Decision.**
- Add `aof mesh repo publish` — a **CLI-only nested verb** (a `repo` sub-group under `mesh`, a sibling of `aof mesh ui` and the `serve --serve` daemon). It is deliberately OUTSIDE the flat `acd-mesh-command-cli-bijection` (which maps a registry `mesh:<sub>` id to a `subcommand === "<sub>"` branch); a nested `repo publish` has no flat registry id, exactly as `ui`/`serve` do not.
- The verb does two things, in order: (1) writes a **per-repo published marker** into the repo's LOCAL `.aof/aof.config.json` — `mesh.repo = { published: true, publishedAt, workspaceId }` — via a read-merge-write that preserves every other key (the marker is written to the local on-disk config, never the global-merged in-memory view, so the global mesh subtree is not copied down into the repo); (2) publishes a snapshot NOW through the ONE publisher seam (ADR-004), with the marker applied in-memory so the propagation gate treats the repo as enabled for the immediate publish.
- **The marker is also a propagation-enable arm.** The single shared predicate (ADR-002, `meshGlobalPropagationDecision`) now returns enabled when `mesh?.enabled === true` **OR** `mesh?.repo?.published === true`. So an explicitly-published repo's FUTURE work mutations auto-propagate, even on a control node that never "joined" (never got the global `mesh.enabled`). The single-predicate invariant is preserved: this remains the ONE decision function, and it still literally requires `mesh?.enabled === true` as one arm (fitness `acd-global-propagation-single-predicate` holds).
- A failed snapshot write is **non-fatal** (ADR-004): the marker still lands and the caller gets a warning — canonical local work already succeeded.

**Consequences.**
- Operators have a direct, obvious "add this repo to the mesh" action, closing the discoverability gap.
- The `mesh.repo.published` marker is a durable, per-repo, inspectable record of which repos are mesh repos — the natural substrate for a future `--all` (publish every known repo) and for milestone 35's work-assignment targeting (a control node needs to know which repos exist on which workers).
- No new store seam: the verb reaches the global store only through the ADR-004 publisher, so `acd-global-publisher-single-seam` is untouched.
