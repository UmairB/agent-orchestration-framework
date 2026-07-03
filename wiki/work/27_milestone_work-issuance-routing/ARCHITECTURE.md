---
doc: architecture
---
<!--
  Milestone ARCHITECTURE.md — answers ONE question: how did we decide to build it, and why that way?
  Owner: architect. A log of ADRs: numbered, IMMUTABLE, superseded-not-edited.
  Does NOT contain observable behaviour (→ task .feature files) — only the structure behind it.
-->
# 27 · Cross-Machine Issuance & Routing — Architecture Decisions

> Inputs: this milestone's `SPEC.md` (Objective + Scope — the capstone move: **work issued/assigned on
> node A is picked up and run on an eligible node B with no manual file shuffling**, in ≤2 sync intervals,
> for ≥95% of issued items — PRD §7.2 KF6, §8 Phase 3, **KR3**; the four in-scope deliverables: **work
> issuance** (enqueue/target from any node, issue/assign into a board from the control node), **capability/
> node targeting** routed via the m22 node-identity descriptor, **pick-up via the mesh-aware `next`** over
> the m26 leasing path, and **the issue/assign affordance** on the m25 fleet UI) and `STATE.md` (the open
> contract points refined here: the `aof mesh issue <ref> [--to <node|cap>]` contract; capability-targeting
> against the m22 descriptor; the board-level issue/assign affordance on `aof mesh ui`; and how an issued
> run threads the 19–21 durable/resumable run record fleet-wide). Prior art:
> `PRD-decentralized-agent-orchestration.md` (§7.1 the `aof mesh issue` CLI + the `[assign ▸]` affordance;
> §7.2 KF6 issuance & routing, KF9 the control node as issuing hub; §7.3 "git … the single system of
> record for ALL authoritative state"; §7.4 #2 the control node is the issuing hub + a re-nominate-able
> role, A3 trust = group membership via device code; §8 Phase 3 delivers KR3; §5 out-of-segment / §8
> Phase-5+ the untrusted/cross-org issuance-authz fork is explicitly deferred).
>
> **The precedents this milestone APPLIES and never re-litigates: milestones 22 (node identity), 24
> (registry + control node), 25 (fleet UI), and 26 (leasing).** This milestone AUTHORS almost no new
> mechanic — it COMPOSES the four DONE seams: `22/ADR-003` (the FROZEN 7-key capability descriptor
> `{ nodeId, host, os, runtimes[], skills[], aofVersion, publishedAt }`, a derived per-node git-tracked
> record — the targeting matcher reads it AS DATA); `22/ADR-002` (the path-partition invariant + `meshDir`
> + `flatLeaf` path-safety — the directive record rides it, per-issuer partitioned, add-only); `22/fitness
> #3` (`acd-mesh-command-cli-bijection`, registry-derived — `mesh:issue` re-arms it); `24/ADR-001` (the
> SINGLE-WRITER control-node-gated registry + `isControlNode(config)` = `config.mesh.relay.controlNode ===
> config.mesh.nodeId` — the issuance authority predicate); `24/ADR-004` + `verifyCredential`/`isRevoked`
> (the relay auth-gate — the trust boundary issuance rides; v1 trust = group membership); `25/ADR-002`
> (`mesh:status` is the ONE fleet-data command both faces consume — the issued directives render THROUGH
> it); `25/ADR-003` (`aof mesh ui` is its own thin serve-face reaching fleet data ONLY via
> `invoke("mesh:status")`, disjoint `/api/mesh` namespace, single `127.0.0.1` server); `25/ADR-004` (the
> fleet view is READ-ONLY and its write/issue affordance — with its "genuinely new authz surface" — is
> EXPLICITLY deferred TO THIS MILESTONE); `26/ADR-002` (`syncMesh(workspace, { roots })` — the root-SET
> argument, default `[meshDir]`, glob-magic `runsPathspec`); `26/ADR-003` (the lease-of-record: per-
> contender `.mesh/leases/<item>/<node>.json`, add-only, presence-is-the-clock, `readLeaseClaims`/
> `buildLeaseView`/`acquireLease`); `26/ADR-005` (mesh-aware `next` = an OPTIONAL INJECTED view; `work.mjs`
> imports NO mesh module); `26/ADR-007` (the driver ready-returns are lease-BLIND — the accepted fix
> DIRECTION applies the injected view at EVERY ready-return, DEFERRED to "the FIRST m27 item"); `26/ADR-008`
> (cross-node run-record propagation — "the milestone-27 charter"); `26/ADR-009` (the alive-owner ghost-
> claim reconciliation — routed to retro/next). ADRs below cite these as `NN/ADR-00n` / `SPEC §…` /
> `STATE §…` / `PRD §…`.
>
> **The seam (confirmed against the codebase graph, `aof graph build src` → 1261 nodes / 3400 edges,
> builtAt 2026-07-03, egress none; `aof graph impact` consulted at author time — cited as ACTUAL
> structure, not inferred).** The three moves fall on THREE near-disjoint seams, which is why the partition
> below is clean:
> - **The directive substrate is a SIBLING of the lease spine.** `aof graph impact src/mesh-lease.mjs`
>   returns ← 4 (`commands/mesh-identity.mjs`, `commands/next.mjs`, `commands/run-complete.mjs`,
>   `commands/run-start.mjs`) → 3 (`fs.mjs`, `mesh-presence.mjs`, `mesh-store.mjs`) — a git-pure module
>   coupling INTO `mesh-store` (the reserved path builder) + `mesh-presence` (`isNodeStale`) and consumed by
>   the read command (`next`), the render (`mesh:status` in `mesh-identity`), and the run commands. The new
>   directive module (`src/mesh-issuance.mjs`, ADR-001/003) is deliberately the SAME shape: git-pure,
>   coupling into `mesh-store`'s reserved directive-path builder, consumed by `next` + `mesh:status` + the
>   new `mesh:issue` command — it needs neither the relay nor the UI to be proven.
> - **The read-side routing point is the SAME narrow corridor m26 proved.** `aof graph impact
>   src/commands/next.mjs` returns ← 1 (`command-core.mjs`) → 3 (`mesh-lease.mjs`, `mesh-presence.mjs`,
>   `work.mjs`); `aof graph impact src/work.mjs` returns ← **19** dependents (the whole read surface: the
>   board, cli, both notion faces, the run commands, memory, terminal, …) → **2** (`fs.mjs`,
>   `workspace.mjs`). `work.mjs` is the WIDEST-fan-in module the milestone touches, and it is a PURE core —
>   the routing view crosses as a m26/ADR-005-shaped INJECTED argument at `commands/next.mjs`, never an
>   import inside `work.mjs` (fitness carries m26/#7 forward). The ADR-007 fold-in edits `work.mjs`'s
>   ready-returns only (no new import).
> - **The issue command is one additive door + one bijection re-arm.** `aof graph impact
>   src/command-core.mjs` returns ← 5 (`board-ui.mjs`, `cli.mjs`, `graph-mcp-server.mjs`,
>   `memory/graphify-backend.mjs`, `mesh-ui-serve.mjs`) → **28** — the registry door every command already
>   rides. `mesh:issue` is ONE import + ONE COMMANDS entry + ONE `subcommand === "issue"` branch in
>   `meshCommand` (`cli.mjs:468`), re-arming `acd-mesh-command-cli-bijection` (the m22 gate that ALL nine
>   existing `mesh:*` verbs ride) — the exact 22/24 additive-verb move.
> - **The fleet-UI write route is the m25 face, one guard flipped.** `aof graph impact
>   src/mesh-ui-serve.mjs` returns ← 1 (`cli.mjs`) → 2 (`command-core.mjs`, `work.mjs` — the latter is only
>   the `displayPath` face adapter `25/ADR-003` allows). The new `POST /api/mesh/issue` route is added to
>   THIS face (no second server, no second module), reaching the mutation ONLY via `invoke("mesh:issue")` —
>   so `acd-mesh-ui-no-core-import` / `acd-mesh-ui-single-server` stay green, and the ONE guard that FLIPS
>   is `acd-mesh-ui-write-isolation` (ADR-006).
>
> **Prior-lesson recall** (`work memory recall "cross-node work issuance routing capability targeting
> directive record mesh-aware next" --area architecture --block`) surfaced five ADRs; each is acknowledged
> as honoured or a conscious departure:
> - **26/ADR-005 — mesh-aware `next` is an OPTIONAL, INJECTED lease view; `work.mjs` imports NO mesh
>   module; the unconfigured install is byte-identical.** **HONOURED — load-bearing:** the routing view
>   (ADR-004) is injected by the SAME m26/ADR-005 mechanism, and this milestone UNIFIES it with the lease
>   view into ONE candidacy view (routing filters, lease arbitrates) so `nextWork` still takes exactly one
>   optional argument and `work.mjs` still imports no mesh module (fitness #4, extending m26/#7 verbatim).
> - **26/ADR-007 — the two DRIVER ready-returns (uat @ `work.mjs:568`, zero-story @ `:574`) are lease-
>   BLIND; the accepted fix applies the injected view at EVERY ready-return, deferred to "the FIRST m27
>   item".** **HONOURED — folded in HERE (ADR-004):** m27's routing-view change touches exactly these
>   returns; the candidacy lookup is applied at every ready-return (a completion of m26/ADR-007's supersede
>   of m26/ADR-005), armed by fitness #5.
> - **22/ADR-003 — the FROZEN 7-key capability descriptor, a derived per-node git-tracked record.**
>   **HONOURED:** the targeting matcher (ADR-003) reads `runtimes[]`/`skills[]`/`nodeId` off the descriptor
>   AS DATA — a pure predicate, importing no node-identity mechanic (it does not re-derive an id or re-
>   assemble a descriptor); the descriptor's freeze is untouched (no new key; fitness #3 asserts the matcher
>   reads only the frozen fields).
> - **26/ADR-002 — `syncMesh`'s staged root is a root-SET argument.** **HONOURED — the propagation lever
>   (ADR-005):** the directive record lives under `.mesh/`, so it rides the DEFAULT `[meshDir]` root set with
>   ZERO sync change — unlike the m26 runs tree, which needed the runs pathspec. `mesh:issue` pushes one
>   sync (default roots) so the directive reaches peers promptly (KR3's ≤2-sync-intervals — ADR-005).
> - **24/ADR-004 — revocation + `verifyCredential`/`isRevoked`; the relay auth-gate is the trust boundary.**
>   **HONOURED — cited for the boundary:** v1 issuance authz IS group membership (`24/ADR-001`'s
>   `isControlNode` for the write authority + the `24/ADR-004` credential boundary the git remote already
>   enforces). No new trust primitive is minted; the untrusted-issuance authz surface stays Phase-5+ out of
>   scope (ADR-002 / ADR-006 security lens; the SECURITY.md carries the threat model).
>
> **Scope-precision carry-forwards (22/R1 — enumerate EVERY registry-derived fitness gate a change trips,
> AND the inverse).** This milestone adds EXACTLY ONE registered command verb: `mesh:issue` (ADR-002). It
> takes the `mesh:` prefix, so it is EXCLUDED from the `work:`-filtered bijection and RE-ARMS
> `acd-mesh-command-cli-bijection` (`22/fitness #3`, now covering identity+status+sync+heartbeat+relay+
> invite+join+revoke+**issue**) — proof (a) its `cli` adapter, (b) a `subcommand === "issue"` branch in
> `meshCommand`, (c) `aof mesh issue <ref> --json` runs clean + parseable. `acd-work-command-cli-bijection`
> / `acd-work-command-route-coverage` are `work:`-filtered and see NO new `work:*` command (the routing
> filter rides the EXISTING `work:next`), so they stay green untouched. `aof mesh issue` is a REGISTERED
> command (unlike the serve verbs `aof work ui` / `aof mesh ui`), so it DOES enter the mesh bijection. The
> fleet-UI write route (`POST /api/mesh/issue`) is a face on the EXISTING serve verb, NOT a new `mesh:*`
> command — it enters no bijection; its structural guarantees are the m25 `acd-mesh-ui-*` gates, one of
> which FLIPS (`acd-mesh-ui-write-isolation`, ADR-006). No bundle skill member is added → `acd-command-
> namespace` is NOT armed. **22/R3 (the git-as-bus EOL pin):** the directive record lives under `.mesh/`,
> which `.gitattributes` ALREADY pins `**/.mesh/** text eol=lf` (checked at author time — line 21) — so
> UNLIKE the m26 runs tree, NO new pin is owed (the fitness #2 EOL row asserts the existing rule covers the
> real nested directive sample path, it authors no new rule). **22/R4:** the aof self-host repo's
> `.gitignore wiki/work/.mesh/` already covers the directive records; a single-node (mesh-unconfigured)
> install issues nothing (the config gate), so no new self-host ignore is owed.

## ADR-001: The routing/issuance directive — a new `.mesh/` record class, per-ISSUER partitioned (`.mesh/issuance/<issuer-node>/<item-ref>.json`, add-only merges, the 22/ADR-002 partition invariant held STRICTLY), a FROZEN six-key schema, an `issued → withdrawn | fulfilled` lifecycle; issuance authority is v1 group membership + the control-node write-gate for the control-issue path; it rides the DEFAULT `[meshDir]` sync with ZERO engine change

**Status:** Accepted
**Date:** 2026-07-03

**Context.** Routing needs a coordination artifact that says "item `<ref>` is issued into a board, targeted
at `<node | capability | any>`," reachable by every eligible node. Four facts bind its shape. (1) It MUST
be **fleet-reachable**, and the only records that sync fleet-wide are `.mesh/**` (the m22/23/24/26
partition tree — `26/ADR-008` proved work-stream records do NOT propagate). So the directive is a `.mesh/`
record class, like leases and the registry. (2) The PRD reconciles two phrasings — "issue **from the
control node**" (§7.2 KF9, §7.4 #2) and "enqueue **from any node**" (§7.2 KF6). These are two ISSUANCE
PATHS, not a contradiction: enqueue-from-any-node is the trusted-squad default (any group member may issue
into the shared stream — v1 trust = group membership, `24/ADR-001`/A3); control-node issuance is the
"issuing hub" framing the fleet UI surfaces (`25/ADR-004`, the `[assign ▸]` affordance issues *from here*).
(3) The `26/ADR-003` lesson is load-bearing: a contested SAME-PATH `.mesh/` file wedges the sync bus on a
content conflict (the engine has no conflict handling), so the directive path MUST be partition-clean —
one writer per path. (4) The registry is a SINGLE-WRITER aggregate (`24/ADR-001`) — legitimate ONLY
because exactly one control node mutates it; a directive that ANY node may issue cannot be a single-writer
aggregate without forcing the control node to be a relay for every enqueue (an availability SPOF the PRD
forbids — lose the control node, lose new issuance only, never durable state).

**Decision.** The directive is a **per-ISSUER partitioned `.mesh/` record**, NOT a control-node aggregate.

1. **The path — `issuanceDirectivePath(workspace, issuerNodeId, itemRef)` = `join(meshDir(workspace),
   "issuance", flatLeaf(issuerNodeId), flatLeaf(itemRef) + ".json")`** — a pure builder RESERVED in
   `src/mesh-store.mjs` beside `leaseClaimPath`/`presenceRecordPath` (the `22/ADR-002` reservation idiom;
   story 00 reserves it writing nothing, story 01 writes it), routed through the SAME `flatLeaf` path-
   safety boundary. Partitioning by ISSUER (not by item) keeps every merge add-only even when two nodes
   issue two different items, or re-issue: each issuer owns its own subtree, so two nodes never write one
   path — the `22/ADR-002` invariant holds STRICTLY, and it composes with KF6 "enqueue from any node"
   (every group member may issue, into its OWN partition). (An item issued by two nodes yields two
   directive files; the reader unions them, exactly as it unions two lease claims — `26/ADR-003.4`, the
   reader never resolves a "winner," the lease arbitrates the actual claim.)

2. **The FROZEN six-key schema** (top-level keys, in order; persisted opaque via atomic `writeText`, the
   mesh-store record discipline):

   ```jsonc
   // wiki/work/<work-root>/.mesh/issuance/<issuer-node>/<item-ref>.json — one file PER ISSUER-of-an-item.
   {
     "itemRef":   string,                         // the issued item (the ref work:next/run-start resolve)
     "issuer":    string,                         // the node id that issued it (the partition owner)
     "target":    { "kind": "any" }               // the routing target — a discriminated union (ADR-003):
                | { "kind": "node", "nodeId": string }
                | { "kind": "capability", "value": string },
     "state":     "issued" | "withdrawn" | "fulfilled",  // the lifecycle
     "issuedAt":  string,                         // ISO-8601 UTC-Z; provenance/diagnostics — never a clock key
     "aofVersion": string                         // provenance (mirrors node/presence/lease records)
   }
   ```
   No expiry key — a directive does not lapse on a clock (unlike a lease, which is presence-tied); it is
   `withdrawn` or `fulfilled` explicitly. `target` is a discriminated union so the matcher (ADR-003)
   pattern-matches on `kind` — never a bare string that conflates a node id with a capability value.

3. **The lifecycle — `issued → withdrawn | fulfilled`, own-path state writes only** (the `26/ADR-003.2`
   release idiom, never a delete): the issuer withdraws its own directive (an own-path flip to
   `"withdrawn"`); `"fulfilled"` is set when the issued item's lease is released at run completion (a
   bounded hook — see ADR-005's consequences; a v1 directive that is never explicitly fulfilled simply
   stays `issued`, and a reader treating a directive for an already-`done` item as spent is a benign
   render nicety, not a correctness dependency). A directive is a HINT to `next`, never an authority over
   the lease — so a stale `issued` directive can at worst cause a node to OFFER an item that is already
   done (the walk then finds no actionable story), never a double-execution.

4. **Issuance authority is v1 group membership; the control-issue path is control-node-gated.** Writing a
   directive requires being a group member — enforced by the SAME boundary that governs every `.mesh/`
   write: git remote access is provisioned at enrolment (`24/ADR-001`/A3), and the relay auth-gate
   (`24/ADR-004`) rejects a revoked node. The **`mesh:issue` command** (ADR-002) is the enqueue-from-any-
   node path (any member issues into its own partition). The **fleet-UI issue route** (ADR-006) is framed
   as the control-node "issuing hub" (PRD §7.2 KF9): it is offered/gated behind `isControlNode(config)`
   (`24/ADR-001`) so the UI's `[assign ▸]` affordance means "issue from the control node," matching the
   PRD's mental model — but the underlying `mesh:issue` command itself is member-authorized, so the CLI
   enqueue works from any node. **Untrusted / cross-org issuance authz is Phase-5+ out of scope** (PRD §8;
   the SECURITY.md carries the v1 threat model, referenced by ADR-006).

5. **It rides the DEFAULT `[meshDir]` sync with ZERO engine change.** The directive lives under `.mesh/`,
   so `syncMesh(workspace)` (default root set `[meshDir]`, `26/ADR-002`) already stages/commits/pushes it
   and the branch-wide pull brings peers' directives — NO runs pathspec, no engine edit. The `**/.mesh/**`
   EOL pin already covers it (`22/R3`, checked at author time — no new `.gitattributes` rule owed).

**Alternatives considered.**
- *A control-node SINGLE-WRITER issuance aggregate (à la the registry, `24/ADR-001`).* Rejected: it makes
  the control node a relay for EVERY enqueue (KF6 "from any node" would have to round-trip the control
  node), an availability SPOF the PRD forbids (lose the control node ⇒ lose ALL new issuance, not just the
  control-issue path). Per-issuer partitioning lets any member issue into its own subtree while the fleet-
  UI path is *framed* as control-node issuance by the `isControlNode` gate on that face — the PRD's two
  phrasings both honoured without a bus SPOF.
- *One directive file per ITEM (`.mesh/issuance/<item-ref>.json`), first-writer-wins.* Rejected on the
  `26/ADR-003` engine semantics: two nodes issuing the same item write ONE contested path ⇒ a content
  conflict wedges the sync bus. Per-issuer partitioning makes every merge add-only.
- *Fold the target onto the LEASE record (extend the m26 claim schema).* Rejected: a lease is a CLAIM (a
  node saying "I am working this"), a directive is an OFFER (a node saying "this should be worked, here").
  Different writers, different lifecycles, different partition keys (lease = per-contender, directive =
  per-issuer). Conflating them would re-open the `26/ADR-003.1` frozen six-key lease schema and couple
  routing to arbitration — the two must stay separable (routing FILTERS candidates; the lease ARBITRATES
  the claim, ADR-004).
- *A new top-level `wiki/work/**/issuance/` tree beside `runs/`.* Rejected: it would NOT sync (the
  `26/ADR-008` lesson — only `.mesh/**` propagates without a new pathspec), and it would need a new EOL
  pin. `.mesh/` is where fleet-reachable coordination records live.

**Consequences.** Story 00 RESERVES `issuanceDirectivePath` (pure builder, writes nothing) and builds the
git-pure `src/mesh-issuance.mjs` reads (`readIssuanceDirectives` — the `readLeaseClaims` walk one level
deeper, absence-tolerant, torn-file-skipping) + the pure directive assembly. Story 01 builds the directive
WRITES (`issueDirective` / `withdrawDirective` — own-path state writes) behind `mesh:issue`. Arms fitness
#1 (write-scope) + #2 (schema/EOL). The *observable* behaviour (a directive issued on node A appears on
node B after a sync; two issuers of one item yield two directives; a withdrawn directive stops offering
the item) is story-00/01 task `.feature` material against real git fixtures.

