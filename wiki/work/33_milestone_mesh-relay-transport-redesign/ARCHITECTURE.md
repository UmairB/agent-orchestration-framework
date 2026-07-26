---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 33 · Mesh Relay/Transport Redesign (Tailscale-first) — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — a **mesh-VPN-native** coordination/transport/
> identity layer: a runnable coordination launcher, fabric-native reachability, per-install identity;
> re-accepting 18–28 is out of scope — the record-store / partition / run-lifecycle / issuance model are
> **reused**), `STATE.md` (the standing instruction **"Pin the fabric before the coordination layer"** —
> the fabric ADR is FIRST, coordination is designed on top), `RESEARCH.md` (the Tailscale facts:
> `tailscale status --json` returns `Self` + every `Peer` in the identical `PeerStatus` struct with
> `TailscaleIPs`/`DNSName`/`HostName`/`Online`; `Online` is control-plane-authoritative but
> **necessary-not-sufficient** for dialable — `--shields-up`/ACL are silent; the peer map is keyed by
> node public key, needing a `HostName`/`DNSName` join to aof's hostname-derived nodeId; the biggest risk
> is the macOS App-Store-vs-Standalone CLI split; `--json` is "format subject to change"), and UAT 32
> `SESSION.md` findings **F-3201..F-3204** (verbatim scope anchors).
>
> **The precedents this milestone APPLIES and never re-litigates: milestone 08 (cli-command-core), 03
> (the terminal-WS serve/envelope), 22 (the mesh foundation + partition), 23 (the relay + presence +
> push-for-liveness/poll-for-durability), 12 (the managed-tool store — for any spawned fabric CLI).**
> This milestone **reworks the transport/identity/launcher**; the record model is inherited whole.
>
> **The seam — grounded in the codebase graph, cited as ACTUAL structure, not inferred.** `aof graph build
> src` was run fresh at author time → **1296 nodes / 3524 edges, 43 communities, egress none, builtAt
> 2026-07-04** (readback surfaced so the boundary is not drawn over a stale graph). `aof graph impact` on
> the files under review returned, deterministically from the graph's edges:
> - `src/node-identity.mjs` → dependents ← `commands/mesh-heartbeat.mjs`, `commands/mesh-identity.mjs`
>   (2); dependency → `fs.mjs` (1). **Cleanly isolable from transport** — the identity split cuts here
>   and touches nothing in the relay/presence bus.
> - `src/mesh-relay.mjs` → dependents ← `commands/mesh-invite.mjs`, `commands/mesh-relay.mjs`,
>   `mesh-presence-subscriber.mjs` (3); dependency → `mesh-registry.mjs` (1). The broker + auth-gate +
>   device-flow-enrollment cluster.
> - `src/mesh-relay-client.mjs` → dependents ← `commands/mesh-heartbeat.mjs`, `commands/run-start.mjs`,
>   `mesh-presence-cache.mjs` (3). `src/mesh-presence-subscriber.mjs` → dependency `mesh-relay.mjs`;
>   `src/mesh-presence-cache.mjs` → dependency `mesh-relay-client.mjs`. **The relay-bus cluster.**
> - `src/mesh-presence.mjs` → dependents ← `commands/mesh-heartbeat.mjs`, `commands/mesh-identity.mjs`,
>   `commands/next.mjs`, `commands/run-start.mjs`, `mesh-lease.mjs` (5); dependencies → `fs.mjs`,
>   `mesh-store.mjs`, `run-store.mjs` (3). The **git-side presence substrate — REUSED** (records stay).
> - `src/mesh-store.mjs` is the substrate hub (10 dependents — issuance/lease/presence/registry/sync +
>   run-start/next/mesh-issue). **REUSED — untouched.**
> The graph **informs** these boundaries; it never **dictates** them — the verdict/partition below is
> mine, citing the graph as one input.
>
> **Prior-lesson recall** (`work memory recall` per ADR-topic, `--area architecture --block`) surfaced
> live near-misses; each is honoured or a conscious departure is stated:
> - **23/ADR-001 — the thin relay is a stateless `ws@8` broker on the nominated control node, a
>   re-nominate-able role, carrying an OPAQUE payload-agnostic envelope.** **CONSCIOUS DEPARTURE (ADR-002
>   below):** the redesign *retires the broker as the presence/liveness transport* — the mesh VPN already
>   supplies a control plane, so a second aof-run broker for liveness is the redundant overhead F-3204
>   named. What survives of 23/ADR-001 is the *serve-unit discipline* (`serveRelay`'s one-shot
>   `http.createServer` + thin-face shape), re-used by the ADR-003 launcher — not the hub-and-spoke role.
> - **23/ADR-002 + 22/ADR-002/003 — presence is a git-tracked, derived, one-node-per-path record keyed by
>   `nodeId`.** **HONOURED — load-bearing:** the git presence dimension (`mesh-presence.mjs`, poll-for-
>   durability) is the reused floor; only the ≤5s relay *accelerator* changes. The partition invariant
>   (`acd-mesh-partition-write`) is exactly what F-3203's shared-nodeId bug violated — the identity split
>   (ADR-004) restores it.
> - **22/R2 + 06/R2 — two surfaces that write the same config subtree must share ONE read/merge/write
>   helper.** **HONOURED (ADR-004):** the sidecar identity read + the config `mesh` read + the doctor
>   migrate-warn all go through ONE hydration seam in `work.mjs loadWorkspace`; the persist is the SAME
>   read-merge-write idiom `persistNodeId` already uses, re-pointed from committed config to the sidecar.
> - **22/ADR-003 — node identity is derived, stable, per-node.** **HONOURED but its PERSISTENCE TARGET is
>   superseded (ADR-004):** derivation-from-hostname and the pinned-id-wins precedence are kept; the
>   *persist destination* moves from committed `config.mesh.nodeId` to the git-ignored sidecar — the exact
>   fix for identity-inherited-on-clone (F-3203). `node-identity.mjs:74`'s "pinned wins verbatim" stays,
>   but the pin now lives per-install, so a clone no longer inherits it.
> - **06/ADR-002 — a designed graduation path may be DESIGNED without being SHIPPED (the schema rejects
>   the un-shipped mode).** **HONOURED (ADR-001):** the non-VPN fabric case is *designed as a seam* but
>   NOT shipped — the fabric resolver ships Tailscale-only and any other fabric value is a clean refusal
>   until a later story implements it.
> - **08/ADR-001 — CLI-as-contract over ONE in-process command core; serve is a thin face over a one-shot
>   core.** **HONOURED (ADR-003):** the launcher is a registered `mesh:*` command whose *registered run is
>   a non-blocking probe* (the 23 precedent that keeps `acd-mesh-command-cli-bijection` honest); the
>   long-lived serve is the face/`--serve` path over the one-shot core, never the bijection-probed run.
>
> ADRs below cite these as `NN/ADR-00n` / `SPEC §…` / `STATE §…` / `RESEARCH §n` / `F-320x`.

