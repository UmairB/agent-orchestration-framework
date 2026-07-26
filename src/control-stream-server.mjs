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
  publishWorkspaceSnapshot,
  readWorkspaceItems,
  upsertWorkItemContent,
} from "./global-work-store.mjs";
// schema v5 (TECH_DEBT item 6 — finish the board bridge): the worktree-CONTENT frame
// kind (doc bodies + run records for an assignment's subtree). The literal lives in
// ONE home (the builder module) — imported here, never re-spelled, the same
// discipline as RECOVERY_PUSH_RESULT_KIND / TERMINAL_FRAME_KIND above.
import { WORKTREE_CONTENT_FRAME_KIND } from "./worker-stream-client.mjs";
import { redactDescriptor } from "./global-node-registry.mjs";
import { publishPresenceRecord } from "./mesh-presence.mjs";
import { updateAssignmentState, isActiveAssignmentState } from "./assignment-record.mjs";
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
// VERIFICATION (continue-on-existing-branch, 2026-07-25) — when a worker reports a `done`
// carrying the branch it pushed, record it as the item's active mesh branch so the next
// continue/verify dispatch reuses it (the work accumulates on ONE branch per item).
import { setItemBranch } from "./mesh-assignment-directive.mjs";

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

// applySnapshotFrame(store, workspace, frame, { now }) — writes a worker's FULL
// item-row set into the global store through the SAME publishWorkspaceSnapshot seam
// story 34/01 built (ADR-004: one shared publisher path). Redacts the frame's items
// (ADR-005) before anything reaches the store/descriptor. Returns the publish result.
// A frame for a workspaceId with no registered descriptor is REFUSED — never
// published under a fabricated path (see resolveKnownWorkspaceRoot above).
export async function applySnapshotFrame(store, frame, { now } = {}) {
  const known = resolveKnownWorkspaceRoot(store, frame.workspaceId);
  if (known == null) {
    return { published: false, skipped: true, code: "unknown-workspace", workspaceId: frame.workspaceId };
  }
  const redactedItems = redactDescriptor(frame.items ?? []);
  const workspace = { projectRoot: known.projectRoot, workDir: known.workDir, config: {} };
  return publishWorkspaceSnapshot(store, workspace, {
    workspaceId: frame.workspaceId,
    items: { rows: redactedItems, errors: [] },
    now: now ?? validFrameAt(frame.at) ?? new Date().toISOString(),
  });
}

// A work_items row's NOT NULL columns (global-work-store.mjs's schema) — a merged
// delta row missing any of these can never be INSERTed; applyDeltaFrame (below)
// screens for exactly this completeness BEFORE the re-publish, so one partial delta
// can never abort the whole workspace's merged re-publish (review fix P0.3).
const REQUIRED_ITEM_FIELDS = ["ref", "type", "slug", "sourcePath"];

function isCompleteItemRow(row) {
  return REQUIRED_ITEM_FIELDS.every((field) => typeof row?.[field] === "string" && row[field].length > 0);
}

