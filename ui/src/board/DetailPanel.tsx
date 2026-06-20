// The item detail panel (DESIGN §2 — corrected doc model, 2026-06-20).
//
// The panel is TYPE-AWARE because the ACD doc model is level-specific:
//   milestone → SPEC · VERIFICATION · RETROSPECTIVE · Findings   (these docs live at the MILESTONE)
//   story     → STORY                                            (the user story + its tasks checklist)
//   uat       → Findings                                         (its SESSION record carries findings)
// A story does NOT have its own VERIFICATION/RETROSPECTIVE — those belong to its
// milestone — so they are not offered as story tabs (showing them as "none" was a
// bug). Selection-driven; Run agent keeps the run-agent → terminal wire. Doc
// bodies come from /api/work/doc (absent → placeholder); frontmatter + HTML
// comments are stripped for display.
import { useEffect, useState } from "react";
import { workApi } from "./api";
import type { DocName, TaskFeature, TaskLane, WorkItem, WorkStatus } from "./api";
import type { PrimaryAction } from "./action.mjs";
import { StatusRing, StatusChip } from "./status";
import { ActionsStrip } from "./ActionsStrip";
import { Markdown } from "./Markdown";

type Tab = DocName | "FINDINGS" | "TASKS";

// Type-aware tab set (the ACD doc model). VERIFICATION/RETROSPECTIVE/Findings are
// MILESTONE-level; a story carries STORY.md plus its TASKS (its tasks/*.feature).
function tabsFor(item: WorkItem): Tab[] {
  if (item.type === "milestone") return ["SPEC", "VERIFICATION", "RETROSPECTIVE", "FINDINGS"];
  if (item.type === "story") return ["STORY", "TASKS"];
  if (item.type === "uat") return ["FINDINGS"];
  return ["SPEC"];
}

type DocState =
  | { kind: "loading" }
  | { kind: "present"; body: string }
  | { kind: "absent" }
  | { kind: "error"; message: string };

// type chip colour ramp (DESIGN): milestone=teal · story=crimson · uat=red · task=grey.
function typeChipClasses(type: WorkItem["type"]): string {
  if (type === "milestone") return "bg-primary/12 text-primary";
  if (type === "story") return "bg-accent/12 text-accent";
  if (type === "uat") return "bg-destructive/12 text-destructive";
  return "bg-muted text-muted-foreground";
}

