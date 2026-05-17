import { StrictMode, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { createRoot } from "react-dom/client";
import { Archive, Bot, CheckCircle2, Code2, Columns3, FileText, Globe2, Library, Link2, ListChecks, PlayCircle, Plus, RefreshCw, Save, Settings2, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import "./index.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { KanbanBoard, KanbanCard, KanbanCards, KanbanHeader, KanbanProvider } from "@/components/ui/kanban";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type RuntimeId = "claude" | "codex";
type ResourceKind = "skill" | "command" | "agent" | "rule";
type SectionKind = "mcpServers" | "hooks" | "projectDocs" | "settings";
type BoardStatus = "backlog" | "ready" | "in_progress" | "blocked" | "done";
type ExecutionStatus = "queued" | "running" | "waiting_for_user" | "blocked" | "failed" | "complete";

type Diagnostic = {
  severity: "error" | "warning" | "info" | "ok";
  path: string;
  message: string;
  blocking?: boolean;
  code?: string;
};

type AdapterWarning = {
  code: string;
  severity: "warning";
  path: string;
  kind: string;
  id: string;
  runtime: RuntimeId;
  generatedPath: string | null;
  reason: string;
  remediation: string;
};

type RuntimeOverride = {
  enabled: boolean;
  name?: string;
  description?: string;
  body?: string;
  model?: string;
  tools?: string[];
  paths?: string[];
};

type EditableResource = {
  id: string;
  kind: ResourceKind;
  source?: "project" | "global";
  readOnly?: boolean;
  referenced?: boolean;
  referencedByProject?: boolean;
  name: string;
  description: string;
  body: string;
  runtimes: RuntimeId[];
  workflow?: string;
  argumentHint?: string;
  arguments?: Array<{ name: string; description?: string; required?: boolean; hint?: string }>;
  argumentOverrides?: Record<string, { description?: string; required?: boolean; hint?: string }>;
  files?: Array<{ path?: string; name?: string; body: string }>;
  model?: string;
  tools?: string[];
  paths?: string[];
  overrides: Record<RuntimeId, RuntimeOverride>;
};

type ConfigPayload = {
  scope: "project" | "global";
  configPath: string;
  workspaceConfigExists: boolean;
  name: string;
  resources: EditableResource[];
  workflows: Array<{ id: string; runtimes?: RuntimeId[]; name?: string; description?: string }>;
  referencedResources: EditableResource[];
  globalRefs: Array<{ kind: ResourceKind; id: string }>;
  packages: Array<{ id: string; source: string; runtimes?: RuntimeId[] }>;
  mcpServers: unknown[];
  hooks: unknown[];
  projectDocs: unknown[];
  settings: Record<string, unknown>;
  diagnostics: Diagnostic[];
  adapterWarnings: AdapterWarning[];
  capabilities: {
    runtimes: Record<RuntimeId, { id: RuntimeId; name: string }>;
    capabilities: Record<string, Record<RuntimeId, string>>;
  };
  nextCommands: string[];
};

type BoardSummary = {
  id: string;
  title: string;
  objective: string;
  status: string;
  executionProvider?: string | null;
  defaultExecutionRuntime?: RuntimeId | null;
  gsd?: {
    milestone?: {
      id?: string;
      status?: string;
      binding?: { status?: string; sdkVersion?: string; driftReason?: string; fingerprint?: string };
      command?: string;
      invocation?: string;
      syncCommand?: string;
      syncedAt?: string | null;
      roadmapPath?: string;
      lastOutput?: string;
    };
    taskCreation?: { mode?: string; addPhaseCommand?: string; syncCommand?: string };
  } | null;
  taskCount: number;
  counts: Record<BoardStatus, number>;
  tasks: BoardTask[];
};

type BoardDetail = BoardSummary & {
  columns: BoardStatus[];
  tasks: BoardTask[];
};

type BoardTask = {
  id: string;
  boardId: string;
  title: string;
  description?: string;
  status: BoardStatus;
  priority?: string;
  deliverable?: string;
  refs?: Record<string, unknown>;
  assignedAgent?: { id: string; description?: string; assignedAt?: string } | null;
  execution?: { provider: string; status: ExecutionStatus; phase?: string; updatedAt?: string } | null;
  history?: Array<Record<string, unknown>>;
};

type BoardAgent = {
  id: string;
  description: string;
  runtimes: RuntimeId[];
  source: string;
};

type BoardKanbanItem = {
  id: string;
  name: string;
  column: BoardStatus;
  task: BoardTask;
};

const kinds: Array<{ id: ResourceKind; label: string; icon: React.ReactNode }> = [
  { id: "skill", label: "Skills", icon: <Library className="h-4 w-4" aria-hidden="true" /> },
  { id: "command", label: "Commands", icon: <Code2 className="h-4 w-4" aria-hidden="true" /> },
  { id: "agent", label: "Agents", icon: <Bot className="h-4 w-4" aria-hidden="true" /> },
  { id: "rule", label: "Rules", icon: <FileText className="h-4 w-4" aria-hidden="true" /> }
];

const runtimes: RuntimeId[] = ["claude", "codex"];
const sections: Array<{ id: SectionKind; label: string; icon: React.ReactNode }> = [
  { id: "mcpServers", label: "MCP Servers", icon: <Library className="h-4 w-4" aria-hidden="true" /> },
  { id: "hooks", label: "Hooks", icon: <Code2 className="h-4 w-4" aria-hidden="true" /> },
  { id: "projectDocs", label: "Project Docs", icon: <FileText className="h-4 w-4" aria-hidden="true" /> },
  { id: "settings", label: "Settings", icon: <Settings2 className="h-4 w-4" aria-hidden="true" /> }
];

function App() {
  const uiMode = getUiMode();
  const [scope, setScope] = useState<"project" | "global">("project");
  const [payload, setPayload] = useState<ConfigPayload | null>(null);
  const [projectPayload, setProjectPayload] = useState<ConfigPayload | null>(null);
  const [activeKind, setActiveKind] = useState<ResourceKind | SectionKind | "boards" | "review">("skill");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<"project" | "global">("project");
  const [draft, setDraft] = useState<EditableResource | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (uiMode === "assets") void refreshConfig("project");
  }, [uiMode]);

  if (uiMode === "boards") {
    return <BoardsApp />;
  }

  const activeResources = useMemo(() => {
    if (!payload || !isResourceKind(activeKind)) return [];
    const primary = payload.resources.filter((resource) => resource.kind === activeKind);
    const referenced = scope === "project" ? payload.referencedResources.filter((resource) => resource.kind === activeKind) : [];
    return [...primary, ...referenced];
  }, [activeKind, payload]);

  const selectedResource = useMemo(() => {
    if (!selectedId || !isResourceKind(activeKind)) return null;
    return activeResources.find((resource) => resource.id === selectedId && (resource.source ?? scope) === selectedSource) ?? null;
  }, [activeKind, activeResources, scope, selectedId, selectedSource]);

  useEffect(() => {
    setDraft(selectedResource ? cloneResource(selectedResource) : null);
  }, [selectedResource]);

  async function refreshConfig(nextScope = scope) {
    const response = await fetch(`/api/config/${nextScope}`);
    const nextPayload = await response.json();
    setPayload(nextPayload);
    if (nextScope === "project") {
      setProjectPayload(nextPayload);
    } else {
      const projectResponse = await fetch("/api/config/project");
      setProjectPayload(await projectResponse.json());
    }
  }

  async function switchScope(nextScope: "project" | "global") {
    setScope(nextScope);
    setSelectedId(null);
    setSelectedSource(nextScope);
    setDraft(null);
    setMessage("");
    await refreshConfig(nextScope);
  }

  function createResource(kind: ResourceKind) {
    const next = blankResource(kind);
    next.source = scope;
    setSelectedId(null);
    setSelectedSource(scope);
    setDraft(next);
    setMessage("");
  }

  async function saveResource(event: React.FormEvent) {
    event.preventDefault();
    if (!draft) return;

    const validation = validateDraft(draft, payload);
    if (validation.some((item) => item.blocking)) {
      setMessage("Resolve blocking validation issues before saving.");
      return;
    }

    const response = await fetch(`/api/config/${scope}/resources/${encodeURIComponent(draft.kind)}/${encodeURIComponent(draft.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(draft)
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      setMessage(result.error ?? result.diagnostics?.[0]?.message ?? "Save failed");
      return;
    }

    setMessage(`Saved ${draft.kind}:${draft.id}`);
    setSelectedId(draft.id);
    setSelectedSource(scope);
    await refreshConfig();
  }

  async function addReference(resource: EditableResource) {
    const response = await fetch(`/api/config/project/global-refs/${encodeURIComponent(resource.kind)}/${encodeURIComponent(resource.id)}`, { method: "PUT" });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      setMessage(result.error ?? result.diagnostics?.[0]?.message ?? "Reference failed");
      return;
    }
    setMessage(`Referenced ${resource.kind}:${resource.id}`);
    await refreshConfig(scope);
  }

  async function removeReference(resource: EditableResource) {
    const response = await fetch(`/api/config/project/global-refs/${encodeURIComponent(resource.kind)}/${encodeURIComponent(resource.id)}`, { method: "DELETE" });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      setMessage(result.error ?? result.diagnostics?.[0]?.message ?? "Remove failed");
      return;
    }
    setMessage(`Removed reference ${resource.kind}:${resource.id}`);
    setSelectedId(null);
    setDraft(null);
    await refreshConfig(scope);
  }

  if (!payload) {
    return (
      <main className="grid min-h-screen place-items-center bg-background text-foreground">
        <div className="mono text-sm text-muted-foreground">Loading AOF...</div>
      </main>
    );
  }

  const draftDiagnostics = draft ? validateDraft(draft, payload) : [];

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)] max-[860px]:grid-cols-1">
        <aside className="border-r border-border bg-sidebar p-5 max-[860px]:border-b max-[860px]:border-r-0">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Sparkles className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">AOF</h1>
              <p className="mono text-xs text-muted-foreground">{payload.name}</p>
            </div>
          </div>

          <div className="mb-5 grid grid-cols-2 rounded-md border border-border bg-background p-1">
            {(["project", "global"] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => void switchScope(item)}
                className={`h-9 rounded px-3 text-sm capitalize transition ${scope === item ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                {item}
              </button>
            ))}
          </div>

          <nav className="space-y-1">
            {kinds.map((kind) => (
              <button
                key={kind.id}
                type="button"
                onClick={() => {
                  setActiveKind(kind.id);
                  setSelectedId(null);
                  setSelectedSource(scope);
                  setDraft(null);
                  setMessage("");
                }}
                className={`flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm transition ${activeKind === kind.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                <span className="flex items-center gap-2">{kind.icon}{kind.label}</span>
                <span className="mono text-xs">{activeCount(payload, kind.id, scope)}</span>
              </button>
            ))}
            {scope === "project" ? <div className="pt-3">
              <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">Expanded DSL</p>
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveKind(section.id);
                    setSelectedId(null);
                    setSelectedSource(scope);
                    setDraft(null);
                    setMessage("");
                  }}
                  className={`flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm transition ${activeKind === section.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  <span className="flex items-center gap-2">{section.icon}{section.label}</span>
                  <span className="mono text-xs">{sectionCount(payload, section.id)}</span>
                </button>
              ))}
            </div> : null}
            <button
              type="button"
              onClick={() => {
                setActiveKind("review");
                setSelectedId(null);
                setSelectedSource(scope);
                setDraft(null);
                setMessage("");
              }}
              className={`flex h-10 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition ${activeKind === "review" ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
            >
              <ListChecks className="h-4 w-4" aria-hidden="true" />
              Review
            </button>
          </nav>

          <div className="mt-6 rounded-md border border-border bg-background p-3">
            <p className="mono text-xs text-muted-foreground">{scope} config</p>
            <p className="mono mt-2 break-all text-xs">{payload.configPath}</p>
          </div>
        </aside>

        {message ? <div className="fixed bottom-4 right-4 z-10 max-w-md rounded-md border border-border bg-card p-3 text-sm shadow-lg">{message}</div> : null}

        {activeKind === "review" ? (
          <ReviewPanel payload={payload} />
        ) : isSectionKind(activeKind) && scope === "project" ? (
          <SectionEditor activeSection={activeKind} payload={payload} refreshConfig={refreshConfig} />
        ) : isResourceKind(activeKind) ? (
          <section className="grid min-h-screen grid-cols-[320px_minmax(0,1fr)] max-[1050px]:grid-cols-1">
            <div className="border-r border-border p-5 max-[1050px]:border-b max-[1050px]:border-r-0">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{labelForKind(activeKind)}</h2>
                  <p className="text-sm text-muted-foreground">{activeResources.length} item{activeResources.length === 1 ? "" : "s"}</p>
                </div>
                <Button type="button" onClick={() => createResource(activeKind)} size="sm" disabled={scope === "global" && activeKind === "command"}>
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  New
                </Button>
              </div>
              <AssetList
                resources={activeResources}
                selectedId={selectedId}
                selectedSource={selectedSource}
                scope={scope}
                payload={payload}
                projectPayload={projectPayload}
                onSelect={(resource) => {
                  setSelectedSource(resource.source ?? scope);
                  setSelectedId(resource.id);
                  setMessage("");
                }}
                onAddReference={addReference}
                onRemoveReference={removeReference}
              />
            </div>

            <div className="p-5">
              {draft && !draft.readOnly ? (
                <AssetEditor
                  draft={draft}
                  setDraft={setDraft}
                  payload={payload}
                  scope={scope}
                  diagnostics={draftDiagnostics}
                  message={message}
                  onSubmit={saveResource}
                />
              ) : draft && draft.readOnly ? (
                <ReadOnlyResource resource={draft} onRemoveReference={removeReference} />
              ) : (
                <KindOverview kind={activeKind} resources={activeResources} payload={payload} scope={scope} />
              )}
            </div>
          </section>
        ) : (
          <ReviewPanel payload={payload} />
        )}
      </div>
    </main>
  );
}

function BoardsApp() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="grid min-h-screen grid-cols-[280px_minmax(0,1fr)] max-[860px]:grid-cols-1">
        <aside className="border-r border-border bg-sidebar p-5 max-[860px]:border-b max-[860px]:border-r-0">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <Columns3 className="h-5 w-5" aria-hidden="true" />
            </div>
            <div>
              <h1 className="text-xl font-semibold tracking-normal">AOF Boards</h1>
              <p className="mono text-xs text-muted-foreground">Project task management</p>
            </div>
          </div>
          <nav className="space-y-1">
            <button
              type="button"
              className="flex h-10 w-full items-center justify-between rounded-md bg-primary px-3 text-left text-sm text-primary-foreground"
            >
              <span className="flex items-center gap-2"><Columns3 className="h-4 w-4" aria-hidden="true" />Boards</span>
            </button>
          </nav>
          <div className="mt-6 rounded-md border border-border bg-background p-3">
            <p className="text-sm text-muted-foreground">Manage board tasks, assignments, and execution state.</p>
          </div>
        </aside>
        <BoardsPanel />
      </div>
    </main>
  );
}

function BoardsPanel() {
  const [boards, setBoards] = useState<BoardSummary[]>([]);
  const [selectedBoardId, setSelectedBoardId] = useState<string | null>(null);
  const [board, setBoard] = useState<BoardDetail | null>(null);
  const [agents, setAgents] = useState<BoardAgent[]>([]);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [message, setMessage] = useState("");
  const [showBoardForm, setShowBoardForm] = useState(false);
  const [boardDraft, setBoardDraft] = useState<{ id: string; title: string; objective: string; defaultExecutionRuntime: RuntimeId }>({ id: "", title: "", objective: "", defaultExecutionRuntime: "codex" });
  const [milestoneAnswer, setMilestoneAnswer] = useState("");

  useEffect(() => {
    void refreshBoards();
  }, []);

  useEffect(() => {
    if (selectedBoardId) void loadBoard(selectedBoardId);
  }, [selectedBoardId]);

  async function refreshBoards(nextSelectedId = selectedBoardId) {
    const [boardsResponse, agentsResponse, validateResponse] = await Promise.all([
      fetch("/api/boards"),
      fetch("/api/boards/agents"),
      fetch("/api/boards/validate")
    ]);
    const boardsPayload = await boardsResponse.json();
    const agentsPayload = await agentsResponse.json();
    const validatePayload = await validateResponse.json();
    const nextBoards = boardsPayload.boards ?? [];
    setBoards(nextBoards);
    setAgents(agentsPayload.agents ?? []);
    setDiagnostics(validatePayload.diagnostics ?? []);
    const nextId = nextSelectedId ?? nextBoards[0]?.id ?? null;
    setSelectedBoardId(nextId);
    if (nextId) await loadBoard(nextId);
    else setBoard(null);
  }

  async function loadBoard(boardId: string) {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}`);
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Board load failed");
      return;
    }
    setBoard(payload.board);
  }

  async function createBoardFromDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!boardDraft.id || !boardDraft.title || !boardDraft.objective) {
      setMessage("Board id, title, and objective are required.");
      return;
    }
    const response = await fetch(`/api/boards/${encodeURIComponent(boardDraft.id)}`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: boardDraft.title, objective: boardDraft.objective, defaultExecutionRuntime: boardDraft.defaultExecutionRuntime })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Board create failed");
      return;
    }
    const milestoneStatus = payload.board.gsd?.milestone?.status;
    setMessage(`Created board ${payload.board.id}${milestoneStatus ? `; milestone ${milestoneStatus}` : ""}.`);
    setBoardDraft({ id: "", title: "", objective: "", defaultExecutionRuntime: "codex" });
    setShowBoardForm(false);
    await refreshBoards(payload.board.id);
  }

  async function syncBoardFromRoadmap() {
    if (!board) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(board.id)}/sync`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ milestone: board.gsd?.milestone?.id })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Roadmap sync failed");
      return;
    }
    setMessage(`Synced ${payload.created.length} task${payload.created.length === 1 ? "" : "s"} from ${payload.phases.length} GSD phase${payload.phases.length === 1 ? "" : "s"}.`);
    await refreshBoards(board.id);
  }

  async function repairBoardMilestone() {
    if (!board) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(board.id)}/repair`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ defaultExecutionRuntime: board.defaultExecutionRuntime ?? "codex" })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Board repair failed");
      return;
    }
    setMessage(payload.message ?? `Repaired ${board.id}`);
    await refreshBoards(board.id);
  }

  async function answerBoardMilestone(event: React.FormEvent) {
    event.preventDefault();
    if (!board || !milestoneAnswer.trim()) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(board.id)}/milestone/answer`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: milestoneAnswer.trim() })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Milestone answer failed");
      return;
    }
    setMilestoneAnswer("");
    setMessage(`Milestone ${payload.board.gsd?.milestone?.status ?? "updated"}.`);
    await refreshBoards(board.id);
  }

  async function moveTask(task: BoardTask, status: BoardStatus) {
    if (!board || task.status === status) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(board.id)}/tasks/${encodeURIComponent(task.id)}/status`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Move failed");
      return;
    }
    setMessage(`Moved ${task.id} to ${statusLabel(status)}`);
    await refreshBoards(board.id);
  }

  async function assignTask(task: BoardTask, agentId: string) {
    if (!board || !agentId) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(board.id)}/tasks/${encodeURIComponent(task.id)}/assignment`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Assignment failed");
      return;
    }
    setMessage(`Assigned ${task.id} to ${agentId}`);
    await refreshBoards(board.id);
  }

  async function saveTask(task: BoardTask, input: { title: string; priority: string; deliverable: string }) {
    if (!board) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(board.id)}/tasks/${encodeURIComponent(task.id)}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title,
        priority: input.priority,
        deliverable: input.deliverable
      })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Task save failed");
      return;
    }
    setMessage(`Saved ${task.id}`);
    await refreshBoards(board.id);
  }

  async function archiveBoard() {
    if (!board) return;
    const response = await fetch(`/api/boards/${encodeURIComponent(board.id)}/archive`, { method: "PUT" });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setMessage(payload.error ?? "Archive failed");
      return;
    }
    setMessage(`Archived ${board.id}`);
    await refreshBoards(null);
  }

  function handleKanbanDataChange(items: BoardKanbanItem[]) {
    if (!board) return;
    const changed = items.find((item) => item.task.status !== item.column);
    if (changed) void moveTask(changed.task, changed.column);
  }

  const visibleDiagnostics = diagnostics.filter((item) => item.severity !== "info");
  const columns: BoardStatus[] = board?.columns ?? ["backlog", "ready", "in_progress", "blocked", "done"];
  const kanbanColumns = columns.map((status) => ({ id: status, name: statusLabel(status) }));
  const kanbanTasks: BoardKanbanItem[] = board?.tasks.map((task) => ({
    id: task.id,
    name: task.title,
    column: task.status,
    task
  })) ?? [];

  return (
    <section className="min-h-screen min-w-0 bg-background">
      {message ? <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">{message}</p> : null}

      <div className="grid min-h-screen min-w-0 grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-1">
        <aside className="border-r border-border bg-sidebar p-4 max-[980px]:border-b max-[980px]:border-r-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">Boards</h2>
              <p className="text-sm text-muted-foreground">{boards.length} project board{boards.length === 1 ? "" : "s"}</p>
            </div>
            <Button type="button" size="sm" onClick={() => setShowBoardForm((value) => !value)}>
              <Plus className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>

          {showBoardForm ? (
            <form className="mb-4 space-y-3 rounded-md border border-border bg-card p-3" onSubmit={createBoardFromDraft}>
              <h3 className="text-sm font-semibold">New board</h3>
              <Input placeholder="id" value={boardDraft.id} onChange={(event) => setBoardDraft({ ...boardDraft, id: event.target.value })} />
              <Input placeholder="title" value={boardDraft.title} onChange={(event) => setBoardDraft({ ...boardDraft, title: event.target.value })} />
              <Textarea placeholder="objective" value={boardDraft.objective} onChange={(event) => setBoardDraft({ ...boardDraft, objective: event.target.value })} />
              <select
                className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                value={boardDraft.defaultExecutionRuntime}
                onChange={(event) => setBoardDraft({ ...boardDraft, defaultExecutionRuntime: event.target.value as RuntimeId })}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
              </select>
              <div className="grid grid-cols-2 gap-2">
                <Button type="button" variant="secondary" onClick={() => setShowBoardForm(false)}>Cancel</Button>
                <Button type="submit">Create</Button>
              </div>
            </form>
          ) : null}

          <div className="space-y-2">
            {boards.length === 0 ? <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No boards.</div> : boards.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedBoardId(item.id)}
                className={`w-full rounded-md border p-3 text-left transition ${selectedBoardId === item.id ? "border-primary bg-card" : "border-border bg-background hover:border-primary"}`}
              >
                <span className="mono block truncate text-sm font-semibold">{item.id}</span>
                <span className="mt-1 block text-sm">{item.title}</span>
                <span className="mt-2 block text-xs text-muted-foreground">{item.taskCount} tasks</span>
              </button>
            ))}
          </div>

          <div className="mt-4 rounded-md border border-border bg-background p-3">
            <div className="mb-2 flex items-center justify-between gap-3">
              <p className="text-sm font-semibold">Diagnostics</p>
              <Badge variant={visibleDiagnostics.some((item) => item.severity === "error") ? "destructive" : "secondary"}>{visibleDiagnostics.length}</Badge>
            </div>
            {visibleDiagnostics.length === 0 ? <StatusLine ok text="Board files valid." /> : visibleDiagnostics.slice(0, 5).map((item) => (
              <StatusLine key={`${item.code}-${item.path}-${item.message}`} ok={item.severity !== "error"} text={`${item.code}: ${item.message}`} />
            ))}
          </div>

          <Button type="button" variant="secondary" className="mt-4 w-full" onClick={() => void refreshBoards()}>
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Refresh
          </Button>
        </aside>

        <div className="min-w-0 p-5">
          {!board ? (
            <div className="rounded-md border border-dashed border-border p-8 text-sm text-muted-foreground">Select or create a board.</div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-wrap items-start justify-between gap-4 rounded-md border border-border bg-card p-4">
                <div>
                  <p className="mono text-xs text-muted-foreground">{board.id}</p>
                  <h3 className="text-xl font-semibold">{board.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{board.objective || "No objective."}</p>
                  {board.executionProvider ? (
                    <div className="mt-3 flex flex-wrap gap-2 text-xs">
                      <Badge variant="secondary">{board.executionProvider}</Badge>
                      {board.defaultExecutionRuntime ? <Badge variant="secondary">{board.defaultExecutionRuntime}</Badge> : null}
                      <span className="text-xs text-muted-foreground">
                        milestone: {board.gsd?.milestone?.status ?? "unknown"} - binding: {board.gsd?.milestone?.binding?.status ?? "unknown"}
                      </span>
                    </div>
                  ) : null}
                </div>
                <Button type="button" variant="secondary" onClick={() => void archiveBoard()}>
                  <Archive className="mr-2 h-4 w-4" aria-hidden="true" />
                  Archive
                </Button>
              </div>

              {board.executionProvider === "gsd" ? (
                <div className="space-y-3 rounded-md border border-border bg-card p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">
                        {board.gsd?.milestone?.binding?.status === "synced" ? "GSD milestone synced" : "GSD milestone in progress"}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        milestone: {board.gsd?.milestone?.status ?? "unknown"} - binding: {board.gsd?.milestone?.binding?.status ?? "unknown"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {board.gsd?.milestone?.binding?.status === "synced"
                          ? `Add new tasks with ${board.gsd?.taskCreation?.addPhaseCommand ?? "$gsd-phase add"}, then sync the board.`
                          : `${board.gsd?.milestone?.invocation ?? board.gsd?.milestone?.command ?? "$gsd-new-milestone"} has started. Complete the GSD milestone and attach the roadmap before tasks are available.`}
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button type="button" variant="secondary" onClick={() => void syncBoardFromRoadmap()}>
                        <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
                        Sync Phases
                      </Button>
                      {board.gsd?.milestone?.roadmapPath ? null : (
                        <Button type="button" variant="secondary" onClick={() => void repairBoardMilestone()}>
                          <ShieldAlert className="mr-2 h-4 w-4" aria-hidden="true" />
                          Repair
                        </Button>
                      )}
                    </div>
                  </div>
                  {board.gsd?.milestone?.lastOutput ? (
                    <pre className="max-h-52 overflow-auto rounded-md bg-muted p-3 text-xs text-muted-foreground">{board.gsd.milestone.lastOutput}</pre>
                  ) : null}
                  {board.gsd?.milestone?.status === "waiting_for_user" ? (
                    <form className="flex flex-col gap-2 sm:flex-row" onSubmit={answerBoardMilestone}>
                      <Input
                        aria-label="Milestone answer"
                        placeholder="answer"
                        value={milestoneAnswer}
                        onChange={(event) => setMilestoneAnswer(event.target.value)}
                      />
                      <Button type="submit" disabled={!milestoneAnswer.trim()}>
                        <PlayCircle className="mr-2 h-4 w-4" aria-hidden="true" />
                        Send
                      </Button>
                    </form>
                  ) : null}
                </div>
              ) : null}

              <div className="min-h-[520px] min-w-0">
                <KanbanProvider columns={kanbanColumns} data={kanbanTasks} onDataChange={handleKanbanDataChange} className="h-full">
                  {(column) => {
                    const count = kanbanTasks.filter((task) => task.column === column.id).length;
                    return (
                      <KanbanBoard id={column.id} key={column.id} className="h-full">
                        <KanbanHeader className="flex items-center justify-between gap-3">
                          <span>{column.name}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </KanbanHeader>
                        <KanbanCards<BoardKanbanItem> id={column.id}>
                          {(item) => (
                            <KanbanCard key={item.id} {...item}>
                              <TaskBoardCard
                                task={item.task}
                                agents={agents}
                                columns={columns}
                                onMove={moveTask}
                                onAssign={assignTask}
                                onSave={saveTask}
                              />
                            </KanbanCard>
                          )}
                        </KanbanCards>
                      </KanbanBoard>
                    );
                  }}
                </KanbanProvider>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

function TaskBoardCard({ task, agents, columns, onMove, onAssign, onSave }: {
  task: BoardTask;
  agents: BoardAgent[];
  columns: BoardStatus[];
  onMove: (task: BoardTask, status: BoardStatus) => Promise<void>;
  onAssign: (task: BoardTask, agentId: string) => Promise<void>;
  onSave: (task: BoardTask, input: { title: string; priority: string; deliverable: string }) => Promise<void>;
}) {
  const [agentId, setAgentId] = useState(task.assignedAgent?.id ?? agents[0]?.id ?? "");
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState(task.priority ?? "normal");
  const [deliverable, setDeliverable] = useState(task.deliverable ?? "");
  const phase = typeof task.refs?.phase === "string" ? task.refs.phase : "";
  return (
    <article className="text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="mono truncate text-xs text-muted-foreground">{task.id}</p>
          <Input className="mt-1 h-8" value={title} onChange={(event) => setTitle(event.target.value)} />
        </div>
        {task.execution ? <Badge variant={executionVariant(task.execution.status)}>{executionLabel(task.execution.status)}</Badge> : null}
      </div>
      <Input className="mt-2 h-8" placeholder="deliverable" value={deliverable} onChange={(event) => setDeliverable(event.target.value)} />
      <div className="mt-3 flex flex-wrap gap-1">
        <Badge variant="secondary">{priority || "normal"}</Badge>
        {phase ? <Badge variant="secondary">phase {phase}</Badge> : null}
        {task.assignedAgent ? <Badge>{task.assignedAgent.id}</Badge> : null}
      </div>
      <div className="mt-3 grid gap-2">
        <Input className="h-8" placeholder="priority" value={priority} onChange={(event) => setPriority(event.target.value)} />
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={task.status}
          onChange={(event) => void onMove(task, event.target.value as BoardStatus)}
        >
          {columns.map((status) => <option key={status} value={status}>{statusLabel(status)}</option>)}
        </select>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2">
          <select
            className="h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          >
            {agents.length === 0 ? <option value="">No agents</option> : agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.id}</option>)}
          </select>
          <Button type="button" size="sm" disabled={!agentId} onClick={() => void onAssign(task, agentId)}>
            <PlayCircle className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <Button type="button" size="sm" variant="secondary" onClick={() => void onSave(task, { title, priority, deliverable })}>
          <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          Save
        </Button>
      </div>
    </article>
  );
}

function AssetList({ resources, selectedId, selectedSource, scope, payload, projectPayload, onSelect, onAddReference, onRemoveReference }: {
  resources: EditableResource[];
  selectedId: string | null;
  selectedSource: "project" | "global";
  scope: "project" | "global";
  payload: ConfigPayload;
  projectPayload: ConfigPayload | null;
  onSelect: (resource: EditableResource) => void;
  onAddReference: (resource: EditableResource) => void;
  onRemoveReference: (resource: EditableResource) => void;
}) {
  if (resources.length === 0) {
    return <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No assets.</div>;
  }

  return (
    <div className="space-y-2">
      {resources.map((resource) => (
        <button
          key={resource.id}
          type="button"
          onClick={() => onSelect(resource)}
          className={`w-full rounded-md border p-3 text-left transition ${selectedId === resource.id && selectedSource === (resource.source ?? scope) ? "border-primary bg-card" : "border-border bg-background hover:border-primary"}`}
        >
          <div className="flex min-w-0 items-start justify-between gap-3">
            <span className="min-w-0">
              <strong className="mono block truncate text-sm">{resource.id}</strong>
              <span className="mt-1 block text-xs text-muted-foreground">{runtimeSummary(resource)}</span>
            </span>
            <span className="flex shrink-0 flex-wrap justify-end gap-1">
              <SourceBadge resource={resource} />
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{resource.description || "No description."}</p>
          {scope === "global" ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant={isReferenced(projectPayload, resource) ? "secondary" : "default"}
                disabled={isReferenced(projectPayload, resource)}
                onClick={(event) => {
                  event.stopPropagation();
                  void onAddReference(resource);
                }}
              >
                <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
                {isReferenced(projectPayload, resource) ? "Referenced" : "Use in this project"}
              </Button>
            </div>
          ) : resource.readOnly ? (
            <div className="mt-3">
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={(event) => {
                  event.stopPropagation();
                  void onRemoveReference(resource);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
                Remove reference
              </Button>
            </div>
          ) : null}
        </button>
      ))}
    </div>
  );
}

function KindOverview({ kind, resources, payload, scope }: { kind: ResourceKind; resources: EditableResource[]; payload: ConfigPayload; scope: "project" | "global" }) {
  const coverage = runtimeCoverage(resources);
  const warnings = resources.flatMap((resource) => validateDraft(resource, payload)).filter((item) => item.severity !== "info");

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>{scope === "global" ? `Global ${labelForKind(kind)}` : labelForKind(kind)}</CardTitle>
          <CardDescription>{resources.length} configured</CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          {kindHint(kind)}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Runtime Coverage</CardTitle>
          <CardDescription>Selected targets</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <CoverageRow label="Claude Code" value={coverage.claude} total={resources.length} />
          <CoverageRow label="Codex" value={coverage.codex} total={resources.length} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Validation</CardTitle>
          <CardDescription>{warnings.length === 0 ? "No warnings" : `${warnings.length} item${warnings.length === 1 ? "" : "s"}`}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {warnings.length === 0 ? (
            <StatusLine ok text="Ready" />
          ) : warnings.slice(0, 4).map((item) => (
            <StatusLine key={`${item.path}-${item.message}`} ok={false} text={item.message} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

function AssetEditor({ draft, setDraft, payload, scope, diagnostics, message, onSubmit }: {
  draft: EditableResource;
  setDraft: (resource: EditableResource) => void;
  payload: ConfigPayload;
  scope: "project" | "global";
  diagnostics: Diagnostic[];
  message: string;
  onSubmit: (event: React.FormEvent) => void;
}) {
  const blocking = diagnostics.some((item) => item.blocking);
  const workflowBacked = Boolean(draft.workflow);

  return (
    <form className="mx-auto max-w-5xl space-y-5" onSubmit={onSubmit}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{draft.id || `New ${draft.kind}`}</h2>
          <p className="text-sm text-muted-foreground">{scopeLabel(scope)} {kindHint(draft.kind)}</p>
        </div>
        <Button type="submit" disabled={blocking}>
          <Save className="mr-2 h-4 w-4" aria-hidden="true" />
          Save
        </Button>
      </div>

      {message ? <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">{message}</p> : null}

      <Card>
        <CardHeader>
          <CardTitle>Asset</CardTitle>
          <CardDescription>Shared metadata and source body</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-2">
          <Field label="ID" hint="letters, numbers, dots, underscores, hyphens">
            <Input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} required />
          </Field>
          <Field label="Name" hint="display name">
            <Input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} />
          </Field>
          <Field label="Description" hint={descriptionHint(draft.kind)} className="md:col-span-2">
            <Input value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} />
          </Field>
          {draft.kind === "rule" ? (
            <Field label="Paths" hint="comma-separated path scopes, e.g. src, ui/src" className="md:col-span-2">
              <Input value={(draft.paths ?? []).join(", ")} onChange={(event) => setDraft({ ...draft, paths: splitList(event.target.value) })} />
            </Field>
          ) : null}
          {draft.kind === "agent" ? (
            <Field label="Tools" hint="comma-separated tool names" className="md:col-span-2">
              <Input value={(draft.tools ?? []).join(", ")} onChange={(event) => setDraft({ ...draft, tools: splitList(event.target.value) })} />
            </Field>
          ) : null}
          <div className="md:col-span-2">
            <div className="grid grid-cols-2 rounded-md border border-border bg-background p-1">
              <button
                type="button"
                onClick={() => setDraft(simpleDraft(draft))}
                className={`h-9 rounded px-3 text-sm transition ${!workflowBacked ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                Simple
              </button>
              <button
                type="button"
                onClick={() => setDraft(workflowDraft(draft, payload))}
                className={`h-9 rounded px-3 text-sm transition ${workflowBacked ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                Workflow-backed
              </button>
            </div>
          </div>
          {workflowBacked ? (
            <WorkflowControls draft={draft} setDraft={setDraft} payload={payload} />
          ) : null}
          <Field label={bodyLabel(draft.kind)} hint="markdown" className="md:col-span-2">
            <ReferenceInsertButtons payload={payload} onInsert={(token) => setDraft({ ...draft, body: appendToken(draft.body, token) })} />
            <Textarea className="min-h-60 mono" value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} />
          </Field>
        </CardContent>
      </Card>

      {draft.kind === "skill" || draft.kind === "command" ? (
        <AssociatedFilesEditor draft={draft} setDraft={setDraft} />
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Runtimes</CardTitle>
          <CardDescription>Target assistants for this asset</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {runtimes.map((runtime) => (
              <label key={runtime} className={`flex items-center gap-3 rounded-md border border-border bg-background p-3 ${capabilityStatus(payload, draft, runtime) === "unsupported-fail" ? "opacity-60" : ""}`}>
                <input
                  type="checkbox"
                  checked={draft.runtimes.includes(runtime)}
                  disabled={capabilityStatus(payload, draft, runtime) === "unsupported-fail"}
                  onChange={(event) => setDraft(toggleRuntime(draft, runtime, event.target.checked))}
                />
                <span className="flex flex-1 items-center justify-between gap-3">
                  <span>{runtimeName(runtime)}</span>
                  <CapabilityBadge compact status={capabilityStatus(payload, draft, runtime)} />
                </span>
              </label>
            ))}
          </div>

          <div className="space-y-3 border-t border-border pt-4">
            <div>
              <h3 className="text-sm font-medium">Runtime overrides</h3>
              <p className="text-sm text-muted-foreground">Optional per-runtime content. Shared body is used unless an override is enabled.</p>
            </div>
            {runtimes.map((runtime) => (
              <OverrideSection key={runtime} runtime={runtime} draft={draft} setDraft={setDraft} targeted={draft.runtimes.includes(runtime)} />
            ))}
          </div>
        </CardContent>
      </Card>

      <ValidationPanel diagnostics={diagnostics} />
    </form>
  );
}

function WorkflowControls({ draft, setDraft, payload }: { draft: EditableResource; setDraft: (resource: EditableResource) => void; payload: ConfigPayload }) {
  const args = draft.arguments ?? [];
  const updateArgument = (index: number, next: { name: string; description?: string; required?: boolean; hint?: string }) => {
    setDraft({ ...draft, arguments: args.map((arg, itemIndex) => itemIndex === index ? next : arg) });
  };
  return (
    <div className="md:col-span-2 space-y-4 rounded-md border border-border bg-background p-4">
      <Field label="Workflow" hint="shared workflow id">
        <select
          className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          value={draft.workflow ?? ""}
          onChange={(event) => setDraft({ ...draft, workflow: event.target.value || undefined })}
        >
          <option value="">Select workflow</option>
          {payload.workflows.map((workflow) => <option key={workflow.id} value={workflow.id}>{workflow.id}</option>)}
        </select>
      </Field>
      <Field label="Argument hint" hint="shown in wrapper metadata">
        <Input value={draft.argumentHint ?? ""} onChange={(event) => setDraft({ ...draft, argumentHint: event.target.value || undefined })} />
      </Field>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">Arguments</h3>
          <Button type="button" variant="secondary" size="sm" onClick={() => setDraft({ ...draft, arguments: [...args, { name: "", description: "", required: false }] })}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Add argument
          </Button>
        </div>
        {args.length === 0 ? <p className="text-sm text-muted-foreground">No wrapper arguments.</p> : null}
        {args.map((arg, index) => (
          <div key={`${arg.name}-${index}`} className="grid gap-3 rounded-md border border-border p-3 md:grid-cols-[1fr_2fr_auto]">
            <Field label="Name" hint="id">
              <Input value={arg.name} onChange={(event) => updateArgument(index, { ...arg, name: event.target.value })} />
            </Field>
            <Field label="Description" hint="optional">
              <Input value={arg.description ?? ""} onChange={(event) => updateArgument(index, { ...arg, description: event.target.value })} />
            </Field>
            <label className="flex items-center gap-2 self-end rounded-md border border-border px-3 py-2 text-sm">
              <input type="checkbox" checked={Boolean(arg.required)} onChange={(event) => updateArgument(index, { ...arg, required: event.target.checked })} />
              Required
            </label>
          </div>
        ))}
      </div>
    </div>
  );
}

function ReferenceInsertButtons({ payload, onInsert }: { payload: ConfigPayload; onInsert: (token: string) => void }) {
  const skills = [...payload.resources, ...payload.referencedResources].filter((resource) => resource.kind === "skill");
  const items = [
    ...skills.map((skill) => ({ label: `skill:${skill.id}`, token: `{{skills.${skill.id}}}` })),
    ...payload.workflows.map((workflow) => ({ label: `workflow:${workflow.id}`, token: `{{workflows.${workflow.id}}}` }))
  ];
  if (items.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {items.slice(0, 8).map((item) => (
        <Button key={item.token} type="button" size="sm" variant="secondary" onClick={() => onInsert(item.token)}>
          <Link2 className="mr-2 h-4 w-4" aria-hidden="true" />
          {item.label}
        </Button>
      ))}
    </div>
  );
}

function AssociatedFilesEditor({ draft, setDraft }: { draft: EditableResource; setDraft: (resource: EditableResource) => void }) {
  const files = draft.files ?? [];
  const updateFile = (index: number, next: { path?: string; name?: string; body: string }) => {
    setDraft({ ...draft, files: files.map((file, itemIndex) => itemIndex === index ? next : file) });
  };
  const removeFile = (index: number) => {
    setDraft({ ...draft, files: files.filter((_, itemIndex) => itemIndex !== index) });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Additional files</CardTitle>
        <CardDescription>Stored under this asset's files folder and rendered with the generated artifact.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {files.length === 0 ? <p className="text-sm text-muted-foreground">No helper files.</p> : null}
        {files.map((file, index) => (
          <div key={`${file.path}-${index}`} className="rounded-md border border-border p-3">
            <div className="mb-3 flex items-end gap-3">
              <Field label="Filename" hint="stored in files/" className="flex-1">
                <Input value={associatedFileName(file)} onChange={(event) => updateFile(index, { ...file, path: undefined, name: event.target.value })} />
              </Field>
              <Button type="button" variant="secondary" onClick={() => removeFile(index)}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            </div>
            <Field label="Body" hint="text">
              <Textarea className="mono min-h-40" value={file.body} onChange={(event) => updateFile(index, { ...file, body: event.target.value })} />
            </Field>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => setDraft({ ...draft, files: [...files, { name: "", body: "" }] })}>
          <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
          Add file
        </Button>
      </CardContent>
    </Card>
  );
}

function ReadOnlyResource({ resource, onRemoveReference }: { resource: EditableResource; onRemoveReference: (resource: EditableResource) => void }) {
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">{resource.id}</h2>
          <p className="text-sm text-muted-foreground">Referenced global {resource.kind}</p>
        </div>
        <Button type="button" variant="secondary" onClick={() => void onRemoveReference(resource)}>
          <Trash2 className="mr-2 h-4 w-4" aria-hidden="true" />
          Remove reference
        </Button>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Global Source</CardTitle>
          <CardDescription>{resource.kind}:{resource.id}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{resource.description || "No description."}</p>
          <Textarea className="mono min-h-80" value={resource.body} readOnly />
        </CardContent>
      </Card>
    </div>
  );
}

function OverrideSection({ runtime, draft, setDraft, targeted }: { runtime: RuntimeId; draft: EditableResource; setDraft: (resource: EditableResource) => void; targeted: boolean }) {
  const override = draft.overrides[runtime] ?? { enabled: false };
  const setOverride = (next: RuntimeOverride) => setDraft({ ...draft, overrides: { ...draft.overrides, [runtime]: next } });

  return (
    <div className={`rounded-md border border-border ${targeted ? "bg-background" : "bg-muted/30"}`}>
      <label className="flex items-center gap-3 p-3">
        <input
          type="checkbox"
          checked={override.enabled}
          disabled={!targeted}
          onChange={(event) => setOverride({ ...override, enabled: event.target.checked })}
        />
        <span>{runtimeName(runtime)} override</span>
        {!targeted ? <span className="text-xs text-muted-foreground">Select {runtimeName(runtime)} first</span> : null}
      </label>
      {override.enabled ? (
        <div className="grid gap-4 border-t border-border p-3 md:grid-cols-2">
          <Field label="Name" hint="runtime-specific display name">
            <Input value={override.name ?? ""} onChange={(event) => setOverride({ ...override, name: event.target.value })} />
          </Field>
          <Field label="Description" hint="runtime-specific description">
            <Input value={override.description ?? ""} onChange={(event) => setOverride({ ...override, description: event.target.value })} />
          </Field>
          {draft.kind === "agent" ? (
            <Field label="Tools" hint="comma-separated tools" className="md:col-span-2">
              <Input value={(override.tools ?? []).join(", ")} onChange={(event) => setOverride({ ...override, tools: splitList(event.target.value) })} />
            </Field>
          ) : null}
          {draft.kind === "rule" ? (
            <Field label="Paths" hint="comma-separated path scopes" className="md:col-span-2">
              <Input value={(override.paths ?? []).join(", ")} onChange={(event) => setOverride({ ...override, paths: splitList(event.target.value) })} />
            </Field>
          ) : null}
          <Field label={`${runtimeName(runtime)} body`} hint="leave blank to use shared body" className="md:col-span-2">
            <Textarea className="min-h-36 mono" value={override.body ?? ""} onChange={(event) => setOverride({ ...override, body: event.target.value })} />
          </Field>
        </div>
      ) : null}
    </div>
  );
}

function SectionEditor({ activeSection, payload, refreshConfig }: { activeSection: SectionKind; payload: ConfigPayload; refreshConfig: () => Promise<void> }) {
  const [draft, setDraft] = useState(() => sectionJson(payload, activeSection));
  const [message, setMessage] = useState("");

  useEffect(() => {
    setDraft(sectionJson(payload, activeSection));
    setMessage("");
  }, [payload, activeSection]);

  async function saveSection(event: React.FormEvent) {
    event.preventDefault();
    let parsed: unknown;
    try {
      parsed = JSON.parse(draft);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Invalid JSON");
      return;
    }

    const response = await fetch("/api/config/sections", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [activeSection]: parsed })
    });
    const result = await response.json();
    if (!response.ok || result.ok === false) {
      setMessage(result.error ?? result.diagnostics?.[0]?.message ?? "Save failed");
      return;
    }

    setMessage(`Saved ${sectionLabel(activeSection)}`);
    await refreshConfig();
  }

  const relatedDiagnostics = payload.diagnostics.filter((item) => item.path === activeSection || item.path.startsWith(`${activeSection}[`) || item.path.startsWith(`${activeSection}.`));

  return (
    <section className="p-5">
      <form className="mx-auto max-w-5xl space-y-5" onSubmit={saveSection}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-2xl font-semibold">{sectionLabel(activeSection)}</h2>
            <p className="text-sm text-muted-foreground">{sectionHint(activeSection)}</p>
          </div>
          <Button type="submit">
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            Save
          </Button>
        </div>

        {message ? <p className="rounded-md border border-border bg-card p-3 text-sm text-muted-foreground">{message}</p> : null}

        <Card>
          <CardHeader>
            <CardTitle>{sectionLabel(activeSection)}</CardTitle>
            <CardDescription>{sectionSchemaHint(activeSection)}</CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea className="mono min-h-[420px]" value={draft} onChange={(event) => setDraft(event.target.value)} />
          </CardContent>
        </Card>

        <ValidationPanel diagnostics={relatedDiagnostics} />
      </form>
    </section>
  );
}

function ReviewPanel({ payload }: { payload: ConfigPayload }) {
  const allDiagnostics = [
    ...payload.diagnostics,
    ...payload.resources.flatMap((resource) => validateDraft(resource, payload))
  ];
  const issues = allDiagnostics.filter((item) => item.severity !== "info");
  const coverage = runtimeCoverage(payload.resources);
  const capabilityCounts = capabilitySummary(payload.resources, payload);

  return (
    <section className="p-5">
      <div className="mx-auto grid max-w-6xl gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Config</CardTitle>
            <CardDescription>{payload.workspaceConfigExists ? ".aof workspace" : "not created yet"}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p><span className="text-muted-foreground">Name:</span> {payload.name}</p>
            <p className="mono break-all text-xs">{payload.configPath}</p>
            <StatusLine ok={issues.filter((item) => item.blocking).length === 0} text={issues.filter((item) => item.blocking).length === 0 ? "No blocking issues" : "Blocking issues found"} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Runtime Coverage</CardTitle>
            <CardDescription>{payload.resources.length} assets</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <CoverageRow label="Claude Code" value={coverage.claude} total={payload.resources.length} />
            <CoverageRow label="Codex" value={coverage.codex} total={payload.resources.length} />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Capabilities</CardTitle>
            <CardDescription>Across selected runtimes</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {Object.entries(capabilityCounts).map(([status, count]) => (
              <Badge key={status} variant={status === "unsupported-fail" ? "destructive" : "secondary"}>{status}: {count}</Badge>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Diagnostics</CardTitle>
            <CardDescription>{issues.length === 0 ? "clear" : `${issues.length} issue${issues.length === 1 ? "" : "s"}`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {issues.length === 0 ? <StatusLine ok text="Valid" /> : issues.slice(0, 8).map((item) => (
              <StatusLine key={`${item.path}-${item.message}`} ok={item.severity !== "error"} text={`${item.path}: ${item.message}`} />
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Adapter Warnings</CardTitle>
            <CardDescription>{payload.adapterWarnings.length === 0 ? "clear" : `${payload.adapterWarnings.length} warning${payload.adapterWarnings.length === 1 ? "" : "s"}`}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {payload.adapterWarnings.length === 0 ? <StatusLine ok text="No adapter degradation warnings." /> : payload.adapterWarnings.slice(0, 6).map((warning) => (
              <div key={`${warning.code}-${warning.path}-${warning.runtime}-${warning.id}`} className="rounded-md border border-border bg-background p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{warning.code}</Badge>
                  <span className="mono text-xs">{warning.runtime}</span>
                  <span className="mono text-xs">{warning.kind}:{warning.id}</span>
                </div>
                <p className="mt-2 text-muted-foreground">{warning.path}{warning.generatedPath ? ` -> ${warning.generatedPath}` : ""}</p>
                <p className="mt-2">{warning.reason}</p>
                <p className="mt-1 text-muted-foreground">{warning.remediation}</p>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Packages</CardTitle>
            <CardDescription>{payload.packages.length} declared</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {payload.packages.length === 0 ? <p className="text-muted-foreground">No managed packages.</p> : payload.packages.map((item) => (
              <p key={item.id} className="mono text-xs">{item.id} {item.source}</p>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Expanded DSL</CardTitle>
            <CardDescription>Generated project config</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {sections.map((section) => (
              <div key={section.id} className="flex items-center justify-between gap-3">
                <span>{section.label}</span>
                <span className="mono text-xs">{sectionCount(payload, section.id)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Next Commands</CardTitle>
            <CardDescription>Run in terminal</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {payload.nextCommands.map((command) => (
              <p key={command} className="mono rounded-md bg-muted p-2 text-xs">{command}</p>
            ))}
          </CardContent>
        </Card>
      </div>
    </section>
  );
}

function ValidationPanel({ diagnostics }: { diagnostics: Diagnostic[] }) {
  const visible = diagnostics.filter((item) => item.severity !== "info");
  if (visible.length === 0) return <StatusLine ok text="No blocking validation issues." />;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Validation</CardTitle>
        <CardDescription>{visible.length} issue{visible.length === 1 ? "" : "s"}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {visible.map((item) => <StatusLine key={`${item.path}-${item.message}`} ok={!item.blocking} text={item.message} />)}
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, className, children }: { label: string; hint: string; className?: string; children: React.ReactNode }) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className={`space-y-2 ${className ?? ""}`}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={id}>{label}</Label>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function CapabilityPills({ resource, payload }: { resource: EditableResource; payload: ConfigPayload }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {resource.runtimes.map((runtime) => (
        <CapabilityBadge key={runtime} compact status={capabilityStatus(payload, resource, runtime)} />
      ))}
    </span>
  );
}

function SourceBadge({ resource }: { resource: EditableResource }) {
  const source = resource.source ?? "project";
  return (
    <Badge variant={source === "global" ? "secondary" : "default"}>
      {source === "global" ? <Globe2 className="mr-1 h-3 w-3" aria-hidden="true" /> : null}
      {resource.readOnly ? "global ref" : source}
    </Badge>
  );
}

function CapabilityBadge({ status, compact = false }: { status: string; compact?: boolean }) {
  const variant = status === "unsupported-fail" ? "destructive" : status === "native" ? "default" : "secondary";
  return <Badge variant={variant}>{compact ? shortStatus(status) : status}</Badge>;
}

function CoverageRow({ label, value, total }: { label: string; value: number; total: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span>{label}</span>
      <span className="mono text-xs">{value}/{total}</span>
    </div>
  );
}

function StatusLine({ ok, text }: { ok: boolean; text: string }) {
  const Icon = ok ? CheckCircle2 : ShieldAlert;
  return (
    <p className={`flex items-start gap-2 text-sm ${ok ? "text-primary" : "text-accent"}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <span>{text}</span>
    </p>
  );
}

function validateDraft(resource: EditableResource, payload: ConfigPayload | null): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  if (!resource.id || !/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(resource.id)) {
    diagnostics.push({ severity: "error", path: "id", message: "Use letters, numbers, dots, underscores, or hyphens.", blocking: true });
  }
  if (resource.runtimes.length === 0) {
    diagnostics.push({ severity: "error", path: "runtimes", message: "Select at least one runtime.", blocking: true });
  }
  if (payload) {
    for (const runtime of resource.runtimes) {
      const status = capabilityStatus(payload, resource, runtime);
      if (status === "unsupported-fail") {
        diagnostics.push({ severity: "error", path: `capabilities.${runtime}`, message: `${runtimeName(runtime)} is not supported for ${resource.kind}.`, blocking: true });
      } else if (status === "mapped") {
        diagnostics.push({ severity: "warning", path: `capabilities.${runtime}`, message: `${runtimeName(runtime)} uses mapped output for ${resource.kind}.`, blocking: false });
      } else if (status !== "native") {
        diagnostics.push({ severity: "warning", path: `capabilities.${runtime}`, message: `${runtimeName(runtime)} status: ${status}.`, blocking: false });
      }
    }
  }
  if (payload?.scope === "global" && resource.kind === "command") {
    diagnostics.push({ severity: "error", path: "kind", message: "Global setup UI supports skills, agents, and rules.", blocking: true });
  }
  if ((resource.files ?? []).length > 0 && resource.kind !== "skill" && resource.kind !== "command") {
    diagnostics.push({ severity: "error", path: "files", message: "Additional files are supported for skills and commands.", blocking: true });
  }
  if (!resource.workflow && ((resource.arguments ?? []).length > 0 || resource.argumentHint || resource.argumentOverrides)) {
    diagnostics.push({ severity: "error", path: "arguments", message: "Simple assets do not support arguments.", blocking: true });
  }
  if (resource.workflow && !payload?.workflows.some((workflow) => workflow.id === resource.workflow)) {
    diagnostics.push({ severity: "error", path: "workflow", message: "Select a known workflow.", blocking: true });
  }
  return diagnostics;
}

