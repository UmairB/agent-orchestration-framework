// The fleet view's read model + its `/api/mesh/status` client. The wire shapes
// mirror the LOCKED mesh:status aggregate (ARCHITECTURE 25/ADR-002) and the ONE
// server route in src/mesh-ui-serve.mjs. The fleet view reads this ONE command and
// adds no second read (ADR-003) — every node/board fact on the page comes from
// this single fetch.

// A run's lifecycle state (19/ADR-001) — surfaced fleet-wide through the m21
// run-state chip (ui/src/board/runs.mjs), verbatim (never a fleet-local vocabulary).
export type RunState = "queued" | "running" | "done" | "failed" | "cancelled";

// A live coding-assistant session, projected onto the presence record (milestone 38
// / story 00; ARCHITECTURE ADR-001/002) — already TTL-filtered to LIVE sessions only
// by the presence aggregate before the wire ever carries it (the card renders only
// what it is handed, never recomputing liveness itself).
export type PresenceSession = {
  workspaceId: string;
  repo: string;
  assistant: string;
  lastPingAt: string;
};

// A presence record (m23 story 00 — { nodeId, heartbeatAt, activeRuns, aofVersion });
// milestone 38 / story 00 (ADR-001) grows it ADDITIVELY to FIVE keys, `sessions`
// inserted before `aofVersion` — a no-session node emits `sessions: []` (present,
// never omitted). Present ONLY when the node has beat at least once; a never-beat
// node OMITS this key entirely (the m23 locked rule) and reads stale:false.
export type PresenceRecord = {
  nodeId: string;
  heartbeatAt: string;
  activeRuns: string[];
  sessions: PresenceSession[];
  aofVersion: string;
};

// A fleet node — the m22 node record (nodeId + capability footer fields) joined
// with its presence + the derived stale flag (mesh:status, src/commands/
// mesh-identity.mjs). presence is absent for a never-beat node; stale is a FACT the
// card renders (it never recomputes staleness).
export type FleetNode = {
  nodeId: string;
  host?: string;
  os?: string;
  runtimes?: string[];
  skills?: string[];
  aofVersion?: string;
  publishedAt?: string;
  presence?: PresenceRecord;
  stale: boolean;
  // The "this node" marker — mesh:status flags the node whose id is the local
  // install's config.mesh.nodeId (25/design-gap B). Present (true) ONLY on the
  // local node; omitted otherwise (the never-beat "absent, not false" idiom).
  local?: boolean;
};

// A fleet board — the m24 registered board joined with its owner (the roster scan)
// + its active runs (the m21 run read, mesh:status boards projection). owner is
// OMITTED for an ownerless board; activeRuns is the running run ids for THIS node's
// local work stream for that board.
export type FleetBoard = {
  ref: string;
  owner?: string;
  // Present (true) when this board's owner is the local node — its work stream is
  // served on this machine, so its drill-in is a real navigating link (else the
  // honest-locality hint; task 03 two-case split). Omitted for a peer board.
  local?: boolean;
  activeRuns: string[];
  // The board's current-run state, when the aggregate carries it (a later-enriched
  // field; absent today ⇒ the tile derives its chip from activeRuns / "No runs yet").
  currentRun?: { state: RunState; attempt?: number; sessionId?: string | null; heartbeatAt?: string | null; createdAt?: string } | null;
};

// The one aggregate the fleet view renders — deep-equal to `aof mesh status --json`
// for the same fixture (one command, two faces; task 00).
//
// `isControlNode` is an additive mesh-status fact retained for compatibility with
// older local payloads; the fleet UI no longer exposes a mutation affordance.
//
// milestone 34 / story 03 (ADR-006) — the LOCAL scope's response envelope now also
// carries `scope: "local"` and `currentWorkspace` (the resolved project dir) ahead
// of the pre-existing nodes/boards aggregate (mesh-ui-serve.mjs's local branch).
export type MeshStatus = {
  scope?: "local";
  currentWorkspace?: string;
  nodes: FleetNode[];
  boards: FleetBoard[];
  isControlNode?: boolean;
};

// --- milestone 34 / story 03 — the GLOBAL scope shapes (ADR-006 default read) ---

// A workspace row from the global work-projection + registry join
// (src/global-mesh-query.mjs shapeGlobalStatus) — the "workspaces summary" region.
export type GlobalWorkspace = {
  workspaceId: string;
  projectRoot: string;
  workDir: string;
  name: string | null;
  lastPublishedAt: string | null;
  meshEnabled: boolean | null;
  controlNode: string | null;
};

// milestone 35 / story 03 (DESIGN §2a/§2b; ADR-001/ADR-007) — the READ-ONLY
// assignment-lifecycle wire shape src/global-mesh-query.mjs's `shapeGlobalStatus`
// attaches onto item/node rows (task 00). Carries the ADR-001 record's
// chip-anatomy fields VERBATIM (no label/token/mark applied at the read layer —
// that mapping is the pure `assignmentChip` helper, ./assignments.mjs).
export type WorkAssignment = {
  assignmentId: string;
  state: string;
  targetNodeId: string;
  issuer: string;
  runId: string | null;
  assignedAt: string;
  updatedAt: string;
  reclaimedAt: string | null;
};

