---
type: story
number: 02
slug: claim-integration-fleet-reclaim
title: "Claim integration + relay fast-path + fleet reclaim — the frozen A2 sequence in work:run-start, the lease wire kind, and the fleet orphan scan (the integration join)"
parent: 26
status: done
owner: product-owner
created: 2026-07-02
updated: 2026-07-03
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 02 · Claim integration + relay fast-path + fleet reclaim — the A2 join

## User story

As an operator driving a fleet where nodes start, finish, and sometimes crash mid-run,
I want `work:run-start` to compose the frozen A2 claim sequence — durable local claim first, best-effort relay intent second (a peer hears it in milliseconds and defers), authoritative git sync third, hold-or-stand-down decided from git alone — releasing the lease at `work:run-complete`, and a peer whose presence has gone stale to have its orphaned run reclaimed (force-failed retryable, its item offered again) the next time any node seeks work,
so that under two nodes racing 100 contested claims zero cases execute twice (KR2), a crashed node's in-flight run is reclaimed rather than left wedged, and killing the relay only slows arbitration to the git cadence — never breaks it (PRD A2).

<!-- This story is the genuine INTEGRATION join (the m23 00/01→02 shape): the ONLY place story 00's
     substrate, story 01's lease mechanics, and the relay leaf compose — inside the run-command files,
     so the frozen sequence is greppable in one place. mesh-relay.mjs is NOT touched (fitness #10 pins
     it) and command-core is NOT touched (zero new verbs). -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 26 --autonomous`, Contract stage). Each behaviour
     task is one `.feature` under tasks/; done when its feature is green. The fitness functions are
     arch-tests (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_claim-sequence-a2.feature` — the FROZEN claim sequence in `work:run-start` (ADR-004.3): (1) the durable local claim write — unconditional, FIRST, never inside any relay branch; (2) the relay intent push — best-effort SECOND, caught never thrown (the four-relay-state matrix: up / down-connect-fails / unconfigured / push-throws — for EVERY row the claim file + git sync are byte-identical and the start succeeds or stands down on git evidence alone); (3) the git sync — the authoritative act; (4) hold ⇒ the run is minted WITH this node's `node` and the `runId` tied back onto the claim; stand-down ⇒ NO run minted, the result says stood-down + `heldBy`; a node whose intent broadcast unopposed but whose git race is lost STANDS DOWN (the relay grant is worth nothing without the git win); relay wholly lost ⇒ claims still arbitrate correctly at the git cadence.
