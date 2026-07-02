// The fleet view's read model + its `/api/mesh/status` client. The wire shapes
// mirror the LOCKED mesh:status aggregate (ARCHITECTURE 25/ADR-002) and the ONE
// server route in src/mesh-ui-serve.mjs. The fleet view reads this ONE command and
// adds no second read (ADR-003) — every node/board fact on the page comes from
// this single fetch.

// A run's lifecycle state (19/ADR-001) — surfaced fleet-wide through the m21
// run-state chip (ui/src/board/runs.mjs), verbatim (never a fleet-local vocabulary).
export type RunState = "queued" | "running" | "done" | "failed" | "cancelled";

// A presence record (m23 story 00 — { nodeId, heartbeatAt, activeRuns, aofVersion }),
// as mesh:status carries it. Present ONLY when the node has beat at least once; a
// never-beat node OMITS this key entirely (the m23 locked rule) and reads stale:false.
export type PresenceRecord = {
  nodeId: string;
  heartbeatAt: string;
  activeRuns: string[];
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
export type MeshStatus = {
  nodes: FleetNode[];
  boards: FleetBoard[];
};

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export const fleetApi = {
  // The SOLE fleet-data read (ADR-002/ADR-003): a same-origin GET of the one route.
  async status(): Promise<MeshStatus> {
    const response = await fetch("/api/mesh/status");
    if (!response.ok) throw new Error(await safeError(response));
    return (await response.json()) as MeshStatus;
  },
};