---

## ADR-001: Pin the fabric FIRST — a mesh-VPN (Tailscale/WireGuard) is the pinned transport; the fabric assumption is a config declaration RECONCILED by a runtime probe; the pluggable seam is ONE narrow resolver (Tailscale-only shipped, other fabrics a later-story refusal)

**Status:** Accepted
**Date:** 2026-07-04

**Context.** `STATE §Notes` is explicit: decide the network fabric before designing coordination, because
the hub-and-spoke relay was built without that decision and most of its machinery (broker, tunnel-punch,
device-code) re-solves reachability/NAT/identity that a mesh VPN already solves (F-3204). `RESEARCH §5`
establishes the load-bearing fact: on Tailscale every `Online` peer is *directly dialable at `100.x.y.z`*
in the common case (>90% direct, DERP-fallback transparent to the socket) — the app dials an IP:port and
never selects a transport. `RESEARCH §6` establishes the seam shape: Tailscale is **a topology, not a
provider** — a naive `provider: tailscale | lan | tunnel` enum-with-one-shape would model three genuinely
different addressing primitives as one interface (the Docker-network-driver lesson). `SPEC §Scope` scopes
non-VPN fabrics OUT beyond a pluggable seam. `RESEARCH`'s open question — *sidecar probe vs static config
declaration* — is decided here.

