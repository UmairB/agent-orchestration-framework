// The assignment record — a first-class, snapshot-immune entity in the global store's
// NEW `global_assignments` table (schema v2→v3, milestone 35 / story 00, ADR-001).
//
// An assignment is operator/worker-CREATED state (who was told to run what, and how
// far it got) — it is NOT a projection of any work-stream doc, so it must never live
// where `publishWorkspaceSnapshot`'s DELETE-ALL-then-reinsert cycle
// (`global-work-store.mjs`, `publishWorkspaceSnapshot`) can wipe it. This module owns:
//   (1) the FROZEN ten-key record assembler (`assembleAssignmentRecord`) — the exact
//       key set/order every downstream story (01/02/03) reads;
//   (2) the SINGLE SOURCE-OF-TRUTH state→producer enum (`ASSIGNMENT_STATE_PRODUCERS`) —
//       closing the R2(m20) hole ("a frozen+classified state-carrying key must name its
//       producer") up front, one table the assembler, the writers, AND the fitness test
//       all import (no second copy, ever);
//   (3) the DEDICATED single-row writers (`insertAssignment`/`updateAssignmentState`) —
//       atomic INSERT / UPDATE … WHERE assignment_id = ?, restamping updatedAt. Neither
//       touches any other row; neither is `publishWorkspaceSnapshot` (that seam stays
//       untouched by this milestone — the load-bearing snapshot-survival contract).
import { randomUUID } from "node:crypto";

// The lifecycle state set + its SOLE PRODUCER + classification (ADR-001's table,
// verbatim). Keys are exactly the seven states the assembler/writers ever set; the
// object is frozen so no call site can mutate the shared source of truth at runtime.
export const ASSIGNMENT_STATE_PRODUCERS = Object.freeze({
  assigned: Object.freeze({ producer: "assign verb", classification: "control-created" }),
  accepted: Object.freeze({ producer: "the worker", classification: "worker-reported" }),
  running: Object.freeze({ producer: "the worker", classification: "worker-reported" }),
  done: Object.freeze({ producer: "the worker", classification: "worker-reported term" }),
  failed: Object.freeze({ producer: "the worker", classification: "worker-reported term" }),
  withdrawn: Object.freeze({ producer: "withdraw verb", classification: "control-created term" }),
  reclaimed: Object.freeze({ producer: "reclaim path", classification: "control-created term" }),
});

// The closed key set the enum admits — used both for validation and by the fitness
// test as the "no producerless state" anchor.
export const ASSIGNMENT_STATES = Object.freeze(Object.keys(ASSIGNMENT_STATE_PRODUCERS));

// ADR-003's arbitration partition: ACTIVE states block a second assign on the same
// (workspaceId, itemRef); TERMINAL states pass the uniqueness check (the item is
// re-assignable). Derived from the SAME enum object — never a second literal list.
export const ACTIVE_ASSIGNMENT_STATES = Object.freeze(["assigned", "accepted", "running"]);
export const TERMINAL_ASSIGNMENT_STATES = Object.freeze(
  ASSIGNMENT_STATES.filter((state) => !ACTIVE_ASSIGNMENT_STATES.includes(state)),
);

export function isActiveAssignmentState(state) {
  return ACTIVE_ASSIGNMENT_STATES.includes(state);
}

export function producerFor(state) {
  return ASSIGNMENT_STATE_PRODUCERS[state]?.producer ?? null;
}

export function classificationFor(state) {
  return ASSIGNMENT_STATE_PRODUCERS[state]?.classification ?? null;
}

function assignmentError(message, code, status = 400, extra = {}) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  Object.assign(error, extra);
  return error;
}

