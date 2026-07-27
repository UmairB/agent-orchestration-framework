# 42 · Structural overhaul — execution roadmap

The checklist view of the inline implementation (operator direction 2026-07-26: implement directly,
outside the aof agent ceremony). [STATE.md](STATE.md) is the running narrative with the full
rationale per landing; [TECH_DEBT.md](../TECH_DEBT.md) is the evidence base. Statuses here are
honest: **done** means committed + unit-verified; live-soak caveats are listed at the bottom.

---

## Wave (a) — stop the bleeding (the verification substrate)

| Leg | Status | Commits | What's left |
|---|---|---|---|
| **Item 5 — the gate gates** | ✅ DONE | `cec520b` | Arch suite at 694/0 across 219 files; dead guards retired with their subjects; bundle counts derived. *Caveat: the FULL suite still can't run on the control node while daemons hold :4182 — focused runs remain the discipline.* |
| **Item 2 — daemon log sink** | ✅ DONE | `b72da09`, `9a9cfe2` + remote commit | JSONL sink (rotating) + warning tee + build-stamped startup for both daemons; `aof mesh logs [proc] [--tail N]` locally. **Remote read DONE:** a worker's log events ride its existing stream into the control's `node_logs` ring (schema v6, T6-attributed, ring-bounded at 500/node); `aof mesh logs --node <id>` answers from the store — no SSH archaeology. `--follow` DESCOPED by decision → the deferred backlog (polling `--tail` covers the need; a follow mode is a CLI nicety, not debt). |
| **Item 3 — silent catches** | ✅ DONE | `cde6407` + sweep commit | Ratchet armed, then **the sweep landed the same day**: all 97 silent sites (the 94 baseline + 3 added since) across 28 files now report coded degrade events via `degrade.mjs` (`reportDegrade` — throttled per code, never-throwing, into the mesh-log sink family as `degrade.log`). The gate's baseline is the sanctioned floor — the reporter + the sink themselves (2 sites) — making it an outright ban everywhere else. 698/0 arch, 159/0 behavioral after the sweep. |
| **m38-F26 — temp-file leak** | ✅ DONE | `dcf04e6` | `writeText` reclaims its temp on rename failure; age-gated startup sweep over presence/ + nodes/; 48 live orphans reclaimed on the control node. |

## Wave (b) — one home, one door

