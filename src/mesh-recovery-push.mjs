// src/mesh-recovery-push.mjs — the CONTROL-DRIVEN recovery push (VERIFICATION, live
// two-machine soak 2026-07-25). Story 07 (ADR-015) taught the worker to push its
// branch home ON its OWN push seam — but ONLY while the assignment is still ACTIVE
// (the write-credential PULL is holder+active-state gated, SECURITY T6/F16). When a
// worker STALLS (interactive `claude` parks at an idle prompt so `term.onExit` never
// fires — the exact live-soak defect) or an assignment is otherwise left terminal with
// its diff stranded UNCOMMITTED in the worktree, there is no active flow left to do the
// pulling: the work sits on the worker's disk and never reaches origin (measured: a
// full refine — 7 stories + ADRs + ~180KB of docs — stuck on the Mac; the board read
// "not-started" over completed work).
//
// This is the OPERATOR-DRIVEN recovery path: `aof mesh recover-push <assignmentId>`,
// run on the CONTROL node. The operator running it on the control node IS the
// authorization (there is no worker-initiated request here, and therefore no
// active-state gate — recovery exists PRECISELY to rescue a terminal/stalled
// assignment's work). The token is NEVER persisted (the whole ADR-015 discipline): the
// store carries only the REQUEST + its status; the daemon mints a fresh short-lived
// write credential and hands it to the worker over the SAME tailnet fabric channel the
// write-credential reply already rides, one-shot.
//
// THE SHAPE mirrors the established store-first dispatch (mesh-assignment-reclaim.mjs):
//   1. the CLI writes a `requested` row here (a plain local store write — only a local
//      operator on the control node can do this),
//   2. the control daemon's tick (runRecoveryPushDispatchTick, below) drains `requested`
//      rows whose target worker is a currently-connected admitted peer, MINTS the write
//      credential (the injected control-side mint — the App private key lives on control
//      only) and dispatches a `recovery-push` DOWN-frame carrying it, marking the row
//      `dispatched`,
//   3. the worker commits + pushes its worktree and replies with a `recovery-push-result`
//      UP-frame (worker-stream-client / mesh-worker-execution),
//   4. applyRecoveryPushResultFrame (below) flips the row `pushed`/`failed`,
//   5. the CLI polls the row to a terminal state and prints pushed / failed.
//
// THE STORE SURFACE is a NEW, ADDITIVE table (global_recovery_pushes) created LAZILY
// here via `CREATE TABLE IF NOT EXISTS` — it is operator/worker-CREATED state, never a
// projection of any doc, so (exactly like global_assignments) publishWorkspaceSnapshot
// must never touch it. Creating it here rather than in global-work-store.mjs's migrate
// keeps the feature self-contained and needs no schema-version bump (the table is a
// pure add; every accessor ensures it first).
//
// This module's ONLY top-level import is meshItemBranchName (a pure string helper) —
// the heavier global-work-store is pulled in LAZILY inside the dispatch tick's default
// openStore, so worker-stream-client.mjs can import the wire-kind literals + the result
// frame builder from here (the ONE contract home) without dragging sqlite into the
// transport leaf.
import { meshItemBranchName } from "./mesh-worktree.mjs";
// VERIFICATION (continue-on-existing-branch, 2026-07-25) — a successful recovery push is
// also a successful push: record the pushed branch as the item's active branch so a later
// continue/verify reuses it.
import { setItemBranch, readItemBranch } from "./mesh-assignment-directive.mjs";

// THE DOWN- and UP-frame kinds (the single source of both literals — imported by
// worker-stream-client.mjs's receive branch and control-stream-server.mjs's dispatch,
// never re-spelled at a call site).
export const RECOVERY_PUSH_KIND = "recovery-push";
export const RECOVERY_PUSH_RESULT_KIND = "recovery-push-result";