// assembleAssignmentRecord(input) — the FROZEN assembler. Returns EXACTLY the ten
// keys below, IN ORDER (acd-assignment-record-frozen asserts this deep-equal, order-
// sensitive). Defaults: state "assigned", runId null, reclaimedAt null; assignedAt/
// updatedAt default to `now` (an injectable clock — no bare `new Date()` call site
// callers cannot pin in a test), and default equal to each other on a fresh mint.
export function assembleAssignmentRecord(input = {}) {
  const now = input.now ?? new Date().toISOString();
  const state = input.state ?? "assigned";
  if (!Object.prototype.hasOwnProperty.call(ASSIGNMENT_STATE_PRODUCERS, state)) {
    throw assignmentError(`"${state}" is not a valid assignment state.`, "assignment-state-invalid", 400, { state });
  }
  return {
    assignmentId: input.assignmentId ?? randomUUID(),
    itemRef: input.itemRef,
    workspaceId: input.workspaceId,
    targetNodeId: input.targetNodeId,
    issuer: input.issuer,
    state,
    runId: input.runId ?? null,
    assignedAt: input.assignedAt ?? now,
    updatedAt: input.updatedAt ?? now,
    reclaimedAt: input.reclaimedAt ?? null,
  };
}

// mapAssignmentRow(row) — the ONE row→record mapper every reader shares.
//
// milestone 38 / story 06 / task 04 (BLOCKER F-38.06c; ADR-013) — `sessionId` is
// an ADDITIVE eleventh key here, read off the `session_id` column
// (global-work-store.mjs's idempotent ALTER TABLE). It is deliberately NOT part
// of `assembleAssignmentRecord`'s FROZEN ten (acd-assignment-record-frozen): the
// assembler mints a CONTROL-side dispatch record, and the session id is a
// WORKER-reported fact that only ever arrives later, on an assignment-status
// frame. A row that has never carried one maps to `null` — never "", never a
// fabricated placeholder.
function mapAssignmentRow(row) {
  if (!row) return null;
  return {
    assignmentId: row.assignment_id,
    itemRef: row.item_ref,
    workspaceId: row.workspace_id,
    targetNodeId: row.target_node_id,
    issuer: row.issuer,
    state: row.state,
    runId: row.run_id,
    assignedAt: row.assigned_at,
    updatedAt: row.updated_at,
    reclaimedAt: row.reclaimed_at,
    sessionId: row.session_id ?? null,
    // m42 interactive worker terminals — the status-refinement code (needs-input),
    // absent on pre-v7 rows.
    code: row.code ?? null,
  };
}

