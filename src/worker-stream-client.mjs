// src/worker-stream-client.mjs — the worker's persistent live-state stream client
// (milestone 34 / story 04, ADR-007). A worker opens and holds a connection to the
// control node and streams work-state as it happens: the FIRST frame on any
// (re)connection is a full SNAPSHOT, subsequent work-state changes are DELTAs; a drop
// reconnects with growing/capped backoff and re-sends a snapshot first; a stream
// fault NEVER blocks or rolls back a local work write (ADR-004 failure isolation,
// extended to the live stream).
//
// THE WIRE FRAME (an ADR-007 open question this build resolves — documented, not
// frozen elsewhere): { kind: "snapshot" | "delta", nodeId, workspaceId, items, at }
// for work state, plus { kind: "presence", nodeId, presence, at } for durable worker
// liveness in the control node's global presence store.
//   - "snapshot" — items is the FULL current item-row array for the workspace (the
//                  SAME row shape global-work-store.mjs's readWorkspaceProjectionItems
//                  produces: { ref, type, slug, status, title, parent, sourcePath }).
//   - "delta"    — items is the array of CHANGED rows only (typically one).
// `at` is the ISO timestamp the frame was assembled (the injected clock, never
// wall-clock in a test).
//
// THE TRANSPORT SEAM: `transport` is INJECTED — { connect(), send(frame), close(),
// onDrop(handler) } — production wires createWorkerWsTransport() (a persistent ws@8
// socket), tests wire a fake recorder/dropper (the STORY.md build-note: the
// one-shot mesh-relay-client fake does not fit a persistent multi-frame channel, so
// this is NET-NEW test infrastructure). connect() may reject (fault); send() may
// reject/throw (fault) — BOTH are caught here and NEVER propagate to the caller of
// streamWorkerState()/notify() (ADR-004: a stream fault is a warning, never a
// rethrow).
//
// THE BACKOFF SCHEDULE (pure function, no wall clock): attempt n (1-based, the COUNT
// of consecutive drops so far) → delaySeconds = min(2^(n-1), 30). n=1→1s, 2→2s,
// 3→4s, 9→30s (the STORY.md examples, verbatim).
//
// milestone 38 / story 06 (ADR-014 AMENDMENT 2026-07-19, closing BLOCKER F-38.06):
// the CROSS-MACHINE terminal leg rides THIS fabric client (sendTerminalFrame, below)
// as a NEW opaque `terminal-frame` kind — the ONLY off-host-reachable transport (the
// mesh-relay broker binds loopback only, so a worker cannot reach it from another
// machine). The frozen envelope is built by the bridge module (the single source of
// the `terminal-frame` kind + shape).
import { buildTerminalFrameEnvelope, buildTerminalEndEnvelope } from "./mesh-terminal-relay-bridge.mjs";
// VERIFICATION (live soak 2026-07-25) — the control-driven recovery push. This client
// RECEIVES the `recovery-push` DOWN-frame (dispatched by the control daemon, carrying a
// one-shot write credential) and REPLIES with a `recovery-push-result` UP-frame. The
// wire-kind literals + the result-frame builder live in ONE home (mesh-recovery-push.mjs,
// the control-side owner); imported here so both sides share the contract, never a
// re-spelled literal at this call site.
import { RECOVERY_PUSH_KIND, buildRecoveryPushResultFrame } from "./mesh-recovery-push.mjs";

export function backoffDelaySeconds(attempt) {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  return Math.min(2 ** (n - 1), 30);
}

// buildSnapshotFrame(nodeId, workspaceId, items, now) — the FULL-state frame sent as
// the first frame on any (re)connection. A pure projection — no read, no clock other
// than the injected `now`.
export function buildSnapshotFrame(nodeId, workspaceId, items, now) {
  return { kind: "snapshot", nodeId, workspaceId, items: Array.isArray(items) ? [...items] : [], at: now };
}

// buildDeltaFrame(nodeId, workspaceId, items, now) — a CHANGED-rows-only frame. A
// pure projection, same shape family as the snapshot frame (kind differs).
export function buildDeltaFrame(nodeId, workspaceId, items, now) {
  return { kind: "delta", nodeId, workspaceId, items: Array.isArray(items) ? [...items] : [], at: now };
}

// The worktree-CONTENT frame kind (schema v5, TECH_DEBT item 6 — finish the board
// bridge). The worktree delta above bridges an assignment's item ROWS; this sibling
// kind carries what the board's drill-downs need and could not resolve locally: the
// subtree's record-doc BODIES and RUN RECORDS. One home for the literal — the
// control-stream server imports it, never a re-spelled string.
export const WORKTREE_CONTENT_FRAME_KIND = "worktree-content";

// The log-entries frame kind (m42 / item 2's REMOTE read): a worker's daemon log
// events ride UP the same connection, land in the control's node_logs ring, and
// `aof mesh logs --node <id>` answers from the store — no SSH archaeology. One
// home for the literal, like every other kind.
export const LOG_ENTRIES_FRAME_KIND = "log-entries";

export function buildLogEntriesFrame(nodeId, entries, now) {
  return { kind: LOG_ENTRIES_FRAME_KIND, nodeId, entries: Array.isArray(entries) ? [...entries] : [], at: now };
}

// buildWorktreeContentFrame(nodeId, workspaceId, { itemRef, docs, runs }, now) — a
// pure projection, same shape family as the other frame builders. `docs` is
// [{ ref, doc, body }], `runs` is [{ ref, runId, record }] (the shapes
// global-work-store.mjs's readWorkspaceContentRecords produces and
// upsertWorkItemContent consumes — the two ends of this frame).
export function buildWorktreeContentFrame(nodeId, workspaceId, { itemRef, docs, runs } = {}, now) {
  return {
    kind: WORKTREE_CONTENT_FRAME_KIND,
    nodeId,
    workspaceId,
    itemRef: typeof itemRef === "string" ? itemRef : null,
    docs: Array.isArray(docs) ? [...docs] : [],
    runs: Array.isArray(runs) ? [...runs] : [],
    at: now,
  };
}