function capabilityStatus(payload: ConfigPayload, resource: EditableResource, runtime: RuntimeId) {
  if (resource.kind === "rule" && (resource.paths ?? []).length > 0) {
    return payload.capabilities.capabilities.pathScopedRule?.[runtime] ?? "native";
  }
  return payload.capabilities.capabilities[resource.kind]?.[runtime] ?? "native";
}

function capabilitySummary(resources: EditableResource[], payload: ConfigPayload) {
  return resources.reduce<Record<string, number>>((summary, resource) => {
    for (const runtime of resource.runtimes) {
      const status = capabilityStatus(payload, resource, runtime);
      summary[status] = (summary[status] ?? 0) + 1;
    }
    return summary;
  }, {});
}

function runtimeCoverage(resources: EditableResource[]) {
  return {
    claude: resources.filter((resource) => resource.runtimes.includes("claude")).length,
    codex: resources.filter((resource) => resource.runtimes.includes("codex")).length
  };
}

function toggleRuntime(resource: EditableResource, runtime: RuntimeId, checked: boolean): EditableResource {
  const runtimes = checked
    ? [...new Set([...resource.runtimes, runtime])]
    : resource.runtimes.filter((item) => item !== runtime);
  return { ...resource, runtimes };
}

function simpleDraft(resource: EditableResource): EditableResource {
  const next = { ...resource };
  delete next.workflow;
  delete next.argumentHint;
  delete next.arguments;
  delete next.argumentOverrides;
  return next;
}