export function DetailPanel({
  item,
  action,
  actor,
  onRunAgent,
  onViewTerminal,
  onRevealRef,
}: {
  item: WorkItem | null;
  // The state-aware primary action for the selected item (Board-computed). Null
  // only when there is no selection (the panel shows the empty prompt instead).
  action: PrimaryAction | null;
  actor: string;
  onRunAgent: (ref: string, command?: string) => void;
  onViewTerminal: () => void;
  onRevealRef: (ref: string) => void;
}) {
  const [tab, setTab] = useState<Tab>("SPEC");
  const [doc, setDoc] = useState<DocState>({ kind: "absent" });
  // Which MILESTONE record docs are present (for the Records summary on a
  // milestone's SPEC tab). Probed only for milestones — stories have none.
  const [records, setRecords] = useState<Record<string, boolean>>({});

  // Reset the active tab to the type's first tab whenever the selected item changes.
  useEffect(() => {
    if (item) setTab(tabsFor(item)[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.ref]);

  // Load the active doc whenever the item or tab changes (Findings/Tasks are not
  // files — Tasks has its own /api/work/tasks fetch below).
  useEffect(() => {
    if (!item || tab === "FINDINGS" || tab === "TASKS") return;
    let cancelled = false;
    setDoc({ kind: "loading" });
    workApi
      .doc(item.ref, tab)
      .then((response) => {
        if (cancelled) return;
        setDoc(response.present ? { kind: "present", body: response.body } : { kind: "absent" });
      })
      .catch((error) => {
        if (cancelled) return;
        setDoc({ kind: "error", message: error instanceof Error ? error.message : "Load failed" });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.ref, tab]);

  // Probe which milestone record docs exist (best-effort) — milestones only.
  useEffect(() => {
    if (!item || item.type !== "milestone") {
      setRecords({});
      return;
    }
    let cancelled = false;
    const docs: DocName[] = ["SPEC", "VERIFICATION", "RETROSPECTIVE"];
    Promise.all(
      docs.map((d) =>
        workApi
          .doc(item.ref, d)
          .then((r) => [d, r.present] as const)
          .catch(() => [d, false] as const)
      )
    ).then((entries) => {
      if (!cancelled) setRecords(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.ref, item?.type]);

  if (!item) {
    return (
      <div className="grid h-full place-items-center p-6 text-center text-sm text-muted-foreground">
        Select an item to see its details
      </div>
    );
  }

  const tabs = tabsFor(item);

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* header */}
      <div className="shrink-0 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <StatusRing status={item.status} size={18} />
          <span className="mono text-sm text-muted-foreground">{item.ref}</span>
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${typeChipClasses(item.type)}`}>
            {item.type}
          </span>
          <span className="ml-auto">
            <StatusChip status={item.status} />
          </span>
        </div>
        <h2 className="mt-2 text-[16px] font-bold leading-snug">{item.title ?? humanizeSlug(item.slug)}</h2>
        <div className="mt-2 flex items-center justify-between gap-2">
          {/* The slug meta line is redundant when there is no title (the H2 already
              shows the humanized slug), so suppress it with an em-dash to avoid
              printing the slug twice. */}
          <span className="mono truncate text-xs text-muted-foreground">{item.title ? item.slug : "—"}</span>
          <PrimaryActionButton
            item={item}
            action={action ?? { kind: "adhoc", label: "Run agent" }}
            onRunAgent={onRunAgent}
            onViewTerminal={onViewTerminal}
          />
        </div>
      </div>

      {/* doc tabs (type-aware) */}
      <div className="flex shrink-0 gap-4 border-b border-border px-4">
        {tabs.map((entry) => {
          const active = tab === entry;
          return (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              className={`-mb-px border-b-2 py-2 text-xs font-semibold transition ${
                active ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {entry === "FINDINGS" ? "Findings (0)" : entry}
            </button>
          );
        })}
      </div>

      {/* body */}
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <DocBody tab={tab} doc={doc} item={item} records={records} />
      </div>

      {/* footer actions */}
      <div className="shrink-0 border-t border-border p-4">
        <ActionsStrip item={item} actor={actor} onRevealRef={onRevealRef} />
      </div>
    </div>
  );
}

// The state-aware primary button (DESIGN — "Run agent" is state-aware). Its label
// + the command it runs derive from the item's derived status (the Board resolves
// the PrimaryAction). A non-disabled action carries the ▸ glyph and is the teal
// primary; "View terminal" re-reveals a live session; "Blocked" is disabled.
function PrimaryActionButton({
  item,
  action,
  onRunAgent,
  onViewTerminal,
}: {
  item: WorkItem;
  action: PrimaryAction;
  onRunAgent: (ref: string, command?: string) => void;
  onViewTerminal: () => void;
}) {
  const showCaret = action.kind !== "blocked" && action.kind !== "view";
  const handleClick = () => {
    if (action.kind === "view") return onViewTerminal();
    if (action.kind === "blocked") return; // no-op while blocked
    onRunAgent(item.ref, action.command);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={action.disabled}
      title={action.kind === "blocked" ? "Blocked — waiting on its dependencies" : undefined}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {showCaret ? <span aria-hidden="true">▸</span> : null}
      {action.label}
    </button>
  );
}

function DocBody({
  tab,
  doc,
  item,
  records,
}: {
  tab: Tab;
  doc: DocState;
  item: WorkItem;
  records: Record<string, boolean>;
}) {
  if (tab === "FINDINGS") {
    // Findings is not a file; with zero parsed findings show the positive line.
    // (Parsing the milestone VERIFICATION.md `## Findings` is the known gap, F-2/DG-1.)
    return (
      <p className="flex items-start gap-2 text-sm text-primary">
        <span aria-hidden="true">✓</span>
        <span>No findings.</span>
      </p>
    );
  }

  if (tab === "TASKS") {
    // A story's tasks are its tasks/*.feature files (fetched from /api/work/tasks).
    return <TasksTab item={item} />;
  }

  return (
    <div className="space-y-5">
      {/* A milestone's SPEC tab leads with a Records summary (which milestone docs exist). */}
      {item.type === "milestone" && tab === "SPEC" ? <MilestoneRecords records={records} /> : null}
      <DocMarkdown tab={tab} doc={doc} item={item} />
    </div>
  );
}

type RecordState = "present" | "none";

function MilestoneRecords({ records }: { records: Record<string, boolean> }) {
  const rows: Array<{ label: string; key: string }> = [
    { label: "Spec / objective", key: "SPEC" },
    { label: "Verification", key: "VERIFICATION" },
    { label: "Retrospective", key: "RETROSPECTIVE" },
  ];
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Records</h3>
      <ul className="space-y-1">
        {rows.map((r) => {
          const state: RecordState = records[r.key] ? "present" : "none";
          return (
            <li key={r.key} className="flex items-center gap-2 text-sm">
              <span
                className={`inline-block h-2 w-2 shrink-0 rounded-full ${
                  state === "present" ? "bg-primary" : "border border-muted-foreground/40"
                }`}
                aria-hidden="true"
              />
              <span>{r.label}</span>
              <span className="ml-auto text-xs text-muted-foreground">{state}</span>
            </li>
          );
        })}
        <li className="flex items-center gap-2 text-sm">
          <span className="inline-block h-2 w-2 shrink-0 rounded-full border border-muted-foreground/40" aria-hidden="true" />
          <span>Findings</span>
          <span className="ml-auto text-xs text-muted-foreground">none</span>
        </li>
      </ul>
    </section>
  );
}

function DocMarkdown({ tab, doc, item }: { tab: Tab; doc: DocState; item: WorkItem }) {
  const docLabel = tab === "SPEC" && item.type !== "milestone" ? "document" : tab;
  if (doc.kind === "loading") return <p className="mono text-sm text-muted-foreground">Loading {docLabel}...</p>;
  if (doc.kind === "error") return <p className="text-sm text-accent">Could not load {docLabel}: {doc.message}</p>;
  if (doc.kind === "absent") {
    // For a story this is its STORY.md; for a milestone, the chosen record doc.
    const what =
      tab === "STORY"
        ? "No story document yet"
        : tab === "VERIFICATION"
          ? "Not verified yet — run aof:verify (Run agent)"
          : tab === "RETROSPECTIVE"
            ? "No retrospective yet — written when the milestone is accepted"
            : `No ${docLabel} yet`;
    return <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">{what}</div>;
  }
  // Render the cleaned (frontmatter/comment-stripped) body as HTML, not raw text.
  return <Markdown source={cleanDoc(doc.body)} />;
}

// The story's TASKS tab — its tasks/*.feature files, parsed server-side.
type TasksState =
  | { kind: "loading" }
  | { kind: "ready"; tasks: TaskFeature[] }
  | { kind: "error"; message: string };

// The lane chip ramp (DESIGN): @executable = teal (primary), @manual = crimson
// (accent), @uat = red (destructive); via the existing token classes.
function laneChipClasses(lane: TaskLane | null): string {
  if (lane === "executable") return "bg-primary/12 text-primary";
  if (lane === "manual") return "bg-accent/12 text-accent";
  if (lane === "uat") return "bg-destructive/12 text-destructive";
  return "bg-muted text-muted-foreground";
}

function TasksTab({ item }: { item: WorkItem }) {
  const [state, setState] = useState<TasksState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ kind: "loading" });
    workApi
      .tasks(item.ref)
      .then((response) => {
        if (!cancelled) setState({ kind: "ready", tasks: response.tasks });
      })
      .catch((error) => {
        if (!cancelled) setState({ kind: "error", message: error instanceof Error ? error.message : "Load failed" });
      });
    return () => {
      cancelled = true;
    };
  }, [item.ref]);

  if (state.kind === "loading") return <p className="mono text-sm text-muted-foreground">Loading tasks...</p>;
  if (state.kind === "error") return <p className="text-sm text-accent">Could not load tasks: {state.message}</p>;
  if (state.tasks.length === 0) {
    return <p className="text-sm text-muted-foreground">No task features yet</p>;
  }

  return (
    <div className="space-y-4">
      {state.tasks.map((task) => (
        <section key={task.file} className="rounded-md border border-border p-3">
          <div className="flex items-baseline justify-between gap-2">
            <span className="mono truncate text-xs text-muted-foreground">{task.file}</span>
            <TaskCounts counts={task.counts} />
          </div>
          {task.feature ? <h3 className="mt-1 text-sm font-semibold leading-snug">{task.feature}</h3> : null}
          <ul className="mt-2 space-y-1.5">
            {task.scenarios.map((scenario, index) => (
              <li key={`${task.file}:${index}`} className="flex items-start gap-2 text-sm">
                <span
                  className={`mt-0.5 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${laneChipClasses(
                    scenario.lane
                  )}`}
                >
                  {scenario.lane ?? "—"}
                </span>
                <span className="leading-snug">
                  {scenario.name}
                  {scenario.outline ? <span className="ml-1.5 text-xs text-muted-foreground">(outline)</span> : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TaskCounts({ counts }: { counts: TaskFeature["counts"] }) {
  const entries: Array<[TaskLane, number]> = [
    ["executable", counts.executable],
    ["manual", counts.manual],
    ["uat", counts.uat],
  ];
  return (
    <span className="flex shrink-0 items-center gap-1">
      {entries
        .filter(([, n]) => n > 0)
        .map(([lane, n]) => (
          <span
            key={lane}
            className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${laneChipClasses(lane)}`}
            title={`${n} @${lane}`}
          >
            {lane.charAt(0)}·{n}
          </span>
        ))}
    </span>
  );
}

// A title-cased reading of a slug, for the H2 fallback when an item has no
// explicit title — "work-board-ui" → "Work Board Ui". Keeps the H2 readable
// without re-printing the raw slug twice (the meta line is then suppressed).
function humanizeSlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// Strip the YAML frontmatter block and HTML comments so the rendered doc reads as
// content (the panel header already shows ref/type/status/title) — fixes the
// "frontmatter shown as the objective" bug.
function cleanDoc(markdown: string): string {
  let out = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  out = out.replace(/<!--[\s\S]*?-->/g, "");
  return out.replace(/^\s+/, "").replace(/\n{3,}/g, "\n\n");
}

export type { WorkStatus };