export function buildPresenceFrame(nodeId, presence, now) {
  return { kind: "presence", nodeId, presence: presence && typeof presence === "object" ? { ...presence } : {}, at: now };
}

// buildAssignmentStatusFrame(nodeId, assignmentId, state, { runId, sessionId, code,
// now }) — milestone 35 / ADR-002, story 01 task 02: the up-frame a worker streams to
// report a lifecycle transition (`accepted`/`running`/`done`/`failed`). `runId` is
// included only when supplied (the "running" transition's ADR-004 run link) — a pure
// projection, same shape family as the other frame builders.
//
// MILESTONE 38 / STORY 05 (ADR-013 invariant 3) — `sessionId` and `code` are NEW,
// ADDITIVE, OPTIONAL keys (included only when a non-empty string is supplied — the
// SAME conditional-inclusion pattern `runId` already uses): `sessionId` is the
// interactive session's own `session_id` (mesh-worker-execution.mjs, previously
// discarded), surfaced so a human can `claude --resume <session_id>`; `code` is an
// optional status-refinement (e.g. `needs-input`) riding alongside an
// already-legal `state`. Both are additive-only — a consumer reading only
// {assignmentId, state, runId} sees byte-identical frames.
export function buildAssignmentStatusFrame(nodeId, assignmentId, state, { runId, sessionId, code, branch, now } = {}) {
  const frame = { kind: "assignment-status", nodeId, assignmentId, state, at: now };
  if (typeof runId === "string" && runId.length > 0) frame.runId = runId;
  if (typeof sessionId === "string" && sessionId.length > 0) frame.sessionId = sessionId;
  if (typeof code === "string" && code.length > 0) frame.code = code;
  // VERIFICATION (continue-on-existing-branch, 2026-07-25) — the ACTUAL branch this
  // assignment pushed home, reported on a `done` frame so control can record the item's
  // active branch (a continue that REUSED a base branch pushes that branch, not a
  // per-assignment one — the worker is the authority on what it actually pushed).
  if (typeof branch === "string" && branch.length > 0) frame.branch = branch;
  return frame;
}

// buildCloneCredentialRequestFrame(nodeId, assignmentId, workspaceId, now) — milestone
// 38 / ADR-009: the up-frame a worker sends ONLY on an actual clone miss, over the
// ALREADY-OPEN persistent stream (the SAME sendFrame failure-isolation seam every
// other up-frame goes through). A pure projection, same shape family as the other
// frame builders — additive alongside the FROZEN directive down-frame (35/ADR-002),
// which this never touches.
export function buildCloneCredentialRequestFrame(nodeId, assignmentId, workspaceId, now) {
  return { kind: "clone-credential-request", nodeId, assignmentId, workspaceId, at: now };
}

// buildCloneUrlRequestFrame(nodeId, assignmentId, workspaceId, now) — review fix
// (ADR-010 Gap A extended, live soak 2026-07-18): the SAME PULL shape as
// buildCloneCredentialRequestFrame above, for a DIFFERENT gap — a worker assigned
// to a workspace it has never checked out has no local knowledge of that
// workspace's cloneUrl (config.mesh.repo.cloneUrl lives ONLY in that workspace's
// OWN committed config, which the worker cannot read before it has cloned it —
// chicken-and-egg), and the control node's own local global_workspace_descriptors
// row is NOT synced cross-machine (each node's SQLite file is independently, only
// LOCALLY populated). Deliberately NOT added to the FROZEN directive frame
// (35/ADR-002, guarded by acd-clone-credential-pull-not-pushed): control cannot
// know a clone is even needed at dispatch time, so pushing cloneUrl on EVERY
// directive is the same "broadest exposure for the least benefit" ADR-009 already
// rejected for credentials — pulled on-demand, only on an actual clone miss,
// exactly like the credential.
export function buildCloneUrlRequestFrame(nodeId, assignmentId, workspaceId, now) {
  return { kind: "clone-url-request", nodeId, assignmentId, workspaceId, at: now };
}

// buildWriteCredentialRequestFrame(nodeId, assignmentId, workspaceId, now) — milestone
// 38 / story 07 (ADR-015): the SAME PULL shape as buildCloneCredentialRequestFrame
// above, over its OWN DISTINCT frame kind ("write-credential-request", never
// "clone-credential-request" — the two seams stay wire-discriminable). Sent ONLY at
// the push seam (mesh-worker-execution.mjs, on a `done` outcome, BEFORE `git push`) —
// never speculatively, never per-directive.
export function buildWriteCredentialRequestFrame(nodeId, assignmentId, workspaceId, now) {
  return { kind: "write-credential-request", nodeId, assignmentId, workspaceId, at: now };
}

// THE CLONE-CREDENTIAL BOUNDED WAIT — a request that is refused, dropped, or never
// answered must never hang the worker forever (ADR-009: "failure is LOUD, never a
// hang"). Overridable per-client via options.cloneCredentialTimeoutMs (tests inject a
// short bound; production keeps the default).
export const DEFAULT_CLONE_CREDENTIAL_TIMEOUT_MS = 15000;
// review fix (ADR-010 Gap A extended, live soak 2026-07-18) — the SAME bounded-wait
// discipline for the clone-url PULL: "failure is LOUD, never a hang" applies here
// exactly as it does to the credential.
export const DEFAULT_CLONE_URL_TIMEOUT_MS = 15000;
// milestone 38 / story 07 (ADR-015) — the SAME bounded-wait discipline for the
// write-credential PULL at the push seam.
export const DEFAULT_WRITE_CREDENTIAL_TIMEOUT_MS = 15000;

