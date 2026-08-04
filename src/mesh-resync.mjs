// src/mesh-resync.mjs — the RESYNC transport (m43 / story 04, ADR-006 + ADR-010/R4.2).
//
// THE ASK, in one sentence: the operator is looking at a cached copy that has gone stale,
// and wants the node that reported it to push a fresh one. Nothing in this system carried a
// node→node "push me your state" request before this module — every other flow is either a
// periodic tick or a dispatch of WORK. This is the milestone's ONE sanctioned pull, and it
// is operator-initiated by construction: directive 4's "unless something is wrong"
// carve-out, which is why it exists as a door on a stale row and nowhere else.
//
// THE SHAPE is `mesh-recovery-push.mjs`'s, deliberately and verbatim in structure, because
// that flow already solved the same problem (a control-node CLI cannot reach a worker — only
// the always-on control daemon holds a fabric socket):
//   1. the CLI / board face writes a `requested` row here (a plain local store write, which
//      only a local operator on the control node can perform),
//   2. the control daemon's tick (runResyncDispatchTick, below) drains `requested` rows and
//      dispatches a `work-resync` DOWN-frame to the owning node's connected socket, marking
//      the row `dispatched` — DESIGN's **accepted**,
//   3. the worker pushes a fresh snapshot + worktree delta + content frame and replies with
//      a `work-resync-result` UP-frame,
//   4. applyResyncResultFrame (below) flips the row `pushed`/`failed`,
//   5. the caller polls the row to a terminal state within a BOUNDED window and reports.
//
// THE STORE SURFACE is a NEW, ADDITIVE table (global_resync_requests) created LAZILY here
// via `CREATE TABLE IF NOT EXISTS` — operator-CREATED state, never a projection of any doc,
// so (exactly like global_assignments and global_recovery_pushes) the row publisher must
// never touch it. Creating it here rather than in global-work-store.mjs's migrate keeps the
// feature self-contained and needs NO schema-version bump: the table is a pure add and every
// accessor ensures it first.
//
// WHERE IT DIFFERS FROM RECOVERY-PUSH, and why — one difference, and it is the point of the
// feature. Recovery-push leaves a row `requested` when its target is not connected and
// retries every tick, because a stranded worktree must eventually get home whenever the
// worker returns. Resync marks it `failed` with a CODE on the first tick instead: DESIGN's
// "owner unreachable" is a first-class DESIGNED state that the operator is waiting on, and a
// silent retry ladder would turn "the world did not answer" into a spinner that never
// resolves — "no answer" would be structurally guaranteed rather than measured.
//
// This module has NO top-level repo import at all — the store module it needs is pulled in
// LAZILY inside the dispatch tick's default `openStore`, mirroring mesh-recovery-push.mjs —
// so worker-stream-client.mjs and control-stream-server.mjs can import the wire-kind
// literals, the coded outcomes and the frame builders from here (the ONE contract home)
// without dragging sqlite into the transport leaf.

// THE DOWN- and UP-frame kinds (the single source of both literals — imported by
// worker-stream-client.mjs's receive branch and control-stream-server.mjs's apply, never
// re-spelled at a call site).
export const RESYNC_KIND = "work-resync";
export const RESYNC_RESULT_KIND = "work-resync-result";

// The request lifecycle states — `requested` is the ONLY state the dispatch tick acts on;
// `dispatched` is DESIGN's **accepted** (the request reached the owner) and is already a
// terminal answer for the CALL; `pushed`/`failed` are the worker's own verdict. A re-request
// for the same item resets the row to `requested` (requestResync's upsert), so a retry after
// any terminal outcome starts clean — the row is never wedged.
export const RESYNC_REQUESTED = "requested";
export const RESYNC_DISPATCHED = "dispatched";
export const RESYNC_PUSHED = "pushed";
export const RESYNC_FAILED = "failed";

