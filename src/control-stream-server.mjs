// src/control-stream-server.mjs — the control node's always-on worker-stream ingest
// server (milestone 34 / story 04, ADR-007). Admits ONLY tailnet peers (the fabric is
// the admission boundary, 33/ADR-002 — no token/device-code); applies an admitted
// worker's snapshot-then-deltas into the SAME global store + redaction path stories
// 34/00-02 built (ADR-004/ADR-005); tracks each worker's stream liveness
// (live/stale/disconnected) from connection + heartbeat state.
//
// SHAPE: adapts serveRelay's (src/mesh-relay.mjs) concrete http.createServer + ws
// accept-loop shape (ADR-007 open Q4: re-implemented against the redacting global
// store publisher, NOT resurrected verbatim — this module never imports
// mesh-registry.mjs's credential/enrollment gate; admission here is "is this a
// tailnet peer", a DIFFERENT predicate). ws@8 (`WebSocketServer`) is the production
// transport; tests drive the pure functions below directly (admission decision,
// frame application, liveness label) — the STORY.md build note's "task 01's paired
// fake channel" pattern, generalised to the server side.
//
// THE WIRE FRAME — the SAME { kind, nodeId, workspaceId, items, at } shape
// worker-stream-client.mjs emits (documented there). This module never re-derives
// that schema; it only reads it.
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import {
  openGlobalWorkProjectionStore,
  upsertWorkItems,
  upsertWorkItemContent,
  appendNodeLogEntries,
} from "./global-work-store.mjs";
// schema v5 (TECH_DEBT item 6 — finish the board bridge): the worktree-CONTENT frame
// kind (doc bodies + run records for an assignment's subtree). The literal lives in
// ONE home (the builder module) — imported here, never re-spelled, the same
// discipline as RECOVERY_PUSH_RESULT_KIND / TERMINAL_FRAME_KIND above.
import { WORKTREE_CONTENT_FRAME_KIND, LOG_ENTRIES_FRAME_KIND } from "./worker-stream-client.mjs";
import { redactDescriptor } from "./global-node-registry.mjs";
import { publishPresenceRecord } from "./mesh-presence.mjs";
// m43 / ADR-003 + ADR-004 — `activeScopeHolders` is the ONE derivation of "which
// execution scopes are held"; this door reads it and hands the answer to the upsert seam
// as data, so the store module itself never queries the assignment table (ADR-011/A1).
import { isActiveAssignmentState, activeScopeHolders } from "./assignment-record.mjs";
// m42 wave (d) leg d3 — the SHARED assignment transition (holder + terminal-never-
// regresses guards live in front of the write there, for every writer, and the
// settle raises its declared cascade).
import { transitionAssignmentState } from "./effects/assignment-transitions.mjs";
// m42 wave (d) leg d3 — the bridge fact door: the closed vocabulary, the control
// node's own journal, and the control-reachable drain.
import { effectsFor } from "./effects/table.mjs";
import { openEffectsJournal, appendEvent } from "./effects/journal.mjs";
import { drainEffects, CONTROL_LOCI } from "./effects/dispatch.mjs";
import { EFFECT_STEP_FRAME_KIND, EFFECT_ACK_FRAME_KIND } from "./effects/outbox.mjs";
// milestone 38 / story 06 (ADR-014 AMENDMENT 2026-07-19, closing BLOCKER F-38.06) —
// the NEW opaque `terminal-frame` kind the worker sends UP its stream client (the
// cross-machine leg). This server BRANCHES it BEFORE applyStreamFrame into an injected
// onTerminalFrame sink and NEVER store-applies it (ADR-014 inv.3: terminal frames are
// a live view, never persisted). The single source of the kind literal.
import { TERMINAL_FRAME_KIND } from "./mesh-terminal-relay-bridge.mjs";
// VERIFICATION (live soak 2026-07-25) — the control-driven recovery push. This server
// receives the worker's `recovery-push-result` UP-frame and settles the recovery
// request row through applyRecoveryPushResultFrame (holder-gated on the SAME T6
// connection-bound nodeId every other apply* uses). The DOWN-frame + tick live in
// mesh-recovery-push.mjs; only the result-apply is dispatched here.
import { RECOVERY_PUSH_RESULT_KIND, applyRecoveryPushResultFrame } from "./mesh-recovery-push.mjs";
// m43 / story 04 (ADR-010/R4.2) — the RESYNC result UP-frame, the same discipline one
// mechanism over: the wire-kind literal and the apply live in mesh-resync.mjs (the ONE
// contract home) and are dispatched here, never re-spelled.
import { RESYNC_RESULT_KIND, applyResyncResultFrame } from "./mesh-resync.mjs";
// VERIFICATION (continue-on-existing-branch, 2026-07-25) — when a worker reports a `done`
// carrying the branch it pushed, record it as the item's active mesh branch so the next
// continue/verify dispatch reuses it (the work accumulates on ONE branch per item).

// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// isRevokedLocal(registry, nodeId) — milestone 35 / ADR-002, story 01 task 01
// (SECURITY T2). A deliberate LOCAL re-implementation of mesh-registry.mjs's
// isRevoked(registry, nodeId) predicate (mesh-registry.mjs:256-260, verbatim
// two-line `.some()` shape) — NOT an import of that module. 34/ADR-007 (this
// module's own docstring, above) draws a hard line: control-stream-server.mjs
// never imports mesh-registry.mjs's credential/enrollment gate
// (acd-control-stream-tailnet-only's "no token/device-code" invariant); admission
// here is `isTailnetPeer`, a DIFFERENT, lighter predicate. T2's revocation check
// is a tiny, stable, SEMANTIC-only fact ("is this nodeId in the live
// revocations list") that does not warrant pulling in mesh-registry.mjs's much
// larger roster/credential/enrollment surface — replicating the 3-line predicate
// keeps that architectural boundary intact while still honouring SECURITY T2's
// live-re-read discipline (the caller's getMeshRegistry() is called fresh, this
// function itself holds no state).
function isRevokedLocal(registry, nodeId) {
  if (nodeId == null) return false;
  const revocations = registry?.revocations ?? [];
  return revocations.some((entry) => entry?.nodeId === nodeId);
}

// isTailnetPeer(origin, { peerNodeIds }) — the ADMISSION PREDICATE: a tailnet peer is
// one whose resolved nodeId (via the fabric join, mesh-fabric.resolvePeers) is a
// member of the CURRENT peer set. `origin` is a { nodeId } shape carrying the
// connecting node's identity (production resolves this from the fabric's remote
// address → nodeId join at connect time; tests inject the origin directly — the
// STORY.md "injected peer-identity signal, mirroring mesh-fabric's injected exec").
// A null/unresolved nodeId is NEVER a peer (fail-closed).
export function isTailnetPeer(origin, { peerNodeIds } = {}) {
  const nodeId = typeof origin?.nodeId === "string" && origin.nodeId.length > 0 ? origin.nodeId : null;
  if (nodeId == null) return false;
  const roster = peerNodeIds instanceof Set ? peerNodeIds : new Set(peerNodeIds ?? []);
  return roster.has(nodeId);
}

// validFrameAt(value) — review fix P2.9: a `frame.at` is only trustworthy as a
// last_published_at value when it PARSES as a real instant; a non-ISO/garbage
// `frame.at` (a malformed or hostile worker frame) must never land verbatim in the
// store — the server clock (`now()`, the trustworthy source) is used instead.
function validFrameAt(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)) ? value : null;
}

// resolveKnownWorkspaceRoot(store, workspaceId) — a worker's snapshot/delta frame
// carries no projectRoot/workDir of its own (only a workspaceId), so applying it
// must never treat the bare id AS a path: path.resolve()-ing a bare id inside
// publishWorkspaceSnapshot silently fabricates an absolute-looking path rooted at
// THIS process's cwd (bug found live 2026-07-18: a worker report for an id this
// control node didn't recognise overwrote nothing existing, but a KNOWN workspace's
// real project_root would have been clobbered the same way on its very next report).
// The canonical descriptor (global_workspace_descriptors, ADR-010's committed
// registration — every real workspace lands here via `mesh:join`/`mesh repo
// publish` before any worker can be assigned to it, the same gate mesh-assign.mjs's
// resolveTarget already requires) is the ONLY source of truth; the caller REFUSES
// the frame outright when it returns null rather than falling back to a fabricated
// path (tightened 2026-07-18 — ADR-010 postdates ADR-006's original "any worker may
// report" design, and every legitimate reporter is registered by the time it can
// report at all).
function resolveKnownWorkspaceRoot(store, workspaceId) {
  const descriptor = store.db.prepare(
    "SELECT project_root, work_dir FROM global_workspace_descriptors WHERE workspace_id = ?"
  ).get(workspaceId);
  return descriptor?.project_root
    ? { projectRoot: descriptor.project_root, workDir: descriptor.work_dir || descriptor.project_root }
    : null;
}