// createWorkerStreamClient({ transport, ticker, nodeId, workspaceId, now, onWarning })
// → { connect(), sendSnapshot(items), sendDelta(items), notifyDrop(), stop() }.
//
// The self-healing session object: on connect() (first call, or after notifyDrop()
// schedules + fires a reconnect), the FIRST frame sent on the new connection is
// ALWAYS a snapshot (the caller supplies the CURRENT full item set to connect() so a
// reconnect can re-snapshot without the caller re-deriving "am I fresh"). Every
// send() after that connect is a delta until the next reconnect.
//
//   transport   — INJECTED { connect(): Promise<handle>, send(handle, frame):
//                 Promise<void>, close(handle): void }. Production default is
//                 createWorkerWsTransport() (a real ws@8 socket to the resolved
//                 control-node dial address).
//   ticker      — INJECTED { start(intervalSeconds, onTick) -> handle, stop(handle) }
//                 (the launcher intervalTicker-compatible contract) driving the backoff
//                 reconnect timer. Defaults to the real intervalTicker() import when
//                 absent — but tests always inject a manual one (no wall-clock wait).
//   nodeId, workspaceId — carried on every frame.
//   now         — () => string | string, the injected clock for frame timestamps.
//   onWarning   — (warning) => void, invoked (never thrown) when a connect/send fault
//                 occurs — the ADR-004 failure-isolation surface: the caller's local
//                 work write already happened; this is a best-effort side channel.
//
// FAILURE ISOLATION: every transport call is wrapped in try/catch. A connect/send
// fault NEVER rejects out of sendSnapshot/sendDelta/notifyDrop — it is reported via
// onWarning and the session marks itself disconnected (a fault behaves exactly like a
// drop: the NEXT successful send re-snapshots).
export function createWorkerStreamClient({
  transport,
  ticker,
  nodeId,
  workspaceId,
  now = () => new Date().toISOString(),
  onWarning = () => {},
  // cloneCredentialTimeoutMs — milestone 38 / ADR-009: the bounded wait
  // requestCloneCredential (below) applies to its own pending reply. Tests inject a
  // short bound; production keeps DEFAULT_CLONE_CREDENTIAL_TIMEOUT_MS.
  cloneCredentialTimeoutMs = DEFAULT_CLONE_CREDENTIAL_TIMEOUT_MS,
  // cloneUrlTimeoutMs — review fix (ADR-010 Gap A extended, live soak 2026-07-18):
  // the SAME per-client override shape as cloneCredentialTimeoutMs, for requestCloneUrl.
  cloneUrlTimeoutMs = DEFAULT_CLONE_URL_TIMEOUT_MS,
  // writeCredentialTimeoutMs — milestone 38 / story 07 (ADR-015): the SAME per-client
  // override shape as cloneCredentialTimeoutMs, for requestWriteCredential.
  writeCredentialTimeoutMs = DEFAULT_WRITE_CREDENTIAL_TIMEOUT_MS,
} = {}) {
  let handle = null;
  let connected = false;
  let needsSnapshot = true; // the very first frame on the very first connection is a snapshot too
  let consecutiveDrops = 0;
  let reconnectHandle = null;
  let stopped = false;
  // milestone 35 / ADR-002, story 01 task 00/02 — the down-channel receive seam
  // Story 02 implements against: a registered directive handler, invoked with the
  // PARSED { kind:"directive", to, assignmentId, itemRef, workspaceId, at } frame.
  // This story delivers/accepts frames; it does NOT run work — directiveHandler is
  // called and nothing else happens here.
  let directiveHandler = null;
  // VERIFICATION (live soak 2026-07-25) — the control-driven recovery-push receive
  // handler, a clean additive sibling to directiveHandler above. Registered via
  // onRecoveryPush(handler); invoked with the PARSED recovery-push DOWN-frame (below).
  let recoveryPushHandler = null;
  // milestone 38 / ADR-009 — pending clone-credential-request correlation, keyed by
  // assignmentId (per-clone, per-assignment: at most ONE clone-miss is ever in flight
  // for a given assignment). A bounded wait backstops a request that is refused,
  // dropped, or never answered — see requestCloneCredential below.
  const pendingCloneCredentialRequests = new Map();
  // review fix (ADR-010 Gap A extended, live soak 2026-07-18) — the SAME
  // per-assignment pending-request correlation as pendingCloneCredentialRequests
  // above, for the clone-url PULL (see buildCloneUrlRequestFrame).
  const pendingCloneUrlRequests = new Map();
  // milestone 38 / story 07 (ADR-015) — the SAME per-assignment pending-request
  // correlation, for the write-credential PULL at the push seam.
  const pendingWriteCredentialRequests = new Map();

  const resolveNow = () => (typeof now === "function" ? now() : now);

  const warn = (code, error) => {
    onWarning({ code, message: error?.message ?? String(error ?? "stream fault"), path: null });
  };

  // settleCloneCredentialRequest(assignmentId, frame) — resolves a pending
  // requestCloneCredential() wait with the RAW down-frame that arrived for it (the
  // correlation key), clearing its timeout. A no-op if nothing is pending for that
  // assignmentId (an unsolicited/late/duplicate clone-credential frame).
  function settleCloneCredentialRequest(assignmentId, frame) {
    const pending = pendingCloneCredentialRequests.get(assignmentId);
    if (pending == null) return;
    pendingCloneCredentialRequests.delete(assignmentId);
    clearTimeout(pending.timer);
    pending.resolve({ frame });
  }

  // clearPendingCloneCredentialRequest(assignmentId) — drops a pending registration
  // WITHOUT resolving it (used when the up-frame send itself fails — the caller is
  // about to throw synchronously, so nothing is left waiting on the timer).
  function clearPendingCloneCredentialRequest(assignmentId) {
    const pending = pendingCloneCredentialRequests.get(assignmentId);
    if (pending == null) return;
    pendingCloneCredentialRequests.delete(assignmentId);
    clearTimeout(pending.timer);
  }

  // settleCloneUrlRequest / clearPendingCloneUrlRequest — the SAME two functions
  // as their clone-credential siblings above, over pendingCloneUrlRequests.
  function settleCloneUrlRequest(assignmentId, frame) {
    const pending = pendingCloneUrlRequests.get(assignmentId);
    if (pending == null) return;
    pendingCloneUrlRequests.delete(assignmentId);
    clearTimeout(pending.timer);
    pending.resolve({ frame });
  }

  function clearPendingCloneUrlRequest(assignmentId) {
    const pending = pendingCloneUrlRequests.get(assignmentId);
    if (pending == null) return;
    pendingCloneUrlRequests.delete(assignmentId);
    clearTimeout(pending.timer);
  }

  // settleWriteCredentialRequest / clearPendingWriteCredentialRequest — the SAME two
  // functions as their clone-credential siblings above, over
  // pendingWriteCredentialRequests (story 07, ADR-015).
  function settleWriteCredentialRequest(assignmentId, frame) {
    const pending = pendingWriteCredentialRequests.get(assignmentId);
    if (pending == null) return;
    pendingWriteCredentialRequests.delete(assignmentId);
    clearTimeout(pending.timer);
    pending.resolve({ frame });
  }

  function clearPendingWriteCredentialRequest(assignmentId) {
    const pending = pendingWriteCredentialRequests.get(assignmentId);
    if (pending == null) return;
    pendingWriteCredentialRequests.delete(assignmentId);
    clearTimeout(pending.timer);
  }

  // handleTransportMessage(raw) — the worker's FIRST receive listener (STORY.md:
  // "the worker client's FIRST receive listener is a clean additive sibling to
  // onDrop"). A malformed frame is dropped, never thrown (the SAME never-crash
  // discipline control-stream-server.mjs's own message handler keeps). A "directive"
  // kind is dispatched to directiveHandler; milestone 38 / ADR-009 adds ONE additive
  // sibling branch — a "clone-credential" kind resolves the matching pending
  // requestCloneCredential() wait (below). Any OTHER kind is silently ignored (this is
  // the RECEIVE side; there is no store to write a no-op result into) — both branches
  // dispatch on frame.kind exactly as control-stream-server.mjs's own applyStreamFrame
  // does, so the frozen directive frame (35/ADR-002) is untouched by this addition.
  function handleTransportMessage(raw) {
    let frame = null;
    try {
      frame = typeof raw === "string" ? JSON.parse(raw) : JSON.parse(raw.toString());
    } catch {
      return; // never-crash: a malformed frame is dropped, never thrown.
    }
    if (frame?.kind === "directive") {
      directiveHandler?.(frame);
      return;
    }
    // VERIFICATION (live soak 2026-07-25) — the control-driven recovery-push DOWN-frame:
    // dispatched to THIS worker to commit + push a stranded worktree with the carried
    // one-shot write credential. Handed to the registered recoveryPushHandler (which
    // replies via sendRecoveryPushResult below); an unregistered handler drops it (never
    // a crash), exactly like directive with no directiveHandler.
    if (frame?.kind === RECOVERY_PUSH_KIND) {
      recoveryPushHandler?.(frame);
      return;
    }
    if (frame?.kind === "clone-credential") {
      const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
      if (assignmentId != null) settleCloneCredentialRequest(assignmentId, frame);
      return;
    }
    if (frame?.kind === "clone-url") {
      const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
      if (assignmentId != null) settleCloneUrlRequest(assignmentId, frame);
      return;
    }
    // milestone 38 / story 07 (ADR-015) — the write-credential PULL's own reply kind,
    // resolving the matching pending requestWriteCredential() wait (below).
    if (frame?.kind === "write-credential") {
      const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
      if (assignmentId != null) settleWriteCredentialRequest(assignmentId, frame);
      return;
    }
  }

  if (transport != null && typeof transport.onMessage === "function") {
    transport.onMessage(handleTransportMessage);
  }

  // markDropped() — a connect/send fault OR an explicit notifyDrop(): the session
  // is no longer connected, so the NEXT frame (once reconnected) must be a snapshot.
  function markDropped() {
    connected = false;
    needsSnapshot = true;
    if (handle != null) {
      try { transport.close(handle); } catch { /* already gone */ }
    }
    handle = null;
  }

  // ensureConnected() — connect the transport if not already connected. A connect
  // fault is caught (ADR-004) and reported via onWarning; the session stays
  // disconnected (the caller's send is then skipped, never thrown).
  //
  // review fix P0.4: consecutiveDrops resets HERE, on a successful (re)connect —
  // not only in sendFrame's success branch. A clean reconnect that then sits idle
  // (no send yet) used to leave the counter high, so the NEXT drop's backoff would
  // escalate toward the 30s cap even though the connection in between was healthy.
  async function ensureConnected() {
    if (connected) return true;
    try {
      handle = await transport.connect();
      connected = true;
      consecutiveDrops = 0;
      return true;
    } catch (error) {
      warn("worker-stream-connect-failed", error);
      markDropped();
      return false;
    }
  }

  // sendFrame(frame) — the ONE transport-facing send, wrapped for failure isolation.
  // A send fault is caught, reported, and marks the session dropped (so the next
  // attempt re-snapshots) — it NEVER rejects to the caller.
  async function sendFrame(frame) {
    const ok = await ensureConnected();
    if (!ok) return { sent: false };
    try {
      await transport.send(handle, frame);
      consecutiveDrops = 0;
      return { sent: true };
    } catch (error) {
      warn("worker-stream-send-failed", error);
      markDropped();
      return { sent: false };
    }
  }

  // sendSnapshot(items) — always the SNAPSHOT frame kind, regardless of prior state
  // (a caller may force a re-sync at any time). Successfully sending it clears the
  // "needs a snapshot next" flag.
  async function sendSnapshot(items) {
    const result = await sendFrame(buildSnapshotFrame(nodeId, workspaceId, items, resolveNow()));
    if (result.sent) needsSnapshot = false;
    return result;
  }

  // sendDelta(items) — the delta frame kind UNLESS the session currently needs a
  // fresh snapshot (fresh connection / just-recovered-from-a-drop): the FRAME
  // CONTRACT is enforced HERE, not by caller discipline — "the first frame on any
  // (re)connection is a full snapshot" holds even if the caller calls sendDelta()
  // first after a drop (the contract wins over the caller's requested kind; the
  // caller supplies `fullItems` for exactly this case — see the class doc-comment).
  //
  // VERIFICATION (live worktree streaming, 2026-07-26) — `options.workspaceId` is the
  // PER-FRAME workspace override, and it is why the worktree stream never landed a
  // single row. The client-level `workspaceId` is derived ONCE, at launch, from the
  // daemon's own cwd workspace; but a worktree delta speaks for the ASSIGNMENT's
  // workspace, which on a worker is a DIFFERENT id (the mesh checkout lives at a
  // different path, and path-derived ids are per-machine). Stamped with the launch id,
  // every worktree delta reached the control node as an id it holds no descriptor for
  // and was refused `unknown-workspace` — silently, forever. A caller that passes no
  // override keeps the client id byte-identically (the launch-workspace snapshot path).
  async function sendDelta(deltaItems, { fullItems, workspaceId: frameWorkspaceId } = {}) {
    if (needsSnapshot) {
      const items = Array.isArray(fullItems) ? fullItems : deltaItems;
      return sendSnapshot(items);
    }
    const target = typeof frameWorkspaceId === "string" && frameWorkspaceId.length > 0 ? frameWorkspaceId : workspaceId;
    return sendFrame(buildDeltaFrame(nodeId, target, deltaItems, resolveNow()));
  }

  async function sendPresence(presence) {
    return sendFrame(buildPresenceFrame(nodeId, presence, resolveNow()));
  }

  // sendLogEntries(entries) — node-scoped (no workspaceId), same failure-isolated
  // sendFrame seam as presence/assignment-status; a log frame lost to a drop is a
  // gap in the remote mirror, never a correctness fault (the durable file sink on
  // the worker itself still has every line).
  async function sendLogEntries(entries) {
    return sendFrame(buildLogEntriesFrame(nodeId, entries, resolveNow()));
  }

  // sendWorktreeContent(content, { workspaceId }) — the worktree-content sibling of
  // sendDelta: the SAME per-frame workspaceId override (an assignment's content
  // speaks for the ASSIGNMENT's workspace, never this daemon's launch workspace —
  // the exact id mismatch that silently zeroed the row stream, 2026-07-26). While
  // the session needs a snapshot the frame is SKIPPED, not promoted (the frame
  // contract's "first frame on any (re)connection is a snapshot" belongs to the
  // row stream; content is re-streamed every tick, so the next tick re-carries it).
  async function sendWorktreeContent(content, { workspaceId: frameWorkspaceId } = {}) {
    if (needsSnapshot) return { sent: false, skipped: true, code: "needs-snapshot" };
    const target = typeof frameWorkspaceId === "string" && frameWorkspaceId.length > 0 ? frameWorkspaceId : workspaceId;
    return sendFrame(buildWorktreeContentFrame(nodeId, target, content, resolveNow()));
  }

  // sendAssignmentStatus(assignmentId, state, { runId, sessionId, code }) — milestone
  // 35 / ADR-002, story 01 task 02: the up-frame emitter Story 02 calls to stream
  // accepted -> running -> done|failed back up the SAME persistent socket. Reuses
  // the SAME failure-isolation seam every other send goes through (sendFrame) — a
  // transport fault here is a warning, never a rethrow (ADR-004). `sessionId`/`code`
  // (milestone 38 / story 05, ADR-013) are forwarded VERBATIM to
  // buildAssignmentStatusFrame's own optional keys — this is the LITERAL production
  // call site mesh-launcher.mjs's `sendAssignmentStatus: (...args) =>
  // client.sendAssignmentStatus(...args)` closes over, so a real worker's captured
  // session_id genuinely reaches the wire, never reachable only through a test's own
  // recorder.
  async function sendAssignmentStatus(assignmentId, state, { runId, sessionId, code, branch } = {}) {
    return sendFrame(buildAssignmentStatusFrame(nodeId, assignmentId, state, { runId, sessionId, code, branch, now: resolveNow() }));
  }

  // sendTerminalFrame(sessionId, bytes) — milestone 38 / story 06 (ADR-014 AMENDMENT
  // 2026-07-19, closing BLOCKER F-38.06): the CROSS-MACHINE terminal leg. A worker's
  // live PTY chunk rides UP the SAME already-open fabric connection this client holds,
  // as a NEW opaque `terminal-frame` kind (control-stream-server branches it to its
  // onTerminalFrame sink BEFORE any store apply — never persisted, ADR-014 inv.3).
  //
  // DELIBERATELY OFF the sendFrame path (unlike every other up-frame). A live PTY
  // emits many frames/second, and a terminal frame is a pure best-effort LIVE VIEW —
  // there is NO durable floor (a dropped frame is a gap in the mirror, never a
  // correctness fault, ADR-014). So it must NEVER touch the reconnect/drop
  // bookkeeping sendFrame keeps: never markDropped(), never consecutiveDrops±, never
  // warn(). A high-frequency stream that thrashed the backoff state on every transient
  // hiccup would destabilise the worker's actual work-state reconnect. It sends ONLY
  // when the socket is genuinely up (connected && handle != null) and swallows any
  // fault; a frame emitted while disconnected is simply dropped (there is no terminal
  // replay log — the mirror is a live tail, ADR-014).
  async function sendTerminalFrame(sessionId, bytes) {
    if (!connected || handle == null) return { sent: false };
    try {
      await transport.send(handle, buildTerminalFrameEnvelope(nodeId, sessionId, bytes));
      return { sent: true };
    } catch {
      // best-effort: a terminal-frame send fault is swallowed here — never
      // markDropped()/warn()/consecutiveDrops, so a live PTY stream can never thrash
      // the worker's reconnect/drop bookkeeping (the sendFrame path owns that).
      return { sent: false };
    }
  }

  // sendTerminalEnd(sessionId) — milestone 38 / story 06 / task 04 (ADR-014
  // AMENDMENT 2026-07-23, structural invariant 8; BLOCKER F-38.06e): the END of the
  // cross-machine terminal leg. The LAST frame of a stream, sent when the driver's
  // one settle point fires — the same opaque `terminal-frame` kind, so it rides the
  // SAME single control-side branch the byte frames do and is likewise never
  // persisted (inv.3). It carries no bytes: the marker lives inside `signal`
  // (`buildTerminalEndEnvelope`).
  //
  // EXACTLY the sendTerminalFrame posture, deliberately: off the sendFrame path,
  // send only when the socket is genuinely up, swallow any fault, and NEVER
  // markDropped()/consecutiveDrops±/warn(). A lost end frame leaves a stale live
  // view (the operator sees a last frame that stopped moving), never a correctness
  // fault — and it must not thrash a worker's reconnect bookkeeping at the exact
  // moment its run is settling.
  async function sendTerminalEnd(sessionId) {
    if (!connected || handle == null) return { sent: false };
    try {
      await transport.send(handle, buildTerminalEndEnvelope(nodeId, sessionId));
      return { sent: true };
    } catch {
      // best-effort, for the same reason sendTerminalFrame is.
      return { sent: false };
    }
  }

  // requestCloneCredential({ assignmentId, workspaceId }) — milestone 38 / ADR-009:
  // sends the clone-credential-request up-frame over the SAME sendFrame
  // failure-isolation seam, then awaits the matching clone-credential down-frame
  // correlated on assignmentId, bounded by cloneCredentialTimeoutMs (never a hang). A
  // PURE TRANSPORT LEAF (the graph's zero-outbound-edges invariant this module keeps,
  // ADR-009): this function CARRIES a credential — it never mints, resolves,
  // persists, or logs one.
  //
  // Resolves to the credential STRING on a well-formed non-refusal reply carrying
  // one; resolves to `null` on a well-formed reply EXPLICITLY carrying no credential
  // (control decided none is needed — the public-repo path). REJECTS (a coded error)
  // on a send failure, a refusal, a timeout, or a malformed/blank reply — the caller
  // (mesh-worker-execution.mjs's cloneRepoForWorkspace) turns any rejection into the
  // existing loud coded assignment-repo-unavailable failure.
  async function requestCloneCredential({ assignmentId, workspaceId } = {}) {
    if (typeof assignmentId !== "string" || assignmentId.length === 0) {
      const error = new Error("requestCloneCredential requires an assignmentId");
      error.code = "clone-credential-request-invalid";
      throw error;
    }

    const waitForReply = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCloneCredentialRequests.delete(assignmentId);
        resolve({ timedOut: true });
      }, cloneCredentialTimeoutMs);
      pendingCloneCredentialRequests.set(assignmentId, { resolve, timer });
    });

    const sent = await sendFrame(buildCloneCredentialRequestFrame(nodeId, assignmentId, workspaceId, resolveNow()));
    if (!sent.sent) {
      clearPendingCloneCredentialRequest(assignmentId);
      const error = new Error("clone-credential-request could not be sent (transport unavailable)");
      error.code = "assignment-repo-unavailable";
      throw error;
    }

    const outcome = await waitForReply;
    if (outcome?.timedOut) {
      const error = new Error(`clone-credential-request timed out waiting for control's reply (assignmentId=${assignmentId})`);
      error.code = "clone-credential-timeout";
      throw error;
    }
    const frame = outcome?.frame ?? null;
    if (typeof frame?.code === "string" && frame.code.length > 0) {
      const error = new Error(`clone-credential-request was refused by control (code=${frame.code})`);
      error.code = frame.code;
      throw error;
    }
    if (frame?.credential === null) return null; // control explicitly decided no credential is needed
    if (typeof frame?.credential === "string" && frame.credential.length > 0) return frame.credential;
    const error = new Error("clone-credential-request received a blank/absent credential");
    error.code = "clone-credential-blank";
    throw error;
  }

  // requestCloneUrl({ assignmentId, workspaceId }) — review fix (ADR-010 Gap A
  // extended, live soak 2026-07-18): the SAME PULL shape as requestCloneCredential
  // above, over the SAME sendFrame failure-isolation seam, bounded by
  // cloneUrlTimeoutMs. A PURE TRANSPORT LEAF exactly like its sibling — it never
  // resolves, publishes, or caches a cloneUrl itself, only carries one.
  //
  // Resolves to the cloneUrl STRING on a well-formed non-refusal reply carrying
  // one; resolves to `null` on a well-formed reply EXPLICITLY carrying no cloneUrl
  // (control has no clone_url on record for this workspace either — the caller
  // falls through to its own final failure path, exactly as a null credential
  // falls through to the public-repo path). REJECTS on a send failure, a refusal,
  // a timeout, or a malformed/blank reply.
  async function requestCloneUrl({ assignmentId, workspaceId } = {}) {
    if (typeof assignmentId !== "string" || assignmentId.length === 0) {
      const error = new Error("requestCloneUrl requires an assignmentId");
      error.code = "clone-url-request-invalid";
      throw error;
    }

    const waitForReply = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCloneUrlRequests.delete(assignmentId);
        resolve({ timedOut: true });
      }, cloneUrlTimeoutMs);
      pendingCloneUrlRequests.set(assignmentId, { resolve, timer });
    });

    const sent = await sendFrame(buildCloneUrlRequestFrame(nodeId, assignmentId, workspaceId, resolveNow()));
    if (!sent.sent) {
      clearPendingCloneUrlRequest(assignmentId);
      const error = new Error("clone-url-request could not be sent (transport unavailable)");
      error.code = "assignment-repo-unavailable";
      throw error;
    }

    const outcome = await waitForReply;
    if (outcome?.timedOut) {
      const error = new Error(`clone-url-request timed out waiting for control's reply (assignmentId=${assignmentId})`);
      error.code = "clone-url-timeout";
      throw error;
    }
    const frame = outcome?.frame ?? null;
    if (typeof frame?.code === "string" && frame.code.length > 0) {
      const error = new Error(`clone-url-request was refused by control (code=${frame.code})`);
      error.code = frame.code;
      throw error;
    }
    if (frame?.cloneUrl === null) return null; // control has no clone_url on record for this workspace either
    if (typeof frame?.cloneUrl === "string" && frame.cloneUrl.length > 0) return frame.cloneUrl;
    const error = new Error("clone-url-request received a blank/absent cloneUrl");
    error.code = "clone-url-blank";
    throw error;
  }

  // requestWriteCredential({ assignmentId, workspaceId }) — milestone 38 / story 07
  // (ADR-015): the SAME PULL shape as requestCloneCredential above, over its OWN
  // DISTINCT frame kind ("write-credential-request"/"write-credential") and its OWN
  // pending-request map, bounded by writeCredentialTimeoutMs. A PURE TRANSPORT LEAF
  // exactly like its clone sibling — it never mints, resolves, persists, or logs a
  // credential, only carries one. Called ONLY at the push seam
  // (mesh-worker-execution.mjs, on a `done` outcome, BEFORE `git push`) — never
  // speculatively.
  //
  // Resolves to the credential STRING on a well-formed non-refusal reply carrying
  // one; resolves to `null` on a well-formed reply EXPLICITLY carrying no credential
  // (control has no write mint configured for this workspace — an unauthenticated
  // push, exactly mirroring the clone path's own "no credential configured"
  // default). REJECTS (a coded error) on a send failure, a refusal, a timeout, or a
  // malformed/blank reply — the caller (mesh-worker-execution.mjs's
  // pushWorktreeBranch flow) treats any rejection as an unauthenticated-push attempt
  // (a null credential), never a hard stop on its own — the push itself is what
  // decides success/failure.
  async function requestWriteCredential({ assignmentId, workspaceId } = {}) {
    if (typeof assignmentId !== "string" || assignmentId.length === 0) {
      const error = new Error("requestWriteCredential requires an assignmentId");
      error.code = "write-credential-request-invalid";
      throw error;
    }

    const waitForReply = new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingWriteCredentialRequests.delete(assignmentId);
        resolve({ timedOut: true });
      }, writeCredentialTimeoutMs);
      pendingWriteCredentialRequests.set(assignmentId, { resolve, timer });
    });

    const sent = await sendFrame(buildWriteCredentialRequestFrame(nodeId, assignmentId, workspaceId, resolveNow()));
    if (!sent.sent) {
      clearPendingWriteCredentialRequest(assignmentId);
      const error = new Error("write-credential-request could not be sent (transport unavailable)");
      error.code = "push-failed";
      throw error;
    }

    const outcome = await waitForReply;
    if (outcome?.timedOut) {
      const error = new Error(`write-credential-request timed out waiting for control's reply (assignmentId=${assignmentId})`);
      error.code = "write-credential-timeout";
      throw error;
    }
    const frame = outcome?.frame ?? null;
    if (typeof frame?.code === "string" && frame.code.length > 0) {
      const error = new Error(`write-credential-request was refused by control (code=${frame.code})`);
      error.code = frame.code;
      throw error;
    }
    if (frame?.credential === null) return null; // control has no write mint configured for this workspace
    if (typeof frame?.credential === "string" && frame.credential.length > 0) return frame.credential;
    const error = new Error("write-credential-request received a blank/absent credential");
    error.code = "write-credential-blank";
    throw error;
  }

  // sendRecoveryPushResult(assignmentId, { ok, code, branch }) — VERIFICATION (live
  // soak 2026-07-25): the worker's UP-reply to a recovery-push DOWN-frame, over the SAME
  // sendFrame failure-isolation seam every other up-frame goes through (a transport
  // fault here is a warning, never a rethrow — ADR-004). Carries whether the commit+push
  // succeeded (`ok`), an optional failure `code`, and the `branch` pushed.
  async function sendRecoveryPushResult(assignmentId, { ok, code, branch } = {}) {
    return sendFrame(buildRecoveryPushResultFrame(nodeId, assignmentId, { ok, code, branch, now: resolveNow() }));
  }

  // onRecoveryPush(handler) — VERIFICATION (live soak 2026-07-25): registers the ONE
  // handler invoked with a PARSED recovery-push DOWN-frame, mirroring onDirective below.
  // Additive — a caller that never registers one drops recovery-push frames silently.
  function onRecoveryPush(handler) {
    recoveryPushHandler = typeof handler === "function" ? handler : null;
  }

  // onDirective(handler) — milestone 35 / ADR-002, story 01: registers the ONE
  // handler invoked with a PARSED directive frame when one arrives on the receive
  // listener above. Mirrors createWorkerWsTransport's onDrop(handler) shape
  // (additive — a caller that never registers one simply receives directives into
  // the void; this story delivers/accepts, story 02 is the first real registrant).
  function onDirective(handler) {
    directiveHandler = typeof handler === "function" ? handler : null;
  }

  // notifyDrop() — an explicit signal the connection dropped (production wires this
  // from the transport's own onDrop/close event); schedules a backoff reconnect over
  // the injected ticker. The reconnect itself does not resend a frame on its own — a
  // subsequent sendSnapshot/sendDelta call re-connects and the FRAME CONTRACT
  // (needsSnapshot) guarantees the next frame sent is a snapshot.
  function notifyDrop() {
    if (stopped) return;
    markDropped();
    consecutiveDrops += 1;
    const delaySeconds = backoffDelaySeconds(consecutiveDrops);
    if (ticker == null) return { scheduledDelaySeconds: delaySeconds };
    reconnectHandle = ticker.start(delaySeconds, () => {
      ticker.stop(reconnectHandle);
      reconnectHandle = null;
      // The reconnect attempt itself: connect now, so a subsequent send finds the
      // transport already up. A fault here is caught by ensureConnected/markDropped
      // and simply re-schedules on the NEXT explicit notifyDrop() (production calls
      // notifyDrop again from the transport's error/close handler).
      ensureConnected().catch(() => {});
    });
    return { scheduledDelaySeconds: delaySeconds };
  }

  function stop() {
    stopped = true;
    if (reconnectHandle != null && ticker != null) {
      ticker.stop(reconnectHandle);
      reconnectHandle = null;
    }
    markDropped();
  }

  return {
    ensureConnected,
    sendSnapshot,
    sendDelta,
    sendWorktreeContent,
    sendPresence,
    sendLogEntries,
    sendAssignmentStatus,
    sendTerminalFrame,
    sendTerminalEnd,
    sendRecoveryPushResult,
    requestCloneCredential,
    requestCloneUrl,
    requestWriteCredential,
    onDirective,
    onRecoveryPush,
    notifyDrop,
    stop,
    get connected() { return connected; },
    get needsSnapshot() { return needsSnapshot; },
    get consecutiveDrops() { return consecutiveDrops; },
  };
}

