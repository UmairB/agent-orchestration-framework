---
doc: state
---
<!--
  Milestone STATE.md — answers ONE question: where are we, and what happened?
  Owner: product-owner (single writer). Identity is inherited from the folder; the canonical
  status lives on SPEC.md frontmatter and on each STORY.md. This is the running NARRATIVE.
  Compacted at Accept: durable decisions graduate to ADRs / the next SPEC; the blow-by-blow archives.
-->
# 42 · Structural overhaul — one home, one door, no silence — State

## Progress

- Framed 2026-07-26 from TECH_DEBT.md items 0–7 (operator direction: rewrite-to-a-designed-shape
  over further adhoc fixes). Operator direction (2026-07-26 pm): implement INLINE, outside the aof
  agent ceremony — this STATE is the running record.
- **Wave (a) / item 5 DONE (2026-07-26): the arch gate runs at ZERO standing failures** — 694 pass /
  0 fail across all 219 arch files (was 8 standing failures in 3 files). Retired with their dead
  subjects: `acd-sync-root-set` (src/mesh-sync.mjs eliminated by 33/ADR-002) and
  `acd-claim-relay-independent` (lease/claim path superseded by m35 assignments) — both were also
  imported-but-never-registered in scripts/test.mjs, a red gate nobody ran; the run-complete
  lease-release test inside `acd-fleet-reclaim-guarded` retired for the same reason (its three live
  siblings kept). `acd-command-namespace`'s member counts are now DERIVED (declared vs rendered),
  never hard-coded — the count treadmill (21 → red → 23 → red) is gone.