// applyReportedRows(store, frame, options, kind) — the ONE body behind both row-frame
// doors (m43/ADR-004: `applyDeltaFrame` collapses to a call on the shared upsert seam,
// and `applySnapshotFrame` collapses the same way, for the same reason).
//
// WHAT COLLAPSED, AND WHY IT EXISTED. Both doors used to feed `publishWorkspaceSnapshot`
// — the wholesale DELETE-then-reinsert writer — so a delta first had to READ the
// workspace's rows, MERGE itself over them by ref, and re-publish the whole set, and a
// snapshot simply REPLACED every row in the workspace with whatever subtree the worker
// happened to send. Both dances existed only to feed a writer that could not update one
// row. With a row upsert the frame's rows pass straight through, and with them go two
// hazards: the P0.3 collateral rollback (one unstorable row aborting the whole frame's
// transaction and silently dropping every other item in it) and the snapshot frame's
// power to remove rows it never named.
//
// A frame is a node REPORTING ITS OWN SLICE (`authority: "reported"`), so it is never
// filtered by who authored the cached row — that is what reporting means, and filtering
// it is the ADR-011/A1 regression. It carries no authoritative ref set, so it retracts
// NOTHING: a worker speaks for the subtree it is working, never for the workspace.
//
// SECURITY T6, unchanged and now load-bearing for authorship: the row is stamped with the
// identity the CONNECTION authenticated as (`options.nodeId`), never a self-reported
// `frame.nodeId` alone — the same precedence applyWorktreeContentFrame/applyPresenceFrame
// keep. A frame arriving on worker-a's socket can never write a row attributed to
// worker-b, which is what stops an impostor retracting another node's work later.
//
// A frame for a workspaceId with no registered descriptor is still REFUSED — never
// published under a fabricated path (see resolveKnownWorkspaceRoot above).
async function applyReportedRows(store, frame, options, kind) {
  const known = resolveKnownWorkspaceRoot(store, frame.workspaceId);
  if (known == null) {
    return { published: false, skipped: true, code: "unknown-workspace", workspaceId: frame.workspaceId };
  }
  const redactedItems = redactDescriptor(frame.items ?? []);
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const nodeId = ownerNode ?? frameNode;
  if (nodeId == null) {
    return { published: false, skipped: true, code: "missing-node-id", workspaceId: frame.workspaceId };
  }
  // review fix P2.9, kept: a malformed frame.at falls back to the server clock, never a
  // verbatim non-ISO string written into the row's provenance stamp.
  const at = options?.now ?? validFrameAt(frame.at) ?? new Date().toISOString();
  // The ADR-003 lock's answer, read HERE and handed to the seam as data (ADR-011/A1: the
  // store module reads no `global_assignments` state). It refuses a frame from a node
  // that is NOT the holder of the ref's execution scope, and never touches the holder's
  // own frames — `activeScopeHolders` is the one derivation every rendering of the lock
  // shares.
  const result = upsertWorkItems(store, frame.workspaceId, redactedItems, {
    nodeId,
    authority: "reported",
    syncedAt: at,
    heldScopes: activeScopeHolders(store, frame.workspaceId),
  });
  return {
    published: true,
    kind,
    workspaceId: frame.workspaceId,
    nodeId,
    itemCount: result.upserted,
    upserted: result.upserted,
    skippedRows: result.skipped,
    retracted: result.retracted,
    publishedAt: result.syncedAt,
  };
}

// applySnapshotFrame(store, frame, options) — a worker's FULL row set for the subtree it
// is working. It ADDS and UPDATES the refs it carries and removes nothing else: the
// frame's scope is the worker's worktree, never the workspace, so it claims authority
// over nothing it did not name.
export async function applySnapshotFrame(store, frame, options = {}) {
  return applyReportedRows(store, frame, options, "snapshot");
}

// applyDeltaFrame(store, frame, options) — the same door for a partial report. This is
// how "a delta reports the running item completed" ends up `done` in the store: the
// frame's row for that ref lands, on its own, with the reporting node stamped on it.
export async function applyDeltaFrame(store, frame, options = {}) {
  return applyReportedRows(store, frame, options, "delta");
}

// applyWorktreeContentFrame(store, frame, options) — schema v5 (TECH_DEBT item 6):
// writes a worker's streamed record-doc bodies + run records into the projection's
// content tables, behind the SAME descriptor gate as applySnapshotFrame /
// applyDeltaFrame (a frame for a workspaceId with no registered descriptor is
// REFUSED — the refusal reaches onFrameSkipped via the accept loop, never silence).
// The stored node_id is the CONNECTION-bound identity (options.nodeId, the T6
// discipline every apply* keeps), so the board can say WHOSE view a body is.
export async function applyWorktreeContentFrame(store, frame, options = {}) {
  const known = resolveKnownWorkspaceRoot(store, frame.workspaceId);
  if (known == null) {
    return { published: false, skipped: true, code: "unknown-workspace", workspaceId: frame.workspaceId };
  }
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const nowValue = typeof options.now === "function" ? options.now() : options.now;
  return upsertWorkItemContent(store, frame.workspaceId, {
    docs: frame.docs,
    runs: frame.runs,
    nodeId: ownerNode ?? frameNode,
  }, { now: validFrameAt(nowValue) ?? validFrameAt(frame.at) ?? new Date().toISOString() });
}

// applyLogEntriesFrame(store, frame, options) — m42 / item 2's remote read: a
// worker's log events land in the node_logs ring, attributed to the
// CONNECTION-bound nodeId (T6 — a frame on worker-a's socket can never write
// worker-b's log), ring-bounded by the one writer (appendNodeLogEntries).
export async function applyLogEntriesFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const nodeId = ownerNode ?? frameNode;
  if (nodeId == null) return { published: false, skipped: true, code: "missing-node-id" };
  const result = appendNodeLogEntries(store, nodeId, frame?.entries ?? []);
  return { published: true, nodeId, appended: result.appended };
}

function safeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

// The presence record's ADR-001 additive fifth key. A worker's live-session
// projection ({ workspaceId, repo, assistant, lastPingAt }) is ALREADY TTL-filtered
// by the publisher (assembleCurrentPresenceRecord) before it rides the fabric, so —
// exactly like activeRuns — the control carries it through VERBATIM and never
// re-derives it (it holds no session records of its own; the worker is the single
// filtering authority, and a dead worker's whole record is gated stale anyway).
// WHY THIS EXISTS: applyPresenceFrame originally rebuilt only the m23 four keys, so a
// REMOTE node's `sessions` was silently dropped as its presence crossed the fabric —
// the node read `idle` on the control's fleet even while actively worked on (SPEC
// objective (a), this milestone's own headline, failing across the very boundary the
// milestone is named for). The single-machine soaks never hit this path: the control's
// OWN presence is written by assemblePresenceRecord, never through here.
function safeSessionArray(value) {
  return Array.isArray(value)
    ? value.filter((entry) => entry != null && typeof entry === "object" && !Array.isArray(entry))
    : [];
}

export async function applyPresenceFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const presence = frame?.presence && typeof frame.presence === "object" ? frame.presence : {};
  const nodeId = ownerNode ?? frameNode ?? (typeof presence.nodeId === "string" && presence.nodeId.length > 0 ? presence.nodeId : null);
  if (nodeId == null) return { published: false, skipped: true, code: "missing-node-id" };
  const nowValue = typeof options.now === "function" ? options.now() : options.now;
  const heartbeatAt = validFrameAt(presence.heartbeatAt) ?? validFrameAt(frame?.at) ?? validFrameAt(nowValue) ?? new Date().toISOString();
  const record = {
    nodeId,
    heartbeatAt,
    activeRuns: safeStringArray(presence.activeRuns),
    // ADR-001 key order: sessions BEFORE the trailing aofVersion provenance string.
    sessions: safeSessionArray(presence.sessions),
    aofVersion: typeof presence.aofVersion === "string" ? presence.aofVersion : "",
    // m42 wave (c) / item 1 — the sixth additive key: the worker's build stamp,
    // carried through the wire gate the same way aofVersion is (this whitelist is
    // the DELIBERATE one — a new presence key is taught here, at the one wire seam).
    ...(typeof presence.buildId === "string" && presence.buildId.length > 0 ? { buildId: presence.buildId } : {}),
  };
  const workspace = options.presenceWorkspace ?? { globalMeshRoot: store?.paths?.meshRoot };
  await publishPresenceRecord(workspace, nodeId, record);
  return { published: true, nodeId, record };
}

// applyAssignmentStatusFrame(store, frame, options) — milestone 35 / story 01, task
// 02: the up-frame { kind:"assignment-status", nodeId, assignmentId, state, runId?,
// at } write-throughs the worker-reported lifecycle transition into ADR-001's
// dedicated writer (updateAssignmentState). SECURITY T6: the transition is authored
// from the CONNECTION's authenticated nodeId (options.nodeId, bound at connection
// time — the SAME ownerNode ?? frameNode precedence applyPresenceFrame uses above,
// :120-124), never a self-reported frame.nodeId alone — a frame arriving on
// worker-a's connection can never advance an assignment held by worker-b, even if
// the frame's own `nodeId` field claims to BE worker-b. R4(m23) build note: this
// validates the frame's SHAPE (assignmentId/state present, holder matches) before
// any protocol-layer limit — the contract-frame check fires first.
export async function applyAssignmentStatusFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const connectionNodeId = ownerNode ?? frameNode;
  const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
  const state = typeof frame?.state === "string" && frame.state.length > 0 ? frame.state : null;
  if (connectionNodeId == null || assignmentId == null || state == null) {
    return { applied: false, skipped: true, code: "assignment-status-frame-invalid" };
  }

  // m42 wave (d) leg d3 — THE GUARDS MOVED. The T6 holder check and the
  // terminal-never-regresses invariant (with its one sanctioned resume revival)
  // used to be decided HERE, because this seam is the only door worker frames
  // come through — which left the withdraw verb re-deriving a weaker version and
  // the reclaim tick with none. They now live in front of the write, in
  // effects/assignment-transitions.mjs, so EVERY writer inherits them; this
  // handler keeps only what is genuinely frame-shaped (shape-guarding the frame,
  // reading the connection's authenticated nodeId, deciding the absent-is-not-a-
  // clear vs verbatim-per-frame discipline per key) and hands the edge over. The
  // refusal codes are unchanged — they are the transition's vocabulary now.
  const now = options.now ?? new Date().toISOString();
  const runId = typeof frame?.runId === "string" && frame.runId.length > 0 ? frame.runId : undefined;
  // milestone 38 / story 06 / task 04 (BLOCKER F-38.06c; ADR-013 invariant 3 +
  // ADR-014 invariant 4) — the worker ALREADY sends its captured `session_id` on
  // this frame (`worker-stream-client.mjs` buildAssignmentStatusFrame's optional
  // `sessionId` key, a literal production call site); the control node used to read
  // ONLY `runId` off it and drop the join key on the floor, so the fleet could
  // never resolve WHICH (nodeId, sessionId) stream an assignment's card should
  // open. Read with the SAME shape-guard + absent-is-not-a-clear discipline as
  // `runId`: `undefined` (no session id on this frame) leaves any
  // previously-captured value intact in updateAssignmentState.
  const sessionId = typeof frame?.sessionId === "string" && frame.sessionId.length > 0 ? frame.sessionId : undefined;
  // m42 interactive worker terminals — the status-refinement `code` (e.g.
  // `needs-input`) is persisted VERBATIM PER FRAME (a code-less frame CLEARS it),
  // deliberately unlike runId/sessionId's absent-is-not-a-clear: the code
  // describes the CURRENT posture of the session (waiting on a human right now),
  // not a captured fact, so each frame's word is the whole truth.
  const code = typeof frame?.code === "string" && frame.code.length > 0 ? frame.code : null;
  // The branch a `done` frame reports rides the EDGE into the transition, whose
  // `assignment.settled` event carries it as evidence to the `record-item-branch`
  // reactor (control-store locus). The inline write that lived here is deleted:
  // "a done means the push succeeded, so record the branch" is a declared
  // consequence now, not a line every future writer must remember.
  const branch = typeof frame?.branch === "string" && frame.branch.length > 0 ? frame.branch : null;
  const result = await transitionAssignmentState(
    store,
    assignmentId,
    state,
    { byNode: connectionNodeId, now, runId, sessionId, code, branch },
    { journalOptions: options.journalOptions ?? {} },
  );
  // An idempotent terminal repeat reports as applied:false with the settled row —
  // the pre-d3 seam wrote nothing new in that case either (it refused it), and no
  // caller reads `idempotent`; it exists for the drill and the tests.
  return result;
}

