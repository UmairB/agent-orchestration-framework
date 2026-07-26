// src/board-worker-stream.mjs — the board's view of a mesh item AS THE WORKER SEES IT
// (VERIFICATION, live two-machine soak 2026-07-25).
//
// THE DEFECT: the board lists the CONTROL node's own checkout, so an item a worker is
// building on another machine showed its pre-run scaffold — "not started · 0 stories" over
// a milestone the agent had already broken into seven stories.
//
// WHERE THE TRUTH COMES FROM — the WORKER, over the fabric, and nothing else. The worker
// streams the work-state of the WORKTREE it is actually working in (mesh-launcher's
// pushActiveWorktreeState → sendDelta → control's applyDeltaFrame → the global
// projection's work_items), continuously, while it works. This module reads THAT.
//
// EXPLICITLY NOT THE GIT BRANCH. A branch only exists once a run has committed and pushed,
// so branch-reading cannot show work in flight and makes committing a precondition for
// visibility — the board would still be blind for the entire duration of a run, which is
// exactly the window an operator is watching. The worker is the authority on its own work;
// the projection is how that authority reaches this node.
import { openGlobalWorkProjectionStore, workspaceIdFor, readWorkspaceItems, readWorkItemDoc, readWorkItemRuns } from "./global-work-store.mjs";
import { globalMeshPaths } from "./workspace.mjs";

// resolveStreamWorkspaceId(workspace, options) — the ONE id derivation all three
// readers in this module share (the same precedence readWorkerItems always used):
// an explicit option, else the workspace's pinned mesh id, else the path-derived id.
function resolveStreamWorkspaceId(workspace, options = {}) {
  return options.workspaceId
    ?? workspace?.config?.mesh?.workspaceId
    ?? workspaceIdFor(workspace?.projectRoot ?? workspace?.workDir);
}

// withProjectionStore(workspace, options, read) — open the projection, hand
// (store, workspaceId) to `read`, always close. Any fault → null: the board's
// worker-view reads DEGRADE to "no worker view" (the local-first default), exactly
// like readWorkerItems' empty-map contract below.
async function withProjectionStore(workspace, options, read) {
  const storeOptions = options.globalWorkStoreOptions ?? {};
  const openStore = options.openStore ?? openGlobalWorkProjectionStore;
  let store = null;
  try {
    const workspaceId = resolveStreamWorkspaceId(workspace, options);
    if (workspaceId == null) return null;
    store = await openStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
    return await read(store, workspaceId);
  } catch {
    return null;
  } finally {
    try { store?.close?.(); } catch { /* already closed */ }
  }
}

// readWorkerDoc(workspace, ref, doc, options) — the drill-down sibling of
// readWorkerItems (schema v5, TECH_DEBT item 6): a record-doc BODY as the worker
// streamed it, for a ref the local checkout cannot resolve (the streamed story) or a
// doc it does not hold. Null when nothing was streamed — the caller keeps its local
// behaviour.
export async function readWorkerDoc(workspace, ref, doc, options = {}) {
  return withProjectionStore(workspace, options, (store, workspaceId) => {
    const row = readWorkItemDoc(store, workspaceId, ref, doc);
    return row == null ? null : { ref, doc: row.doc, body: row.body, reportedBy: row.nodeId ?? null, updatedAt: row.updatedAt ?? null };
  });
}

// readWorkerRuns(workspace, ref, options) — the RUNS-tab sibling: the run records
// the worker streamed for a ref whose local runs/ dir is absent or empty. Null when
// nothing was streamed.
export async function readWorkerRuns(workspace, ref, options = {}) {
  return withProjectionStore(workspace, options, (store, workspaceId) => {
    const rows = readWorkItemRuns(store, workspaceId, ref);
    if (rows.length === 0) return null;
    return {
      ref,
      runs: rows.map((row) => row.record),
      reportedBy: rows.find((row) => row.nodeId != null)?.nodeId ?? null,
    };
  });
}

// readWorkerItems(workspace, options) → Map<ref, row> — the worker-reported rows for this
// workspace, narrowed to the mesh items the caller cares about (`refs` — the items with an
// execution record) and their children. Returns an EMPTY map on any fault, which the merge
// below treats as "no worker view", leaving the local rows untouched.
export async function readWorkerItems(workspace, options = {}) {
  const refs = Array.isArray(options.refs) ? options.refs.filter((r) => typeof r === "string" && r.length > 0) : [];
  if (refs.length === 0) return new Map();

  const result = await withProjectionStore(workspace, options, (store, workspaceId) => {
    // The milestone numbers the caller asked about — a worker's rows for an item include
    // that item AND the stories beneath it (the breakdown is the thing the local checkout
    // is missing), so children are matched by parent.
    const out = new Map();
    const wanted = new Set(refs);
    const milestones = new Set(refs.map((ref) => String(ref).split("/")[0]));
    for (const row of readWorkspaceItems(store, workspaceId)) {
      if (wanted.has(row.ref) || milestones.has(row.ref) || (row.parent != null && milestones.has(String(row.parent)))) {
        out.set(row.ref, row);
      }
    }
    return out;
  });
  return result ?? new Map();
}

// mergeWorkerItems(rows, workerRows, overlay) → rows — replaces a local row with the
// worker's own row where one exists, and INSERTS the worker's extra children (the stories
// this checkout has never seen) directly after their milestone, so the board renders the
// breakdown the worker actually produced. Rows the worker says nothing about are untouched,
// which is the local-first default for every non-mesh item and every non-mesh workspace.
export function mergeWorkerItems(rows, workerRows, overlay) {
  if (!(workerRows instanceof Map) || workerRows.size === 0) return rows;
  const seen = new Set();
  const out = [];

  for (const row of rows) {
    const worker = workerRows.get(row.ref);
    if (worker == null) {
      out.push(row);
      continue;
    }
    seen.add(row.ref);
    // The worker's status/title win; the row keeps its local `dir` (the board resolves
    // docs against it) and whatever execution facts the overlay attached.
    out.push({ ...row, status: worker.status ?? row.status, title: worker.title ?? row.title, fromWorker: true });

    // …then any children the worker reports that this checkout does not have at all.
    const children = [...workerRows.values()]
      .filter((candidate) => candidate.parent != null && String(candidate.parent) === row.ref && !workerRows.has(`__seen_${candidate.ref}`))
      .filter((candidate) => !rows.some((local) => local.ref === candidate.ref))
      .sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }));
    for (const child of children) {
      if (seen.has(child.ref)) continue;
      seen.add(child.ref);
      out.push({
        ref: child.ref,
        type: child.type ?? "story",
        slug: child.slug,
        status: child.status ?? null,
        title: child.title ?? null,
        parent: child.parent ?? row.ref,
        dir: child.sourcePath ? String(child.sourcePath).replaceAll("\\", "/").replace(/\/[^/]+$/, "") : row.dir,
        fromWorker: true,
        // The node that reported it — so the surface can say whose view this is.
        reportedBy: overlay?.get?.(row.ref)?.nodeId ?? null,
      });
    }
  }
  return out;
}
