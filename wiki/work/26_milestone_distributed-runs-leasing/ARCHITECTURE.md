---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 26 · Distributed Runs + Leasing — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the three moves: **node-dimensioned run
> records** (`runs/<node>/<run-id>.json`, add-only merges, PRD §7.2 KF4), **lease/claim** (relay fast-path
> arbitration backed by a git **lease-of-record**; the loser stands down; `aof work next` becomes
> mesh-aware — KR2's mechanism, PRD §7.2 KF5), and **fleet orphan reclaim** (m20's restart scan
> generalised over stale peers); the load-bearing invariant **correctness NEVER depends on the relay** —
> its loss only slows arbitration to the git cadence, PRD A2 — this milestone is the PRD's **primary
> spike**: the relay-grant vs git-commit ordering) and `STATE.md` (the open contract points refined here:
> the lease-of-record file format + the relay-grant→git-commit sequence, how `runs/` partitions by node so
> merges stay add-only, how `aof work next` becomes mesh-aware, and how m20's restart-time backstop scan
> generalises to a fleet orphan scan). Prior art: `PRD-decentralized-agent-orchestration.md` (§7.2 KF4/KF5;
> §7.3 "git … remains the single system of record for ALL authoritative state — run records, work items,
> leases-of-record"; A1 git the durable bus; **A2 leasing is race-safe — relay fast-path + a git
> lease-of-record prevents double-work without making correctness depend on the relay**; A5
> push-for-liveness/poll-for-durability; KR2 "100 contested claims, 0 double-executions").
>
> **The precedents this milestone APPLIES and never re-litigates: milestones 19/20 (the run lifecycle +
> resilience spine), 22 (the mesh foundation), and 23 (the relay + presence).** `19/ADR-002` (the runs/
> log is DERIVED, per-run files under a path-built dir, explicitly partition-ready for this milestone's
> `<node>/` segment); `20/ADR-001` (the additive-keys record freeze — the extension discipline reapplied
> here); `20/ADR-004` (heartbeat + the restart-time reclaim scan that takes the item list AS AN ARGUMENT —
> the `26 → 20` seam, built two milestones ago for exactly this widening); `20/ADR-005` (the scan
> ORCHESTRATES, `work.mjs` WRITES the status rollback — ownership preserved verbatim); `20/ADR-006` (the
> dedup guard) and `20/ADR-007` (atomic persist); `22/ADR-002` (the path-partition invariant + the FROZEN
> `runNodeRecordPath` convention `join(runsDir(item), node, runId + ".json")` — a pure builder that
> "WRITES NOTHING (milestone 26 builds the writes)"); `22/ADR-004` (the payload-agnostic git-sync engine
> — read closely below, because its ACTUAL semantics carry the lease protocol); `23/ADR-001` (the frozen
> `{ kind, nodeId, signal }` envelope whose comment already reserves "m26 leasing is the second kind");
> `23/ADR-002` (node presence + `isNodeStale` — the staleness signal leasing and reclaim both consume);
> `23/ADR-003` (git unconditional, relay best-effort — the two-bus discipline the claim sequence mirrors);
> `23/ADR-004` (the in-memory liveness cache that is NEVER a second system of record — the lease cache is
> the same shape). ADRs below cite these as `NN/ADR-00n` / `SPEC §…` / `STATE §…` / `PRD §…`.
>
> The seam (confirmed against the codebase graph, `aof graph build src` → **1174 nodes / 3162 edges**,
> builtAt 2026-07-01, egress none; `aof graph impact` consulted at author time — cited as **actual**
> structure, not inferred). `src/run-store.mjs` is the **widest-fan-in spine this milestone touches**
> (dependents ← `commands/run-complete.mjs`, `run-retry.mjs`, `run-start.mjs`, `run-status.mjs`,
> `mesh-presence.mjs`, `mesh-store.mjs` = **6**; dependency → `fs.mjs` = 1): its `runRecordPath` (line 59)
> is documented as THE single run-path builder where "milestone 26's `<node>/` segment slots in as ONE
> additive edit", its `reclaimStaleRuns` (line 407) already takes the scan set as an argument, and its
> `isStale` (line 390) is the ONE staleness predicate `mesh-presence.mjs` already imports (the `23 → 20`
> seam) — so the run-dimension change lands on a spine SIX modules consume, and must be frozen first, in
> one story. `src/mesh-store.mjs` (← 3: `commands/mesh-identity.mjs`, `mesh-presence.mjs`,
> `mesh-sync.mjs`; → 2: `fs.mjs`, `run-store.mjs`) already carries the FROZEN `runNodeRecordPath`
> convention (lines 85–87) and the `flatLeaf` path-safety boundary the lease path reuses.
> `src/mesh-relay-client.mjs` (← 2: `commands/mesh-heartbeat.mjs`, `mesh-presence-cache.mjs`; → **0**) is
> a LEAF — the second signal `kind` is an additive edit on a zero-dependency leaf, and `src/mesh-relay.mjs`
> itself needs **zero change** (the `23/ADR-001` promise, cashed by fitness #10). The read-side claim
> point is a narrow two-file seam: `src/commands/next.mjs` (← 1: `command-core.mjs`; → 1: `work.mjs`) over
> `work.mjs:nextWork` (line 522, pure over the work tree) — disjoint from the run-store subtree, so
> mesh-aware `next` is an injection at the command layer, never a mesh import inside `work.mjs`.
> `src/command-core.mjs` (← 4; → 25) is NOT touched: this milestone adds **zero new command verbs**
> (ADR-004/005/006 land behind the existing `work:next` / `work:run-start` / `work:run-complete` /
> `mesh:status` faces), so even the sanctioned add-only co-touch at the one additive door is absent.
>
> **One graph-checked correction to a prior comment (surfaced for the retro):** `src/mesh-sync.mjs`'s
> header claims a record type it has never seen ("runs in m26") syncs with ZERO engine change — TRUE for
> content (the engine never parses record bytes) but FALSE for scope: the engine stages ONLY the partition
> root (`git add -- <meshDir>`, line 128), and run records live under `wiki/work/**/runs/`, OUTSIDE
> `meshDir`. The pull half is already branch-wide (line 165 — a plain `git pull` brings peers' commits
> regardless of path); only the COMMIT half is scoped. ADR-002 settles this honestly (a root-SET argument)
> instead of inheriting the over-promise.
>
> **Prior-lesson recall** (`work memory recall "lease-of-record relay-grant git-commit ordering race"
> --area architecture --block`) surfaced five items; each is acknowledged as honoured or a conscious
> departure:
> - **23/ADR-004 — the node-side consumer applies relay frames into an IN-MEMORY cache; the subscriber
>   writes NO durable record, NEVER a second system of record.** **HONOURED:** the lease fast-path signal
>   is applied into an in-memory lease cache of the SAME shape (ADR-004), covered by extending the SAME
>   cache-only gate (fitness #11); the cache can only cause a SKIP/DEFER, never a HOLD (fitness #8).
> - **23/ADR-002 — presence/heartbeat as the node-staleness signal, extending m20's `isStale` to the
>   fleet.** **HONOURED — load-bearing:** presence IS the lease clock. A claim is live iff its holder's
>   presence is fresh (`isNodeStale`); there is NO per-lease TTL and NO parallel expiry clock (ADR-003).
>   Fleet reclaim's stale-peer detection is the same predicate (ADR-006).
> - **23/ADR-003 — presence published over BOTH buses; git UNCONDITIONALLY, relay best-effort; the relay
>   push NEVER gates the git write.** **HONOURED — the milestone's centre:** the claim sequence is frozen
>   in the same structural form — the durable local claim write + the git sync are never nested inside a
>   relay-success branch; the relay intent push is caught, never thrown (ADR-004, fitness #9). The git
>   lease-of-record is authoritative; the relay grant is advisory-only.
> - **23/ADR-001 — the thin relay's FROZEN payload-agnostic envelope; "m26 leasing is the second kind".**
>   **HONOURED — the promise is cashed:** leasing rides the wire as a second `kind` with **zero** change to
>   `src/mesh-relay.mjs` (fitness #10 greps that the relay never references the lease kind or a lease
>   module — the relay stays kind-blind).
> - **23/R3 (NEAR-MISS) — a git-as-bus EOL pin must match the REAL nested record path, not a root
>   anchor.** **HONOURED — explicitly checked against the repo:** `.gitattributes` today pins `**/.mesh/**`
>   (so the lease records under `.mesh/leases/**` are ALREADY covered — no new pin needed for leases) but
>   NOTHING covers the runs tree — `wiki/work/<item>/runs/<node>/<run-id>.json` is unpinned. The pin lands
>   in story 00 as a structural deliverable, and its arch-test asserts by MATCHING the real nested sample
>   path, not by grepping a literal (ADR-001, fitness #3).
>
> **Scope-precision carry-forwards (22/R1 + 22/R4 + 22/R6).** **22/R1:** the registry-derived gates this
> milestone arms — **NONE new**: m26 adds ZERO command verbs (the claim/reclaim/release land inside the
> existing `work:run-start` / `work:run-complete`; the lease view inside `work:next`; the lease render is
> an additive overlay on the existing `mesh:status`). So `acd-mesh-command-cli-bijection` is NOT re-armed
> (no new `mesh:*` verb), `acd-work-command-route-coverage` is NOT newly armed (no new `work:*` verb — the
> existing verbs keep their routes), `acd-command-namespace` is NOT armed (no bundle skill members). The
> inverse-R1 check is CLEAN. A `work:claim` verb was considered and rejected (ADR-004 alternatives).
> **22/R4:** the aof self-host repo is not a mesh node — the lease records live under `wiki/work/.mesh/`,
> which the m23 self-host `.gitignore` already covers; single-node (mesh-unconfigured) runs stay FLAT, so
> no new self-host ignore is needed. **22/R6:** an ADR promising uniqueness pins the data source — claim
> uniqueness rests on the `(itemRef, nodeId)` path key (one claim file per contender, the `22/ADR-002`
> partition), and HOLDER uniqueness rests on the git remote's push serialization (pushes to one ref are
> atomic and ordered — the ADR-003 arbitration) plus fail-closed stand-down; presence (`mesh.nodeId`,
> `23/ADR-002`) is the liveness source. No mechanic invents a new identity or clock.

## ADR-001: Node-dimensioned run records — the `<node>/` segment lands in `run-store.mjs` as the m22-frozen convention made real; the record gains ONE additive `node` key (a FOURTEEN-key freeze superseding `20/ADR-001`'s thirteen); every reader sees the UNION of flat + node-partitioned records; an unconfigured-mesh install is byte-identical to today; the R3 `.gitattributes` pin lands on the REAL nested path

**Status:** Accepted
**Date:** 2026-07-02

**Context.** Two milestones prepared this exact edit. `19/ADR-002` made the runs/ log derived and
partition-ready ("milestone 26's `<node>/` segment slots in as ONE additive edit to `runRecordPath`" —
`src/run-store.mjs` lines 56–61). `22/ADR-002` FROZE the convention as a pure builder that writes nothing:
`runNodeRecordPath(item, node, runId)` = `join(runsDir(item), node, runId + ".json")` (`src/mesh-store.mjs`
lines 85–87), composing 19's `runsDir` so convention and store provably meet here. The graph shows
`run-store.mjs` at **6 dependents** (the four `run-*` commands + `mesh-presence.mjs` + `mesh-store.mjs`) —
the widest-fan-in module this milestone touches, so the change must be additive and frozen in one story.
Three constraints bind the shape: (1) **single-node installs keep working UNCHANGED** — no mesh config ⇒
the flat `runs/<run-id>.json` path, zero mesh coupling (`run-store` reads no config, `08/ADR-002`
basis-neutral); (2) **both shapes read forward** — a legacy flat record and a node-partitioned record are
the same record ("absence is benign", `19/ADR-002`); (3) the **dedup guard** (`20/ADR-006`) and
**`completeRun` target resolution** must see runs across ALL node subdirs, or two nodes' records could hide
a duplicate from each other. One import-direction fact forces a home decision: `mesh-store.mjs` imports
`run-store.mjs`, so `run-store` can never import `runNodeRecordPath` back from `mesh-store` (a cycle) —
yet the write path must compose exactly that builder.

**Decision.** Five additive moves on the spine:

1. **The builder's authority moves to `run-store.mjs`; `mesh-store.mjs` re-exports it.** `runNodeRecordPath`
   is defined ONCE, in `run-store.mjs` (beside `runRecordPath`, built FROM `runsDir` — the byte-identical
   frozen shape), and `mesh-store.mjs` replaces its local definition with a re-export, so every existing
   import site is unchanged and there is still exactly ONE builder (fitness #1). This preserves the
   m22-frozen CONVENTION (the path shape) while fixing the module home the import direction requires — a
   home change, not a contract change.

2. **The record gains ONE additive key: `node` (string | null) — a FOURTEEN-key freeze superseding
   `20/ADR-001`'s thirteen**, by the same discipline that freeze itself used to supersede `19/ADR-003`'s
   nine: the prior thirteen keys unchanged in name/order/meaning, `node` appended, defaulting `null` in
   `normalizeRecord` so every legacy record reads forward (fitness #2). The record carries its own
   partition provenance — a run read in isolation knows its owner without path archaeology, which ADR-006's
   fleet reclaim and ADR-003's lease↔run tie both consume.

3. **The persist path derives placement FROM the record**: `record.node` set ⇒ persist at
   `runNodeRecordPath(item, record.node, runId)`; `null` ⇒ the legacy flat `runRecordPath` — ONE
   direction (record → path), never path → record on write. The mint (`mintRun`) accepts an optional
   `node` passed by the COMMAND layer from `config.mesh.nodeId` (the store never reads config); the
   commands pass it only when mesh is configured, so the unconfigured install writes byte-identical flat
   records (fitness #4).

4. **Every reader sees the UNION.** `readRuns` reads flat `*.json` entries AND one level of node subdirs
   (both shapes, same normalization, same torn-file tolerance); `readRun`/`applyTransition` resolve a runId
   across the union; the dedup guard (which reads `readRuns`) therefore refuses a duplicate non-terminal
   run **across nodes** for free, and `completeRun`'s no-runId resolution sees every node's running runs.
   **runId uniqueness is per-ITEM across ALL node subdirs**: the mint's seq seed counts the union and the
   collision-safe write-if-absent probe checks the union, so two nodes minting at the same instant get
   distinct ids even before their trees converge (the `20/ADR-006` guard, widened to the union).

5. **The R3 `.gitattributes` pin — on the REAL path.** The run records become a git-as-bus record class
   (ADR-002 syncs them), so the 23/R3 lesson bites verbatim: `.gitattributes` gains a rule covering the
   REAL nested shape `wiki/work/<item>/runs/<node>/<run-id>.json` (and the flat legacy shape), pinned
   `text eol=lf` like `**/.mesh/**`. The arch-test asserts by matching the real sample paths against the
   rules (git's own semantics), never by grepping a pattern literal (fitness #3). The lease records need
   NO new pin — `**/.mesh/**` already covers `.mesh/leases/**` (checked at author time).

**Alternatives considered.**
- *Keep the builder in `mesh-store.mjs` and have `run-store` re-implement the join* — rejected: two path
  builders for one convention is the exact divergence `22/ADR-002` froze the builder to prevent; the
  import cycle forbids the clean import, so the home moves instead.
- *Derive the node from the subdir name instead of a record key* — rejected: a record read in isolation
  (reclaim lists, lease↔run ties, board renders) would need its path carried alongside everywhere; the
  additive-key discipline (`20/ADR-001`) exists precisely for this, and `null` keeps legacy records honest.
- *A parallel `runs-mesh/` tree, leaving `runs/` untouched* — rejected: two run logs for one item is two
  authorities for one fact; the union-reader over one tree keeps `19/ADR-002`'s single derived log.
- *Require mesh config and migrate flat records* — rejected: single-node installs are the majority and
  MUST be untouched (`SPEC §Scope`); absence-is-benign forward reading costs nothing.

**Consequences.** Story 00 builds the `run-store.mjs` extension (fourteen-key record, union readers,
record-driven persist, union-probing mint), the `mesh-store.mjs` re-export flip, the `.gitattributes` pin,
and fitness #1–#4. It touches NO command file (the `node` pass-through lands with story 02's command
integration) and NO mesh module import appears in `run-store.mjs` — the node id arrives as data. The
*observable* behaviour (two nodes' records merge add-only; a legacy record reads forward; dedup sees a
peer's run) is story-00 task `.feature` material, not a fitness function.

## ADR-002: The sync-scope generalisation — `syncMesh`'s staged root becomes a root-SET argument defaulting `[meshDir]` (m22/m23 call sites unchanged); the mesh-aware install adds the runs pathspec; the engine stays payload-agnostic; the pull half is already branch-wide

**Status:** Accepted
**Date:** 2026-07-02

**Context.** The lease protocol (ADR-003) and fleet reclaim (ADR-006) both require a peer's RUN RECORDS on
this node's disk — but the `22/ADR-004` engine's ACTUAL semantics (read at author time,
`src/mesh-sync.mjs`) are asymmetric: the **pull half is branch-wide** (line 165, a plain
`git pull --no-edit` — peers' commits arrive regardless of path, and a non-zero pull returns the honest
`pull-failed` envelope, never swallowed), while the **commit half is scoped** — it stages ONLY the
partition root (`git add -- <meshDir>`, line 128) with a pathspec'd commit (line 150) so a background tick
never sweeps unrelated working-tree changes. Run records live under `wiki/work/**/runs/`, OUTSIDE
`meshDir`: as built, a node's run-record writes would never be committed/pushed by the sync tick, and the
engine header's "runs in m26 syncs with ZERO engine change" over-promises (true of CONTENT, false of
SCOPE). The lease records, by contrast, will live under `.mesh/` (ADR-003) exactly so they ride the engine
with genuinely zero change.

**Decision.** `syncMesh(workspace, { roots })` — the staged-root becomes a **root/pathspec SET argument,
defaulting to `[meshDir(workspace)]`** (the `reclaimStaleRuns` item-list-as-argument shape, `20/ADR-004`:
generalise by widening an argument, not rewriting the mechanic). Every stage/diff pathspec (`git add --`,
`git diff --cached -- …`, the commit pathspec, the pulled-names diff) iterates the set. The default
preserves today's behaviour byte-for-byte for every existing caller (the `mesh:sync` command, the m23
loops). The mesh-aware claim/reclaim paths (stories 01/02) pass `[meshDir, <the runs pathspec>]`, where
the runs pathspec is a glob-magic pathspec covering `<workDir>/**/runs/**` — resolved by a small pure
helper beside `syncMesh`, so the glob literal has ONE home. The engine remains **content-agnostic**: it
still moves bytes, never parses a record, never imports a schema — the existing
`acd-mesh-sync-record-neutral` gate re-arms GREEN over the modified engine (fitness #5). Work-stream
record docs and item frontmatter are deliberately NOT added to the staged set: cross-node propagation of
statuses/records rides the normal git workflow (correctness rests on the LEASE, ADR-003, never on fresh
frontmatter — and issuing/routing work across nodes is milestone 27, `SPEC §Out of scope`).

**Alternatives considered.**
- *Stage the whole `workDir`* — rejected: the background tick would sweep an operator's in-flight record-doc
  edits into machine commits — the exact hazard the engine's pathspec discipline exists to prevent.
- *Relocate run records under `.mesh/`* — rejected: it breaks the m22-FROZEN `runNodeRecordPath`
  convention and `19/ADR-002`'s runs-under-the-item locality; the convention was frozen two milestones ago
  precisely so m26 would NOT relocate anything.
- *A second, runs-only sync engine* — rejected: two transports racing one remote is two half-engines with
  interleaved pulls; the root-set argument is one engine, one tick, one honest failure envelope.

**Consequences.** Story 00 builds the root-set argument + the runs-pathspec resolver + fitness #5, and
amends the engine header comment to the honest claim (content-agnostic always; scope by argument). The
engine's honest failure envelopes (`push-failed` / `pull-failed`) are UNCHANGED — ADR-003 builds its
arbitration on them. Stories 01/02 consume `runSync` as an injected closure over
`syncMesh(workspace, { roots })`, so lease tests run over plain local git fixtures.

## ADR-003: The lease-of-record — per-contender claim files `.mesh/leases/<item>/<node>.json` (the partition invariant holds STRICTLY; a contested same-path lease file is rejected because the real engine wedges on content conflicts); arbitration is REMOTE-HISTORY ORDER via git push atomicity — the engine's honest `push-failed` envelope IS the race signal; a claim is live iff its holder's PRESENCE is fresh (no parallel clock); ambiguity fails CLOSED

**Status:** Accepted
**Date:** 2026-07-02

**Context.** The lease is per-ITEM and CONTESTED — two nodes racing one item — which appears to collide
with `22/ADR-002`'s one-node-per-path partition invariant. The resolution comes from the ENGINE's actual
semantics, read at author time: `syncMesh` pulls with a plain `git pull --no-edit` and, on a non-zero
status, returns `{ synced:false, reason:"pull-failed" }` — it has NO conflict handling and does NOT abort
a failed merge (`src/mesh-sync.mjs` lines 165–170). If two nodes wrote different bytes to ONE shared lease
path, the loser's pull would hit a three-way content conflict and leave the repo in a MERGING state the
engine cannot recover — a wedged bus, the exact failure `22/ADR-002` partitioned paths to make impossible.
So the lease file CANNOT be a single contested path. Meanwhile git gives one primitive for free: **pushes
to a single remote ref are atomic and serialized** — of two racing pushes, exactly one lands; the second is
rejected non-fast-forward, and after its pull the first pusher's commit is on its disk. And m23 gives the
liveness primitive: `isNodeStale(presence, nowMs, thresholdMs)` over the git-tracked
`presence/<node>.json` (`23/ADR-002`) — the recall directive is explicit: reuse it, never a parallel
expiry clock.

**Decision.** Four frozen contract points:

1. **The claim record — per-(item, contender) files, partition-clean.** A node claims item `<ref>` by
   writing its OWN file at `leaseClaimPath(workspace, itemRef, nodeId)` =
   `join(meshDir(workspace), "leases", flatLeaf(itemRef), flatLeaf(nodeId) + ".json")` — a pure builder in
   `mesh-store.mjs` beside `presenceRecordPath`, routed through the SAME `flatLeaf` path-safety boundary
   (`22/ADR-002`), RESERVED by story 00 (the m22→m23 seam-reservation precedent) and written only by story
   01. One contender per path ⇒ every merge is add-only; the partition invariant holds **strictly** for
   leases. The frozen, additive-friendly schema (top-level keys, persisted opaque via atomic `writeText`):

   ```jsonc
   // wiki/work/<work-root>/.mesh/leases/<item-ref>/<node-id>.json — one file PER CONTENDER.
   {
     "itemRef":   string,            // the claimed item (the ref work:run-start resolves)
     "nodeId":    string,            // the contender — the SAME config.mesh.nodeId presence is keyed by
     "state":     "claimed" | "released",  // released = withdrawn (lost/stood-down) OR finished
     "claimedAt": string,            // ISO-8601 UTC-Z; provenance/diagnostics — NEVER the arbitration key
     "runId":     string | null,     // the lease↔run tie: null at claim, set once the run is minted
     "aofVersion": string            // provenance (mirrors the node/presence records)
   }
   ```

2. **A claim is LIVE iff `state === "claimed"` AND its holder's presence is FRESH** (`isNodeStale` over the
   holder's `presence/<node>.json`, threshold from `resolveStalenessSeconds` — `23/ADR-002` verbatim).
   Presence IS the lease heartbeat: there is NO per-lease TTL, no lease expiry stamp, no second clock. A
   stale-presence holder's claim is LAPSED — treated by readers as reclaimable (ADR-005/006) with no
   foreign write needed to release it. **Release is an own-path write**: the holder (or a stood-down loser)
   sets `state:"released"` on ITS OWN file; the holder releases at run completion (story 02 wires
   `work:run-complete`). An owner returning from staleness withdraws its own lapsed claims (own-path
   hygiene) — nobody else ever touches them.

3. **Arbitration is remote-history order, observed through the engine's honest envelopes.** The acquire
   protocol (`acquireLease` in `src/mesh-lease.mjs`, with `runSync` injected):
   - (a) read the item's claims off the local tree — a LIVE competing claim already visible ⇒ do not claim
     (the git-cadence skip);
   - (b) write this node's claim file (atomic, own path);
   - (c) `runSync()` — the engine commits, pulls (add-only ⇒ always a clean merge of disjoint claim
     files), pushes;
   - (d) **the push outcome IS the race signal**: a clean sync in which the pull surfaced NO live competing
     claim for the item ⇒ this claim reached the remote first ⇒ **HELD**. A `push-failed` envelope means
     the remote moved mid-race ⇒ sync again (bounded retries) and re-observe; if the pull has brought a
     competing LIVE claim that was on the remote before ours landed (it arrived while ours was still
     un-pushed) ⇒ the competitor won ⇒ **STAND DOWN**: set own `state:"released"`, return
     `{ held:false, heldBy }` — the caller mints NO run.
   - Git's push serialization makes this well-defined pairwise: of two racing claimants exactly one push
     lands first, and the second claimant's mandatory pull-before-push shows it the winner's claim.
   - (e) **Ambiguity fails CLOSED**: a claimant that cannot establish it won (a crash mid-protocol, an
     unresolvable interleave, a sync that keeps failing) stands down. Two losers is a liveness hiccup
     (retry later); two winners is the KR2 violation — safety always wins. `claimedAt` is NEVER compared to
     decide a winner (clock skew must not arbitrate).

4. **Third-party readers never resolve the winner.** For `work:next` (ADR-005) and any render, the rule is
   only: ANY live claim on an item ⇒ the item is leased (skip); live claims by a stale node ⇒ reclaimable.
   During the transient two-claims window, both readers see "leased" — correct, since at most one claimant
   will hold and the other is standing down. Converged steady state is one `claimed` file (the holder) and
   zero-or-more `released` files.

**Alternatives considered.**
- *One lease file per item, first-push-wins on the SAME path* — **REJECTED on the engine's actual
  semantics**: the loser's `git pull --no-edit` hits a content conflict, the engine returns `pull-failed`
  and leaves a MERGING work tree it cannot abort — a wedged sync bus. The per-contender partition makes
  every merge add-only, which is the property that keeps git viable as the bus (`22/ADR-002`).
- *Deterministic tie-break by `(claimedAt, nodeId)` over the claim set* — rejected as the ARBITER: it is
  safe only if both contenders decide from the SAME converged set, but a winner must decide at its own
  push point, before convergence — a skewed clock could then crown both. Remote-history order is decided
  by the remote's serialization, not a clock. (`nodeId` ordering survives only as a non-load-bearing
  render sort.)
- *A lease TTL / expiry timestamp on the claim* — rejected: a second liveness clock beside presence is the
  parallel-heartbeat fork `23/ADR-002` exists to prevent; the recall directive pins presence as the ONE
  staleness source.
- *Delete the claim file on release instead of writing `state:"released"`* — rejected: a delete + a
  concurrent re-claim by another node is a path resurrection race, and history/diagnostics lose the
  stand-down trail; an own-path state write is atomic (`writeText`) and add-only-merge-safe.
- *Arbitrate on the relay (the control node grants leases)* — rejected outright: it makes correctness
  depend on the relay (PRD A2's forbidden direction) and makes the relay stateful (`23/ADR-001`'s
  forbidden direction). The relay never grants anything authoritative (ADR-004).

**Consequences.** Story 00 RESERVES `leaseClaimPath` (pure builder, writes nothing — the `22/ADR-002`
reservation idiom). Story 01 builds `src/mesh-lease.mjs`: the claim assembly/read (absence-tolerant,
torn-file-skipping — the mesh-store read discipline), the liveness predicate (claims × presence), the
pure arbitration resolver, and `acquireLease`/`releaseLease`/`standDown` over the injected `runSync` —
git-only, NO relay import (the relay overlay is story 02, composed in the COMMAND, ADR-004). It arms
fitness #6 and #8. The *observable* protocol (two clones race one item over a shared bare remote; exactly
one holds; the loser's result says stood-down; a crashed holder's claim lapses with its presence) is
story-01/02 task `.feature` material against real git fixtures.

## ADR-004: The A2 protocol — the relay fast-path is a NODE-SIDE advisory intent broadcast (`kind:"lease"`, the envelope's second kind; ZERO relay change); the claim sequence is FROZEN: durable local claim write → best-effort relay intent (caught) → git sync (authoritative) → arbitrate from GIT observation only; a node holding only a relay grant that loses the git race STANDS DOWN; relay loss degrades arbitration to the git cadence, never blocks a claim

**Status:** Accepted
**Date:** 2026-07-02

**Context.** This is the PRD's primary spike (A2; `STATE §Notes`): the relay-grant vs git-commit ordering.
The PRD phrase "relay fast-path arbitration (advisory mutual exclusion)" must be reconciled with what the
relay ACTUALLY is: a stateless, payload-agnostic fan-out broker that parses only `{ kind, nodeId }` for
routing, forwards `signal` byte-for-byte, and forwards UNKNOWN kinds rather than rejecting them
(`src/mesh-relay.mjs` lines 82–101, 184–191 — built in m23 explicitly so "m26 leasing rides with zero
relay change"). A stateless broker cannot GRANT: any relay-side grant table would make it stateful and
authoritative — both forbidden (`23/ADR-001`, PRD §7.3). So the fast path is **node-side**: contenders
broadcast claim INTENT over the relay; peers apply it into an in-memory cache (`23/ADR-004`'s shape) and
DEFER — which collapses the race window from the git cadence (~15–30s) to relay latency (~ms) — while the
git lease-of-record (ADR-003) alone decides who holds. m23 froze the send discipline this must mirror:
git unconditional, relay best-effort, the push never gating the durable write (`23/ADR-003`, fitness #4
there; fitness #9 here).

**Decision.**

1. **The second wire kind — zero relay change.** `src/mesh-relay-client.mjs` gains
   `LEASE_SIGNAL_KIND = "lease"` and a lease envelope builder (the frozen `{ kind, nodeId, signal }` form,
   `23/ADR-001`; the signal blob is the claim record, opaque to the wire). The one-shot best-effort push
   seam (`pushPresenceSignal`'s connect→push-one-frame→dispose shape) is generalised/reused for the lease
   frame. `src/mesh-relay.mjs` is NOT edited — the payload-agnostic promise is cashed and gated (fitness
   #10: the relay module contains no lease reference).

2. **The receive side — the 23/ADR-004 mirror, verbatim discipline.** The persistent subscriber
   (`src/mesh-presence-subscriber.mjs`) gains an additive apply branch for `kind:"lease"`, applying the
   opaque claim into an in-memory **lease cache** (keyed by `itemRef`, latest-signal-wins — the
   `createPresenceCache` factory shape, living beside it in `src/mesh-presence-cache.mjs`). The cache is
   IN MEMORY ONLY — no durable write, no record-persist import — covered by EXTENDING the existing
   `acd-presence-subscriber-cache-only` gate to the lease additions (fitness #11). A malformed/unknown
   frame stays ignored-never-crash (the `03/ADR-003` consumer discipline already in the subscriber).

3. **The FROZEN claim sequence** (the A2 ordering — composed in the COMMAND layer, `work:run-start`, the
   `20/ADR-005` command-orchestrates precedent, so the structural form is greppable in one file):
   1. **Local durable claim write** (ADR-003 step b) — unconditional, first, atomic. Never inside any
      relay branch.
   2. **Relay intent push — best-effort, second**: `try { pushLeaseSignal(...) } catch { /* liveness lost,
      arbitration falls to the git cadence */ }`. Unconfigured relay ⇒ skipped (the `createRelayClient →
      null` path). A relay failure NEVER propagates and NEVER undoes/blocks the claim (fitness #9 — the
      `23/ADR-003` structural form, re-applied).
   3. **Git sync — the authoritative act** (ADR-003 steps c–d): commit → pull → push; hold or stand down
      is decided HERE and only here.
   4. **Arbitrate from git observation ONLY.** The hold/stand-down resolver consumes git-read claims +
      presence — structurally, the resolver in `mesh-lease.mjs` imports NO cache/subscriber/relay module
      (fitness #8). The lease CACHE feeds only the SKIP/DEFER hints (a peer's `next` skips an
      intent-claimed item, ADR-005; a contender seeing a fresher intent defers before step 1) — advisory
      influence that can only make a node claim LESS, never hold MORE.
   A node that broadcast its intent unopposed ("holds the relay grant") but loses the git race — its push
   rejected, the pull revealing an earlier claim — **stands down** (ADR-003 step e). The relay grant is
   worth nothing without the git win. Conversely, total relay loss removes only the intent broadcast:
   claims proceed at the git cadence, arbitration stays correct (PRD A2; `SPEC §Scope`
   "relay-independent correctness").

4. **KR2 is measured at verification, not asserted in CI wall-clock.** The MECHANISM (two contenders over
   a shared bare remote in-process: exactly one holds, the loser stands down, the sequence's structural
   form) is `@executable` over real git fixtures. The "100 contested claims, 0 double-executions" soak is
   a `@manual` verification deliverable on a real two-node fleet (the `23/ADR-003` verification-note
   discipline — a race soak under real concurrency is a measurement, not a refine-time CI assert).

**Alternatives considered.**
- *Relay-side grant table (the broker adjudicates claims)* — rejected: stateful, authoritative,
  kind-parsing — every property `23/ADR-001` forbids, and a relay outage would then BLOCK claims (the A2
  inversion).
- *Push the relay intent BEFORE the local durable write* — rejected: it puts the fast path ahead of the
  durable record (a crash between the two leaves a broadcast intent with no durable claim — peers defer to
  a ghost), and it breaks the m23 structural idiom fitness #9 greps (write-git-then-push). The window
  gained is microseconds; the discipline lost is the milestone's spine.
- *Let the cache participate in the HOLD decision ("no competing intent heard for N ms ⇒ held")* —
  rejected: it makes correctness depend on relay delivery — the exact A2 violation. The cache may only
  cause skip/defer (fail-safe direction).
- *A new `work:claim` verb (claim and start as two operator steps)* — rejected: it doubles the command
  surface (arming route-coverage + bijection gates, 22/R1) for a step no operator takes independently —
  the skill's loop is next→start; the lease is an implementation detail of a safe start. Folding acquire
  into `work:run-start` keeps ZERO new verbs (the preamble's R1 enumeration) and one greppable sequence.

**Consequences.** Story 02 builds the `mesh-relay-client.mjs` lease kind (an additive edit on the graph's
0-dependency leaf), the subscriber/cache lease extension, and the `work:run-start` composition (acquire →
intent → sync → hold/stand-down → mint-with-node, plus the `runId` tie-back onto the claim and the
`work:run-complete` release) — and arms fitness #9/#10/#11. It depends on stories 00 (the record/sync
substrate) and 01 (the lease mechanics) — the genuine integration story, exactly m23's 00/01→02 shape. The
*observable* behaviour (intent heard ⇒ peer defers within relay latency; relay killed ⇒ claims still
arbitrate correctly at git cadence; the KR2 soak) is story-02 task `.feature` + `@manual` material.

## ADR-005: Mesh-aware `aof work next` — an OPTIONAL, INJECTED lease view; `work.mjs` imports NO mesh module (the unconfigured install is byte-identical); leased-by-a-LIVE-peer ⇒ skipped like not-actionable; leased-by-a-STALE-peer ⇒ ready + `reclaimable` annotation

**Status:** Accepted
**Date:** 2026-07-02

**Context.** `work.mjs:nextWork(workDir, scopeRef)` (line 522) is PURE over the work tree — the property
that keeps the whole `work:*` read surface testable with plain fixtures, and the property `SPEC §Scope`
implicitly protects ("single-node installs keep working UNCHANGED"). The graph shows the claim point is a
narrow two-file seam (`commands/next.mjs` ← `command-core` → `work.mjs`), fully disjoint from the
run-store subtree — so mesh-awareness is an injection AT the seam, not a coupling inside it. The lease
data (ADR-003) is a git read (`.mesh/leases/**` + presence) that `mesh-lease.mjs` owns.

**Decision.** `nextWork(workDir, scopeRef, { leaseView } = {})` — an OPTIONAL third argument, absent by
default, in which case behaviour is byte-identical to today (the `mergePresence(disk, null) === disk`
idiom from `23/ADR-004`, applied to `next`). The `leaseView` is a pure, pre-computed view (built OUTSIDE
`work.mjs`) exposing, per item ref: `unleased | leased-live | leased-stale (+ holder nodeId)`. Inside the
candidate walk: **`leased-live` ⇒ skip** (exactly as a `done` story is skipped — the item is being worked,
just not here); **`leased-stale` ⇒ return it `ready` with `{ reclaimable: true, leasedBy }`** annotations
(the claim path, ADR-006, performs the actual reclaim — `next` is a READ and never writes). The COMMAND
(`commands/next.mjs`) builds the view ONLY when mesh is configured (`ctx.workspace.config.mesh?.nodeId`),
composing `mesh-lease.mjs`'s claim read with the presence staleness read (`23/ADR-002`), and overlaying
the in-memory lease cache for the ≤relay-latency skip (`disk ?? cache`, git wins — the `23/ADR-004`
overlay; the cache can only ADD a skip, never unlease an item). `work.mjs` itself imports no mesh module —
gated (fitness #7).

**Alternatives considered.**
- *`work.mjs` imports `mesh-lease`/`mesh-store` directly* — rejected: it couples the entire `work:*` read
  surface (and its 25-dependency door, `command-core`) to the mesh subtree for every single-node install;
  the injected-view shape keeps the pure core pure and the mesh read testable as data.
- *`next` performs the reclaim of a stale-leased item inline* — rejected: `next` is a READ verb; a read
  that force-fails runs and rolls back statuses violates the read/write command split (`08/ADR-003`) and
  `20/ADR-005`'s ownership. `next` reports `reclaimable`; the claim path reclaims.
- *Skip stale-leased items too (only unleased items are ready)* — rejected: it wedges the fleet exactly
  the way the PRD forbids — a crashed node's item would never be offered to a live peer (`SPEC §Objective`:
  "reclaimed by a peer rather than left stuck").

**Consequences.** Story 01 builds the `nextWork` optional parameter, the `commands/next.mjs` injection +
config gate, the lease-view builder in `mesh-lease.mjs`, and the additive `mesh:status` lease render (who
holds what — riding the EXISTING verb; no gate re-armed, the 22/R1 inverse stays clean). Fitness #7. The
*observable* behaviour (a leased item is skipped; a stale-leased item surfaces reclaimable; unconfigured
mesh renders byte-identically) is story-01 task `.feature` material.

## ADR-006: Fleet orphan reclaim — m20's scan generalised BY ARGUMENT at the existing claim path (`work:run-start`; NO new verb); a foreign run is reclaimable only under DUAL staleness (holder PRESENCE stale AND run heartbeat stale — a fresh-presence peer is hands-off, always); the foreign force-fail is the ONE sanctioned foreign-path write (a documented refinement of `22/ADR-002`); the dead peer's lease lapses by RULE — no foreign lease write; `20/ADR-005` rollback ownership preserved verbatim

**Status:** Accepted
**Date:** 2026-07-02

**Context.** `20/ADR-004` built the scan for exactly this widening: `reclaimStaleRuns(items, { now,
stalenessThreshold })` walks run records by path, takes the scan set AS AN ARGUMENT ("milestone 26's fleet
scan passes a wider item set with NO rewrite"), force-fails only STALE `running` runs via the legal
`running → failed` edge (`failureReason: "runtime_offline"` — retryable — + `reclaimedAt`), and returns
`{ item, run }` entries so the COMMAND layer drives `work.mjs:rollbackItemStatus` (`20/ADR-005`). Its call
site today is `commands/run-start.mjs` lines 49–57 (scan `[item]`, threshold from
`work.autonomous.heartbeatStaleMs`, rollback per entry). Two fleet-specific hazards need settling: (1)
**the live-peer guard** — a peer whose RUN heartbeat is stale may still be a LIVE node (a wedged run on a
healthy host is that node's OWN restart-scan's business, not a peer's); (2) **the foreign write** — the
force-fail writes the dead peer's `runs/<node>/<run-id>.json`, a path `22/ADR-002` assigns to that node.

**Decision.**

1. **Trigger: the existing claim path — no new verb.** `work:run-start`'s reclaim block widens its scan
   set when mesh is configured: `[item]` (today's local scan — UNCHANGED, and the whole of it when mesh is
   unconfigured) PLUS the items whose in-flight run is owned by a **presence-stale peer**. Reclaim happens
   exactly when it matters — when a node is about to claim/start work — and the fleet sweep needs no
   daemon, no server poll (`SPEC §Out of scope`), and no new command surface (the R1-clean enumeration in
   the preamble).

2. **The DUAL-staleness guard, with fixed precedence: presence wins.** A foreign run is passed to the scan
   ONLY when its owner's presence is stale (`isNodeStale`, `23/ADR-002`); `reclaimStaleRuns` then
   force-fails it ONLY if the run's own heartbeat is also stale (`isStale`, `20/ADR-004` — unchanged).
   So: **presence fresh ⇒ hands off, unconditionally** — even if the run heartbeat is stale (the live
   node's own restart scan owns that case); presence stale + run heartbeat fresh ⇒ wait (conservative — the
   run crosses its own threshold shortly if truly dead). Both predicates are the EXISTING ones —
   `run-store.isStale` and `mesh-presence.isNodeStale` (itself `isStale`) — one staleness definition,
   still (the `23 → 20` seam, never a parallel clock).

3. **The presence prefilter is ORCHESTRATION; the store stays fleet-blind.** `reclaimStaleRuns` is NOT
   rewritten — no presence import, no mesh knowledge, signature stable (the promise `20/ADR-004` made is
   kept literally). The command layer builds the fleet item set: list items, read their runs (the ADR-001
   union read — the `node` key attributes each run), exclude runs owned by fresh-presence nodes and by
   THIS node (this node's own runs stay under the local scan's existing rules), pass the remainder. The
   rollback loop is byte-identical: `rollbackItemStatus` over the returned entries — `20/ADR-005`
   ownership untouched (the store never writes frontmatter; the scan never writes status).

4. **The foreign force-fail is the ONE sanctioned foreign-path write — a documented refinement of
   `22/ADR-002`, not a silent breach.** The partition invariant's purpose is add-only merges between LIVE
   writers; reclaim writes a path whose owner is presence-stale (not writing) — refined invariant: *a node
   is the sole writer of its paths WHILE ITS PRESENCE IS LIVE; a peer may write a stale node's RUN record
   only through `reclaimStaleRuns`' legal `running → failed` transition under the dual-staleness guard.*
   The residual resurrection race (the dead node wakes and writes the same record concurrently) is
   accepted, bounded, and honest: the dual guard makes the window practically empty (a node fresh enough
   to write is fresh enough to be hands-off), the resurrected node's record is now TERMINAL
   (`failed`/`reclaimedAt`) so its own restart path stands down through the existing dedup/terminal rules,
   and if the worst case lands the engine surfaces `pull-failed` honestly (`22/ADR-004`) rather than
   corrupting a record. Leases need no such exception: **the dead peer's claim lapses by RULE**
   (ADR-003 — live iff presence fresh), so the reclaimer never touches the foreign claim file; it simply
   acquires its own lease (ADR-003/004) and, on winning, mints the retry lineage
   (`retryOf` → the reclaimed run, `20/ADR-003` — the reclaimed `runtime_offline` failure is retryable by
   design).

**Alternatives considered.**
- *A new `work:reclaim` / `mesh:reclaim` verb or a background reclaim daemon* — rejected: new command
  surface (gates, routes — 22/R1) or the durable-server sweep `SPEC §Out of scope` explicitly excludes,
  for a sweep the claim path already performs at the only moment it matters.
- *Never write the foreign record — tombstone/supersede in the reclaimer's own space* — rejected: the dead
  record would read `running` forever, so EVERY reader (dedup, `completeRun`, `activeRuns`, renders) must
  learn tombstone-overlay logic — the complexity metastasizes; the m20 legal-transition write keeps the
  record the single truth and every reader unchanged.
- *Reclaim on run-heartbeat staleness alone (presence not consulted)* — rejected: it reclaims a LIVE
  peer's wedged-but-owned run out from under it — the double-execution direction KR2 forbids. Presence
  precedence is the guard.
- *Teach `reclaimStaleRuns` the presence filter (a `shouldReclaim` callback)* — rejected: `20/ADR-004`
  promised the widening needs NO rewrite; the filter is set-construction, which is orchestration
  (`20/ADR-005`'s split), and the store stays mesh-free (fitness #4).

**Consequences.** Story 02 builds the fleet set construction + dual-staleness prefilter in
`commands/run-start.mjs` (beside the acquire sequence, ADR-004 — one file, one story), the lease-lapse
consumption (no release write), and arms fitness #12; the existing `acd-run-reclaim-stale-only` and
`acd-status-rollback-bounded` gates re-arm green over the unchanged store/rollback. The *observable*
behaviour (a crashed peer's run is reclaimed + its item offered again; a live peer's stale-heartbeat run
is left alone; the reclaimed lineage retries) is story-02 task `.feature` material.

## Fitness functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI.
     These replace "invariant-as-scenario" — they belong here, never in a task feature.
     RED-until-built is the correct state now: the run-store node dimension, src/mesh-lease.mjs, the
     sync root-set, the lease kind, and the command integrations do not exist yet; the tests reference
     them so they fail cleanly until the owning story lands. "From" names the owning story. -->

| # | Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|---|
| 1 | **One run-path builder.** `runNodeRecordPath` is defined ONCE, in `src/run-store.mjs` (built FROM `runsDir`, the frozen m22 shape byte-identical); `src/mesh-store.mjs` RE-EXPORTS it (no local redefinition); no other module joins `runsDir` + a node segment itself; the persist path routes through the builder (ADR-001). | `test/arch/acd-run-node-path-single-builder.test.mjs` — source-grep: the definition lives in `run-store.mjs`; `mesh-store.mjs` re-exports; no second `path.join(runsDir…, node…)` anywhere in `src/`; shape-equality against the frozen `join(runsDir(item), node, runId + ".json")`. | RED until story 00 | **00** |
| 2 | **The fourteen-key record.** `buildRecord`/`normalizeRecord` carry EXACTLY the fourteen keys — `20/ADR-001`'s thirteen unchanged in name/order + `node` appended, defaulting `null` — so a legacy flat record reads forward (ADR-001). | `test/arch/acd-run-record-node-additive.test.mjs` — import the store, mint/normalize fixtures: key set + order asserted; a thirteen-key record normalizes with `node: null` (absence benign). | RED until story 00 | **00** |
| 3 | **The runs EOL pin matches the REAL nested path (23/R3).** `.gitattributes` rules cover the real sample paths `wiki/work/<item>/runs/<node>/<run-id>.json` AND the flat legacy shape, pinned `eol=lf` (ADR-001). | `test/arch/acd-runs-eol-pinned.test.mjs` — construct the real sample paths and assert the parsed `.gitattributes` rules MATCH them (git-semantics matching, never a literal-pattern grep — the R3 method). Also asserts `.mesh/leases/**` is covered by the existing `**/.mesh/**` rule. | RED until the pin lands | **00** |
| 4 | **Single-node zero mesh coupling (the store half).** `src/run-store.mjs` imports NO mesh module (`mesh-store`/`mesh-presence`/`mesh-lease`/`mesh-relay*`) and reads no config — the node id arrives as data (a record key / mint argument) (ADR-001, ADR-006.3). | `test/arch/acd-run-store-mesh-free.test.mjs` — import-grep of `src/run-store.mjs`: no mesh import, no `config` read; the mint's `node` is parameter-sourced. | GREEN-able at story 00 (guards the future) | **00** |
| 5 | **The sync engine: root-set by argument, content-agnostic always.** `syncMesh`'s staged roots default to `[meshDir]` (every m22/m23 call site unchanged); every stage/diff/commit pathspec iterates the injected set; the engine still never reads/parses record content and never imports a record schema (ADR-002). | `test/arch/acd-sync-root-set.test.mjs` — source-grep `src/mesh-sync.mjs`: the default `[meshDir(workspace)]`, the pathspec iteration, and the runs-pathspec resolver's single home; the EXISTING `acd-mesh-sync-record-neutral` re-arms over the modified engine (enumerated, not duplicated). | RED until story 00 | **00** |
| 6 | **Lease write-scope.** Every lease write joins the `leaseClaimPath`/`meshDir` seam via atomic `writeText` (never a bare `writeFile`); `src/mesh-lease.mjs` references ZERO record-doc filename (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`); the only claim path it writes is built with THIS node's id (own-path writes only) (ADR-003). | `test/arch/acd-lease-write-scope.test.mjs` — source-grep `src/mesh-lease.mjs`: writes join `leaseClaimPath`, route through `writeText`, zero record-doc filenames, no `unlink` of a claim (release is a state write, not a delete). | RED until story 01 | **01** |
| 7 | **Mesh-aware `next` is injected, optional (the work.mjs half).** `src/work.mjs` imports NO mesh module; `nextWork`'s lease view is an OPTIONAL argument defaulting absent (byte-identical without it); `src/commands/next.mjs` builds the view only under the `config.mesh` gate (ADR-005). | `test/arch/acd-next-lease-injected.test.mjs` — import-grep `src/work.mjs` (no mesh import) + signature/default check on `nextWork` + the config gate in `commands/next.mjs`. | RED until story 01 | **01** |
| 8 | **Arbitration is git-observed ONLY.** The hold/stand-down resolver in `src/mesh-lease.mjs` is pure over git-read claims + presence: it imports NO cache/subscriber/relay module — the in-memory lease cache can only cause a SKIP/DEFER (in the command overlay), never a HOLD (ADR-003 step d, ADR-004.3.4). | `test/arch/acd-lease-arbitration-git-observed.test.mjs` — import-grep `src/mesh-lease.mjs`: no `mesh-presence-cache`/`mesh-presence-subscriber`/`mesh-relay-client` import; the resolver's inputs are disk-read claims + presence. | RED until story 01 | **01** |
| 9 | **The claim path is relay-independent (the 23/fitness-#4 mirror).** In `src/commands/run-start.mjs`: the local claim write + the git sync are NOT nested inside a relay-push conditional/success branch; the relay intent push is wrapped `try`/`catch` (a relay failure is swallowed, never gates the claim) (ADR-004.3). | `test/arch/acd-claim-relay-independent.test.mjs` — source-analysis of `commands/run-start.mjs`: the acquire/sync calls sit outside any relay-success branch; the `pushLeaseSignal` call sits inside a `try`/`catch`. | RED until story 02 | **02** |
| 10 | **ZERO relay change — the 23/ADR-001 promise cashed.** `src/mesh-relay.mjs` contains NO lease reference: no lease-kind literal, no lease-module import — the broker stays kind-blind while carrying the second kind (ADR-004.1). | `test/arch/acd-relay-lease-blind.test.mjs` — source-grep `src/mesh-relay.mjs`: no `lease` token, no `mesh-lease` import; `LEASE_SIGNAL_KIND` lives in `mesh-relay-client.mjs` only. | GREEN now — MUST STAY GREEN through story 02 (the gate exists to catch the tempting edit) | **02** |
| 11 | **The lease cache is in-memory only, never a second system of record.** The lease-kind subscriber branch + the lease cache perform no durable write and import no persist seam — the EXISTING `acd-presence-subscriber-cache-only` gate's file/assert coverage EXTENDS over the lease additions (ADR-004.2; `23/ADR-004`). | Extend `test/arch/acd-presence-subscriber-cache-only.test.mjs` (or a sibling `acd-lease-cache-only`) to cover the lease cache + apply branch, with the m03 non-vacuous planted-violation self-check. | GREEN gate exists (m23); RED on the lease additions until story 02 | **02** |
| 12 | **Fleet reclaim is guarded orchestration.** In `commands/run-start.mjs`: the fleet item set is built ONLY inside a mesh-configured branch and filtered through the presence predicate (`isNodeStale`) before `reclaimStaleRuns`; the store's `reclaimStaleRuns` signature/mesh-blindness is unchanged (covered by #4); status rollback still routes through `rollbackItemStatus` (ADR-006; `20/ADR-005`). | `test/arch/acd-fleet-reclaim-guarded.test.mjs` — source-grep `commands/run-start.mjs`: the config gate, the `isNodeStale` prefilter ahead of the scan call, the rollback loop intact; the EXISTING `acd-run-reclaim-stale-only` + `acd-status-rollback-bounded` re-arm (enumerated). | RED until story 02 | **02** |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors 22's/23's split):
     - The path-builder singleton, the fourteen-key freeze, the EOL pin, the mesh-free store/work
       imports, the sync root-set default, the lease write-scope, the injected lease view, the
       git-observed arbitration, the relay-independent claim path, the lease-blind relay, the
       cache-only receive side, and the guarded fleet scan are STRUCTURAL invariants over module
       source, imports, signatures, and repo config → arch-tests (this table).
     - The OBSERVABLE behaviours — two clones race one item and exactly one executes; the loser's
       stand-down result; a claim lapsing with its holder's presence; a leased item skipped by next and
       a stale-leased one surfaced reclaimable; a crashed peer's run reclaimed + retried; intent heard
       over the relay ⇒ a peer defers within relay latency; relay killed ⇒ arbitration still correct at
       the git cadence — exercise real git fixtures, the real fs, and (for the relay half) the injected
       transport. They belong in the stories' task .feature files, NOT here.
     - KR2's "100 contested claims, 0 double-executions" is a VERIFICATION-TIME soak on a real two-node
       fleet (@manual, story 02), the ADR-003/23 measurement discipline — the MECHANISM is @executable,
       the SOAK is measured, never a flaky CI assert. -->

## Story break-down rationale

<!-- Informs the PO's break-down; does NOT itself create stories. The PO partitions milestone 26 into
     exactly three stories. The partition follows the real call/dependency coupling the codebase graph
     reports (aof graph build src → 1174 nodes / 3162 edges, builtAt 2026-07-01; aof graph impact
     consulted at author time — cited as ACTUAL structure, not inferred). -->

The PO will partition milestone 26 into **exactly three stories** (the m23 pattern: two parallel siblings
over one substrate, one integration join):

- **00 · node-dimensioned-run-records (the git substrate — no lease, no relay)** — OWNS
  `src/run-store.mjs` (the fourteen-key record, union readers, record-driven persist, union-probing mint —
  ADR-001), `src/mesh-store.mjs` (the `runNodeRecordPath` re-export flip + the RESERVED `leaseClaimPath`
  pure builder — ADR-001/ADR-003.1), `src/mesh-sync.mjs` (the root-set argument + the runs pathspec —
  ADR-002), and `.gitattributes` (the R3 pin). Arms fitness **#1–#5**. Touches NO command file and NO
  relay/lease logic. **The dependency root** — its frozen contracts: the fourteen-key record + `node` mint
  option, the union read, `leaseClaimPath`, `syncMesh(workspace, { roots })`.
- **01 · lease-of-record + mesh-aware-next (git-only)** — OWNS `src/mesh-lease.mjs` (NEW: claim
  assembly/read, presence-tied liveness, the pure arbitration resolver, `acquireLease`/`releaseLease`/
  `standDown` over an injected `runSync` — ADR-003), `src/work.mjs` (the optional `leaseView` parameter —
  ADR-005), `src/commands/next.mjs` (the config-gated injection), and `src/commands/mesh-identity.mjs`
  (the additive `mesh:status` lease render). Arms fitness **#6–#8**. Imports NO relay module — the whole
  story runs over plain local git fixtures. **Parallel with nothing pending in 02; builds against 00's
  frozen contracts only** (`leaseClaimPath`, the root-set `runSync`, presence reads from m23).
- **02 · claim integration + relay fast-path + fleet reclaim (the A2 join)** — OWNS
  `src/commands/run-start.mjs` (the frozen claim sequence: acquire → best-effort intent → sync →
  hold/stand-down → mint-with-node; the fleet reclaim prefilter — ADR-004.3/ADR-006),
  `src/commands/run-retry.mjs` + `src/commands/run-complete.mjs` (the `node` pass-through; the lease
  release + `runId` tie-back), `src/mesh-relay-client.mjs` (`LEASE_SIGNAL_KIND` + the lease push — the
  envelope's second kind, ADR-004.1), `src/mesh-presence-subscriber.mjs` + `src/mesh-presence-cache.mjs`
  (the lease apply branch + lease cache — ADR-004.2), and the KR2 harness (`@executable` mechanism +
  `@manual` 100-claim soak). Arms fitness **#9–#12**. **Depends on 00 + 01** — the genuine integration
  story.

**Why this boundary is grounded in the graph, not inferred:**

1. **`src/run-store.mjs` is the widest-fan-in module the milestone touches — freeze it first, alone.**
   `aof graph impact src/run-store.mjs` reports **6 dependents** (the four `run-*` commands +
   `mesh-presence.mjs` + `mesh-store.mjs`) and 1 dependency (`fs.mjs`). Every other story's file set sits
   DOWNSTREAM of it (the run commands in 02 call it; `mesh-lease`'s run-tie reads its records; presence's
   `activeRuns` reads it). A change that fans to six consumers cannot be co-edited across stories — story
   00 owns it exclusively and freezes the fourteen-key/union contract the siblings build against. The
   same argument covers `mesh-store.mjs` (← 3: `mesh-identity`, `mesh-presence`, `mesh-sync`) and
   `mesh-sync.mjs` — all substrate spines with multiple dependents, all 00.

2. **The read-side claim point is a narrow seam DISJOINT from the substrate — so 01 is parallel-authorable.**
   `aof graph impact src/commands/next.mjs` reports **1 dependent** (`command-core.mjs`) and **1
   dependency** (`work.mjs`) — the mesh-aware `next` change is confined to a two-file corridor that shares
   NO module with story 00's set (the `leaseView` crosses as an ADR-frozen argument shape, not an import).
   The new `mesh-lease.mjs` couples INTO `mesh-store` (the reserved path builder) and `mesh-presence`
   (`isNodeStale`, `readPresenceRecords` — ← 2 dependents today, both commands) — inherited m22/m23 seams,
   not cross-story edges within m26.

3. **The relay side is an additive edit on a LEAF, and the broker itself is untouched.**
   `aof graph impact src/mesh-relay-client.mjs` reports ← 2 (`commands/mesh-heartbeat.mjs`,
   `mesh-presence-cache.mjs`) and → **0** — a zero-dependency leaf where the second signal kind lands
   without disturbing anything upstream; `mesh-presence-cache.mjs` is itself ← 0. `src/mesh-relay.mjs`
   appears in NO story's diff (fitness #10 pins it) — the m23 payload-agnostic investment is why the
   milestone's relay half is this small, and why it can safely land LAST, in the integration story.

4. **The integration story is the ONLY place the subtrees meet — and `command-core` is untouched.** Story
   02 is the sole owner of the run-command files, which are the one place the run substrate (00), the
   lease mechanics (01), and the relay leaf all compose (the frozen sequence fitness #9 greps in ONE
   file). `aof graph impact src/command-core.mjs` (← 4, → 25) confirms the registry door carries every
   command already involved — and since m26 adds ZERO new verbs, there is no registry/dispatcher co-touch
   at all this milestone: even m23's sanctioned add-only co-touch (`07/ADR-006`) is absent. No file is
   owned by two stories.

**The conscious refinement from milestone 23's partition.** In m23 the two parallel siblings (presence,
relay) were BOTH new surfaces and the integration was thin. Here the weight inverts: the substrate (00) is
an extension of the highest-fan-in existing spine (so it goes first and alone), the novel module (01's
`mesh-lease.mjs`) is deliberately git-pure so it needs neither the relay nor the command layer to be
proven, and the integration (02) is the milestone's centrepiece — the A2 sequence itself — which is
exactly why the ADRs freeze it as a composition of 00's and 01's contracts inside one greppable command
file rather than smearing it across modules.

The coupling is **advisory**: it informs why substrate-first (00) + a git-pure lease sibling (01) + a
single A2 join (02) is the right cut (the fan-in direction of `run-store`, the disjoint `next` corridor,
the relay leaf, the single command-layer join), but the PO draws the final partition. The graph confirms —
it does not dictate.
