---
type: story
number: 01
slug: thin-relay
title: "The thin stateless relay — src/mesh-relay.mjs serveRelay in a `relay` mode + the frozen payload-agnostic envelope + the control-node role"
parent: 23
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-07-01
schema: 1
aofVersion: 0.1.0
---
<!-- Build landed 2026-06-30 (aof:continue 23): tasks 00/01/02 @executable green, fitness #1/#2 green,
     bijection gate green covering mesh:relay (non-blocking --json probe). status → in-review at the
     milestone-wide review gate. -->

<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · The thin stateless relay — live presence's accelerator

## User story

As a fleet that needs sub-5s liveness git alone can't give cheaply (and the leasing fast-path milestone 26 will later carry on the same broker),
I want a thin, stateless relay that ships as the **same aof binary in a `relay` mode** — a `ws@8` broker that fans an opaque ephemeral signal from one connected node out to the others, holding **nothing authoritative**, framing a malformed input as an error control-frame rather than crashing — hosted by a re-nominate-able **control node** recorded in config,
so that the live coordination layer git can't provide cheaply exists as the lightest possible accelerator: kill it and the fleet loses **liveness, not data** (every signal has a durable git counterpart), and a new signal class (leasing, m26) rides the same payload-agnostic wire with zero relay change.

<!-- This story owns the RELAY SUBTREE — a NEW serve mechanic in the board-serve/terminal-ws neighbourhood.
     It carries OPAQUE envelopes: it imports NEITHER the presence record NOR any record schema (fitness #1/#2),
     which is exactly what makes it a file-disjoint PARALLEL sibling of story 00 and lets m26 add a leasing
     `kind` with zero change. It persists NOTHING (stateless). Story 02 wires presence onto it. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 23 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its feature is green. The fitness functions are arch-tests
     (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_relay-broker-fanout.feature` — `serveRelay({ port }) → { server, url, stop }` stands up a `ws@8` broker in `relay` mode (one `http.createServer`, `ws` noServer + `server.on('upgrade')` on a single relay pathname — the `terminal-ws` precedent); a signal frame published by one connected node is fanned out to the **other** connected nodes (not echoed back to the sender by default); the relay holds the in-flight signal **in memory only** and persists nothing; `stop()` tears the server down cleanly.
- [x] `tasks/01_relay-envelope-and-resilience.feature` — the **frozen, payload-agnostic** wire envelope `{ kind, nodeId, signal }` where `signal` is an **opaque blob the relay forwards without parsing** (presence is the first `kind`; an **unknown `kind`** — e.g. m26 leasing — is forwarded opaque, not rejected); a malformed / non-JSON / oversized frame yields a frozen `{ type:'error', message }` control-frame and the **process never crashes** (the 03/ADR-003 never-crash discipline); a peer disconnect is handled without tearing down the broker.
- [x] `tasks/02_control-node-role.feature` — the control node is a **re-nominate-able role recorded in config** (`config.mesh.relay.controlNode` = the nominated node id, `config.mesh.relay.url` = the endpoint peers push to); standing up `relay` mode reads that config; **re-nomination** is standing `relay` mode up on a different node and re-pointing the config (no election protocol); the relay is **never a system of record** — it issues/persists nothing authoritative, so losing the control node pauses liveness while git (and every durable record) is untouched.
- [x] **Fitness `acd-relay-stateless`** (arch-test, ADR-001 / fitness #1) — `src/mesh-relay.mjs` performs **no** `writeText`/`writeFile` of a record (no durable write), imports **no** record schema for persistence (`mesh-store.mjs`/`mesh-presence.mjs`/`node-identity.mjs`), and holds no on-disk store — it brokers ephemeral frames, not fields.
- [x] **Fitness `acd-relay-envelope-neutral`** (arch-test, ADR-001 / fitness #2) — the relay imports **neither** `mesh-presence.mjs` **nor** `node-identity.mjs`/the presence schema, performs no `JSON.parse`-then-branch on a signal's **content** (it forwards the opaque `signal` blob), and frames a malformed/oversized input as the frozen `{type:'error'}` control-frame, never a throw — so a new `kind` (m26 leasing) needs zero relay change.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-001** — the thin relay ships as the
same aof binary in a `relay` mode, a stateless `ws@8` broker carrying a frozen payload-agnostic envelope, the
control node a re-nominate-able role/config, **PRE-AUTH in m23** — enrollment + the relay credential are
milestone 24). This story **owns**: `src/mesh-relay.mjs` (`serveRelay` — the one-shot serve core + the frozen
payload-agnostic envelope), the `relay`-mode face (a thin launcher + the `aof mesh relay` / serve verb), the
control-node nomination config (`config.mesh.relay.*`), and the two arch-tests above + their registration in
[scripts/test.mjs](../../../../../scripts/test.mjs). It imports the `ws@8`/`http` serving stack — the
[board-serve.mjs](../../../../../src/board-serve.mjs) (`serveBoard`) / single `http.createServer` in
[setup-ui.mjs](../../../../../src/setup-ui.mjs) / [terminal-ws.mjs](../../../../../src/terminal-ws.mjs)
(`WebSocketServer` via noServer + `server.on('upgrade')`, the frozen `{type:'error'}` control-frame envelope,
03/ADR-001 + 03/ADR-003) precedent — and references **zero** record-doc filename and **zero** presence schema.

**Pre-auth security posture (a deliberate, documented scope decision — not a SECURITY.md, ADR-001):** the
relay in m23 carries **no** group credential / relay auth — that is `SPEC §Out of scope` (milestone 24). Its
threat model is **inseparable from m24's enrollment** (group membership is the v1 trust boundary), so the full
model is authored in m24; m23 records only that the relay binds loopback / a trusted LAN by default and
carries opaque ephemeral signals. The pre-auth gap is visible and owned by m24, not silently assumed safe.

**Parallel with story 00 — file-disjoint by construction.** The graph shows the serve subtree
(`board-serve`/`terminal-ws`/the `ws@8`-PTY stack) couples to **none** of `mesh-store.mjs`/`run-store.mjs`/any
record schema (ARCHITECTURE §Story break-down rationale, point 2). `src/mesh-relay.mjs` sits in that same
serving neighbourhood and imports the record-side **nothing** — so story 01 and story 00 share no module. The
only co-touched files are the additive door (`command-core.mjs`'s `COMMANDS` array + `cli.mjs`'s `meshCommand`
dispatcher) — one import/entry/branch/case, no shared line edited (the 07/ADR-006 discipline). **Story 02**
imports this relay's node-side client to push presence; it does **not** change the relay.

**New verb rides the existing gate (inverse-22/R1, CLEAN):** the `aof mesh relay`/serve verb is auto-covered
by the existing `acd-mesh-command-cli-bijection` **provided** this story adds its dispatch branch + `argsFor`
case — m23 authors no new registry-derived gate.

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** `src/mesh-relay.mjs`
`serveRelay({ port }) → { server, url, stop }` is a direct re-application of the
[terminal-ws.mjs](../../../../../src/terminal-ws.mjs) / [board-serve.mjs](../../../../../src/board-serve.mjs)
precedent: one `http.createServer`, a `ws@8` `WebSocketServer` via noServer + `server.on('upgrade')` on a
single relay pathname, broadcast-to-others over the connected-clients set, and the `server.listen(0,
"127.0.0.1", …)` → `server.address().port` readback [setup-ui.mjs](../../../../../src/setup-ui.mjs) already
does (lines 150–156) — so the "url carries the actual assigned port, not the requested 0" scenario is the
existing serve idiom. The frozen `{ kind, nodeId, signal }` envelope + the `{type:'error'}` never-crash
control-frame is the **literal** `03/ADR-003` discipline already shipped in `terminal-ws.mjs` (`sendControl` +
the `parseControl` `try/catch` + the `wireSession` per-mutation guards). Statelessness (fitness #1) and
envelope-neutrality (fitness #2) are grep-enforceable against the same source (no `writeText`/`writeFile` of a
record, no `mesh-store`/`mesh-presence`/`node-identity` import, no `JSON.parse`-then-branch on `signal`). The
control-node gate reads `config.mesh.relay.*` via the same raw optional-chain `mesh-sync.mjs` uses for
`config.mesh.sync.cadenceSeconds` (no schema block needed — the top-level schema has no
`additionalProperties:false`). The `aof mesh relay` dispatch branch + `argsFor` case is load-bearing for the
`mesh:`-bijection gate (the m22 lesson — the bijection test's `argsFor` switch THROWS on an unmapped sub), and
the relay imports the record side **nothing** (file-disjoint from story 00). **The three QA flags resolved:**
**(1) Oversized-frame threshold** — the max frame size is `config.mesh.relay.maxFrameBytes`, a **documented
default of 1 MiB (1048576)**, enforced so the sender gets **OUR frozen `{type:'error'}` control-frame** (a
hand-rolled length check on the inbound frame inside the same `try` that parses the envelope), **not** ws's
protocol-level `1009` close. We **also** set `ws`'s `maxPayload` to the same value as a defence-in-depth floor
(its default is ~100 MiB; we lower it), but the **contract-bearing** path is the hand-rolled check so the
over-limit sender receives the frozen control-frame, not a raw socket close. The `.feature` Outline row "an
oversized frame over the configured limit" now has a concrete literal (1 MiB) — **no `.feature` edit was
needed** (QA left the byte boundary as `<over the configured limit>` deliberately; the literal is recorded
here in build notes, not in the table, exactly as QA intended). **(2) In-process `ws` round-trip determinism
(the 22/R3 caution)** — all scenarios stay `@executable` **in-process**: an in-process `serveRelay` + an
in-process `ws` client over an ephemeral port (`port: 0`), **no `spawn`** — sidestepping the 22/R3
`spawnCliSync` flake entirely. The fan-out / peers-survive / late-joiner assertions DO need a **deterministic
barrier, not a raw timing race**: the relay sends each client a frozen **join-confirm / ack-on-connect
control-frame** (`{ type:'joined' }`) on `wss.on('connection')`, and the test awaits each peer's ack **before**
the sender publishes — so a peer is *provably registered in the broker's clients set* before the publish, not
merely `open` at the socket layer. The late-joiner scenario is the same barrier inverted (await B's ack, then
publish "late"). **(3) The relay-mode config gate as an in-process seam** — "stand up relay mode on a node" is
the in-process `serveRelay` core gated on a config read, exposed as a unit-testable seam
`relayMode(config, { port }) → serveRelay(...) | null` that serves **only** when
`config.mesh.relay.controlNode === config.mesh.nodeId`, returning `null` (a clean no-op, no listener bound)
otherwise — so the nominated / not-nominated branch and the "records byte-unchanged on relay death" invariant
are reachable in `@executable` form **without** spawning a second OS process (the invariant is asserted by
recording on-disk bytes, calling `stop()`, and re-reading).

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Implementation guidance surfaced at Contract; none is a contract defect (no `.feature`/ADR change). -->

- **`serveRelay({ port }) → { server, url, stop }` is the `board-serve`/`terminal-ws` clone.** One
  `http.createServer`; a single `WebSocketServer({ noServer: true })`; `server.on('upgrade')` routing by
  pathname to **one** relay path (`socket.destroy()` everything else — the `terminal-ws` default branch);
  `wss.handleUpgrade → wss.emit('connection')`. Bind `server.listen(0, "127.0.0.1", …)` and build `url` from
  `server.address().port` (the `setup-ui.mjs` readback) so the ephemeral-port scenario is honest. `stop()`
  closes the `wss` + `server` (the `serveBoard`/`serveSetupUi` disposable-serve-unit discipline) — pin the
  "already-open connection is closed, not left dangling" half by closing live sockets on teardown. Default
  bind is loopback (the pre-auth posture, ADR-001).
- **Fan-out is broadcast-to-others over the connected-clients set.** Keep the live `ws` set (add on
  `connection`, delete on `close`); on a valid frame, iterate the set and `ws.send` to **every client except
  the sender** (no self-echo — the headline scenario). Hold the in-flight frame in memory only — **no**
  `writeText`/`writeFile`, **no** record import (fitness #1/#2 grep exactly this). The "late joiner misses the
  early frame" property falls out for free: a client absent from the set at publish time is never iterated.
- **Use an ack-on-connect (join-confirm) barrier, NOT a raw `open` await, for every fan-out assertion.** On
  `wss.on('connection')`, after registering the socket in the clients set, `ws.send(JSON.stringify({
  type:'joined' }))`. The test awaits each peer's `{type:'joined'}` ack before the sender publishes — this is
  the *deterministic* proof the peer is in the broadcast set (the raw `open` event fires before the
  server-side `connection` handler has registered the socket, which is the 22/R3-class race the QA flagged).
  The late-joiner scenario awaits B's ack, *then* publishes "late". This makes the ordering-sensitive
  scenarios reproducible on Windows/CI with no timing sleeps.
- **`config.mesh.relay.maxFrameBytes` default 1 MiB (1048576); enforce via a hand-rolled length check, not
  only ws `maxPayload`.** Inside the inbound-message handler, FIRST check the frame byte-length against the
  configured limit (read via `config?.mesh?.relay?.maxFrameBytes ?? 1048576`); over-limit ⇒ send the frozen
  `{ type:'error', message }` control-frame to the **sender only** and return (do not forward, do not crash).
  Set `new WebSocketServer({ noServer:true, maxPayload })` to the same value as a defence-in-depth floor, but
  the contract path is the hand-rolled check (ws's `maxPayload` would otherwise `1009`-close the socket — the
  WRONG observable; the contract is OUR frozen control-frame). A malformed / non-JSON frame takes the same
  error-control-frame path (the `terminal-ws` `parseControl` `try/catch` shape, never a throw). The peer is
  untouched on every bad-frame row (error goes to the sender only; nothing is forwarded).
- **The envelope is opaque about `signal` — route by frame, never branch on content.** Parse only enough to
  read `{ kind, nodeId }` for routing; forward `signal` **byte-for-byte unparsed** (the payload-agnostic
  Outline spans known/unknown `kind` and JSON/non-JSON `signal`). Do **no** `JSON.parse`-then-branch on
  `signal` content (fitness #2 greps for exactly this) — an unknown `kind` (m26 leasing) is forwarded, not
  rejected.
- **`relayMode(config, { port }) → { server, url, stop } | null` is the in-process config gate.** Serve only
  when `config.mesh.relay.controlNode === config.mesh.nodeId` (read via the raw optional-chain
  `mesh-sync.mjs` uses — no schema block, the top-level schema has no `additionalProperties:false`);
  otherwise return `null` — a clean no-op, no listener bound, no port taken (the not-nominated scenario).
  Re-nomination is purely re-pointing `config.mesh.relay.controlNode` + calling `relayMode` on the new node —
  no election message is exchanged (the scenario asserts the absence of a vote). This keeps the
  nominated/not-nominated branch and the byte-unchanged-on-death invariant `@executable` with no second OS
  process.
- **The `argsFor` case is load-bearing (the m22 lesson).** Add the `aof mesh relay` dispatch branch in
  `cli.mjs`'s `meshCommand` ladder (the exact `subcommand === "relay"` form the
  `acd-mesh-command-cli-bijection` grep requires, ABOVE the unknown-sub fallthrough) **and** the matching
  `argsFor("relay")` case in `test/arch/acd-mesh-command-cli-bijection.test.mjs` in the SAME change that
  registers the verb — the bijection test's `argsFor` switch THROWS on an unmapped sub, so the gate stays RED
  otherwise. Note `aof mesh relay` is a long-lived serve verb, so the `argsFor("relay")` invocation must be a
  form that runs clean + parseable and **returns** (e.g. a `--json` usage/dry-run probe, mirroring how the
  serve face advertises without blocking) rather than blocking on `listen` — shape the verb so its
  bijection-probe path is non-blocking.
- **Coordination note (additive co-touch, not a defect):** this story appends to `command-core.mjs`'s
  `COMMANDS` array, `cli.mjs`'s `meshCommand` ladder, and the bijection test's `argsFor` switch — a textual
  add-only merge (different lines, same files) parallel to story 00's adds, the standard 07/ADR-006 co-touch.
  The relay module itself (`src/mesh-relay.mjs`) is file-disjoint from every story-00 module.
