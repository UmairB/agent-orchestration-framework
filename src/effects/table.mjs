// src/effects/table.mjs — THE effects ledger (m42 wave (d) leg d2; PRD-command-spine-
// effects-ledger). One executable table owning every consequence and its
// topology: EFFECTS maps each domain event to its reactors, each tagged with the
// LOCUS of the one store it mutates. This file is the executable replacement for
// the prose coupling registry ("the scan ORCHESTRATES, work.mjs WRITES", "MUST
// NEVER touch", …): adding a consequence is one line HERE, never a re-remembered
// call-site copy. Rule three of TECH_DEBT item 0: one home per fact, one door
// per act, ONE LEDGER PER CONSEQUENCE.
//
// Reactor contract (dispatch enforces the discipline, this file declares it):
//   - `apply(event)` where event = { eventId, name, payload } — the payload is
//     the event's own evidence (never an empty ping that forces a racing
//     re-read); a reactor rebuilds everything it needs from it.
//   - IDEMPOTENT or event-id-deduped: delivery is at-least-once by design
//     (crash between write and drain, redelivery over the bridge in d3).
//   - Mutates exactly ONE store — the one its locus names.
//
// Loci (where the mutated store's one writer can run):
//   checkout            — the repo folder holding the item (frontmatter, runs/)
//   control-store       — the authoritative mesh SQLite (d3 wires its reactors)
//   local               — this node's own projection/logs
//   integration:<name>  — an external system + credentials (d4 wires Notion)
import { loadWorkspace, rollbackItemStatus } from "../work.mjs";
import { publishGlobalWorkSnapshot } from "../global-work-publisher.mjs";
import { openGlobalWorkProjectionStore } from "../global-work-store.mjs";
import { setItemBranch } from "../mesh-assignment-directive.mjs";

export const KNOWN_LOCI = Object.freeze(["checkout", "control-store", "local"]);

export function isKnownLocus(locus) {
  return KNOWN_LOCI.includes(locus) || String(locus).startsWith("integration:");
}

// ---------------------------------------------------------------- reactors --

// run.completed / rollback-status — 20/ADR-005 made declarative: a run completed
// as FAILED rolls its in-progress item back to not-started so the stream stays
// honest. Rebuilt from the event's own evidence; rollback-not-applicable (item
// not in-progress / no record doc) is the sanctioned no-op, exactly the inline
// behaviour this reactor replaced in commands/run-complete.mjs.
async function rollbackStatusIfFailed(event) {
  const { outcome, ref, itemDir, itemType } = event.payload ?? {};
  if (outcome !== "failed") return { skipped: true, reason: "outcome-not-failed" };
  try {
    await rollbackItemStatus({ ref, dir: itemDir, type: itemType }, "not-started");
    return { rolledBack: true };
  } catch (error) {
    if (error?.code === "rollback-not-applicable") {
      return { skipped: true, reason: "rollback-not-applicable" };
    }
    throw error;
  }
}

// run.completed / publish-projection — publish-on-mutate as a LOCAL-locus
// reactor (the per-command withGlobalWorkPropagation import decision, retired
// here for this cascade; d4 sweeps the rest). Naturally idempotent — the
// snapshot publish upserts the workspace's current truth. A publish warning is
// data, not a throw (the publisher already degrades loudly internally).
async function publishItemProjection(event) {
  const { workspaceRoot } = event.payload ?? {};
  if (!workspaceRoot) return { skipped: true, reason: "no-workspace-root" };
  const workspace = await loadWorkspace(workspaceRoot);
  const publish = await publishGlobalWorkSnapshot(workspace, {});
  if (publish.warning) return { published: false, warning: publish.warning };
  if (publish.skipped) return { published: false, skipped: true, code: publish.code };
  return { published: publish.published === true };
}

// assignment.settled / record-item-branch — the cascade that lived inline in
// `applyAssignmentStatusFrame` (m42 wave (d) leg d3): a `done` means the worker's
// push SUCCEEDED (it sends done only after pushing), so the branch it reported
// becomes this item's active branch and the next continue/verify reuses it.
// Keyed by the assignment ROW's OWN workspace/item — never a self-reported id
// (the same T6 discipline the transition's holder guard keeps). Absent branch (a
// pre-upgrade worker, or any non-done edge) is the sanctioned no-op.
//
// control-store locus: it writes the authoritative mesh SQLite. It takes the
// open store from ctx when the caller has one (the transition and the control
// tick both do) and opens its own otherwise, so a crash-recovery drain from any
// control-node process behaves identically.
async function recordItemBranch(event, ctx = {}) {
  const { state, branch, workspaceId, itemRef } = event.payload ?? {};
  if (state !== "done") return { skipped: true, reason: "state-not-done" };
  if (!branch || !workspaceId || !itemRef) return { skipped: true, reason: "no-branch-reported" };
  const store = ctx.store ?? (await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions ?? {}));
  try {
    setItemBranch(store, workspaceId, itemRef, branch, { now: ctx.now });
    return { branch, itemRef };
  } finally {
    if (!ctx.store) store.close?.();
  }
}