## ADR-002: The `mesh:issue` command — `aof mesh issue <ref> [--to <node|cap>]`, a registered `mesh:*` command re-arming the m22 bijection; it writes ONE own-partition directive, resolves the ref EXACTLY (write-isolation), targets `any` when `--to` is absent, and pushes ONE default-root sync so the directive reaches peers within one interval (KR3)

**Status:** Accepted
**Date:** 2026-07-03

**Context.** `STATE §Notes` opens the `aof mesh issue <ref> [--to <node|cap>]` contract. The command
surface must match the eight existing `mesh:*` verbs' registration shape (one import + one COMMANDS entry
in `command-core.mjs` + one `subcommand === "issue"` branch in `meshCommand` — `acd-mesh-command-cli-
bijection`, the gate all nine ride). Two write-discipline precedents bind it: `work:run-start` resolves the
target with `resolveItemExact` — NO slug fallback, so a typo'd ref returns ref-not-found rather than
issuing the wrong item (`08/ADR-003` write-isolation); and KR3 wants the directive to reach eligible peers
in ≤2 sync intervals, which means the issue path should PUSH once (the `mesh:heartbeat`/`run-start` push-
for-liveness posture), not wait for a background tick.

**Decision.** A new registered command `mesh:issue`, hosted in `src/commands/mesh-issue.mjs`:

