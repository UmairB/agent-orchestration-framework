// The board's read model + its `/api/work*` client. The wire shapes mirror the
// LOCKED contract (ADR-002) and the server endpoints in src/board-ui.mjs.

// The frozen `work list --json` contract element (ADR-002): a flat array, each
// element exactly these seven fields; `parent` is the only tree edge.
export type WorkItem = {
  ref: string;
  type: "milestone" | "story" | "task" | "uat";
  slug: string;
  status: WorkStatus | null;
  title: string | null;
  parent: string | null;
  dir: string;
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