| Leg | Status | Commits | What's left |
|---|---|---|---|
| **One door per act** | ✅ DONE | `42d76e2`, `44fa328`, `a23c50f` + doors commit | `work:continue`, `work:refine`, `work:verify` — ONE factory, one pure decision, one scope rule, three registered doors. Every face is transport: CLI (`aof work <phase> <ref> [--node]`), board POSTs (`/api/work/<phase>`, same-origin-guarded, explicit-allowlisted), the DetailPanel button (refine/verify no longer spawn the local dock on their own authority — the server decides running/local/remote). All registry-derived guards (route bijection, CLI bijection, write-isolation allowlist, known-ids) extended and green. |
| **Item 7 — liveness loop** | ✅ DONE (all 3 legs) | `f4c9689` + leg-2/3 commit | Leg 1: PTY liveness probe (`failed/agent_died` ≤15s after a child dies). Leg 2: worker STARTUP reclaim — persisted worktree dirs (assignment-id-named) are reported `failed/daemon-restarted` before new work; safe by the new apply-seam invariant **a terminal assignment never regresses** (stale/late worker frames refused, reportably). Leg 3: the dual-staleness reclaim was structurally dead for cross-machine runs (local-only run-record read — the control checkout has no `runs/`); it now reads the local record, else the STREAMED v5 `work_item_runs` record, else the assignment's own frozen `updatedAt` as the staleness clock — a worker dead before ever streaming is no longer un-reclaimable. *Live-drill verification still pending (see caveats).* |
| **Item 6 — board bridge** | ✅ DONE | `0f8719e` + mirror commit | Doc bodies + run records ride the projection (schema v5); drill-downs answer from the worker stream — and streamed content PERSISTS after worktree cleanup (the stretch was already covered by the upsert design). **Console leg DONE (reworked at the operator's insistence):** the board has ONE terminal surface — the dock — and a session is either LOCAL (pty, read-write) or REMOTE (the fleet's read-only mirror on fixed :4181). A running item with a captured session offers **View terminal — <node>**, which opens THE DOCK in mirror mode (read-only badge, fixed 80×24, no input path). The first attempt bolted a second terminal widget into the detail panel — the same several-surfaces disease in the UI — and was deleted. |
| **Item 4 — workspace identity** | 🟡 ONE HOME DONE | `ac361f8` + sweep commit | Gate: a launch dir can't publish itself (`mesh-workspace-unconfigured`); `prune-projection.mjs` recovers landed rows. **One home DONE:** `workspace-identity.mjs` owns the derivation + the one precedence (override → pinned config id → path); all 14 hand-spelled `?? workspaceIdFor(...)` fallbacks retired; `acd-workspace-identity-single-home` forbids the pattern re-appearing (raw derivation callable only from the home + the store's compat re-export). **Clone-time pin DONE:** a fresh checkout gets the ASSIGNMENT's canonical id written into its own config (merge-preserving; end-to-end pinned: `resolveWorkspaceId` on the checkout answers the fleet's id on every machine — kills the per-machine divergence class at the source for every FUTURE clone). **cwd-independence DONE:** every mesh verb accepts `--workspace <path|id>` (bare id resolves through the descriptor store; unknown refuses loudly) — verified live from a foreign cwd. **Migration DONE:** the Mac's pre-fix checkout repinned live (`scripts/pin-checkout-id.mjs`: measured `14d86b2b… → 1f164bd0…` — the exact recorded divergence) and its projection's 63 stale old-id rows pruned with the committed tool. **Item 4 complete** pending the Mac daemon restart (it publishes under the pinned id from then on — the `workspace-workdir-unresolvable` spam should end with it). |
| **m38-F23 + F24 — presence/descriptor truth** | ✅ DONE | F23/F24 commit | F23: `fabricLivenessFor` no longer rebuilds the record (the accidental four-key whitelist that destroyed `sessions` for every ONLINE node) — liveness now contributes exactly one fact (alive NOW) and the disk record rides through whole; regression pins sessions surviving the merge for an online node. The shape now has exactly ONE authority (`assemblePresenceRecord`) plus the deliberate wire gate (`applyPresenceFrame`); the accidental third whitelist is gone. F24: a node card's `workspaces` is projected from the MEMBERSHIP table (resolved through workspace descriptors), never the last publisher's descriptor-file stamp — the system32 advertisement class is dead. |

## Wave (c) — the honest build

| Leg | Status | Commits | What's left |
|---|---|---|---|
| **Item 1 — launcher decouple** | ✅ DONE (core) | `ad72943` | `aof.exe` is a payload-first launcher; deploy = file copy + restart; SEA only for bootstrap/release; BUILD_ID stamped + surfaced (`--version`, daemon startup, log sink); `.bak` pruning. **Remote build-id DONE:** the presence record carries `buildId` as its sixth additive key (publisher → wire gate → store → `aof mesh status` node lines show `· build payload <stamp>`) — surviving the liveness merge by construction, F23's fix proving itself on the first new key. **Left (optional):** daemons self-restart when the installed stamp changes — install becomes the whole deploy. |
| **Item 0 — the umbrella closes** | ✅ DONE (measured; convention recorded) | deletion commit | The four disease forms each have their structural cure + a gate that keeps it cured: **one home per fact** (identity: `workspace-identity.mjs` + gate; presence shape: one authority + F23 merge fix; doc set: shared const), **one door per act** (3 phase doors, one factory, faces are transport, 4 gates), **errors are events** (97-site sweep, silent-catch BAN at the 2-site sanctioned floor, sink + remote ring), **the build is honest** (payload launcher, stamps everywhere incl. remote presence). **Deletion tranche:** dead lease wire-kind surface removed (`LEASE_SIGNAL_KIND`/`leaseRelayEnvelope`/`pushLeaseSignal`); dead guards + duplicate derivations already retired in-wave. **Measured vs the baseline:** standing arch failures 10 → **0** (698 green); silent catches 43 (honest count 97) → **2** sanctioned; identity derivations 17 sites → **1 home**; scar markers 1,670 → 1,563. Lines grew (41.3k → 43.3k) — the overhaul added verification surface, and that is the point. **Recorded decision:** the remaining comment-mass reduction is an ongoing convention (scar comments retire as files are touched, with the gates preventing new debt classes), not a blocking work item — grinding 1,500 historical comments in one pass would churn every file for cosmetic gain. |