// The request lifecycle states — `requested` is the ONLY state the dispatch tick acts
// on; `dispatched` is in-flight (awaiting the worker's result frame); `pushed`/`failed`
// are terminal (the CLI's poll target). Re-requesting an assignment (a re-run of the
// CLI) resets it to `requested` via requestRecoveryPush's INSERT OR REPLACE.
export const RECOVERY_PUSH_REQUESTED = "requested";
export const RECOVERY_PUSH_DISPATCHED = "dispatched";
export const RECOVERY_PUSH_PUSHED = "pushed";
export const RECOVERY_PUSH_FAILED = "failed";

function isRecoveryPushState(value) {
  return value === RECOVERY_PUSH_REQUESTED
    || value === RECOVERY_PUSH_DISPATCHED
    || value === RECOVERY_PUSH_PUSHED
    || value === RECOVERY_PUSH_FAILED;
}

// ensureRecoveryPushTable(store) — the lazy, idempotent DDL every accessor runs first.
// A plain `CREATE TABLE IF NOT EXISTS` (auto-committed DDL, safe to repeat) so a store
// opened by ANY seam gains the table on first recovery use without a migrate/version
// interaction. Keyed by assignment_id — at most one recovery request in flight per
// assignment; a re-request replaces the prior row (INSERT OR REPLACE below).
export function ensureRecoveryPushTable(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS global_recovery_pushes (
      assignment_id TEXT PRIMARY KEY,
      item_ref TEXT NOT NULL,
      workspace_id TEXT NOT NULL,
      target_node_id TEXT NOT NULL,
      state TEXT NOT NULL,
      detail TEXT,
      requested_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function mapRow(row) {
  if (row == null) return null;
  return {
    assignmentId: row.assignment_id,
    itemRef: row.item_ref,
    workspaceId: row.workspace_id,
    targetNodeId: row.target_node_id,
    state: row.state,
    detail: row.detail ?? null,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}

// requestRecoveryPush(store, { assignmentId, itemRef, workspaceId, targetNodeId, now })
// — the CLI's write. INSERT OR REPLACE: a re-request of the SAME assignment resets a
// stuck `dispatched`/terminal row back to `requested` (so a re-run of the CLI re-drives
// the whole flow), preserving nothing of the prior attempt but the row's own key.
export function requestRecoveryPush(store, { assignmentId, itemRef, workspaceId, targetNodeId, now } = {}) {
  ensureRecoveryPushTable(store);
  const at = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();
  store.db.prepare(`
    INSERT INTO global_recovery_pushes
      (assignment_id, item_ref, workspace_id, target_node_id, state, detail, requested_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(assignment_id) DO UPDATE SET
      item_ref = excluded.item_ref,
      workspace_id = excluded.workspace_id,
      target_node_id = excluded.target_node_id,
      state = excluded.state,
      detail = NULL,
      requested_at = excluded.requested_at,
      updated_at = excluded.updated_at
  `).run(assignmentId, itemRef, workspaceId, targetNodeId, RECOVERY_PUSH_REQUESTED, at, at);
  return readRecoveryPush(store, assignmentId);
}

export function readRecoveryPush(store, assignmentId) {
  ensureRecoveryPushTable(store);
  return mapRow(store.db.prepare("SELECT * FROM global_recovery_pushes WHERE assignment_id = ?").get(assignmentId));
}

// listRecoveryPushRequests(store) — the tick's drain source: every row still in
// `requested` (never a `dispatched`/terminal row — those are in-flight or done).
export function listRecoveryPushRequests(store) {
  ensureRecoveryPushTable(store);
  return store.db.prepare("SELECT * FROM global_recovery_pushes WHERE state = ?").all(RECOVERY_PUSH_REQUESTED).map(mapRow);
}

// markRecoveryPushState(store, assignmentId, state, { now, detail }) — the SOLE state
// writer. An unknown state is refused (never a silent bad write); `detail` carries the
// failure code / branch note the CLI surfaces. A no-op (returns null) when the row is
// gone (a request cleared out from under an in-flight result — never a crash).
export function markRecoveryPushState(store, assignmentId, state, { now, detail } = {}) {
  ensureRecoveryPushTable(store);
  if (!isRecoveryPushState(state)) {
    throw Object.assign(new Error(`unknown recovery-push state "${state}"`), { code: "recovery-push-state-invalid" });
  }
  const at = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();
  const result = store.db.prepare(
    "UPDATE global_recovery_pushes SET state = ?, detail = ?, updated_at = ? WHERE assignment_id = ?",
  ).run(state, typeof detail === "string" && detail.length > 0 ? detail : null, at, assignmentId);
  return result.changes > 0 ? readRecoveryPush(store, assignmentId) : null;
}

// buildRecoveryPushFrame(to, { assignmentId, itemRef, workspaceId, branch, credential,
// at }) — the DOWN-frame the daemon dispatches to the target worker. Carries the freshly
// minted write credential (plaintext over the tailnet, exactly like the write-credential
// reply frame — the fabric IS the trust boundary, 33/ADR-002; the token is one-shot and
// never persisted). `credential` may be null (an unauthenticated push against a
// public/keychain-served remote — the same "no mint configured" path the write-credential
// reply allows).
export function buildRecoveryPushFrame(to, { assignmentId, itemRef, workspaceId, branch, credential = null, at } = {}) {
  return {
    kind: RECOVERY_PUSH_KIND,
    to,
    assignmentId,
    itemRef,
    workspaceId,
    branch,
    credential: typeof credential === "string" && credential.length > 0 ? credential : null,
    at,
  };
}

// buildRecoveryPushResultFrame(nodeId, assignmentId, { ok, code, branch, now }) — the
// worker's UP-reply (built in worker-stream-client, re-exported here so the frame shape
// has ONE home). `code`/`branch` are additive, present only when supplied.
export function buildRecoveryPushResultFrame(nodeId, assignmentId, { ok, code, branch, now } = {}) {
  const frame = { kind: RECOVERY_PUSH_RESULT_KIND, nodeId, assignmentId, ok: ok === true, at: now };
  if (typeof code === "string" && code.length > 0) frame.code = code;
  if (typeof branch === "string" && branch.length > 0) frame.branch = branch;
  return frame;
}

// applyRecoveryPushResultFrame(store, frame, options) — control's handler for the
// worker's `recovery-push-result` UP-frame (dispatched from control-stream-server's
// applyStreamFrame). AUTHORIZATION reuses the SAME T6 holder discipline every other
// apply* keeps: the CONNECTION's authenticated nodeId (options.nodeId, bound at connect
// time) must be the assignment row's target_node_id — a result on worker-a's socket can
// never settle an assignment held by worker-b, no matter what the frame self-declares.
// Flips the recovery row `pushed`/`failed`.
export function applyRecoveryPushResultFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const connectionNodeId = ownerNode ?? frameNode;
  const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
  if (connectionNodeId == null || assignmentId == null) {
    return { applied: false, skipped: true, code: "recovery-push-result-invalid" };
  }

  const assignment = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId);
  if (!assignment) {
    return { applied: false, skipped: true, code: "recovery-push-result-unknown-assignment" };
  }
  if (assignment.target_node_id !== connectionNodeId) {
    return { applied: false, skipped: true, code: "recovery-push-result-not-holder" };
  }

  const now = options.now ?? new Date().toISOString();
  const state = frame?.ok === true ? RECOVERY_PUSH_PUSHED : RECOVERY_PUSH_FAILED;
  const detail = typeof frame?.code === "string" && frame.code.length > 0
    ? frame.code
    : (typeof frame?.branch === "string" && frame.branch.length > 0 ? `branch ${frame.branch}` : null);
  const updated = markRecoveryPushState(store, assignmentId, state, { now, detail });
  // A successful recovery push landed a real branch home — record it as the item's active
  // branch (keyed by the assignment ROW's own workspace/item), so the next continue/verify
  // reuses it. The branch is derived (the m42 one-branch-per-item name) only when the
  // worker did not echo one (an older worker).
  if (frame?.ok === true) {
    const branch = typeof frame?.branch === "string" && frame.branch.length > 0
      ? frame.branch
      : meshItemBranchName(assignment.item_ref);
    setItemBranch(store, assignment.workspace_id, assignment.item_ref, branch, { now });
  }
  return { applied: updated != null, state, assignmentId };
}

// runRecoveryPushDispatchTick(streamServer, options) — the CONTROL daemon's drain,
// called from the SAME control ticker runControlDispatchReclaimTick rides (mesh-launcher).
// Owns its OWN store-open (mirroring runControlDispatchReclaimTick — the launcher never
// imports the store module directly, acd-global-publisher-single-seam). For each
// `requested` row whose target worker is a currently-connected admitted peer:
//   - MINT the write credential via the injected mintWriteCredential(workspaceId,
//     assignmentId) — the SAME control-side write mint the write-credential PULL uses
//     (the App private key lives on control only). A mint fault marks the row `failed`
//     LOUDLY (operator re-runs) rather than looping forever.
//   - DISPATCH the recovery-push DOWN-frame over streamServer.dispatchDirective (the
//     SAME routing sendDirective enforces: exactly one target socket, connected-checked).
//     A `{ sent:true }` marks the row `dispatched`; a target not (yet) connected leaves
//     the row `requested` to retry next tick (never marked failed for a transient
//     disconnection — the worker may still reconnect).
export async function runRecoveryPushDispatchTick(streamServer, options = {}) {
  const {
    now = new Date().toISOString(),
    openStore,
    storeOptions = {},
    mintWriteCredential,
  } = options;

  const open = openStore ?? (async (opts) => {
    const { openGlobalWorkProjectionStore } = await import("./global-work-store.mjs");
    return openGlobalWorkProjectionStore(opts);
  });
  const store = await open(storeOptions);
  try {
    const requests = listRecoveryPushRequests(store);
    for (const request of requests) {
      const connected = streamServer?.directiveTargets?.get?.(request.targetNodeId) != null;
      if (!connected) {
        console.error(`[mesh-recover-push] ${request.assignmentId} (${request.itemRef}) -> ${request.targetNodeId}: not connected; will retry next tick`);
        continue;
      }

      let credential = null;
      try {
        if (typeof mintWriteCredential === "function") {
          const minted = await mintWriteCredential(request.workspaceId, request.assignmentId);
          credential = typeof minted === "string" && minted.length > 0 ? minted : null;
        }
      } catch (error) {
        markRecoveryPushState(store, request.assignmentId, RECOVERY_PUSH_FAILED, {
          now,
          detail: `mint-failed: ${String(error?.code ?? error?.message ?? error)}`,
        });
        console.error(`[mesh-recover-push] ${request.assignmentId}: write-credential mint failed — marked failed`);
        continue;
      }

      // M42 (the brittleness cure): CACHE-FIRST, derive as the fallback. A pre-cure
      // assignment's stranded worktree sits on its old suffixed branch — only the
      // `global_item_branches` cache remembers that name, so deriving blindly would
      // push the wrong ref. A cache miss derives the item's own one-branch name,
      // which is what every post-cure worktree is on.
      const branch = readItemBranch(store, request.workspaceId, request.itemRef) ?? meshItemBranchName(request.itemRef);
      const frame = buildRecoveryPushFrame(request.targetNodeId, {
        assignmentId: request.assignmentId,
        itemRef: request.itemRef,
        workspaceId: request.workspaceId,
        branch,
        credential,
        at: now,
      });
      const result = streamServer.dispatchDirective(frame);
      if (result?.sent) {
        markRecoveryPushState(store, request.assignmentId, RECOVERY_PUSH_DISPATCHED, { now, detail: `branch ${branch}` });
        console.error(`[mesh-recover-push] ${request.assignmentId} (${request.itemRef}) -> ${request.targetNodeId}: recovery-push dispatched (branch ${branch})`);
      } else {
        console.error(`[mesh-recover-push] ${request.assignmentId} -> ${request.targetNodeId}: dispatch did not complete (${result?.code ?? "unknown"}); will retry next tick`);
      }
    }
  } finally {
    store.close?.();
  }
}
