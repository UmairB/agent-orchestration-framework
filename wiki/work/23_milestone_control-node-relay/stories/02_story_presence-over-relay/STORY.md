---
type: story
number: 02
slug: presence-over-relay
title: "Push-for-liveness, poll-for-durability — the node-side two-publish path + the cadence loop + clean degradation to git-only"
parent: 23
status: done
owner: product-owner
created: 2026-06-30
updated: 2026-07-01
---
<!-- Build landed 2026-06-30 (aof:continue 23): tasks 00/01 @executable green, fitness #4 green,
     mesh:heartbeat two-publish path extended (git unconditional + relay best-effort caught). Task 02
     stays @manual (the 3-node fleet latency spike — verified at aof:verify). status → in-review at the
     milestone-wide review gate.
     F1 close-out landed 2026-07-01 (aof:continue 23, ADR-004): task 03 (the missing receive-and-apply
     consumer) built + reviewed — the persistent relay subscriber + in-memory liveness cache + the
     mesh:status overlay. All @executable green (suite 1716 ok / 0 not ok), fitness #7 green, architect
     CONFORMS + qa FAITHFUL-WITH-FINDINGS. status stays in-review (done is set at aof:verify, after the
     @manual ≤5s fleet re-measurement). -->

<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 02 · Push-for-liveness, poll-for-durability — the integration

## User story

As an operator who wants a peer's change to show **≤5s over the relay** yet still **≤30s with the relay killed**, never losing data,
I want each node's heartbeat to publish over **both** buses in a structurally-frozen order — write git **unconditionally** first (the durable floor), then push the relay **best-effort** second (the accelerator, a failure caught and never thrown) — driven by a background cadence loop that is a thin timer over the one-shot publish,
so that the fleet sees live presence in sub-5s when the relay is up **and** degrades cleanly to git-only (poll) sync when the relay or control node dies — losing **liveness, not data**: correctness never depends on the relay (PRD A5; KR1; the liveness half of KR5).