**Decision.**
1. **The pinned transport is a mesh VPN; Tailscale is the shipped fabric.** Every reachability decision
   assumes "the fabric gives each node a stable, directly-dialable address and handles NAT." This
   assumption is asserted in **exactly one place**: a `src/mesh-fabric.mjs` module (NEW) that owns the
   fabric abstraction. No other module hard-codes `tailscale`, a `100.x` range, or a `ws://` URL derivation.
2. **Declaration + reconciliation, not one or the other.** The operator's *intent* is a static config
   declaration (`config.mesh.fabric = "tailscale"`, fleet-shared/committed — ADR-004). The *truth* is a
   runtime probe (`tailscale status --json` → `BackendState`/`Self`/`Peer`, `RESEARCH §2/§4`). When they
   disagree, the **probe is authoritative for behaviour and the declaration is authoritative for intent**:
   a declared-tailscale fabric whose probe returns `BackendState !== "Running"` or ENOENT is a *degraded*
   fabric — the launcher/doctor surface a structured, actionable refusal (`RESEARCH §4`'s two-stage probe:
   ENOENT ⇒ "install Tailscale"; `NeedsLogin` ⇒ "run `tailscale up`"; `Stopped`/`NeedsMachineAuth` ⇒ the
   matching message) — never a crash, never a silent wrong-address.
3. **The pluggable seam is ONE narrow function, not a provider hierarchy.** `mesh-fabric.mjs` exposes a
   minimal fabric interface — the smallest surface F-3204's "topology not provider" framing tolerates:
   - `probeFabric(config)` → `{ fabric, state, healthy, reason }` (the two-stage liveness probe);
   - `selfAddress(config)` → this node's dial address (`tailscale ip --4` / `Self.TailscaleIPs`);
   - `resolvePeers(config)` → `[{ nodeId, dialAddress, online, host }]` — the peer map parsed from
     `tailscale status --json`, **joined to aof `nodeId` by `HostName`/`DNSName`** (ADR-002).
   Shipped implementation: Tailscale only. A `config.mesh.fabric` value other than `"tailscale"` is a
   clean structured refusal ("fabric X is not yet supported — this build targets tailscale"), NOT a crash
   and NOT a hidden fallback — the 06/ADR-002 "designed-not-shipped" discipline. Raw-LAN / public-tunnel
   are a **later story at most** (`SPEC §Scope`); the seam exists so that story is additive.
4. **The macOS App-Store client-split risk (`RESEARCH §3`) is owned here as a doctor preflight** (see
   Consequences) — it is a fabric-health concern, so it lives beside `probeFabric`, surfaced by the
   launcher's preflight and `work doctor`.

**Consequences.**
- A NEW module `src/mesh-fabric.mjs` is the single fabric-assumption site. Fitness function
  **`acd-fabric-single-seam`** (ADR-006) asserts the fabric CLI spawn + peer-address resolution live only
  here (no other src module spawns `tailscale` or derives a peer dial address) — this is the "no
  hand-derived/committed `ws://` URL; the transport resolves peer addresses from the fabric" invariant
  F-3202/F-3204 imply.
- The fabric CLI is spawned via the shell-less `execFile("tailscale", [...])` argv idiom already used for
  `git` (`acd-enroll-git-argv-no-shell` precedent), with a timeout (fire-and-parse, never a blocking
  daemon call — `RESEARCH §4`). On Windows, a bare-`tailscale` ENOENT falls back to the well-known install
  path before concluding "not installed" (`RESEARCH §3`).
- **macOS App-Store degradation (`RESEARCH #4`):** a `work doctor` / launcher-preflight check runs
  `probeFabric` and, on macOS, warns when the CLI cannot reach the daemon (the App-Store-sandbox symptom),
  steering the operator to the Standalone / open-source `tailscaled` build. This is install-guidance, not
  a runtime auto-fix — the transport can only report "the fabric CLI failed, here is why."