// buildEffectAckFrame(to, { eventId, reactorKey, ok, code, at }) — the DURABLE
// RECEIPT for one outbox-delivered effect step (m42 wave (d) leg d3). Correlated
// by (eventId, reactorKey) — the async-RPC id the PRD asks for — and addressed
// back to the delivering connection alone, never fanned out. `code` is present
// ONLY on a refusal, the buildCloneCredentialFrame convention.
function buildEffectAckFrame(to, { eventId, reactorKey, ok = false, code, at }) {
  const frame = { kind: EFFECT_ACK_FRAME_KIND, to, eventId, reactorKey, ok, at };
  if (typeof code === "string" && code.length > 0) frame.code = code;
  return frame;
}

// applyEffectStepFrame(store, frame, options) — THE BRIDGE'S FACT DOOR (m42 wave
// (d) leg d3). A worker ships an owed remote-locus effect step here; this handler
// is deliberately thin, exactly the PRD's "apply-handlers reduce to guard +
// append into control's OWN journal, whose tick drains the same effects table":
//
//   GUARD  — the frame must name a known event in THIS build's closed vocabulary
//            and a reactor that event actually declares (vocabulary drift across
//            a mixed-version fleet is refused loudly, never guessed at), and it
//            must carry the connection's authenticated identity. Nothing about
//            the fact itself is re-decided here: the reactor's own transition
//            seam owns the holder and terminal guards, so a worker cannot use
//            this door to write something the status-frame door would refuse.
//   APPEND — the step is materialised in the CONTROL node's own journal, so the
//            fact is durable here before it is executed. A crash between append
//            and drain leaves a pending step the control tick pays.
//   DRAIN  — the just-appended step runs with CONTROL_LOCI.
//   ACK    — the outcome goes back as the receipt. Anything but a clean `done`
//            keeps the worker's copy pending (a fault) or ends it (a coded
//            refusal the control node has decided) — the worker's outbox owns
//            that distinction; this side just reports honestly.
export async function applyEffectStepFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const connectionNodeId = ownerNode ?? frameNode;
  const eventId = typeof frame?.eventId === "string" && frame.eventId.length > 0 ? frame.eventId : null;
  const reactorKey = typeof frame?.reactorKey === "string" && frame.reactorKey.length > 0 ? frame.reactorKey : null;
  const name = typeof frame?.name === "string" && frame.name.length > 0 ? frame.name : null;
  const now = options.now ?? new Date().toISOString();
  const directiveTargets = options.directiveTargets ?? null;

  const reply = (ok, code) => {
    if (connectionNodeId != null && directiveTargets != null) {
      sendDirective(directiveTargets, connectionNodeId, buildEffectAckFrame(connectionNodeId, { eventId, reactorKey, ok, code, at: now }));
    }
    return ok ? { applied: true, eventId, reactorKey } : { applied: false, skipped: true, code };
  };

  if (connectionNodeId == null || eventId == null || reactorKey == null || name == null) {
    return reply(false, "effect-step-frame-invalid");
  }
  const declared = effectsFor(name);
  if (declared == null) return reply(false, "effect-step-unknown-event");
  const reactor = declared.find((entry) => entry.key === reactorKey);
  if (reactor == null) return reply(false, "effect-step-unknown-reactor");

  let journal = null;
  try {
    journal = await openEffectsJournal(options.journalOptions ?? {});
  } catch (error) {
    // The control's ledger is unavailable: refuse with a RETRYABLE fault (no
    // code), so the worker keeps the step pending and redelivers. Never a silent
    // drop, and never a pretend-ack.
    reportDegrade("effects-journal-open", error);
    return reply(false, null);
  }

  try {
    // The event is appended with ONLY the shipped reactor owed — the worker owns
    // the rest of its own cascade (its checkout/local steps ran there).
    const appended = appendEvent(
      journal,
      { name, payload: frame.payload ?? {}, source: `bridge:${connectionNodeId}`, now },
      [reactor],
    );
    const outcomes = await drainEffects({
      journal,
      eventId: appended.eventId,
      loci: CONTROL_LOCI,
      now,
      ctx: { store, now, byNode: connectionNodeId, journalOptions: options.journalOptions ?? {} },
    });
    // THE RECEIPT VOCABULARY, and the distinction that keeps redelivery finite:
    //   ran cleanly, or consciously skipped -> ok. The fact is received and the
    //     obligation is over (a skip IS a decision: "this state is not mine to
    //     settle"), so the worker stops redelivering.
    //   a DECIDED refusal (the transition's coded verdicts — not-holder,
    //     already-terminal) -> that code. The worker ends the step too: retrying
    //     against a decision returns the same decision forever.
    //   anything else (a reactor fault, an unknown reactor) -> a bare failure.
    //     The worker keeps it owed and tries again.
    const outcome = outcomes[0] ?? null;
    const decided = outcome?.detail?.code ?? null;
    if (outcome?.status === "done") {
      if (decided) return reply(false, decided);
      return reply(true);
    }
    return reply(false, outcome?.status === "skipped" ? "effect-step-unknown-reactor" : null);
  } finally {
    journal.close();
  }
}

// defaultMintCloneCredential(workspaceId, assignmentId) — milestone 38 / ADR-009: the
// CONTROL-NODE-SIDE credential SOURCE seam (SECURITY T4's minting AUTHORITY — an
// Accepted, operator-verified residual; this ADR chooses the CHANNEL + the seam, NEVER
// the TTL/scope/authority). The DEFAULT reads a single operator-provisioned token from
// THIS control node's own environment — `process.env.AOF_MESH_CLONE_TOKEN` — never a
// COMMITTED config key (`config.mesh.repo.cloneUrl` is fleet-shared and committed; a
// real credential must NEVER be committed alongside it). Absent/blank resolves to
// `null` — a legitimate "no credential configured for this workspace" reply (the
// public-repo path), never a refusal. An operator wiring a real per-repo, short-lived
// mint (a forge App token, a CI secrets store, …) supplies their OWN
// `mintCloneCredential(workspaceId, assignmentId)` at `startControlStreamServer(...)` /
// mesh-launcher.mjs's `controlStreamServerOptions`, closing over whatever real minting
// authority they run — this default is deliberately the simplest thing that could
// possibly work for a single-repo fleet, never a policy prescription (no fitness
// function asserts a server-side minting policy — SECURITY, verbatim).
//
// EXPORTED as of milestone 38 / story 02 (ADR-010) so the new config-selected
// provider seam (src/mesh-clone-credential-provider.mjs's `resolveCloneCredentialProvider`)
// can return this EXACT function reference for the `env-token` path — byte-identical
// behaviour, never a re-implementation. This module still gains NO `config` dependency
// and stays transport-pure; only its visibility changed.
export function defaultMintCloneCredential(/* workspaceId, assignmentId */) {
  const token = process.env.AOF_MESH_CLONE_TOKEN;
  return typeof token === "string" && token.length > 0 ? token : null;
}

// buildCloneCredentialFrame(to, { assignmentId, credential, code, at }) — the DOWN-half
// of the milestone 38 / ADR-009 clone-credential PULL: { kind: "clone-credential", to,
// assignmentId, credential, at }, plus an OPTIONAL `code` key present ONLY on a
// refusal (never on a normal reply — whether that reply carries a real token or an
// explicit `credential: null` "not needed" decision). A NET-NEW frame kind, purely
// ADDITIVE alongside the FROZEN `buildDirectiveFrame` five-key projection (35/ADR-002)
// below — this frame is never pushed onto, and never read from, the directive frame.
function buildCloneCredentialFrame(to, { assignmentId, credential = null, code, at }) {
  const frame = { kind: "clone-credential", to, assignmentId, credential, at };
  if (typeof code === "string" && code.length > 0) frame.code = code;
  return frame;
}

