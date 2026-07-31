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
