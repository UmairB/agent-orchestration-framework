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
| **Item 6 — board bridge** | ✅ DONE | `0f8719e` + mirror commit | Doc bodies + run records ride the projection (schema v5); drill-downs answer from the worker stream — and streamed content PERSISTS after worktree cleanup (the stretch was already covered by the upsert design). **Console leg DONE:** the board EMBEDS the worker's read-only mirror (`WorkerMirror` → the fleet's `/ws/terminal-view` on fixed :4181, full (nodeId, sessionId) tuple or nothing per ADR-014 inv.4; xterm at the worker's fixed 80×24, stdin disabled in fact) — the fleet link remains only for pre-session runs. |
| **Item 4 — workspace identity** | 🟡 ONE HOME DONE | `ac361f8` + sweep commit | Gate: a launch dir can't publish itself (`mesh-workspace-unconfigured`); `prune-projection.mjs` recovers landed rows. **One home DONE:** `workspace-identity.mjs` owns the derivation + the one precedence (override → pinned config id → path); all 14 hand-spelled `?? workspaceIdFor(...)` fallbacks retired; `acd-workspace-identity-single-home` forbids the pattern re-appearing (raw derivation callable only from the home + the store's compat re-export). **Clone-time pin DONE:** a fresh checkout gets the ASSIGNMENT's canonical id written into its own config (merge-preserving; end-to-end pinned: `resolveWorkspaceId` on the checkout answers the fleet's id on every machine — kills the per-machine divergence class at the source for every FUTURE clone). **cwd-independence DONE:** every mesh verb accepts `--workspace <path|id>` (bare id resolves through the descriptor store; unknown refuses loudly) — verified live from a foreign cwd. **Migration DONE:** the Mac's pre-fix checkout repinned live (`scripts/pin-checkout-id.mjs`: measured `14d86b2b… → 1f164bd0…` — the exact recorded divergence) and its projection's 63 stale old-id rows pruned with the committed tool. **Item 4 complete** pending the Mac daemon restart (it publishes under the pinned id from then on — the `workspace-workdir-unresolvable` spam should end with it). |
| **m38-F23 + F24 — presence/descriptor truth** | ✅ DONE | F23/F24 commit | F23: `fabricLivenessFor` no longer rebuilds the record (the accidental four-key whitelist that destroyed `sessions` for every ONLINE node) — liveness now contributes exactly one fact (alive NOW) and the disk record rides through whole; regression pins sessions surviving the merge for an online node. The shape now has exactly ONE authority (`assemblePresenceRecord`) plus the deliberate wire gate (`applyPresenceFrame`); the accidental third whitelist is gone. F24: a node card's `workspaces` is projected from the MEMBERSHIP table (resolved through workspace descriptors), never the last publisher's descriptor-file stamp — the system32 advertisement class is dead. |

## Wave (c) — the honest build

| Leg | Status | Commits | What's left |
|---|---|---|---|
| **Item 1 — launcher decouple** | ✅ DONE (core) | `ad72943` | `aof.exe` is a payload-first launcher; deploy = file copy + restart; SEA only for bootstrap/release; BUILD_ID stamped + surfaced (`--version`, daemon startup, log sink); `.bak` pruning. **Remote build-id DONE:** the presence record carries `buildId` as its sixth additive key (publisher → wire gate → store → `aof mesh status` node lines show `· build payload <stamp>`) — surviving the liveness merge by construction, F23's fix proving itself on the first new key. **Left (optional):** daemons self-restart when the installed stamp changes — install becomes the whole deploy. |
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
