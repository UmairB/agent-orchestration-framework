// src/mesh-assignment-reclaim.mjs — the CONTROL-side dual-staleness reclaim path
// (milestone 35 / story 02, ADR-005, task 04). A non-terminal assignment is
// reclaimed to `reclaimed` ONLY when BOTH clocks agree the target worker is gone:
// presence stale (`isNodeStale`, IMPORTED from mesh-presence, default 90s) AND the
// linked run's heartbeat stale (`isStale`, IMPORTED from run-store, the m20
// `work.autonomous.heartbeatStaleMs` 15m default) — both strict `>`. This is
// `reclaimed`'s SOLE producer (assignment-record.mjs's ASSIGNMENT_STATE_PRODUCERS:
// "the control reclaim path").
//
// SEMANTICS mined from `reference/retired-dispatch-tests/fleet-orphan-reclaim.mjs`
// (the git-observed LEASE mechanism is discarded per ADR-003/005 — only the decision
// table transfers): presence has PRECEDENCE (fresh presence is hands-off even with a
// stale heartbeat — the worker is alive, the run is just quiet); NO presence record is
// UNKNOWN liveness, NOT staleness (the m23/KR2 guard — never reclaim a possibly-live
// peer); exactly-AT the presence threshold is still LIVE (strict `>`).
//
// BOTH staleness predicates are IMPORTED and SHARED, never re-derived (fitness #10
// acd-assignment-reclaim-dual-staleness) — this module holds no parallel heartbeat
// definition.
import { isNodeStale, readPresenceRecord, DEFAULT_PRESENCE_STALENESS_SECONDS } from "./mesh-presence.mjs";
import { isStale, readRuns, applyTransition } from "./run-store.mjs";
import { findWork } from "./work.mjs";
import { updateAssignmentState, isActiveAssignmentState, listAllAssignments } from "./assignment-record.mjs";
// milestone 35 / ADR-008 — runControlDispatchReclaimTick (bottom of this file) is the
// control-side driver's DATA-LAYER orchestrator: it owns the ONE store-open call for
// BOTH halves (dispatch scan + reclaim), so mesh-launcher.mjs itself never imports
// global-work-store.mjs / openGlobalWorkProjectionStore directly (fitness
// acd-global-publisher-single-seam — the launcher reaches the global store only
// through a sanctioned seam, never the SQLite store module itself).
import { openGlobalWorkProjectionStore, readWorkItemRuns } from "./global-work-store.mjs";
// VERIFICATION (UI phase selection, 2026-07-25) — the per-assignment phase directive
// (which lifecycle command the worker runs). The dispatch call site below reads the
// operator-chosen phase from the additive side-table and maps it to the command string;
// the refine default above delegates to the SAME mapper.
import { readAssignmentPhase, assignmentDirectiveCommand, phaseRunsOnItemBranch, readItemBranch, DEFAULT_ASSIGNMENT_PHASE } from "./mesh-assignment-directive.mjs";
// m42 item 3 — a log-channel fault is reported, never thrown into the tick.
import { reportDegrade } from "./degrade.mjs";

// The PRODUCTION row source: every assignment row for `workspaceId`, off the SAME
// bulk reader story 03's status shape already uses (no second query surface).
function defaultListAssignments(store, workspaceId) {
  return listAllAssignments(store).filter((row) => row.workspaceId === workspaceId);
}

// defaultAssignmentDirectiveCommand(itemRef) — milestone 38 / story 05 (ADR-013): the
// DOCUMENTED DEFAULT whole command string dispatched with a directive when the operator
// chose NO explicit phase. Every dispatch names the first phase of the full lifecycle,
// `/aof:refine <ref> --autonomous`, exactly ADR-013's own worked example — the worker
// types EXACTLY this into its interactive session's PTY stdin
// (mesh-worker-execution.mjs's driveInteractiveClaudeSession).
//
// VERIFICATION (UI phase selection, 2026-07-25) — the "later story's concern" the
// original comment named has arrived: the operator can now pick refine/continue/verify
// in the UI, persisted per-assignment in the additive `global_assignment_directives`
// side-table (mesh-assignment-directive.mjs — the assignment record stays FROZEN, so the
// phase never lives on it). The dispatch call site below reads that phase and maps it via
// `assignmentDirectiveCommand`; this default is the fallback when a row is absent (a CLI
// `aof mesh assign` with no phase), delegating to the SAME mapper's refine case so the
// two paths can never drift.
function defaultAssignmentDirectiveCommand(itemRef) {
  return assignmentDirectiveCommand(DEFAULT_ASSIGNMENT_PHASE, itemRef);
}

