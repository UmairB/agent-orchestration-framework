// The ONE composition seam the fleet serve-face (`src/mesh-ui-serve.mjs`) calls for
// its GLOBAL `/api/mesh/status` read (milestone 34 / story 03; ARCHITECTURE ADR-006).
//
// ADR-006 keeps `mesh-ui-serve.mjs` a THIN UI/API layer: it must not import the
// low-level global-work-store / global-node-registry query surfaces directly, and it
// must not open the SQLite projection itself. This module is the single query surface
// the serve face talks to instead — it opens the global projection store, runs the
// story 00 work-projection query AND the story 02 registry query, and SHAPES the two
// into the ONE payload the fleet API answers for scope "global".
//
// A store-open failure (no SQLite runtime, schema too new, or any other open-time
// throw) is mapped to the coded `global-store-unavailable` error the API surfaces as a
// 503 (task 03) — the operator-facing path is always the global mesh database path
// (globalMeshPaths().databasePath), never a raw stack trace.
import { globalMeshPaths } from "./workspace.mjs";
import { openGlobalWorkProjectionStore, queryGlobalWorkProjection, globalStoreError, workspaceIdFor } from "./global-work-store.mjs";
import { queryGlobalRegistry } from "./global-node-registry.mjs";
import { MESH_GLOBAL_DISABLED_CODE } from "./global-work-publisher.mjs";
// milestone 35 / story 03 — the READ-ONLY assignment-lifecycle affordance
// (ADR-007: the fleet UI stays read-only; this thread extends the READ shape
// only, never a write branch). `listAllAssignments` is the bulk read helper
// story 03 added to Story 00's frozen assignment-record module (assignment-
// record.mjs) — a plain SELECT, no new writer.
import { listAllAssignments } from "./assignment-record.mjs";

// Re-exported so the serve face (ADR-006 "thin … talks to a query surface") can
// resolve a `?scope=local` deep-link's workspace id WITHOUT importing
// global-work-store.mjs itself — this module stays the ONE query surface it reaches.
export { workspaceIdFor as workspaceIdForProjectRoot };

// queryGlobalMeshStatus({ workspaceId?, now?, ... }) → the shaped global status
// payload: { scope:"global", workspaces, items, nodes, diagnostics }.
//
// `workspaceId` narrows both the work-projection query AND the registry query to one
// workspace — this is how the `?scope=local` deep-link (task 01, "a local filter can
// be requested through the API query string") reads the SAME global projection but
// scoped to the current workspace, without a second store/open path.
export async function queryGlobalMeshStatus(options = {}) {
  const paths = options.paths ?? globalMeshPaths(options);
  const store = options.store ?? (await openGlobalStoreOrCodedError({ ...options, paths }));
  const ownsStore = options.store == null;
  try {
    const workProjection = queryGlobalWorkProjection(store, { workspaceId: options.workspaceId ?? null });
    const registry = await queryGlobalRegistry(store, {
      workspaceId: options.workspaceId ?? null,
      now: options.now,
      stalenessSeconds: options.stalenessSeconds,
    });
    // milestone 35 / story 03 — the ONE additional read this seam threads
    // through: every assignment row (bulk, unfiltered — shapeGlobalStatus does
    // the per-item/per-node join, keeping the join logic PURE and headlessly
    // testable rather than a second SQL WHERE clause here).
    const assignments = listAllAssignments(store);

    return shapeGlobalStatus({ paths, workProjection, registry, assignments, now: options.now });
  } finally {
    if (ownsStore) store.close?.();
  }
}

async function openGlobalStoreOrCodedError(options) {
  try {
    return await openGlobalWorkProjectionStore(options);
  } catch (error) {
    // Any store-open failure (missing SQLite runtime, a too-new schema, a locked/
    // corrupt database file, …) surfaces as ONE stable code the UI/API can render —
    // "global-store-unavailable" — carrying the database path so the operator knows
    // exactly which file to inspect (task 03: "the error state includes the global
    // mesh path").
    throw globalStoreError(
      `The global mesh work store is unavailable at ${options.paths.databasePath}: ${error.message}`,
      "global-store-unavailable",
      503,
      { path: options.paths.databasePath, cause: error.code ?? null },
    );
  }
}