// buildCloneUrlFrame(to, { assignmentId, cloneUrl, code, at }) — review fix (ADR-010
// Gap A extended, live soak 2026-07-18): the SAME down-frame shape as
// buildCloneCredentialFrame above, for the cloneUrl PULL — purely additive
// alongside the frozen buildDirectiveFrame, never pushed onto and never read
// from the directive frame.
function buildCloneUrlFrame(to, { assignmentId, cloneUrl = null, code, at }) {
  const frame = { kind: "clone-url", to, assignmentId, cloneUrl, at };
  if (typeof code === "string" && code.length > 0) frame.code = code;
  return frame;
}

// The LOUD coded refusals (never a silent empty reply) applyCloneCredentialRequestFrame
// (below) can reply with.
export const CLONE_CREDENTIAL_NOT_HOLDER = "clone-credential-not-holder";
export const CLONE_CREDENTIAL_UNKNOWN_ASSIGNMENT = "clone-credential-unknown-assignment";
export const CLONE_CREDENTIAL_REQUEST_INVALID = "clone-credential-request-invalid";
export const CLONE_CREDENTIAL_MINT_FAILED = "clone-credential-mint-failed";
// SECURITY T6 / finding F15 (High) — the requester-supplied frame.workspaceId is
// NEVER trusted as the mint's scope: it must match the assignment row's OWN
// workspace_id, or the mint is refused outright (never silently substituted with the
// row's value — a mismatch is a loud, coded, ATTACK-SHAPED refusal, not a quiet
// correction, so a probing/compromised worker gets no signal about which repos exist
// in the fleet).
export const CLONE_CREDENTIAL_WORKSPACE_MISMATCH = "clone-credential-workspace-mismatch";
// SECURITY T6 / finding F16 (Medium) — a terminal (done/failed/withdrawn/reclaimed) or
// otherwise non-active assignment mints nothing, ever — a worker that finished, or was
// taken off the work by control, cannot keep pulling fresh repo credentials against it.
export const CLONE_CREDENTIAL_ASSIGNMENT_INACTIVE = "clone-credential-assignment-inactive";

// applyCloneCredentialRequestFrame(store, frame, options) — milestone 38 / ADR-009: the
// up-frame { kind:"clone-credential-request", nodeId, assignmentId, workspaceId, at } a
// worker sends ONLY on an actual clone miss, over the ALREADY-OPEN persistent stream
// (a new branch in applyStreamFrame's dispatch, below).
//
// AUTHORIZATION reuses applyAssignmentStatusFrame's EXACT holder check (SECURITY T6,
// above): only the assignment's `target_node_id` (its HOLDER) may ask, resolved from
// the CONNECTION's authenticated nodeId (options.nodeId, bound at connection time),
// NEVER a self-reported frame.nodeId. A non-holder — or an unknown assignment, or a
// malformed request — is refused LOUDLY: a CODED `clone-credential` reply is sent
// straight back down the SAME directiveTargets targeting map sendDirective already
// uses (never a silent drop, never a mint attempt).
//
// On authorization, calls the INJECTED `options.mintCloneCredential(existing.workspace_id,
// assignmentId)` — the ASSIGNMENT ROW's OWN workspaceId, NEVER the requester-supplied
// `frame.workspaceId` (SECURITY T6 / finding F15: minting on unverified requester
// input is a privilege-escalation seam — a holder of any assignment could otherwise
// name an arbitrary workspaceId and mint a credential for a repo it was never
// assigned) — and only for an assignment still in an ACTIVE state (SECURITY T6 /
// finding F16: a terminal/withdrawn/reclaimed assignment mints nothing, ever).
// Default `defaultMintCloneCredential`, T4's minting-policy residual. Replies with
// the `clone-credential` down-frame, addressed back to the REQUESTER's own connection
// (never a fan-out — the same one-target discipline sendDirective already enforces).
// A mint fault degrades to a loud coded refusal reply rather than leaving the worker
// to exhaust its own bounded wait.
export async function applyCloneCredentialRequestFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const connectionNodeId = ownerNode ?? frameNode;
  const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
  const workspaceId = typeof frame?.workspaceId === "string" && frame.workspaceId.length > 0 ? frame.workspaceId : null;
  const now = options.now ?? new Date().toISOString();
  const directiveTargets = options.directiveTargets ?? null;

  const refuse = (code) => {
    if (connectionNodeId != null && directiveTargets != null) {
      sendDirective(directiveTargets, connectionNodeId, buildCloneCredentialFrame(connectionNodeId, { assignmentId, credential: null, code, at: now }));
    }
    return { applied: false, skipped: true, code };
  };

  if (connectionNodeId == null || assignmentId == null || workspaceId == null) {
    return refuse(CLONE_CREDENTIAL_REQUEST_INVALID);
  }

  const existing = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId);
  if (!existing) {
    return refuse(CLONE_CREDENTIAL_UNKNOWN_ASSIGNMENT);
  }
  // T6: the CONNECTION's authenticated nodeId must be the row's holder — the identical
  // check applyAssignmentStatusFrame already applies. A worker can therefore only ever
  // ASK about an assignment it ACTUALLY holds — but holding the assignment alone does
  // NOT yet authorize a mint; the workspace-match and active-state gates below still
  // apply before anything is minted.
  if (existing.target_node_id !== connectionNodeId) {
    return refuse(CLONE_CREDENTIAL_NOT_HOLDER);
  }

  // SECURITY T6 / F15 (High, privilege escalation) — the mint is scoped to the
  // ASSIGNMENT ROW's OWN workspace_id, never the requester-supplied frame.workspaceId.
  // The holder check above only proves the requester holds `assignmentId`; it says
  // NOTHING about which workspace the frame claims — a holder of ANY assignment could
  // otherwise name an arbitrary `workspaceId` and mint a credential for a repo it was
  // never assigned. A mismatch is refused outright, never silently substituted with
  // the row's real value (a quiet correction would still hand the requester a working
  // credential for a repo it didn't ask to be scoped to, and would leak nothing about
  // WHY to a legitimate caller debugging a stale local workspaceId).
  if (workspaceId !== existing.workspace_id) {
    return refuse(CLONE_CREDENTIAL_WORKSPACE_MISMATCH);
  }

  // SECURITY T6 / F16 (Medium, terminal-state reuse) — a terminal or otherwise
  // non-active assignment mints NOTHING. Reuses assignment-record.mjs's OWN active-
  // state predicate (never a second, drifting copy of the state list) — a worker that
  // already reached done/failed, or was withdrawn/reclaimed OFF the assignment by
  // control, cannot keep pulling fresh repo credentials against it indefinitely.
  if (!isActiveAssignmentState(existing.state)) {
    return refuse(CLONE_CREDENTIAL_ASSIGNMENT_INACTIVE);
  }

  const mint = typeof options.mintCloneCredential === "function" ? options.mintCloneCredential : defaultMintCloneCredential;
  let credential = null;
  try {
    credential = await mint(existing.workspace_id, assignmentId);
  } catch {
    return refuse(CLONE_CREDENTIAL_MINT_FAILED);
  }
  const resolved = typeof credential === "string" && credential.length > 0 ? credential : null;

  if (directiveTargets != null) {
    sendDirective(directiveTargets, connectionNodeId, buildCloneCredentialFrame(connectionNodeId, { assignmentId, credential: resolved, at: now }));
  }
  return { applied: true, minted: resolved != null, assignmentId, workspaceId };
}

// The LOUD coded refusals for the clone-url PULL (review fix, ADR-010 Gap A
// extended, live soak 2026-07-18) — the SAME shape as the clone-credential
// refusals above, minus a mint-failure code: this is a plain DB read, nothing to
// fail to mint.
export const CLONE_URL_NOT_HOLDER = "clone-url-not-holder";
export const CLONE_URL_UNKNOWN_ASSIGNMENT = "clone-url-unknown-assignment";
export const CLONE_URL_REQUEST_INVALID = "clone-url-request-invalid";
export const CLONE_URL_WORKSPACE_MISMATCH = "clone-url-workspace-mismatch";

// applyCloneUrlRequestFrame(store, frame, options) — review fix (ADR-010 Gap A
// extended, live soak 2026-07-18): the SAME shape as applyCloneCredentialRequestFrame
// above — the up-frame { kind:"clone-url-request", nodeId, assignmentId,
// workspaceId, at } a worker sends on a clone-on-miss where its OWN local
// resolution came back null (mesh-worker-execution.mjs). Reuses the IDENTICAL
// holder + workspace-match authorization (SECURITY T6's F15 discipline applies
// here too, even though a cloneUrl is not a secret — a holder of any assignment
// must not be able to fish for an arbitrary workspace's repo location by naming
// a workspaceId it was never assigned). No mint, no minting authority: just the
// SAME clone_url column resolveWorkspaceCloneUrl (mesh-presence.mjs) reads,
// looked up directly against the CONTROL node's OWN local registry — the one
// place this value is actually known, since it is populated only by the
// workspace's own `aof mesh repo publish` (global-node-registry.mjs).
export async function applyCloneUrlRequestFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const connectionNodeId = ownerNode ?? frameNode;
  const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
  const workspaceId = typeof frame?.workspaceId === "string" && frame.workspaceId.length > 0 ? frame.workspaceId : null;
  const now = options.now ?? new Date().toISOString();
  const directiveTargets = options.directiveTargets ?? null;

  const refuse = (code) => {
    if (connectionNodeId != null && directiveTargets != null) {
      sendDirective(directiveTargets, connectionNodeId, buildCloneUrlFrame(connectionNodeId, { assignmentId, cloneUrl: null, code, at: now }));
    }
    return { applied: false, skipped: true, code };
  };

  if (connectionNodeId == null || assignmentId == null || workspaceId == null) {
    return refuse(CLONE_URL_REQUEST_INVALID);
  }

  const existing = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId);
  if (!existing) {
    return refuse(CLONE_URL_UNKNOWN_ASSIGNMENT);
  }
  if (existing.target_node_id !== connectionNodeId) {
    return refuse(CLONE_URL_NOT_HOLDER);
  }
  if (workspaceId !== existing.workspace_id) {
    return refuse(CLONE_URL_WORKSPACE_MISMATCH);
  }

  const row = store.db.prepare("SELECT clone_url FROM global_workspace_descriptors WHERE workspace_id = ?").get(existing.workspace_id);
  const resolvedCloneUrl = row != null && typeof row.clone_url === "string" && row.clone_url.length > 0 ? row.clone_url : null;

  if (directiveTargets != null) {
    sendDirective(directiveTargets, connectionNodeId, buildCloneUrlFrame(connectionNodeId, { assignmentId, cloneUrl: resolvedCloneUrl, at: now }));
  }
  return { applied: true, resolved: resolvedCloneUrl != null, assignmentId, workspaceId };
}