// createWorkerWsTransport(url, { WebSocketImpl } = {}) → { connect, send, close,
// onDrop } — the PRODUCTION transport: a persistent ws@8 socket to the resolved
// control-node dial address (never a hand-derived URL — the caller resolves `url`
// via mesh-fabric's resolvePeers). connect() resolves once the socket is OPEN;
// send() JSON-serialises the frame and writes it; close() disposes the socket.
// Exercised for real only by the @manual two-machine soak (task 04) — @executable
// coverage always injects a fake transport (the STORY.md build-note: a persistent
// multi-frame channel needs a net-new double, the one-shot mesh-relay-client fake
// does not fit).
//
// onDrop(handler) — review fix P1.7b: registers the ONE handler the launcher
// bridges to the client's own notifyDrop() when the CURRENT connected socket
// closes/errors post-open (a pre-open error is already reported through connect()'s
// own rejection, never double-reported here). Additive — a caller that never calls
// onDrop gets byte-identical connect/send/close behaviour.
export function createWorkerWsTransport(url, { WebSocketImpl } = {}) {
  let dropHandler = null;
  let messageHandler = null;
  let currentSocket = null;
  return {
    async connect() {
      const { WebSocket } = WebSocketImpl ? { WebSocket: WebSocketImpl } : await import("ws");
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let settled = false;
        ws.on("open", () => {
          if (!settled) {
            settled = true;
            currentSocket = ws;
            resolve(ws);
          }
        });
        // milestone 35 / ADR-002, story 01 task 00: the worker's FIRST receive
        // listener — wired here (inside connect(), on the SAME socket send()
        // already writes to) so a directive down-frame reaches onMessage's
        // registered handler over the ONE persistent connection, never a second
        // socket. Additive: a caller that never calls onMessage(handler) below
        // leaves messageHandler null and this is a silent no-op per message.
        ws.on("message", (data) => {
          messageHandler?.(data);
        });
        ws.on("error", (error) => {
          if (!settled) { settled = true; reject(error); return; }
          // A post-open error is a drop, not a connect fault — bridged the same as
          // "close" below (either can fire first depending on the failure mode).
          if (currentSocket === ws) {
            currentSocket = null;
            dropHandler?.();
          }
        });
        ws.on("close", () => {
          if (!settled) return; // a pre-open close is surfaced via the error branch above
          if (currentSocket === ws) {
            currentSocket = null;
            dropHandler?.();
          }
        });
      });
    },
    async send(ws, frame) {
      return new Promise((resolve, reject) => {
        ws.send(JSON.stringify(frame), (error) => (error ? reject(error) : resolve()));
      });
    },
    close(ws) {
      if (currentSocket === ws) currentSocket = null;
      try { ws.close(); } catch { /* already closing */ }
    },
    onDrop(handler) {
      dropHandler = typeof handler === "function" ? handler : null;
    },
    // onMessage(handler) — milestone 35 / ADR-002, story 01 task 00: registers the
    // ONE handler invoked with the raw message payload (a Buffer/string, exactly as
    // ws@8 hands it to "message") whenever a frame arrives on the current socket —
    // mirrors onDrop(handler) above. Zero behaviour change for a caller that never
    // registers one.
    onMessage(handler) {
      messageHandler = typeof handler === "function" ? handler : null;
    },
  };
}
