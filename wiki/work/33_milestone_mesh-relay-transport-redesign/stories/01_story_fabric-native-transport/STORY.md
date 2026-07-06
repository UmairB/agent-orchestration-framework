---
type: story
number: 01
slug: fabric-native-transport
title: "Fabric-native transport + coordination launcher — a mesh-VPN-native reachability model (Tailscale) + a runnable per-node presence+sync daemon; retire the WebSocket broker; peers + liveness ride the fabric peer-map (F-3201/F-3202/F-3204)"
parent: 33
status: done
owner: product-owner
created: 2026-07-04
updated: 2026-07-05
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · Fabric-native transport + coordination launcher — the mesh IS the fabric

## User story

As an operator **standing up a ≥2-node, cross-OS fleet over Tailscale**,
I want each node to discover its peers **and their liveness from the fabric itself** (`tailscale status --json`)
and to run **one operator-runnable presence+sync daemon** — with **no central WebSocket broker, no device-code
enrollment, no hand-derived `ws://` URLs, and no tunnels**,
so that **"issue anywhere, run anywhere, watch from one place"** works on the real mesh-VPN fabric: a fresh
operator runs one verb, is **guided** if the fabric is degraded, and **sees every node + assigns and runs work
end-to-end** — without re-solving the reachability/NAT/identity the VPN already handles. This closes **UAT 32 ·
F-3201** (no launcher shipped), **F-3202** (no reachability model), and **F-3204** (the broker is the wrong
abstraction for a mesh-VPN transport).