// defaultMintWriteCredential(/* workspaceId, assignmentId */) — milestone 38 / story
// 07 (ADR-015): the control-node-side WRITE-credential source seam, mirroring
// `defaultMintCloneCredential` above in EVERY discipline except scope — the honest
// default is "no write credential configured", `null`, NEVER a fallback to the
// read-scoped `defaultMintCloneCredential` (that would silently widen a clone
// credential to push authority — exactly the T15 attack (c) this story's whole
// two-token model exists to forbid) and never the `AOF_MESH_CLONE_TOKEN` env token
// either (that PAT is the T4/T9-scoped read credential; reusing it for a push would
// be the SAME widening under a different name). An operator wiring a real write mint
// (the `github-app` provider's `createGithubAppPushMintProvider`, task 02) supplies
// their OWN `mintWriteCredential(workspaceId, assignmentId)` at
// `startControlStreamServer(...)` / mesh-launcher.mjs's `controlStreamServerOptions` —
// this default is deliberately inert, never a policy prescription.
export function defaultMintWriteCredential(/* workspaceId, assignmentId */) {
  return null;
}

// buildWriteCredentialFrame(to, { assignmentId, credential, code, at }) — the DOWN-half
// of the story 07 write-credential PULL, the SAME shape as buildCloneCredentialFrame
// above with a DISTINCT `kind` ("write-credential", never "clone-credential") — the
// two seams stay wire-discriminable, mirroring the T15 two-seam mint split at the
// frame level too.
function buildWriteCredentialFrame(to, { assignmentId, credential = null, code, at }) {
  const frame = { kind: "write-credential", to, assignmentId, credential, at };
  if (typeof code === "string" && code.length > 0) frame.code = code;
  return frame;
}

// The LOUD coded refusals (never a silent empty reply) applyWriteCredentialRequestFrame
// (below) can reply with — the SAME shape as the clone-credential refusals above, one
// per gate.
export const WRITE_CREDENTIAL_NOT_HOLDER = "write-credential-not-holder";
export const WRITE_CREDENTIAL_UNKNOWN_ASSIGNMENT = "write-credential-unknown-assignment";
export const WRITE_CREDENTIAL_REQUEST_INVALID = "write-credential-request-invalid";
export const WRITE_CREDENTIAL_MINT_FAILED = "write-credential-mint-failed";
export const WRITE_CREDENTIAL_WORKSPACE_MISMATCH = "write-credential-workspace-mismatch";
export const WRITE_CREDENTIAL_ASSIGNMENT_INACTIVE = "write-credential-assignment-inactive";

// applyWriteCredentialRequestFrame(store, frame, options) — milestone 38 / story 07
// (ADR-015 decision 3; SECURITY T15). The up-frame
// { kind:"write-credential-request", nodeId, assignmentId, workspaceId, at } a worker
// sends ONLY at the push seam (on a `done` outcome, BEFORE `git push` —
// mesh-worker-execution.mjs), over the ALREADY-OPEN persistent stream (a new branch in
// applyStreamFrame's dispatch, below). AUTHORIZATION reuses
// applyCloneCredentialRequestFrame's EXACT three gates VERBATIM (SECURITY T6): holder
// check (the CONNECTION's authenticated nodeId, never a self-reported frame.nodeId),
// workspace-match (F15 — the assignment ROW's OWN workspace_id, never the
// requester-supplied frame.workspaceId), active-state (F16 — a terminal/withdrawn/
// reclaimed assignment mints nothing). A write grant is AT LEAST as sensitive as a
// read one, never less — the identical discipline applies unchanged.
//
// Calls the INJECTED `options.mintWriteCredential(existing.workspace_id, assignmentId)`
// — SAME two-argument shape as `mintCloneCredential`, deliberately carrying NO
// worker-frame-supplied scope (never an `autoPr` from the frame — that decision stays
// entirely CONTROL-side, closed over by whichever `mintWriteCredential` the operator
// wires, exactly as the clone mint's scope is never worker-influenced). Default
// `defaultMintWriteCredential` (inert, `null`). Replies with the `write-credential`
// down-frame, addressed back to the REQUESTER's own connection (never a fan-out). A
// mint fault degrades to a loud coded refusal reply rather than leaving the worker to
// exhaust its own bounded wait.
export async function applyWriteCredentialRequestFrame(store, frame, options = {}) {
  const ownerNode = typeof options?.nodeId === "string" && options.nodeId.length > 0 ? options.nodeId : null;
  const frameNode = typeof frame?.nodeId === "string" && frame.nodeId.length > 0 ? frame.nodeId : null;
  const connectionNodeId = ownerNode ?? frameNode;
  const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
  const workspaceId = typeof frame?.workspaceId === "string" && frame.workspaceId.length > 0 ? frame.workspaceId : null;
  const now = options.now ?? new Date().toISOString();
  const directiveTargets = options.directiveTargets ?? null;

  const refuse = (code) => {
    if (connectionNodeId != null && directiveTargets != null) {
      sendDirective(directiveTargets, connectionNodeId, buildWriteCredentialFrame(connectionNodeId, { assignmentId, credential: null, code, at: now }));
    }
    return { applied: false, skipped: true, code };
  };

  if (connectionNodeId == null || assignmentId == null || workspaceId == null) {
    return refuse(WRITE_CREDENTIAL_REQUEST_INVALID);
  }

  const existing = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId);
  if (!existing) {
    return refuse(WRITE_CREDENTIAL_UNKNOWN_ASSIGNMENT);
  }
  if (existing.target_node_id !== connectionNodeId) {
    return refuse(WRITE_CREDENTIAL_NOT_HOLDER);
  }
  if (workspaceId !== existing.workspace_id) {
    return refuse(WRITE_CREDENTIAL_WORKSPACE_MISMATCH);
  }
  if (!isActiveAssignmentState(existing.state)) {
    return refuse(WRITE_CREDENTIAL_ASSIGNMENT_INACTIVE);
  }

  const mint = typeof options.mintWriteCredential === "function" ? options.mintWriteCredential : defaultMintWriteCredential;
  let credential = null;
  try {
    credential = await mint(existing.workspace_id, assignmentId);
  } catch {
    return refuse(WRITE_CREDENTIAL_MINT_FAILED);
  }
  const resolved = typeof credential === "string" && credential.length > 0 ? credential : null;

  if (directiveTargets != null) {
    sendDirective(directiveTargets, connectionNodeId, buildWriteCredentialFrame(connectionNodeId, { assignmentId, credential: resolved, at: now }));
  }
  return { applied: true, minted: resolved != null, assignmentId, workspaceId };
}

// applyStreamFrame(store, frame, options) — dispatch by frame.kind. An unrecognised
// kind is a no-op (never a crash — the never-crash discipline every mesh module in
// this codebase keeps).
export async function applyStreamFrame(store, frame, options = {}) {
  if (frame?.kind === "snapshot") return applySnapshotFrame(store, frame, options);
  if (frame?.kind === "delta") return applyDeltaFrame(store, frame, options);
  if (frame?.kind === WORKTREE_CONTENT_FRAME_KIND) return applyWorktreeContentFrame(store, frame, options);
  if (frame?.kind === LOG_ENTRIES_FRAME_KIND) return applyLogEntriesFrame(store, frame, options);
  if (frame?.kind === "presence") return applyPresenceFrame(store, frame, options);
  if (frame?.kind === "assignment-status") return applyAssignmentStatusFrame(store, frame, options);
  if (frame?.kind === "clone-credential-request") return applyCloneCredentialRequestFrame(store, frame, options);
  if (frame?.kind === "clone-url-request") return applyCloneUrlRequestFrame(store, frame, options);
  if (frame?.kind === "write-credential-request") return applyWriteCredentialRequestFrame(store, frame, options);
  if (frame?.kind === EFFECT_STEP_FRAME_KIND) return applyEffectStepFrame(store, frame, options);
  if (frame?.kind === RECOVERY_PUSH_RESULT_KIND) return applyRecoveryPushResultFrame(store, frame, options);
  if (frame?.kind === RESYNC_RESULT_KIND) return applyResyncResultFrame(store, frame, options);
  return { published: false, skipped: true, code: "unknown-frame-kind" };
}

// THE STALENESS WINDOW — a connected worker with no heartbeat inside this window is
// "stale", not "live". A missing/malformed lastHeartbeatAt is treated as immediately
// stale (never silently "live" on absent data).
export const DEFAULT_HEARTBEAT_WINDOW_SECONDS = 30;

