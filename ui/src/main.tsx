import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";
import { Archive, Bot, CheckCircle2, Code2, FileText, Globe2, Library, Link2, ListChecks, Pencil, PlayCircle, Plus, RefreshCw, Save, Send, Settings2, ShieldAlert, Sparkles, Terminal, Trash2, X } from "lucide-react";
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
  goal?: string | null;
  description?: string;
  status: BoardStatus;
  priority?: string;
  deliverable?: string;
  requirements?: string[];
  successCriteria?: string[];
  dependsOn?: string[];
  dependencyText?: string | null;
  refs?: Record<string, unknown>;
  assignedAgent?: { id: string; description?: string; assignedAt?: string } | null;
  execution?: ExecutionSummary | null;
  history?: Array<Record<string, unknown>>;
};

type ExecutionSummary = {
  provider: string;
  status: ExecutionStatus;
  phase?: string;
  updatedAt?: string;
  resume?: {
    pendingGate?: ExecutionGate | null;
    lastGateDecision?: { gateId: string; decision: string; answeredAt: string };
  };
};

type ExecutionGate = {
  id: string;
  kind: string;
  step?: string;
  message?: string;
  choices?: string[];
  createdAt?: string;
};

type ExecutionEvent = {
  at: string;
  type: string;
  message?: string;
  status?: string;
  phase?: string;
  agentId?: string;
  decision?: string;
  gate?: ExecutionGate;
  event?: Record<string, unknown>;
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
      <BoardsPanel />
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
  const [consoleTask, setConsoleTask] = useState<BoardTask | null>(null);
  const [syncingBoardId, setSyncingBoardId] = useState<string | null>(null);

  useEffect(() => {
    void refreshBoards();
  }, []);

  useEffect(() => {
    if (selectedBoardId) void loadBoard(selectedBoardId);
  }, [selectedBoardId]);

  async function refreshBoards(nextSelectedId = selectedBoardId) {
    await fetch("/api/boards/index", { method: "PUT" });
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
    if (syncingBoardId === board.id) return;
    const boardId = board.id;
    setSyncingBoardId(boardId);
    setMessage("Syncing GSD phases...");
    try {
      const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/sync`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ milestone: board.gsd?.milestone?.id })
      });
      const payload = await response.json();
      if (!response.ok || payload.ok === false) {
        setMessage(payload.error ?? "Roadmap sync failed");
        return;
      }
      const updated = Array.isArray(payload.updated) ? payload.updated.length : 0;
      setMessage(`Synced ${payload.created.length} new and ${updated} updated task${payload.created.length + updated === 1 ? "" : "s"} from ${payload.phases.length} GSD phase${payload.phases.length === 1 ? "" : "s"}.`);
      await refreshBoards(boardId);
    } finally {
      setSyncingBoardId((current) => current === boardId ? null : current);
    }
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
    if (isTaskAssignmentLocked(task)) {
      setMessage(`${task.id} is ${statusLabel(task.status)}; wait for execution to finish before changing agent assignment.`);
      return;
    }
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
  const gsdBacked = board?.executionProvider === "gsd";
  const configuredColumns: BoardStatus[] = board?.columns ?? ["backlog", "ready", "in_progress", "blocked", "done"];
  const columns = visibleBoardColumns(configuredColumns, gsdBacked);
  const kanbanColumns = columns.map((status) => ({ id: status, name: statusLabel(status) }));
  const kanbanTasks: BoardKanbanItem[] = board?.tasks.map((task) => ({
    id: task.id,
    name: task.title,
    column: visibleBoardStatus(task.status, gsdBacked),
    task
  })) ?? [];
  const isSyncingBoard = Boolean(board && syncingBoardId === board.id);

  return (
    <section className="min-h-screen w-full min-w-0 overflow-hidden bg-background">
      {message ? <p className="mb-4 rounded-md border border-border bg-card p-3 text-sm">{message}</p> : null}

      <div className="grid min-h-screen w-full min-w-0 grid-cols-[300px_minmax(0,1fr)] max-[980px]:grid-cols-1">
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

        <div className="min-w-0 overflow-hidden p-5">
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
                      <Button type="button" variant="secondary" onClick={() => void syncBoardFromRoadmap()} disabled={isSyncingBoard} aria-busy={isSyncingBoard}>
                        <RefreshCw className={`mr-2 h-4 w-4 ${isSyncingBoard ? "animate-spin" : ""}`} aria-hidden="true" />
                        {isSyncingBoard ? "Syncing..." : "Sync Phases"}
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
                  {isSyncingBoard ? (
                    <p className="text-xs text-muted-foreground" role="status" aria-live="polite">Refreshing roadmap phases and task state...</p>
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
                                gsdBacked={gsdBacked}
                                onMove={moveTask}
                                onAssign={assignTask}
                                onSave={saveTask}
                                onOpenConsole={setConsoleTask}
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
      {board && consoleTask ? (
        <ExecutionConsoleModal
          boardId={board.id}
          task={consoleTask}
          onClose={() => setConsoleTask(null)}
          onRefresh={() => void refreshBoards(board.id)}
        />
      ) : null}
    </section>
  );
}

function TaskBoardCard({ task, agents, columns, gsdBacked, onMove, onAssign, onSave, onOpenConsole }: {
  task: BoardTask;
  agents: BoardAgent[];
  columns: BoardStatus[];
  gsdBacked: boolean;
  onMove: (task: BoardTask, status: BoardStatus) => Promise<void>;
  onAssign: (task: BoardTask, agentId: string) => Promise<void>;
  onSave: (task: BoardTask, input: { title: string; priority: string; deliverable: string }) => Promise<void>;
  onOpenConsole: (task: BoardTask) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [agentId, setAgentId] = useState(task.assignedAgent?.id ?? "");
  const phase = typeof task.refs?.phase === "string" ? task.refs.phase : "";
  useEffect(() => {
    setAgentId(task.assignedAgent?.id ?? "");
  }, [task.assignedAgent?.id]);
  function stopCardDrag(event: React.SyntheticEvent) {
    event.stopPropagation();
  }
  function assignFromSelect(nextAgentId: string) {
    setAgentId(nextAgentId);
    if (!nextAgentId || nextAgentId === task.assignedAgent?.id) return;
    void onAssign(task, nextAgentId);
  }
  const assignmentLocked = isTaskAssignmentLocked(task);
  const showConsoleAction = Boolean(task.execution) && task.status !== "done" && task.execution?.status !== "complete";
  return (
    <article className="min-w-0 max-w-full text-sm">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <p className="mono truncate text-xs text-muted-foreground">{task.id}</p>
          <h4 className="mt-1 line-clamp-2 break-words pr-1 text-sm font-semibold leading-snug">{task.title}</h4>
        </div>
        <div className="shrink-0">
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="h-7 w-7 shrink-0 p-0"
            aria-label={`Edit ${task.id}`}
            onPointerDown={stopCardDrag}
            onMouseDown={stopCardDrag}
            onTouchStart={stopCardDrag}
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            <Pencil className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      </div>
      {task.execution ? (
        <div className="mt-2 flex min-w-0 items-center gap-2">
          <Badge className="max-w-full truncate px-2 text-[11px]" title={executionLabel(task.execution.status)} variant={executionVariant(task.execution.status)}>
            {executionLabel(task.execution.status)}
          </Badge>
        </div>
      ) : null}
      {task.goal || task.description ? (
        <p className="mt-2 line-clamp-3 break-words pr-1 text-xs leading-relaxed text-muted-foreground">{task.goal || task.description}</p>
      ) : null}
      {task.requirements?.length || task.dependsOn?.length ? (
        <div className="mono mt-2 flex min-w-0 flex-wrap gap-x-2 gap-y-1 pr-1 text-xs text-muted-foreground">
          {task.requirements?.length ? <span className="min-w-0 break-words">req: {task.requirements.join(", ")}</span> : null}
          {task.dependsOn?.length ? <span className="min-w-0 break-words">depends: {task.dependsOn.map((item) => `phase-${item}`).join(", ")}</span> : null}
        </div>
      ) : null}
      {task.assignedAgent ? <p className="mono mt-3 truncate text-xs text-muted-foreground">agent: {task.assignedAgent.id}</p> : null}
      {!assignmentLocked || showConsoleAction ? (
        <div className={`mt-3 grid min-w-0 gap-2 ${!assignmentLocked && showConsoleAction ? "grid-cols-[minmax(0,1fr)_auto]" : "grid-cols-1"}`}>
          {!assignmentLocked ? (
            <select
              className="block h-9 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm"
              value={agentId}
              disabled={agents.length === 0}
              aria-label={`Assign ${task.id}`}
              onPointerDown={stopCardDrag}
              onMouseDown={stopCardDrag}
              onTouchStart={stopCardDrag}
              onChange={(event) => assignFromSelect(event.target.value)}
            >
              <option value="">{agents.length === 0 ? "No agents configured" : "Assign agent"}</option>
              {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.id}</option>)}
            </select>
          ) : null}
          {showConsoleAction ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className={`h-9 shrink-0 ${assignmentLocked ? "w-full px-3" : "w-9 p-0"}`}
              aria-label={`Open console for ${task.id}`}
              onPointerDown={stopCardDrag}
              onMouseDown={stopCardDrag}
              onTouchStart={stopCardDrag}
              onClick={(event) => {
                event.stopPropagation();
                onOpenConsole(task);
              }}
            >
              <Terminal className="h-4 w-4" aria-hidden="true" />
              {assignmentLocked ? <span className="ml-2">Console</span> : null}
            </Button>
          ) : null}
        </div>
      ) : null}
      {editing ? (
        <TaskEditModal
          task={task}
          agents={agents}
          columns={columns}
          gsdBacked={gsdBacked}
          agentId={agentId}
          onAgentChange={setAgentId}
          onClose={() => setEditing(false)}
          onMove={onMove}
          onAssign={onAssign}
          onSave={onSave}
        />
      ) : null}
    </article>
  );
}

function TaskEditModal({ task, agents, columns, gsdBacked, agentId, onAgentChange, onClose, onMove, onAssign, onSave }: {
  task: BoardTask;
  agents: BoardAgent[];
  columns: BoardStatus[];
  gsdBacked: boolean;
  agentId: string;
  onAgentChange: (agentId: string) => void;
  onClose: () => void;
  onMove: (task: BoardTask, status: BoardStatus) => Promise<void>;
  onAssign: (task: BoardTask, agentId: string) => Promise<void>;
  onSave: (task: BoardTask, input: { title: string; priority: string; deliverable: string }) => Promise<void>;
}) {
  const [title, setTitle] = useState(task.title);
  const [priority, setPriority] = useState(task.priority ?? "normal");
  const [deliverable, setDeliverable] = useState(task.deliverable ?? "");
  const [status, setStatus] = useState<BoardStatus>(visibleBoardStatus(task.status, gsdBacked));
  const phase = typeof task.refs?.phase === "string" ? task.refs.phase : "";
  const assignmentLocked = isTaskAssignmentLocked(task);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function saveChanges(event: React.FormEvent) {
    event.preventDefault();
    await onSave(task, { title, priority, deliverable });
    if (status !== task.status) await onMove(task, status);
    onClose();
  }

  function assignFromSelect(nextAgentId: string) {
    onAgentChange(nextAgentId);
    if (!nextAgentId || nextAgentId === task.assignedAgent?.id) return;
    void onAssign(task, nextAgentId);
  }

  return createPortal((
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/70 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`task-edit-${task.id}`}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onMouseDownCapture={(event) => event.stopPropagation()}
      onTouchStartCapture={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <form className="w-full max-w-xl rounded-md border border-border bg-card p-4 shadow-xl" onSubmit={saveChanges}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="mono text-xs text-muted-foreground">{task.id}</p>
            <h3 id={`task-edit-${task.id}`} className="mt-1 text-lg font-semibold">Edit task</h3>
          </div>
          <Button type="button" size="sm" variant="secondary" onClick={onClose}>
            <X className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>

        <div className="mt-4 grid gap-3">
          <Field label="Title" hint="task summary">
            <Input value={title} onChange={(event) => setTitle(event.target.value)} />
          </Field>
          <Field label="Deliverable" hint="board-facing output">
            <Input value={deliverable} onChange={(event) => setDeliverable(event.target.value)} />
          </Field>
          {task.goal || task.requirements?.length || task.successCriteria?.length || task.dependsOn?.length ? (
            <div className="rounded-md border border-border bg-muted/40 p-3">
              <p className="text-sm font-semibold">Roadmap details</p>
              {task.goal ? (
                <Field label="Goal" hint="source-managed" className="mt-3">
                  <Textarea value={task.goal} readOnly className="min-h-20 resize-none" />
                </Field>
              ) : null}
              {task.requirements?.length ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground">Requirements</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {task.requirements.map((item) => <Badge key={item} variant="secondary">{item}</Badge>)}
                  </div>
                </div>
              ) : null}
              {task.dependsOn?.length ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground">Depends on</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {task.dependsOn.map((item) => <Badge key={item} variant="secondary">phase-{item}</Badge>)}
                  </div>
                  {task.dependencyText ? <p className="mt-2 text-xs text-muted-foreground">{task.dependencyText}</p> : null}
                </div>
              ) : null}
              {task.successCriteria?.length ? (
                <div className="mt-3">
                  <p className="text-xs font-medium text-muted-foreground">Success criteria</p>
                  <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs leading-relaxed text-muted-foreground">
                    {task.successCriteria.map((item) => <li key={item}>{item}</li>)}
                  </ol>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Priority" hint="ranking">
              <Input value={priority} onChange={(event) => setPriority(event.target.value)} />
            </Field>
            <Field label="Status" hint="workflow column">
              <select
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={status}
                onChange={(event) => setStatus(event.target.value as BoardStatus)}
              >
                {columns.map((item) => (
                  <option
                    key={item}
                    value={item}
                    disabled={gsdBacked && item === "in_progress" && !task.assignedAgent && !task.execution}
                  >
                    {statusLabel(item)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!assignmentLocked ? (
            <div className="grid gap-3">
              <Field label="Agent" hint={phase ? `phase ${phase}` : "assignment"}>
                <select
                  className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={agentId}
                  disabled={agents.length === 0}
                  onChange={(event) => assignFromSelect(event.target.value)}
                >
                  <option value="">{agents.length === 0 ? "No agents configured" : "Assign agent"}</option>
                  {agents.map((agent) => <option key={agent.id} value={agent.id}>{agent.id}</option>)}
                </select>
              </Field>
            </div>
          ) : task.assignedAgent ? (
            <p className="mono rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">agent: {task.assignedAgent.id}</p>
          ) : null}
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit">
            <Save className="mr-2 h-4 w-4" aria-hidden="true" />
            Save
          </Button>
        </div>
      </form>
    </div>
  ), document.body);
}

function ExecutionConsoleModal({ boardId, task, onClose, onRefresh }: {
  boardId: string;
  task: BoardTask;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [events, setEvents] = useState<ExecutionEvent[]>([]);
  const [execution, setExecution] = useState<ExecutionSummary | null>(task.execution ?? null);
  const [error, setError] = useState("");
  const [hostConsoleMessage, setHostConsoleMessage] = useState("");
  const consoleScrollRef = useRef<HTMLDivElement | null>(null);
  const pendingGate = execution?.resume?.pendingGate ?? null;
  const canOpenHostConsole = Boolean(execution && execution.status !== "running");
  const hostActionLabel = execution?.status === "waiting_for_user" ? "Take Over" : "Resume";

  useEffect(() => {
    let cancelled = false;
    async function loadConsole() {
      const [eventsResponse, executionResponse] = await Promise.all([
        fetch(`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(task.id)}/execution/events`),
        fetch(`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(task.id)}/execution`)
      ]);
      const eventsPayload = await eventsResponse.json();
      const executionPayload = await executionResponse.json();
      if (cancelled) return;
      if (!eventsResponse.ok || eventsPayload.ok === false) setError(eventsPayload.error ?? "Failed to load console events.");
      else setEvents(eventsPayload.events ?? []);
      if (executionResponse.ok && executionPayload.ok !== false) setExecution(executionPayload.execution);
    }
    void loadConsole();
    async function refreshConsoleEvents() {
      const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(task.id)}/execution/events`);
      const payload = await response.json();
      if (response.ok && payload.ok !== false) setEvents(payload.events ?? []);
    }
    const source = new EventSource(`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(task.id)}/execution/events?stream=true`);
    source.addEventListener("execution", (event) => {
      const parsed = JSON.parse((event as MessageEvent).data) as ExecutionEvent;
      setEvents((current) => [...current, parsed].slice(-500));
      if (["execution_complete", "execution_failed", "human_gate_waiting", "human_gate_answered"].includes(parsed.type)) {
        void refreshExecution();
      }
    });
    source.onerror = () => setError("Console stream disconnected; refresh will replay persisted events.");
    const interval = window.setInterval(() => {
      void refreshExecution();
      void refreshConsoleEvents();
    }, 2000);
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      cancelled = true;
      source.close();
      window.clearInterval(interval);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [boardId, task.id, onClose]);

  useEffect(() => {
    const element = consoleScrollRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
  }, [events.length, pendingGate?.id, error, hostConsoleMessage]);

  async function refreshExecution() {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(task.id)}/execution`);
    const payload = await response.json();
    if (response.ok && payload.ok !== false) setExecution(payload.execution);
  }

  async function answerGate(decision: string) {
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(task.id)}/execution/gate`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision })
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setError(payload.error ?? "Gate answer failed.");
      return;
    }
    setExecution(payload.execution);
    setError("");
    onRefresh();
  }

  async function openHostConsole() {
    if (execution?.status === "running") {
      setError("This task is actively running in the web execution runner. Host takeover is available once execution reaches user input, fails, or stops.");
      return;
    }
    setHostConsoleMessage("");
    const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/tasks/${encodeURIComponent(task.id)}/execution/host-console`, {
      method: "POST"
    });
    const payload = await response.json();
    if (!response.ok || payload.ok === false) {
      setError(payload.error ?? "Failed to open host console.");
      return;
    }
    setError("");
    setHostConsoleMessage(`Opened ${payload.runtime ?? "agent"} resume session${payload.sessionId ? ` ${payload.sessionId}` : ""}${payload.pid ? ` (pid ${payload.pid}${payload.alive === false ? ", exited" : ""})` : ""}.`);
  }

  return createPortal((
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-background/75 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`execution-console-${task.id}`}
      onPointerDownCapture={(event) => event.stopPropagation()}
      onMouseDownCapture={(event) => event.stopPropagation()}
      onTouchStartCapture={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <div className="flex h-[min(760px,90vh)] w-full max-w-5xl flex-col rounded-md border border-border bg-card shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <p className="mono text-xs text-muted-foreground">{boardId}/{task.id}</p>
            <h3 id={`execution-console-${task.id}`} className="mt-1 flex items-center gap-2 text-lg font-semibold">
              <Terminal className="h-5 w-5" aria-hidden="true" />
              Execution Console
            </h3>
          </div>
          <div className="flex items-center gap-2">
            {execution ? <Badge variant={executionVariant(execution.status)}>{executionLabel(execution.status)}</Badge> : null}
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void openHostConsole()}
              disabled={!canOpenHostConsole}
              title={canOpenHostConsole ? "Open this execution in a host terminal" : "Wait for user input, failure, or stop before host takeover."}
            >
              <Terminal className="mr-2 h-4 w-4" aria-hidden="true" />
              {hostActionLabel}
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onClose}>
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
        </div>

        {pendingGate ? (
          <div className="border-b border-border bg-muted/40 p-4">
            <p className="text-sm font-semibold">Needs input: {pendingGate.kind}</p>
            <p className="mt-1 text-sm text-muted-foreground">{pendingGate.message ?? "GSD is waiting for a decision."}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {(pendingGate.choices ?? []).map((choice) => (
                <Button key={choice} type="button" size="sm" onClick={() => void answerGate(choice)}>
                  <Send className="mr-2 h-4 w-4" aria-hidden="true" />
                  {choice}
                </Button>
              ))}
            </div>
          </div>
        ) : null}

        {hostConsoleMessage ? <p className="border-b border-border p-3 text-sm text-muted-foreground">{hostConsoleMessage}</p> : null}
        {execution?.status === "running" ? (
          <p className="border-b border-border p-3 text-sm text-muted-foreground">
            Live execution is owned by the web runner. Host takeover is available after the runner reaches user input, fails, or stops.
          </p>
        ) : null}
        {error ? <p className="border-b border-border p-3 text-sm text-destructive">{error}</p> : null}

        <div ref={consoleScrollRef} className="min-h-0 flex-1 overflow-auto bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-100">
          {events.length === 0 ? (
            <p className="text-zinc-400">No console events recorded yet.</p>
          ) : events.map((event, index) => (
            <div key={`${event.at}-${event.type}-${index}`} className="mb-3 grid grid-cols-[150px_minmax(0,1fr)] gap-3">
              <span className="text-zinc-500">{formatEventTime(event.at)}</span>
              <pre className="whitespace-pre-wrap break-words">{formatExecutionEvent(event)}</pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  ), document.body);
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

function visibleBoardColumns(columns: BoardStatus[], gsdBacked: boolean) {
  return gsdBacked ? columns.filter((status) => status !== "ready") : columns;
}

function visibleBoardStatus(status: BoardStatus, gsdBacked: boolean): BoardStatus {
  return gsdBacked && status === "ready" ? "backlog" : status;
}

function isTaskAssignmentLocked(task: BoardTask) {
  if (task.status === "done" || task.status === "in_progress") return true;
  return ["complete", "queued", "running", "waiting_for_user"].includes(task.execution?.status ?? "");
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

function formatEventTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatExecutionEvent(event: ExecutionEvent) {
  if (event.type === "host_resume_started") return `host resume started: ${(event as ExecutionEvent & { command?: string }).command ?? ""}`;
  if (event.type === "host_resume_output") return event.message ?? "";
  if (event.type === "host_resume_exited") return `host resume exited: code ${(event as ExecutionEvent & { exitCode?: number }).exitCode ?? ""}`;
  if (event.type === "execution_started") return `started phase ${event.phase ?? ""} with ${event.agentId ?? "agent"}`.trim();
  if (event.type === "execution_complete") return `completed ${event.status ?? "complete"}`;
  if (event.type === "execution_failed") return `failed ${event.status ?? ""}\n${(event as ExecutionEvent & { errorMessages?: string[] }).errorMessages?.join("\n") ?? ""}`.trim();
  if (event.type === "human_gate_waiting") return `waiting for ${event.gate?.kind ?? "input"}\n${event.gate?.message ?? ""}`.trim();
  if (event.type === "human_gate_answered") return `answered gate: ${event.decision ?? ""}`;
  if (event.type === "execution_error") return `error: ${event.message ?? ""}`;
  if (event.type === "gsd_event") return formatGsdEvent(event.event ?? {});
  return `${event.type}${event.message ? `: ${event.message}` : ""}`;
}

function formatGsdEvent(event: Record<string, unknown>) {
  const type = String(event.type ?? "event");
  if (type === "session_init") return `session started: ${event.sessionId ?? ""}\nmodel=${event.model ?? ""}`.trim();
  if (type === "assistant_text") return String(event.text ?? "");
  if (type === "tool_call") return `tool: ${event.toolName ?? "unknown"}\n${JSON.stringify(event.input ?? {}, null, 2)}`;
  if (type === "tool_progress") return `tool progress: ${event.toolName ?? "unknown"} ${event.elapsedSeconds ?? ""}s`.trim();
  if (type === "phase_step_start") return `step started: ${event.step ?? ""}`;
  if (type === "phase_step_complete") return `step complete: ${event.step ?? ""} success=${String(event.success ?? "")}`.trim();
  if (type === "phase_complete") return `phase complete: ${event.phaseNumber ?? ""} success=${String(event.success ?? "")}`.trim();
  if (type === "session_error") return `session error: ${JSON.stringify(event.errors ?? [], null, 2)}`;
  if (type === "session_complete") return `session complete turns=${event.numTurns ?? ""} cost=${event.totalCostUsd ?? ""}`.trim();
  return `${type}\n${JSON.stringify(event, null, 2)}`;
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
