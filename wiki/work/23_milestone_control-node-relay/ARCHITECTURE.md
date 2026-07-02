---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 23 · Control Node + Thin Relay — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the load-bearing deliverables: **the thin
> stateless relay** shipping as the same aof binary in a `relay` mode, **the control node as a re-nominate-able
> role**, **presence / heartbeat** extending milestone 20's single-node liveness into a fleet signal, and
> **push-for-liveness / poll-for-durability** with clean degradation to git-only; the load-bearing invariant
> the relay is a **cache/accelerator, never a system of record** — every signal it carries has a durable git
> counterpart, so killing it loses **liveness, not data**) and `STATE.md` (the open contract points refined
> here: the relay's transport + frozen wire envelope, the control-node nomination / re-nomination protocol,
> how presence extends m20's heartbeat into a fleet signal — the genuine `23 → 20` seam, the staleness
> threshold, and the relay-liveness 3-node spike as a verification deliverable). Prior art:
> `PRD-decentralized-agent-orchestration.md` (§7.2 KF3 presence/heartbeat + KF9 control node; §7.3 the live
> substrate "a thin, stateless relay on the nominated control node … persists nothing authoritative …
> never a durability SPOF"; **A5 push-for-liveness, poll-for-durability**; A1 git the durable bus; KR1 the
> ≤5s-relay / ≤30s-git split; KR5 you-still-own-the-data). The **substrate seam with milestone 22** is
> adopted verbatim: 22 froze the partition convention and **RESERVED the presence record shape** with a
> named-not-built seam (`presenceRecordPath(workspace, id)` → `join(meshDir, "presence", flatLeaf(id)+".json")`,
> `22/ADR-002`), routed through the SAME `flatLeaf` path-traversal boundary as `nodeRecordPath` — so m23
> BUILDS the presence dimension onto a seam m22 already made path-safe. The **liveness seam with milestone
> 20** is the genuine `23 → 20` edge: 20 froze the single-node run heartbeat (`heartbeat(item, runId)`,
> `isStale(run, nowMs, threshold)`, `reclaimStaleRuns(items, …)` in `src/run-store.mjs`), deliberately shaped
> so a wider scan widens the *item list argument* with no rewrite (the `26 → 20` reclaim seam) — m23 builds
> the **node** presence + the **node**-staleness that DETECTS a stale peer, reusing 20's `isStale` shape; the
> **reclaim** that re-leases the peer's run is m26, out of scope here.
>
> **The precedents this milestone APPLIES and never re-litigates: milestone 08 (cli-command-core), milestone
> 03 (the terminal-WS wire envelope), and milestone 22 (the mesh foundation).** Presence + the relay are
> authored *as registered command-core commands + a serve face*, inheriting wholesale: `08/ADR-001` (CLI-as-
> contract over ONE in-process command core; serve is a thin face over a one-shot core); `08/ADR-002` (the
> frozen `{ id, input, run, cli } → result` contract; basis-neutral `run` data; path-display is a face
> adapter); `03/ADR-001` (one `http.createServer`; the WS attaches via `ws` noServer + `server.on('upgrade')`,
> never a second server/port); `03/ADR-003` (a **frozen wire envelope** with `{type:'error'}` control-frames
> that NEVER crashes the process); `22/ADR-001` (the `mesh:*` thin-face + the `acd-mesh-command-cli-bijection`
> gate); `22/ADR-002` (the path-partition seam + the reserved `presence/<node>.json` shape); `22/ADR-003`
> (the git-TRACKED, derived/rebuildable per-node record discipline); `22/ADR-004` (the **payload-agnostic**
> git-sync engine that moves whatever files land under `meshDir` without parsing them). ADRs below cite these
> as `08/ADR-00n` / `03/ADR-00n` / `22/ADR-00n` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> The seam (confirmed against the codebase graph, `aof graph build src` → **1115 nodes / 3024 edges**,
> builtAt 2026-06-30; `aof graph impact` consulted at author time — cited as **actual** structure, not
> inferred). `src/mesh-store.mjs` is the **mesh spine** (dependents ← `src/commands/mesh-identity.mjs`,
> `src/mesh-sync.mjs` = 2; dependencies → `src/fs.mjs`, `src/run-store.mjs` = 2) — and it already **reserves
> the presence seam** (`presenceRecordPath`), so the presence dimension extends a spine that is already
> path-safe and atomic-write-disciplined. `src/run-store.mjs` is the **m20 liveness source** (dependents ←
> the four `run-*` commands + `mesh-store.mjs` = 5; dependency → `fs.mjs` = 1); its `heartbeat`/`isStale`/
> `reclaimStaleRuns` (lines ~365–417) are the shape presence EXTENDS — and `reclaimStaleRuns` already takes
> the **item list as an argument** (the `26 → 20` seam) so m26 widens it with no rewrite. `src/command-core.mjs`
> is the **one additive door** (dependents ← `board-ui.mjs`, `cli.mjs`, `graph-mcp-server.mjs`,
> `memory/graphify-backend.mjs` = 4; dependencies → all `src/commands/*.mjs` + `work.mjs` = 22 — already
> carrying `mesh-identity.mjs` + `mesh-sync.mjs`): a new `mesh:*` command is one import + one `COMMANDS`
> entry + one `meshCommand` branch + one `argsFor` case — additive. The relay-mode broker leans on the
> established serve precedent: `src/board-serve.mjs` (`serveBoard`, dependents ← `cli.mjs`; dependencies →
> `setup-ui.mjs`), the single `http.createServer` in `src/setup-ui.mjs`, and `src/terminal-ws.mjs` (the
> `ws@8` `WebSocketServer` at `/ws/terminal`, `ws` noServer + `server.on('upgrade')`, a frozen envelope with
> `{type:'error'}` control-frames, `03/ADR-001`/`03/ADR-003`). `ws@^8.21.0` is **already a dependency** — no
> new heavy dep; the relay ships as the same aof binary in a `relay` mode.
>
> **Prior-lesson recall** (`work memory recall "thin stateless relay broker, presence heartbeat over git and
> relay, control node role, node staleness, graceful degradation to git-only" --area architecture --block`)
> surfaced five near-misses; each is acknowledged as honoured or as a conscious departure:
> - **22/ADR-004 — the payload-agnostic git-sync engine moves whatever files land under `meshDir` without
>   parsing them.** **HONOURED — load-bearing here:** presence is a NEW record type that syncs over the same
>   engine with **ZERO** engine change (the engine never imports a record schema). The relay envelope adopts
>   the SAME payload-agnostic discipline (ADR-001's frozen envelope is opaque about signal CONTENT) so the
>   relay carries presence today + leasing (m26) tomorrow with zero relay change.
> - **22/ADR-001 — the `mesh:*` thin-face + the `acd-mesh-command-cli-bijection` gate.** **HONOURED:** the new
>   `mesh:heartbeat` (and any new presence-rendering verb) is a thin face that RIDES the existing
>   `mesh:`-filtered bijection — provided its story adds the `aof mesh <sub>` branch + `argsFor` case (ADR-003;
>   per 22/R1 enumerated below). No new gate needed for the command face.
> - **11/ADR-003 — freshness is a build-fresh-at-the-decision-point discipline over a derived, git-IGNORED
>   graph artifact under `graphify-out/`.** **HONOURED (method, not artifact):** the boundary below is drawn
>   over a freshly-built graph (1115 nodes / 3024 edges, builtAt 2026-06-30) and cited as actual coupling.
>   The mesh records themselves remain git-TRACKED (the `22/ADR-003` departure), distinct from the graph.
> - **22/R5 (F1) — a git-as-bus convention tracking generated records must pin line endings.** **HONOURED —
>   explicitly addressed:** m23 builds presence on the SAME `.mesh/**` git bus, so the deferred `.gitattributes`
>   `eol=lf` / `-text` pin lands here as a structural deliverable on the spine (ADR-002, fitness #6).
> - **22/ADR-003 — node identity is a deterministic, stable, derived, git-TRACKED per-node record.** **HONOURED:**
>   the presence record (ADR-002) is the SAME discipline — derived/rebuildable, git-tracked, additive-friendly,
>   keyed by the SAME `mesh.nodeId` on the SAME partition; per **22/R6** the data source the uniqueness rests on
>   is pinned (presence keyed by `nodeId`, same-host collision resolved by the documented `mesh.nodeId` override).
>
> **Scope-precision carry-forwards (22/R1 + 22/R4 + 22/R6).** **22/R1:** an ADR introducing a command must
> enumerate **EVERY** registry-derived fitness gate it trips — and the *inverse* (which `work:`-filtered gates
> do NOT fire). The new `mesh:*` verbs (`mesh:heartbeat`, the presence render) ride the EXISTING
> `acd-mesh-command-cli-bijection` (22/fitness #3, `mesh:`-filtered); the `work:`-filtered gates do **not**
> fire; the board route-coverage is **milestone 25** (`aof mesh ui`). m23 needs **NO new registry-derived
> gate** (ADR-001/003 below). **22/R4:** a live `mesh:*` run mutates the tracked work stream — the aof
> self-host repo is not itself a mesh node, so it must `.gitignore wiki/work/.mesh/`; folded into the spine
> story 00 (ADR-002). **22/R6:** an ADR promising uniqueness pins the **data source** the mechanic reads —
> presence is keyed by `nodeId` on the reserved partition (one node per path); same-host collision is the
> documented `mesh.nodeId` override (ADR-002), not re-litigated.

## ADR-001: The thin relay ships as the same aof binary in a `relay` mode — a stateless `ws@8` broker (one-shot serve core + a thin face, the board-serve/terminal-ws precedent) carrying a FROZEN, payload-agnostic ephemeral envelope; the control node is a re-nominate-able role/config, PRE-AUTH in m23 (enrollment is milestone 24)

**Status:** Accepted
**Date:** 2026-06-30

**Context.** The milestone's headline premise (PRD §7.3 live substrate; `SPEC §Objective`/`§Scope`) is that
git alone syncs at a ~10–30s cadence — too slow for "see what other agents are working on *right now*" — so
the fleet needs **one** piece of coordination git can't give cheaply and **nothing more**: a thin, stateless
broker carrying *ephemeral* signals. Three structural facts shape the decision: (1) aof **already** has the
exact serving machinery — `src/board-serve.mjs` is a one-shot `serveBoard` over `serveSetupUi`'s single
`http.createServer` (graph: dependents ← `cli.mjs`; dependencies → `setup-ui.mjs`), and `src/terminal-ws.mjs`
attaches a `ws@8` `WebSocketServer` via `ws` noServer + `server.on('upgrade')` with a **frozen wire envelope**
whose control-frames (`{type:'error'}`) never crash the process (`03/ADR-001`/`03/ADR-003`); `ws@^8.21.0` is
already a dependency. (2) The relay must carry presence **today** and leasing (m26) **tomorrow** — so it must
be agnostic about signal CONTENT, exactly as `22/ADR-004`'s sync engine is agnostic about record content.
(3) The relay persists **nothing authoritative** (every signal has a durable git counterpart) — it is a
cache/accelerator, never a durability SPOF (PRD §7.3; `SPEC §Scope` "out of scope: the relay as a system of
record").

**Decision.** Four additive structural moves, applying 08/03/22:

1. **The relay ships as the same binary in a `relay` mode** — no separate product (PRD §7.3 "the relay ships
   as the same binary in a `relay` mode … no separate product to install"). Concretely a one-shot serve unit
   `src/mesh-relay.mjs` `serveRelay({ port, … }) → { server, url, stop }` modelled on `serveBoard` (one
   `http.createServer`, a `ws@8` `WebSocketServer` via noServer + `server.on('upgrade')` on a single relay
   pathname — the `terminal-ws.mjs` `attachTerminalWebSocket` shape), reached from a thin face. **The serve
   logic is a one-shot/serve unit + a thin face** — mirroring `22/ADR-004`'s "command + thin timer/face" split
   (`serveRelay` is the testable core; the launcher/loop is a thin face over it).

2. **A FROZEN wire envelope, payload-agnostic about signal CONTENT** (the `03/ADR-003` discipline). Every
   frame is an opaque ephemeral signal envelope — `{ kind, nodeId, signal }` where `signal` is an OPAQUE blob
   the relay forwards without parsing (presence is the FIRST `kind`; leasing is m26's SECOND `kind`) — plus
   the frozen control-frames (`{type:'error', message}`, never a crash; an unparseable / oversized frame is an
   error control-frame, not a throw). **The relay does NOT import the presence/node-record schema** to parse a
   signal (fitness #2) — the property that makes the relay story parallel with the presence story and lets m26
   add a new `kind` with **zero relay change** (the `22/ADR-004` payload-agnostic property, re-applied at the
   wire).

3. **The relay is STATELESS — persists NOTHING authoritative.** It brokers ephemeral envelopes in memory and
   fans them out; it writes **no** durable record, imports **no** record schema for persistence, and is
   **never** a system of record. Every signal it carries has a durable git counterpart (ADR-002 writes
   presence to git unconditionally; ADR-004 makes the git write the load-bearing path) — so killing the relay
   loses **liveness, not data** (fitness #1; the `SPEC §Objective` hard invariant). This is the same
   system-of-record discipline `22/ADR-004` defends for git, applied to the relay: git stays the single
   authority, the relay is a projection-accelerator.

4. **The control node is a re-nominate-able ROLE/CONFIG, not special hardware** (PRD §7.2 KF9). Nomination is
   recorded as a **config flag — the documented default** (`config.mesh.relay.controlNode: <nodeId>` +
   `config.mesh.relay.url` the endpoint peers push to; reversible — a config edit, no schema change).
   Re-nomination is: stand up `relay` mode on a different node and re-point the config — there is **no
   election protocol** (deliberate, below). The control node is **NOT a durability SPOF**: git stays
   replicated, so losing it pauses **liveness / issuance / joins**, never data (PRD §7.2 KF9; `SPEC §Objective`).

**Security posture (a deliberate, documented scope decision — NOT a SECURITY.md).** The relay in m23 stands
up **PRE-AUTH**: it has **no** group credential / relay auth — that is `SPEC §Out of scope` ("device-code
enrollment + the relay's credential issuance — milestone 24"). The relay's threat model is **inseparable from
m24's enrollment** (group membership is the v1 trust boundary, PRD §7.4 A3), so the full threat model is
authored in m24, not here. m23 records only this posture: the relay binds loopback / a trusted LAN by default
and carries opaque ephemeral signals; the trust boundary lands in m24. This is noted, deliberately, so the
gap is visible and the m24 author owns it — not silently assumed safe.

**Alternatives considered.**
- *A separate relay product / a heavy broker (Redis pub/sub, an MQTT daemon, a Postgres-backed queue)* —
  rejected: it abandons "the relay ships as the same binary in a `relay` mode … no separate product" (PRD
  §7.3) and the "Explicitly NOT a durable server / daemon fleet" line, adds a heavy dep where `ws@8` (already
  present) suffices, and tempts the relay toward holding state (the exact SPOF the milestone exists to avoid).
- *A relay that parses the presence schema to validate / dedup / render signals* — rejected: it couples the
  relay to every signal class (forcing a relay edit for m26 leasing — the `22/ADR-004` anti-pattern) and
  edges the relay toward being a second authority. A payload-agnostic opaque envelope keeps it forward-stable
  and zero-change-for-m26.
- *A leader-election / consensus protocol for the control node (Raft-style auto-failover)* — rejected: it is
  heavy platform machinery the PRD explicitly rejects (§7.3 "Explicitly NOT … a daemon fleet"), and it is
  unnecessary BECAUSE the control node is not a durability SPOF — losing it pauses liveness, which a manual
  re-nominate (a config edit) recovers. A re-nominate-able role/config is the lightest mechanism that meets
  the requirement.
- *Author the relay's auth/threat model here* — rejected: the trust boundary IS m24's enrollment (PRD §7.4
  A3); authoring it pre-enrollment would either invent a credential scheme m24 must then re-litigate, or
  pretend the pre-auth relay is the final posture. Recording the pre-auth posture + deferring the model to
  m24 is the honest scope call.

**Consequences.** Story 01 builds `src/mesh-relay.mjs` (`serveRelay` — the one-shot serve core + the frozen
payload-agnostic envelope), the `relay`-mode face (a thin launcher + the `aof mesh relay` / serve verb), the
control-node nomination config (`config.mesh.relay.*`), and fitness #1/#2. It imports the `ws@8`/`http`
serving stack (the `board-serve`/`terminal-ws` precedent) and references **zero** record-doc filename and
**zero** presence schema. It is **parallel with story 00** (it carries opaque envelopes; it never imports the
presence record). The *observable* relay behaviour (a frame in → a frame out, an error control-frame on a
malformed frame, the process never crashing) is a story-01 task `.feature`, not a fitness function.

## ADR-002: Presence / heartbeat — a node-staleness signal that EXTENDS milestone 20's run heartbeat to the fleet, published as a derived, git-TRACKED `presence/<node>.json` record on the m22-RESERVED seam; the `.gitattributes` line-ending pin + the self-host ignore land here

**Status:** Accepted
**Date:** 2026-06-30

**Context.** Presence is the **fleet face of milestone 20's liveness** (`SPEC §Dependencies`; PRD §7.2 KF3) —
the genuine `23 → 20` edge, not just ordering. m20 froze, in `src/run-store.mjs` (lines ~365–417): a **run**
heartbeat (`heartbeat(item, runId, {now})` bumps `heartbeatAt` on a run record without a state change),
`isStale(run, nowMs, threshold)` (a run is stale when `now − heartbeatAt > threshold`, strict `>`, with a
`heartbeatAt ?? updatedAt` fallback), and `reclaimStaleRuns(items, {now, stalenessThreshold})` (the
restart-time orphan scan that takes the **item list as an argument** — the `26 → 20` seam). m22 RESERVED the
presence partition: `presenceRecordPath(workspace, id)` → `join(meshDir(workspace), "presence",
flatLeaf(id)+".json")` is named-and-built in `src/mesh-store.mjs` (lines 73–75), routed through the SAME
`flatLeaf` path-traversal boundary as `nodeRecordPath`, so the seam is uniformly path-safe BEFORE m23 builds
on it. The directive is to **EXTEND, not duplicate**: m23 adds a **node** heartbeat + **node**-staleness
reusing 20's `isStale` shape; it must **not** stand up a parallel heartbeat (the `SPEC §Dependencies`
constraint that makes m23 a real edge). Two carry-forwards from 22's retro land on this same git bus: the
**F1/R5** line-ending pin and the **R4** self-host ignore.

**Decision.** Freeze the presence-record schema, additive-friendly (top-level keys only, new keys append —
the `20/ADR-001` / `22/ADR-003` discipline), persisted OPAQUE/AS-IS through the mesh-store's atomic
`writeText` seam at the **m22-reserved `presenceRecordPath`**:

```jsonc
// wiki/work/<mesh-root>/.mesh/presence/<node-id>.json — a DERIVED, git-TRACKED per-node presence record.
// Persisted through src/mesh-store.mjs's reserved presenceRecordPath via the atomic writeText seam
// (the SAME write-scope + flatLeaf path-safety discipline nodeRecordPath uses, 22/ADR-002). Rebuildable
// from the install's clock + run records (22/ADR-003 derived-discipline); NEVER a second authority.
{
  "nodeId":      string,    // the SAME stable id as the node record (config.mesh.nodeId) — presence is
                            //   keyed by nodeId on the reserved partition: ONE node per path (22/R6 — the
                            //   uniqueness data source is the nodeId, same-host collision is the documented
                            //   mesh.nodeId override, NOT re-litigated here).
  "heartbeatAt": string,    // ISO-8601 UTC-Z; the instant this heartbeat was published. The staleness
                            //   clock (EXTENDS 20's heartbeatAt — node-level, not run-level).
  "activeRuns":  string[],  // the run ids THIS node currently has in flight — READ from the run records
                            //   m20/m19 sit on (the run-store seam), NOT a re-implemented run scan. This is
                            //   the "see what other agents are working on" payload (PRD §7.2 KF3).
  "aofVersion":  string     // provenance + compat signalling (mirrors the node record; additive-friendly).
}
```

**Node-staleness — EXTEND 20's `isStale`, do not duplicate it.** A node is stale when `now − heartbeatAt >
threshold` — the **exact** `isStale` shape (strict `>` so a node AT the threshold is still live; the same
UTC-Z `Date.parse` discipline). The presence mechanic reuses 20's staleness model rather than re-deriving it:
the node-staleness predicate is the `isStale` shape applied to `heartbeatAt`, so the two liveness layers (run
in m20, node in m23) share one definition. The presence record is **DERIVED/rebuildable** (a projection of
the install's clock + its run records) and **git-TRACKED** under `meshDir` (the `22/ADR-003` discipline + its
conscious `17/ADR-001` departure — git is the bus, a peer reads presence straight from the synced tree).

**Active-runs read — the `23 → 20 → 19` seam.** `activeRuns` is READ from the run records milestone 20 (and,
transitively, 19) own — it does **not** re-implement a run scan and does **not** mutate a run record
(presence is a read of the run dimension, published to the presence dimension). This is the seam cited in
`SPEC §Dependencies` ("a node's active runs in its heartbeat reads the run records 20 sits on").

**The F1/R5 line-ending pin (the carry-forward, landed here).** The git-tracked `.mesh/**` records carry no
line-ending pin, so a mixed-OS / `autocrlf=true` fleet sees byte-divergent (content-identical) record files
(22/R5). m23 builds presence on the SAME bus, so the pin lands here: a `.gitattributes` rule pinning the
`.mesh/**` records (or the `*.json` records under it) to `text eol=lf` / `-text`, mirroring the existing
`src/bundle/** text eol=lf` pin already in the repo's `.gitattributes`. This is a structural deliverable on
the spine (fitness #6).

**The R4 self-host ignore (the carry-forward, landed here).** A live `mesh:*` run against the aof self-host
repo persists a machine-specific record to the tracked `.mesh/` stream (the partition root is *designed*
git-tracked, so there is no ignore) — but the aof self-host repo is **not itself a mesh node**. Story 00 adds
`wiki/work/.mesh/` to the self-host `.gitignore` (a dev-hygiene structural item; a real node where `.mesh/`
IS the committed bus is unaffected — it is a different repo with no such ignore).

**Alternatives considered.**
- *A node heartbeat that does NOT reuse 20's `isStale` (a parallel staleness definition)* — rejected: it
  forks the liveness definition (`SPEC §Dependencies` explicitly forbids a parallel heartbeat) and risks the
  run-layer and node-layer disagreeing on "stale." Reusing 20's `isStale` shape keeps one definition.
- *Embed full run records in the presence payload (not just `activeRuns` ids)* — rejected: it duplicates the
  run dimension into the presence dimension (two authorities for one fact) and bloats the ephemeral signal;
  ids are the index, the run records stay the authority (the `22/ADR-004` system-of-record discipline).
- *A separate `.aof/` sidecar for presence (the `17/ADR-001` default)* — rejected (the recorded `22/ADR-003`
  departure): a sidecar never reaches a peer; presence MUST be git-tracked for the poll-for-durability half
  to work.
- *Defer the line-ending pin / self-host ignore to a later milestone* — rejected: m23 is the milestone that
  builds presence on the same bus the byte-divergence (22/R5) and pollution (22/R4) bite; deferring again
  would leave the carry-forwards unowned. They land on the spine, story 00.

**Consequences.** Story 00 builds `src/mesh-presence.mjs` (the presence-record assembly + the node-staleness
predicate reusing 20's `isStale` shape + the `activeRuns` read of the run records) + `src/commands/mesh-
heartbeat.mjs` (`mesh:heartbeat` — publish this node's presence via the reserved `presenceRecordPath`) + the
extension of `mesh:status` to render presence + the stale flag + its `aof mesh heartbeat` dispatch branch +
`argsFor` case + the `.gitattributes` pin + the self-host `.gitignore` + fitness #3/#6. It writes ONLY under
`meshDir`/`presenceRecordPath` (fitness #3) and works over **git alone** — no relay (story 01 is parallel).
The *observable* end-to-end (a node publishes presence, a peer renders it + the stale flag over git) is a
story-00 task `.feature`, not a fitness function.

## ADR-003: Presence is published over BOTH buses — written to git UNCONDITIONALLY (the durable path) and pushed to the relay as best-effort (the liveness accelerator); the relay push NEVER gates the git write, so relay/control-node loss degrades cleanly to git-only — the milestone's load-bearing invariant (push-for-liveness, poll-for-durability, PRD A5)

**Status:** Accepted
**Date:** 2026-06-30

**Context.** This is the milestone's **headline outcome** (PRD A5 push-for-liveness/poll-for-durability; KR1
the ≤5s-relay / ≤30s-git split; the liveness half of KR5; `SPEC §Objective`). Presence must reach a peer in
**≤5s over the relay** AND **≤30s with the relay killed** — and **correctness NEVER depends on the relay**
(`SPEC §Scope` "the relay … correctness never depends on it"). The two prior ADRs make this tractable:
ADR-002 writes presence to git (the durable, payload-agnostic-synced path via `22/ADR-004`), ADR-001 carries
opaque envelopes over the relay (the accelerator). The remaining decision is the **node-side client shape**:
the order and failure-coupling of the two publishes, such that the structure itself guarantees graceful
degradation — not a runtime best-effort hope.

**Decision.** The node-side presence publish path (the `mesh:heartbeat` run + the background cadence over it)
does **two** publishes, in a structurally-frozen order:

1. **Write git UNCONDITIONALLY first** — `publishPresenceRecord(workspace, nodeId, record)` writes
   `presenceRecordPath` through the atomic `writeText` seam (ADR-002). This is **not** inside any
   relay-success branch and is **not** guarded by relay reachability — it always runs. (The git *sync* that
   moves it to peers is `22/ADR-004`'s payload-agnostic engine, ≤30s cadence — presence syncs with ZERO
   engine change because the engine is payload-agnostic.)

2. **Push the relay as BEST-EFFORT second** — `pushPresenceSignal(relayClient, envelope)` is wrapped so a
   relay-absent / connect-fail / push-fail is **caught, never thrown** (the `03/ADR-003` never-crash
   discipline applied node-side): no relay configured ⇒ skip; relay unreachable ⇒ catch + continue; push
   error ⇒ catch + continue. A relay failure **never** propagates to the heartbeat result and **never**
   undoes the git write.

**The structural form of graceful degradation (fitness #4).** The git write is **NOT** inside the
relay-success branch — i.e. the publish is structured `await writeGit(...); try { await pushRelay(...) }
catch { /* liveness lost, data safe */ }`, never `if (await pushRelay(...)) { await writeGit(...) }`. This is
the most faithful structural form of "correctness independent of the relay": killing the relay (or the
control node) removes the `try`-block's effect, leaving the unconditional git write intact — so the fleet
degrades to **git-only (poll) sync**, losing **liveness, not data**. The relay is the accelerator; git is the
floor.

**Verification note (not a refine blocker).** A1/A5 — does the ≤5s-relay / ≤30s-git split hold under **real
concurrency** on a 3-node fleet? — is a **verification-time measurement spike** (mirroring `22/ADR-004`'s
verification note for A1), NOT a refine-time decision. Recorded here as a `@manual` verification deliverable
(story 02), so refine does not stall on a measurement it cannot make at design time. The KR1 latency bounds
are *measured* at verify, not *decided* at refine.

**Per 22/R1, the registry-derived gates the new `mesh:*` verbs arm:**
- **CLI bijection** — `mesh:heartbeat` (and any presence-render verb) RIDES the **existing**
  `acd-mesh-command-cli-bijection` (22/fitness #3, `id.startsWith("mesh:")`) — provided its story adds the
  `aof mesh <sub>` dispatch branch + `argsFor` case (the `22/ADR-001` additive idiom). **m23 authors NO new
  registry-derived gate** for the command face (the namespace already exists; this is the inverse-of-22/R1
  check coming back CLEAN because the gate is already namespace-scoped, not `work:`-scoped).
- **Board route-coverage** (`acd-work-command-route-coverage`) — **NOT armed**: `work:`-filtered, ignores
  `mesh:*`. The mesh board face (`aof mesh ui`) is **milestone 25**; its route-coverage is authored *there*.
- **`acd-command-namespace`** — **NOT armed**: `mesh:heartbeat` adds **no bundle skill `.md` members**.

**Alternatives considered.**
- *Push the relay first, write git only on relay failure (relay as primary, git as fallback)* — rejected: it
  inverts the system-of-record (the relay would be the authority on the happy path, git only the fallback),
  exactly the SPOF the milestone forbids (`SPEC §Scope`; PRD §7.3). Git is ALWAYS written; the relay only
  accelerates.
- *Write git only when the relay is unreachable (skip the durable write when the fast path "succeeded")* —
  rejected: it makes durability conditional on relay state — a relay that ACKs then dies between heartbeats
  loses data. The git write must be unconditional (the floor), the relay strictly additive.
- *Let a relay push failure throw / fail the heartbeat command* — rejected: it makes correctness depend on
  the relay (a relay outage would red every heartbeat). A caught best-effort push is the only shape that
  degrades cleanly — the `03/ADR-003` never-crash discipline, node-side.

**Consequences.** Story 02 builds `src/commands/mesh-heartbeat.mjs`'s integration (the two-publish path) — or,
if story 00 ships `mesh:heartbeat` git-only, story 02 ADDS the best-effort relay push to it + the node-side
relay client + the cadence loop (a thin timer over the one-shot publish, the `22/ADR-004` runner shape) + the
KR1 integration + the A1/relay-liveness 3-node spike as a `@manual` deliverable + fitness #4. It depends on
**00 (the presence record + git write) and 01 (the relay)** — the genuine integration story. The *observable*
end-to-end (a peer's change ≤5s over the relay; ≤30s relay-killed; killing the relay loses liveness not data)
is a story-02 task `.feature` + the `@manual` 3-node spike, not a fitness function.

## ADR-004: The node-side receive-and-apply consumer (F1 close-out) — a PERSISTENT relay subscriber (distinct from the one-shot push client) that applies each fanned-out `{ kind:"presence" }` frame into an IN-MEMORY liveness cache, overlaid by `mesh:status` as `git-on-disk ?? cache` (git wins); the subscriber writes NO durable record and is NEVER a second system of record

**Status:** Accepted
**Date:** 2026-07-01

**Context.** `aof:verify 23` empirically confirmed finding **F1** (VERIFICATION.md, F1 row; adjudicated a
BLOCKER by the user/PO): the relay is a working **broker** with a PUSH producer (`pushPresenceSignal`,
`src/mesh-relay-client.mjs`) and a git-read render (`meshStatusCommand.run`, `src/commands/mesh-identity.mjs`),
but **no node-side CONSUMER**. `createRelayClient` is push-only (connect → push one frame → dispose; its only
`on("message")` resolves the join-ack then ignores every subsequent frame — the codebase graph confirms it at
**1 dependent** `mesh-heartbeat.mjs` / **0 dependencies**, a leaf push seam). A fanned-out signal therefore
reaches nobody and `mesh:status` only ever changes after a ≤30s git sync — so KR1's headline half ("a peer's
change reflected ≤5s over the relay") is **undeliverable as built**. This ADR ratifies the missing hop of the
observable's data-path (producer → transport → **consumer** → render), decided BEFORE the build. It applies
**ADR-003** (the push-for-liveness half, now given a receiver — the push accelerates writes, this accelerates
reads), **ADR-001** (the frozen payload-agnostic `{ kind, nodeId, signal }` envelope the subscriber consumes
by reading `kind`, forwarding `signal` opaque), and **ADR-002** (git the durable authority; the applied signal
a liveness projection, never a second record). Precedents cited: `03/ADR-003` (the never-crash consumer-side
discipline the subscriber mirrors from the broker), `22/ADR-004` (the payload-agnostic system-of-record
discipline — git the single authority, the accelerator a projection).

**Decision.** Three additive, file-disjoint structural moves — the receive-side mirror of ADR-003's send-side:

1. **An in-memory liveness cache** — a new `src/mesh-presence-cache.mjs`, a factory
   `createPresenceCache() → { apply(record), get(nodeId), all() }` keyed by `nodeId`, latest-signal-wins (the
   ADR-002 one-node-per-partition discipline applied **in memory**). It holds applied peer presence records
   **IN MEMORY ONLY** — never a disk write, never a durable record, imports **no** write/persist seam. This is
   the "liveness cache, never a second system of record" invariant made concrete.

2. **A NEW persistent-subscriber module** `src/mesh-presence-subscriber.mjs` — **distinct from** the one-shot
   push client (the persistent-vs-one-shot distinction is the load-bearing property F1 named: `createRelayClient`
   is connect→push→dispose; this HOLDS the connection across many frames). It takes an **INJECTED transport**
   `{ connect, onMessage/subscribe, close }` (the `@executable` feasibility lever, mirroring `ctx.relayClient`)
   so CI delivers frames synchronously with **no** real ws server and **no** wall-clock. It CONNECTS ONCE, HOLDS
   the connection, and on each inbound frame parses **just enough**: a malformed / non-JSON / oversized
   (`> resolveMaxFrameBytes(config)`) / missing-`kind` / unknown-`kind` frame is **ignored** (no cache change,
   no crash — the consumer-side mirror of the broker's `parseEnvelope`/never-crash discipline, `03/ADR-003`);
   a `{ kind:"presence" }` frame applies the OPAQUE `signal` (the presence record) into the cache keyed by
   `signal.nodeId`. A connect failure is **caught** → the subscriber is inert and `mesh:status` still renders
   the git floor (the read-side mirror of fitness #4 — correctness never depends on the relay).

3. **The `mesh:status` overlay** — `meshStatusCommand.run` reconciles the git-durable disk record with the
   cached projection through a pure `mergePresence(diskPresence, cachedPresence)` helper (living in the presence
   dimension, `src/mesh-presence.mjs`), where **git-durable-on-disk WINS a tie**: the cache is used ONLY when it
   is STRICTLY newer than the disk record (a peer heard over the relay before its git record synced), and a tie
   or an equal/unparseable-cache heartbeat reconciles to the durable disk bytes. This is a stronger form of the
   `disk ?? cache` sketch — it lets the ≤5s cache lead the ≤30s git floor without ever becoming a second
   authority: once git carries the same heartbeat, the render reconciles to the durable bytes. The cache
   injects via `ctx.presenceCache`, **exactly** the `ctx.relayClient` pattern — the CLI face (`aof mesh status`)
   injects NO cache, so it reads git only, byte-identical to the story-00 render (the no-cache path is
   `mergePresence(disk, null) === disk`). No new import edge into the status command (the graph shows
   `mesh-identity.mjs` at 2 dependents / already importing `mesh-presence.mjs`; the overlay is an additive read
   on the value it already computes, not a new coupling).

**Production wiring is out of scope here (the deferred-daemon consistency, F2).** In production the daemon
(F2, deferred) owns the shared cache and drives the subscriber's real socket; m23 ships the subscriber + cache
**library-only** (unit-proven over the injected transport), consistent with `serveRelay` / `relayMode` /
`startPresenceLoop` all being library-only (VERIFICATION.md F2 — "consistent m22 precedent, `startSyncLoop` is
also library-only"). The subscriber's REAL-socket behaviour rides the same deferred launcher F2 owns; this ADR
does not build it.

**The ≤5s latency stays a `@manual` re-measurement (the fleet spike).** The receive-and-apply **mechanism** (a
delivered frame updates what `mesh:status` reflects; a bad frame is ignored; relay-down degrades to git) is
`@executable` in-process over the injected transport. The ≤5s **latency bound** remains a `@manual` measured
wall-clock observation on the 3-node fleet (the task-02 spike, re-runnable now that the consumer exists) — it
is not collapsed into a flaky CI assert (the ADR-003 verification-note discipline, re-applied to the receive
side).

**Per 22/R1 — the registry-derived gates this change arms (and the inverse that stays clean).** This task adds
**NO new `mesh:*` command verb**: it is a subscriber **module** + a `mesh:status` **overlay** (an additive `??`
read on the existing `mesh:status`), not a new command. So the `acd-mesh-command-cli-bijection` gate is **NOT**
re-armed and **NO** new command-face gate is needed (the inverse-22/R1 check is CLEAN — no verb, no CLI adapter,
no dispatch branch, no `argsFor` case). The `work:`-filtered gates do not fire; the board route-coverage is
m25. The only new gate is the **structural** fitness #7 below (the cache-only guard), authored because fitness
#3 does not cover the new module (see Consequences).

**Alternatives considered.**
- *Write the applied relay signal to the git-tracked `presenceRecordPath`* — **REJECTED.** It makes the relay a
  **second system of record** (the exact ADR-001/ADR-002 invariant + fitness #1 the milestone exists to
  defend), inverts push-for-liveness/poll-for-durability (ADR-003) by giving the fast path durable authority,
  and would corrupt the byte-identity the git sync relies on (a peer's cached projection racing its own durable
  write). It also violates the presence write-scope discipline — a subscriber writing `presenceRecordPath`
  would be a NEW write site fitness #3 does **not** grep (it scopes `mesh-presence.mjs`/`mesh-heartbeat.mjs`
  only), leaving the invariant unguarded — which is precisely why fitness #7 is authored.
- *An in-memory cache overlay (`git-on-disk ?? cache`, git wins)* — **ACCEPTED** (the decision above). It is the
  faithful structural form of "the applied signal is a liveness cache, never a durable authority": the cache
  fills the ≤5s gap, git reconciles at ≤30s, and killing the relay leaves the subscriber inert with the git
  floor intact — liveness lost, data safe, the receive-side mirror of ADR-003.
- *Extend the one-shot `createRelayClient` to also subscribe (one dual-purpose client)* — **REJECTED.** It
  conflates the discrete best-effort push (connect→push→dispose, a heartbeat is a discrete publish) with the
  persistent hold-the-connection subscribe — the exact property F1 named as missing. A distinct module keeps
  the push seam a leaf (graph: 0 dependencies) and the subscribe seam independently testable + independently
  daemon-wired (F2), and mirrors the send/receive split ADR-003 already draws (`pushPresenceSignal` on the
  send side, the subscriber on the receive side).
- *Re-measure ≤5s in a CI assert (collapse the fleet spike into `@executable`)* — **REJECTED** (the ADR-003
  precedent): a wall-clock latency bound under real concurrency is a verification-time measurement, not a
  refine-time assert; forcing it into CI would be flaky. The mechanism is `@executable`; the latency is
  `@manual`.

**Consequences.** The F1 close-out task builds **`src/mesh-presence-cache.mjs`** (`createPresenceCache`, the
in-memory keyed-by-`nodeId` latest-wins cache — no disk write; `apply`/`get`/`ids`/`list`/`size`),
**`src/mesh-presence-subscriber.mjs`** (the persistent injected-transport subscriber:
`startPresenceSubscriber({ transport, cache, maxFrameBytes })` — connect-once/hold, `parseInboundFrame`
= parse-just-enough/ignore-bad-frame, apply-presence, catch-connect-failure-to-inert; plus
`createSubscriberTransport` the production ws@8 seam the `@manual` spike exercises), and the **`mesh:status`
overlay** in `src/commands/mesh-identity.mjs` (`mergePresence(diskPresence, cachePresence)`, git wins a tie)
with the cache injected via `ctx.presenceCache` (the `ctx.relayClient` seam). It imports the same never-crash
primitives the broker uses (`resolveMaxFrameBytes`/`DEFAULT_MAX_FRAME_BYTES` for the oversized-frame floor, the
frozen `PRESENCE_SIGNAL_KIND` literal for the one wire `kind`) and references **zero** durable-write seam. It
arms the new **fitness #7 `acd-presence-subscriber-cache-only`** (below) — a source-grep of the two new modules
proving the consumer is an in-memory cache, never a second system of record. It arms **no** new command-face
gate (no new `mesh:*` verb; the overlay rides the existing `mesh:status`, so the `acd-mesh-command-cli-bijection`
gate is not re-armed). **The developer built these modules concurrently with this design-lock; fitness #7
verifies GREEN against the delivered `src/mesh-presence-cache.mjs` + `src/mesh-presence-subscriber.mjs` (each
proof carrying its m03 non-vacuous self-check).** The *observable* end-to-end (a delivered peer signal surfaces
in `mesh:status` with no git sync; the ≤5s fleet re-measurement) is the F1 task `.feature` + its `@manual`
spike, not a fitness function.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: src/mesh-relay.mjs, src/mesh-presence.mjs, the new
     mesh:* commands (mesh:heartbeat), the extended mesh:status, the relay-mode face, and the node-side
     two-publish path do not exist yet; the tests reference them so they fail cleanly until the owning
     story lands. "From" names the owning story. -->

| Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|
| **Relay statelessness / never a system of record.** The relay module persists **no** authoritative state and imports **no** record schema for persistence — it brokers ephemeral envelopes in memory only (ADR-001). | `test/arch/acd-relay-stateless.test.mjs` — source-discipline grep of `src/mesh-relay.mjs`: assert it performs **no** `writeText`/`writeFile` of a record (no durable write), does **not** import `mesh-store.mjs`/`mesh-presence.mjs`/the record schema for persistence, and holds no on-disk store — it stages/fans-out frames, not fields (mirroring `22/ADR-004`'s `acd-mesh-sync-record-neutral`). | RED until `src/mesh-relay.mjs` exists | **01 · thin relay** |
| **Relay envelope is payload-agnostic.** The relay does **not** import the presence/node-record schema to parse signal CONTENT — a new signal `kind` (leasing, m26) needs **zero** relay change (ADR-001). | `test/arch/acd-relay-envelope-neutral.test.mjs` — source-grep `src/mesh-relay.mjs`: assert it imports neither `mesh-presence.mjs` nor `node-identity.mjs`/the presence schema, performs no `JSON.parse`-then-branch on a signal's CONTENT (it forwards the opaque `signal` blob), and frames a malformed/oversized input as the frozen `{type:'error'}` control-frame, never a throw (the `03/ADR-003` discipline). | RED until `src/mesh-relay.mjs` exists | **01 · thin relay** |
| **Presence write-scope.** Every presence write joins the **m22-reserved** `presenceRecordPath`/`meshDir` seam and routes through atomic `writeText` (the `22/ADR-002` write-scope discipline); the presence mechanic references **zero** record-doc filename (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`) (ADR-002). | `test/arch/acd-presence-write-scope.test.mjs` — source-grep `src/mesh-presence.mjs` (+ `src/commands/mesh-heartbeat.mjs`): assert every write path joins `presenceRecordPath`/`meshDir`, routes through `writeText` (not a bare `writeFile`), and references **zero** record-doc filename (mirroring `22/ADR-002`'s `acd-mesh-write-scope`). | RED until `src/mesh-presence.mjs` writes presence | **00 · presence** |
| **Correctness-independent-of-relay / graceful degradation.** The presence publish path writes git **UNCONDITIONALLY** and treats the relay push as best-effort — the git write is **NOT** inside the relay-success branch, and a relay failure is **caught, never thrown** (ADR-003). | `test/arch/acd-presence-relay-independent.test.mjs` — source-analysis of `src/commands/mesh-heartbeat.mjs` (+ the node-side relay client): assert the `writeText`/`publishPresenceRecord` call is **not** nested inside a relay-push conditional/success branch, and the relay push is wrapped in a `try`/`catch` (the throw is swallowed) — so the git write survives a relay failure (the structural form of "data safe, liveness lost"). | RED until the two-publish path lands | **02 · push/poll integration** |
| **Mesh-namespace bijection (RIDES the existing gate — NO new gate, 22/R1).** Every new `mesh:*` verb (`mesh:heartbeat`, the presence-render extension) carries a non-null `cli` adapter, has a reachable `aof mesh <sub>` dispatch branch, and `aof mesh <sub> --json` runs clean + parseable. | The **EXISTING** `test/arch/acd-mesh-command-cli-bijection.test.mjs` (22/fitness #3, `id.startsWith("mesh:")`) — auto-covers the new verbs **provided** their story adds the `subcommand === "<sub>"` branch in `meshCommand` + the `argsFor` case. **No new gate authored** (the inverse-22/R1 check is CLEAN: the namespace gate already exists). Board route-coverage is **m25**. | GREEN gate exists (m22); RED on the NEW verbs until their dispatch branch + `argsFor` land | **00 / 02 (per verb)** |
| **Line-ending pin (F1/R5 carry-forward).** The git-tracked `.mesh/**` records (or the `*.json` under it) are pinned `text eol=lf` / `-text` in `.gitattributes`, so a mixed-OS fleet sees byte-stable record files (ADR-002). | `test/arch/acd-mesh-eol-pinned.test.mjs` — read `.gitattributes`: assert a rule pins `.mesh/**` (or the record `*.json`) to `eol=lf`/`-text` (mirroring the existing `src/bundle/** text eol=lf` pin), so the byte-divergence 22/R5 hit cannot recur. | RED until the `.gitattributes` pin lands | **00 · presence** |
| **Receive-side is a liveness cache, never a second system of record (F1 close-out).** The node-side consumer applies a fanned-out presence signal into an IN-MEMORY cache only — the subscriber (`src/mesh-presence-subscriber.mjs`) and the cache (`src/mesh-presence-cache.mjs`) perform **no** `writeText`/`writeFile` of a record, import **no** durable-write / record-persist seam (no `mesh-presence.mjs`/`mesh-store.mjs`/`node:fs`/`fs.mjs` import, no `publishPresenceRecord`), and never reference `presenceRecordPath` (the git-tracked write target) — so the applied signal is provably a projection, never a durable authority (ADR-004; the invariant fitness #3 does NOT cover, since it greps only `mesh-presence.mjs`/`mesh-heartbeat.mjs`). **Carve-out (ADR-004):** importing the frozen `PRESENCE_SIGNAL_KIND` literal from `mesh-relay-client.mjs` and the frame-size floor (`DEFAULT_MAX_FRAME_BYTES`/`resolveMaxFrameBytes`) from `mesh-relay.mjs` is ALLOWED — a const literal + a size floor are not a persist seam. | `test/arch/acd-presence-subscriber-cache-only.test.mjs` — source-grep of `src/mesh-presence-subscriber.mjs` + `src/mesh-presence-cache.mjs`: assert (a) no durable-write call (`writeText`/`writeFile`/`appendFile`), (b) no import of a durable-write/record-persist seam (`node:fs`/`node:fs/promises`/`fs.mjs` / `mesh-presence.mjs` / `mesh-store.mjs`) and no `publishPresenceRecord` reference, (c) no `presenceRecordPath` reference (the write target it must never touch). Each proof paired with the m03 non-vacuous self-check (the detector fires on a planted violation). | GREEN — the two modules landed (the F1 developer built them); the gate confirms the receive side is cache-only | **02 · F1 receive-and-apply** |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors milestone 22's split):
     - RELAY STATELESSNESS, RELAY ENVELOPE-NEUTRAL, PRESENCE WRITE-SCOPE, RELAY-INDEPENDENT DEGRADATION,
       the (existing) MESH BIJECTION, the EOL PIN, and the RECEIVE-SIDE CACHE-ONLY guard (#7, the F1
       close-out) are true STRUCTURAL invariants over the relay module's source, the presence write
       surface, the publish-path control flow, the receive-side subscriber/cache source, the
       registry/dispatch, and the repo's .gitattributes → arch-tests (this table). They are the
       milestone's load-bearing structural deliverable.
     - The OBSERVABLE behaviours — "a node publishes presence and a peer renders it + the stale flag over
       git", "a frame in → a frame out; a malformed frame → an error control-frame, the process never
       crashing", and "a peer's change ≤5s over the relay / ≤30s relay-killed; killing the relay loses
       liveness not data" — exercise the real seams, the real filesystem, real git, and a real ws server.
       They belong in story 00's / 01's / 02's task .feature files, NOT here.
     - A1/A5 ("does ≤5s/≤30s hold under real concurrency on a 3-node fleet") is a VERIFICATION-TIME
       measurement spike (ADR-003), a @manual deliverable — not a fitness function and not a refine blocker. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The PO partitions milestone 23 into
     exactly three stories. The partition follows the real call/dependency coupling the codebase graph
     reports, not inferred coupling. -->

The PO will partition milestone 23 into **exactly three stories**, and the boundary follows the **real
call/dependency coupling** the codebase graph reports (`aof graph build src` → **1115 nodes / 3024 edges**,
builtAt 2026-06-30; `aof graph impact` consulted at author time — cited as **actual** structure, not
inferred):

- **00 · presence record + node-staleness (the durable git-side / poll-for-durability substrate)** — owns
  `src/mesh-presence.mjs` (the presence-record assembly on the m22-reserved `presenceRecordPath`; the
  node-staleness predicate reusing 20's `isStale` shape, ADR-002; the `activeRuns` read of the run records) +
  `src/commands/mesh-heartbeat.mjs` (`mesh:heartbeat` — git-only publish) + the extension of `mesh:status` to
  render presence + the stale flag + the `aof mesh heartbeat` dispatch branch + `argsFor` case + the **F1/R5
  `.gitattributes` pin** + the **R4 self-host `.gitignore`** + arch-tests **#3 / #6** (and the new verb's
  ride on the existing bijection gate). Works over **git alone** — no relay. The **dependency root** for
  presence.
- **01 · the thin stateless relay (relay-mode broker + control-node role)** — owns `src/mesh-relay.mjs`
  (`serveRelay` — the one-shot serve core + the frozen payload-agnostic envelope, ADR-001), the `relay`-mode
  face (a thin launcher + the `aof mesh relay` / serve verb), the control-node nomination config
  (`config.mesh.relay.*`), and arch-tests **#1 / #2**. **Parallel with 00** — it carries opaque envelopes; it
  imports **neither** the presence record nor a record schema.
- **02 · push-for-liveness / poll-for-durability + graceful degradation** — owns the node-side relay client +
  the two-publish path (git unconditional + relay best-effort, ADR-003), the cadence loop (a thin timer over
  the one-shot publish), the KR1 (≤5s/≤30s) + liveness-half-of-KR5 integration, the A1/relay-liveness 3-node
  spike as a `@manual` deliverable, and arch-test **#4**. **Depends on 00 + 01** (the genuine integration
  story).

**Why this boundary is grounded in the graph, not inferred:**

1. **`src/mesh-presence.mjs` extends the two spines the graph already shows as low-fan-out mechanics — and
   the presence seam is already reserved.** `aof graph impact src/mesh-store.mjs` reports **2 dependents**
   (`src/commands/mesh-identity.mjs`, `src/mesh-sync.mjs`) and **2 dependencies** (`src/fs.mjs`,
   `src/run-store.mjs`) — a clean spine that already exports `presenceRecordPath` (lines 73–75). `aof graph
   impact src/run-store.mjs` reports **5 dependents** (the four `run-*` commands + `mesh-store.mjs`) and **1
   dependency** (`fs.mjs`); its `isStale`/`heartbeat`/`reclaimStaleRuns` (lines ~365–417) are the m20 liveness
   shape presence reuses, and the `activeRuns` read couples through it. So story 00 sits on **two existing
   low-fan-out mechanics with a pre-reserved seam** — the dependency root, buildable + testable over git
   alone. This is the topological root the call graph dictates (00 → {02}; 01 → {02}).

2. **The relay is a DISJOINT subtree, not coupled to the presence record — the parallelism the graph
   confirms.** `aof graph impact src/board-serve.mjs` reports it couples only to `setup-ui.mjs` (dependency)
   and `cli.mjs` (dependent); `aof graph impact src/terminal-ws.mjs` reports it couples to the `ws@8`/PTY
   serving stack (`headroom`/`terminal-providers`/`terminal-sessions`/`work`), **not** to `mesh-store.mjs`,
   `run-store.mjs`, or any record schema. The new `src/mesh-relay.mjs` sits in that same serving-stack
   neighbourhood — it imports the `http`/`ws@8` serve precedent, **not** the presence record (fitness #1/#2
   enforce exactly this). Story 01 is therefore a **file-disjoint parallel sibling** of story 00: 00 owns the
   git-side record mechanic, 01 owns the relay-side serve mechanic, and they share **no** module — the
   property that lets m26 add a leasing `kind` to the relay with zero presence change.

3. **The one additive door is `command-core.mjs` — and m23 needs NO new gate.** `aof graph impact
   src/command-core.mjs` reports **4 dependents** (`board-ui.mjs`, `cli.mjs`, `graph-mcp-server.mjs`,
   `memory/graphify-backend.mjs`) and **22 dependencies** (every `src/commands/*.mjs` + `work.mjs` — already
   carrying `mesh-identity.mjs` + `mesh-sync.mjs`). Registering `mesh:heartbeat` is **one import + one
   `COMMANDS` entry + one `meshCommand` dispatch branch + one `argsFor` case** — the additive `22/ADR-001`
   idiom, on a door that already routes the `mesh:*` namespace. The only co-touched files across stories are
   `command-core.mjs`'s `COMMANDS` array + `cli.mjs`'s `meshCommand` dispatcher (each touched **add-only**,
   one import / one entry / one branch / one case per verb) — exactly the acceptable additive co-touch
   `07/ADR-006` sanctions (the `22/ARCHITECTURE` co-touch precedent). The new verb RIDES the existing
   `mesh:`-filtered bijection gate (22/fitness #3): m23 authors **NO new registry-derived gate** (the
   inverse-22/R1 check is CLEAN because the namespace gate already exists — unlike m22, which had to author
   it).

4. **The integration is the genuine cross-story edge — and it is the ONLY one.** Story 02 is the sole place
   the two subtrees meet: it imports the presence record (00) AND pushes over the relay client (01). The
   graph shows no other coupling between 00's and 01's file sets — so confining the integration to story 02
   keeps 00 and 01 **fully independent parallel siblings**, with 02 the single dependent at the join. The
   `23 → 20` liveness seam (presence reuses `isStale`) and the `23 → 22` substrate seam (presence on the
   reserved `presenceRecordPath`, synced by the payload-agnostic engine) both live INSIDE story 00 — they are
   inherited seams, not cross-story edges within m23.

**The one conscious refinement from milestone 22's partition.** In m22 the spine (00) was the dependency
root AND had to bootstrap the greenfield `aof mesh` face + author the NEW bijection gate. Here the face
**already exists** (m22 shipped the `meshCommand` dispatcher + the `mesh:`-filtered bijection gate), so m23's
spine (story 00) does **not** bootstrap a face or author a gate — it adds verbs to an existing face that an
existing gate already covers (the inverse-22/R1 dividend). The relay (story 01) is the novel structural
weight this milestone carries — a NEW serve mechanic in the `board-serve`/`terminal-ws` neighbourhood — which
is why 01, not 00, owns the milestone's new module subtree. This keeps 00 and 02 lean (record + integration)
and isolates the heavy new surface (the relay) in one parallel sibling.

The coupling is **advisory**: it informs why presence-first (00) + a disjoint relay (01) + a single
integration (02) is the right cut (the call graph's dependency direction + the disjoint relay subtree + the
single join), but the PO draws the final partition. The graph confirms — it does not dictate.