// streamLivenessLabel({ connected, lastHeartbeatAt, now, windowSeconds }) → "live" |
// "stale" | "disconnected". A PURE label over connection + heartbeat state — no
// wall-clock read (the `now` is always supplied by the caller, defaulting to
// Date.now() only in production).
export function streamLivenessLabel({ connected, lastHeartbeatAt, now, windowSeconds = DEFAULT_HEARTBEAT_WINDOW_SECONDS } = {}) {
  if (!connected) return "disconnected";
  if (typeof lastHeartbeatAt !== "string" || lastHeartbeatAt.length === 0) return "stale";
  const heartbeatMs = Date.parse(lastHeartbeatAt);
  const nowMs = typeof now === "string" ? Date.parse(now) : (now ?? Date.now());
  if (!Number.isFinite(heartbeatMs) || !Number.isFinite(nowMs)) return "stale";
  return nowMs - heartbeatMs <= windowSeconds * 1000 ? "live" : "stale";
}

// freshnessLabel({ connected, everConnected, lastHeartbeatAt, now, windowSeconds }) →
// "live" | "stale" | "never-connected" — task 03's THREE-state view label: a worker
// that is fabric-visible but has NEVER opened a stream is distinguished from one that
// streamed before and dropped.
export function freshnessLabel({ connected, everConnected, lastHeartbeatAt, now, windowSeconds } = {}) {
  if (!everConnected) return "never-connected";
  const label = streamLivenessLabel({ connected, lastHeartbeatAt, now, windowSeconds });
  return label === "disconnected" ? "stale" : label;
}

// buildDirectiveFrame(to, { assignmentId, itemRef, workspaceId, at, command }) — the
// down-frame (milestone 35 / ADR-002, story 01 task 00). A pure projection — the
// original five keys, no clock read other than the injected `at`.
//
// MILESTONE 38 / STORY 05 (ADR-013 invariant 2) — `command` is a NEW, ADDITIVE,
// OPTIONAL sixth key (included only when a non-empty string is supplied — the SAME
// conditional-inclusion pattern buildCloneCredentialFrame's own optional `code`
// already uses, never breaking a consumer that destructures only the original five):
// the assignment's WHOLE command string (`/aof:refine <ref> --autonomous`,
// `/aof:continue`, `/aof:verify <ref>`) the worker types into its interactive
// session's PTY stdin (mesh-worker-execution.mjs). This frame is otherwise
// byte-identical to its pre-story-05 shape.
// VERIFICATION (continue-on-existing-branch, 2026-07-25) — `baseBranch` is a NEW,
// ADDITIVE, OPTIONAL seventh key (same conditional-inclusion pattern as `command`): the
// EXISTING mesh branch a continue/verify must run ON (the item's active branch, resolved
// control-side from global_item_branches). When present the worker checks that branch out
// into the assignment's worktree instead of branching a fresh one from HEAD, so the work
// accumulates on ONE branch per item. Absent (a refine, or an item with no prior push) ⇒
// the worker's own fresh-branch default, byte-identical to before.
export function buildDirectiveFrame(to, { assignmentId, itemRef, workspaceId, at, command, baseBranch, commit }) {
  const frame = { kind: "directive", to, assignmentId, itemRef, workspaceId, at };
  if (typeof command === "string" && command.length > 0) frame.command = command;
  if (typeof baseBranch === "string" && baseBranch.length > 0) frame.baseBranch = baseBranch;
  // M42 base-commit pin (operator, 2026-08-01): the control checkout's HEAD at
  // dispatch time — the state this assignment was made against. A fresh worker
  // worktree builds from exactly this commit (fetching it if the clone is
  // stale), never from the clone's own stale HEAD. Absent (an unresolvable
  // checkout, an older control) the worker keeps its HEAD fallback.
  if (typeof commit === "string" && commit.length > 0) frame.commit = commit;
  return frame;
}

// createDirectiveTargetRegistry() — milestone 35 / ADR-002, story 01 task 00: the
// server-side `nodeId → ws` targeting map. Populated in wss.on("connection") and
// CLEARED on that same socket's close/error (never a stale route surviving a dropped
// connection — "a directive reaches a node only while its connection is live").
// `set` is keyed by nodeId (one live socket per node, the SAME identity the liveness
// registry tracks) so a reconnect naturally replaces the prior (now-dead) entry.
function createDirectiveTargetRegistry() {
  const byNodeId = new Map();
  return {
    set(nodeId, ws) {
      byNodeId.set(nodeId, ws);
    },
    // deleteIfCurrent — only clears the entry if IT is still the live socket for
    // that nodeId (a reconnect's NEW socket must never be clobbered by the OLD
    // socket's belated close/error handler firing after the new one already
    // registered).
    deleteIfCurrent(nodeId, ws) {
      if (byNodeId.get(nodeId) === ws) byNodeId.delete(nodeId);
    },
    get(nodeId) {
      return byNodeId.get(nodeId) ?? null;
    },
    // entries() — diagnostic-only introspection (review fix, live soak
    // 2026-07-17): the dispatch tick's own "not connected" skip previously had no
    // way to say WHAT it saw instead, making a stuck assignment indistinguishable
    // from "the whole mechanism is silently broken." Never used for admission/routing
    // decisions — only for a log line so a live daemon's own log answers "is my
    // target actually in the map, and is its socket really OPEN?" without guessing.
    entries() {
      return [...byNodeId.entries()].map(([nodeId, ws]) => ({ nodeId, readyState: ws?.readyState ?? null }));
    },
  };
}

// ASSIGNMENT_TARGET_NOT_CONNECTED — the LOUD coded refusal (ADR-002 / 34-ADR-008):
// a directive to a node with no live socket in the targeting map surfaces this code,
// never a silent drop, and writes NO frame to any socket.
export const ASSIGNMENT_TARGET_NOT_CONNECTED = "assignment-target-not-connected";

// sendDirective(targets, nodeId, directive) — resolves EXACTLY one socket from the
// targeting map (`targets.get(nodeId)`) and writes the directive frame to it. There
// is NO fan-out here — no `wss.clients` iteration, no "send to all" branch
// (`acd-directive-targets-one-peer`). A target with no live socket is a LOUD coded
// `assignment-target-not-connected` refusal — nothing is written anywhere.
export function sendDirective(targets, nodeId, directive) {
  const ws = targets.get(nodeId);
  if (ws == null || ws.readyState !== WebSocket.OPEN) {
    return { sent: false, code: ASSIGNMENT_TARGET_NOT_CONNECTED };
  }
  ws.send(JSON.stringify(directive));
  return { sent: true };
}

// dispatchDirectiveOverTargets(targets, directive, { getMeshRegistry }) — milestone
// 35 / ADR-002, story 01 task 01: the ONE composed control-side entry point (T5 + T2).
//
// SECURITY T5 (admission IS the trust boundary): `targets` (the nodeId -> ws
// registry) is populated EXCLUSIVELY inside wss.on("connection") — i.e. strictly
// post-admission, since the upgrade gate destroys any non-peer socket before a ws
// is ever emitted (:293-304 above). So resolving ANY socket from `targets` is, by
// construction, resolving an admitted, live tailnet-peer connection — there is no
// separate "is this a peer" re-check to perform here; a directive whose target
// resolves to nothing in `targets` (never admitted, or since disconnected) is
// exactly the ASSIGNMENT_TARGET_NOT_CONNECTED miss sendDirective already surfaces.
//
// SECURITY T2 (revocation completeness, live re-read): `getMeshRegistry()` is
// called FRESH on every dispatch (never a serve-start snapshot, never cached across
// calls) — a directive whose `issuer` is in the CURRENT live registry revocations
// never routes, even over an admitted stream. Fail-safe direction: an absent/empty
// registry (getMeshRegistry() returning null/undefined, or a registry with no
// revocations) never blocks routing — isRevoked(...) already returns false for
// both (mesh-registry.mjs:256-260).
export function dispatchDirectiveOverTargets(targets, directive, { getMeshRegistry = () => null } = {}) {
  if (directive?.issuer != null && isRevokedLocal(getMeshRegistry(), directive.issuer)) {
    return { sent: false, code: "assignment-issuer-revoked" };
  }
  return sendDirective(targets, directive?.to, directive);
}

// ------------------------------------------------------- the server host ----

// createStreamRegistry() — the in-memory (never persisted) per-worker connection
// state the server tracks: connected?, lastHeartbeatAt, everConnected. Mirrors
// serveRelay's in-memory `clients` Set discipline (ADR-007: this is liveness
// bookkeeping, not a record).
export function createStreamRegistry() {
  const byNodeId = new Map();
  return {
    markConnected(nodeId, now) {
      const entry = byNodeId.get(nodeId) ?? {};
      byNodeId.set(nodeId, { ...entry, connected: true, everConnected: true, lastHeartbeatAt: now ?? entry.lastHeartbeatAt ?? null });
    },
    markHeartbeat(nodeId, now) {
      const entry = byNodeId.get(nodeId) ?? {};
      byNodeId.set(nodeId, { ...entry, connected: true, everConnected: true, lastHeartbeatAt: now });
    },
    markDisconnected(nodeId) {
      const entry = byNodeId.get(nodeId) ?? {};
      byNodeId.set(nodeId, { ...entry, connected: false });
    },
    get(nodeId) {
      return byNodeId.get(nodeId) ?? { connected: false, everConnected: false, lastHeartbeatAt: null };
    },
    entries() {
      return [...byNodeId.entries()];
    },
  };
}

// listenOrDegradeToLoopback(server, port, bindAddress) — bind `bindAddress`; if
// that fails specifically because the address isn't (yet) assigned to a local
// interface (EADDRNOTAVAIL), retry ONCE on loopback rather than crashing the
// daemon (review fix P1.6(b) hardening — a transient tailscale-interface-not-
// ready race must never take down the control-node launcher). Any OTHER listen
// fault (e.g. EADDRINUSE) still rejects — never silently swallowed.
function listenOrDegradeToLoopback(server, port, bindAddress) {
  return new Promise((resolve, reject) => {
    const onFirstError = (error) => {
      if (error?.code === "EADDRNOTAVAIL" && bindAddress !== "127.0.0.1") {
        server.listen(port, "127.0.0.1", resolve);
        return;
      }
      reject(error);
    };
    server.once("error", onFirstError);
    server.listen(port, bindAddress, () => {
      server.off("error", onFirstError);
      resolve();
    });
  });
}