// milestone 35 / story 03 (DESIGN §2a/§2b; task 00) — the ADR-001 active states,
// restated here (not re-imported from assignment-record.mjs) because this
// function must stay a PURE function of its plain-object inputs only — no store,
// no live import graph beyond what its caller already threads in. Kept in the
// SAME order/spelling as ACTIVE_ASSIGNMENT_STATES so the two never drift.
const ACTIVE_ASSIGNMENT_STATES_FOR_SHAPE = new Set(["assigned", "accepted", "running"]);

// The "most-relevant" assignment for one (workspaceId, itemRef) pair (DESIGN §2a
// PRIMARY attachment — the item row carries exactly one assignment, the chip
// anatomy's subject). An ACTIVE assignment (assigned/accepted/running) always
// wins over a terminal one — it is the "more actionable state" the chip
// prioritises; `listAllAssignments` already orders most-recent-first, so among
// several rows for the same item the first active row, or else the first
// (latest) row overall, is picked. Never fabricates a row when none exists.
function pickItemAssignment(rows) {
  if (!rows || rows.length === 0) return null;
  const active = rows.find((row) => ACTIVE_ASSIGNMENT_STATES_FOR_SHAPE.has(row.state));
  return active ?? rows[0];
}

// The read-shape's assignment projection (task 00: "the read layer applies no
// chip label or colour to the row — that is the render layer's job"). Carries
// the chip-anatomy fields VERBATIM off the ADR-001 record — state and
// reclaimedAt travel byte-for-byte so a `reclaimed` row keeps its provenance for
// task 01's helper to read.
function projectAssignment(row) {
  if (!row) return null;
  return {
    assignmentId: row.assignmentId,
    state: row.state,
    targetNodeId: row.targetNodeId,
    issuer: row.issuer,
    runId: row.runId,
    assignedAt: row.assignedAt,
    updatedAt: row.updatedAt,
    reclaimedAt: row.reclaimedAt,
  };
}