// THE CODED OUTCOMES — the wire contract every face reads, mapped 1:1 onto DESIGN's Resync
// state table so no surface has to invent its own vocabulary:
//
//   resync-requested            → DESIGN "accepted"          (ok, muted acknowledgement)
//   resync-no-owner             → DESIGN "refused"           (DESTRUCTIVE — a fault we own)
//   resync-owner-not-connected  → DESIGN "owner unreachable"  (muted)
//   resync-owner-unreachable    → DESIGN "owner unreachable"  (muted)
//   resync-pending              → DESIGN "no answer"          (muted — the request leg's bound)
//   resync-owner-is-self        → DESIGN "owner unreachable"  (muted — see below)
//
// The tone split is DESIGN's rule and it is load-bearing: MUTED means the world did not
// answer (the cached copy is intact and still the only readable one, so reddening it would
// over-alarm exactly the condition this milestone exists to normalise); DESTRUCTIVE means the
// request was REJECTED. Only `resync-no-owner` is a rejection.
//
// THE FIFTH CODE, and why the first four could not carry it (ADR-014/E2, which overrules the
// build's own earlier judgement). The four above are a WIRE vocabulary — each names the
// outcome of a node→node CALL: there is nobody to ask; we looked for a socket and found none;
// the send did not complete; we asked and waited. A resync of a row THIS node authored makes
// no call at all, so it cannot be an outcome of one. Answering it `resync-owner-not-connected`
// named a connectivity fact that was never tested, and its own message ("there is no peer to
// fetch it from") contradicted the code. The operator consequence is the common case, not an
// exotic one: a control-authored row goes stale exactly when the control's own publish tick
// stops — daemon down, workspace unregistered, publish erroring — and pointing the operator at
// the network for a wholly local condition is the misdiagnosis this milestone exists to end.
// `resync-no-owner` is not the answer either: there IS an owner, and that code is DESIGN's
// DESTRUCTIVE "refused" for a state where nothing was rejected and nothing failed.
export const RESYNC_OK = "resync-requested";
export const RESYNC_NO_OWNER = "resync-no-owner";
export const RESYNC_OWNER_NOT_CONNECTED = "resync-owner-not-connected";
export const RESYNC_OWNER_UNREACHABLE = "resync-owner-unreachable";
export const RESYNC_PENDING = "resync-pending";
export const RESYNC_OWNER_IS_SELF = "resync-owner-is-self";

function isResyncState(value) {
  return value === RESYNC_REQUESTED
    || value === RESYNC_DISPATCHED
    || value === RESYNC_PUSHED
    || value === RESYNC_FAILED;
}

// resyncRequestId(workspaceId, itemRef) — at most ONE resync in flight per cached item, so
// the key is the pair that identifies it. A re-click replaces the prior attempt rather than
// stacking a second one (DESIGN: "exactly ONE resync request left the app across the whole
// episode — no retry ladder and no second cadence").
export function resyncRequestId(workspaceId, itemRef) {
  return `${workspaceId}::${itemRef}`;
}

// ensureResyncTable(store) — the lazy, idempotent DDL every accessor runs first. A plain
// `CREATE TABLE IF NOT EXISTS` (auto-committed DDL, safe to repeat) so a store opened by ANY
// seam gains the table on first resync use with no migrate/version interaction.
export function ensureResyncTable(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS global_resync_requests (
      request_id TEXT PRIMARY KEY,
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
    requestId: row.request_id,
    itemRef: row.item_ref,
    workspaceId: row.workspace_id,
    targetNodeId: row.target_node_id,
    state: row.state,
    detail: row.detail ?? null,
    requestedAt: row.requested_at,
    updatedAt: row.updated_at,
  };
}

// requestResync(store, { workspaceId, itemRef, targetNodeId, now }) — the face's write.
// Upsert on the (workspace, ref) key: a re-request resets a stuck `dispatched`/terminal row
// back to `requested`, preserving nothing of the prior attempt but the row's own key.
export function requestResync(store, { workspaceId, itemRef, targetNodeId, now } = {}) {
  ensureResyncTable(store);
  const at = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();
  const requestId = resyncRequestId(workspaceId, itemRef);
  store.db.prepare(`
    INSERT INTO global_resync_requests
      (request_id, item_ref, workspace_id, target_node_id, state, detail, requested_at, updated_at)
    VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
    ON CONFLICT(request_id) DO UPDATE SET
      item_ref = excluded.item_ref,
      workspace_id = excluded.workspace_id,
      target_node_id = excluded.target_node_id,
      state = excluded.state,
      detail = NULL,
      requested_at = excluded.requested_at,
      updated_at = excluded.updated_at
  `).run(requestId, itemRef, workspaceId, targetNodeId, RESYNC_REQUESTED, at, at);
  return readResync(store, workspaceId, itemRef);
}

