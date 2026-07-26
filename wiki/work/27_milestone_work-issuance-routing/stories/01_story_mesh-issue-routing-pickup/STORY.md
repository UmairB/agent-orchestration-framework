---
type: story
number: 01
slug: mesh-issue-routing-pickup
title: "mesh:issue + mesh-aware next routing pickup — issue/target from any node, an eligible node picks it up (CLI end-to-end over git); folds in the m26/ADR-007 every-ready-return fix"
parent: 27
status: done
owner: product-owner
created: 2026-07-03
updated: 2026-07-03
schema: 1
aofVersion: 0.1.0
---
<!--
  STORY.md — the story record. Answers ONE question: why this story (the user-facing outcome)?
  Owner: product-owner. The USER STORY lives here, never on the tasks.
  A milestone-bound story inherits the milestone's ADRs / DESIGN / RESEARCH.
-->
# 01 · mesh:issue + mesh-aware next routing pickup — the CLI end-to-end over git

## User story

As an operator on **any** node in the group,
I want `aof mesh issue <ref> [--to <node|cap>]` to enqueue/target work into the fleet (writing my own-partition directive and pushing it), and an eligible node's `aof work next` to offer **only** the work it is eligible for — a directive targeted elsewhere is skipped, a targeted-here or untargeted one is offered and then the m26 lease arbitrates the actual claim,
so that work issued on node A is **picked up and run on an eligible node B with no manual file shuffling** (KR3), within ≤2 sync intervals, and with **no double-execution** (routing narrows candidacy; the lease decides who runs).

<!-- The CLI end-to-end routing story: issue → propagate → eligible pickup, entirely over git, no UI, no
     relay change. It also completes the m26/ADR-007 deferral (the driver ready-returns become
     candidacy-aware), routed to "the FIRST m27 item" — this is it. -->

## Tasks

<!-- Contract authored via Three Amigos (`aof:refine 27 --autonomous`, Contract stage). Each behaviour
     task is one `.feature` under tasks/; done when its feature is green. The fitness functions are
     arch-tests (structural invariants → never a behaviour feature) tracked as buildable units below. -->

