// The board's read model + its `/api/work*` client. The wire shapes mirror the
// LOCKED contract (ADR-002) and the server endpoints in src/board-ui.mjs.

// The frozen `work list --json` contract element (ADR-002): a flat array, each
// element exactly these seven fields; `parent` is the only tree edge.
export type WorkItem = {
  ref: string;
  // milestone 37/ADR-003: `spike`/`chore` are additive top-level driver types
  // (ADR-001, uat-shaped). The board's minimal default is a type badge + the
  // existing driver placement — no new lane/column, no per-type doc tabs.
  type: "milestone" | "story" | "task" | "uat" | "spike" | "chore";
  slug: string;
  status: WorkStatus | null;
  title: string | null;
  parent: string | null;
  dir: string;
  // The MESH-EXECUTION overlay (VERIFICATION 2026-07-25, src/board-mesh-execution.mjs).
  // Present ONLY for an item the mesh has dispatched to a worker node; absent for every
  // local-only item (and for every non-mesh workspace), which is what keeps the board's
  // default the plain local view. `active` distinguishes a LIVE run from a finished one —
  // a finished run still reports, because its work lives on `branch`, which this node's
  // checkout does not have, and that is precisely what the local `not-started` hides.
  execution?: {
    assignmentId: string;
    active: boolean;
    state: string;
    nodeId: string;
    sessionId: string | null;
    // The status-refinement code the worker last reported (m42 interactive worker
    // terminals): "needs-input" = the session is waiting on a human — the terminal
    // affordance is where the answer is typed.
    code?: string | null;
    updatedAt: string | null;
    branch: string | null;
  };
  // Set by the server's worker-row merge (src/board-worker-stream.mjs): this row came
  // from a WORKER's own view of the item, streamed over the fabric — so this machine's
  // checkout may not have the item at all. The drill-downs (doc bodies, run records)
  // are NOT bridged, so a row carrying these needs a "lives on <node>" answer rather
  // than a local resolution error (TECH_DEBT item 6).
  fromWorker?: boolean;
  // The CACHE-PROVENANCE pair (milestone 43 / ADR-006): who last reported this row
  // and when, mapped from the store's `node_id`/`updated_at` by the ONE row mapper
  // on the other side of the wire. Both keys are EXPLICITLY PRESENT (null when the
  // fact is unknown) for a cache-published row, and ABSENT for a workspace that is
  // not mesh-enabled — presence, not value, is what tells the board whether this
  // is a copy of something another machine said. `unknown` is a designed state:
  // a missing `syncedAt` is never rendered as `stale`.
  reportedBy?: string | null;
  syncedAt?: string | null;
};

export type WorkStatus = "not-started" | "in-progress" | "in-review" | "blocked" | "done";

// The `/api/work/list` envelope (milestone 43 / ADR-010 R4.1, as corrected by
// ADR-015/F7 — the envelope is three keys). The HTTP FACE — not the command —
// carries the configured staleness window beside the rows, so `work:list`'s
// result and `aof work list --json`'s flat array stay byte-identical.
//
// The window's WIRE NAME is deliberately NOT spelled here: `freshness.mjs`'s
// `readStalenessWindow` is the ONE reader of it in `ui/`, which is what stops a
// second copy (or a default) of the threshold appearing on this side of the
// wire. `nodeId` rides the envelope for the same reason the window does — which
// machine "here" is, is ONE fact for the whole response, not a per-row one — and
// it is what lets a row this node published read `(this node)` (AC 11).
export type WorkListEnvelope = { items: WorkItem[]; nodeId?: string | null };

export type DocName = "SPEC" | "STORY" | "VERIFICATION" | "RETROSPECTIVE";

// The ARTIFACT's own provenance (milestone 43 / ADR-006) travels under the SAME
// two wire names the row carries, because it is the same fact about a different
// subject — and a doc can legitimately be older than the row that names it, so
// its instant is never inferred from the row's. Absent for a doc this checkout
// answered from its own disk (there is no cached copy to attribute).
export type DocResponse = {
  ref: string;
  doc: DocName;
  present: boolean;
  body: string;
  fromWorker?: boolean;
  reportedBy?: string | null;
  syncedAt?: string | null;
};

