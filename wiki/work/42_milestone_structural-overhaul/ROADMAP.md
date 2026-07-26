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
| **Item 2 — daemon log sink** | ✅ DONE (local) | `b72da09`, `9a9cfe2` | JSONL sink (rotating) + warning tee + build-stamped startup for both daemons; `aof mesh logs [proc] [--tail N]`. **Left:** remote read (`--node <id>` over the fabric) + `--follow` (task #15). |
| **Item 3 — silent catches** | 🟡 RATCHET ARMED | `cde6407` | `acd-no-new-silent-catch`: 94 sites / 29 files pinned as a shrink-only baseline — any NEW silent catch fails the build today. **Left: the sweep** — convert the 94 to coded events into the sink, file-by-file, until the baseline is zero and the gate becomes a ban. |
| **m38-F26 — temp-file leak** | ✅ DONE | `dcf04e6` | `writeText` reclaims its temp on rename failure; age-gated startup sweep over presence/ + nodes/; 48 live orphans reclaimed on the control node. |

## Wave (b) — one home, one door

| Leg | Status | Commits | What's left |
|---|---|---|---|
| **One door per act** | 🟡 PARTIAL | `42d76e2`, `44fa328`, `a23c50f` (pre-42 + early-42) | `work:continue` is the pattern: single door, pure unit-tested decision, EXECUTION-SCOPE rule (a story routes with its milestone; running work is watched, not restarted), overlay-last list pipeline. **Left:** the same door + scope treatment for **refine** and **verify**; the board/fleet faces reduced to transport for them. |
| **Item 7 — liveness loop** | ✅ DONE (all 3 legs) | `f4c9689` + leg-2/3 commit | Leg 1: PTY liveness probe (`failed/agent_died` ≤15s after a child dies). Leg 2: worker STARTUP reclaim — persisted worktree dirs (assignment-id-named) are reported `failed/daemon-restarted` before new work; safe by the new apply-seam invariant **a terminal assignment never regresses** (stale/late worker frames refused, reportably). Leg 3: the dual-staleness reclaim was structurally dead for cross-machine runs (local-only run-record read — the control checkout has no `runs/`); it now reads the local record, else the STREAMED v5 `work_item_runs` record, else the assignment's own frozen `updatedAt` as the staleness clock — a worker dead before ever streaming is no longer un-reclaimable. *Live-drill verification still pending (see caveats).* |
| **Item 6 — board bridge** | 🟡 PARTIAL | `0f8719e` (pre-42) | Doc bodies + run records ride the projection (schema v5); drill-downs answer from the worker stream. **Left: the console leg** — the board embeds the fleet's live session mirror instead of linking out; (stretch) run-record streaming for COMPLETED runs after worktree cleanup. |
| **Item 4 — workspace identity** | 🟡 GATED, NOT REBUILT | `ac361f8` | The bleeding is stopped: a launch directory can no longer publish itself as a workspace (`mesh-workspace-unconfigured` refusal), and `scripts/prune-projection.mjs` recovers rows that landed. **Left (the real rebuild):** ONE identity module; `mesh.workspaceId` written into scoped checkouts at clone so every machine speaks one id per repo; migration for the duplicate ids already in projections; retire the ~17 per-site `?? workspaceIdFor(...)` fallbacks; cwd-independent CLI workspace resolution (the withdraw-from-wrong-dir bite); **m38-F24** — a node descriptor's `workspaces[]` from the membership table, not publisher-stamped. |
| **m38-F23 — presence one home** | ❌ NOT STARTED | — | One shape/merge home so `assemblePresenceRecord` / `applyPresenceFrame` / `fabricLivenessFor` cannot disagree (today `fabricLivenessFor` destroys `sessions` for every ONLINE node → desktop fleet reads idle during live work). Plus the fitness pin: every additive presence key survives the liveness merge. |

## Wave (c) — the honest build

| Leg | Status | Commits | What's left |
|---|---|---|---|
| **Item 1 — launcher decouple** | ✅ DONE (core) | `ad72943` | `aof.exe` is a payload-first launcher; deploy = file copy + restart; SEA only for bootstrap/release; BUILD_ID stamped + surfaced (`--version`, daemon startup, log sink); `.bak` pruning. **Left:** a REMOTE node's build id in `aof mesh status`; (optional) daemons self-restart when the installed stamp changes — install becomes the whole deploy. |
| **Item 0 — the deletion pass** | ❌ NOT STARTED | — | Retire scar comments / dead fallbacks / duplicate derivations made obsolete by the waves above, measured against the baseline (1,670 scar markers, 31% comment ratio, 147 files / 41k lines). Runs LAST — deletions are only safe once their causes are gone. |

---

## Live-soak caveats (unit-green ≠ running)

- Everything above is staged in the control node's payload (`aof --version` shows the stamp); the
  **desktop-app restart** picks up sink + sweep + all wave-(a) behaviour on this machine.
- The **Mac worker restart** is the one that arms the PTY liveness probe (leg 1 runs there).
- The whole liveness loop gets its real verification the next time a run dies — the sink now records
  what happened, and the probe should flip the assignment within ~15s. Until a real (or provoked)
  dead-run drill passes on the soak, item 7 stays "unproven live".

## Suggested order for what's left

1. Item 7 legs 2–3 (startup reclaim + control staleness) — completes the biggest flakiness source.
2. F23 presence one-home + F24 descriptor workspaces — the desktop fleet stops lying about idle.
3. Item 4's identity rebuild (one module, clone-time id, migration, call-site retirement).
4. Refine/verify doors (the one-door completion).
5. Item 3's sweep to zero + item 6 console leg + item 1's remote build-id — steady background slices.
6. Item 0's deletion pass, measured, last.