## Wave (d) — command spine & effects ledger (the cascade seams)

> Scoped 2026-07-27 from the operator's command-layer review ("side effects not happening is the
> biggest problem") + two full codebase maps. The settled design is
> [PRD-command-spine-effects-ledger.md](../../planning/PRD-command-spine-effects-ledger.md); this
> table is its milestone cut. The disease is m42's own class one level deeper: write seams have one
> home (waves (a)–(c)'s win), but **cascade seams have none** — "what must happen after X" lives
> inline at whichever call site needed it first (`completeRun`: 8 sites, exactly 1 does the status
> rollback; global publish is a per-command import decision; reindex renumbers refs that key six
> stores and tells none). Rule three: **one ledger per consequence** — effects are declared, not
> remembered.

| Leg | Status | Commits | What |
|---|---|---|---|
| **d1 — command-spine-faces** | 🔴 NOT BUILT | — | One generic CLI face + a route table derived from `listCommands()`, replacing the nine verbatim face copies and the `if`-ladders; per-command flag specs (retiring the six `*_FLAGS` sets + `parseOptions`' boolean allow-list); one error envelope + exit-code policy, `console.log` confined to the face; the ~45 unregistered verbs become Commands (assets/packages/project first — self-contained); the four upward imports into `commands/` inverted and the `mesh-repo` ↔ `mesh-worker-execution` cycle broken; bijection/route-coverage gates re-derived from the registry instead of grepping the ladder. **No behaviour change.** |
| **d2 — effects-ledger-foundation** | 🔴 NOT BUILT | — | The per-node journal (events + per-reactor steps), `transitionRun` as the ONLY event-raiser, `effects.mjs` (closed vocabulary, locus per reactor), the dispatcher (CLI: sync drain before exit, per-reactor outcomes in the envelope; daemon: converge-tick drain; failures → degrade log, retried, never silent). The run-completion cascade ports end-to-end: all 8 `completeRun` sites become `transition + drain`; `failureReason` carried structurally so resumed failures stay retryable. **Exit drill: kill a worker between transition and settle → the settle lands on the next drain, on the live soak.** |
| **d3 — bridge-facts-and-outbox** | 🔴 NOT BUILT | — | Facts over the bridge: durable outbox (ack/cursor, at-least-once redelivery) for remote-locus steps; `control-stream-server` apply-handlers reduce to guard + append-into-control's-own-journal, whose tick drains the same effects table; directive responses correlated by id (async RPC with a durable receipt); the apply-seam guards (holder, terminal-never-regresses) move inside the shared transition so ALL writers inherit them. Depends d2. |
| **d4 — cascade-ports** | 🔴 NOT BUILT | — | The sweep: publish-on-mutate becomes a `local`-locus reactor (every per-command `withGlobalWorkPropagation` import deleted); the two reclaim implementations unify on one transition edge + shared cascade; insert/reindex emits `stream.reindexed` (run-record refs, Notion sidecar, projection remap — the silent page mis-binding dies); the two `writeLock` bypasses (`aof init`, `project migrate`) adopt read-merge; Notion status sync becomes an `integration:notion` reactor deduped by contentHash. Each port deletes its inline copies and lands the writer-isolation gate for its store. Depends d3. |
| **d5 — fact-projection-split** | 🔴 NOT BUILT | — | Every store declared FACT or PROJECTION; the shared SQLite's derived tables (`work_items`, descriptors) gated from its fact tables (`global_assignments`, directives, branches, recovery pushes) by schema-level classification, not a warning comment; `aof doctor --explain <event>` prints a cascade with loci, `--converge` drains anything pending; the file-store reconciler scan closes the write-vs-append crash window. Depends d4. |

---

## Status: WAVES (a)–(c) DONE (2026-07-26) · LIVE-SOAK FIXES ON BRANCH (2026-07-27) · WAVE (d) SCOPED, NOT BUILT (2026-07-27)

> 2026-07-27: the first full live-soak day surfaced a family of post-overhaul defects (run
> truncation, wrong-base dispatch, ghost run records, unlogged decisions, invisible stops). All
> fixed + verified on branch `fix/worker-completion-and-milestone-cascade` (10 commits, pushed,
> UNMERGED — operator merges). Full ledger, missing tests, and residuals: [STATE.md](STATE.md)
> §"2026-07-27 — the live-soak day".

## Next work (operator-ordered, not yet built)

| Item | Status | What |
|---|---|---|
| **Interactive worker terminals** | ✅ BUILT (`5c03269`) — live drill pending | Shipped exactly to the mapped design: dock keystrokes ride the tuple-bound `/ws/terminal-view` socket → mesh-ui wraps them with THE SOCKET'S OWN tuple (content-blind, bounded) → loopback relay → serve self-subscribed router (`mesh-terminal-input.mjs`) → `terminal-input` DOWN-frame → the worker writes ONLY the exactly-matched live session (`liveSessionInputs`). Gate rewritten as `acd-fleet-terminal-input-constrained` (pins the constrained shape, incl. content-routed and first-live-PTY-fallback plants). **Plus the recorded scope addition that makes it useful:** the pending-AskUserQuestion lane now reports `code: needs-input` immediately (persisted — schema v7), keeps the session ALIVE for the answer, and parks only after the 15-min window; the board renders `Answer on <node>` + "waiting for your input". Focused 89/0, arch 698/0. **Live verification owed:** restart both machines, then answer a real pending question from the dock. |
| **Per-item branch (the brittleness cure)** | 🔴 NOT BUILT — scoped ~half-day | One derivable branch per item (`aof/mesh/<ref>`), the `global_item_branches` side table demoted to cache, and run-settled DOC changes landing on the default branch — so no code path can ever again "forget" where an item's work lives (the 2026-07-27 wrong-base dispatch class dies structurally, and main-based reads stop lying about refined items). |
| **Missing tests for the soak-day fixes** | 🔴 OWED | Nine enumerated lanes in [STATE.md](STATE.md) §MISSING TESTS — the withdraw/settle/ghost-record code shipped under fire and is verified live but not pinned. |

Waves (a)–(c)'s legs are landed, unit-verified, committed to `main`, synced to both machines and
staged in the control node's payload; wave (d) is scoped, designed, and unbuilt. Two items carry recorded scope decisions (`--follow` and the
self-restart leg → the deferred backlog in [../ROADMAP.md](../ROADMAP.md); the comment-mass
convention in item 0's row). What remains below is LIVE verification, which requires operator
restarts and a real dead-run drill — tracked as caveats, not as open work.

## Live-soak caveats (unit-green ≠ running)

- Everything above is staged in the control node's payload (`aof --version` shows the stamp); the
  **desktop-app restart** picks up sink + sweep + all wave-(a) behaviour on this machine.
- The **Mac worker restart** is the one that arms the PTY liveness probe (leg 1 runs there).
- The whole liveness loop gets its real verification the next time a run dies — the sink now records
  what happened, and the probe should flip the assignment within ~15s. Until a real (or provoked)
  dead-run drill passes on the soak, item 7 stays "unproven live".

## Suggested order for what's left

1. Merge the soak-day branch + land the nine owed test lanes ([STATE.md](STATE.md) §MISSING TESTS) —
   pin what shipped under fire before anything moves again.
2. Per-item branch (the brittleness cure, ~half-day) — kills the wrong-base dispatch class
   structurally, independent of wave (d).
3. Wave (d) in leg order d1 → d5: d1 is pure mechanics (safe to interleave with soak operation);
   d2's live kill-drill is the gate the later legs build on; d3–d5 each leave the soak running.
4. The interactive-terminal + liveness live drills (the standing caveats) whenever both machines
   next restart — unchanged by wave (d).