// A work item row, carrying its owning workspace id. The global API keeps the
// complete stream even when the UI projects it to milestone cards.
//
// milestone 35 / story 03 — `assignment` is the PRIMARY attachment (DESIGN
// §2a): the most-relevant assignment for this item, when one exists. Absent
// (never a null/empty placeholder) for an item with no assignment — "absent,
// not false".
export type GlobalWorkItem = {
  workspaceId: string;
  ref: string;
  type: string;
  slug: string;
  status: string | null;
  title: string | null;
  parent: string | null;
  sourcePath: string;
  assignment?: WorkAssignment;
};

// A global registry node descriptor (src/global-node-registry.mjs) — the "node
// panel" region's control/worker rows. Never carries a credential-shaped field
// (ADR-005; the UI guard in ./scope.mjs re-checks this belt-and-braces).
//
// milestone 35 / story 03 — `assignments` is the SECONDARY attachment (DESIGN
// §2b): every assignment row this node HOLDS (any state), when at least one
// exists. Absent (never an empty array) for a node holding none — "absent, not
// false"; the UI summarises this array down to a compact per-state count line.
export type GlobalNode = {
  nodeId: string;
  role: "control" | "worker" | string;
  controlNode: boolean;
  host: string;
  os: string;
  runtimes: string[];
  skills: string[];
  aofVersion: string;
  publishedAt: string;
  lastSeenAt: string | null;
  fabric: { address: string | null; online: boolean | null };
  recordSource: string;
  workspaceIds: string[];
  freshness: "live" | "stale" | "unknown";
  assignments?: WorkAssignment[];
  // finding F6 (aof:verify 38) — the global registry row now ADDITIVELY carries
  // this node's presence record (src/global-node-registry.mjs's queryGlobalRegistry),
  // alongside the pre-existing `freshness` ramp (unchanged). Absent for a
  // never-beat node — never a fabricated empty record.
  presence?: PresenceRecord;
};

// The health/diagnostics region's payload (task 03 — freshness, skipped
// workspaces, descriptor/projection errors).
export type GlobalDiagnostics = {
  projectedAt: string | null;
  generatedAt: string;
  databasePath: string;
  skippedWorkspaces: { workspaceId: string; reason: string; message: string }[];
  descriptorErrors: { id: string | null; path: string; code: string; message: string }[];
  projectionErrors: { workspaceId: string; sourcePath: string; code: string | null; message: string }[];
};

// The GLOBAL scope's status payload (src/global-mesh-query.mjs shapeGlobalStatus).
// Also the shape a globally-started server answers for a `?scope=local` deep-link
// (the SAME fields, narrowed to one workspace, with `scope` relabelled "local").
export type GlobalMeshStatus = {
  scope: "global" | "local";
  workspaceId?: string | null;
  workspaces: GlobalWorkspace[];
  items: GlobalWorkItem[];
  nodes: GlobalNode[];
  diagnostics: GlobalDiagnostics;
};

// The fleet view's ONE status type: either scope's payload. Fleet.tsx narrows on
// `.scope` (absent/"local" with `boards` present ⇒ the pre-existing local shape;
// "global" with `workspaces`/`items` ⇒ the new global shape).
export type FleetStatus = MeshStatus | GlobalMeshStatus;

export type BoardUrlResponse = {
  url: string;
  workspaceId: string;
  ref: string | null;
};

// review fix P0.5: the coded error body may carry a `path` (mesh-ui-serve.mjs's
// sendApiError, threaded from globalStoreError — task 03 scenario 2's "the response
// body contains path <the global mesh path>"). Carried onto the thrown Error so a
// caller (Fleet.tsx) can render it even though the FAILED response never lands in
// `status` state (a first-load failure has no prior status to attach it to).
async function safeError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: string; code?: string; path?: string | null };
    const message = body.error ?? `Request failed (${response.status})`;
    const error = new Error(message) as Error & { code?: string; status?: number; path?: string | null };
    error.code = body.code;
    error.status = response.status;
    error.path = body.path ?? null;
    return error;
  } catch {
    return new Error(`Request failed (${response.status})`);
  }
}

export const fleetApi = {
  // The SOLE fleet-data read (ADR-002/ADR-003): a same-origin GET of the one route.
  // milestone 34 / story 03 (ADR-006) — an optional `scope` appends `?scope=<…>`
  // for the deep-link filter (task 01/02); omitted, the server answers whatever
  // scope it was STARTED with (the default global read, or --local's local read).
  async status(scope?: "global" | "local"): Promise<FleetStatus> {
    const response = await fetch(scope ? `/api/mesh/status?scope=${scope}` : "/api/mesh/status");
    if (!response.ok) throw await safeError(response);
    return (await response.json()) as FleetStatus;
  },

  async boardUrl(workspaceId: string, ref: string): Promise<string> {
    const params = new URLSearchParams({ workspaceId, ref });
    const response = await fetch(`/api/mesh/board-url?${params.toString()}`);
    if (!response.ok) throw await safeError(response);
    const body = (await response.json()) as BoardUrlResponse;
    return body.url;
  },
};