- [x] `tasks/00_mesh-issue-command.feature` — `aof mesh issue <ref> [--to <node|cap>]` (ADR-002): no `--to` ⇒ a `{kind:"any"}` directive under THIS node's issuer partition, `--json` emits the record; `--to <known-nodeId>` ⇒ `{kind:"node"}`, `--to <other-token>` ⇒ `{kind:"capability"}` (the DATA-DRIVEN roster disambiguation, frozen at issue time); a typo'd/nonexistent ref ⇒ `ref-not-found`, NO directive written (`resolveItemExact`, write-isolation — the tree byte-unchanged); a successful issue commits + pushes ONE default-root sync (no relay push in v1); a push failure surfaces a coded error while the directive is already durable locally (degrades to the git cadence); own-partition only (a peer's directive for the same item is left byte-unchanged — two files, two partitions, add-only).
- [x] `tasks/01_directive-withdraw.feature` — withdraw (ADR-001.3): the issuer flips its OWN-partition directive to `state:"withdrawn"` — never a delete/unlink (the file still exists, the other five keys unchanged); a withdrawn directive is SPENT — a mesh-aware `next` no longer targets/skips the item by it (the pickup consumes only non-withdrawn directives); own-path only (a peer's directive is never touched); withdraw is idempotent-safe on an already-withdrawn directive and absence-tolerant on a never-issued one (nothing fabricated, nothing deleted).
- [x] `tasks/02_routing-pickup.feature` — mesh-aware `next` routing (ADR-004, the heart; the m26 `02_mesh-aware-next` analog): a `{kind:"node"}` directive is offered ONLY on the target and SKIPPED elsewhere (exactly as a leased-live item is skipped); a `{kind:"capability"}` directive is offered where the descriptor advertises the runtime/skill and SKIPPED otherwise; a `{kind:"any"}` (or no) directive is offered fleet-wide in its normal walk position; a targeted-HERE item is OFFERED and the m26 lease then arbitrates (two eligible nodes ⇒ exactly ONE runs, KR2 holds — routing narrows, never grants); a targeted-here item leased-live elsewhere is offered by routing then skipped by the lease (the precedence lock); a targeted-elsewhere item short-circuits before its lease (never surfaced reclaimable here); unconfigured mesh ⇒ BYTE-IDENTICAL to today (directives invisible).
- [x] `tasks/03_candidacy-every-return.feature` — the m26/ADR-007 fold-in (ADR-004.3): the candidacy lookup guards each `nextWork` ready-return — the `uat` driver return (`work.mjs:568`) and the zero-story needs-break-down driver return (`:574`) become candidacy-aware (a targeted-elsewhere directive OR a live-peer lease ⇒ skipped; a stale-peer lease ⇒ ready + reclaimable), completing what the story-loop returns already did in m26; the milestone-ACCEPT fallthrough (`:598`) stays candidacy-BLIND (a done milestone is not a claimable work ref); the double-offer of a driver ref another node is working is closed at the driver returns.
- [x] `tasks/04_mesh-status-issued-render.feature` — the additive `mesh:status` issued render **+ the `isControlNode` marker** (ADR-004 consequences + 25/ADR-002 one-data-command, riding the EXISTING verb — no gate re-armed): `mesh:status` appends an ISSUED section per OPEN directive (issuer, item, target) ALONGSIDE nodes/boards/leases (the `{nodes,boards}` shape untouched); a withdrawn/fulfilled directive is filtered out; NO directives ⇒ `[]` (or absent), byte-identical to today, no dangling heading; unconfigured mesh ⇒ the `issued` key is absent (directives on disk invisible); the `--json` face carries the directives; the render is a PURE read (the issuance tree byte-unchanged). **ALSO emits an additive `isControlNode` marker** (a pure read of `isControlNode(config)`, `24/ADR-001`) so story 02's fleet UI gates the `[assign ▸]` affordance to the control node (the DESIGN true-absence) — the cross-story seam story 02 CONSUMES off this ONE data command.
- [x] `tasks/07_revoked-issuer-filtered.feature` — the revoked-issuer routing filter (SECURITY **T4 / S-2**): the `commands/next.mjs` candidacy build consults the LIVE registry (`isRevoked`, re-read per `next`) and SKIPS every directive whose `issuer` is revoked, so a de-provisioned member cannot keep steering work via lingering git directives (the `24/T6` explicit-deny extended to routing); a non-revoked issuer routes normally; a node revoked AFTER it issued is filtered on the next `next`; the filter fails SAFE (removes routing power, never grants it; absent registry ⇒ nobody revoked ⇒ every directive live). Behavioural counterpart of the security fitness `acd-issuance-revoked-issuer-filtered`.
- [x] `tasks/05_cross-node-issuance-kr3.feature` — the KR3 `@executable` MECHANISM (ADR-005; the m26 `04_kr2-contested-soak` split, the mechanism half): two clones of one shared bare remote — issue on A targeted at B (a node target OR a capability B advertises), A syncs once (default roots), B pulls and its `next` OFFERS it, B claims via the m26 lease + mints a run under B's partition, A's `next` does NOT offer it (targeted elsewhere), the directive rode git with no manual file shuffling (incl. the ≤2-interval issuer-push→peer-pull propagation row and the withdraw round-trip). All in-process over the real git binary — no fleet.
- [ ] `tasks/06_kr3-soak.feature` — the KR3 `@manual` SOAK (ADR-005; the m26 `04_kr2-contested-soak` @manual shape): a real 3-node (Windows + macOS + Linux) fleet over a shared bare remote issues a pool across the three target kinds; ≥95% of issued items picked up + run on an ELIGIBLE node in ≤2 sync intervals, NO item run on an ineligible node, NO manual file shuffling — a VERIFICATION-time MEASUREMENT (like m26's KR2 soak), never a CI assert. All measured counts land in the milestone VERIFICATION.md.
- [x] **Fitness `acd-issuance-write-scope`** (arch-test, ADR-001 / fitness #1) — every directive write joins `issuanceDirectivePath`/`meshDir` via atomic `writeText` (never a bare `writeFile`/`appendFile`); `mesh-issuance.mjs` references ZERO record-doc filename; own-issuer-partition writes only (the written path's third arg is THIS node's own `issuer`/`nodeId`, never a foreign issuer); withdrawal/fulfilment is a STATE write, never a delete (no `unlink`/`rm` of a directive); m03 planted-violation self-check. **SPECIFY — RED-until-`mesh-issuance.mjs` writes land; authored here.**
- [x] **Fitness `acd-next-candidacy-injected`** (arch-test, ADR-004 / fitness #4) — `src/work.mjs` imports NO mesh module; `nextWork`'s candidacy view is the OPTIONAL argument defaulting absent (byte-identical without it); `src/commands/next.mjs` builds the UNIFIED view (lease + routing filter) ONLY under the `config.mesh.nodeId` gate (extends `acd-next-lease-injected`). **WRITE now — GREEN, `existsSync`-guarded routing-fold half.**
- [x] **Fitness `acd-next-candidacy-every-return`** (arch-test, ADR-004.3 / fitness #5) — source-analysis of `nextWork`'s body: each ready-return site (`uat` `:568` / zero-story `:574` / story-loop `:581/590/592`) is guarded by the candidacy lookup, the milestone-accept fallthrough (`:598`) is NOT (the carve-out); the XOR/consistency form (GREEN as the story-loop-only m26 shape AND GREEN post-fold-in). **WRITE now — GREEN, XOR/consistency form.**
- [x] **Fitness `acd-mesh-command-cli-bijection` (re-arm)** (arch-test, ADR-002 / fitness #6) — the EXISTING registry-derived mesh bijection auto-covers `mesh:issue` once it registers: a `cli` adapter (`argv`/`render`), a `subcommand === "issue"` branch in `meshCommand`, and `aof mesh issue <ref> --json` clean + parseable; the `argsFor` switch gains a `case "issue"` (the 19/R1 THROW-on-unmapped pattern). **GREEN now (vacuous over `issue`); RED on the `issue` verb until story 01 registers it.**
- [x] **Security fitness `acd-issuance-revoked-issuer-filtered` S-2** (arch-test, SECURITY §Security fitness / T4 — ALREADY on the tree, wired into `scripts/test.mjs`) — source-analysis that the `commands/next.mjs` candidacy build consults `isRevoked` (the live registry) before a directive contributes a routing verdict; a planted revocation-blind filter fails it; `existsSync`-guarded green today, its non-vacuous half arms the moment this story's routing filter + the revocation check land TOGETHER (build the check IN from the start — no red-then-green churn). Behavioural counterpart is `tasks/07_revoked-issuer-filtered.feature`.

## Notes

Inherits the milestone [ARCHITECTURE.md](../../ARCHITECTURE.md) — **ADR-002** (the `mesh:issue` command:
`aof mesh issue <ref> [--to <node|cap>]`, a registered `mesh:*` verb re-arming the m22 bijection; resolves
the ref EXACTLY — write-isolation; `--to` disambiguation is DATA-DRIVEN against the synced roster
(node-id ⇒ `{kind:"node"}`, else ⇒ `{kind:"capability"}`, absent ⇒ `{kind:"any"}`); pushes ONE default-root
sync so the directive reaches peers within one interval — KR3; **no relay `kind` in v1**), **ADR-004**
(mesh-aware `next`: the routing filter UNIFIED with the m26 lease view into ONE injected candidacy view —
`work.mjs` stays mesh-free; targeted-elsewhere ⇒ skip, targeted-here/untargeted ⇒ offer then the lease
arbitrates; **the m26/ADR-007 fold-in — the candidacy lookup applies at EVERY `nextWork` ready-return**,
the `uat` + zero-story driver returns included, the milestone-accept fallthrough deliberately blind),
**ADR-005** (the directive propagates over the default `[meshDir]` sync — KR3 met with zero new mover; the
run-record durability mover + the m26/ADR-009 ghost-claim reconciliation stay bounded follow-ups, NOT this
story), and **ADR-001.3** (the directive WRITES — `issueDirective`/`withdrawDirective`, own-path state
writes, never a delete).

This story **owns**: `src/commands/mesh-issue.mjs` (NEW — the resolve → assemble → write → push
composition), the `mesh-issuance.mjs` WRITES (`issueDirective`/`withdrawDirective`), the `command-core.mjs`
registration + the `cli.mjs` `subcommand === "issue"` dispatch branch, `src/commands/next.mjs` (the UNIFIED
candidacy view — routing filter folded into the existing lease-view build under the same `config.mesh`
gate), `src/work.mjs` (the m26/ADR-007 every-ready-return fold-in — ready-return edits only, NO new mesh
import), and `src/commands/mesh-identity.mjs` (the additive `mesh:status` issued-directive render).

Also inherits [SECURITY.md](../../SECURITY.md) — **T4 / fitness S-2** (`acd-issuance-revoked-issuer-filtered`):
this story's `commands/next.mjs` candidacy build additionally consults the live registry (`isRevoked`) so a
revoked member's lingering directives cannot keep steering work (revocation completeness on the routing
surface). And it emits the additive **`isControlNode` marker** on `mesh:status` that story 02's affordance
gate consumes (the DESIGN true-absence; the ONE fleet-data command, `25/ADR-002`).

Arms fitness **#1** (`acd-issuance-write-scope`), **#4** (`acd-next-candidacy-injected` — mesh-free
`work.mjs` + injected optional view + the config gate), **#5** (`acd-next-candidacy-every-return` — the
fold-in), **#6** (`acd-mesh-command-cli-bijection` re-arm over the `issue` verb), and the security-owned
**S-2** (`acd-issuance-revoked-issuer-filtered`, already on the tree — its non-vacuous half arms with the
routing filter). Imports NO relay module and NO UI — the whole story runs over plain local git fixtures.

**Sequenced after 00** — it needs the frozen six-key directive, `nodeSatisfiesTarget`, and
`issuanceDirectivePath`. Graph-grounded: the routing read folds into the narrow `commands/next.mjs` corridor
(← 1 / → 3) the m26/ADR-005 lease view already proved; `work.mjs` (← 19, the widest-fan-in pure core) is
touched ONLY at its ready-returns (no mesh import — fitness #4 carries m26/#7 forward); `mesh:issue` is ONE
additive `command-core` door entry.

## Build notes (developer-amigo feasibility seat — fold in at `aof:continue`)

**Overall verdict: all 7 tasks stay `@executable`/`@manual` exactly as QA tagged them — ZERO retags.**
Every RAISED feasibility flag resolved source-checked against the real tree (real `file:line` citations
recorded in each task `.feature`, beneath its flag). `06_kr3-soak.feature` was already correctly
`@manual`; its flag confirms the classification, it does not change it. This story is a thin COMPOSITION
of four DONE seams (m22 descriptor, m24 registry/control-node, m25 mesh:status, m26 lease-of-record) —
every injection point QA asked about already has a proven precedent on the tree; nothing here needs a
new mechanism invented.

### `src/commands/mesh-issue.mjs` (NEW) — resolve → assemble → write → push

The `run-start.mjs` shape verbatim (`src/commands/run-start.mjs:86-263` is the model to read, not copy —
`mesh-issue.mjs` is far thinner, no lease/reclaim):
1. `resolveItemExact(ws.workDir, ref)` (`src/commands/resolve.mjs:24-28`) — miss ⇒ `commandError(...,
   "ref-not-found", 404)` BEFORE any directive touches disk (write-isolation, task 00 flag (c)).
2. Disambiguate `--to` DATA-DRIVEN against `readNodeRecords(ws)` (`src/mesh-store.mjs:132`): a token
   matching a synced `nodeId` ⇒ `{kind:"node", nodeId}`; any other non-empty token ⇒
   `{kind:"capability", value}`; absent/empty ⇒ `{kind:"any"}`.
3. `assembleDirective({ itemRef, issuer: meshNodeIdOf(config), target, state:"issued", issuedAt,
   aofVersion })` (story 00's pure builder in `src/mesh-issuance.mjs`) — `issuedAt` from an injected
   `input.now` (the `mesh:heartbeat`/`mesh:status` `input.now` precedent, `src/commands/mesh-
   identity.mjs:172-177`) falling back to wall-clock.
4. `issueDirective(ws, ownNodeId, ref, directive)` — story 01's OWN write in `mesh-issuance.mjs`
   (own-path `writeText` at `issuanceDirectivePath`, joining story 00's reserved builder in
   `mesh-store.mjs`) — the command ORCHESTRATES, the seam WRITES (20/ADR-005 split, held throughout
   the codebase: `run-start.mjs` never joins `leaseClaimPath` itself either).
5. `const runSync = ctx?.syncRunner ?? (() => syncMesh(ws));` (default roots — no `runsPathspec`,
   ADR-002.4) — call it once; a failure envelope (`{synced:false, reason:"push-failed"}`) surfaces as
   a coded CLI error while the directive stays durable (already written in step 4). The injection key
   name mirrors `ctx.relayClient` at `run-start.mjs:210` — a test-only ctx override, absent in
   production. `mesh:issue` never carries a lease/arbitration loop — a directive push is fire-and-
   observe, not a raced acquire (no `acquireLease` involvement).

`command-core.mjs` gains one import + one COMMANDS entry (the m22/m24 additive-verb move); `cli.mjs`'s
`meshCommand` gains one `if (subcommand === "issue") { await meshVerbCli("mesh:issue", rest, {
positionalAllowed: true }); }` branch, ABOVE the unknown-sub fallthrough (`cli.mjs:479-540`'s existing
ladder is the exact insertion pattern). **Ripple confirmed:** `test/arch/acd-mesh-command-cli-
bijection.test.mjs`'s `argsFor(sub)` switch (`:93-133`) currently has NO `case "issue"` — it THROWS
`unmapped subcommand issue` the instant `mesh:issue` registers (the 19/R1 pattern the test's own header
documents, `:19`). **This is an OWED edit, not a ripple risk** — story 01 must add `case "issue": return
["mesh", "issue", "27/00", "--json"];` (or similar) to that switch as part of landing the command, or
the bijection test fails loudly (correctly) the moment `mesh:issue` appears in `listCommands()`.

### `src/commands/next.mjs` — the unified candidacy view

Extends the EXISTING config-gated build (`next.mjs:33-61`) rather than forking it. Today: `leaseView =
buildLeaseView(claims, presenceById, {...})` then `nextWork(ws.workDir, scope, { leaseView })`. The
fold-in, still inside the SAME `if (typeof nodeId === "string" && nodeId.length > 0)` gate:
1. Read this node's own descriptor once: `const descriptor = await readNodeRecord(ws, nodeId);` (or the
   in-memory descriptor `mesh:identity` assembles — read AS DATA either way, ADR-003.4).
2. `const directives = await readIssuanceDirectives(ws);` (story 00's absence-tolerant walk).
3. Build ONE `candidacyView` Map keyed by item ref, each entry `{ state?, holder?, routed? }` — the
   `buildLeaseView` shape (`src/mesh-lease.mjs:401-428`) widened with an additive `routed` key computed
   from `nodeSatisfiesTarget(descriptor, directive.target)` per OPEN (non-withdrawn) directive:
   `routed: "elsewhere"` when the matcher is false, `routed: "offer"` (or simply omitted — absence
   already means offer) otherwise. Merge the lease entries in (or build both passes into the same Map
   from the start — order is immaterial since the two write disjoint keys per ref).
4. `nextWork(ws.workDir, scope, { candidacyView })` — `nextWork`'s destructured parameter is RENAMED
   (or additively aliased) from `leaseView` to `candidacyView`; its arity stays ONE optional argument
   (fitness #4 unperturbed — confirmed against the current signature at `src/work.mjs:535`).
5. **SECURITY S-2 fold-in (owed, per `SECURITY.md` T4/S-2, `test/arch/acd-issuance-revoked-issuer-
   filtered.test.mjs`):** before a directive contributes a `routed` verdict, its `issuer` MUST be
   checked against the live registry's revocation list (`isRevoked(registry, issuer)`,
   `src/mesh-registry.mjs:261`, `readRegistry(ws)` at `:107`) — a revoked issuer's directive is
   SKIPPED entirely (treated as absent), never routed. This read happens in `commands/next.mjs`
   alongside the routing-verdict build, under the SAME config gate — `work.mjs` still receives only
   the pre-filtered `candidacyView` as plain data (no new mesh import into `work.mjs`, fitness #4
   intact). `mesh-identity.mjs`'s `boardsProjection` (`:360-365`) is the precedent for a tolerant
   `readRegistry` wrap (ENOENT/torn ⇒ degrade, never blind the whole view).

The unconfigured floor (no `config.mesh.nodeId`) is UNCHANGED — the exact two-argument `nextWork` call
(`next.mjs:65`) that exists today.

### `src/work.mjs` — the ADR-007 fold-in at every ready-return

Confirmed against the real body (`src/work.mjs:535-602`): the uat return (`:568`) and the zero-story
return (`:574`) both call the SAME `ready(item, status)` helper (`:508-515`) keyed by `driver.ref` — the
identical key shape the candidacy view is built on, so `candidacyView?.get?.(driver.ref)` is a drop-in
guard mirroring the story loop's existing `leaseView?.get?.(story.ref)` (`:580`) verbatim. Both new
guards repeat the story loop's three-way branch (skip-elsewhere / skip-live / offer-reclaimable /
offer-plain) inline at their own site — a small disciplined repetition, not a new mechanism. The
milestone-accept fallthrough (`:598`) is territorially UNTOUCHED — no candidacy lookup added there (the
ADR-004.3 carve-out). **No new import** — `work.mjs` continues to import zero mesh modules; the guard
reads only the widened `candidacyView` parameter already threaded through from `next.mjs`.

### `src/commands/mesh-identity.mjs` — the additive ISSUED render

`meshStatusCommand.run` (`:168-345`) gains a fourth additive JSON key, inside the SAME `if (typeof
localId === "string" && localId.length > 0)` gate the `leases` section already uses (`:275-286`):
`result.issued = [{ issuer, itemRef, target }]` from `readIssuanceDirectives(ws)`, filtered to
non-withdrawn/non-fulfilled state. The human render (`:303-339`) gets ONE more `if (issued.length > 0) {
sections.push("ISSUED", ...issuedLines); }` block after the existing `LEASES` push — the third
occurrence of the identical "push only when non-empty" idiom the `BOARDS`/`LEASES` sections already
prove twice. `--json` passthrough (`(result) => result`, `:343`) is untouched. **Ripple check
performed:** `test/mesh-identity-status-commands.test.mjs` and `test/mesh-node-staleness-status.test.mjs`
only `assert.deepEqual(result.nodes, [...])` / `assert.deepEqual(result.boards, [...])` — scoped to
named keys, never an exhaustive `Object.keys(result)` shape assert — so an additive `issued` key breaks
neither file.

### Fitness-gate registration in `scripts/test.mjs`

None of the four m27/story-01 fitness gates named in ARCHITECTURE.md's table exist as files yet
(`acd-issuance-write-scope.test.mjs`, `acd-next-candidacy-injected.test.mjs`, `acd-next-candidacy-every-
return.test.mjs` are net-new; `acd-mesh-command-cli-bijection.test.mjs` already exists and is already
wired into `scripts/test.mjs:453` — it re-arms automatically via its registry-derived `subcommands()`
scan the moment `mesh:issue` registers, no edit to the test file itself needed beyond the `argsFor`
`case "issue"` noted above). The three new files must each be authored AND given an
`import { archTests as ... } from "../test/arch/....test.mjs";` line + spread into the suite array in
`scripts/test.mjs`, following the exact pattern the existing `acdMeshCommandCliBijectionTests` /
`acdIssuanceRevokedIssuerFilteredTests` imports already show (`scripts/test.mjs:453`, `:505`) — the
security-owned `acd-issuance-revoked-issuer-filtered.test.mjs` is ALREADY authored and wired (vacuous-
green today), so its non-vacuous half arms the moment task 02's routing filter + the S-2 revocation
check land together. Author `acd-issuance-write-scope` against `src/mesh-issuance.mjs`'s writes (mirrors
`acd-lease-write-scope.test.mjs`'s stripComments/collectCalls shape); author `acd-next-candidacy-
injected` + `acd-next-candidacy-every-return` against `src/work.mjs` + `src/commands/next.mjs` (mirrors
`acd-next-lease-injected.test.mjs`'s existing shape, extended to the unified view + the every-return
XOR/consistency form the ARCHITECTURE.md table specifies).

### Existing-test ripple summary

- `test/arch/acd-mesh-command-cli-bijection.test.mjs` — OWED `case "issue"` in `argsFor` (throws
  otherwise the moment `mesh:issue` registers; not a risk, a required same-commit edit).
- `test/mesh-identity-status-commands.test.mjs` / `test/mesh-node-staleness-status.test.mjs` — no ripple
  (scoped assertions, confirmed above).
- `test/arch/acd-issuance-revoked-issuer-filtered.test.mjs` (SECURITY S-2, already on tree) — arms
  (non-vacuous) when this story's routing filter lands; the revocation check must be built INTO the
  `next.mjs` candidacy-view composition from the start, not bolted on after, to avoid a red-then-green
  churn.
- No other existing test reads `mesh:status`'s result with an exact/closed shape; no other command reads
  `nextWork`'s two-argument signature in a way a third optional key (there isn't one — `candidacyView`
  REPLACES `leaseView` as the one injected argument, it does not add a second) would break.