// insertAssignment(store, record) — the DEDICATED single-row INSERT writer (ADR-001).
// An atomic single-row write keyed by assignmentId; never touches another row, never
// routes through publishWorkspaceSnapshot.
export function insertAssignment(store, record) {
  store.db.prepare(`
    INSERT INTO global_assignments
      (assignment_id, item_ref, workspace_id, target_node_id, issuer, state, run_id, assigned_at, updated_at, reclaimed_at, session_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.assignmentId,
    record.itemRef,
    record.workspaceId,
    record.targetNodeId,
    record.issuer,
    record.state,
    record.runId ?? null,
    record.assignedAt,
    record.updatedAt,
    record.reclaimedAt ?? null,
    // A freshly ASSIGNED record has no session yet (the worker captures it when it
    // launches the interactive session, ADR-013). The ONLY caller of this writer
    // (commands/mesh-assign.mjs) is fed by `assembleAssignmentRecord`, whose FROZEN
    // ten keys contain no `sessionId` — so today this is null on EVERY insert, and
    // there is no round-trip path through here. The `?? null` is a shape defence,
    // not a supported feature: it keeps the bound-parameter count correct for any
    // record shape rather than binding `undefined`. The session id's real write
    // path is `updateAssignmentState`'s `options.sessionId` (below), off a
    // worker-reported assignment-status frame.
    record.sessionId ?? null,
  );
  return record;
}

// updateAssignmentState(store, assignmentId, state, options) — the DEDICATED
// single-row UPDATE writer (ADR-001). Atomic `UPDATE … WHERE assignment_id = ?`,
// restamping updatedAt; touches no other row. `options.runId` sets the run link
// (the "running" transition); `options.reclaimedAt` stamps the reclaim path. Every
// other key (assignmentId/itemRef/workspaceId/targetNodeId/issuer/assignedAt) is
// byte-unchanged — this writer updates ONLY state/runId/updatedAt/reclaimedAt and
// (since ADR-013/F-38.06c, below) session_id.
// Returns null (a benign miss, fabricates nothing) when no row exists for the id —
// the "withdraw a never-assigned ref" contract (ADR-001/withdraw verb).
//
// milestone 38 / story 06 / task 04 (BLOCKER F-38.06c; ADR-013) — `options.sessionId`
// captures the worker-reported interactive session id (the ADR-014 (nodeId, sessionId)
// join key). It follows the SAME absent-is-not-a-clear discipline `runId` already
// keeps: `!== undefined ? … : existing.session_id`, so a later state-only frame
// (`done`, `failed`) can NEVER erase a session id an earlier frame captured. Passing
// an explicit `null` is the ONE way to clear it.
export function updateAssignmentState(store, assignmentId, state, options = {}) {
  if (!Object.prototype.hasOwnProperty.call(ASSIGNMENT_STATE_PRODUCERS, state)) {
    throw assignmentError(`"${state}" is not a valid assignment state.`, "assignment-state-invalid", 400, { state });
  }
  const now = options.now ?? new Date().toISOString();
  const existing = store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId);
  if (!existing) return null;

  const runId = options.runId !== undefined ? options.runId : existing.run_id;
  const reclaimedAt = options.reclaimedAt !== undefined ? options.reclaimedAt : existing.reclaimed_at;
  const sessionId = options.sessionId !== undefined ? options.sessionId : existing.session_id;
  // m42 interactive worker terminals — the status-refinement code (needs-input).
  // Same omitted-preserves discipline for direct callers; the status-frame apply
  // seam passes it EXPLICITLY on every frame (null clears — verbatim-per-frame).
  const code = options.code !== undefined ? options.code : existing.code;

  store.db.prepare(`
    UPDATE global_assignments
    SET state = ?, run_id = ?, updated_at = ?, reclaimed_at = ?, session_id = ?, code = ?
    WHERE assignment_id = ?
  `).run(state, runId ?? null, now, reclaimedAt ?? null, sessionId ?? null, code ?? null, assignmentId);

  return mapAssignmentRow(store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId));
}

// readAssignment(store, assignmentId) — a thin single-row read accessor.
export function readAssignment(store, assignmentId) {
  return mapAssignmentRow(store.db.prepare("SELECT * FROM global_assignments WHERE assignment_id = ?").get(assignmentId));
}

// --- EXECUTION SCOPE (milestone 43 / ADR-003 — moved DOWN out of the board face) ---
//
// Runs, assignments, branches and worktrees are all recorded against the TOP-LEVEL
// item (the milestone): a mesh run of "18" builds its stories inside ONE worktree on
// ONE branch. A child ref therefore has no execution row of its own.
//
// This is the ONE home for the scope rule, and it lives HERE — a pure leaf (imports
// 0) — rather than in src/board-mesh-execution.mjs, where it began. Two consumers
// need it and they sit on opposite sides of the layering: the FACE (the board's row
// overlay + the continue/refine/verify door, which re-export it from
// board-mesh-execution.mjs so their imports are unchanged) and the SPINE (the mint
// seam's item lock, effects/run-transitions.mjs). The spine must never import a
// face, and the rule must never be derived twice (acd-item-lock-single-door asserts
// exactly one definition in src/), so the only home both can reach is the leaf.
//
// executionScopeRef(ref) — the top-level item ref a child's execution is recorded
// under ("18/02" → "18"; "18" → "18").
export function executionScopeRef(ref) {
  return String(ref ?? "").split("/")[0];
}

// findActiveAssignment(store, workspaceId, itemRef) — the ADR-003 uniqueness-invariant
// read: the (at most one) ACTIVE assignment row for this (workspaceId, itemRef), or
// null. "Active" = state IN ('assigned','accepted','running') — a plain store query,
// never a git/lease read (acd-assignment-arbitration-store-not-git).
//
// EXACT-REF, deliberately: this primitive is the assign verb's duplicate gate
// (mesh-assignment.mjs — its one caller in src/), whose refusal
// `assignment-already-active` is a pinned, HTTP-409-mapped wire contract. m43/ADR-003
// adds the SCOPE-symmetric read below as a NEW composition beside it; this one is
// untouched (m43/ADR-010 R1.1/R1.2).
export function findActiveAssignment(store, workspaceId, itemRef) {
  const placeholders = ACTIVE_ASSIGNMENT_STATES.map(() => "?").join(", ");
  const row = store.db.prepare(`
    SELECT * FROM global_assignments
    WHERE workspace_id = ? AND item_ref = ? AND state IN (${placeholders})
    ORDER BY assigned_at DESC
    LIMIT 1
  `).get(workspaceId, itemRef, ...ACTIVE_ASSIGNMENT_STATES);
  return mapAssignmentRow(row);
}

// listActiveAssignments(store, workspaceId) — every ACTIVE row in this workspace,
// most-recent first (milestone 43 / ADR-003). The ONE active-state query the scope
// predicate and its skip-and-report rendering share, so "which items are held" is
// answered by the same rows everywhere (no command module may re-derive it —
// acd-item-lock-single-door).
export function listActiveAssignments(store, workspaceId) {
  const placeholders = ACTIVE_ASSIGNMENT_STATES.map(() => "?").join(", ");
  return store.db.prepare(`
    SELECT * FROM global_assignments
    WHERE workspace_id = ? AND state IN (${placeholders})
    ORDER BY assigned_at DESC
  `).all(workspaceId, ...ACTIVE_ASSIGNMENT_STATES).map(mapAssignmentRow);
}

// activeScopeHolders(store, workspaceId) → Map<scopeRef, record> — every EXECUTION
// SCOPE an active assignment holds in this workspace, keyed by the scope ref
// (milestone 43 / ADR-003). ONE derivation of "which scopes are held", with three
// readers: the lock's refusal (src/item-lock.mjs), its skip-and-report rendering for
// `work next`, and the control's publish tick, which steps over the rows it does not
// own and counts them.
//
// The scope match is evaluated in JS rather than in SQL on purpose: the scope rule has
// ONE definition (executionScopeRef, above) and a `LIKE 'NN/%'` clause would be a
// second one, in a different language, free to disagree — and free to make "420" a
// child of "42".
export function activeScopeHolders(store, workspaceId) {
  const held = new Map();
  if (workspaceId == null) return held;
  // listActiveAssignments is most-recent-first, so the FIRST row for a scope is the
  // one that holds it now; an older row never overwrites it.
  for (const row of listActiveAssignments(store, workspaceId)) {
    const scope = executionScopeRef(row.itemRef);
    if (!held.has(scope)) held.set(scope, row);
  }
  return held;
}

// findActiveAssignmentForScope(store, workspaceId, ref) — milestone 43 / ADR-003's
// SCOPE-SYMMETRIC read: the active row whose `item_ref` shares THIS ref's execution
// scope, or null.
//
// Symmetry is load-bearing and is a conscious extension of `resolveScopedExecution`,
// which only walks UPWARD (own row, else the parent scope's): running "42" must lock
// "42/03" AND running "42/03" must lock "42", because both execute in one worktree on
// one branch. One predicate covers both directions.
export function findActiveAssignmentForScope(store, workspaceId, ref) {
  return activeScopeHolders(store, workspaceId).get(executionScopeRef(ref)) ?? null;
}

// listAssignmentsForItem(store, workspaceId, itemRef) — every assignment row (active
// and terminal) for an item, most-recent first; used by withdraw to find the row to
// flip (the LATEST assignment, active or already-terminal/idempotent-safe).
export function listAssignmentsForItem(store, workspaceId, itemRef) {
  return store.db.prepare(`
    SELECT * FROM global_assignments WHERE workspace_id = ? AND item_ref = ? ORDER BY assigned_at DESC
  `).all(workspaceId, itemRef).map(mapAssignmentRow);
}

// listAllAssignments(store) — story 03's bulk READ helper (additive, no write
// path): every assignment row across every workspace, most-recent first. This is
// the seam `queryGlobalMeshStatus` (global-mesh-query.mjs) threads through to
// attach assignment rows onto the `/api/mesh/status` item/node rows — a plain
// SELECT, never a git/lease read, never a second copy of the mapAssignmentRow
// shape (the SAME mapper readAssignment/findActiveAssignment/listAssignmentsForItem
// already use, so the READ shape — ADR-001's ten keys plus ADR-013's additive
// eleventh, `sessionId` — travels identically everywhere; only the MINT
// (`assembleAssignmentRecord`) stays frozen at ten).
export function listAllAssignments(store) {
  return store.db.prepare(`
    SELECT * FROM global_assignments ORDER BY assigned_at DESC
  `).all().map(mapAssignmentRow);
}