// The documented default run-heartbeat staleness threshold (ms) — the SAME m20
// `work.autonomous.heartbeatStaleMs` default `commands/run-start.mjs` already uses
// for the restart-time reclaim scan (never a second, drifting definition).
export const DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS = 15 * 60 * 1000;

// nonTerminalAssignments(rows) — the assignment-record ACTIVE-state partition
// (assigned/accepted/running) restated as a filter; a terminal row (done/failed/
// withdrawn/reclaimed) is never a reclaim candidate.
function nonTerminalAssignments(rows) {
  return rows.filter((row) => isActiveAssignmentState(row.state));
}

// dualStalenessDecision({ presence, heartbeatAt }, nowMs, thresholds) → boolean — the
// ONE decision predicate the scenario outline's 6 rows exercise, ANDing the two
// IMPORTED predicates. `presence` is the raw presence record (or null — no record
// exists); `heartbeatAt` is the linked run's heartbeat/updatedAt stamp.
export function dualStalenessDecision({ presence, heartbeatAt }, nowMs, { presenceThresholdMs, heartbeatThresholdMs }) {
  // No presence record ⇒ UNKNOWN liveness, NOT staleness (m23/KR2) ⇒ hands-off.
  if (presence == null || typeof presence.heartbeatAt !== "string") return false;
  const presenceStale = isNodeStale(presence, nowMs, presenceThresholdMs);
  // Presence precedence: fresh presence is hands-off REGARDLESS of the heartbeat.
  if (!presenceStale) return false;
  const runStale = isStale({ heartbeatAt }, nowMs, heartbeatThresholdMs);
  return runStale;
}

// reclaimStaleAssignments(store, workspace, workspaceId, options) — the scan: every
// non-terminal assignment row for `workspaceId`, joined to its target's presence
// record and its linked run's heartbeat, reclaimed under dual staleness. Returns the
// list of reclaimed assignment records (post-write). `now`/thresholds are INJECTED
// (the 22/R2 clock discipline) — this module reads no wall clock beyond the top-level
// default parameter.
//
//   store            — the opened global-work-store handle (assignment-record.mjs's
//                       writers operate on it directly).
//   workspace         — the loaded workspace (work.mjs shape: { workDir, … }) used to
//                       resolve each assignment's itemRef to its item.dir (readRuns
//                       needs the item, not just the ref) via findWork.
//   workspaceId       — narrows the scan to this workspace's assignment rows.
//   listAssignments   — INJECTED row source: (store, workspaceId) => rows[] (tests
//                       inject a scoped list; production passes a thin wrapper over
//                       listAllAssignments filtered to workspaceId — kept injectable
//                       so a test never needs every workspace seeded).
export async function reclaimStaleAssignments(store, workspace, workspaceId, options = {}) {
  const {
    now = new Date().toISOString(),
    presenceThresholdSeconds = DEFAULT_PRESENCE_STALENESS_SECONDS,
    heartbeatThresholdMs = DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS,
    listAssignments = defaultListAssignments,
  } = options;
  const nowMs = Date.parse(now);
  const presenceThresholdMs = presenceThresholdSeconds * 1000;

  const rows = nonTerminalAssignments(await listAssignments(store, workspaceId));
  const reclaimed = [];
  const presenceCache = new Map();

  for (const row of rows) {
    if (row.runId == null) continue; // no run minted yet (still `assigned`) — the dispatch retry loop owns that state

    const matches = await findWork(workspace.workDir, row.itemRef);
    const item = matches.find((m) => m.ref === row.itemRef) ?? matches[0] ?? null;

    // m42 wave (b) / item 7 leg 3 — THE RUN RECORD, WHEREVER IT ACTUALLY IS. The
    // original read was local-only (`readRuns(item)` against THIS checkout), and a
    // cross-machine run's record lives on the WORKER — the control checkout has no
    // runs/ by construction — so `run == null` skipped EVERY mesh assignment and the
    // dual-staleness reclaim was structurally dead for exactly the case it exists
    // for (measured live: a dead run sat `running` 25+ minutes, recovered by hand).
    // Order of truth: the LOCAL record (single-machine runs, unchanged behaviour),
    // else the STREAMED record (schema v5's work_item_runs — the worker's own run
    // records ride the projection while it works), else NO record at all — in which
    // case the ASSIGNMENT's own updatedAt is the staleness clock (it froze when the
    // worker last reported; a worker that died before ever streaming must not be
    // un-reclaimable forever).
    const localRuns = item != null ? await readRuns(item) : [];
    const localRun = localRuns.find((r) => r.runId === row.runId) ?? null;
    const streamedRun = localRun == null
      ? readWorkItemRuns(store, row.workspaceId ?? workspaceId, row.itemRef)
          .map((entry) => entry.record)
          .find((record) => record?.runId === row.runId) ?? null
      : null;
    const run = localRun ?? streamedRun;
    if (run != null && run.state !== "running") continue; // already terminal — never a reclaim candidate

    if (!presenceCache.has(row.targetNodeId)) {
      presenceCache.set(row.targetNodeId, await readPresenceRecord(workspace, row.targetNodeId));
    }
    const presence = presenceCache.get(row.targetNodeId);

    const shouldReclaim = dualStalenessDecision(
      { presence, heartbeatAt: run?.heartbeatAt ?? run?.updatedAt ?? row.updatedAt },
      nowMs,
      { presenceThresholdMs, heartbeatThresholdMs },
    );
    if (!shouldReclaim) continue;

    // Force-fail the run runtime_offline, retryable (reusing the EXACT applyTransition
    // edge reclaimStaleRuns itself uses — the single source of "how a run is
    // reclaimed", never a second write path). LOCAL records only: a streamed record
    // is the worker's own disk state mirrored here — the control cannot transition a
    // file on another machine, and the assignment write below IS the control-side
    // fact the fleet/board read.
    if (localRun != null && item != null) {
      await applyTransition(item, localRun.runId, "failed", {
        now,
        failureReason: "runtime_offline",
        reclaimedAt: now,
      });
    }

    const updated = updateAssignmentState(store, row.assignmentId, "reclaimed", { now, reclaimedAt: now });
    if (updated) reclaimed.push(updated);
  }

  return reclaimed;
}

