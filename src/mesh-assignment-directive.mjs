// src/mesh-assignment-directive.mjs — the per-assignment PHASE directive (which
// lifecycle command a worker runs), for milestone 38's UI-driven assignment
// (extending story 04). The dispatch tick used to hardcode ONE command for every
// assignment — `/aof:refine <ref> --autonomous` (mesh-assignment-reclaim.mjs's
// defaultAssignmentDirectiveCommand) — because "the control side has no operator-facing
// command-SELECTION UI yet ... this milestone's assignment record stays FROZEN at its
// ten-key shape, acd-assignment-record-frozen, so this default is computed here rather
// than stored" (that helper's own header comment). This module is that command
// selection.
//
// The command CANNOT live on the assignment record (the frozen 10-key assembler shape,
// acd-assignment-record-frozen). So — exactly like `global_recovery_pushes`
// (mesh-recovery-push.mjs) — the phase rides a NEW, ADDITIVE side-table
// (`global_assignment_directives`) keyed by assignment_id, created LAZILY here via
// `CREATE TABLE IF NOT EXISTS` (operator-CREATED state, never a projection of any doc,
// so publishWorkspaceSnapshot must never touch it; created here rather than in
// global-work-store.mjs's migrate so the feature is self-contained and needs no
// schema-version bump). The UI writes the phase at assign time; the dispatch tick reads
// it and maps it to the whole command string, falling back to the refine default when a
// row is absent (a CLI `aof mesh assign` with no phase is byte-identical to before).

// The closed set of dispatchable phases (the ACD lifecycle verbs a worker can be told
// to run). The three lifecycle verbs mirror ui/src/board/action.mjs's own primaryAction
// kinds (refine → continue → verify); `autonomous` is the CASCADE directive (operator,
// 2026-07-26: "continue xy should be a continuation of the entire milestone. All
// stories") — the continue door resolves a MILESTONE continue to it, so the worker
// drives refine → build → verify across the whole item instead of one slice.
export const ASSIGNMENT_PHASES = ["refine", "continue", "verify", "autonomous"];
export const DEFAULT_ASSIGNMENT_PHASE = "refine";

export function isAssignmentPhase(value) {
  return typeof value === "string" && ASSIGNMENT_PHASES.includes(value);
}

// phaseRunsOnItemBranch(phase) — THE ONE HOME for "does this phase run on the
// item's EXISTING mesh branch". Every phase except `refine` accumulates on the
// branch the refine created (continue-on-existing-branch, 2026-07-25): a refine
// mints the branch, everything after builds on it. MEASURED (2026-07-27, the
// first autonomous dispatch): the dispatch tick hand-spelled
// `phase === "continue" || phase === "verify"` at its own call site, so the new
// `autonomous` phase silently fell to the no-baseBranch default — the worker
// built milestone 18 in a FRESH worktree off main, where none of the refine's
// stories exist, and the session reasoned from a wrong-base checkout. A phase
// list spelled anywhere but here is that defect waiting to recur; an unknown
// phase answers false (the mapper's own refine degrade carries no branch).
export function phaseRunsOnItemBranch(phase) {
  return isAssignmentPhase(phase) && phase !== "refine";
}

// assignmentDirectiveCommand(phase, itemRef) — the phase → whole-command-string mapper
// the worker types into its interactive `claude` PTY. `refine` carries `--autonomous`
// (the headless-worker cascade — a worker has no human to stop at each sub-step, exactly
// the pre-existing default); `continue`/`verify` do NOT (neither command's argument-hint
// accepts `--autonomous` — src/bundle/commands/{continue,verify}.md). `autonomous` is
// the whole-item cascade (`/aof:autonomous <ref>` — src/bundle/commands/autonomous.md
// takes a single NN range): drive the item refine → build → verify until done, stopping
// only for a genuine human gate. An unknown phase degrades to the refine default (never
// a blank/garbage command typed into a live PTY).
export function assignmentDirectiveCommand(phase, itemRef) {
  switch (phase) {
    case "continue":
      return `/aof:continue ${itemRef}`;
    case "verify":
      return `/aof:verify ${itemRef}`;
    case "autonomous":
      return `/aof:autonomous ${itemRef}`;
    case "refine":
    default:
      return `/aof:refine ${itemRef} --autonomous`;
  }
}