- `--json` is "format subject to change" (`RESEARCH §2`): parsing is tolerant (read the fields we need,
  tolerate unknowns, treat a parse failure as a degraded-fabric refusal), NOT a version-pin/shim (accepted
  low risk; revisit only if a live break is observed — an `@manual` watch item).

---

## ADR-002: Topology — the F-3204 call: the central WebSocket broker is ELIMINATED as the presence/liveness transport; the fabric IS the discovery+liveness plane; presence + issuance ride direct-addressability. A residual coordinator survives ONLY as an issuance-authority ROLE, not a network broker

**Status:** Accepted · **Amended 2026-07-05** (scope narrowed — see amendment note below; original text is immutable and unedited)
**Date:** 2026-07-04

> **Amendment note (2026-07-05) — added at the landing of milestone 34 / story 04, per 34/ADR-007's
> required supersession.** This ADR's headline "the central WebSocket broker is ELIMINATED" now holds only
> for **PRESENCE / liveness**: the fabric remains the discovery+liveness plane and no aof-run broker fans
> out presence (decisions 1–4 stand unchanged). It does **NOT** hold for real-time **WORK-STATE**: milestone
> **34/ADR-007** deliberately **reintroduces a continuously-running persistent-connection server** on the
> control node — the same *class* of machinery this ADR retired (a long-lived socket server + reconnecting
> clients + heartbeat), but a different *purpose* (a worker→control work-state ingest stream, not a
> control→subscriber presence fan-out) and *direction* (workers dial the control node). Read this ADR's
> "broker eliminated" as **"eliminated for presence; a work-state stream server is reintroduced in
> 34/ADR-007."** Decision 5 (the issuance-authority *role* is a git-write role, not a network broker) is
> unaffected — the 34 stream server is a *separate* always-on daemon face on the same control node, not a
> revival of `serveRelay`'s presence broker. See **34/ADR-007** for the honest reckoning, the connection
> lifecycle, and the admission-boundary open question (34/ADR-007 open Q4, validated by the @manual
> two-machine soak). The retired-guard treatment for `acd-relay-auth-gate-checked` and its siblings
> (Consequences / the ledger below) is unchanged: those guarded the *presence* broker and stay retired;
> 34's stream server ships its OWN admission fitness (`acd-control-stream-tailnet-only`).

**Context.** This is the load-bearing decision. F-3204: the central control-node WebSocket broker +
device-code enrollment + git-remote grant + loopback-bind-needing-tunnels re-solves reachability/NAT/
identity a mesh VPN already handles. `RESEARCH §2`: `tailscale status --json` already enumerates the
fleet (`Self` + `Peer` map) and maintains `Online` as a control-plane-authoritative liveness signal — the
exact job `mesh-relay.mjs`'s broker + `mesh-presence-subscriber`/`mesh-presence-cache` relay bus were
built to do. `RESEARCH §5`: `Online` is necessary-but-not-sufficient — `--shields-up`/ACL are silent
failure modes; a connect attempt is ground truth. The `RESEARCH` open question — *central coordinator vs
fully peer-to-peer for aof's own coordination* — is decided here.

