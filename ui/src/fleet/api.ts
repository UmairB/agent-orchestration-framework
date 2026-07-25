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
//
// milestone 38 / story 06 / task 04 (BLOCKER F-38.06c; ARCHITECTURE ADR-013 +
// ADR-014) — `sessionId` is ADDITIVE: the worker-captured interactive session id
// that, together with `targetNodeId`, forms the (nodeId, sessionId) tuple the
// read-only `/ws/terminal-view` mirror routes by. OPTIONAL by design — an
// assignment whose worker has not captured a session yet omits the key entirely
// ("absent, not false"), and a card with no resolvable tuple opens NO socket
// (ADR-014 invariant 4: never a guessed or defaulted session).
export type WorkAssignment = {
  assignmentId: string;
  state: string;
  targetNodeId: string;
  issuer: string;
  runId: string | null;
  assignedAt: string;
  updatedAt: string;
  reclaimedAt: string | null;
  sessionId?: string;
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
// milestone 38 / story 04 (DESIGN §Surface 2 Amendment 2026-07-24 (b), DG-13
// clause 4) — the assign verb attaches EXTRA coded fields beside `code`
// (`holder` on an already-active refusal, `target` on an ineligible node;
// src/commands/mesh-assign.mjs), and the route forwards them byte-for-byte
// (sendApiError's `extra`). They are carried onto the thrown Error here so the
// AFFORDANCE can shape its message from the CODED ENVELOPE rather than printing
// the raw server sentence — the sentence spends its width on the ref (which
// region 1 already shows) and truncates away the holder, the one fact no other
// region carries. The sentence itself is NOT discarded: it stays the Error's
// `message` and becomes the message slot's `title`.
export type FleetApiError = Error & {
  code?: string;
  status?: number;
  path?: string | null;
  holder?: string;
  target?: string;
};

async function safeError(response: Response): Promise<Error> {
  try {
    const body = (await response.json()) as {
      error?: string;
      code?: string;
      path?: string | null;
      holder?: string;
      target?: string;
    };
    const message = body.error ?? `Request failed (${response.status})`;
    const error = new Error(message) as FleetApiError;
    error.code = body.code;
    error.status = response.status;
    error.path = body.path ?? null;
    if (typeof body.holder === "string") error.holder = body.holder;
    if (typeof body.target === "string") error.target = body.target;
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

  // milestone 38 / story 04 (ARCHITECTURE ADR-012 + its 2026-07-24 AMENDMENT) —
  // the fleet face's ONE mutation route: a same-origin
  // `POST /api/mesh/assign { ref, nodeId, workspaceId }`, wrapping the existing
  // `assignWork` verb verbatim. A real browser's `fetch` sends the page's own
  // Origin automatically (the route's same-origin admission guard, SECURITY
  // T13) — this client sets no header itself. On a gate miss (unknown node /
  // already-active / unresolvable ref) the coded { ok:false, code } envelope
  // surfaces as a thrown Error (safeError), same shape as every other fleet read
  // failure.
  //
  // `workspaceId` is REQUIRED and is the ITEM's OWN workspace — `m.item
  // .workspaceId`, the SAME datum the drill-in beside it already passes to
  // `boardUrl`. It closes BLOCKER F21: this face is GLOBAL (it lists items from
  // every workspace on the machine) and the route used to resolve every ref
  // against the DAEMON's own workspace, so a card from any other workspace was
  // mis-assigned — and where the ref collided it dispatched entirely different
  // work off a `200 ok`. There is no fallback: a blank/absent workspaceId is a
  // coded 400 `invalid-workspace`, so a stale client fails VISIBLY.
  async assign(ref: string, nodeId: string, workspaceId: string): Promise<WorkAssignment> {
    const response = await fetch("/api/mesh/assign", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref, nodeId, workspaceId }),
    });
    if (!response.ok) throw await safeError(response);
    return (await response.json()) as WorkAssignment;
  },
};