// ensureAssignmentDirectiveTable(store) — the lazy, idempotent DDL every accessor runs
// first (auto-committed DDL, safe to repeat). Keyed by assignment_id (one phase per
// assignment; a re-assign of a new assignmentId gets its own row).
export function ensureAssignmentDirectiveTable(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS global_assignment_directives (
      assignment_id TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
}

// setAssignmentPhase(store, assignmentId, phase, { now }) — records the chosen phase for
// an assignment. An unknown phase is refused (never a silent bad write). INSERT OR
// REPLACE so a re-write of the same assignment id updates in place.
export function setAssignmentPhase(store, assignmentId, phase, { now } = {}) {
  ensureAssignmentDirectiveTable(store);
  if (!isAssignmentPhase(phase)) {
    throw Object.assign(new Error(`"${phase}" is not a valid assignment phase.`), { code: "assignment-phase-invalid" });
  }
  const at = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();
  store.db.prepare(`
    INSERT INTO global_assignment_directives (assignment_id, phase, created_at)
    VALUES (?, ?, ?)
    ON CONFLICT(assignment_id) DO UPDATE SET phase = excluded.phase, created_at = excluded.created_at
  `).run(assignmentId, phase, at);
  return { assignmentId, phase };
}

// readAssignmentPhase(store, assignmentId) — the dispatch tick's read; null when no
// phase was recorded (a CLI assign, or a legacy row) → the caller falls back to the
// refine default.
export function readAssignmentPhase(store, assignmentId) {
  ensureAssignmentDirectiveTable(store);
  const row = store.db.prepare("SELECT phase FROM global_assignment_directives WHERE assignment_id = ?").get(assignmentId);
  return row?.phase ?? null;
}

// ── the item → ACTIVE mesh branch CACHE (VERIFICATION, continue-on-existing-branch
// 2026-07-25; DEMOTED to a cache by the m42 brittleness cure, 2026-07-31) ─────
//
// Under m38's convention a worker's work lived on a per-assignment branch
// (`aof/mesh/<ref>-<assignmentId>`) that ONLY this table remembered — every consumer
// had to remember the lookup, and forgetting it was the measured wrong-base dispatch
// (item 18's refine — 7 stories + ADRs — stranded on `aof/mesh/18-73ab17b2…`, a fresh
// continue building from main without them). The m42 cure makes the branch DERIVABLE
// (`meshItemBranchName(ref)` → `aof/mesh/<ref>`, one branch per item), so this table
// is now a CACHE, not the only memory:
//   - a HIT wins (continuity): pre-cure items' work lives on the old suffixed names,
//     and a reindexed item's on its pre-rename name (a renumber does not rename the
//     origin branch) — the cache is what still knows that.
//   - a MISS falls back to the derivation, which CONVERGES on the item's own line
//     instead of forking a new per-assignment branch nobody records.
// Whenever an assignment's push SUCCEEDS (a `done` frame, or a recover-push), the
// pushed branch is recorded here keyed by (workspace_id, item_ref); the dispatch tick
// reads it (cache-first) into the directive's `baseBranch`. Additive, lazily created
// (same discipline as the phase table above); never touched by publishWorkspaceSnapshot.
export function ensureItemBranchTable(store) {
  store.db.exec(`
    CREATE TABLE IF NOT EXISTS global_item_branches (
      workspace_id TEXT NOT NULL,
      item_ref TEXT NOT NULL,
      branch TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (workspace_id, item_ref)
    );
  `);
}

// setItemBranch(store, workspaceId, itemRef, branch, { now }) — record the item's active
// mesh branch (the last branch a successful push landed on). INSERT OR REPLACE: the most
// recent successful push wins. A blank branch is ignored (never records an empty active
// branch).
export function setItemBranch(store, workspaceId, itemRef, branch, { now } = {}) {
  if (typeof branch !== "string" || branch.length === 0) return null;
  ensureItemBranchTable(store);
  const at = typeof now === "string" && now.length > 0 ? now : new Date().toISOString();
  store.db.prepare(`
    INSERT INTO global_item_branches (workspace_id, item_ref, branch, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, item_ref) DO UPDATE SET branch = excluded.branch, updated_at = excluded.updated_at
  `).run(workspaceId, itemRef, branch, at);
  return { workspaceId, itemRef, branch };
}

// readItemBranch(store, workspaceId, itemRef) — the dispatch tick's read for a
// continue/verify phase; null when the item has never had a successful push (its first
// dispatch is a refine, which needs no base branch).
export function readItemBranch(store, workspaceId, itemRef) {
  ensureItemBranchTable(store);
  const row = store.db.prepare("SELECT branch FROM global_item_branches WHERE workspace_id = ? AND item_ref = ?").get(workspaceId, itemRef);
  return row?.branch ?? null;
}