// runControlDispatchReclaimTick(ws, streamServer, options) — milestone 35 / ADR-008:
// the control-side driver's ONE tick body, called from mesh-launcher.mjs's control-
// tick ticker callback. Owns the ONE store-open for both halves:
//   (1) DISPATCH — scans global_assignments for `assigned` rows whose targetNodeId is
//       a currently-connected admitted peer in streamServer.directiveTargets, and
//       dispatchDirective(buildDirectiveFrame(row)) each over the ADR-002 channel — at
//       most once per assignmentId per launcher lifetime (options.dispatchedIds, a
//       caller-held Set so the once-guard survives across ticks; NOT persisted).
//   (2) RECLAIM — calls reclaimStaleAssignments(store, ws, workspaceId, { now })
//       VERBATIM (ADR-005's decision, never re-derived).
// `options.openStore` defaults to openGlobalWorkProjectionStore (this module's own
// import — the launcher itself never imports it, keeping acd-global-publisher-
// single-seam intact). `options.buildDirectiveFrame` is INJECTED (default the real
// control-stream-server.mjs export) so this module does not import that module at
// the top level either (it only needs the pure frame-shape function, handed in by
// the ONE caller — mesh-launcher.mjs — that already imports it for the worker-side
// wiring, avoiding a needless new cross-module edge here).
export async function runControlDispatchReclaimTick(ws, streamServer, options = {}) {
  const {
    workspaceId,
    now = new Date().toISOString(),
    openStore = openGlobalWorkProjectionStore,
    storeOptions = {},
    buildDirectiveFrame,
    dispatchedIds = new Set(),
  } = options;

  const store = await openStore(storeOptions);
  try {
    const rows = await listAllAssignments(store);
    for (const row of rows) {
      if (row.state !== "assigned") continue;
      if (dispatchedIds.has(row.assignmentId)) continue;
      const connected = streamServer?.directiveTargets?.get?.(row.targetNodeId) != null;
      if (!connected) {
        const seen = streamServer?.directiveTargets?.entries?.() ?? null;
        console.error(`[mesh-dispatch] assignment ${row.assignmentId} (${row.itemRef}) -> ${row.targetNodeId}: not connected; currently tracked targets: ${seen != null ? JSON.stringify(seen) : "n/a"}`);
        continue;
      }
      // review fix (live soak, 2026-07-17): the dispatch RESULT must gate the
      // once-guard — dispatchDirective/sendDirective checks the socket's readyState
      // and reports `{ sent: false }` on a target that's present in the map but not
      // yet (or no longer) OPEN (e.g. mid-handshake right after a worker reconnect).
      // Marking dispatchedIds unconditionally here meant a send that silently didn't
      // go out was NEVER retried — the row sat "assigned" forever with no further
      // attempt, indistinguishable from a hung/misbehaving worker. Found live: a
      // real assignment stuck for 24h+ despite a confirmed-connected, healthy worker.
      // VERIFICATION (UI phase selection, 2026-07-25) — read the operator-chosen phase
      // for THIS assignment from the additive side-table and map it to the whole command
      // string; absent (a CLI assign, or a legacy row) falls back to the refine default.
      const phase = readAssignmentPhase(store, row.assignmentId);
      const command = phase != null
        ? assignmentDirectiveCommand(phase, row.itemRef)
        : defaultAssignmentDirectiveCommand(row.itemRef);
      // VERIFICATION (continue-on-existing-branch, 2026-07-25; REVISED 2026-07-27) —
      // every non-refine phase runs on the item's EXISTING active branch (the
      // refine's), so its commits accumulate there rather than on a fresh branch off
      // main. The predicate is the ONE HOME in mesh-assignment-directive.mjs — a
      // hand-spelled phase list HERE is exactly how the first `autonomous` dispatch
      // built milestone 18 off main with none of its refined stories (measured
      // 2026-07-27). A refine (or an item with no prior push, readItemBranch → null)
      // carries no baseBranch and the worker branches fresh.
      const baseBranch = phaseRunsOnItemBranch(phase)
        ? readItemBranch(store, row.workspaceId, row.itemRef)
        : null;
      const result = streamServer.dispatchDirective(buildDirectiveFrame(row.targetNodeId, {
        assignmentId: row.assignmentId,
        itemRef: row.itemRef,
        workspaceId: row.workspaceId,
        at: now,
        command,
        baseBranch,
      }));
      if (result?.sent) {
        dispatchedIds.add(row.assignmentId);
        console.error(`[mesh-dispatch] assignment ${row.assignmentId} (${row.itemRef}) -> ${row.targetNodeId}: directive sent`);
        // 2026-07-27 (the wrong-base dispatch) — the DECISION, durably. The line
        // above goes to stderr only and names neither the command nor the base
        // branch, so the one fact that mattered ("what did the tick actually send")
        // was unrecoverable after the fact. This entry rides the launcher's log
        // channel into the durable sink; a sink fault never blocks the dispatch.
        try {
          options.onDispatchLog?.({
            code: "mesh-dispatch",
            level: "info",
            message: `assignment ${row.assignmentId} (${row.itemRef}) -> ${row.targetNodeId}: ${command}${baseBranch != null ? ` on ${baseBranch}` : " (no base branch — worker branches fresh)"}`,
          });
        } catch (error) {
          reportDegrade("mesh-assignment-reclaim", error);
        }
      } else {
        console.error(`[mesh-dispatch] assignment ${row.assignmentId} (${row.itemRef}) -> ${row.targetNodeId}: send did not complete (${result?.code ?? "unknown"}); will retry next tick`);
      }
    }

    // 2026-07-27 (the duplicate-run wall) — WITHDRAW NOTIFY. A withdrawal used to
    // be a control-side row flip the holder never learned about: its session kept
    // running and its run record stayed `running`, walling every future run for
    // the item behind the duplicate-run guard. Each withdrawn row is now notified
    // to its target node exactly once per launcher lifetime (the caller-held
    // `withdrawNotifiedIds` Set, the dispatchedIds discipline); the worker's
    // handler is idempotent, so a post-restart re-notify of an old row is a
    // logged no-op there, never a second effect. Feature-gated on the caller
    // passing the Set — every existing caller/test that doesn't is byte-identical.
    const withdrawNotifiedIds = options.withdrawNotifiedIds;
    if (withdrawNotifiedIds != null) {
      for (const row of rows) {
        if (row.state !== "withdrawn") continue;
        if (withdrawNotifiedIds.has(row.assignmentId)) continue;
        if (streamServer?.directiveTargets?.get?.(row.targetNodeId) == null) continue; // retried once the worker connects
        const result = streamServer.dispatchDirective({
          kind: "withdraw",
          to: row.targetNodeId,
          assignmentId: row.assignmentId,
          itemRef: row.itemRef,
          workspaceId: row.workspaceId,
          runId: row.runId ?? null,
          at: now,
        });
        if (result?.sent) {
          withdrawNotifiedIds.add(row.assignmentId);
          try {
            options.onDispatchLog?.({
              code: "mesh-withdraw-notify",
              level: "info",
              message: `assignment ${row.assignmentId} (${row.itemRef}) -> ${row.targetNodeId}: withdraw notified (run ${row.runId ?? "none"})`,
            });
          } catch (error) {
            reportDegrade("mesh-assignment-reclaim", error);
          }
        }
      }
    }

    return await reclaimStaleAssignments(store, ws, workspaceId, { now });
  } finally {
    store.close?.();
  }
}