- **Wave (a) / item 2 largely DONE (2026-07-26):** `src/mesh-log.mjs` (JSONL sink, size-rotated,
  tolerant reader) wired into mesh-serve (warning tee + build-stamped daemon-started) and mesh-ui;
  `mesh:logs` registered + `aof mesh logs [proc] [--tail N]` — the derived bijection gate covered
  the new verb with no edit (item 5's payoff, first use). Deferred within item 2: remote-node read
  + --follow. Daemons pick the sink up at the next operator restart.
- **Wave (a) / m38-F26 DONE (2026-07-26):** `writeText`'s failure path now reclaims its own temp
  (error still propagates), and `sweepStaleTempFiles` (age-gated, never touches a live writer's
  fresh temp) runs at mesh-serve startup over presence/ + nodes/, logging reclaims to the sink.
  Measured + reclaimed live on the control node: 42 orphans in presence/, 6 in nodes/ (the earlier
  0-counts were plain `ls` hiding dotfiles — measurement lesson recorded). Mac clean.
- Next in wave (a): item 3 (no-empty-catch fitness + sweep — the sink now exists to emit into);
  then wave (b) starting at item 7 (liveness loop).

## Notes & decisions in flight

- **2026-07-26 (pre-refine) — INHERITED BLOCKER from m38's close: F23, the presence record is rebuilt
  field-by-field at THREE seams and only two know its current shape.** Found and measured at
  `aof:verify 38` (see [38's VERIFICATION.md](../38_milestone_cross-machine-worker-execution/VERIFICATION.md)
  finding **F23**); routed here at the operator's direction so m38 could close, because the defect is
  exactly wave (b)'s thesis — **one home for one derivation** — not another m38 point fix.
  - **The defect.** [`fabricLivenessFor`](../../../src/commands/mesh-identity.mjs#L212-L221) (m33/ADR-002.1)
    synthesises a pseudo presence record for every fabric-**Online** peer carrying only the original m23
    four keys (`nodeId, heartbeatAt, activeRuns, aofVersion`). Its `heartbeatAt` is `now`, so it **always**
    wins `mergePresence` — anything it omits is not merged around, it is destroyed. m38/ADR-001's additive
    fifth key `sessions` is therefore dropped for every remote node, on every tick.
  - **Consequence.** The Rust desktop's only fleet-data command is `aof mesh status --json`
    ([poll.rs](../../../app/desktop/crates/core/src/poll.rs#L20-L22)) and its `current_work()` reads
    `presence.sessions` — so a worker being actively worked on reads **`idle`** on the desktop fleet. The web
    fleet (`/api/mesh/status`, presence read straight off disk) is unaffected.
  - **Measured** (isolated `AOF_GLOBAL_HOME`, real publishers, real `mesh:status` invoke, `ctx.fabricPeers`
    injected): `online:true` → `sessions` **ABSENT** → renders `idle`; `online:false` → `sessions` present →
    renders `working · aof (session)`. **The feature works only while the fabric believes the node is offline.**
  - **What wave (b) owes it.** One home for the presence record's shape, so `assemblePresenceRecord`,
    `applyPresenceFrame` (taught the fifth key by m38's F18) and `fabricLivenessFor` cannot disagree — plus the
    fitness function that pins *every additive presence key survives the fabric-liveness merge* (RED without the
    fix). Field-by-field rebuilds are whitelists, and a whitelist silently drops what it was never told about:
    this same key was destroyed at two different seams, eight days apart, by two separate blockers.
  - **Also inherited (non-blocking, same class):** m38's **F24** — a node descriptor's `workspaces[]` is the
    *publisher's* single workspace stamped onto every node in the roster
    ([global-node-registry.mjs](../../../src/global-node-registry.mjs#L74-L104)), so both live node cards
    advertise `C:\WINDOWS\system32` (the macOS worker included) while the SQLite membership table correctly
    holds four per node — and after `ac361f8`'s cwd-phantom gate an install-dir-launched daemon can no longer
    refresh its node record to correct it. This is debt item 4's (workspace identity) live bite.
  - **And m38's F26** — the atomic presence/node publish leaks its temp file: 39 orphaned `.tmp-*` files in
    `~/.aof/mesh/presence/` + 6 in `nodes/`, newest from the running daemon (two `aof` processes publish
    concurrently; a lost rename race leaves the temp behind and nothing sweeps it). Wave (a)'s "no silence"
    territory.

- 2026-07-26 (pre-refine): the one-door rule gained its EXECUTION-SCOPE leg (operator-found
  defect: a story's Continue ran locally while its milestone ran on a worker — the door looked up
  execution by exact ref, but runs/branches/worktrees are recorded at the TOP-LEVEL item). One rule
  in one home (`executionScopeRef`/`resolveScopedExecution`, board-mesh-execution.mjs) consumed by
  BOTH the continue decision (now pure + unit-tested; third answer `running` = watch, don't
  restart; remote dispatch always at scope ref) and the row overlay (story rows inherit execution →
  the affordance disables Continue with "Running on <node>"). Wave (b) must generalise this scope
  rule to refine/verify when they get their doors.
- 2026-07-26 (pre-refine): debt item 1's core was paid down — `aof.exe` is now a payload-first
  launcher (sea-entry bootstrap; verified `import()` of external ESM works inside this SEA recipe),
  install-local defaults to a payload file-copy deploy (`--sea` only for launcher/release builds),
  BUILD_ID stamped + surfaced (`--version`, daemon startup lines), `.bak` pruning. Remaining for
  wave (c): remote build-id in `aof mesh status`. Refine should fold this in, not re-plan it.
- 2026-07-26 (pre-refine): debt item 6's doc/run legs were paid down ahead of the milestone —
  projection schema v5 (`work_item_docs`/`work_item_runs`), the worker's `worktree-content` frame,
  and the `work:doc`/`work:run-status` projection fallback. Unit-verified only; live two-machine
  verification pending (needs deploy + operator restarts). The board's embedded console leg remains
  for wave (b). Refine should fold this into the wave-(b) story rather than re-planning it.

- Sequencing is load-bearing, not stylistic: wave (a) (logs, no-silent-catch, green gate) is the
  verification substrate — without it, no later rewrite's success is observable. Do not reorder.
- The soak stays up throughout; any stage that would require stopping both nodes needs a re-think
  before it needs a schedule.

## Verification

<!-- Pointers, not restatements. -->
- [ ] `@executable` suite green
- [ ] Fitness functions green
- [ ] `@manual` signed off — see `UAT.md`