- [x] `tasks/01_lease-release-on-complete.feature` — the lease lifecycle behind the EXISTING verbs (ADR-003.2 / ADR-004 consequences): `work:run-complete` releases the holder's lease (its OWN file flips `state:"released"` — an own-path write via the story-01 `releaseLease`); after completion the item's lease reads released (claimable again); `work:run-retry` carries the `node` through the retry lineage (the retried run stays under its node's partition); an unconfigured-mesh install completes runs byte-identically to today (no lease read, no lease write).
- [x] `tasks/02_relay-fast-path-defer.feature` — the second wire kind (ADR-004.1/.2): the lease intent rides the frozen `{ kind:"lease", nodeId, signal }` envelope (the claim record as the opaque blob) through the one-shot best-effort push seam; the persistent subscriber's ADDITIVE apply branch lands it in the in-memory lease cache (keyed by `itemRef`, latest-signal-wins); a peer's `next` overlaying the cache SKIPS an intent-claimed item within relay latency (the `disk ?? cache` overlay — the cache can only ADD a skip, never unlease, never HOLD); the cache performs NO durable write; a malformed/unknown frame is ignored, never a crash.
- [x] `tasks/03_fleet-orphan-reclaim.feature` — the fleet scan at the claim path (ADR-006): a peer with STALE presence AND a stale run heartbeat ⇒ its `running` run is force-failed `runtime_offline` + `reclaimedAt` (the UNCHANGED `reclaimStaleRuns`), the item's status rolled back via `rollbackItemStatus` (`20/ADR-005` verbatim), its lease LAPSED by rule (no foreign lease write — the reclaimer acquires its OWN lease), the item offered again, and the winner's new run carries the retry lineage (`retryOf` → the reclaimed run); a peer with FRESH presence ⇒ hands off UNCONDITIONALLY, even if its run heartbeat is stale (that node's own restart scan owns it); presence stale + run heartbeat fresh ⇒ wait (conservative); unconfigured mesh ⇒ today's local `[item]` scan only, byte-identical.
- [ ] `tasks/04_kr2-contested-soak.feature` `@manual` — the outsider-verifiable KR2 acceptance on a real two-node fleet over a shared remote: **100 contested claims, 0 cases of both executing**; the relay-killed half of the soak measured at the git cadence (arbitration stays correct, only slower); a crashed node's in-flight run observed reclaimed by the peer. Agent-run at `aof:verify`; evidence in `VERIFICATION.md`. The MECHANISM is `@executable` in tasks 00–03; the soak is a measurement, never a flaky CI assert (ADR-004.4).
- [x] **Fitness `acd-claim-relay-independent`** (arch-test, ADR-004 / fitness #9, the 23/fitness-#4 mirror) — in `commands/run-start.mjs` the local claim write + git sync are NOT nested in any relay-push conditional; the `pushLeaseSignal` call sits inside `try`/`catch`.
- [x] **Fitness `acd-relay-lease-blind`** (arch-test, ADR-004 / fitness #10) — `src/mesh-relay.mjs` contains NO lease reference (no lease-kind literal, no lease-module import); `LEASE_SIGNAL_KIND` lives in `mesh-relay-client.mjs` only. GREEN now — must STAY green (the gate exists to catch the tempting edit).
- [x] **Fitness `acd-lease-cache-only`** (arch-test, ADR-004 / fitness #11) — the lease apply branch + lease cache perform no durable write and import no persist seam; extends the existing `acd-presence-subscriber-cache-only` coverage with the m03 non-vacuous planted-violation self-check.
- [x] **Fitness `acd-fleet-reclaim-guarded`** (arch-test, ADR-006 / fitness #12) — the fleet item set is built ONLY inside the mesh-configured branch and filtered through `isNodeStale` BEFORE `reclaimStaleRuns`; the store's signature/mesh-blindness unchanged; rollback still routes through `rollbackItemStatus`; the existing `acd-run-reclaim-stale-only` + `acd-status-rollback-bounded` re-arm green.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-004** — the relay fast-path is a
NODE-SIDE advisory intent broadcast (`kind:"lease"`, zero relay change); the frozen four-step sequence;
arbitrate from git observation ONLY; KR2 measured at verification. **ADR-006** — the scan generalised BY
ARGUMENT at the existing claim path; the dual-staleness guard with presence precedence; the foreign
force-fail as the ONE sanctioned foreign-path write — a documented refinement of `22/ADR-002`; the dead
peer's lease lapses by RULE). This story **owns**: `src/commands/run-start.mjs` (the frozen sequence +
the fleet-reclaim prefilter — one file, so fitness #9/#12 grep one place), `src/commands/run-retry.mjs` +
`src/commands/run-complete.mjs` (the `node` pass-through; the lease release + `runId` tie-back),
`src/mesh-relay-client.mjs` (`LEASE_SIGNAL_KIND` + the lease push — an additive edit on the graph's
zero-dependency leaf), `src/mesh-presence-subscriber.mjs` + `src/mesh-presence-cache.mjs` (the lease
apply branch + the lease cache), and the KR2 harness. `src/mesh-relay.mjs` and `src/command-core.mjs`
appear in NO diff of this story — zero new verbs, the 22/R1 enumeration stays clean.

**Depends on stories 00 + 01** (the genuine integration story — built LAST, numeric order enforces it):
composes 00's frozen substrate (the `node` mint option, the union read, the root-set `runSync`) with
01's frozen mechanics (`acquireLease`/`releaseLease`, the liveness rule, the leaseView) inside the
command layer — the `20/ADR-005` command-orchestrates precedent, which is what makes the A2 sequence
greppable in one file instead of smeared across modules.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Feasibility verdict at Contract: all five features FEASIBLE (task 04 @manual by design), zero retags.
     Implementation guidance surfaced here; no ADR change. -->

**Verdict:** FEASIBLE. The injection route already exists verbatim: `invoke(id, input, ctx)` hands `ctx`
untouched to `command.run(input, ctx)` ([command-core.mjs:189–194](../../../../../src/command-core.mjs#L189)),
and `mesh:heartbeat` already does `ctx?.relayClient !== undefined ? ctx.relayClient : createRelayClient(config)`
([mesh-heartbeat.mjs:113](../../../../../src/commands/mesh-heartbeat.mjs#L113)) — injected `null` models
unconfigured (`pushPresenceSignal`'s null guard returns `{ pushed:false, skipped:true }`,
[mesh-relay-client.mjs:52–57](../../../../../src/mesh-relay-client.mjs#L52)). The up/connect-fails/push-throws
stub is `makeRelayStub` + the `relayUpBaseline()` compare
([test/mesh-presence-dual-bus.test.mjs:63–96](../../../../../test/mesh-presence-dual-bus.test.mjs#L63)).
run-start adopts the identical seam. The one-process two-contender race is the m22
`buildFixture`/`clonePeer` idiom driven sequentially over one bare remote (`syncMesh` spawns git
synchronously — the interleave is deterministic, no second OS process).

**The QA flags — resolved (locked in the feature comments):**
- **(task 00) injected relay client + `now`:** `ctx.relayClient` (heartbeat idiom) + null-for-unconfigured;
  two contenders sequential in-process over a bare remote; an optional white-box `now` on the run-start input
  schema (the `mesh:heartbeat`/`mesh:status` precedent — a white-box input, NOT a CLI flag, so no
  bijection/route gate re-arms) driving the deterministic runId + the baseline byte-compare.
- **(task 02) the shared cache instance:** LOCKED — `createLeaseCache()` factory in `mesh-presence-cache.mjs`
  (the `createPresenceCache` closure shape, keyed by `signal.itemRef`, latest-wins, validation-guarded); the
  test holds ONE instance, the subscriber applies `kind:"lease"` frames into it, then `invoke("work:next",
  …, { workspace, leaseCache })` overlays that same instance into story 01's frozen `hint` slot in
  `buildLeaseView`. "No git sync produced the skip" holds by construction (fixture has no remote) + a
  partition-root byte snapshot.
- **(task 03) inject-the-clock:** both predicates are pure over passed instants — `reclaimStaleRuns({ now,
  stalenessThreshold })` ([run-store.mjs:407](../../../../../src/run-store.mjs#L407), threshold already
  config-resolved at [run-start.mjs:49](../../../../../src/commands/run-start.mjs#L49); today omits `now` at
  :50 — the build threads `input.now`) and `isNodeStale(presence, nowMs, thresholdMs)`
  ([mesh-presence.mjs:176](../../../../../src/mesh-presence.mjs#L176), 90s default via
  `resolveStalenessSeconds`). The at-threshold row is deterministic (strict `>`, "exactly AT is still live").
- **(task 04)** stays `@manual` — the soak is real-concurrency measurement; the mechanism is `@executable`
  in tasks 00–03 + fitness #9–#12.
- **Boundary (QA's "no lease read" half):** subsumed — fitness #12's config gate covers the fleet-scan half;
  add ONE extra assertion inside the `acd-fleet-reclaim-guarded` test (no new fitness row): the
  `releaseLease` reference in `run-complete.mjs` sits inside a `config.mesh`-gated branch, with the m03
  planted-violation self-check.

**`src/commands/run-start.mjs` — the frozen claim sequence (the mesh branch; unconfigured ⇒ the whole
branch skipped, [:49–62](../../../../../src/commands/run-start.mjs#L49) byte-identical):**
- **(0) fleet-reclaim prefilter** — replaces/widens today's `[item]` scan block
  ([:49–57](../../../../../src/commands/run-start.mjs#L49)): construct the eligible item set (the story-00
  union read + `node` key; exclude fresh-presence peers via `isNodeStale`; own/`null` runs only for the
  started item — presence is never consulted for oneself, satisfying the fresh-own-presence row), call the
  UNCHANGED `reclaimStaleRuns(set, { now, stalenessThreshold })`, keep the `rollbackItemStatus` loop verbatim
  (`20/ADR-005`). *Set-construction subtlety:* `reclaimStaleRuns` is item-granular, but the dedup guard
  guarantees ≤1 non-terminal run per item across the union (ADR-001.4), so filtering *items* by their single
  running run's owner-presence IS run-granular.
- **(1) acquire** — `acquireLease` (story 01) with `runSync = () => syncMesh(ws, { roots: [meshDir(ws),
  runsPathspec(ws)] })`.
- **(2) best-effort intent** — `try { await pushLeaseSignal(relayClient, leaseEnvelope) } catch { /* swallowed
  — arbitration falls to the git cadence */ }`, `relayClient = ctx?.relayClient !== undefined ? ctx.relayClient
  : createRelayClient(config)`. The catch lives HERE (fitness #9 greps this file).
- **(3) resolve** — hold ⇒ `startRun(item, { …, now, node: config.mesh.nodeId })` + write `runId` back onto
  the claim; stand-down ⇒ NO mint, `{ heldBy }` result. **Reclaimed-lineage refinement:** on the mesh path,
  when the item's latest run is a reclaimed `runtime_offline` failure, the mint carries `retryOf → the
  reclaimed run` — a scoped, ADR-006-mandated refinement of the `19/ADR-003` fresh-verb rule
  (mesh-configured + reclaimed-retryable prior only; surface in the build session).
- Add optional `now` to the input schema.

**`src/commands/run-complete.mjs`:** after `completeRun`
([:58](../../../../../src/commands/run-complete.mjs#L58)), under the `config.mesh?.nodeId` gate,
`releaseLease` on the holder's OWN claim for that run's `runId` — on ALL three terminal outcomes; the
rollback block ([:64–70](../../../../../src/commands/run-complete.mjs#L64)) untouched. Add optional white-box
`now` for timestamp-deterministic assertions.

**`src/commands/run-retry.mjs`:** pass `node: config.mesh?.nodeId` into `retryRun`
([:47](../../../../../src/commands/run-retry.mjs#L47)) so the lineage mint lands under the same partition;
nothing else. Add optional `now`.

**`src/mesh-relay-client.mjs` — the second wire kind (additive, on the graph's 0-dependency leaf):**
`LEASE_SIGNAL_KIND = "lease"` beside [:31](../../../../../src/mesh-relay-client.mjs#L31), a
`leaseRelayEnvelope(nodeId, claim)` beside [:36–38](../../../../../src/mesh-relay-client.mjs#L36), and
`pushLeaseSignal` reusing the one-shot connect→push-one→dispose shape of `pushPresenceSignal`
([:52–78](../../../../../src/mesh-relay-client.mjs#L52) — generalise or alias; it must PROPAGATE, the catch
lives in run-start for fitness #9). ZERO edits to `mesh-relay.mjs` (fitness #10).

**`src/mesh-presence-cache.mjs` + `src/mesh-presence-subscriber.mjs`:** `createLeaseCache()` — the
`createPresenceCache` closure shape ([:27–86](../../../../../src/mesh-presence-cache.mjs#L27)) keyed by
`signal.itemRef`, latest-wins, validation-guarded (non-object / no-itemRef ⇒ ignored); the subscriber gains
the additive lease application (e.g. `startPresenceSubscriber({ transport, cache, leaseCache })` applying
both — backwards-compatible). Keep BOTH modules free of fs/persist imports so the existing
`acd-presence-subscriber-cache-only` gate stays green over the lease additions (fitness #11).

**`src/commands/next.mjs`:** `hint = ctx.leaseCache` into story 01's `buildLeaseView`, inside the existing
config gate — the CLI face injects none (story 01 owns this file; this is the seam story 02's task-02 defer
row rides).

**Arch-tests** (register in [scripts/test.mjs](../../../../../scripts/test.mjs) — import + spread):
`acd-claim-relay-independent` mirrors `acd-presence-relay-independent`'s brace-matching `tryCatchBlocks`
source analysis
([test/arch/acd-presence-relay-independent.test.mjs:36–71](../../../../../test/arch/acd-presence-relay-independent.test.mjs#L36))
over `run-start.mjs` (acquire/sync NOT inside the push try-block; `pushLeaseSignal` inside try/catch, no
rethrow; planted-violation self-checks); `acd-relay-lease-blind` greps `mesh-relay.mjs` for zero `lease`
token + no lease-module import, positive half `LEASE_SIGNAL_KIND` in `mesh-relay-client.mjs` only;
`acd-lease-cache-only` extends `acd-presence-subscriber-cache-only` with the lease-specific positive
assertions + self-check; `acd-fleet-reclaim-guarded` greps `run-start.mjs` (`isNodeStale` inside a
`config.mesh` branch BEFORE the `reclaimStaleRuns` call; `rollbackItemStatus` loop intact) + the
run-complete release-gate assertion + enumerates the re-armed `acd-run-reclaim-stale-only` /
`acd-status-rollback-bounded`.