// startControlStreamServer({ port, bindAddress, peerNodeIds, peersByAddress,
// openStore, now }) → { server, wss, registry, stop }. The always-on daemon face
// (production: hosted by mesh-launcher.mjs's startLauncher when this node's role
// is "control", ADR-007). `peerNodeIds` is the CURRENT tailnet roster (a
// Set/array of nodeIds resolved via mesh-fabric's resolvePeers — the launcher
// refreshes this on its existing peer-poll ticker); `openStore` defaults to
// openGlobalWorkProjectionStore.
//
// review fix P1.6: `bindAddress` defaults to the loopback "127.0.0.1" — NEVER
// "0.0.0.0" (all interfaces) — so an operator who supplies no fabric-resolved
// self-address still gets a server unreachable from off-host, rather than one
// reachable from every interface on the machine. Production (mesh-launcher.mjs)
// passes the fabric-resolved selfAddress here so tailnet peers CAN reach it while
// every other interface still cannot.
//
// ADMISSION: the upgrade handler resolves the connecting request's origin nodeId
// via options.resolveOrigin(request) (defaultResolveOrigin, below — joins
// request.socket.remoteAddress to a nodeId through the injected `peersByAddress`
// map; tests may inject a resolver directly) and checks isTailnetPeer against the
// live peerNodeIds. A non-peer is destroyed at the gate — socket.destroy(), no ws
// ever emitted, so NOTHING reaches the global-store write path (the fitness
// acd-control-stream-tailnet-only invariant).
export async function startControlStreamServer({
  port = 0,
  bindAddress = "127.0.0.1",
  peerNodeIds = [],
  peersByAddress = [],
  resolveOrigin,
  openStore = openGlobalWorkProjectionStore,
  storeOptions = {},
  now = () => new Date().toISOString(),
  httpHandler = null,
  // getMeshRegistry() — milestone 35 / ADR-002, story 01 task 01 (SECURITY T2): an
  // OPTIONAL accessor returning the LIVE mesh registry ({ revocations: [...] }) —
  // read PER DECISION (never a serve-start snapshot) so a directive whose issuer is
  // revoked AFTER it was admitted is filtered on the very next directive it sends.
  // Fail-safe: absent (default) leaves every directive routing normally.
  getMeshRegistry = () => null,
  // mintCloneCredential(workspaceId, assignmentId) — milestone 38 / ADR-009: the
  // INJECTED control-node-side credential SOURCE (default defaultMintCloneCredential,
  // above — SECURITY T4's minting-policy residual). A caller (mesh-launcher.mjs's
  // controlStreamServerOptions, or a test) may supply a real per-repo/short-lived
  // minting authority here.
  mintCloneCredential = defaultMintCloneCredential,
  // mintWriteCredential(workspaceId, assignmentId) — milestone 38 / story 07
  // (ADR-015): the SEPARATE, WRITE-scoped sibling of mintCloneCredential above
  // (default defaultMintWriteCredential, inert — SECURITY T15's minting-policy
  // residual). NEVER the same function reference as mintCloneCredential — that would
  // collapse the two-token model this story exists to keep apart.
  mintWriteCredential = defaultMintWriteCredential,
  // onTerminalFrame(frame, { nodeId }) — milestone 38 / story 06 (ADR-014 AMENDMENT
  // 2026-07-19, closing BLOCKER F-38.06): the injected sink for the NEW opaque
  // `terminal-frame` kind. A worker's live PTY chunk rides UP its stream connection as
  // this kind (the cross-machine leg — the mesh-relay broker binds loopback only, so a
  // worker cannot reach it off-host); the message handler branches it BEFORE
  // applyStreamFrame and hands it here, WITHOUT any store apply (ADR-014 inv.3:
  // terminal frames are a live view, never persisted). `nodeId` is the CONNECTION-bound
  // identity (never the worker's self-declared frame.nodeId — the SAME T6 discipline
  // every apply* function keeps). Default no-op — a caller (mesh-launcher.mjs) supplies
  // the real fabric->loopback bridge; a pre-existing caller that wires none gets
  // byte-identical behaviour (a terminal-frame is simply dropped, never store-applied).
  onTerminalFrame = () => {},
  // onFrameSkipped({ code, nodeId, workspaceId, kind }) — VERIFICATION (live worktree
  // streaming, 2026-07-26). applySnapshotFrame/applyDeltaFrame REFUSE a frame whose
  // workspaceId has no registered descriptor, and that refusal used to be returned into
  // a `.catch((error) => { reportDegrade("control-stream-server", error); })` that nobody read: a worker could stream every 5s for days while
  // this node discarded 100% of it and said nothing (it did — that is how the worktree
  // stream stayed at zero rows without a single diagnostic). A refusal is now REPORTED.
  // Default no-op keeps every existing caller byte-identical; mesh-launcher.mjs wires
  // the daemon's own warning channel.
  onFrameSkipped = () => {},
  // onAssignmentFailure(frame, { nodeId }) — 2026-07-27 (the wrong-base retries):
  // the non-destructive peek at a worker's FAILED status frame, so its code
  // reaches the control's durable log instead of dying on the worker's stderr.
  // Default no-op keeps every existing caller byte-identical; mesh-launcher.mjs
  // wires the daemon's warning channel.
  onAssignmentFailure = () => {},
} = {}) {
  const registry = createStreamRegistry();
  const directiveTargets = createDirectiveTargetRegistry();
  const store = await openStore(storeOptions);
  const roster = new Set(Array.isArray(peerNodeIds) ? peerNodeIds : peerNodeIds instanceof Set ? [...peerNodeIds] : []);
  const addressIndex = buildAddressIndex(peersByAddress);
  const resolve = resolveOrigin ?? ((request) => defaultResolveOrigin(request, { peersByAddress: addressIndex }));

  const handleHttp = typeof httpHandler === "function" ? httpHandler : null;
  const server = http.createServer((request, response) => {
    if (handleHttp) {
      handleHttp(request, response)
        .then((handled) => {
          if (handled) return;
          response.writeHead(426, { "Content-Type": "text/plain" });
          response.end("Upgrade required");
        })
        .catch(() => {
          try {
            response.writeHead(500, { "Content-Type": "application/json" });
            response.end(JSON.stringify({ ok: false, error: "request failed unexpectedly" }));
          } catch (error) {
            /* response already settled */
      reportDegrade("control-stream-server", error); }
        });
      return;
    }
    response.writeHead(426, { "Content-Type": "text/plain" });
    response.end("Upgrade required");
  });
  const wss = new WebSocketServer({ noServer: true });

  // ASYNC gate (2026-07-27): a credential resolver must re-read the LIVE registry per
  // decision (SECURITY T2 — never a serve-start snapshot, so a node revoked after its
  // credential was issued is denied on its NEXT connect), and that read is async. The
  // handler therefore awaits `resolve`; a resolver that is synchronous (the default
  // address join, and every existing test double) is unaffected — `await` on a plain
  // value is the value. ANY throw out of the resolver destroys the socket: an
  // un-resolvable connection is never admitted (fail-closed, the same direction the
  // null-nodeId path already took).
  server.on("upgrade", async (request, socket, head) => {
    let origin = null;
    try {
      origin = await resolve(request);
    } catch (error) {
      reportDegrade("control-stream-server", error);
      socket.destroy();
      return;
    }
    // ADMISSION (2026-07-27, the `direct` fabric cutover). The resolver may declare
    // itself AUTHORITATIVE — it resolved this connection's identity from a presented
    // ENROLLMENT CREDENTIAL rather than from the socket's remote address. That check
    // (mesh-registry.mjs's verifyCredential, wired by mesh-launcher.mjs) already
    // proves BOTH halves the roster gate below stands for: the token hashes to an
    // admitted roster entry, AND that entry is not revoked. Re-checking it against
    // the FABRIC peer list would be wrong, not merely redundant — on a no-overlay
    // fabric there is no peer table to be in.
    //
    // Fail-closed is preserved on both paths: an authoritative resolver returns a
    // null nodeId when verification FAILS, and a null nodeId is never admitted.
    const admitted = origin?.authoritative === true
      ? typeof origin.nodeId === "string" && origin.nodeId.length > 0
      : isTailnetPeer(origin, { peerNodeIds: roster });
    if (!admitted) {
      // A refused connection writes NOTHING to the global store — destroyed upstream
      // of the ws accept, before any frame can ever be read.
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, { nodeId: origin.nodeId });
    });
  });

  wss.on("connection", (ws, meta) => {
    const nodeId = meta.nodeId;
    registry.markConnected(nodeId, now());
    // milestone 35 / ADR-002, story 01 task 00: the nodeId -> ws targeting map,
    // populated HERE (post-admission, inside wss.on("connection")) and cleared on
    // this SAME socket's close/error below — never a stale route past a dropped
    // connection.
    directiveTargets.set(nodeId, ws);

    // HALF-OPEN DETECTION, server side (2026-07-27 — the same measured zombie
    // class as the worker transport's keepalive): a worker whose peer vanished
    // silently stays in directiveTargets, and every dispatch to it "succeeds"
    // into the void with no refusal and no trace. Ping every 30s; a missed pong
    // terminates the socket, which fires the close handler below — the target is
    // cleared and future dispatches refuse LOUDLY (assignment-target-not-connected)
    // until the worker's own reconnect re-admits it.
    let pongSeen = true;
    ws.on("pong", () => { pongSeen = true; });
    const keepaliveTimer = setInterval(() => {
      if (ws.readyState !== ws.OPEN) return;
      if (!pongSeen) {
        try { ws.terminate(); } catch (error) { reportDegrade("control-stream-server", error); }
        return;
      }
      pongSeen = false;
      try { ws.ping(); } catch (error) { reportDegrade("control-stream-server", error); }
    }, 30_000);
    keepaliveTimer.unref?.();

    ws.on("message", (data) => {
      let frame = null;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return; // never-crash: a malformed frame is dropped, never thrown.
      }
      if (frame?.kind === "heartbeat") {
        registry.markHeartbeat(nodeId, now());
        return;
      }
      // milestone 38 / story 06 (ADR-014 AMENDMENT 2026-07-19, closing BLOCKER
      // F-38.06) — the CROSS-MACHINE terminal leg's control-side receiver. A worker's
      // live PTY chunk rides UP this SAME fabric connection as a NEW opaque
      // terminal-frame kind. BRANCH it BEFORE applyStreamFrame and hand it to the
      // injected onTerminalFrame sink WITHOUT a store apply — terminal frames are a
      // live VIEW, NEVER persisted (ADR-014 inv.3). The nodeId is the CONNECTION-bound
      // identity (`nodeId` = meta.nodeId, resolved at admission), NEVER the worker's
      // self-declared frame.nodeId — the SAME T6 discipline applyAssignmentStatusFrame /
      // applyCloneCredentialRequestFrame keep (a frame on worker-a's socket is
      // attributed to worker-a no matter what it self-declares). A sink fault must never
      // crash the accept loop (the never-crash discipline every branch here keeps).
      if (frame?.kind === TERMINAL_FRAME_KIND) {
        try {
          onTerminalFrame(frame, { nodeId });
        } catch (error) {
          // never-crash: a terminal-bridge sink fault is swallowed, the connection lives on.
      reportDegrade("control-stream-server", error); }
        return;
      }
      // 2026-07-27 (the wrong-base retries) — a worker's FAILED status frame
      // carries its code, and the control used to apply the state and throw the
      // code away: a deterministic 2-second failure took an SSH inspection to
      // name. A non-destructive PEEK to the injected sink (the frame still
      // store-applies below, unchanged); a sink fault never crashes the loop.
      if (frame?.kind === "assignment-status" && frame?.state === "failed") {
        try {
          onAssignmentFailure(frame, { nodeId });
        } catch (error) {
          reportDegrade("control-stream-server", error);
        }
      }
      const receivedAt = now();
      registry.markHeartbeat(nodeId, receivedAt);
      applyStreamFrame(store, frame, {
        now: receivedAt,
        nodeId,
        presenceWorkspace: { globalMeshRoot: store.paths?.meshRoot },
        // milestone 38 / ADR-009 — clone-credential-request handling needs the SAME
        // nodeId -> ws targeting map sendDirective/dispatchDirective already use (to
        // reply down the requester's own connection) and the injected minting seam.
        // story 07 (ADR-015) — write-credential-request handling reuses the SAME
        // targeting map, over its OWN separate minting seam.
        directiveTargets,
        mintCloneCredential,
        mintWriteCredential,
      }).then((result) => {
        // A REFUSED frame (today: an unregistered workspaceId) is a real, silent data
        // loss — surface it. Reporting must never crash the accept loop either.
        if (result?.skipped !== true) return;
        try {
          onFrameSkipped({ code: result.code ?? "frame-skipped", nodeId, workspaceId: result.workspaceId ?? null, kind: frame?.kind ?? null });
        } catch (error) {
          // a diagnostic sink fault is never fatal.
      reportDegrade("control-stream-server", error); }
      }).catch((error) => {
        // A store-apply fault must never crash the accept loop — the next frame
        // simply tries again (mirrors probeFabric's never-crash discipline).
      reportDegrade("control-stream-server", error); });
    });

    ws.on("close", () => {
      clearInterval(keepaliveTimer);
      registry.markDisconnected(nodeId);
      directiveTargets.deleteIfCurrent(nodeId, ws);
    });
    ws.on("error", () => {
      clearInterval(keepaliveTimer);
      registry.markDisconnected(nodeId);
      directiveTargets.deleteIfCurrent(nodeId, ws);
    });
  });

  // review fix P1.6(b): bind the resolved address (default loopback), NEVER
  // "0.0.0.0" (all interfaces) — the fabric IS the admission boundary (33/ADR-002),
  // so the socket itself should be reachable only on the tailnet interface a
  // fabric-resolved bindAddress names, plus loopback for same-host diagnostics.
  //
  // A caller-supplied bindAddress that is NOT (yet) assigned to a local interface
  // (EADDRNOTAVAIL — e.g. a transient tailscale interface-not-ready race, or a
  // stale self-address) degrades to loopback rather than crashing the daemon —
  // still never "0.0.0.0", so the admission-boundary invariant holds either way;
  // this never masks an actually-occupied port (EADDRINUSE still rejects, the
  // setup-ui.mjs listen-or-reject discipline).
  await listenOrDegradeToLoopback(server, port, bindAddress);

  return {
    server,
    wss,
    registry,
    directiveTargets,
    // dispatchDirective(directive) — milestone 35 / ADR-002, story 01 tasks 00/01:
    // the ONE control-side entry point that sends a directive down the targeting
    // map. Admission (T5) is structural here — directiveTargets is populated ONLY
    // inside wss.on("connection"), i.e. post-admission, so ANY resolved socket is
    // by construction an admitted, live tailnet-peer connection; there is no
    // separate "is this a peer" re-check to perform on the SEND side (the upgrade
    // gate already the sole admission surface, 34/ADR-007). SECURITY T2: the LIVE
    // registry revocations are re-read PER DECISION (never a serve-start snapshot,
    // via getMeshRegistry() called fresh on every dispatch) — a directive whose
    // `issuer` is revoked never routes, even over an admitted stream. Fail-safe: an
    // absent/empty registry never blocks routing.
    dispatchDirective(directive) {
      return dispatchDirectiveOverTargets(directiveTargets, directive, { getMeshRegistry });
    },
    updatePeers(nextPeerNodeIds, nextPeersByAddress) {
      roster.clear();
      for (const id of (Array.isArray(nextPeerNodeIds) ? nextPeerNodeIds : [...(nextPeerNodeIds ?? [])])) {
        roster.add(id);
      }
      // review fix P1.6(a): the remote-address→nodeId join must stay current too —
      // a peer whose fabric IP changes (or a newly-enrolled peer) must be joinable
      // on the VERY NEXT poll, the same freshness P0.2 already guarantees for the
      // roster itself. Optional 2nd arg — a caller that only refreshes the roster
      // (nextPeersByAddress omitted) leaves the address index untouched.
      if (nextPeersByAddress !== undefined) {
        addressIndex.clear();
        for (const [address, nodeId] of buildAddressIndex(nextPeersByAddress)) {
          addressIndex.set(address, nodeId);
        }
      }
    },
    stop() {
      for (const client of wss.clients) {
        try { client.terminate(); } catch (error) { /* already gone */
      reportDegrade("control-stream-server", error); }
      }
      wss.close();
      server.close();
      store.close?.();
    },
  };
}