// The `/api/work/resync` answer (43/ADR-010 R4.2) — a CODED OUTCOME DOCUMENT at
// 200, never an error envelope, because the offline owner is the LIKELY case
// here (the row is stale precisely because its owner stopped reporting) and is a
// DESIGNED state rather than a fault. `ok` reports the CALL and never the DATA:
// only a fresher `syncedAt` on the next list response proves a copy landed.
export type ResyncResponse = {
  ok: boolean;
  code: string | null;
  ref: string;
  node: string | null;
  message: string;
};

export type Finding = { path: string; problem: string };
export type ValidateResponse = { findings: Finding[] };

export type NextResponse = {
  state: "ready" | "blocked" | "done";
  ref?: string;
  type?: string;
  slug?: string;
  status?: WorkStatus | null;
  path?: string;
  waitingOn?: string[];
};

export type FeedbackResponse = { ok: true; bullet: string };

// The /api/work/continue envelope. `where` is the server's answer to the only question
// this endpoint exists to settle: does this continue run HERE, on a worker node — or is
// it ALREADY running ("running": the ref or its milestone scope has an active
// assignment; nothing was spawned or minted, the caller watches it instead)?
// `command` is the slash command a LOCAL continue types into its own session.
// `scopeRef` is the top-level item the execution actually rides on (a story's continue
// routes at its milestone — one branch, one worktree per top-level item).
export type ContinueResponse = {
  ok: true;
  ref: string;
  where: "local" | "remote" | "running";
  node: string | null;
  resolvedBy: "requested" | "last-node" | "no-prior-run" | "active-run" | null;
  scopeRef?: string;
  state?: string | null;
  sessionId?: string | null;
  command?: string;
  assignmentId?: string;
};

// A story's tasks are its `<dir>/tasks/*.feature` files, parsed server-side
// (the browser can't read disk). Mirrors the /api/work/tasks wire shape.
export type TaskLane = "executable" | "manual" | "uat";

export type TaskScenario = { name: string; lane: TaskLane | null; outline: boolean };

export type TaskFeature = {
  file: string;
  feature: string | null;
  scenarios: TaskScenario[];
  counts: { executable: number; manual: number; uat: number };
};

export type TasksResponse = { ref: string; tasks: TaskFeature[] };

// A run record (milestone 19/ADR-003, extended to the 13-key schema by 20/ADR-001).
// The board renders these fields and WRITES none of them; `brief` is OPAQUE (never
// read), and `runId`/`itemRef`/`updatedAt` are available but unshown (DESIGN
// surface 1; ARCHITECTURE 21/ADR-001). The wire shape mirrors src/run-store.mjs.
export type RunState = "queued" | "running" | "done" | "failed" | "cancelled";

export type RunRecord = {
  runId: string;
  itemRef: string;
  state: RunState;
  attempt: number;
  outcome: RunState | null;
  sessionId: string | null;
  brief: unknown;
  createdAt: string;
  updatedAt: string;
  failureReason: string | null;
  heartbeatAt: string | null;
  retryOf: string | null;
  reclaimedAt: string | null;
};

// The /api/work/run-status wire shape: the registered work:run-status command's
// `{ ref, runs[] }` envelope, unchanged (ARCHITECTURE 21/ADR-001 — no path
// projection; the records carry refs). An item with no runs reports `runs: []`.
export type RunStatusResponse = { ref: string; runs: RunRecord[] };

async function getJson<T>(route: string): Promise<T> {
  const response = await fetch(route);
  if (!response.ok) {
    const message = await safeError(response);
    throw new Error(message);
  }
  return (await response.json()) as T;
}