<!-- This is the INTEGRATION story — the sole place story 00's presence record and story 01's relay meet. It
     owns the node-side two-publish path (ADR-003), the cadence loop, and the KR1 measurement. The git write
     is NOT inside the relay-success branch and the relay push is caught-never-thrown — the structural form of
     graceful degradation (fitness #4). Depends on BOTH 00 and 01. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 23 --autonomous`, Contract stage). Each behaviour task
     is one `.feature` under tasks/; done when its feature is green. The fitness function is an arch-test
     (structural invariant → never a behaviour feature) tracked as a buildable unit below. -->

- [x] `tasks/00_dual-bus-publish.feature` — the node-side presence publish does **two** publishes in a frozen order: (1) write git **UNCONDITIONALLY** first (`publishPresenceRecord` via the atomic seam — **not** inside any relay branch, **not** guarded by relay reachability); (2) push the relay **best-effort** second, wrapped so a relay-absent / connect-fail / push-fail is **caught, never thrown**. The heartbeat result **succeeds regardless** of relay state; the git write is byte-identical whether the relay is up, down, or unconfigured.
- [x] `tasks/01_graceful-degradation.feature` — killing the relay (or no relay configured) degrades cleanly to **git-only**: presence still reaches peers over git (the m22 sync engine, ≤30s) and the relay failure leaves the durable presence record intact — **liveness lost, data safe**; the relay restored, sub-5s push resumes with no record change. The **cadence loop** is a thin timer over the one-shot publish (one publish per tick; a malformed/absent cadence falls back to a documented default `config.mesh.presence.cadenceSeconds`).
- [x] `tasks/02_relay-liveness-fleet-spike.feature` `@manual` — the outsider-verifiable acceptance **and** the A1/A5 measurement spike: on a 3-node fleet, a peer's change is reflected **≤5s over the relay** and **≤30s with the relay killed** (KR1), and killing the relay (or the control node) mid-fleet loses **liveness, not data** — the fleet degrades to git-only sync, 0 lost records (the liveness half of KR5). Agent-run; latency + degradation evidence in `VERIFICATION.md`. _Verified `aof:verify 23`: the ≤30s git floor (~1.4–2.9 s), byte-identical broker fan-out, liveness-not-data (0 lost under a killed relay), and re-nomination (config-only) all PASS; the **≤5s live reflection now PASSES** after the F1 consumer landed (task 03) — re-measured live on a real 3-node ws@8 fleet, worst-case both-nodes reflection 11.9/4.8 ms across two runs, over the relay with no git sync. **F1 resolved.**_
- [x] `tasks/03_relay-receive-and-apply.feature` `@bug @finding-F1` — **the missing consumer (verify F1, blocker).** A node-side **persistent relay subscriber** that holds a connection to the control node's relay and, on each fanned-out `{ kind:"presence" }` frame, applies the signal into the store `mesh:status` reads — so a peer's pushed change surfaces in `mesh:status` **≤5s over the relay, without a git sync**. Git stays the durable authority (the applied signal is a liveness cache, never a second system of record); a malformed/oversized inbound frame is ignored (never crashes); the relay down/absent degrades cleanly to the ≤30s git floor. Closes the producer→transport→**consumer**→render path the break-down left open. _Built `2026-07-01` by `aof:continue 23` (ADR-004): `src/mesh-presence-cache.mjs` (in-memory latest-wins cache) + `src/mesh-presence-subscriber.mjs` (the persistent injected-transport subscriber + `parseInboundFrame` + the production ws@8 seam) + `mergePresence` in `src/mesh-presence.mjs` + the `mesh:status` `ctx.presenceCache` overlay. All 6 `@executable` scenarios/rows green + fitness #7 `acd-presence-subscriber-cache-only` green. Reviewed — architect **CONFORMS**, qa **FAITHFUL-WITH-FINDINGS** (2 non-blocking test-strength nits). The `@manual` ≤5s re-measurement is re-runnable now → `aof:verify 23`._
- [x] **Fitness `acd-presence-relay-independent`** (arch-test, ADR-003 / fitness #4) — the presence publish path's `writeText`/`publishPresenceRecord` call is **not** nested inside a relay-push conditional/success branch, and the relay push is wrapped in a `try`/`catch` that **swallows** the throw — so the git write survives a relay failure (the structural form of "data safe, liveness lost"; correctness independent of the relay).

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** — presence published over BOTH
buses: git written **unconditionally** (the durable path, synced by the m22 payload-agnostic engine) + the
relay pushed **best-effort** (the accelerator); the relay push **never gates** the git write, so relay /
control-node loss degrades cleanly to git-only — the milestone's load-bearing invariant, PRD A5). This story
**owns**: the node-side relay client + the **two-publish path** (extending story 00's `mesh:heartbeat` with
the best-effort relay push, or a thin integration module over it), the **cadence loop** (a thin timer over the
one-shot publish — the 22/ADR-004 runner shape), the KR1 (≤5s/≤30s) + liveness-half-of-KR5 integration, the
**A1/relay-liveness 3-node spike** as a `@manual` deliverable, and arch-test #4 + its registration in
[scripts/test.mjs](../../../../../scripts/test.mjs).

**Depends on story 00 (the presence record + the unconditional git write) AND story 01 (the relay client)** —
the genuine integration story, the **single** cross-story edge within m23 (ARCHITECTURE §Story break-down
rationale, point 4). It is built after both land. The git-write half is story 00's; this story adds **only**
the best-effort relay push + the loop + the measurement — so the structural risk is confined to the publish
control flow (fitness #4), not the record schema or the relay broker.

**Verification-time spike (not a refine blocker):** the KR1 latency bounds (≤5s relay / ≤30s git) are
**measured** at verify on a real 3-node fleet under real concurrency (PRD A1/A5), **not** decided at refine —
mirroring milestone 22's A1 note. `tasks/00`/`01` prove the *structure* (the git write is unconditional, the
relay push caught, degradation clean); `tasks/02`'s `@manual` measures the *latency*. The structural fitness
#4 + the `@executable` degradation scenarios are green without a fleet; only the latency measurement needs one.

**Feasibility (developer amigo seat — confirmed at Contract): FEASIBLE.** The integration is a thin additive
wiring over two seams that already exist (story 00's `publishPresenceRecord` git write + story 01's relay) and
two patterns the codebase already ships green. **Flag 1 (tasks 00/01 hinge on an injectable relay client) —
CONFIRMED, locked as the contract:** the node-side publish path takes an **injected relay client** (`{ connect,
push }`) so the four relay states (`up` / `down`-connect-throws / `unconfigured`-absent / `push`-throws) are
reachable in `@executable` CI **with no real ws server** — the dependency-injection seam is the feasibility
lever, exactly as `tasks/00`/`01`'s `Background` ("the presence publish path takes an injected relay client
whose connect/push I can stub") and their in-feature QA flags require. Story 02 **owns** that client interface
(it imports story 01's node-side relay client to push, and defines the fake for CI), so the seam is ours to
guarantee. **Flag 2 (task 01 "presence reaches a peer over git" stays `@executable` over a local git fixture;
the loop stays `@executable` with an injected ticker + a stubbable one-shot publish) — CONFIRMED:** both
patterns are already live and green — `test/mesh-git-sync-transport.test.mjs` runs a local `git init --bare`
bare-remote + a peer clone over the m22 `syncMesh` engine (the 22 task-00 shape: git binary + a committable
`user.email`/`user.name` on PATH, `commit.gpgsign false`), and `test/mesh-sync-cadence-loop.test.mjs` drives
`startSyncLoop` with a `manualTicker()` (no wall-clock wait). Story 02 reuses both verbatim. **Flag 3 (task 02
latency stays `@manual`) — CONFIRMED:** the ≤5s/≤30s figures are wall-clock observations on a real 3-node
fleet recorded to `VERIFICATION.md`, NOT collapsed into a flaky `@executable` assert — the structure is fully
covered by `tasks/00`/`01` `@executable` + arch-test #4; only the latency + live degradation needs the fleet.
**Flag 4 (config-key coherence) — CONFIRMED:** `config.mesh.presence.cadenceSeconds` (how often THIS node
publishes — story 02's loop) vs story 00's `config.mesh.presence.stalenessSeconds` (when a peer reads as stale)
are two distinct, well-named sub-keys under the same `mesh.presence.*` group — consistent with the m22
`mesh.sync.cadenceSeconds` split and read through the same `resolveCadenceSeconds`/`cadenceFromConfig` policy.
**No `.feature` edit was required** — all three QA flags resolve as "confirm the seam," and every seam either
already exists (the ticker + the git fixture) or is story 02's own to define (the injectable relay client).
**Build-coordination note (the single cross-story edge):** story 00 ships `mesh:heartbeat` **git-only**, and
this story is a **clean additive extension** of it — it adds the best-effort relay push *after* the existing
unconditional `await publishPresenceRecord(...)` and wraps it in `try`/`catch`; it does **not** rewrite the
record schema, the git write, or the relay broker. The co-touch on `command-core.mjs` `COMMANDS` + `cli.mjs`
`meshCommand` is add-only (one import / one entry / one `if (subcommand === "...")` branch per new verb — the
07/ADR-006 + 22/ADR-001 idiom the existing `mesh:sync` branch demonstrates). No blocker.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

**The two-publish control-flow shape (the heart of the story — fitness #4 is a source grep of exactly this).**
Extend story 00's `mesh:heartbeat` (do NOT rewrite it). The publish path is, literally:

```js
// in src/commands/mesh-heartbeat.mjs (or a thin node-side integration over it)
await publishPresenceRecord(workspace, nodeId, record);   // git, UNCONDITIONAL — the durable floor (story 00)
try {
  await pushPresenceSignal(relayClient, envelope);        // relay, BEST-EFFORT — the accelerator (story 01 client)
} catch (err) {
  // liveness lost, data safe — NEVER rethrown; record err as a non-fatal best-effort failure in the result
}
```

The git write is **not** inside any relay branch and **not** guarded by relay reachability; the relay push is
wrapped in a `try`/`catch` that swallows the throw. Fitness `acd-presence-relay-independent` is a
**source-control-flow grep** over this file asserting precisely that (the `publishPresenceRecord`/`writeText`
call is not nested in a relay-push conditional/success branch, and the push is `try`/`catch`-wrapped) — so the
*structure* is what the arch-test reads. The `result` reports the relay push as a **non-fatal best-effort
failure** so task 00's "the result reports the relay push as a non-fatal best-effort failure" assertion has a
field to read; the command still returns success (the heartbeat is exit-0 regardless of relay state).

**The injected relay-client seam (the `@executable` feasibility lever — task 00/01's `Background`).** The
publish path takes an **injected** relay client `{ connect, push }` (story 01 owns the production node-side
client; story 02 imports it and defines the interface the publish path depends on). The four relay states are
reachable by stubbing it — NO real ws server in CI:
- **`up`** — `connect` resolves, `push` resolves ⇒ exactly one push, `result` success.
- **`down (connect-fails)`** — `connect` throws ⇒ caught, success, git write intact.
- **`unconfigured`** — no `config.mesh.relay.*` ⇒ the push is **skipped** (not attempted — task 00 asserts "no
  push was attempted"), distinct from attempt-then-catch; git write intact, success.
- **`push throws`** — `connect` resolves, `push` throws ⇒ caught, success, git write intact.

Model the fake on `test/mesh-sync-cadence-loop.test.mjs`'s `manualTicker()` style (a tiny in-test stub that
records calls). The pushed envelope is story 01's frozen `{ kind, nodeId, signal }` — `kind: "presence"`, this
node's `nodeId`, the presence record as the **opaque** `signal` blob (task 00's "the pushed envelope carries
kind 'presence' … the opaque signal carries this node's presence record").

**The byte-identical baseline (task 00's invariant matrix + R4).** Every relay-state row must persist a git
presence record **byte-identical** to the relay-up baseline. Pin `heartbeatAt` via a fixed **injected instant**
(the features say "a fixed injected heartbeat instant") so the bytes are directly comparable across rows —
story 00's `mesh:heartbeat` already needs an injectable `now`/instant for its own byte-equivalence task, reuse
it. The git write goes through story 00's `presenceRecordPath` + atomic `writeText` — story 02 adds **no** new
write path (fitness #3 / write-scope is story 00's, untouched here).

**The cadence loop (the injected-ticker thin timer — the m22 precedent, copy it).** Mirror
`src/mesh-sync.mjs`'s `startSyncLoop` / `intervalTicker` / `resolveCadenceSeconds` / `cadenceFromConfig` split
exactly (the m22 task-01 shape). The loop is a thin timer that invokes the **one-shot publish** once per tick
and holds **no** publish logic of its own (no git write, no relay push directly — task 01 asserts both). It
takes an injected `ticker` (`manualTicker()` in tests, `setInterval`-backed in prod) and a resolved
`cadenceSeconds` captured **once at start** (a mid-run config edit does not retune a running loop — task 01's
"read at start, stable for the run"). Put this in a small node-side module (e.g. `src/mesh-presence-loop.mjs`
or fold into the relay-client module) so `src/mesh-presence.mjs` stays story 00's record mechanic.

**The two config keys (coherent with m22's `mesh.sync.*` split).**
- `config.mesh.presence.cadenceSeconds` — **this** story (the loop): how often THIS node publishes. Read via a
  `resolveCadenceSeconds`-style policy (valid positive **integer** verbatim; absent/null/string/boolean/`0`/
  negative/non-integer-float ⇒ a **documented default**, no crash — task 01's malformed matrix is byte-for-byte
  the m22 one, so reuse `resolveCadenceSeconds` from `src/mesh-sync.mjs` or a presence-local twin of it). Pick
  and **document** the default cadence (a tight value within the ≤5s-liveness intent — e.g. 5s; record it as an
  `export const DEFAULT_PRESENCE_CADENCE_SECONDS` so the "documented default" assertion has a single source).
- `config.mesh.presence.stalenessSeconds` — **story 00** (the staleness read): when a peer reads as stale. A
  distinct sub-key under the same `mesh.presence.*` group. Story 02 does **not** touch it.

**Graceful degradation is structural, not coded (task 01).** "Relay down ⇒ presence still reaches a peer over
git, 0 records lost" needs NO degradation branch — it falls out of the unconditional git write + the m22
`syncMesh` engine. Wire task 01's "reaches a peer over git" over the **local bare-remote fixture** in
`test/mesh-git-sync-transport.test.mjs` (a `git init --bare` remote + a peer clone + `syncMesh`); the relay
being `down` is just the injected client throwing on `connect`. "Relay restored ⇒ push resumes, record
unchanged" = two publishes at the same fixed injected instant (relay-down then relay-up) producing
byte-identical records.

**Registration (additive co-touch, 07/ADR-006 + 22/ADR-001 — the `mesh:sync` branch is the template).** Any
new `mesh:*` verb (a `mesh:heartbeat` extension is story 00's; a new presence/loop verb if 02 adds one) is
add-only: one import + one `COMMANDS` entry in `src/command-core.mjs`, one `if (subcommand === "<sub>")` branch
+ its `meshVerbCli` call in `src/cli.mjs`'s `meshCommand`, and it RIDES the existing
`acd-mesh-command-cli-bijection` gate (no new gate). Register arch-test #4
(`test/arch/acd-presence-relay-independent.test.mjs`) in `scripts/test.mjs`. The `@manual` task 02 (the 3-node
fleet latency + degradation spike) is the developer-amigo's verify-time deliverable: stand the fleet up via the
registered `aof mesh` commands (never hand-edited files), measure ≤5s relay / ≤30s git + 0-lost-records under
relay kill, record the numbers + re-nomination evidence in the milestone `VERIFICATION.md`.