**Decision.**
1. **Eliminate the broker as the presence/liveness transport.** The `ws@8` broker in `mesh-relay.mjs`
   (`serveRelay`'s fan-out `clients` Set), the persistent relay subscriber (`mesh-presence-subscriber.mjs`),
   and the relay liveness cache (`mesh-presence-cache.mjs`) are **retired as the liveness path**. The ≤5s
   relay-push accelerator (23/ADR-003 push-for-liveness) is replaced by a **fabric-native liveness read**:
   `resolvePeers(config)` (ADR-001) parses `tailscale status --json`, and a peer's `Online` is the fast
   liveness pre-filter that the relay cache used to supply. There is no aof-run broker for presence.
2. **The fabric IS the discovery plane.** Peer discovery = parse the peer map; no aof discovery protocol,
   no device-code dance, no relay URL. A node enumerates the fleet by reading one JSON blob and joining
   each `Peer` to an aof `nodeId` via `HostName`/`DNSName` (`RESEARCH §2`; the join key is deterministic
   because aof's `deriveNodeId` also sanitizes from hostname — `node-identity.mjs:81`).
3. **`Online` ≠ dialable — the connect attempt is ground truth.** `resolvePeers` returns `online` as a
   pre-filter; any code that acts on a peer address treats a connect-refused (shields-up / ACL-deny / a
   peer that dropped between snapshot and dial, `RESEARCH §5`) as a normal, handled outcome distinct from
   "offline" — surfaced to the operator as "unreachable (check shields-up/ACL)", never a crash.
4. **Git stays the durable authority — UNCHANGED.** `mesh-presence.mjs` (the git presence record,
   poll-for-durability) and `mesh-sync.mjs` (the git record transport) are **reused verbatim** — the
   ADR-002/22 partition + the `acd-mesh-sync-record-neutral` invariant are untouched. What changed is
   only the *fast-path* (relay cache → fabric peer-map read); the durable floor is the same git records.
5. **A residual coordinator survives ONLY as an issuance-authority ROLE, not a network broker.** aof still
   needs *one* node designated as the issuance/registry authority (`config.mesh.relay.controlNode` — the
   m24/m27 write-authority for the group registry + issuance directives). That role is **retained** (it is
   a git-record-write role, not a reachability broker) but **decoupled from any listening socket**: on the
   fabric, "the control node" is just a nodeId whose git records other nodes read/sync — reached by its
   fabric address, needing no `/ws/relay` and no tunnel. Re-nomination stays "re-point the config key"
   (23/ADR-001's no-election property, preserved).

**Consequences.**
- **`mesh-relay.mjs`'s broker retires; the device-flow enrollment + auth-gate go with it.** Once "already
  on the tailnet" is the admission boundary (ADR-003), the `/enroll` HTTP route, the 6-digit device code,
  the per-source attempt buckets, and the ws upgrade auth-gate are no longer the trust mechanism. The
  build story MUST call out that **`acd-relay-auth-gate-checked` legitimately RETIRES or MOVES** — it
  guards a broker that no longer brokers presence. (See the Fitness-function ledger below — this is the
  one reused-substrate guard that intentionally changes.) The enrollment *code* may remain as a
  deprecated/optional second admission step (RESEARCH open question), but it is no longer load-bearing.
- **Presence render reconciles two sources still, but the fast source changes.** `mergePresence`
  (`mesh-presence.mjs`) reconciled disk (git) vs relay-cache; it now reconciles disk vs the fabric
  peer-map liveness. `mesh-presence.mjs`'s git-record assembly/read is unchanged; the cache import is
  what's replaced.
- **NEW invariant, structurally checkable:** the transport resolves peer dial addresses from the fabric,
  never from a committed/hand-derived `ws://` URL. Encoded as **`acd-fabric-single-seam`** (ADR-006):
  `config.mesh.relay.url` / `createRelayClient`-style URL-from-config peer dialing is not the reachability
  path; `mesh-fabric.mjs`'s `resolvePeers` is. (The `.url` config key may survive as a deprecated no-op
  for one release; the invariant is that reachability does not *depend* on it.)
- **This ADR MERGES SPEC's provisional stories (2) and (3).** Because the broker is eliminated, there is
  no separate "coordination launcher over a broker" — the launcher (ADR-003) becomes a *per-node fabric
  presence/sync daemon*, and "fabric-native transport/reachability" is the same story's substrate. See
  the story decomposition: the topology ADR collapses provisional-(2)+(3) into one **fabric-native
  transport + launcher** story.

---

## ADR-003: The coordination launcher (F-3201) is a per-node foreground presence+sync daemon — a real `mesh:*` serve verb whose registered run stays a NON-BLOCKING probe (bijection-safe), whose serve path binds the fabric address and drives per-fabric operator guidance (F-3202)

**Status:** Accepted
**Date:** 2026-07-04

**Context.** F-3201: no long-lived serve verb ever shipped — `aof mesh relay` is only the non-blocking
probe, the long-lived serve was "the launcher's job" (`command-core.mjs:126`) and m28 node mode ships
"everything but mesh relay" (`cli.mjs:42`). F-3202: even when it serves, nothing tells the operator how
the node becomes reachable — they hand-derive URLs and stand up Tailscale unguided. ADR-002 eliminated the
broker, so the launcher is no longer "serve a broker" — it is the per-node process the fabric-native model
needs. `08/ADR-001` + the 23 precedent constrain how a serve verb registers without breaking
`acd-mesh-command-cli-bijection` (the registered run must not `listen()`/block).

**Decision.**
1. **The launcher is a per-node presence+sync daemon, not a coordinator/broker.** Its job on the fabric:
   (a) **preflight** the fabric via `probeFabric` (ADR-001) and refuse-with-guidance if degraded; (b)
   publish this node's git presence record + run the `mesh:sync` cadence loop (the reused
   `startSyncLoop`); (c) periodically read `resolvePeers` so `mesh:status` reflects live fabric liveness.
   It stands up **no listening broker socket** — the fabric supplies reachability, git supplies durability.
   (The issuance-authority node runs the same daemon; being the control node is a git-write role, ADR-002,
   not a second process.)
2. **Registered on the spine as a `mesh:*` command whose registered run is the NON-BLOCKING probe** — the
   exact 23 shape (`mesh-relay.mjs relayStatus`, `commands/mesh-relay.mjs`): `aof mesh <serve> --json`
   reports the resolved fabric state + self-address + peer count + whether this node is the issuance
   authority, and RETURNS. The long-lived foreground serve is a `--serve` face path over the one-shot
   daemon core (or a distinct blocking flag) — NEVER the bijection-probed run. So
   `acd-mesh-command-cli-bijection` stays green (the probe runs clean + parseable + returns), and the new
   verb rides that existing gate (it takes the `mesh:` prefix — one import + one `COMMANDS` entry + one
   `meshCommand` branch + one `argsFor` case, per 22/R1).
3. **Bind + lifecycle:** no bind of an aof broker port; the "bind" is the fabric self-address resolved via
   `selfAddress` (ADR-001). Lifecycle is the serve-unit discipline (23/ADR-001): a foreground process that
   traps SIGINT/SIGTERM and stops the sync loop + presence publisher cleanly (the prototype's serve →
   stop, `STATE §Prototype context`). No tunnels, no loopback-needing-a-tunnel.
4. **Per-fabric operator guidance (F-3202)** is emitted by the launcher's preflight, sourced from
   `mesh-fabric.mjs`: for tailscale → resolve + print the self-address and the guidance "both nodes must
   be on the same tailnet; ensure `tailscale status` shows the peer `Online`; if a dial is refused, check
   `--shields-up`/ACLs" (`RESEARCH §5`). A degraded probe prints the matching `RESEARCH §4` remediation.

**Consequences.**
- One NEW `mesh:*` verb (the daemon face) + one launcher module (thin over the reused `startSyncLoop` +
  the reused `publishPresenceRecord` + the new `mesh-fabric.mjs` reads). It imports the record side only
  through the existing reused seams — no new partition/write path, so `acd-presence-write-scope` /
  `acd-mesh-write-scope` stay green.
- The launcher is where the **macOS App-Store preflight** (ADR-001 consequence) actually runs for an
  operator standing up a node — the same `probeFabric` doctor check, surfaced at launch.
- Console-app node mode (m28 "everything but mesh relay") can now include this daemon — but re-accepting
  m28 is out of scope; this ADR only makes the verb real.

---

## ADR-004: Per-install identity split (F-3203) — `config.mesh` splits into fleet-shared (committed) vs per-install identity (`nodeId`/`salt`) persisted to the git-ignored sidecar `.aof/mesh/identity.json`; `config.mesh.nodeId` is hydrated from the sidecar at `loadWorkspace`; committed `mesh.nodeId` stays a back-compat fallback + a doctor migrate-warn; self-heals on hostname/nodeId mismatch

**Status:** Accepted
**Date:** 2026-07-04

**Context.** F-3203 root cause: `config.mesh.nodeId` + `mesh.salt` live in the **committed**
`.aof/aof.config.json` (confirmed on the current file — it still carries `salt` + `nodeId: umairs-msi`),
and `deriveNodeId` honours a pinned id **verbatim** (`node-identity.mjs:74-78`). So a clone inherits the
origin machine's identity — the observed macOS node deriving `umairs-msi`. Two machines sharing a nodeId
both own `nodes/<id>.json` at the same path, violating the m22 one-node-per-path partition invariant
(`acd-mesh-partition-write`). The same rationale that git-ignores `mesh/` applies to `mesh.nodeId`/`salt`:
machine-specific state must not be committed. `22/R2`/`06/R2` (one read-merge-write helper per config
subtree) and `22/ADR-003` (derived, stable id) constrain the fix.

**Decision.**
1. **Split `config.mesh`.** *Fleet-shared* (committed, identical for every clone): `relay.controlNode`
   (the issuance-authority nodeId) + successor, `fabric` (ADR-001), transport/enrollment config.
   *Per-install identity* (git-ignored): `nodeId`, `salt` — persisted to a NEW sidecar
   `.aof/mesh/identity.json`, under the already-ignored `mesh/` tree (`.aof/.gitignore` ignores `mesh/`
   already — **no new ignore entry needed**).
2. **Derive from hostname by default; persist to the SIDECAR, never committed config.** `deriveNodeId`'s
   hostname-derivation + pinned-wins-verbatim precedence (`node-identity.mjs`) is kept, but its persist
   target (`persistNodeId`, currently writing `config.mesh.nodeId` in the committed file) is re-pointed to
   the sidecar via the SAME read-merge-write idiom. The pin now lives per-install, so a clone derives its
   OWN id from its OWN hostname — the fix.
3. **Hydrate `config.mesh.nodeId` from the sidecar on load — downstream readers unchanged.** In
   `work.mjs loadWorkspace` (which returns `{ configPath, config, projectRoot, workDir, aofDir }` —
   confirmed `work.mjs:42-58`), after reading config, read `.aof/mesh/identity.json` and overlay its
   `nodeId`/`salt` onto `config.mesh` in the returned in-memory workspace. Every downstream reader
   (`config.mesh.nodeId` optional-chain: `mesh-relay.mjs`, `mesh-presence.mjs`, issuance, lease) sees the
   per-install id with ZERO change — hydration lands in `loadWorkspace`, NOT `runtime-config.mjs` (that is
   runtime-file generation, a different concern).
4. **Back-compat + migration.** A committed `mesh.nodeId` (legacy installs) stays a **fallback**: if no
   sidecar exists, the committed value is used AND `work doctor` warns "per-install identity is in
   committed config — run the migrate to move it to `.aof/mesh/identity.json` (F-3203)". Precedence:
   sidecar > committed-fallback > hostname-derive.
5. **Self-heal on hostname/nodeId mismatch.** If the sidecar's `nodeId` was derived from a hostname that
   no longer matches this machine's hostname (the clone/copy symptom), re-derive from the current hostname
   and rewrite the sidecar — so a copied `.aof/mesh/identity.json` also self-corrects, not only committed
   config.

**Consequences.**
- **NEW fitness function `acd-mesh-identity-not-committed`** (ADR-006): no per-install identity
  (`nodeId`/`salt`) appears in committed config (`.aof/aof.config.json` / the config schema). **This is
  RED against the current committed config** (which still has `mesh.salt` + `mesh.nodeId`), so it ships
  **pending** (a self-green placeholder object with an explicit un-skip comment) and **turning it green —
  by migrating the committed config to the sidecar — is the identity story's Definition-of-Done.**
- `acd-mesh-partition-write` (the invariant F-3203 broke) is restored the moment identity is per-install;
  it stays green throughout (it guards `mesh-store.mjs`, untouched).
- `node-identity.mjs`'s only dependents are `commands/mesh-heartbeat.mjs` + `commands/mesh-identity.mjs`
  (graph, actual) — so re-pointing the persist target and adding sidecar read/write is a **clean cut** that
  touches nothing in the transport/launcher work. This is why the identity story is independent (partition
  below).

---

## Fitness-function ledger (Deliverable 2 — for the build stories)

**NEW (this milestone):**
- **`acd-mesh-identity-not-committed`** (F-3203, ADR-004) — no `nodeId`/`salt` in committed config /
  schema. Authored under `test/arch/` and wired into the runner, but ships **PENDING** (a self-green
  placeholder with an explicit "un-skip + make green by milestone 33's per-install-identity story —
  F-3203" comment), because the current committed `.aof/aof.config.json` still carries both keys and a
  live assertion would be RED (breaking the 2221/0 suite). **Turning it green is the identity story's DoD.**
- **`acd-fabric-single-seam`** (F-3202/F-3204, ADR-001/002) — the fabric CLI spawn + peer-dial-address
  resolution live ONLY in `src/mesh-fabric.mjs`; no other src module spawns `tailscale` or derives a peer
  address from a committed/hand-derived `ws://` URL (the "transport resolves addresses from the fabric,
  never a hand-derived URL" invariant). `mesh-fabric.mjs` does not exist yet, so this ships **PENDING**
  too (self-green placeholder, un-skip comment), made green by the fabric-native transport story.

**REUSED-SUBSTRATE GUARDS that MUST STAY GREEN through the redesign** (they guard the reused record model):
- `acd-mesh-partition-write` — one-node-per-path (the invariant F-3203 broke; restored by ADR-004).
- `acd-mesh-sync-record-neutral` — git-sync stays payload-agnostic; the git transport is reused verbatim.
- `acd-mesh-write-scope` / `acd-presence-write-scope` / `acd-issuance-write-scope` / `acd-lease-write-scope`
  — the partition/write seams are untouched.
- `acd-mesh-command-cli-bijection` — the new launcher verb rides it (ADR-003: registered run is a
  non-blocking probe, never a blocking `listen()`).

**REUSED GUARD that LEGITIMATELY CHANGES** (called out so the build story knows — ADR-002 consequence):
- `acd-relay-auth-gate-checked` — it guards the ws upgrade auth-gate in `mesh-relay.mjs`. ADR-002
  eliminates the broker as the liveness transport and "already on the tailnet" becomes the admission
  boundary, so this guard **retires or moves**. The build story removing the broker MUST atomically retire
  this arch-test (and unwire it from `scripts/test.mjs`) with an explicit supersession note — do NOT leave
  it asserting a broker that no longer brokers. (Its siblings `acd-relay-stateless`/`acd-relay-envelope-
  neutral`/`acd-relay-lease-blind` share the broker's fate — same supersession treatment when the broker
  is removed.)

---

## ADR-006: Fitness-function encoding note (how the NEW invariants are structurally checked)

**Status:** Accepted
**Date:** 2026-07-04

`acd-mesh-identity-not-committed` reads the committed config (`.aof/aof.config.json`) + the config schema
(`aof.schema.json`) and asserts neither carries `mesh.nodeId`/`mesh.salt` — a JSON/AST read, not a grep
(the values are structural). `acd-fabric-single-seam` is the house source-discipline grep (comment-and-
string-stripped live code, per `acd-mesh-sync-record-neutral`): the `tailscale`-spawn call-form and the
peer-dial-address resolution appear only in `src/mesh-fabric.mjs`; no other src module's live code spawns
`tailscale` or dials a peer from a config `ws://` URL. Both are non-vacuously self-checked (each matcher
fires on the forbidden form and does not fire on a documented mention). Both ship pending now (their
target modules/migrations land in the build stories) and are made live by the story that owns them — the
invariant is captured at Decide time without reddening the current suite.