<!-- The topology rewrite (ADR-002): the ws@8 broker + relay subscriber + relay cache RETIRE as the liveness
     path; the fabric peer-map is the discovery+liveness plane; git presence/sync stay the durable floor. The
     launcher (F-3201) is no longer "serve a broker" — with the broker gone it is a per-node presence+sync
     daemon. That collapse is why SPEC's provisional stories (2) + (3) MERGE here (ADR-002 consequence). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 33 --autonomous`, Contract stage). Each behaviour task is
     one `.feature` under tasks/; done when its feature is green. Fitness functions are arch-tests (structural
     → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_fabric-seam.feature` — `@executable @finding-F-3202` — the NEW `src/mesh-fabric.mjs` — the ONE
  fabric-assumption site (ADR-001): `probeFabric(config)` → `{ fabric, state, healthy, reason }` (the
  two-stage probe — bare-`tailscale` ENOENT ⇒ `not-installed`; `BackendState` `NeedsLogin`/`Stopped`/
  `NeedsMachineAuth` ⇒ the matching actionable reason, `RESEARCH §4`); `selfAddress(config)` → this node's
  dial address (`tailscale ip --4` / `Self.TailscaleIPs`); `resolvePeers(config)` →
  `[{ nodeId, dialAddress, online, host }]` parsed from `tailscale status --json`, **joined to aof `nodeId`
  by `HostName`/`DNSName`** (ADR-002.2). Spawned shell-less via `execFile("tailscale", [...])` with a timeout
  (the `git`-argv precedent) + a Windows install-path fallback before concluding not-installed; tolerant
  `--json` parse (unknown fields ignored, a parse failure ⇒ a degraded-fabric refusal). A `config.mesh.fabric`
  other than `"tailscale"` is a **clean structured refusal**, never a crash / hidden fallback (06/ADR-002
  designed-not-shipped). `@executable` over fixtured CLI output; the live-tailnet parse is the `@manual` soak.
- [x] `tasks/01_fabric-liveness-cutover.feature` — `@executable @finding-F-3204` — the presence fast-path
  cutover (ADR-002.1): `mergePresence` (`mesh-presence.mjs`) reconciles git-disk presence vs the **fabric
  peer-map liveness** (replacing the retired relay cache); a peer's `Online` is the fast pre-filter the cache
  used to supply; the git presence-record assembly/read is **byte-unchanged** (the durable floor); a
  connect-refused / shields-up / ACL-deny (`RESEARCH §5`) is a **handled** "unreachable (check shields-up/ACL)"
  outcome DISTINCT from "offline", never a crash (ADR-002.3 — `Online` ≠ dialable, the connect attempt is
  ground truth); unconfigured mesh ⇒ byte-identical to today (no fabric read attempted).
- [x] `tasks/02_broker-retirement.feature` — `@executable @finding-F-3204` — the broker retires as the
  liveness transport (ADR-002.1 consequence): the `ws@8` fan-out in `mesh-relay.mjs` (`serveRelay`'s `clients`
  Set), `mesh-presence-subscriber.mjs`, and `mesh-presence-cache.mjs` are removed from the liveness path; the
  device-flow `/enroll` route + the ws upgrade auth-gate are no longer the trust mechanism ("already on the
  tailnet" is the admission boundary); the reused git guards (`acd-mesh-partition-write`,
  `acd-mesh-sync-record-neutral`, the `*-write-scope` set, `acd-mesh-command-cli-bijection`) stay GREEN. The
  behavioural face: a node's presence/liveness view is fully populated with the broker never started. (The
  arch-test retirement is the buildable unit below.)
- [x] `tasks/03_coordination-launcher.feature` — `@executable @finding-F-3201` — the per-node presence+sync
  daemon serve verb (ADR-003): (a) **preflight** the fabric via `probeFabric` and **refuse-with-guidance** if
  degraded; (b) publish this node's git presence record + run the reused `startSyncLoop` cadence; (c)
  periodically read `resolvePeers` so `mesh:status` reflects live fabric liveness; SIGINT/SIGTERM stop the
  loop + publisher cleanly; **no listening broker socket** (the "bind" is the fabric self-address). Registered
  on the spine as a `mesh:*` command whose **registered run is the NON-BLOCKING probe** (bijection-safe, the 23
  precedent): `aof mesh <serve> --json` reports fabric state + self-address + peer count + whether this node is
  the issuance authority, and RETURNS; the long-lived foreground serve is the `--serve` face path over the
  one-shot core, never the bijection-probed run.
- [x] `tasks/04_operator-guidance.feature` — `@executable @finding-F-3202` — per-fabric operator guidance
  (ADR-003.4 / ADR-001.4): the launcher preflight, sourced from `mesh-fabric.mjs`, for tailscale prints the
  resolved self-address + "both nodes must be on the same tailnet; ensure `tailscale status` shows the peer
  `Online`; if a dial is refused, check `--shields-up`/ACLs"; a degraded probe prints the matching `RESEARCH
  §4` remediation (ENOENT ⇒ "install Tailscale"; `NeedsLogin` ⇒ "run `tailscale up`"); the **macOS
  App-Store-CLI-split** preflight (`RESEARCH §3`) warns, on macOS, when the CLI cannot reach the daemon,
  steering to the Standalone / open-source `tailscaled` build — install-guidance surfaced by `work doctor` +
  the launcher, never a runtime auto-fix.
- [ ] `tasks/05_cross-os-fleet-e2e.feature` — `@manual @finding-F-3204` — the outsider-verifiable success
  lane (SPEC §Objective; the UAT 32 · F-2701 breadth): a fresh operator stands up a ≥2-node cross-OS fleet
  (Windows + macOS [+ Linux]) over Tailscale, runs the launcher on each, and **sees every node + assigns and
  runs work end-to-end** — with NO hand-derived URLs, NO tunnels, NO device-code dance, and NO shared/inherited
  node identity. A VERIFICATION-time observation (not a CI assert); **this is the lane that re-feeds the UAT 32
  re-run** (`aof:verify 32`).
- [x] **Fitness `acd-fabric-single-seam`** (arch-test, ADR-001/ADR-002/ADR-006 — authored PENDING at Decide) —
  the `tailscale` spawn call-form + the peer-dial-address resolution live ONLY in `src/mesh-fabric.mjs`; no
  other `src` module spawns `tailscale` or derives a peer dial address from a committed/hand-derived `ws://`
  URL (the "transport resolves addresses from the fabric, never a hand-derived URL" invariant). **DoD of this
  story: un-skip it and make it GREEN** once `mesh-fabric.mjs` exists and owns the resolution.
- [x] **Retire `acd-relay-auth-gate-checked`** (+ siblings `acd-relay-stateless` / `acd-relay-envelope-neutral`
  / `acd-relay-lease-blind`) — ADR-002 consequence: these guard the ws upgrade auth-gate + the broker's
  stateless/envelope/lease-blind properties; with the broker eliminated they guard a broker that no longer
  brokers. The task that removes the broker MUST atomically **retire** these arch-tests + unwire them from
  `scripts/test.mjs` with an explicit supersession note (`superseded by 33/ADR-002 — the broker is
  eliminated`). A buildable unit, done WITH task 02 (never a dangling green guard over dead code).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-001** (pin the fabric FIRST: a mesh-VPN
is the transport, Tailscale shipped; the assumption is a committed declaration reconciled by a runtime probe,
the probe authoritative for behaviour; the pluggable seam is ONE narrow `mesh-fabric.mjs` resolver,
Tailscale-only shipped + a later-story refusal for other fabrics; the macOS App-Store preflight), **ADR-002**
(the topology call: the ws broker is ELIMINATED as the presence/liveness transport, the fabric IS the
discovery+liveness plane, presence+issuance ride direct-addressability, git stays the durable authority
unchanged, a residual coordinator survives ONLY as an issuance-authority git-write role decoupled from any
listening socket), and **ADR-003** (the launcher is a per-node foreground presence+sync daemon — a real `mesh:*`
serve verb whose registered run stays a non-blocking probe (bijection-safe), whose serve path binds the fabric
self-address + drives per-fabric guidance).

This story **owns**: NEW `src/mesh-fabric.mjs` (the fabric seam), `src/mesh-relay.mjs` (broker retirement),
`src/mesh-presence-subscriber.mjs` + `src/mesh-presence-cache.mjs` (retired from the liveness path),
`src/mesh-relay-client.mjs` (the URL-from-config peer dialing is no longer the reachability path),
`src/mesh-presence.mjs` (the `mergePresence` fast-source cutover — the git assembly untouched), the launcher
module + its `mesh:*` verb (`command-core.mjs` registration + one import + one `COMMANDS` entry + one
`meshCommand` branch + one `argsFor` case + the `cli.mjs` dispatch), and the retirement of the four relay
arch-tests (+ their `scripts/test.mjs` unwiring). REUSED verbatim (never touched): `src/mesh-store.mjs`,
`src/mesh-sync.mjs`, `src/mesh-presence.mjs`'s git record assembly, `src/mesh-lease.mjs`, `src/mesh-issuance.mjs`.

**Graph-grounded:** the relay-bus cluster (`mesh-relay` ← `mesh-presence-subscriber`; `mesh-relay-client` ←
`mesh-presence-cache`) is self-contained (fresh graph, actual edges) — retiring it does not ripple into the
reused substrate hub `mesh-store.mjs` (10 dependents, untouched). The new fabric seam + presence cutover are
one import-tight unit (the reason this is one story, not two).

**Sequenced after 00** (soft edge): the fabric peer→nodeId join (ADR-002.2) assumes per-install identity is
correct; land story 00 first so the transport joins on trustworthy per-node ids. Both stories are file-disjoint
(story 00 owns `node-identity.mjs`/`work.mjs`-hydration/doctor-migrate; story 01 owns the fabric/relay/launcher
bus) — the ordering is a data-trust dependency, not a compile edge.

## Build notes (developer-amigo feasibility seat — folded in at Contract)

**Overall verdict: all 6 tasks stay as tagged.** Tasks `00`–`04` remain `@executable`; task `05` remains
`@manual`. No retag. All 5 RAISED feasibility flags are CONFIRMED feasible against the real tree, with the
`03` clean-stop row staying `@executable` (no degrade). `# RESOLVED (developer-amigo)` blocks (plus
`RESEARCH-GAP RESOLVED` blocks) are written into each task `.feature` beneath its flag, citing real `file:line`.

**Per-flag resolutions:**

1. **`00` — injected `tailscale`-exec seam.** CONFIRMED. The injected-closure-defaulting-to-production idiom is
triple-precedented: `src/commands/run-start.mjs:210` (`ctx.relayClient`), `src/mesh-presence-subscriber.mjs:110/168`
(injected `transport`), and — the closest analog for a process-spawn seam specifically — `src/tool-store.mjs:88`
(`defaultProbe(exeFile, spawn = spawnSync)`). `mesh-fabric.mjs` composes the same shape: one injected `exec`
closure defaulting to `execFile("tailscale", […])` + timeout, driving all four fixtured shapes (stdout JSON, bare
IP, ENOENT rejection, non-Running BackendState) and serving the Windows install-path fallback as a second call
over the same closure.

2. **`01` — injected dial/connect closure + `mergePresence` purity.** CONFIRMED. `mergePresence(diskPresence,
cachedPresence)` (`src/mesh-presence.mjs:152`) has no fs/clock/config read and stays untouched by the cutover —
only its caller (`src/commands/mesh-identity.mjs:214,241`, already reading the second argument off injected
`ctx.presenceCache`) re-points that argument to the fabric liveness value. The reachability dialer composes
`createRelayClient`'s `connect()`/reject shape (`mesh-relay-client.mjs:121-214`) as an injected `{ dial }` closure,
defaulting to a real socket probe in production, exercised live only by task 05.

3. **`02` — no residual hard import of the retired subscriber/cache.** CONFIRMED, and better than the flag feared:
`mesh-identity.mjs` (mesh:status's home) never statically imports `mesh-presence-cache.mjs`/
`mesh-presence-subscriber.mjs` — it only reads `ctx?.presenceCache ?? null` (`:214`), which is null on every CLI
call today. The graph's own dependents list (`ARCHITECTURE.md`) confirms `mesh-relay-client.mjs`'s dependents are
`mesh-heartbeat.mjs` / `run-start.mjs` / `mesh-presence-cache.mjs`, not `mesh-identity.mjs`. Task 02 must delete
`mesh-presence-subscriber.mjs` + `mesh-presence-cache.mjs` outright and remove `mesh-heartbeat.mjs`'s push-side
import of `createRelayClient`/`pushPresenceSignal` (`src/commands/mesh-heartbeat.mjs:56-58,113-119`) from the
liveness path — after which `serveRelay` has no remaining liveness-path caller. **Four relay arch-tests confirmed
wired** in `scripts/test.mjs`: `acd-relay-stateless` (import `:581`, spread `:1248`), `acd-relay-envelope-neutral`
(import `:582`, spread `:1249`), `acd-relay-auth-gate-checked` (import `:643`, spread `:1260`),
`acd-relay-lease-blind` (import `:823`, spread `:1305`) — task 02 atomically deletes all eight lines with the
supersession note "superseded by 33/ADR-002 — the broker is eliminated."

4. **`03` — injected ticker + fabric-exec + observable `stop()` seam.** CONFIRMED. `startSyncLoop({ runSync,
cadenceSeconds, ticker })` (`src/mesh-sync.mjs:292-303`) already returns `{ intervalSeconds, stop() }` and already
takes an injectable ticker (`intervalTicker()` at `:307-316` is the production default). `serveRelay` returns the
identical `{ server, url, stop }` shape (`mesh-relay.mjs:638`). **Decision: the clean-stop row stays
`@executable`** — the launcher composes its own `stop()` over the sync-loop handle's `stop()` + presence-publish
teardown; the SIGINT/SIGTERM scenario is satisfied by registering the real `process.on(signal, …)` handler in
production while the test invokes the captured handler function directly (the standard Node signal-handler
unit-test idiom), never requiring a real OS signal. The registered run rides the exact `relayStatus`
non-blocking-probe precedent (`commands/mesh-relay.mjs:25-32`, proven reachable via `invoke()`/CLI spawn by
`test/arch/acd-mesh-command-cli-bijection.test.mjs:186-209`), so `acd-mesh-command-cli-bijection` stays green.

5. **`04` — pure guidance formatter + injected platform.** CONFIRMED. The reason→message matrix is a pure lookup
over task 00's structured `{ healthy, reason }`. The injected-platform-defaulting-to-`process.platform` idiom is
already house-wide: `src/paths.mjs:4,18`, `src/tool-store.mjs:47,54`, and — closest in kind —
`src/config-inspect.mjs:597,641` (`toolPlatformCheckFor`/`toolPlatformChecks`, already used by `work doctor` for a
different platform-conditional warning today). The macOS App-Store-split row composes the identical shape and runs
on any CI OS.

**5 RESEARCH-gap verdicts** (all: acceptable to defer to `@manual` task 05, no retag; one design note):
- **No exit-code table** for `tailscale status` — defer. Fixtures key off the parsed `BackendState` field, never
  the exit code; no scenario asserts on it.
- **shields-up/ACL silent** — defer. A fact about the fabric (unobservable at the socket layer on any fixture),
  not a testability gap; task 04's message names both causes in one line.
- **macOS symptom unmeasured** — defer. The warn fixtures off an injected boolean signal, not a literal
  exit-code/stderr string.
- **Windows install-path varies** — **one design note**: task-00's fallback should try both documented folder
  names (`...\Tailscale\` and `...\Tailscale IPN\`) in sequence before concluding not-installed; cheap
  (one extra ENOENT-tolerant attempt), not a blocker.
- **Online cadence unmeasured** — defer. The scenario asserts a re-read happens each tick, not a latency bound.

Each `tasks/*.feature` (00–04) now carries a `# RESOLVED (developer-amigo): …` block (the house pattern);
`05_cross-os-fleet-e2e.feature` carried no flag — confirmed correctly `@manual` as authored. No production code
was touched at refine.