function workflowDraft(resource: EditableResource, payload: ConfigPayload): EditableResource {
  return {
    ...resource,
    workflow: resource.workflow ?? payload.workflows[0]?.id ?? "",
    arguments: resource.arguments ?? []
  };
}

function blankResource(kind: ResourceKind): EditableResource {
  return {
    id: "",
    kind,
    name: "",
    description: "",
    body: "",
    files: kind === "skill" ? [] : undefined,
    runtimes: kind === "command" ? ["claude"] : ["claude", "codex"],
    overrides: {
      claude: { enabled: false },
      codex: { enabled: false }
    }
  };
}

function appendToken(value: string, token: string) {
  const prefix = value && !value.endsWith("\n") && !value.endsWith(" ") ? " " : "";
  return `${value}${prefix}${token}`;
}

function cloneResource(resource: EditableResource): EditableResource {
  return JSON.parse(JSON.stringify(resource));
}

function splitList(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function labelForKind(kind: ResourceKind) {
  return kinds.find((item) => item.id === kind)?.label ?? kind;
}

function isResourceKind(value: ResourceKind | SectionKind | "boards" | "review"): value is ResourceKind {
  return kinds.some((kind) => kind.id === value);
}

function isSectionKind(value: ResourceKind | SectionKind | "boards" | "review"): value is SectionKind {
  return sections.some((section) => section.id === value);
}

function activeCount(payload: ConfigPayload, kind: ResourceKind, scope: "project" | "global") {
  const local = payload.resources.filter((resource) => resource.kind === kind).length;
  const refs = scope === "project" ? payload.referencedResources.filter((resource) => resource.kind === kind).length : 0;
  return local + refs;
}

function isReferenced(projectPayload: ConfigPayload | null, resource: EditableResource) {
  return Boolean(projectPayload?.globalRefs?.some((ref) => ref.kind === resource.kind && ref.id === resource.id));
}

function scopeLabel(scope: "project" | "global") {
  return scope === "global" ? "Global source." : "Project-local source.";
}

function sectionLabel(section: SectionKind) {
  return sections.find((item) => item.id === section)?.label ?? section;
}

function sectionJson(payload: ConfigPayload, section: SectionKind) {
  return `${JSON.stringify(payload[section], null, 2)}\n`;
}

function sectionCount(payload: ConfigPayload, section: SectionKind) {
  if (section === "settings") return Object.keys(payload.settings ?? {}).length;
  const value = payload[section];
  return Array.isArray(value) ? value.length : 0;
}

function sectionHint(section: SectionKind) {
  if (section === "mcpServers") return "Project MCP declarations rendered to runtime config files.";
  if (section === "hooks") return "Common command hooks with runtime-specific escape hatches.";
  if (section === "projectDocs") return "Root assistant guidance rendered to AGENTS.md and CLAUDE.md.";
  return "Runtime-specific settings merged into generated project config.";
}

function sectionSchemaHint(section: SectionKind) {
  if (section === "settings") return "JSON object";
  return "JSON array";
}

function runtimeName(runtime: RuntimeId) {
  return runtime === "claude" ? "Claude Code" : "Codex";
}

function runtimeSummary(resource: EditableResource) {
  if (resource.runtimes.length === 0) return "No runtime targets";
  return resource.runtimes.map(runtimeName).join(", ");
}

function associatedFileName(file: { path?: string; name?: string }) {
  if (file.name !== undefined) return file.name;
  const pathName = file.path ?? "";
  return pathName.startsWith("files/") && !pathName.slice("files/".length).includes("/")
    ? pathName.slice("files/".length)
    : pathName;
}

function shortStatus(status: string) {
  if (status === "unsupported-fail") return "fail";
  if (status === "unsupported-warning") return "warn";
  return status;
}

function statusLabel(status: BoardStatus) {
  const labels: Record<BoardStatus, string> = {
    backlog: "Backlog",
    ready: "Ready",
    in_progress: "In Progress",
    blocked: "Blocked",
    done: "Done"
  };
  return labels[status] ?? status;
}

function executionLabel(status: ExecutionStatus) {
  const labels: Record<ExecutionStatus, string> = {
    queued: "Queued",
    running: "Running",
    waiting_for_user: "Waiting",
    blocked: "Blocked",
    failed: "Failed",
    complete: "Complete"
  };
  return labels[status] ?? status;
}

function executionVariant(status: ExecutionStatus) {
  if (status === "failed" || status === "blocked") return "destructive" as const;
  if (status === "complete") return "default" as const;
  return "secondary" as const;
}

function getUiMode() {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "boards" || mode === "assets") return mode;

  const envMode = (import.meta as ImportMeta & { env?: { VITE_AOF_UI_MODE?: string } }).env?.VITE_AOF_UI_MODE;
  return envMode === "boards" ? "boards" : "assets";
}

function kindHint(kind: ResourceKind) {
  if (kind === "skill") return "Reusable instructions that assistants can invoke in context.";
  if (kind === "command") return "Named assistant commands with command-style prompts.";
  if (kind === "agent") return "Specialized assistant roles with instructions and optional tools.";
  return "Natural-language guidance that renders differently per runtime.";
}

function descriptionHint(kind: ResourceKind) {
  if (kind === "command") return "what the command does";
  if (kind === "agent") return "when to use this agent";
  if (kind === "rule") return "where this guidance applies";
  return "when this skill should be used";
}

function bodyLabel(kind: ResourceKind) {
  if (kind === "command") return "Prompt";
  if (kind === "agent") return "Instructions";
  if (kind === "rule") return "Guidance";
  return "Instructions";
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
