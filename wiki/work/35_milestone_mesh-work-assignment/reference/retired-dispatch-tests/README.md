# Retired dispatch tests — behavioral reference for milestone 35

## What this is

These 28 `.mjs` files are **retired tests**, extracted from git history (they were deleted from the
active `test/` tree during milestone 34's "global mesh only" correction). They are **not live tests** —
they are renamed (`*.test.mjs` → `*.mjs`) and parked here so no runner or glob picks them up. They import
modules that **no longer exist** (`mesh-lease.mjs`, `mesh-issuance.mjs`, `mesh-sync.mjs`,
`commands/mesh-issue.mjs`), so they will not run; read them, don't execute them.

They encode the **behaviors of the retired distributed-leasing (milestone 26) and work-issuance/routing
(milestone 27) machinery** — i.e. the last time AOF could route a unit of work to a specific node. That is
exactly the capability milestone 35 rebuilds. They are here so `aof:refine 35` can **mine the intended
behavior** instead of re-deriving the contract from scratch.

## The one caveat that matters — mine the SEMANTICS, not the MECHANISM

Milestones 26/27 delivered this over the **git-bus**: per-node claim/directive files, git-synced across
peers, arbitrated by *observing* the merged git state, with presence as the staleness clock. **Milestone 35
does NOT use any of that.** Its transport is the milestone-34 **WebSocket control stream** (34/ADR-007's
anticipated control→worker channel) and the machine-wide **global SQLite store**.

So when reading these:
- **Transfers (the durable questions 35 must answer):** the assignment record shape + lifecycle states,
  targeting a node, revocation, "exactly one node runs an item" arbitration, staleness/liveness, reclaim of
  a dead node's work, and the withdraw path.
- **Does NOT transfer (git-bus mechanism — ignore):** git-observed arbitration, atomic-`writeText`-to-a-
  synced-file write scoping, add-only CRDT merge, the relay push fast-path, "presence is the git clock."
  35 replaces these with the WS stream + the global store. The 7 pure git-transport tests were **excluded**
  from this reference for that reason (find them in git history under `test/mesh-sync-*`,
  `test/*-add-only-merge`, `test/stream-backstop-reconciliation` if ever needed).

## Index by milestone-35 concern

### Assignment record + verb (the core "issue work to a node")
- `mesh-issue-command.mjs` — `aof mesh issue <ref> --to <node>`: the assignment verb; no `--to` ⇒ target `{kind:any}`.
- `mesh-issuance-directive-record.mjs` — the directive record; multiple issuers' directives read back as a flat **union** (the reader never picks a winner).
- `acd-issuance-record-frozen.mjs` — the frozen **6-key** directive schema: `itemRef, issuer, target, state, issuedAt, aofVersion`.
- `mesh-issue-withdraw.mjs` — withdrawing flips `state → withdrawn` (a state write, **never** a delete).
- `mesh-cross-node-issuance-kr3.mjs` — end-to-end: a directive issued on A is offered + run on target **B**; A's `next` does not offer it.
- `acd-issuance-write-scope.mjs` — issuance writes are atomic + carry no record-doc coupling (mechanism — adapt to the store).

### Targeting (match work to a capable node)
- `mesh-targeting-matcher.mjs` — target matching truth table; `{}` / `null` target ⇒ no match.
- `acd-targeting-matcher-descriptor-pure.mjs` — the matcher reads ONLY `nodeId` / `runtimes` / `skills` off a node descriptor. (NB: milestone 34 dropped `skills` from the node descriptor — revisit the match keys.)

### Revocation (exclude a node/issuer)
- `mesh-routing-revoked-issuer.mjs` — directives from a **revoked** issuer are filtered from routing; admitted issuers route normally.
- `acd-issuance-revoked-issuer-filtered.mjs` — the security invariant: a revoked issuer's directives never route.

### Pickup / routing (a worker acquiring assigned work)
- `mesh-routing-pickup.mjs` — mesh-aware `next` routing; with mesh unconfigured the directive is invisible (byte-identical to today).
- `acd-next-candidacy-injected.mjs` / `acd-next-candidacy-every-return.mjs` — the candidacy view is injected into `nextWork` as **pure data** (`work.mjs` imports no mesh module); every `next` return path is guarded by it.

### Leasing / arbitration (exactly one node runs an item)
- `mesh-lease-claim-arbitration.mjs` — of two racers on one item, **exactly one** holds; the loser's own file flips `released` and it mints nothing.
- `mesh-lease-clock.mjs` — liveness = `state × holder-presence`: `claimed+fresh` reads live, `released` is presence-blind; strict `>` staleness threshold.
- `acd-lease-arbitration-git-observed.mjs` — arbitration reads observed state, never a cache/subscriber (mechanism — 35 observes the store/stream instead).
- `acd-lease-write-scope.mjs` — lease writes atomic, no record-doc coupling (mechanism).
- `acd-next-lease-injected.mjs` — the lease view injected into `next` as pure data.
- `run-start-claim-sequence.mjs` — the claim sequence on `run start` (claim before running).
- `run-complete-lease-release.mjs` — `run complete` (done|failed|cancelled) releases the holder's claim (state write, never delete).
- `work-next-lease-view.mjs` — `work next` surfaces lease state without coupling to mesh.
- `relay-lease-fast-path.mjs` — pushing lease intent over the transport (mechanism — becomes a WS frame).
- `mesh-status-lease-render.mjs` — `mesh status` renders held claims + `live|lapsed`.

### Reclaim (recover a dead node's work)
- `fleet-orphan-reclaim.mjs` — a peer's running run is reclaimed **only under dual staleness** (presence + heartbeat); fresh presence is hands-off; no presence record ⇒ unknown ⇒ hands-off.

### Status / UI surface for dispatch
- `mesh-status-issued-render.mjs` — `mesh status` gains an `ISSUED` section per open directive.
- `mesh-ui-issue-route.mjs` — the UI `POST /api/mesh/issue` write route (issue from the fleet UI). NB: the mesh UI is **read-only** after milestone 34 — 35 must decide where the assign action lives.
- `mesh-issue-route-same-origin.mjs` / `acd-mesh-issue-route-same-origin.mjs` — CSRF / same-origin + `application/json` guard on any UI write route.

## Suggested use at refine

Treat the **Transfers** list above as the behavioral checklist for milestone 35's SPEC/stories: assignment
record + lifecycle, targeting (minus `skills`), revocation, single-runner arbitration, staleness/liveness,
reclaim, withdraw, and the UI decision (the read-only fleet UI needs a deliberate answer for where "assign"
lives). Re-express each on the WS-stream + global-store transport; do **not** reintroduce the git-bus
mechanism the middle-column files describe.
