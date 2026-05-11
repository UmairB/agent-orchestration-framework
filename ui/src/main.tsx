import { StrictMode, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { createRoot } from "react-dom/client";
import { Bot, CheckCircle2, Code2, FileText, Globe2, Library, Link2, ListChecks, Plus, Save, Settings2, ShieldAlert, Sparkles, Trash2 } from "lucide-react";
import "./index.css";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type RuntimeId = "claude" | "codex";
type ResourceKind = "skill" | "command" | "agent" | "rule";
type SectionKind = "mcpServers" | "hooks" | "projectDocs" | "settings";

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
  const [scope, setScope] = useState<"project" | "global">("project");
  const [payload, setPayload] = useState<ConfigPayload | null>(null);
  const [projectPayload, setProjectPayload] = useState<ConfigPayload | null>(null);
  const [activeKind, setActiveKind] = useState<ResourceKind | SectionKind | "review">("skill");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<"project" | "global">("project");
  const [draft, setDraft] = useState<EditableResource | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshConfig("project");
  }, []);

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
          <Field label={bodyLabel(draft.kind)} hint="markdown" className="md:col-span-2">
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
              <label key={runtime} className="flex items-center gap-3 rounded-md border border-border bg-background p-3">
                <input
                  type="checkbox"
                  checked={draft.runtimes.includes(runtime)}
                  onChange={(event) => setDraft(toggleRuntime(draft, runtime, event.target.checked))}
                />
                <span className="flex items-center gap-3">
                  <span>{runtimeName(runtime)}</span>
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

function blankResource(kind: ResourceKind): EditableResource {
  return {
    id: "",
    kind,
    name: "",
    description: "",
    body: "",
    files: kind === "skill" ? [] : undefined,
    runtimes: ["claude", "codex"],
    overrides: {
      claude: { enabled: false },
      codex: { enabled: false }
    }
  };
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

function isResourceKind(value: ResourceKind | SectionKind | "review"): value is ResourceKind {
  return kinds.some((kind) => kind.id === value);
}

function isSectionKind(value: ResourceKind | SectionKind | "review"): value is SectionKind {
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