// assignment.reported / settle-assignment — the WORKER->CONTROL fact (m42 wave
// (d) leg d3). A worker that has finished with an assignment must settle its row
// on the CONTROL node's store, which is why this reactor's locus is
// `control-store`: on a control-node process it runs in place; on a WORKER it is
// unreachable, so it stays a pending step and travels by outbox (outbox.mjs) —
// delivered at-least-once, acked by (eventId, reactorKey), redelivered after a
// dropped connection. That is the structural cure for the measured fire-once
// defect (a stranded worktree's `failed` report dying on a dead socket while the
// control row read `running` for 35+ minutes).
//
// It settles through the SAME transition every other writer uses, so the holder
// guard (this connection's authenticated node, via ctx.byNode) and the
// terminal-never-regresses rule apply to a bridged fact exactly as they do to a
// status frame — a worker cannot use this door to write something the other door
// would refuse. Non-terminal states are refused here rather than silently
// forwarded: posture (accepted/running/needs-input) is best-effort by design and
// belongs on the status frame, not in a durable, redelivered fact.
async function settleAssignment(event, ctx = {}) {
  const { assignmentId, state, runId, branch, sessionId } = event.payload ?? {};
  if (!assignmentId) return { skipped: true, reason: "no-assignment" };
  if (state !== "done" && state !== "failed") return { skipped: true, reason: `state-not-terminal:${state}` };
  // DYNAMIC IMPORT, deliberately: the transition seam resolves its own reactors
  // through this table, so a static import here would close a module-init cycle.
  // Deferring past init is exactly what the layering gate documents as the
  // sanctioned escape hatch, and this is the one place that needs it.
  const { transitionAssignmentState } = await import("./assignment-transitions.mjs");
  const store = ctx.store ?? (await openGlobalWorkProjectionStore(ctx.globalWorkStoreOptions ?? {}));
  try {
    const result = await transitionAssignmentState(
      store,
      assignmentId,
      state,
      { byNode: ctx.byNode ?? null, now: ctx.now, runId, sessionId, branch },
      { journalOptions: ctx.journalOptions ?? {} },
    );
    if (!result.applied) return { settled: false, code: result.code };
    return { settled: true, state };
  } finally {
    if (!ctx.store) store.close?.();
  }
}

// ------------------------------------------------------------- the ledger --

// The CLOSED event vocabulary, like the tag set: appendEvent refuses a name not
// declared here (run-transitions resolves reactors through effectsFor). Array
// order IS cascade order within a locus pass — rollback lands before the
// projection publishes, so the published snapshot carries the rolled-back
// status (the inline ordering run-complete.mjs relied on, now structural).
export const EFFECTS = Object.freeze({
  "run.completed": Object.freeze([
    Object.freeze({ key: "rollback-status", locus: "checkout", apply: rollbackStatusIfFailed }),
    Object.freeze({ key: "publish-projection", locus: "local", apply: publishItemProjection }),
  ]),
  // m42 wave (d) leg d3 — every assignment state change flows through
  // effects/assignment-transitions.mjs, which raises this. Its one declared
  // consequence today is the branch record the apply seam used to write inline;
  // the reclaim/publish cascades join it in d4.
  // m42 wave (d) leg d3 — the WORKER'S REPORT that its assignment reached a
  // terminal state. Raised by the worker at the moment it knows the final answer
  // (after the push, for a done), which is why it is its own event rather than a
  // reactor on run.completed: a run can complete `done` and still fail to push,
  // and "a done means the push succeeded" is the contract control depends on.
  // Its one reactor is control-locus, so on a worker the step stays pending and
  // travels by outbox — the fire-once cure.
  "assignment.reported": Object.freeze([
    Object.freeze({ key: "settle-assignment", locus: "control-store", apply: settleAssignment }),
  ]),
  "assignment.settled": Object.freeze([
    Object.freeze({ key: "record-item-branch", locus: "control-store", apply: recordItemBranch }),
  ]),
});

export function effectsFor(name) {
  return EFFECTS[name] ?? null;
}

export function knownEvents() {
  return Object.keys(EFFECTS);
}
