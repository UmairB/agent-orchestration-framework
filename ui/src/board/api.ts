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
    updatedAt: string | null;
    branch: string | null;
  };
};

export type WorkStatus = "not-started" | "in-progress" | "in-review" | "blocked" | "done";

export type DocName = "SPEC" | "STORY" | "VERIFICATION" | "RETROSPECTIVE";

export type DocResponse = { ref: string; doc: DocName; present: boolean; body: string };

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

async function safeError(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export const workApi = {
  list(): Promise<WorkItem[]> {
    return getJson<WorkItem[]>("/api/work/list");
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