// buildAddressIndex(peers) → Map<normalisedAddress, nodeId> — from an array of
// { nodeId, dialAddress } rows (mesh-fabric's resolvePeers() shape — the caller,
// mesh-launcher.mjs, hands this in; this module never calls resolvePeers itself,
// preserving acd-worker-stream-fabric-addressed's "control-stream-server.mjs
// consumes an already-resolved roster" invariant). A Map is also accepted verbatim
// (already-built index) so updatePeers can pass one straight through.
function buildAddressIndex(peers) {
  if (peers instanceof Map) return peers;
  const index = new Map();
  for (const peer of Array.isArray(peers) ? peers : []) {
    const address = normaliseRemoteAddress(peer?.dialAddress);
    const nodeId = typeof peer?.nodeId === "string" && peer.nodeId.length > 0 ? peer.nodeId : null;
    if (address && nodeId) index.set(address, nodeId);
  }
  return index;
}

// normaliseRemoteAddress(address) — strips the IPv4-mapped-IPv6 prefix
// ("::ffff:100.x.x.x" → "100.x.x.x") Node's http/net sockets present for an IPv4
// peer on a dual-stack listener, so a bare fabric dial address (mesh-fabric's
// TailscaleIPs[0], always plain IPv4/IPv6) still joins the socket's own
// remoteAddress reading. A non-string input is never a valid address.
function normaliseRemoteAddress(address) {
  if (typeof address !== "string" || address.length === 0) return null;
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

// defaultResolveOrigin(request, { peersByAddress }) — review fix P1.6(a): resolves
// identity from request.socket.remoteAddress (the CONNECTION-LEVEL fact, never a
// self-declared header — the retired broker's own admission shape, mesh-
// relay.mjs's defaultIsGroupConnection, inspected `request.socket.remoteAddress`
// the SAME way) joined to a nodeId via the injected `peersByAddress` index (an
// ALREADY-resolved fabric roster; this module never calls resolvePeers itself —
// acd-worker-stream-fabric-addressed). An unresolved/unmapped remote address is
// { nodeId: null } (fail-closed — isTailnetPeer never admits a null nodeId).
function defaultResolveOrigin(request, { peersByAddress } = {}) {
  const index = peersByAddress instanceof Map ? peersByAddress : buildAddressIndex(peersByAddress);
  const remoteAddress = normaliseRemoteAddress(request?.socket?.remoteAddress);
  const nodeId = remoteAddress != null ? index.get(remoteAddress) ?? null : null;
  return { nodeId };
}
