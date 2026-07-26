---
type: verification
milestone: "26"
slug: distributed-runs-leasing
verifier: aof:verify (inline orchestrator; @manual soak driven by aof-developer, re-verified inline)
date: 2026-07-03
verdict: PASS
---

# Verification — milestone 26 · distributed-runs-leasing

Acceptance of all three stories (`00 node-dimensioned-run-records` · `01 lease-of-record` ·
`02 claim-integration-fleet-reclaim`). Two lanes are in scope — **`@executable`** (11 task
features across the three stories, tasks 00–03) + the **twelve fitness functions**, and
**`@manual`** (story 02 / task 04 — the KR2 contested soak, agent-run on a real two-node
fleet). There is **no `@uat`** scenario and no UAT session, so no human sign-off lane is owed
(a foundational/distribution milestone — the operator is not pestered). There is **no DESIGN
surface** (`@cli` milestone, no `DESIGN.md`; the fleet UI is milestone 25 and cross-node
issuance/routing is milestone 27, `SPEC §Out of scope`), so no design-conformance render/judge
lane runs.

## Verification evidence

**`@executable` suite + fitness functions — GREEN.** `node scripts/test.mjs` → **1966 pass /
0 fail** (exit 0); `node scripts/check.mjs` → clean (exit 0). All eleven m26 behavioural
traceability suites pass — story 00 (`run-node-partition` 9, `mesh-sync-root-set` 7,
`add-only` merge 6), story 01 (`mesh-lease-arbitration` 7, `mesh-lease-clock` 8,
`work-next-lease` 7, `mesh-status-lease` 7), story 02 (`run-start-claim`, `run-complete-lease`,
`relay-lease-fastpath`, `fleet-reclaim` — the full dual-staleness decision table, incl. the
never-beat / never-heard / exactly-at-threshold / own-stale rows). The **twelve fitness
functions** are all registered ([scripts/test.mjs:744-806](../../../scripts/test.mjs#L744)) and
green: #1 `acd-run-node-path-single-builder`, #2 `acd-run-record-node-additive`, #3
`acd-runs-eol-pinned`, #4 `acd-run-store-mesh-free`, #5 `acd-sync-root-set`, #6
`acd-lease-write-scope`, #7 `acd-next-lease-injected`, #8 `acd-lease-arbitration-git-observed`,
#9 `acd-claim-relay-independent`, #10 `acd-relay-lease-blind`, #11 `acd-lease-cache-only`, #12
`acd-fleet-reclaim-guarded`. The four re-armed existing gates
(`acd-mesh-sync-record-neutral`, `acd-run-reclaim-stale-only`, `acd-status-rollback-bounded`,
`acd-presence-subscriber-cache-only`) each pass over the modified engine — the "re-arms GREEN"
clause of ADR-002/ADR-004/ADR-006 made concrete.

**Agent-run `@manual` — the KR2 contested soak (story 02 / task 04), on a REAL two-node fleet.**
A soak harness
([scratchpad/kr2-soak.mjs](../../../../../../Users/Umair/AppData/Local/Temp/claude/c--Source-umair-aof/2e5a3591-29bf-4074-8185-f4a39d1c2b82/scratchpad/kr2-soak.mjs))
stood up a shared bare git remote + two clones (`node-a` / `node-b`), each `aof work init`-shaped,
each mesh-configured via `aof mesh identity` (its own pinned `nodeId`), and drove **only the
registered `aof` CLI** over a real git transport — no run record, lease file, or item status ever
hand-edited. Built + first-run by `aof-developer` at N=100; **independently re-run inline at N=15**
(reproduced identically — the evidence is measured, not asserted).

| Procedure (live, real CLI over a real fleet) | Result | verifies → |
| --- | --- | --- |
| **N=100 contested claims** — for each item, `aof work run-start <ref>` launched on BOTH clones as genuinely concurrent OS processes; the durable run records audited across both clones' `runs/<node>/` trees (a double-execution = both nodes mint a run for one item) | **100 contested / 100 winners / 100 stand-downs / 0 double-executions.** Each loser returned the honest `{state:"stood-down", heldBy}` envelope and minted nothing | `02/04` KR2 headline — *100 contested claims, 0 cases of both executing (PRD A2)* |
| **Relay-killed arbitration** (the whole soak ran with **no relay** — the load-bearing half) | Every contested item resolved to exactly one winner **at the git cadence** — losers stood down on git evidence alone; no claim was blocked by the relay's absence | `02/04` relay-killed half — *arbitration stays correct at the git cadence (never blocked)* |
| **Crashed-node reclaim, observed live** — `node-b` mints a `running` run + heartbeats, then is killed (never driven again); after both staleness thresholds lapse, `node-a` heartbeats + `work next` + `run-start` the item | `node-a mesh status` renders the lapsed lease `{itemRef, holder:"node-b", live:false}`; `node-b`'s orphan is force-failed **`runtime_offline`** with a `reclaimedAt` stamp; `node-a`'s new run carries **`retryOf` → the reclaimed run** under `node-a`'s partition; **`node-b`'s claim file is byte-unchanged** (identical sha256 + git-oid before/after — the lease lapsed by rule, never foreign-written) | `02/04` reclaim chain — *kill → stale → reclaim → retry lineage (ADR-006)* |

The KR2 correctness claim (**0 double-executions at N=100**) and the crashed-node reclaim chain
are both directly observed in the run artifacts. The relay-**up** ≤relay-latency defer half of
task 04 scenario 1 was **not** driven — see finding F-26-01 (its mechanism is proven `@executable`
in `relay-lease-fastpath/02`; only the over-the-wire latency measurement is blocked, and it bears
on speed, never on the KR2 safety claim — the milestone's own invariant is that correctness never
depends on the relay).

## Findings

Every automated lane is green and the KR2 soak's load-bearing measurements passed. Three findings
were surfaced during verification (F-26-01/02/03); the five review-time items PO-decided at the
story-02 gate (`STATE §Feedback`) are carried here so `VERIFICATION.md` is the single findings
home. **None blocks acceptance** — no KR2 (correctness) violation is open; every item is a
liveness/fidelity/face gap already routed forward.

| id | observed | type | severity | triage | routed-to | status |
| --- | --- | --- | --- | --- | --- | --- |
| F-26-01 | **No registered `aof` verb launches the long-lived relay broker.** `serveRelay`/`relayMode` ([src/mesh-relay.mjs](../../../src/mesh-relay.mjs)) are instantiated only in tests; `aof mesh relay` is a non-blocking status probe. So the relay-**up** over-the-wire defer-latency half of task 04 scenario 1 cannot be driven end-to-end via the CLI. | gap (missing serve/daemon face) | low | **defer** — non-blocker; correctness never depends on the relay (KR2 proven at the git cadence; the defer mechanism is proven `@executable`). A serve-launcher is a face concern. | m27 / serve-launcher follow-up + retro | open |
| F-26-02 | **No launched mover propagates run records cross-node after they are minted.** `mesh:sync` uses the default root set `[meshDir]` (no runs); `run-start`'s widened `[meshDir, runsPathspec]` sync runs *inside `acquireLease`* — **before** the mint ([run-start.mjs:209-254](../../../src/commands/run-start.mjs#L209)); `run-complete` performs no sync; `startSyncLoop` (the 15s background mover, [mesh-sync.mjs:292](../../../src/mesh-sync.mjs#L292)) is **defined but never launched**. So a minted run reaches peers only on that node's *next* run-start; a silently-crashed node's *final* run may never propagate. The soak observed the ADR-006 cross-node force-fail + `retryOf` only because `node-b` performed one more run-start (propagating the orphan) before the kill. | gap (missing continuous durability mover) | low-moderate | **defer** — non-blocker; the item is never left stuck (the claim lapses by rule → re-leasable; the dead node's own restart scan force-fails its stale run on revival). Only the cross-node reclaim *fidelity* (force-fail + `retryOf`) of an *uncooperative* crash is limited. A5 poll-for-durability wants `startSyncLoop` wired (or a run-complete durability sync). | m27 / serve-launcher follow-up; ADR-002/ADR-006 note (architect) + retro | open |
| F-26-03 | The `aof mesh` usage banner ([src/cli.mjs:466](../../../src/cli.mjs#L466)) still reads "routing only; verbs arrive with later stories" though identity/status/sync/heartbeat/relay/invite/join/revoke/ui are all live. Cosmetic docs drift. | defect (stale help text) | low | **defer** — non-blocker; a one-line copy fix | backlog + retro | open |
| F-26-04 | Ceiling-exhausted reclaim lineage — a poisoned crash-looping item can ping-pong the fleet (attempt reset breaks m20's bounded-intent every `maxAttempts` crashes). A defensible availability trade. | limitation (documented) | low | **defer** — DOCUMENT as an ADR-006 note (architect authors at accept, done below) | ADR-006 note + retro | routed |
| F-26-05 | `uat` / zero-story milestone refs are claimable but never lease-skipped by `next` (both driver ready-returns bypass the `leaseView`). No KR2 exposure; claim-churn at the git cadence on the soak path. | gap (lease-view coverage) | low | **defer** — ADR-005 supersede (leaseView at EVERY ready-return); target verify triage or first m27 item (architect note at accept, done below) | ADR-005 supersede + m27 | routed |
| F-26-06 | Alive-owner orphaned claim — a crash between claim-write and mint + a quick restart (presence never lapses) leaves the own `"claimed"` file live fleet-wide, wedging the item for everyone incl. the owner's own `next` (`withdrawOwnLapsedClaims` never fires on fresh presence). Fails toward nobody-works (not KR2). | limitation (KNOWN m26) | moderate | **defer** — needs an ADR-003.2 supersede (run-start step-0 own-claims-vs-own-runs reconciliation) at retro; the `runId:null` mid-protocol concurrency caveat settled there | ADR-003.2 supersede + retro | routed |
| F-26-07 | Released-claim vs lease-cache overlay — a released disk claim yields no view entry, so a peer's cached "claimed" intent could overlay forever. Latent until m27 wires the subscriber cache into a loop. | gap (cache reconciliation) | low | **defer** — ADR note + fix REQUIRED BEFORE m27 consumes the cache; m27's SPEC inherits this | m27 SPEC inherits + retro | routed |
| F-26-08 | `acquireLease` holds over the `{noop:true, reason:"no-git-repo"}` degrade envelope (a mesh-configured node in a non-repo dir holds a lease on zero sync evidence). | hardening (fail-closed posture) | low | **defer** — backlog; revisit with the affirmative-envelope posture if a real deployment hits it (QA F3) | backlog + retro | open |

## Accept decision

**ACCEPT (milestone).** The `@executable` suite + all twelve fitness functions + the four re-armed
gates are green (**1966 / 0**, `check.mjs` clean); the KR2 `@manual` soak was agent-run and
**inline-re-verified** on a real two-node fleet — **100 contested claims, 0 double-executions**,
plus the full crashed-node reclaim chain (force-fail `runtime_offline` + `reclaimedAt` + `retryOf`
lineage + byte-unchanged dead claim). `aof work validate 26` → **PASS** (`[]`, exit 0; the whole
stream validates clean too), and the layered agent checks hold — **test-traceability** (all eleven
`@executable` suites map to real passing test files) and **litmus** (the twelve structural
invariants live as arch-tests, never as behaviour scenarios). There is **no open blocker finding**: F-26-01/02/03 are low/low-moderate face-and-propagation gaps that do
not touch the KR2 safety claim (correctness never depends on the relay, and the item is never left
stuck), and F-26-04..08 are the PO-decided review deferrals already routed to ADR notes / m27 /
backlog. All three stories are accepted (`status: done`); the milestone is accepted
(`SPEC.md status: done`). The deferred findings + build lessons graduate to `RETROSPECTIVE.md`, and
the durable ADR notes (ADR-005 supersede, ADR-006 ceiling + run-record-propagation note, ADR-003.2
alive-owner note) graduate into `ARCHITECTURE.md` at compaction.