// A refusal that keeps its CODE. The board's error bodies are `{ ok:false, error,
// code }` (src/board-ui.mjs's sendApiError), and a caller that shapes its own copy
// from the code — rather than printing the server's sentence — needs the code to
// survive the throw. The message stays the server's, for the `title`.
async function codedError(response: Response): Promise<Error & { code?: string }> {
  let code: string | undefined;
  let message = `Request failed (${response.status})`;
  try {
    const body = (await response.json()) as { error?: string; code?: string };
    if (typeof body.error === "string") message = body.error;
    if (typeof body.code === "string") code = body.code;
  } catch {
    /* a non-JSON body keeps the status-shaped message */
  }
  return Object.assign(new Error(message), code ? { code } : {});
}

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export const workApi = {
  list(): Promise<WorkListEnvelope> {
    return getJson<WorkListEnvelope>("/api/work/list");
  },
  doc(ref: string, doc: DocName): Promise<DocResponse> {
    return getJson<DocResponse>(`/api/work/doc?ref=${encodeURIComponent(ref)}&doc=${encodeURIComponent(doc)}`);
  },
  tasks(ref: string): Promise<TasksResponse> {
    return getJson<TasksResponse>(`/api/work/tasks?ref=${encodeURIComponent(ref)}`);
  },
  // The run read path (ARCHITECTURE 21/ADR-001): one read serves both history and
  // current-run state — the UI selects the current run from the same runs[].
  runStatus(ref: string): Promise<RunStatusResponse> {
    return getJson<RunStatusResponse>(`/api/work/run-status?ref=${encodeURIComponent(ref)}`);
  },
  validate(scope?: string): Promise<ValidateResponse> {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return getJson<ValidateResponse>(`/api/work/validate${query}`);
  },
  next(scope?: string): Promise<NextResponse> {
    const query = scope ? `?scope=${encodeURIComponent(scope)}` : "";
    return getJson<NextResponse>(`/api/work/next${query}`);
  },
  // THE single continue door (2026-07-26). The SERVER decides where a continue runs —
  // the node that last worked on the item, or here when nothing ever has. The button
  // must not make that decision itself: that is how clicking Continue on a milestone a
  // worker owns used to start a rival local run on the control node.
  async continueWork(input: { ref: string; node?: string }): Promise<ContinueResponse> {
    return this.dispatchPhase("continue", input);
  },
  // m42 wave (b) — one door per act: refine and verify are the SAME envelope with
  // their own phase. The server decides WHERE (running/local/remote); the button
  // never chooses a machine.
  async dispatchPhase(phase: "continue" | "refine" | "verify", input: { ref: string; node?: string }): Promise<ContinueResponse> {
    const response = await fetch(`/api/work/${phase}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await safeError(response));
    return (await response.json()) as ContinueResponse;
  },
  // THE RESYNC DOOR (milestone 43 / ADR-010 R4.2) — "ask the node that reported this
  // cached row to push a fresh copy". A POST, because it causes a node→node request to
  // leave this machine; the route answers a CODED OUTCOME DOCUMENT at 200 whatever the
  // owner said, so an unreachable owner arrives here as DATA to render rather than as a
  // thrown fault. Only a genuine transport/admission failure rejects, and it carries the
  // route's own `code` so the affordance can shape its message from the coded envelope
  // rather than printing a raw sentence.
  async resync(ref: string): Promise<ResyncResponse> {
    const response = await fetch("/api/work/resync", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref }),
    });
    if (!response.ok) throw await codedError(response);
    return (await response.json()) as ResyncResponse;
  },
  async feedback(input: { ref: string; note: string; actor: string; refs?: string }): Promise<FeedbackResponse> {
    const response = await fetch("/api/work/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!response.ok) throw new Error(await safeError(response));
    return (await response.json()) as FeedbackResponse;
  },
};

// The doc that leads the switcher per item type (DESIGN §2): milestone→SPEC,
// story→STORY. The remaining tabs (VERIFICATION, RETROSPECTIVE, Findings) follow.
export function firstDocTab(type: WorkItem["type"]): DocName {
  return type === "story" ? "STORY" : "SPEC";
}
