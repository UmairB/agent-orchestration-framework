import { StrictMode, useEffect, useMemo, useState } from "react";
import type * as React from "react";
import { createRoot } from "react-dom/client";
import { Bot, CheckCircle2, Code2, FileText, Library, ListChecks, Plus, Save, Settings2, ShieldAlert, Sparkles } from "lucide-react";
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
  name: string;
  description: string;
  body: string;
  runtimes: RuntimeId[];
  model?: string;
  tools?: string[];
  paths?: string[];
  overrides: Record<RuntimeId, RuntimeOverride>;
};

type ConfigPayload = {
  configPath: string;
  workspaceConfigExists: boolean;
  name: string;
  resources: EditableResource[];
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
  const [payload, setPayload] = useState<ConfigPayload | null>(null);
  const [activeKind, setActiveKind] = useState<ResourceKind | SectionKind | "review">("skill");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EditableResource | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    void refreshConfig();
  }, []);

  const activeResources = useMemo(() => {
    if (!payload || !isResourceKind(activeKind)) return [];
    return payload.resources.filter((resource) => resource.kind === activeKind);
  }, [activeKind, payload]);

  const selectedResource = useMemo(() => {
    if (!selectedId || !isResourceKind(activeKind)) return null;
    return activeResources.find((resource) => resource.id === selectedId) ?? null;
  }, [activeKind, activeResources, selectedId]);

  useEffect(() => {
    setDraft(selectedResource ? cloneResource(selectedResource) : null);
  }, [selectedResource]);

  async function refreshConfig() {
    const response = await fetch("/api/config");
    const nextPayload = await response.json();
    setPayload(nextPayload);
  }

  function createResource(kind: ResourceKind) {
    const next = blankResource(kind);
    setSelectedId(null);
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

    const response = await fetch(`/api/config/resources/${encodeURIComponent(draft.kind)}/${encodeURIComponent(draft.id)}`, {
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
    await refreshConfig();
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

          <nav className="space-y-1">
            {kinds.map((kind) => (
              <button
                key={kind.id}
                type="button"
                onClick={() => {
                  setActiveKind(kind.id);
                  setSelectedId(null);
                  setDraft(null);
                  setMessage("");
                }}
                className={`flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm transition ${activeKind === kind.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
              >
                <span className="flex items-center gap-2">{kind.icon}{kind.label}</span>
                <span className="mono text-xs">{payload.resources.filter((resource) => resource.kind === kind.id).length}</span>
              </button>
            ))}
            <div className="pt-3">
              <p className="mb-2 px-3 text-xs font-medium text-muted-foreground">Expanded DSL</p>
              {sections.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => {
                    setActiveKind(section.id);
                    setSelectedId(null);
                    setDraft(null);
                    setMessage("");
                  }}
                  className={`flex h-10 w-full items-center justify-between rounded-md px-3 text-left text-sm transition ${activeKind === section.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  <span className="flex items-center gap-2">{section.icon}{section.label}</span>
                  <span className="mono text-xs">{sectionCount(payload, section.id)}</span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => {
                setActiveKind("review");
                setSelectedId(null);
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
            <p className="mono text-xs text-muted-foreground">Config</p>
            <p className="mono mt-2 break-all text-xs">{payload.configPath}</p>
          </div>
        </aside>

        {activeKind === "review" ? (
          <ReviewPanel payload={payload} />
        ) : isSectionKind(activeKind) ? (
          <SectionEditor activeSection={activeKind} payload={payload} refreshConfig={refreshConfig} />
        ) : (
          <section className="grid min-h-screen grid-cols-[320px_minmax(0,1fr)] max-[1050px]:grid-cols-1">
            <div className="border-r border-border p-5 max-[1050px]:border-b max-[1050px]:border-r-0">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">{labelForKind(activeKind)}</h2>
                  <p className="text-sm text-muted-foreground">{activeResources.length} item{activeResources.length === 1 ? "" : "s"}</p>
                </div>
                <Button type="button" onClick={() => createResource(activeKind)} size="sm">
                  <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
                  New
                </Button>
              </div>
              <AssetList
                resources={activeResources}
                selectedId={selectedId}
                payload={payload}
                onSelect={(id) => {
                  setSelectedId(id);
                  setMessage("");
                }}
              />
            </div>

            <div className="p-5">
              {draft ? (
                <AssetEditor
                  draft={draft}
                  setDraft={setDraft}
                  payload={payload}
                  diagnostics={draftDiagnostics}
                  message={message}
                  onSubmit={saveResource}
                />
              ) : (
                <KindOverview kind={activeKind} resources={activeResources} payload={payload} />
              )}
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function AssetList({ resources, selectedId, payload, onSelect }: { resources: EditableResource[]; selectedId: string | null; payload: ConfigPayload; onSelect: (id: string) => void }) {
  if (resources.length === 0) {
    return <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">No assets.</div>;
  }

  return (
    <div className="space-y-2">
      {resources.map((resource) => (
        <button
          key={resource.id}
          type="button"
          onClick={() => onSelect(resource.id)}
          className={`w-full rounded-md border p-3 text-left transition ${selectedId === resource.id ? "border-primary bg-card" : "border-border bg-background hover:border-primary"}`}
        >
          <div className="flex items-start justify-between gap-3">
            <strong className="mono text-sm">{resource.id}</strong>
            <CapabilityPills resource={resource} payload={payload} />
          </div>
          <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">{resource.description || "No description."}</p>
        </button>
      ))}
    </div>
  );
}

function KindOverview({ kind, resources, payload }: { kind: ResourceKind; resources: EditableResource[]; payload: ConfigPayload }) {
  const coverage = runtimeCoverage(resources);
  const warnings = resources.flatMap((resource) => validateDraft(resource, payload)).filter((item) => item.severity !== "info");

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>{labelForKind(kind)}</CardTitle>
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

function AssetEditor({ draft, setDraft, payload, diagnostics, message, onSubmit }: {
  draft: EditableResource;
  setDraft: (resource: EditableResource) => void;
  payload: ConfigPayload;
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
          <p className="text-sm text-muted-foreground">{kindHint(draft.kind)}</p>
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

      <Card>
        <CardHeader>
          <CardTitle>Runtimes</CardTitle>
          <CardDescription>Targets and runtime-specific overrides</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            {runtimes.map((runtime) => (
              <label key={runtime} className="flex items-center justify-between gap-3 rounded-md border border-border bg-background p-3">
                <span className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={draft.runtimes.includes(runtime)}
                    onChange={(event) => setDraft(toggleRuntime(draft, runtime, event.target.checked))}
                  />
                  <span>{runtimeName(runtime)}</span>
                </span>
                <CapabilityBadge status={capabilityStatus(payload, draft, runtime)} />
              </label>
            ))}
          </div>

          {runtimes.map((runtime) => (
            <OverrideSection key={runtime} runtime={runtime} draft={draft} setDraft={setDraft} payload={payload} />
          ))}
        </CardContent>
      </Card>

      <ValidationPanel diagnostics={diagnostics} />
    </form>
  );
}

function OverrideSection({ runtime, draft, setDraft, payload }: { runtime: RuntimeId; draft: EditableResource; setDraft: (resource: EditableResource) => void; payload: ConfigPayload }) {
  const override = draft.overrides[runtime] ?? { enabled: false };
  const setOverride = (next: RuntimeOverride) => setDraft({ ...draft, overrides: { ...draft.overrides, [runtime]: next } });

  return (
    <div className="rounded-md border border-border">
      <label className="flex items-center justify-between gap-3 p-3">
        <span className="flex items-center gap-3">
          <input type="checkbox" checked={override.enabled} onChange={(event) => setOverride({ ...override, enabled: event.target.checked })} />
          <span>{runtimeName(runtime)} override</span>
        </span>
        <CapabilityBadge status={capabilityStatus(payload, draft, runtime)} />
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