// Shape the two query results into the ONE global status payload. Kept a pure
// function of its inputs (no I/O) so the shaping is independently testable without a
// live store.
export function shapeGlobalStatus({ paths, workProjection, registry, assignments, now }) {
  const workspaceRows = workProjection.workspaces ?? [];
  const itemRows = workProjection.items ?? [];
  const registryWorkspaces = registry.workspaces ?? [];
  const registryByWorkspaceId = new Map(registryWorkspaces.map((w) => [w.workspaceId, w]));

  // milestone 35 / story 03 (DESIGN §2a/§2b) — attach assignment rows onto the
  // item and node rows. ADDITIVE ONLY: every pre-existing field on `items`/
  // `nodes` keeps its m34 meaning byte-for-byte (the assignment field is a new
  // key appended per row); "absent, not false" — an item/node with no matching
  // assignment carries no `assignment(s)` field at all, never a synthesized
  // zero-count/default row (a reader that ignores the new field is unaffected).
  const assignmentRows = assignments ?? [];
  const assignmentsByItem = new Map();
  const assignmentsByNode = new Map();
  for (const row of assignmentRows) {
    const itemKey = `${row.workspaceId} ${row.itemRef}`;
    if (!assignmentsByItem.has(itemKey)) assignmentsByItem.set(itemKey, []);
    assignmentsByItem.get(itemKey).push(row);

    if (row.targetNodeId != null) {
      if (!assignmentsByNode.has(row.targetNodeId)) assignmentsByNode.set(row.targetNodeId, []);
      assignmentsByNode.get(row.targetNodeId).push(row);
    }
  }

  // The workspaces summary (DESIGN "workspaces summary: … with status/freshness"):
  // join the projection's published-workspace rows with the registry's mesh-enabled /
  // control-node descriptor facts when a matching descriptor exists. A workspace that
  // has published work but has no registry descriptor yet (registry publish lags the
  // work publish) still renders — meshEnabled/controlNode read as unknown (null),
  // never a thrown join failure.
  const workspaces = workspaceRows.map((row) => {
    const descriptor = registryByWorkspaceId.get(row.workspaceId);
    return {
      workspaceId: row.workspaceId,
      projectRoot: row.projectRoot,
      workDir: row.workDir,
      name: row.name,
      lastPublishedAt: row.lastPublishedAt,
      meshEnabled: descriptor ? descriptor.meshEnabled === true : null,
      controlNode: descriptor ? descriptor.controlNode ?? null : null,
    };
  });

  // A registry-only workspace descriptor (published its node/registry snapshot but the
  // work-projection has no rows for it yet, e.g. an empty work stream) still surfaces
  // in the summary — the workspaces list is the UNION of both projections, not just
  // the work-item side.
  for (const descriptor of registryWorkspaces) {
    if (workspaceRows.some((row) => row.workspaceId === descriptor.workspaceId)) continue;
    workspaces.push({
      workspaceId: descriptor.workspaceId,
      projectRoot: descriptor.projectRoot,
      workDir: descriptor.workDir,
      name: descriptor.name,
      lastPublishedAt: descriptor.publishedAt ?? null,
      meshEnabled: descriptor.meshEnabled === true,
      controlNode: descriptor.controlNode ?? null,
    });
  }
  workspaces.sort((a, b) => (a.workspaceId < b.workspaceId ? -1 : a.workspaceId > b.workspaceId ? 1 : 0));

  // The health/diagnostics region (DESIGN "shows projection freshness, disabled/
  // non-propagating workspaces, and store errors"; task 03 scenario "health
  // diagnostics expose projection freshness and skipped workspace counts").
  //
  // A "skipped" workspace is a REAL, derivable fact already carried by the registry
  // projection (ADR-002/ADR-005): a workspace whose descriptor was published with
  // `meshEnabled: false` is one `work doctor` already flags as mesh-configured but not
  // opted into global propagation (ARCHITECTURE ADR-002 consequences) — the SAME
  // "mesh-global-disabled" code the publisher's own enablement predicate returns
  // (global-work-publisher.mjs MESH_GLOBAL_DISABLED_CODE), so the UI and the publisher
  // agree on one vocabulary without a second store table.
  const projectedAt = latestTimestamp(workspaceRows.map((row) => row.lastPublishedAt));
  const skippedWorkspaces = registryWorkspaces
    .filter((descriptor) => descriptor.meshEnabled === false)
    .map((descriptor) => ({
      workspaceId: descriptor.workspaceId,
      reason: MESH_GLOBAL_DISABLED_CODE,
      message: "Global work propagation is disabled until config.mesh.enabled is true.",
    }));
  const descriptorErrors = (registry.errors ?? []).map((entry) => ({
    id: entry.id,
    path: entry.path,
    code: entry.code,
    message: entry.message,
  }));
  const projectionErrors = (workProjection.errors ?? []).map((entry) => ({
    workspaceId: entry.workspaceId,
    sourcePath: entry.sourcePath,
    code: entry.code,
    message: entry.message,
  }));

  // milestone 35 / story 03 (DESIGN §2a PRIMARY) — attach the most-relevant
  // assignment onto each item row, keyed by (workspaceId, ref). Every
  // pre-existing item field is spread through byte-unchanged; `assignment` is
  // the ONLY new key, and it is OMITTED (not a null/empty placeholder) when the
  // item carries no assignment — "absent, not false".
  const items = itemRows.map((item) => {
    const rows = assignmentsByItem.get(`${item.workspaceId} ${item.ref}`);
    const picked = pickItemAssignment(rows);
    if (!picked) return item;
    return { ...item, assignment: projectAssignment(picked) };
  });

  // milestone 35 / story 03 (DESIGN §2b SECONDARY) — attach the assignments a
  // node HOLDS onto its node row, keyed by targetNodeId; the UI summarises
  // counts by state. Omitted (no `assignments` key) when the node holds none.
  const nodes = (registry.nodes ?? []).map((node) => {
    const rows = assignmentsByNode.get(node.nodeId);
    if (!rows || rows.length === 0) return node;
    return { ...node, assignments: rows.map(projectAssignment) };
  });

  return {
    scope: "global",
    workspaceId: workProjection.workspaceId ?? null,
    workspaces,
    items,
    nodes,
    diagnostics: {
      projectedAt,
      generatedAt: now ?? new Date().toISOString(),
      databasePath: paths.databasePath,
      skippedWorkspaces,
      descriptorErrors,
      projectionErrors,
    },
  };
}

function latestTimestamp(values) {
  let latest = null;
  let latestMs = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (typeof value !== "string" || value.length === 0) continue;
    const ms = Date.parse(value);
    if (!Number.isFinite(ms)) continue;
    if (ms > latestMs) {
      latestMs = ms;
      latest = value;
    }
  }
  return latest;
}
