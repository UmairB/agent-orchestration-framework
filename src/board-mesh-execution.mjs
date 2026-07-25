// src/board-mesh-execution.mjs — the board's MESH-EXECUTION overlay (VERIFICATION,
// live two-machine soak 2026-07-25).
//
// THE DEFECT, reported by the operator: the board (`?mode=board#18`) showed a milestone
// as "not started" while a worker node was actively executing it — and kept saying so
// after it completed. The board's read path is `work:list` → `listStream` → `readMeta`,
// i.e. the CONTROL node's OWN local record-doc frontmatter. That local checkout never ran
// the work (a worker on another machine did, on its own branch), so its frontmatter is
// genuinely `not-started`: the board was reporting the local truth to a question about a
// remote one. The projection's `work_items.status` is no better here — the worker streams
// its MAIN checkout, and the advancement lives on the per-item mesh BRANCH.
//
// THE OPERATOR'S OWN THREE STEPS, built here verbatim:
//   1. is this item currently being EXECUTED? — an ACTIVE assignment row for it
//      (assigned/accepted/running) in `global_assignments`;
//   2. if so, show THAT — the executing node, the lifecycle state, the session (so the
//      terminal view is one click away) and the mesh BRANCH the work actually lives on,
//      plus an honest `in-progress` status while a worker is genuinely RUNNING it;
//   3. if no execution data can be found, DEFAULT TO LOCAL — the row passes through
//      byte-identical, which is also what every non-mesh workspace and the plain CLI get.
//
// It is a READ-ONLY overlay over rows the board already produces: it never writes, never
// mutates a record doc, and any fault (no store, an unreadable projection, a workspace
// that was never published) degrades to step 3 rather than failing the board.
import { openGlobalWorkProjectionStore, workspaceIdFor } from "./global-work-store.mjs";
import { globalMeshPaths } from "./workspace.mjs";
import { isActiveAssignmentState } from "./assignment-record.mjs";
import { readItemBranch } from "./mesh-assignment-directive.mjs";

// The ONE status the overlay ever asserts, and only while a worker is genuinely RUNNING
// the item. A queued (`assigned`) or just-accepted assignment does NOT claim progress the
// worker has not made — those rows keep their local status and carry the execution facts
// alongside, so the surface can say "queued on <node>" without overstating.
const RUNNING_STATUS = "in-progress";

// readExecutionOverlay(workspace, options) → Map<itemRef, execution> — every ACTIVE
// assignment for THIS workspace, keyed by the item ref it targets, plus the item's active
// mesh branch when one is recorded. Returns an EMPTY map on any fault (step 3).
export async function readExecutionOverlay(workspace, options = {}) {
  const overlay = new Map();
  const storeOptions = options.globalWorkStoreOptions ?? {};
  const openStore = options.openStore ?? openGlobalWorkProjectionStore;
  let store = null;
  try {
    const workspaceId = options.workspaceId
      ?? workspace?.config?.mesh?.workspaceId
      ?? workspaceIdFor(workspace?.projectRoot ?? workspace?.workDir);
    if (workspaceId == null) return overlay;
    store = await openStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });

    const rows = store.db.prepare(
      "SELECT assignment_id, item_ref, target_node_id, state, session_id, updated_at FROM global_assignments WHERE workspace_id = ? ORDER BY updated_at ASC",
    ).all(workspaceId);

    for (const row of rows) {
      // Later rows overwrite earlier ones for the same ref (ORDER BY updated_at ASC), so
      // the MOST RECENT assignment always wins — an item reassigned after a failure
      // reports the run that matters NOW, never a stale earlier one.
      const active = isActiveAssignmentState(row.state);
      overlay.set(row.item_ref, {
        assignmentId: row.assignment_id,
        // `active` is the step-1 answer ("is it being executed RIGHT NOW"). A TERMINAL row
        // is still reported — but as `active:false`, so it can never claim a live run.
        // It is kept because it answers the question the local view gets WRONG in exactly
        // the same way: a finished mesh run leaves the work on its BRANCH, which this
        // node's checkout does not have, so the board would otherwise show `not-started`
        // over completed work with nothing at all to explain where it went.
        active,
        state: row.state,
        nodeId: row.target_node_id,
        sessionId: row.session_id ?? null,
        updatedAt: row.updated_at ?? null,
        // The branch the work actually lives on (recorded on every successful push) — the
        // answer to "where IS the work, then?" when the local checkout does not have it.
        branch: safeBranch(store, workspaceId, row.item_ref),
      });
    }
  } catch {
    // Step 3: any fault (no store, an unpublished workspace, a projection this node
    // cannot read) degrades to the LOCAL view — never a broken board.
    return new Map();
  } finally {
    try { store?.close?.(); } catch { /* already closed */ }
  }
  return overlay;
}

function safeBranch(store, workspaceId, itemRef) {
  try {
    return readItemBranch(store, workspaceId, itemRef);
  } catch {
    return null;
  }
}

// applyExecutionOverlay(rows, overlay) → rows — attaches `execution` to each row an
// active assignment covers, and overrides `status` to `in-progress` ONLY while a worker is
// genuinely RUNNING it (a board that reads `not-started` over a live run is the defect;
// a board that claims progress for a merely-queued item would be a new one). Every other
// row passes through BYTE-IDENTICAL — the same object, untouched — so a non-mesh
// workspace, an unpublished one, and the plain CLI are all unaffected.
export function applyExecutionOverlay(rows, overlay) {
  if (!(overlay instanceof Map) || overlay.size === 0) return rows;
  return rows.map((row) => {
    const execution = overlay.get(row.ref);
    if (execution == null) return row;
    const status = execution.state === "running" ? RUNNING_STATUS : row.status;
    return { ...row, status, execution };
  });
}