// applyDeltaFrame(store, frame, { now }) — a TARGETED item upsert: reads the
// workspace's current rows, replaces/adds the delta rows by `ref`, and re-publishes
// the merged set through the SAME snapshot-write seam (idempotent — publishing a
// snapshot is always safe to repeat, ADR-004). Redacts the delta items first
// (ADR-005). This is how "a delta reports the running item completed" ends up
// `done` in the store: the merged row for that ref carries the delta's status.
//
// review fix P0.3: a delta for an UNSEEN ref (not in `existing`) whose own fields
// don't supply the schema's NOT NULL columns (type/slug/sourcePath) would otherwise
// merge into an INCOMPLETE row — publishWorkspaceSnapshot's INSERT then throws,
// which rolls back the ENTIRE BEGIN IMMEDIATE txn and (via the caller's
// .catch(()=>{})) silently drops every OTHER item in the same frame. Skip exactly
// that incomplete merged row here, before the re-publish, so the rest of the
// frame's items (and the rest of the workspace's already-published rows) are never
// collaterally rolled back by one partial/unseen-ref delta.
export async function applyDeltaFrame(store, frame, { now } = {}) {
  // A frame for a workspaceId with no registered descriptor is REFUSED — same gate
  // as applySnapshotFrame above, checked before any read/merge work.
  const known = resolveKnownWorkspaceRoot(store, frame.workspaceId);
  if (known == null) {
    return { published: false, skipped: true, code: "unknown-workspace", workspaceId: frame.workspaceId };
  }
  const redactedItems = redactDescriptor(frame.items ?? []);
  // review fix Craft: reads through global-work-store.mjs's own readWorkspaceItems
  // accessor rather than a raw store.db.prepare(...) SELECT held here — a plain
  // read, so this does not weaken acd-global-publisher-single-seam (write-scoped).
  const existing = readWorkspaceItems(store, frame.workspaceId);
  const byRef = new Map(existing.map((row) => [row.ref, row]));
  for (const item of redactedItems) {
    byRef.set(item.ref, { ...byRef.get(item.ref), ...item });
  }
  const mergedRows = [...byRef.values()].filter(isCompleteItemRow);
  const workspace = { projectRoot: known.projectRoot, workDir: known.workDir, config: {} };
  return publishWorkspaceSnapshot(store, workspace, {
    workspaceId: frame.workspaceId,
    items: { rows: mergedRows, errors: [] },
    // review fix P2.9: a malformed frame.at falls back to the server clock, never
    // a verbatim non-ISO string written into last_published_at.
    now: now ?? validFrameAt(frame.at) ?? new Date().toISOString(),
  });
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

  const existing = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId);
  if (!existing) {
    return { applied: false, skipped: true, code: "assignment-status-unknown-assignment" };
  }
  // T6: the CONNECTION's authenticated nodeId must be the row's holder — a frame on
  // worker-a's connection can never advance an assignment held by worker-b, no
  // matter what the frame itself self-declares as `nodeId`.
  if (existing.target_node_id !== connectionNodeId) {
    return { applied: false, skipped: true, code: "assignment-status-not-holder" };
  }

  // m42 wave (b) / item 7 leg 2 — A TERMINAL ROW NEVER REGRESSES. A late/stale
  // worker frame (a startup reclaim broadcast covering a retained worktree, a
  // duplicate `failed` after a manual withdraw, a done echo arriving after a
  // reclaim) must never flip a settled assignment back to another state:
  // updateAssignmentState itself is guard-free by design (its callers own the
  // transition rules), so THIS apply seam — the only door worker frames come
  // through — is where the invariant lives. Refused, and reportable (the skip
  // reaches onFrameSkipped like every other refusal).
  if (!isActiveAssignmentState(existing.state)) {
    return { applied: false, skipped: true, code: "assignment-status-already-terminal", workspaceId: existing.workspace_id };
  }

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
  const updated = updateAssignmentState(store, assignmentId, state, { now, runId, sessionId });
  // VERIFICATION (continue-on-existing-branch, 2026-07-25) — a `done` means the worker's
  // push succeeded (it sends done only AFTER the push); record the branch it reported as
  // this item's active branch, keyed by the assignment ROW's OWN workspace/item (never a
  // self-reported id — the SAME T6 discipline the holder check above keeps). The next
  // continue/verify for this item reuses it. Absent branch (a pre-upgrade worker) is a
  // no-op, byte-identical to before.
  if (state === "done" && typeof frame?.branch === "string" && frame.branch.length > 0) {
    setItemBranch(store, existing.workspace_id, existing.item_ref, frame.branch, { now });
  }
  return { applied: updated != null, assignment: updated };
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
  if (frame?.kind === "presence") return applyPresenceFrame(store, frame, options);
  if (frame?.kind === "assignment-status") return applyAssignmentStatusFrame(store, frame, options);
  if (frame?.kind === "clone-credential-request") return applyCloneCredentialRequestFrame(store, frame, options);
  if (frame?.kind === "clone-url-request") return applyCloneUrlRequestFrame(store, frame, options);
  if (frame?.kind === "write-credential-request") return applyWriteCredentialRequestFrame(store, frame, options);
  if (frame?.kind === RECOVERY_PUSH_RESULT_KIND) return applyRecoveryPushResultFrame(store, frame, options);
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
export function buildDirectiveFrame(to, { assignmentId, itemRef, workspaceId, at, command, baseBranch }) {
  const frame = { kind: "directive", to, assignmentId, itemRef, workspaceId, at };
  if (typeof command === "string" && command.length > 0) frame.command = command;
  if (typeof baseBranch === "string" && baseBranch.length > 0) frame.baseBranch = baseBranch;
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
  // a `.catch(() => {})` that nobody read: a worker could stream every 5s for days while
  // this node discarded 100% of it and said nothing (it did — that is how the worktree
  // stream stayed at zero rows without a single diagnostic). A refusal is now REPORTED.
  // Default no-op keeps every existing caller byte-identical; mesh-launcher.mjs wires
  // the daemon's own warning channel.
  onFrameSkipped = () => {},
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
          } catch {
            /* response already settled */
          }
        });
      return;
    }
    response.writeHead(426, { "Content-Type": "text/plain" });
    response.end("Upgrade required");
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const origin = resolve(request);
    if (!isTailnetPeer(origin, { peerNodeIds: roster })) {
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
        } catch {
          // never-crash: a terminal-bridge sink fault is swallowed, the connection lives on.
        }
        return;
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
        } catch {
          // a diagnostic sink fault is never fatal.
        }
      }).catch(() => {
        // A store-apply fault must never crash the accept loop — the next frame
        // simply tries again (mirrors probeFabric's never-crash discipline).
      });
    });

    ws.on("close", () => {
      registry.markDisconnected(nodeId);
      directiveTargets.deleteIfCurrent(nodeId, ws);
    });
    ws.on("error", () => {
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
        try { client.terminate(); } catch { /* already gone */ }
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