1. **Registration — the additive m22/m24 move.** One import + one COMMANDS entry in `command-core.mjs`; one
   `if (subcommand === "issue") { await meshVerbCli("mesh:issue", rest, { positionalAllowed: true }); }`
   branch in `meshCommand` (`cli.mjs`, above the unknown-sub fallthrough — the exact form the bijection
   grep requires). It carries the frozen `{ id, input, run, cli }` contract (`08/ADR-002`): `cli.argv`
   maps `positionals[0] → ref` and `options.to → target`; `cli.render` confirms the issued directive;
   `cli.json` passes the directive record through. Re-arms `acd-mesh-command-cli-bijection` (fitness #6).

2. **The write — ONE own-partition directive, ref resolved EXACTLY.** `run` resolves `input.ref` with
   `resolveItemExact` (ref-not-found on a miss — write-isolation, `08/ADR-003`), parses `--to` into the
   `target` union (ADR-003's parser: `--to <nodeId>` matching a known node ⇒ `{ kind:"node" }`; `--to
   <cap>` ⇒ `{ kind:"capability" }`; absent ⇒ `{ kind:"any" }`), assembles the directive (ADR-001's frozen
   schema, `issuer = config.mesh.nodeId`, `state:"issued"`), and writes it via `mesh-issuance.mjs`'s own-
   path `issueDirective` (atomic `writeText` at `issuanceDirectivePath(ws, ownNodeId, ref)`). The command
   ORCHESTRATES; the seam WRITES (`20/ADR-005`) — `mesh-issue.mjs` calls into `mesh-issuance.mjs`, it does
   not join a path itself.

3. **`--to <node | cap>` disambiguation is DATA-DRIVEN, not a flag split** (ADR-003): a single `--to`
   token is resolved against the fleet — if it matches a node id in the synced roster (`readNodeRecords`)
   it is a node target; otherwise it is a capability target (a runtime/skill string). This keeps the CLI a
   single `--to` (the PRD's `[--to <node|cap>]`, one flag) while the matcher (ADR-003) treats node and
   capability as distinct union arms.

4. **It pushes ONE default-root sync (KR3).** After the durable write, `mesh:issue` runs `syncMesh(ws)`
   (default `[meshDir]` roots — the directive is under `.mesh/`, no runs pathspec) so the directive is
   committed + pushed immediately; peers pull it on their next tick or `next`. Like every push-for-
   liveness path, the sync failure is HONEST (the `push-failed` envelope surfaces as a coded CLI error) —
   but the directive is already durable locally, so a failed push degrades to the git cadence (the next
   successful sync carries it), never a lost directive. **v1 does NOT push an issue over the relay** (no
   third relay `kind`): unlike a lease intent (which must beat the git cadence to collapse the KR2 race
   window), a directive is a routing HINT with no race — the ≤2-sync-interval KR3 budget is met by the
   git push alone. (A relay `issue` kind is a deferred accelerator, ADR-005 consequences, not a v1
   requirement — keeping `src/mesh-relay.mjs` untouched, the `23/ADR-001` promise still cashed.)

**Alternatives considered.**
- *A `work:issue` verb (issuance is a work operation).* Rejected: issuance is a MESH operation (it writes a
  `.mesh/` record, targets a fleet node/capability, and is gated by group membership) — it belongs in the
  `mesh:` namespace beside `mesh:status`/`mesh:sync`, riding the mesh bijection, not the `work:` route-
  coverage bijection (which is board-envelope-scoped). The skill loop is `next → run-start`; issuance is a
  fleet-coordination step above it.
- *Two flags `--to-node` / `--to-cap`.* Rejected: the PRD's contract is `[--to <node|cap>]` — ONE flag.
  Data-driven disambiguation (resolve against the roster) keeps the surface the PRD specifies while the
  matcher stays precise (ADR-003).
- *Push the issue over the relay as a third `kind`.* Rejected for v1: it edits `src/mesh-relay-client.mjs`
  and the subscriber for a HINT that has no race to win (unlike the lease intent). The git push meets KR3;
  the relay accelerator is a bounded follow-up, keeping the relay change surface at zero this milestone.

**Consequences.** Story 01 builds `src/commands/mesh-issue.mjs` (the resolve → assemble → write → push
composition), the `command-core.mjs` registration, the `cli.mjs` dispatch branch, and the `mesh-
issuance.mjs` write functions; re-arms fitness #6 (bijection) + fitness #1 (the write joins the reserved
seam). The *observable* behaviour (`aof mesh issue 27/00 --to build-server` writes a node-targeted
directive and it appears on `build-server` after a sync; a typo'd ref is ref-not-found; `--json` emits the
directive) is story-01 task `.feature` material.

## ADR-003: The eligibility / targeting matcher — a PURE predicate `nodeSatisfiesTarget(descriptor, target)` living in `src/mesh-issuance.mjs`, reading the m22-FROZEN descriptor AS DATA: `any` ⇒ true; `node` ⇒ `descriptor.nodeId` match; `capability` ⇒ the value is in `runtimes[]` OR `skills[]`; it imports no node-identity mechanic and re-derives nothing

**Status:** Accepted
**Date:** 2026-07-03

**Context.** Targeting routes a directive to a node by capability or node id, against the `22/ADR-003`
descriptor `{ nodeId, host, os, runtimes[], skills[], aofVersion, publishedAt }` — a derived per-node
git-tracked record `mesh:status`/`readNodeRecords` already reads fleet-wide. `SPEC §Scope` fixes the
targeting semantics: "target a run at a specific node or a capability (runtime / skill)." The matcher must
be a PURE predicate (testable as data, no fs, no clock) so both `next`'s routing filter (ADR-004) and any
render consume the SAME rule — never two divergent match implementations. It must read the descriptor as
DATA (the `26/ADR-005` "plain data crosses the seam" discipline), importing no node-identity mechanic
(`deriveNodeId`/`assembleDescriptor` MINT/PERSIST — a matcher that touched them would couple a pure read to
a write path).

**Decision.** `nodeSatisfiesTarget(descriptor, target)` — a PURE predicate in `src/mesh-issuance.mjs`
(beside the directive reads — one home for the routing vocabulary):

1. **`{ kind: "any" }` ⇒ true** — an untargeted directive is claimable by any node (the fleet-wide offer).
2. **`{ kind: "node", nodeId }` ⇒ `descriptor.nodeId === nodeId`** — an exact node-id match against the
   frozen descriptor's first key.
3. **`{ kind: "capability", value }` ⇒ `runtimes.includes(value) || skills.includes(value)`** — a runtime
   OR a skill match against the frozen `runtimes[]`/`skills[]` arrays (per `SPEC §Objective` "supported
   runtime / skill"). Absent/non-array fields read as `[]` (the descriptor's honest-minimal-install
   discipline, `22/ADR-003`) so a capability match against a bare install is `false`, never a crash.
4. **It reads ONLY the frozen descriptor fields, AS DATA** — no `import` of `node-identity.mjs`, no
   descriptor re-assembly, no id re-derivation. An unknown/malformed `target.kind` ⇒ `false` (fail-safe:
   an unroutable directive offers to nobody, never to everybody). The predicate is total and pure.

**Alternatives considered.**
- *A single `--to` string matched by "is it a known node id, else a capability" INSIDE the matcher.*
  Rejected: that disambiguation is an ISSUE-TIME decision (it needs the roster, ADR-002.3), not a MATCH-
  TIME one — the matcher receives an already-typed `target` union so it stays pure (no roster read) and
  total. Node-vs-capability is resolved once, at issue, and frozen into the directive's `target.kind`.
- *Match capability case-insensitively / by prefix.* Rejected for v1: runtimes (`claude`/`codex`) and skill
  ids are exact tokens the descriptor advertises verbatim (`installedSkills()` = the bundle resource ids);
  an exact-membership match is unambiguous and matches how `mesh:status` renders capabilities. Fuzzy
  matching is a later affordance, not a v1 contract.
- *Put the matcher in `node-identity.mjs` (beside the descriptor).* Rejected: `node-identity.mjs` OWNS
  derivation/assembly (it writes config on first publish); the matcher is a pure READ over the descriptor
  and belongs with the routing vocabulary in `mesh-issuance.mjs`, importing nothing that writes.

**Consequences.** Story 00 builds `nodeSatisfiesTarget` in `src/mesh-issuance.mjs` (pure, git-substrate
story — no command, no UI); arms fitness #3 (the matcher reads only frozen descriptor fields + imports no
node-identity mechanic). The *observable* behaviour (a `codex`-capability directive matches a node whose
`runtimes` carries `codex` and skips one that does not; a node-targeted directive matches only that
`nodeId`; an `any` directive matches every node) is story-00 task `.feature` material (pure-data fixtures).

## ADR-004: Mesh-aware `next` — the routing filter UNIFIED with the lease view into ONE injected candidacy view; `work.mjs` stays mesh-free (the m26/ADR-005 injection extended, not forked); a directive TARGETED-ELSEWHERE is skipped, TARGETED-HERE / UNTARGETED is offered (then the m26 lease arbitrates the claim); the m26/ADR-007 fold-in applies the candidacy lookup at EVERY ready-return

**Status:** Accepted
**Date:** 2026-07-03

**Context.** Routing pick-up happens through the EXISTING `work:next` (`SPEC §Scope`; the skill loop is
`next → run-start`). `26/ADR-005` made `nextWork(workDir, scopeRef, { leaseView })` mesh-aware via an
OPTIONAL INJECTED view; `work.mjs` imports no mesh module; `commands/next.mjs` builds the view under the
`config.mesh.nodeId` gate. The routing view is the SAME shape of read (git-read directives + this node's
descriptor). Two design questions: (1) a SECOND injected view, or ONE unified candidacy view? (2) the
`26/ADR-007` fold-in — the two DRIVER ready-returns (uat @ `work.mjs:568`, zero-story @ `:574`) are lease-
BLIND, and m26 routed the fix to "the FIRST m27 item," which this IS.

**Decision.**

1. **UNIFY routing + lease into ONE injected candidacy view** — NOT a second parameter. `nextWork` keeps
   its single optional argument; `commands/next.mjs` composes the lease view (`26/ADR-005`,
   `buildLeaseView`) AND the routing filter (this ADR) into one `candidacyView` keyed by item ref, whose
   entries carry BOTH the lease state (`leased-live | leased-stale`, unchanged) AND a routing verdict
   (`targeted-elsewhere | offer`). `work.mjs` still imports no mesh module (fitness #4, extending m26/#7):
   the unified view is plain data built OUTSIDE it. One view keeps `nextWork`'s signature stable and avoids
   two lookups fighting over one item (the routing filter runs FIRST — skip a targeted-elsewhere item
   before even consulting its lease; an offered item then obeys the lease rule).

2. **The routing verdict per candidate.** For this node's descriptor (read once in the command, as data):
   - a directive `TARGETED-ELSEWHERE` (a `node`/`capability` target this node does NOT satisfy,
     `nodeSatisfiesTarget` false) ⇒ the item is SKIPPED (offered to nobody here — it is another node's
     work), exactly as a `leased-live` item is skipped;
   - `TARGETED-HERE` (this node satisfies the target) or `UNTARGETED` (`any`, or no directive at all) ⇒
     the item is OFFERED in its normal walk position — and then the **m26 lease arbitrates the actual
     claim** (`work:run-start`/`acquireLease`): routing decides *candidacy*, the lease decides *who runs*.
     Two eligible nodes both offered a targeted-here item still contend the lease safely (KR2 holds — the
     loser stands down); routing never grants, it only narrows.
   - A directive is a HINT: it can only make `next` offer an item to FEWER nodes (skip), never MORE — so
     no routing verdict can manufacture a double-offer that the lease would then double-grant (the m26/
     ADR-007 fail-safe direction, preserved).

3. **The m26/ADR-007 fold-in — the candidacy lookup at EVERY ready-return** (completing m26/ADR-007's
   supersede of m26/ADR-005 "inside the story loop"): the `candidacyView` lookup is applied at EACH of
   `nextWork`'s ready-returns — the `uat` driver return (`work.mjs:568`), the zero-story needs-break-down
   driver return (`work.mjs:574`), AND the existing story-loop returns (`:581/590/592`). So a directive/
   lease on a `uat` ref or a zero-story milestone ref is seen by a peer's `next` (skip if targeted-
   elsewhere or live-leased; offer + `reclaimable` if stale-leased). The milestone-accept fallthrough
   (`work.mjs:598`, all stories done) stays candidacy-blind (a genuinely-done milestone is not a claimable
   work ref — the m26/ADR-007 carve-out).

4. **`work.mjs` imports no mesh module — extended verbatim.** The routing filter, like the lease view, is
   built in `commands/next.mjs` under the `config.mesh.nodeId` gate: read the directives
   (`readIssuanceDirectives`), read THIS node's descriptor (`readNodeRecord(ws, ownNodeId)` — as data),
   apply `nodeSatisfiesTarget` per directive, fold the verdict into the candidacy view. The unconfigured
   floor is the exact two-argument `nextWork` call of today (byte-identical). Fitness #4 (the m26/#7
   invariant, restated over the unified view) + fitness #5 (the every-ready-return fold-in).

**Alternatives considered.**
- *A SECOND injected view (`routingView`) beside `leaseView`.* Rejected: two optional arguments on
  `nextWork` widen the pure core's signature and force `work.mjs` to interleave two lookups per candidate
  (which wins if a targeted-here item is also live-leased?). One unified candidacy view resolves the
  precedence ONCE, in the command (routing narrows, then lease arbitrates), and keeps `nextWork` a single-
  optional-argument function — the minimal edit to the widest-fan-in module.
- *`next` skips a targeted-here item that is currently lease-held-elsewhere but does NOT reclaim.* Already
  the m26 rule — routing changes nothing here: `next` is a READ, the lease view already skips
  `leased-live` and surfaces `leased-stale` reclaimable; routing only adds the targeted-elsewhere skip
  ahead of it.
- *Routing decides the claim (skip the lease for a targeted-here item — "it's mine, just run it").*
  Rejected outright: it re-opens KR2 (two nodes both satisfying a `capability` target would both run) —
  routing MUST narrow candidacy and hand the actual mutual-exclusion to the m26 lease. Candidacy is not a
  grant.

**Consequences.** Story 01 builds the unified candidacy view in `commands/next.mjs` (routing filter folded
into the existing lease-view build under the same config gate), the `work.mjs` ready-return fold-in
(`26/ADR-007`), and the additive `mesh:status` issued-directive render (who issued what, targeted at whom —
riding the EXISTING verb, no gate re-armed). Arms fitness #4 (mesh-free `work.mjs` + injected view) +
fitness #5 (every-ready-return candidacy). The *observable* behaviour (a node-targeted item is offered only
on that node; a wrong-capability peer skips it; an `any` item is offered fleet-wide and the lease
arbitrates; a live-peer-leased `uat` ref is now skipped where before it was double-offered) is story-01
task `.feature` material against real git fixtures.

## ADR-005: Cross-node propagation (KR3 / the m26/ADR-008 inheritance) — the DIRECTIVE propagates via the default `[meshDir]` sync (the `mesh:issue` push + the peer's next tick / `next`), meeting the ≤2-sync-interval budget with ZERO new mover; the run-RECORD durability mover (26/ADR-008's forward fix) is scoped as a BOUNDED follow-up, NOT wired here, because KR3 is met without it

**Status:** Accepted
**Date:** 2026-07-03

**Context.** `26/ADR-008` routed cross-node run-record propagation to "the milestone-27 charter": no
launched mover propagates run records cross-node today (`startSyncLoop` defined-never-launched, `mesh:sync`
syncs only `[meshDir]`, `run-start` syncs the CLAIM pre-mint not the minted record). KR3's "≤2 sync
intervals" needs the ISSUANCE DIRECTIVE to reach eligible nodes. The question is what m27 must WIRE for KR3
vs. what stays a bounded follow-up. The distinction is sharp: KR3 measures **the directive being picked up**
("work issued on A is picked up and run on eligible B") — it needs the DIRECTIVE to propagate, and (for the
mesh-aware `next` to offer it) THIS node's descriptor + the target. It does NOT strictly need the ISSUER's
run RECORD to reach B before B runs — B mints its OWN run under its OWN partition when it claims (`26/
ADR-001`); the issuer's run record propagation is the `26/ADR-008` FIDELITY concern (cross-node reclaim
lineage), not the KR3 pick-up path.

**Decision.**

1. **The directive propagates with ZERO new mover — it is a `.mesh/` record.** `mesh:issue` pushes one
   `syncMesh(ws)` (ADR-002.4, default roots), so the directive is on the remote within the issue call; an
   eligible peer pulls it on its next background tick OR its next `work:next` (which, for a mesh-configured
   install, can be preceded by the existing sync — the directive is visible after ≤1 pull). Two sync
   intervals (issuer push + peer pull) is the KR3 budget, met by the default-root git path — the same
   push-for-liveness/poll-for-durability shape the whole mesh rides (A5). No `startSyncLoop` launch, no new
   pathspec, no daemon is required for KR3.

2. **The run-RECORD durability mover (26/ADR-008's forward fix) is a BOUNDED follow-up, NOT wired here.**
   `26/ADR-008` identified the durability fix as "wire `startSyncLoop` over the mesh-aware root set into a
   serve/daemon face, OR a post-mint durability sync at `run-complete`." That fix improves cross-node
   reclaim FIDELITY (the reclaiming peer can stamp `runtime_offline`/`reclaimedAt` + thread `retryOf`) — a
   `26/ADR-008` fidelity concern, NOT a KR3 blocker (KR3 measures pick-up; the item is never left stuck
   regardless — `26/ADR-008.1`, the lease lapses by rule and any peer re-leases). Wiring a launched
   continuous mover is a SERVE-LAUNCHER concern (there is no registered verb that runs a long-lived mover —
   the same absence F-26-01 records for the relay broker), and it belongs with the packaging/serve arc
   (m28, Phase 4), not the routing charter. **m27 CONSCIOUSLY DEFERS it**, recording the bound: (a) the
   run-complete post-mint durability sync (`run-complete` runs no sync today — `26/ADR-008` verified) is the
   MINIMAL forward option and is the natural home when `run-complete`'s mesh path is next touched; (b) until
   then, an issued item run on B propagates B's run record on B's NEXT `run-start` pre-mint sync (the same
   `26/ADR-008` cadence), which is sufficient for KR3 and for the fleet UI's owner-presence-based board
   chip (`25/ADR-005` — the board's running signal is the OWNER's `presence.activeRuns`, which DOES
   propagate, not the run record).

3. **The `26/ADR-009` alive-owner ghost-claim reconciliation stays DEFERRED** (retro/next, not m27 scope).
   Judgement: it is a `work:run-start` step-0 own-claims-vs-own-runs reconciliation (`26/ADR-009`'s fix
   direction) — a LEASE hygiene concern on a narrow crash interleave, orthogonal to routing/issuance. m27
   touches `run-start`'s reclaim/claim path only via the existing acquire (no change to the ghost-claim
   window), so folding an unrelated reconciliation here would smear a lease-hygiene fix into the routing
   milestone. It stays a bounded liveness limitation routed to retro/next (`26/ADR-009` scope), unchanged.

**Alternatives considered.**
- *Wire `startSyncLoop` into a serve face THIS milestone so run records propagate continuously.* Rejected
  for m27 scope: it is a serve-launcher deliverable (a long-lived mover needs a launch home the mesh does
  not yet have — the m28 packaging/serve arc), and KR3 is met without it (the directive propagates over the
  default sync; the item is never stuck). Wiring it here would import a serve/daemon concern into the
  routing charter.
- *Add a `run-complete` post-mint durability sync in m27.* Considered and scoped as the MINIMAL bounded
  follow-up (2b) rather than a m27 deliverable: it is a `26/ADR-008` fidelity improvement, not a KR3
  requirement, and `run-complete`'s mesh path is not otherwise touched by routing — so touching it for a
  fidelity gain would be scope creep. Recorded here as the clean forward home.
- *Push the directive over the relay for sub-5s propagation.* Rejected for v1 (ADR-002.4): a directive has
  no race to win; the git push meets KR3; the relay accelerator is a deferred, relay-change-free follow-up.

**Consequences.** m27 wires ONLY the directive propagation (the `mesh:issue` push, ADR-002.4, over the
existing default-root sync) — no new mover, no engine change. The run-record durability mover + the ghost-
claim reconciliation are recorded as BOUNDED follow-ups with named homes (m28 serve arc / retro),
inheriting `26/ADR-008` + `26/ADR-009` honestly. The *observable* KR3 behaviour (a directive issued on A is
picked up and run on eligible B within ≤2 sync intervals, no manual file shuffling) is the milestone's
`@executable` (two clones over a shared bare remote) + `@manual` (the 3-node ≥95% soak) verification
material, not a fitness function.

## ADR-006: The fleet-UI issue/assign write route — `POST /api/mesh/issue` on `src/mesh-ui-serve.mjs` → `invoke("mesh:issue")`, the FIRST write route on the fleet face; it DELIBERATELY relaxes m25/ADR-004's read-only posture (the m25-deferred surface), flipping EXACTLY `acd-mesh-ui-write-isolation` to a bounded-write shape while `acd-mesh-ui-single-server` / `acd-mesh-ui-no-core-import` stay green; the route is bounded (same-origin 127.0.0.1, control-node framing, the m24 credential/trust boundary), its threat model owned by a focused SECURITY.md

**Status:** Accepted
**Date:** 2026-07-03

**Context.** `25/ADR-004` locked the fleet view READ-ONLY and EXPLICITLY deferred "the issue/assign write
affordance + its genuinely new authz surface to milestone 27, where its authz belongs." This is that
milestone. The fleet face (`src/mesh-ui-serve.mjs`) today serves exactly one route (`GET /api/mesh/status`),
refuses every write method with a 405, destroys every upgrade, and writes nothing — the m25 read-only
posture, structurally locked by `acd-mesh-ui-write-isolation` / `acd-mesh-ui-single-server` /
`acd-mesh-ui-no-core-import`. Adding a write route is a DELIBERATE relaxation of one of those guards —
exactly as `25/ADR-001`'s rename deliberately touched m03's frozen board guards (a sanctioned, pinned
flip, not a drive-by). The mutation must ride the registry door (`08/ADR-004 inv.3`): the fleet face reaches
it ONLY via `invoke("mesh:issue")`, never by importing `mesh-issuance.mjs`.

**Decision.**

1. **`POST /api/mesh/issue` on the EXISTING fleet face — the first write route.** `src/mesh-ui-serve.mjs`
   gains one `POST /api/mesh/issue` handler that reads the request body (`{ ref, to? }`), calls
   `invoke("mesh:issue", { ref, to }, { workspace })` through `./command-core.mjs` (the ONE door — no
   direct `mesh-issuance` import, so `acd-mesh-ui-no-core-import` stays GREEN), and returns the directive
   record or the coded error envelope. No second server, no second port (the route is on the SAME
   `http.createServer` bound to `127.0.0.1` — `acd-mesh-ui-single-server` stays GREEN), and no `/api/work`
   route (the disjoint `/api/mesh` namespace, `25/ADR-003`). The `[assign ▸]` affordance in the fleet
   bundle POSTs to it.

2. **EXACTLY ONE guard flips: `acd-mesh-ui-write-isolation` → a BOUNDED-WRITE shape.** The m25 gate
   asserted the fleet face writes NOTHING and serves no write route. It is SUPERSEDED (not silently broken)
   by a bounded-write assertion: the fleet face's ONLY mutation route is `POST /api/mesh/issue`, it reaches
   the mutation ONLY via `invoke("mesh:issue")` (no direct operation import, no bare `writeFile`/
   `child_process` in the face), and it serves NO other write route and NO `/ws/terminal` (the read-only-
   except-issue posture). This is the m25-deferred surface arriving under a pinned, greppable guard (fitness
   #7). `acd-mesh-ui-single-server` and `acd-mesh-ui-no-core-import` are UNCHANGED and stay green (fitness
   table — carry-green-unchanged vs. must-flip, the `25/ADR-001` distinction).

3. **The route is BOUNDED at three edges.** (a) **Same-origin `127.0.0.1`** — the board isolation model
   (`03/ADR-001`, inherited by `25/ADR-004`): the face binds loopback, so the write route is reachable only
   from the operator's own machine, no cross-origin surface. (b) **Control-node framing** — the `[assign
   ▸]` affordance is offered/gated behind `isControlNode(config)` (`24/ADR-001`), matching the PRD's "issue
   from the control node" (§7.2 KF9); the fleet view surfaces the affordance where the issuing hub sits.
   (c) **The m24 credential/trust boundary** — the directive write the route triggers is a `.mesh/` write
   admitted by group membership (git remote access provisioned at enrolment, `24/ADR-001`/A3; a revoked
   node is rejected by the relay auth-gate, `24/ADR-004`) — the write does not mint a NEW trust primitive;
   it rides the EXISTING one. v1 trust = group membership; **untrusted/cross-org issuance authz is Phase-5+
   out of scope** (PRD §8).

4. **The threat model is owned by a focused `SECURITY.md`, authored separately by the security specialist**
   (the `24/SECURITY.md` convention — fanned out at Decide by the architect for a milestone with a real new
   surface). This ADR carries the STRUCTURAL decision + the security-lens POINTER; it does NOT duplicate the
   threat model. **Security lens (the pointer, not the model):** the fleet UI gains its FIRST inbound
   mutation — a genuinely new surface `25/ADR-004` flagged. The v1 posture: loopback same-origin (no new
   port beyond the local board-model server), the mutation rides the EXISTING m24 group-membership boundary
   (no new authz primitive), and the affordance is control-node-framed. The residual surface — CSRF-style
   same-origin request forgery against the loopback write route, and the untrusted-issuer fork — is the
   SECURITY.md's charter (referenced here, not restated). A security-lens review IS owed this milestone
   (unlike m25, where `25/ADR-004` judged none owed for the read-only render).

**Alternatives considered.**
- *A new SECOND server / port for the write route (isolate writes from the read face).* Rejected: it breaks
  `acd-mesh-ui-single-server` (`25/ADR-003`'s single-`127.0.0.1`-server precedent, `03/ADR-001`) for no
  security gain — same-origin loopback bounds the surface whether it is one route or two on the one server;
  a second server is a second bind + a second isolation model to reason about.
- *The fleet face writes the directive DIRECTLY (`mesh-issuance.mjs`) for speed.* Rejected outright: the
  `08/ADR-004 inv.3` / `acd-mesh-ui-no-core-import` violation — a second data path bypassing the registry
  door. The face `invoke`s `mesh:issue`; the perf cost of one in-process invoke is nil.
- *Keep the fleet face read-only and issue only via the CLI.* Rejected: `SPEC §Scope` + `25/ADR-004`
  explicitly place the issue/assign affordance ON the fleet view this milestone; deferring it again would
  leave KR3's "issue from the fleet UI" unmet.

**Consequences.** Story 02 adds the `POST /api/mesh/issue` route to `src/mesh-ui-serve.mjs` (reaching
`invoke("mesh:issue")`), the `[assign ▸]` affordance in the fleet bundle, and FLIPS
`acd-mesh-ui-write-isolation` to the bounded-write shape (fitness #7); it depends on story 01 (`mesh:issue`
must exist) and coordinates with the security-lens story (the SECURITY.md threat model + its security-owned
fitness). The *observable* behaviour (a `POST /api/mesh/issue` from the fleet UI issues a directive that a
peer picks up; a non-control node's affordance is gated; a GET/read still mutates nothing) is story-02 task
`.feature` material.

## Fitness Functions

<!-- Each structural invariant from an ADR, paired with the arch-test that enforces it in CI. These replace
     "invariant-as-scenario" — they belong here, never in a task feature. Suite hygiene: every test WRITTEN
     in this Decide stage passes GREEN now (the absence-tolerant / existsSync-guarded / XOR idioms the
     codebase already uses — acd-run-store-mesh-free's stripComments grep, acd-work-ui-rename-complete's XOR,
     the mesh-ui SPECIFY-at-build posture); a test that would hard-fail on a not-yet-existing module
     (src/mesh-issuance.mjs, src/commands/mesh-issue.mjs) is SPECIFY'd here and authored at build.
     `node scripts/test.mjs` stays green through Decide. "From" names the owning story. -->

| # | Invariant | Enforced by (arch-test) | State now | From |
|---|---|---|---|---|
| 1 | **Issuance write-scope.** Every directive write joins `issuanceDirectivePath`/`meshDir` via atomic `writeText` (never a bare `writeFile`/`appendFile`); `src/mesh-issuance.mjs` references ZERO record-doc filename (`SPEC.md`/`STORY.md`/`STATE.md`/`SESSION.md`); the only path it writes is built with THIS node's OWN issuer id (own-partition writes only — the third-arg is the writer's own `issuer`/`nodeId`, never a foreign issuer); withdrawal/fulfilment is a STATE write, never a delete (no `unlink`/`rm` of a directive) (ADR-001). | `test/arch/acd-issuance-write-scope.test.mjs` — source-analysis of `src/mesh-issuance.mjs` cloning `acd-lease-write-scope`'s stripComments + collectCalls helpers: writes join `issuanceDirectivePath`, route through `writeText`, zero record-doc filenames, own-issuer path form, no directive delete; m03 non-vacuous planted-violation self-check. | **SPECIFY** — RED-until-module (`src/mesh-issuance.mjs` does not exist); authored when story 01's writes land. | **01** |
| 2 | **The frozen six-key directive + the EOL pin already covers it.** `assembleDirective`/`readIssuanceDirectives` carry EXACTLY the six keys — `itemRef, issuer, target, state, issuedAt, aofVersion` — in that name/order; `state ∈ {issued, withdrawn, fulfilled}`; `target` is the discriminated union `{kind: any|node|capability}`. The `.mesh/` EOL pin `**/.mesh/** text eol=lf` MATCHES the real nested sample path `wiki/work/<item>/.mesh/issuance/<node>/<ref>.json` (git-semantics matching, the 22/R3 method — NO new rule authored). | `test/arch/acd-issuance-record-frozen.test.mjs` — import `mesh-issuance.mjs`, assemble a fixture: key set + order asserted, the state enum + target-union shape asserted; AND construct the real sample path and assert the PARSED `.gitattributes` `**/.mesh/**` rule matches it (never a literal grep). | **SPECIFY** (schema half RED-until-module); the EOL-match half is **WRITE now — GREEN** (the `**/.mesh/**` rule exists today, the sample-path match is assertable now). | **00** |
| 3 | **The targeting matcher is a pure descriptor read.** `nodeSatisfiesTarget(descriptor, target)` in `src/mesh-issuance.mjs` reads ONLY the frozen `22/ADR-003` fields (`nodeId`/`runtimes`/`skills`); `any` ⇒ true, `node` ⇒ nodeId match, `capability` ⇒ runtimes-or-skills membership, unknown kind ⇒ false; the module imports NO `node-identity.mjs` (no derive/assemble — the matcher re-derives nothing) (ADR-003). | `test/arch/acd-targeting-matcher-descriptor-pure.test.mjs` — import-grep `mesh-issuance.mjs` (no `node-identity` import) + call the matcher over fixtures for each `kind` (incl. absent-field honest-minimal + unknown-kind fail-safe); m03 planted-violation self-check. | **SPECIFY** — RED-until-module; authored with story 00's matcher. | **00** |
| 4 | **Mesh-aware `next` is injected + optional; `work.mjs` stays mesh-free (the m26/#7 invariant restated over the UNIFIED candidacy view).** `src/work.mjs` imports NO mesh module; `nextWork`'s candidacy view is the OPTIONAL third argument defaulting absent (byte-identical without it); `src/commands/next.mjs` builds the UNIFIED view (lease + routing filter) ONLY under the `config.mesh.nodeId` gate (ADR-004; m26/ADR-005). | `test/arch/acd-next-candidacy-injected.test.mjs` — import-grep `src/work.mjs` (no mesh import) + signature/default check on `nextWork` + the config gate + the routing-filter fold in `commands/next.mjs` (the `nodeSatisfiesTarget`/directive read under the gate). Extends the existing `acd-next-lease-injected` posture. | **WRITE now — GREEN, absence-tolerant.** The `work.mjs`-mesh-free + optional-arg + config-gate halves are assertable today (they hold on the current tree — m26 shipped them); the routing-fold half is `existsSync(mesh-issuance.mjs)`-guarded (tightens when story 00/01 land). | **01** |
| 5 | **The candidacy lookup applies at EVERY `nextWork` ready-return (the m26/ADR-007 fold-in).** The candidacy-view lookup guards the `uat` driver return (`work.mjs:568`), the zero-story driver return (`:574`), AND the story-loop returns — not only the story loop; the milestone-accept fallthrough (`:598`) is deliberately candidacy-blind (ADR-004; supersedes m26/ADR-007's deferral). | `test/arch/acd-next-candidacy-every-return.test.mjs` — source-analysis of `nextWork`'s body: each ready-return site (uat / zero-story / story-loop) is preceded by/guarded by the candidacy lookup (the `candidacyView?.get?.(ref)` branch); the accept fallthrough is NOT (the carve-out). Behavioural confirmation lives in a task feature. | **WRITE now — GREEN, XOR/consistency form.** Phrase as: the driver returns are guarded by the lookup IFF the fold-in has landed — GREEN today as the "story-loop-only" state (the m26 shipped shape) AND GREEN post-fold-in (all-returns), the XOR-consistency idiom (`acd-work-ui-rename-complete`); it flips its assertion side when the fold-in lands, never RED on a valid tree. | **01** |
| 6 | **`mesh:issue` re-arms the registry-derived mesh bijection.** `mesh:issue` is a registered `mesh:*` command with a `cli` adapter (`argv`/`render` functions), a `subcommand === "issue"` branch in `meshCommand`, and `aof mesh issue <ref> --json` runs clean + parseable — DERIVED from `listCommands()`, no literal (ADR-002; 22/fitness #3). | `test/arch/acd-mesh-command-cli-bijection.test.mjs` (EXISTING) — the registry-derived gate auto-covers `mesh:issue` once it registers; the `argsFor` switch gains a `case "issue"` (the 19/R1 THROW-on-unmapped pattern). Enumerated, not duplicated. | **GREEN now (vacuous over `issue`); RED on the `issue` verb until story 01 registers it** — the existing gate's RED-until-command posture, exactly as identity/sync/…/revoke armed it in turn. | **01** |
| 7 | **The fleet-UI write-isolation guard FLIPS to a BOUNDED-WRITE shape.** `src/mesh-ui-serve.mjs`'s ONLY mutation route is `POST /api/mesh/issue`; it reaches the mutation ONLY via `invoke("mesh:issue")` (no direct `mesh-issuance`/operation import, no bare `writeFile`/`child_process` in the face); it serves NO other write route and NO `/ws/terminal`. `acd-mesh-ui-single-server` + `acd-mesh-ui-no-core-import` stay GREEN unchanged (ADR-006; supersedes 25/ADR-004's read-only assertion). | `test/arch/acd-mesh-ui-write-isolation.test.mjs` (EXISTING m25 gate, SUPERSEDED in place at build) — the assertion moves from "zero write route" to "the ONE write route is `POST /api/mesh/issue` reaching `invoke("mesh:issue")`, no direct operation import, no other write/upgrade route"; m03 planted-violation self-check. | **WRITE now — GREEN, XOR/consistency form.** Phrase as: the fleet face has EITHER zero write route (the current m25 read-only tree) OR exactly the `POST /api/mesh/issue` route reaching `invoke("mesh:issue")` — GREEN in both valid states, RED only in the broken half (a write route that bypasses the door, or a second write route). It flips its satisfied side when story 02 lands the route. | **02** |

<!-- Note on what is an arch-test vs a behavioural task scenario (mirrors 22/25/26's split):
     - The directive write-scope, the frozen six-key schema + EOL-match, the pure descriptor-reading
       matcher, the injected mesh-free candidacy view, the every-ready-return candidacy fold-in, the
       mesh:issue bijection re-arm, and the fleet-UI bounded-write flip are STRUCTURAL invariants over
       module source, imports, signatures, and repo config → arch-tests (this table).
     - The OBSERVABLE behaviours — a directive issued on A appears on B after a sync; a node-targeted item
       is offered only on the eligible node and a wrong-capability peer skips it; an `any` item is offered
       fleet-wide and the m26 lease arbitrates the claim; a targeted item picked up and run on eligible B
       with no manual file shuffling within ≤2 sync intervals (KR3); the fleet-UI POST issues a directive a
       peer picks up; a withdrawn directive stops offering the item — exercise real git fixtures / the real
       fs / the injected transport. They belong in the stories' task .feature files, NOT here.
     - KR3's "≥95% of issued items picked up on eligible B, ≤2 sync intervals" is a VERIFICATION-TIME soak
       on a real 3-node fleet (@manual, story 02), the 23/26 measurement discipline — the MECHANISM is
       @executable (two clones over a shared bare remote: issue on one, pick up on the other), the ≥95%/3-OS
       SOAK is measured, never a flaky CI assert. -->

## Recommended story partition

Grounded in the graph coupling (`aof graph impact`, author time — `aof graph build src` → 1261 nodes /
3400 edges, builtAt 2026-07-03, egress none; cited as ACTUAL structure, not inferred). The three moves fall
on the milestone family's proven grain — **substrate/dependency-root story → CLI end-to-end story → UI/
integration story** — which is exactly the 3-story shape m22/m23/m26 all landed. **Confirmed** — the PO's
working 3-story hypothesis is the right grain; the graph pins the exact parallelism below.

- **Story 00 — the directive substrate + the eligibility matcher (git-only dependency root; NO command,
  NO UI).** OWNS `src/mesh-issuance.mjs` (NEW: `assembleDirective` — the frozen six-key record;
  `readIssuanceDirectives` — the `readLeaseClaims`-shaped absence-tolerant walk; `nodeSatisfiesTarget` —
  the pure matcher, ADR-003) and the RESERVED `issuanceDirectivePath` pure builder in `src/mesh-store.mjs`
  (the `22/ADR-002`/`26/ADR-003.1` reservation idiom — named, writes nothing). Arms fitness **#2 (schema/
  EOL-match)** + **#3 (matcher)**, and the EOL-match half of #2 is green-now. Touches NO command file, NO
  relay, NO UI. **The dependency root** — its frozen contracts (the six-key directive, the `target` union,
  `issuanceDirectivePath`, `nodeSatisfiesTarget`) are what stories 01/02 build against.
  - *Graph grounding:* `aof graph impact src/mesh-store.mjs` reports ← **7** (`mesh-identity`, `run-start`,
    `mesh-lease`, `mesh-presence`, `mesh-registry`, `mesh-sync`, + the reserved builder's consumers) → 2
    (`fs.mjs`, `run-store.mjs`) — the path-partition spine every mesh record rides; the directive-path
    reservation is ONE additive builder on it, exactly where `leaseClaimPath`/`presenceRecordPath` sit. The
    new `src/mesh-issuance.mjs` couples the SAME way `mesh-lease.mjs` does (`aof graph impact
    src/mesh-lease.mjs` → ← 4, → 3 `fs`/`mesh-presence`/`mesh-store`): git-pure, into `mesh-store`, no relay
    — so it is provable over plain fixtures with neither the command nor the UI.

- **Story 01 — the `mesh:issue` command + the mesh-aware-`next` routing pickup + the m26/ADR-007 fold-in +
  the `mesh:status` issued render (CLI end-to-end over git).** OWNS `src/commands/mesh-issue.mjs` (NEW: the
  resolve → assemble → write → push composition, ADR-002), the `mesh-issuance.mjs` WRITES (`issueDirective`/
  `withdrawDirective` — own-path state writes, ADR-001.3), the `command-core.mjs` registration + the
  `cli.mjs` `subcommand === "issue"` branch, `src/commands/next.mjs` (the UNIFIED candidacy view — routing
  filter folded into the existing lease-view build under the same config gate, ADR-004), `src/work.mjs`
  (the m26/ADR-007 every-ready-return fold-in — ready-return edits only, NO new import), and
  `src/commands/mesh-identity.mjs` (the additive `mesh:status` issued-directive render). Arms fitness **#1
  (write-scope)**, **#4 (injected mesh-free candidacy)**, **#5 (every-ready-return)**, **#6 (bijection)**.
  Imports NO relay module and NO UI — the whole story runs over plain local git fixtures.
  - *Graph grounding:* `aof graph impact src/commands/next.mjs` reports ← 1 (`command-core.mjs`) → 3
    (`mesh-lease.mjs`, `mesh-presence.mjs`, `work.mjs`) — the SAME narrow read corridor m26/ADR-005 proved;
    the routing read folds into the existing lease-view build, no new import into `work.mjs`. `aof graph
    impact src/work.mjs` reports ← **19** dependents → 2 — the widest-fan-in, pure core: the ADR-007 fold-in
    edits ready-returns only (no mesh import), so it does not perturb the 19 consumers. `aof graph impact
    src/command-core.mjs` (← 5, → **28**) confirms `mesh:issue` is ONE additive door entry, exactly the
    22/24 verb move. **Sequenced after 00** (needs the six-key directive + `nodeSatisfiesTarget` +
    `issuanceDirectivePath`).

- **Story 02 — the fleet-UI issue/assign write route + the `[assign ▸]` affordance (the UI/integration
  join).** OWNS `src/mesh-ui-serve.mjs` (the NEW `POST /api/mesh/issue` route reaching `invoke("mesh:issue")`
  — the FIRST write route on the fleet face, ADR-006), the fleet bundle's `[assign ▸]` affordance, and the
  FLIP of `acd-mesh-ui-write-isolation` to the bounded-write shape (fitness **#7**). Coordinates with the
  **security-lens story** (the `SECURITY.md` threat model + its security-owned fitness — CSRF/same-origin,
  the untrusted-issuer fork, ADR-006.4). **Depends on 01** (`mesh:issue` must exist for the route to
  invoke) — the genuine integration story, exactly m25's 01→03 / m26's 00+01→02 shape.
  - *Graph grounding:* `aof graph impact src/mesh-ui-serve.mjs` reports ← 1 (`cli.mjs`) → 2
    (`command-core.mjs`, `work.mjs` — the latter only the `displayPath` face adapter `25/ADR-003` allows).
    The write route reaches the mutation ONLY through `command-core.mjs` (the registry door), so it adds
    ZERO coupling beyond the door — `acd-mesh-ui-no-core-import` stays green; ONLY
    `acd-mesh-ui-write-isolation` flips. Greenfield-shaped edit on an isolated face.

**Parallelism verdict:** the chain is **00 → 01 → 02** (each sequences after the prior on a REAL data
dependency, not mere convenience). This milestone is deliberately MORE sequential than m25's 01∥02 or m26's
00-then-01∥pending because routing is a thin COMPOSITION of DONE seams with one substrate contract flowing
through all three: 00 freezes the directive record + matcher; 01 cannot build `mesh:issue`/the routing
filter without them; 02 cannot POST to `mesh:issue` before it exists. There is no genuinely-parallel
sibling pair here (unlike m26's git-pure lease sibling running parallel to the run substrate) — the honest
cut is a three-link chain. Within that chain the edits are file-disjoint per story (00: `mesh-issuance.mjs`
+ the `mesh-store.mjs` reserved builder; 01: `mesh-issue.mjs` + `next.mjs` + `work.mjs` ready-returns +
`mesh-identity.mjs` render; 02: `mesh-ui-serve.mjs` + bundle), so no file is owned by two stories — clean
sequencing, not contended co-edit. The security-lens work (the `SECURITY.md` + its fitness) runs ALONGSIDE
01/02 (it depends only on the ADR-006 write-route decision, frozen here at Decide), converging into 02.

The coupling is **advisory**: it informs why substrate-first (00) + a CLI-end-to-end routing story (01) + a
UI/security integration join (02) is the right cut (the `mesh-store` spine the directive path reserves onto,
the `mesh-lease`-shaped git-pure module, the narrow `next` corridor, the widest-fan-in `work.mjs` touched
only at its ready-returns, the isolated fleet face where one guard flips) — but the PO draws the final
partition. The graph confirms; it does not dictate.

<!-- Retro note for the orchestrator (surfaced via aof:feedback, not a review gate): `aof graph impact
     src/mesh-store.mjs` reported a dependent `src/mesh-lease-tie.mjs` that does NOT exist on the tree —
     `tieClaimToRun` lives in `src/mesh-lease.mjs` (26/ADR-003, PO-sanctioned single lease-write home). The
     phantom edge is a stale graph artifact (likely a comment/plan reference graphify resolved as a node);
     it did not change any boundary (the real coupling is mesh-lease.mjs ← 4 / mesh-store.mjs ← 7), but it
     is worth the retro so the graph's node set is not silently trusted where a file check disagrees. -->
