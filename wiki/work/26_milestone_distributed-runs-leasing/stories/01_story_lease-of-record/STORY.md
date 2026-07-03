---
type: story
number: 01
slug: lease-of-record
title: "Lease-of-record + mesh-aware next — src/mesh-lease.mjs claim/arbitration over git, presence as the lease clock, and work:next honouring leases (git-only)"
parent: 26
status: done
owner: product-owner
created: 2026-07-02
updated: 2026-07-03
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · Lease-of-record + mesh-aware next — git-only

## User story

As an operator whose fleet has two nodes racing for the same queued item,
I want a node to claim an item by writing its OWN per-contender claim file (`.mesh/leases/<item>/<node>.json`) and win or stand down purely by **remote-history order over git** — a claim staying live only while its holder's *presence* is fresh — and `aof work next` to skip an item leased by a live peer while surfacing a stale peer's item as reclaimable,
so that of two contested claims exactly one node executes (KR2's mechanism) with correctness resting on git alone — no relay required, no second clock invented, and a single-node install behaving byte-identically to today.

<!-- This story is GIT-ONLY: it imports no relay module and proves the whole claim/arbitration protocol
     over plain local git fixtures. It owns the NEW src/mesh-lease.mjs + the narrow next-command corridor
     (work.mjs's optional leaseView + commands/next.mjs's config-gated injection) + the additive
     mesh:status lease render. The relay fast-path overlay and the command-layer claim sequence are
     story 02's (the A2 join); this story freezes the mechanics they compose. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 26 --autonomous`, Contract stage). Each behaviour
     task is one `.feature` under tasks/; done when its feature is green. The fitness functions are
     arch-tests (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_lease-claim-and-arbitration.feature` — `acquireLease` over an injected `runSync` against real git fixtures (ADR-003.3): an unopposed claim ⇒ **HELD** (own claim file `state:"claimed"`, pushed); two claimants racing one item over a shared bare remote ⇒ **exactly one holds** — the loser's pull surfaces the earlier remote claim, it stands down (its OWN file flips `state:"released"`, the winner's file untouched) and returns `{ held:false, heldBy }`; a claimant that cannot establish it won (sync keeps failing / unresolvable interleave) stands down — **ambiguity fails CLOSED** (two losers is a liveness hiccup; two winners is the KR2 violation); `claimedAt` NEVER decides a winner (clock skew must not arbitrate); release is an own-path **state write, never a delete, never a foreign write**.
- [x] `tasks/01_presence-is-the-lease-clock.feature` — claim liveness (ADR-003.2): a claim is LIVE iff `state === "claimed"` AND its holder's presence is fresh (`isNodeStale` over `presence/<node>.json`, threshold from `resolveStalenessSeconds` — `23/ADR-002` verbatim); a stale-presence holder's claim reads **LAPSED** (reclaimable) with ZERO foreign write — the lapse is a rule, not an edit; an owner returning from staleness withdraws its own lapsed claim (own-path hygiene); there is NO per-lease TTL, NO expiry stamp, NO second clock — presence IS the lease heartbeat.
- [x] `tasks/02_mesh-aware-next.feature` — `nextWork(workDir, scopeRef, { leaseView })` (ADR-005): the view ABSENT ⇒ byte-identical to today (the single-node floor — `work.mjs` stays pure over the work tree); an item `leased-live` ⇒ **skipped** exactly as not-actionable (next offers the following candidate); `leased-stale` ⇒ returned **ready + `{ reclaimable: true, leasedBy }`** (next is a READ — the claim path reclaims, story 02); the command builds the view ONLY under the `config.mesh.nodeId` gate; a cache-shaped hint injected as DATA can only ADD a skip, never unlease an item (the real subscriber cache wires in story 02).
- [x] `tasks/03_lease-render-on-status.feature` — the additive `mesh:status` lease render (ADR-005 consequences): who holds what — per lease: item ref, holder nodeId, live/lapsed; stable `--json` shape; zero leases ⇒ empty render, not an error; unconfigured mesh ⇒ the render is unchanged from today; the render is a pure READ (the partition root byte-unchanged).
- [x] **Fitness `acd-lease-write-scope`** (arch-test, ADR-003 / fitness #6) — every lease write joins the `leaseClaimPath`/`meshDir` seam via atomic `writeText` (never a bare `writeFile`); `mesh-lease.mjs` references ZERO record-doc filename; own-path writes only (the only claim path written is built with THIS node's id); no `unlink` of a claim.
- [x] **Fitness `acd-next-lease-injected`** (arch-test, ADR-005 / fitness #7) — `work.mjs` imports NO mesh module; `nextWork`'s lease view is an OPTIONAL argument defaulting absent; `commands/next.mjs` builds the view only under the config gate.
- [x] **Fitness `acd-lease-arbitration-git-observed`** (arch-test, ADR-003 / fitness #8) — the hold/stand-down resolver in `mesh-lease.mjs` is pure over git-read claims + presence: it imports NO cache/subscriber/relay module; the cache can only cause a SKIP/DEFER (in the command overlay), never a HOLD.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) (**ADR-003** — per-contender claim files
on the strict partition invariant (a contested same-path file would wedge the real engine: `git pull
--no-edit` has no conflict handling — an unrecoverable `pull-failed` MERGING state); arbitration =
remote-history order via git push atomicity, observed through the engine's honest envelopes — the
`push-failed` envelope IS the race signal; the frozen claim schema `{ itemRef, nodeId, state, claimedAt,
runId, aofVersion }`; presence is the lease clock. **ADR-005** — the optional injected `leaseView`;
live ⇒ skip, stale ⇒ reclaimable). This story **owns**: `src/mesh-lease.mjs` (NEW — claim assembly/read
with the mesh-store absence-tolerant/torn-file discipline, the presence-tied liveness predicate, the
PURE arbitration resolver, `acquireLease`/`releaseLease`/`standDown` over an injected `runSync`),
`src/work.mjs` (the optional `leaseView` parameter in `nextWork`), `src/commands/next.mjs` (the
config-gated view injection), and `src/commands/mesh-identity.mjs` (the additive `mesh:status` lease
render — an EXISTING verb: no bijection/route gate re-arms, the 22/R1 inverse stays clean).

**Builds against story 00's frozen contracts only** — `leaseClaimPath` (reserved there, written here),
the root-set `runSync` (injected as a closure over `syncMesh(workspace, { roots })`), the fourteen-key
record's `runId` tie slot — plus m23's presence reads (`isNodeStale`, `resolveStalenessSeconds`,
`readPresenceRecords`). It imports NO relay module: the whole story is provable over plain local git
fixtures. Graph-grounded: the claim point is a narrow two-file corridor (`commands/next.mjs` ← 1 → 1,
disjoint from the run-store subtree); `mesh-lease.mjs` couples INTO inherited m22/m23 seams, never into a
sibling story's files.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

<!-- Feasibility verdict at Contract: all four features FEASIBLE, zero retags; `aof work validate 26`
     passes after the flag-lock edits. Implementation guidance surfaced here; no ADR change. -->

**Verdict:** FEASIBLE. Every seam is workspace-scoped (no module-level cwd/config singleton) —
`meshDir(workspace)` ([mesh-store.mjs:46](../../../../../src/mesh-store.mjs#L46)) and every store/presence fn
takes `workspace`; `syncMesh(workspace, {})` resolves its repo from `workspace.workDir`
([mesh-sync.mjs:54–68](../../../../../src/mesh-sync.mjs#L54)) — so two clones of one bare remote drive
sequentially in one process, the proven fixture at
[test/mesh-git-sync-transport.test.mjs:287–336](../../../../../test/mesh-git-sync-transport.test.mjs#L287).

**The QA flags — resolved (locked in the feature comments):**
- **(task 00) two-clone drivability + scripted fake:** one pre-scripted frozen envelope per `runSync` call
  in order; the test plants competitor claim bytes between calls; `acquireLease` re-reads claims off the
  tree after every call and decides only from (claims × presence) + `synced`/`reason`; retries bounded by an
  exported `MAX_CLAIM_SYNC_ATTEMPTS` the ambiguity rows count.
- **(task 01, PO CONTRACT LOCK — applied) claimed + no-presence-record:** the KR2-SAFE reading STANDS —
  leased (readers skip) but **NOT reclaimable** (never lapse a claim whose holder we have simply never heard
  from; over-skipping is a liveness hiccup, reclaiming a possibly-live node's work is the double-execution
  KR2 forbids; consistent with the m23 lock "never-beat ≠ stale"). **Cross-checked task 02:** its view
  vocabulary never maps a no-presence holder to the reclaimable bucket — the features already agreed, so
  NO consistency fix was needed; the agreement is pinned explicitly in both flag comments.
- **(task 01) returning-owner withdrawal seam:** a standalone exported
  `withdrawOwnLapsedClaims(workspace, nodeId, { nowMs, thresholdMs })` in `mesh-lease.mjs`, which
  `acquireLease` also calls as its first own-path step. Own presence stale ⇒ flip own `claimed` files to
  `released` (own `leaseClaimPath` only); fresh ⇒ zero-write no-op; hygiene runs before the fresh heartbeat.
- **(task 02) leaseView shape (frozen):** `Map<itemRef, { state: "leased-live"|"leased-stale", holder }>`,
  absence = unleased, `nextWork` uses only `.get(ref)`; refs come from the claim record's `itemRef`, never
  the flatLeaf'd dir name; a no-presence holder → the `leased-live` (skip) bucket; the builder is a pure
  `buildLeaseView(claims, presenceById, { nowMs, thresholdMs, hint })` with a disk-first, add-skip-only hint
  overlay. The command rows add an optional `now` input (the `mesh:status` white-box idiom — NOT a new verb).
- **(task 03) --json literals:** confirmed buildable against the existing render/json idiom — no renegotiation.

**`src/mesh-lease.mjs` (NEW) — module layout, top to bottom:**
- Header mirrors [mesh-presence.mjs:1–36](../../../../../src/mesh-presence.mjs#L1)'s discipline block.
  Imports: `writeText` from `./fs.mjs`; `meshDir, leaseClaimPath` from `./mesh-store.mjs`;
  `isNodeStale, resolveStalenessSeconds, readPresenceRecord` from `./mesh-presence.mjs`. Import NOTHING from
  `mesh-sync`/`mesh-relay*`/`mesh-presence-cache`/`mesh-presence-subscriber` (fitness #8) and reference no
  record-doc filename (fitness #6).
- `export const MAX_CLAIM_SYNC_ATTEMPTS = 2` — the bounded-retry literal the ambiguity rows count.
- `assembleClaimRecord({ itemRef, nodeId, state, claimedAt, runId, aofVersion })` — the frozen six keys in
  ADR-003.1 order, `runId: null` at claim (the `assemblePresenceRecord` idiom).
- `readItemClaims(workspace, itemRef)` / `readLeaseClaims(workspace)` — the `readNodeRecords` walk
  ([mesh-store.mjs:123–140](../../../../../src/mesh-store.mjs#L123)) one level deeper: absence ⇒ `[]`, torn
  file ⇒ skip.
- `claimLiveness(claim, holderPresence, nowMs, thresholdMs)` — PURE, three-outcome: `state !== "claimed"`
  ⇒ `not-held`; presence fresh ⇒ `live`; presence stale (`isNodeStale`) ⇒ `lapsed`; presence `null` ⇒
  `leased-unknown` (skip, NOT reclaimable — the PO lock). Never touch `claimedAt` except for display.
- `resolveArbitration(ownNodeId, claims, presenceById, nowMs, thresholdMs)` — PURE over data: any
  live/unknown competing claim ⇒ `{ held:false, heldBy }`; else `{ held:true }`. The resolver fitness #8 greps.
- `withdrawOwnLapsedClaims(...)` — as locked above.
- `acquireLease(workspace, itemRef, nodeId, { runSync, now, config, aofVersion })` — the ADR-003.3 protocol:
  hygiene → step-a local read (no own file minted on a visible live competitor) → write own claim
  (`writeText` at `leaseClaimPath(...)`) → `runSync()` loop: clean sync + re-read shows no live competitor
  ⇒ held; `push-failed` ⇒ retry (≤ `MAX_CLAIM_SYNC_ATTEMPTS`) + re-observe; competitor observed OR attempts
  exhausted OR `pull-failed` persists ⇒ `standDown` (own-file flip to `released`) and a `{ held:false,
  heldBy?, mint:false }`-shaped result telling the caller to mint nothing. Threshold from
  `resolveStalenessSeconds(config)`; `now` injected.
- `releaseLease` / `standDown` — own-path state write to `"released"`, never `unlink`. Keep the writer
  functions' own-node parameter literally named `nodeId` so fitness #6 can assert every written
  `leaseClaimPath(...)` first-arg is the own id (own-path-only, no foreign `holder`).

**`src/work.mjs` (`nextWork`, [line 522](../../../../../src/work.mjs#L522)):** signature →
`nextWork(workDir, scopeRef, { leaseView } = {})`. Touch points: inside the story loop at
[:565](../../../../../src/work.mjs#L565) — `leased-live` ⇒ `continue` + set a `leaseSkipped` flag;
`leased-stale` ⇒ `return { ...ready(story, storyMeta.status), reclaimable: true, leasedBy: holder }`; after
the loop, `if (leaseSkipped) continue;` **before** the [:567](../../../../../src/work.mjs#L567)
milestone-accept return (the false-accept guard the all-leased row pins), so
[:570](../../../../../src/work.mjs#L570)'s `blocked ?? { state:"done" }` produces the honest
nothing-actionable shape. NO mesh import (fitness #7); absent view ⇒ zero behavioural delta.

**`src/commands/next.mjs`:** add optional `now` to the input schema; in `run`, gate on
`ctx.workspace.config?.mesh?.nodeId` — configured ⇒ `readLeaseClaims` + per-holder `readPresenceRecord`,
`buildLeaseView(..., { hint: ctx.leaseCache ?? null })`, pass as the third arg; unconfigured ⇒ the exact
two-arg call of today. `render`/`json` pass through the new `reclaimable`/`leasedBy` keys.

**`src/commands/mesh-identity.mjs` (`mesh:status`):** after the nodes loop
([:221](../../../../../src/commands/mesh-identity.mjs#L221)), `if (ws.config?.mesh?.nodeId) result.leases =
[...]` — per `state:"claimed"` record `{ itemRef, holder: record.nodeId, live }` using the same
`nowMs`/`thresholdMs` already computed at [:172–173](../../../../../src/commands/mesh-identity.mjs#L172);
released files filtered out; no dedup across claimants. `render` appends lease lines only `if
(result.leases)`; `json` stays pass-through. Absent when unconfigured (byte-identical), `[]` when
configured-but-empty.

**Behavioural test files** (m23 traceability idiom — one exported array, one object per scenario):
`test/mesh-lease-claim-arbitration.test.mjs` (task 00 — `buildFixture`/`clonePeer` for real-git rows + a
scripted-envelope fake for the outline rows), `test/mesh-lease-clock.test.mjs` (task 01 — the staleness
test's seed / injected-now / `snapshotTree` idioms), `test/work-next-lease-view.test.mjs` (task 02 — the
work-next `buildStream` builder + hand-built Maps; command rows via `loadWorkspace` + `invoke`),
`test/mesh-status-lease-render.test.mjs` (task 03 — `invoke("mesh:status", { now }, ctx)`).

**Arch-tests:** `acd-lease-write-scope` clones the `acd-presence-write-scope` helpers verbatim
([test/arch/acd-presence-write-scope.test.mjs:106–138](../../../../../test/arch/acd-presence-write-scope.test.mjs#L106))
over `mesh-lease.mjs` (zero record-doc names, no bare `writeFile`/`appendFile`, every write joins
`leaseClaimPath`/`meshDir`, zero `unlink`/`rm`, own-`nodeId` first-arg) with the m03 planted-violation
self-check; `acd-next-lease-injected` import-greps `work.mjs` (no `mesh-` specifier) + the `{ leaseView } =
{}` default + the `config.mesh` gate in `commands/next.mjs`; `acd-lease-arbitration-git-observed`
import-greps `mesh-lease.mjs` (no cache/subscriber/relay specifier; positive: it DOES import
`mesh-store` + `mesh-presence`). Register a milestone-26/story-01 block in
[scripts/test.mjs](../../../../../scripts/test.mjs) (4 behavioural + 3 arch imports, the m23 pattern).