export function readResync(store, workspaceId, itemRef) {
  ensureResyncTable(store);
  return mapRow(store.db
    .prepare("SELECT * FROM global_resync_requests WHERE request_id = ?")
    .get(resyncRequestId(workspaceId, itemRef)));
}

// listResyncRequests(store) — the tick's drain source: every row still in `requested`.
export function listResyncRequests(store) {
  ensureResyncTable(store);
  return store.db.prepare("SELECT * FROM global_resync_requests WHERE state = ?").all(RESYNC_REQUESTED).map(mapRow);
}

// markResyncState(store, requestId, state, { now, detail }) — the SOLE state writer. An
// unknown state is refused (never a silent bad write); `detail` carries the coded outcome the
// face surfaces. A no-op (null) when the row is gone — never a crash.
export function markResyncState(store, requestId, state, { now, detail } = {}) {
  ensureResyncTable(store);
  if (!isResyncState(state)) {
    throw Object.assign(new Error(`unknown resync state "${state}"`), { code: "resync-state-invalid" });
  }
  const at = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();
  const result = store.db.prepare(
    "UPDATE global_resync_requests SET state = ?, detail = ?, updated_at = ? WHERE request_id = ?",
  ).run(state, typeof detail === "string" && detail.length > 0 ? detail : null, at, requestId);
  if (result.changes === 0) return null;
  return mapRow(store.db.prepare("SELECT * FROM global_resync_requests WHERE request_id = ?").get(requestId));
}

// buildResyncFrame(to, { workspaceId, itemRef, at }) — the DOWN-frame the daemon dispatches
// to the owning node. It carries NO credential and NO command: it asks the owner to push the
// state it already reports periodically, just now instead of on its next tick. That is why
// this pull is safe — it can only ever cause the owner to say what it was going to say.
export function buildResyncFrame(to, { workspaceId, itemRef, at } = {}) {
  return { kind: RESYNC_KIND, to, workspaceId, itemRef, at };
}

// buildResyncResultFrame(nodeId, { workspaceId, itemRef, ok, code, now }) — the worker's
// UP-reply. `code` is additive, present only when supplied.
export function buildResyncResultFrame(nodeId, { workspaceId, itemRef, ok, code, now } = {}) {
  const frame = { kind: RESYNC_RESULT_KIND, nodeId, workspaceId, itemRef, ok: ok === true, at: now };
  if (typeof code === "string" && code.length > 0) frame.code = code;
  return frame;
}

// applyResyncResultFrame(store, frame, options) — control's handler for the owner's
// `work-resync-result` UP-frame (dispatched from control-stream-server's applyStreamFrame).
// AUTHORIZATION reuses the SAME T6 discipline every other apply* keeps: the CONNECTION's
// authenticated nodeId (options.nodeId, bound at connect time) must be the request row's
// target_node_id — a result on worker-a's socket can never settle a resync aimed at worker-b,
// whatever the frame self-declares.
export function applyResyncResultFrame(store, frame, options = {}) {
  const connectionNodeId = typeof options?.nodeId === "string" && options.nodeId.length > 0
    ? options.nodeId
    : (typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null);
  const workspaceId = typeof frame?.workspaceId === "string" && frame.workspaceId.length > 0 ? frame.workspaceId : null;
  const itemRef = typeof frame?.itemRef === "string" && frame.itemRef.length > 0 ? frame.itemRef : null;
  if (connectionNodeId == null || workspaceId == null || itemRef == null) {
    return { applied: false, skipped: true, code: "resync-result-invalid" };
  }

  const row = readResync(store, workspaceId, itemRef);
  if (row == null) {
    return { applied: false, skipped: true, code: "resync-result-unknown-request" };
  }
  if (row.targetNodeId !== connectionNodeId) {
    return { applied: false, skipped: true, code: "resync-result-not-owner" };
  }

  const now = options.now ?? new Date().toISOString();
  const state = frame?.ok === true ? RESYNC_PUSHED : RESYNC_FAILED;
  const detail = typeof frame?.code === "string" && frame.code.length > 0 ? frame.code : null;
  const updated = markResyncState(store, row.requestId, state, { now, detail });
  return { applied: updated != null, state, workspaceId, itemRef };
}

// runResyncDispatchTick(streamServer, options) — the CONTROL daemon's drain, called from the
// SAME control ticker runRecoveryPushDispatchTick rides (mesh-launcher). Owns its OWN
// store-open, mirroring that tick, so the launcher never imports the store module directly
// (acd-global-publisher-single-seam). For each `requested` row:
//
//   - the owner is a currently-connected admitted peer ⇒ dispatch the `work-resync`
//     DOWN-frame over streamServer.dispatchDirective (the SAME routing sendDirective
//     enforces: exactly one target socket, connected-checked) and mark `dispatched`;
//   - the owner holds no socket ⇒ mark `failed` with `resync-owner-not-connected`. NOT a
//     retry: see the header — an operator is waiting on this answer, and DESIGN's
//     "unreachable" is a designed state, not a transient to be papered over.
//   - the dispatch did not complete ⇒ mark `failed` with `resync-owner-unreachable`.
//
// EVERY OUTCOME IS NARRATED on the daemon's log channel, exactly as runRecoveryPushDispatchTick
// narrates its own (ADR-014/E7). This tick's terminal `failed` is written to a row the
// requester may already have stopped polling — the request leg is bounded and the operator's
// surface moves on — so a drain that wrote its verdict only to the row would make the CAUSE of
// a failure invisible forever, one `aof mesh logs` short of the answer.
export async function runResyncDispatchTick(streamServer, options = {}) {
  const { now = new Date().toISOString(), openStore, storeOptions = {} } = options;

  const open = openStore ?? (async (opts) => {
    const { openGlobalWorkProjectionStore } = await import("./global-work-store.mjs");
    return openGlobalWorkProjectionStore(opts);
  });
  const store = await open(storeOptions);
  try {
    const requests = listResyncRequests(store);
    for (const request of requests) {
      const connected = streamServer?.directiveTargets?.get?.(request.targetNodeId) != null;
      if (!connected) {
        markResyncState(store, request.requestId, RESYNC_FAILED, { now, detail: RESYNC_OWNER_NOT_CONNECTED });
        console.error(`[mesh-resync] ${request.itemRef} -> ${request.targetNodeId}: owner not connected — marked failed (${RESYNC_OWNER_NOT_CONNECTED})`);
        continue;
      }
      let sent = null;
      let dispatchError = null;
      try {
        sent = streamServer.dispatchDirective(buildResyncFrame(request.targetNodeId, {
          workspaceId: request.workspaceId,
          itemRef: request.itemRef,
          at: now,
        }));
      } catch (error) {
        sent = null;
        dispatchError = error;
      }
      markResyncState(
        store,
        request.requestId,
        sent?.sent ? RESYNC_DISPATCHED : RESYNC_FAILED,
        { now, detail: sent?.sent ? null : RESYNC_OWNER_UNREACHABLE },
      );
      if (sent?.sent) {
        console.error(`[mesh-resync] ${request.itemRef} -> ${request.targetNodeId}: work-resync dispatched`);
      } else {
        const cause = dispatchError != null
          ? String(dispatchError?.code ?? dispatchError?.message ?? dispatchError)
          : (sent?.code ?? "unknown");
        console.error(`[mesh-resync] ${request.itemRef} -> ${request.targetNodeId}: dispatch did not complete (${cause}) — marked failed (${RESYNC_OWNER_UNREACHABLE})`);
      }
    }
    return { drained: requests.length };
  } finally {
    store.close?.();
  }
}
