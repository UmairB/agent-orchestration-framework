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
import { useCallback, useEffect, useRef, useState } from "react";
import { workApi } from "./api";
import type { DocName, DocResponse, RunRecord, TaskFeature, TaskLane, WorkItem, WorkStatus } from "./api";
import type { PrimaryAction } from "./action.mjs";
import {
  historyOrder,
  isInFlight,
  refreshedLabel,
  relativeTime,
  rerunVerb,
  runStateChip,
  selectCurrentRun,
} from "./runs.mjs";
import { StatusRing, StatusChip } from "./status";
import { StaleBadge, ProvenanceLabel } from "./StaleBadge";
import type { Freshness, FreshnessRecord } from "./freshness.mjs";
import { ProvenanceLine } from "./ProvenanceLine";
import { ActionsStrip } from "./ActionsStrip";
import { Markdown } from "./Markdown";

type Tab = DocName | "FINDINGS" | "TASKS" | "RUNS";

// Type-aware tab set (the ACD doc model). VERIFICATION/RETROSPECTIVE/Findings are
// MILESTONE-level; a story carries STORY.md plus its TASKS (its tasks/*.feature).
// RUNS is offered at the level that OWNS a runs/ log — both milestones and stories
// (m19 ADR-002) — and never on a uat gate (DESIGN surface 1).
function tabsFor(item: WorkItem): Tab[] {
  if (item.type === "milestone") return ["SPEC", "VERIFICATION", "RETROSPECTIVE", "RUNS", "FINDINGS"];
  if (item.type === "story") return ["STORY", "TASKS", "RUNS"];
  if (item.type === "uat") return ["FINDINGS"];
  return ["SPEC"];
}

// `record` is the doc response VERBATIM, kept so the ARTIFACT's own provenance
// (`reportedBy`/`syncedAt` — the same two wire names the row carries) reaches the
// freshness ramp without being flattened into a second shape here.
type DocState =
  | { kind: "loading" }
  | { kind: "present"; body: string; record: DocResponse }
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
  freshnessOf,
  now,
  pollMs,
  onResyncWatch,
  onRunAgent,
  onContinue,
  onMirror,
  onViewTerminal,
  onRevealRef,
}: {
  item: WorkItem | null;
  // The state-aware primary action for the selected item (Board-computed). Null
  // only when there is no selection (the panel shows the empty prompt instead).
  action: PrimaryAction | null;
  actor: string;
  // The board's ONE freshness reading, computed against its 1s cosmetic tick and
  // the wire's configured window. It is a FUNCTION rather than a value because
  // this panel judges TWO subjects independently — the row, and each doc body it
  // renders: "a doc can be older than the row that names it" (ADR-006). One
  // predicate, two subjects, one `now`. NULL means the cache does not publish
  // that subject — a workspace that is not mesh-enabled shows no provenance
  // region at all, which is what preserves the board's plain local default (the
  // same discipline the execution overlay already keeps).
  freshnessOf: (record: FreshnessRecord | null | undefined) => Freshness | null;
  // The BOARD's cosmetic clock, threaded from the composition root rather than
  // ticked again here (43/ADR-010 R4.4 as corrected by ADR-015/F6: *lifting* a
  // derivation a level means the lower one GOES). The runs section renders
  // relative timestamps off it; it re-renders and fetches nothing.
  now: number;
  // The BOARD's own list-poll cadence, threaded here rather than re-declared:
  // the Resync acknowledgement's hold IS exactly one poll interval, and its
  // watch window is three of them. One number, measured where it is consumed.
  pollMs: number;
  // Armed while a Resync is waiting for a pushed copy, so the Board can run its
  // bounded poll for the duration of the watch window (43/ADR-010 R4.3). Without
  // it "no answer" would be structurally guaranteed rather than measured: a
  // settled board schedules no list poll of its own, and a settled row is
  // exactly the case Resync exists for.
  onResyncWatch: (watching: boolean) => void;
  onRunAgent: (ref: string, command?: string) => void;
  // CONTINUE is routed separately (2026-07-26): the server decides whether it runs
  // here or on the worker node that last worked on the item.
  onContinue: (ref: string, phase?: "continue" | "refine" | "verify") => void;
  onMirror: (ref: string, nodeId: string, sessionId: string) => void;
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
    if (!item || tab === "FINDINGS" || tab === "TASKS" || tab === "RUNS") return;
    let cancelled = false;
    setDoc({ kind: "loading" });
    workApi
      .doc(item.ref, tab)
      .then((response) => {
        if (cancelled) return;
        setDoc(response.present ? { kind: "present", body: response.body, record: response } : { kind: "absent" });
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
  const freshness = freshnessOf(item);
  // The DOC's own freshness, judged separately from the row's. `present`-gated:
  // an absent or still-loading doc asserts nothing about its own age.
  const docFreshness = doc.kind === "present" ? freshnessOf(doc.record) : null;
  // WHICH machine's artifact is missing — null when it is this one's. The whole
  // cache-miss copy hangs off this (see `remoteReporter` below).
  const elsewhere = remoteReporter(item, freshness);

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
          {/* The `ml-auto` anchor moved from the chip's own span onto a CLUSTER
              holding the badge then the chip, so the status chip keeps its exact
              right-edge anchor and nothing moves when the row crosses the
              threshold (DESIGN documented-default 3 — the m03 header baselines
              survive). Status outranks freshness: the chip stays `text-xs`, the
              badge is `text-[11px]`. */}
          <span className="ml-auto flex items-center gap-1.5">
            <StaleBadge freshness={freshness} form="full" />
            <StatusChip status={item.status} />
          </span>
        </div>
        <h2 className="mt-2 text-[16px] font-bold leading-snug">{item.title ?? humanizeSlug(item.slug)}</h2>
        {/* THE PROVENANCE BOX (milestone 43 — widened). It used to render only
            while `item.execution` existed, which made attribution an EXECUTION
            detail; under this milestone the cache is the read surface, so "which
            node authored this copy, and when" is a first-class fact of the item
            and the box renders for every cache-published row — most of all for a
            SETTLED one, which is the row most likely to be old. Two lines in the
            SAME box; no new panel, dock or column is introduced. The whole region
            is absent for a workspace that is not mesh-enabled. */}
        {item.execution || freshness ? (
          <div className="mono mt-2 rounded-md border border-border bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground">
            {/* LINE 1 — the MESH-EXECUTION facts (VERIFICATION 2026-07-25),
                unchanged. This board reads the LOCAL checkout's frontmatter,
                which says `not-started` for work a WORKER ran on another machine
                on its own branch — so without this the panel silently contradicts
                reality. Rendered ONLY when the mesh has actually dispatched this
                item; a local-only item shows nothing new. A LIVE run is stated as
                running on its node; a FINISHED one names the branch the work
                actually landed on, which is the fact the local view cannot know. */}
            {item.execution ? (
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* m42 interactive worker terminals — a session the worker reports
                  WAITING ON A HUMAN (code: needs-input) says so, amber, ahead of
                  the generic "running": the primary button is the answer's door. */}
              {item.execution.active && item.execution.code === "needs-input" ? (
                <span className="font-semibold text-amber-500">
                  waiting for your input on {item.execution.nodeId}
                </span>
              ) : (
                <span className={item.execution.active ? "font-semibold text-primary" : "font-semibold"}>
                  {item.execution.active ? `running on ${item.execution.nodeId}` : `last run ${item.execution.state} on ${item.execution.nodeId}`}
                </span>
              )}
              {item.execution.branch ? (
                <span className="truncate" title={`The mesh work for this item lives on branch ${item.execution.branch}`}>
                  · branch {item.execution.branch}
                </span>
              ) : null}
              {/* m42 quick-fix — the RESUME door. A SETTLED row that captured a
                  session has no primary terminal affordance (the button is
                  Continue), but its tuple is still addressable: an operator who
                  ran `aof mesh terminal-resume` needs a way back INTO the revived
                  session. The dock opens on the row's own (nodeId, sessionId) —
                  live paints, dead reads connecting… until resumed. */}
              {!item.execution.active && item.execution.sessionId ? (
                <button
                  type="button"
                  onClick={() => onMirror(item.ref, item.execution!.nodeId, item.execution!.sessionId!)}
                  className="underline underline-offset-2 hover:text-foreground"
                  title={`Open the terminal for session ${shortSession(item.execution.sessionId)} on ${item.execution.nodeId} — a resumed session (aof mesh terminal-resume) paints here`}
                >
                  · open terminal →
                </button>
              ) : null}
              {/* "It's running — where do I watch it?" (operator, 2026-07-26). The board's
                  own terminal dock is a LOCAL pty, so a live worker session is only
                  visible in the fleet's read-only mirror. Until the board embeds that
                  mirror, say where it is rather than stating "running" with no way to
                  look. */}
              {item.execution.active && !item.execution.sessionId ? (
                <a
                  // m45/ADR-002 — the fleet's PATH, still carrying `scope=global` as a real
                  // query parameter on it (the payload moves with the address, it is not
                  // dropped). The fleet's port is fixed at 4181; the board's is not.
                  href="http://127.0.0.1:4181/fleet?scope=global"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                  title={`Watch ${item.execution.nodeId}'s live session in the fleet`}
                >
                  · watch on the fleet →
                </a>
              ) : null}
              </div>
            ) : null}
            {/* LINE 2 — provenance/freshness + the item's ONE Resync door. The
                badge above and this line never disagree: both read the SAME ramp
                descriptor, so when the badge appears the line gains its `stale ·`
                prefix in the same tick. It is also why the badge is never the
                only signal of its own state — a reader who misses a small pill
                still meets the fact in prose. */}
            {freshness ? (
              <ProvenanceLine
                key={item.ref}
                item={item}
                freshness={freshness}
                pollMs={pollMs}
                onResyncWatch={onResyncWatch}
              />
            ) : null}
          </div>
        ) : null}
        <div className="mt-2 flex items-center justify-between gap-2">
          {/* The slug meta line is redundant when there is no title (the H2 already
              shows the humanized slug), so suppress it with an em-dash to avoid
              printing the slug twice. */}
          <span className="mono truncate text-xs text-muted-foreground">{item.title ? item.slug : "—"}</span>
          <PrimaryActionButton
            item={item}
            action={action ?? { kind: "adhoc", label: "Run agent" }}
            onRunAgent={onRunAgent}
            onContinue={onContinue}
            onMirror={onMirror}
            onViewTerminal={onViewTerminal}
          />
        </div>
      </div>

      {/* doc tabs (type-aware). The milestone set gained a 5th tab (RUNS), so the
          row is tightened (gap-3) and scrolls horizontally rather than clipping the
          trailing Findings tab at the ~382px panel width. */}
      <div className="flex shrink-0 gap-2.5 overflow-x-auto border-b border-border px-3">
        {tabs.map((entry) => {
          const active = tab === entry;
          return (
            <button
              key={entry}
              type="button"
              onClick={() => setTab(entry)}
              className={`-mb-px shrink-0 whitespace-nowrap border-b-2 py-2 text-[11px] font-semibold transition ${
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
        <DocBody
          tab={tab}
          doc={doc}
          item={item}
          docFreshness={docFreshness}
          elsewhere={elsewhere}
          now={now}
          records={records}
          onRunAgent={onRunAgent}
        />
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
  onContinue,
  onMirror,
  onViewTerminal,
}: {
  item: WorkItem;
  action: PrimaryAction;
  onRunAgent: (ref: string, command?: string) => void;
  onContinue: (ref: string, phase?: "continue" | "refine" | "verify") => void;
  onMirror: (ref: string, nodeId: string, sessionId: string) => void;
  onViewTerminal: () => void;
}) {
  const showCaret = action.kind !== "blocked" && action.kind !== "view" && action.kind !== "running";
  const handleClick = () => {
    if (action.kind === "view") return onViewTerminal();
    if (action.kind === "blocked") return; // no-op while blocked
    if (action.kind === "running") return; // a worker holds it, session not yet captured
    if (action.kind === "mirror") return onMirror(item.ref, action.nodeId!, action.sessionId!);
    // CONTINUE goes through the one continue door, which decides WHERE it runs
    // (2026-07-26) — every other action still launches a local session directly.
    // m42 wave (b) — refine and verify route through the SAME door as continue:
    // the server decides WHERE (running/local/remote); the button never spawns a
    // local session on its own authority.
    if (action.kind === "continue" || action.kind === "refine" || action.kind === "verify") {
      return onContinue(item.ref, action.kind);
    }
    onRunAgent(item.ref, action.command);
  };
  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={action.disabled}
      title={
        action.kind === "blocked"
          ? "Blocked — waiting on its dependencies"
          : action.kind === "running"
            ? "A worker node is executing this item — it cannot be continued until that run settles"
            : undefined
      }
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
  docFreshness,
  elsewhere,
  now,
  records,
  onRunAgent,
}: {
  tab: Tab;
  doc: DocState;
  item: WorkItem;
  // The DOC's own freshness — judged from `work_item_docs`' own instant, never
  // inherited from the row's. Null when this body came off local disk (there is
  // no cached copy to attribute) or when it is absent/still loading.
  docFreshness: Freshness | null;
  // The node that reported this ROW when that node is ANOTHER machine, else null
  // — the cache-miss copy's whole precondition (see `remoteReporter`).
  elsewhere: string | null;
  now: number;
  records: Record<string, boolean>;
  onRunAgent: (ref: string, command?: string) => void;
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

  if (tab === "RUNS") {
    // The item's run log, read through /api/work/run-status (the current-run strip
    // + the newest-first history + the ↻ Rerun affordance + the poll refresh).
    return <RunsTab item={item} elsewhere={elsewhere} now={now} onRunAgent={onRunAgent} />;
  }

  return (
    <div className="space-y-5">
      {/* PER-ARTIFACT PROVENANCE, and it is the doc region's FIRST child (DESIGN
          §Surface 1c) — ABOVE the rendered markdown, before the reader reads the
          body rather than after it. A doc can be older than the row that names it
          (`work_item_docs` carries its OWN `node_id` + `updated_at`), so this line
          is judged independently of the header's. No second badge and no second
          Resync: the header's ONE door serves the item and its artifacts alike. */}
      {docFreshness ? (
        <div className="flex flex-wrap items-center gap-x-2">
          <ProvenanceLabel freshness={docFreshness} />
        </div>
      ) : null}
      {/* A milestone's SPEC tab leads with a Records summary (which milestone docs exist). */}
      {item.type === "milestone" && tab === "SPEC" ? <MilestoneRecords records={records} /> : null}
      <DocMarkdown tab={tab} doc={doc} item={item} elsewhere={elsewhere} />
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

function DocMarkdown({
  tab,
  doc,
  item,
  elsewhere,
}: {
  tab: Tab;
  doc: DocState;
  item: WorkItem;
  elsewhere: string | null;
}) {
  const docLabel = tab === "SPEC" && item.type !== "milestone" ? "document" : tab;
  if (doc.kind === "loading") return <p className="mono text-sm text-muted-foreground">Loading {docLabel}...</p>;
  // milestone 43 — THE CACHE-MISS STATE, and all that survives of the retired
  // "documents aren't bridged" notice. Its old copy became FALSE the moment the
  // cache became the read surface: the body IS here, and the provenance line
  // says whose it is. What is left is the genuine miss, reworded to the m03
  // absent-not-error convention — the SAME dashed treatment as every other
  // absent doc, never the error token, because absent is not an error. A
  // resolution failure on a row ANOTHER MACHINE reported is a miss, not a fault:
  // this checkout was never going to have that file. On a row THIS node
  // authored, the same failure is a genuine fault and keeps the m03 error line.
  if (doc.kind === "error" && elsewhere != null) {
    return <CachedDocAbsent what={docLabel} node={elsewhere} />;
  }
  if (doc.kind === "error") return <p className="text-sm text-accent">Could not load {docLabel}: {doc.message}</p>;
  if (doc.kind === "absent") {
    // A row ANOTHER machine reported names that node as the one which has not
    // reported the doc; a row THIS node authored keeps its own m03 copy,
    // unchanged — including its call to action.
    if (elsewhere != null) return <CachedDocAbsent what={docLabel} node={elsewhere} />;
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
  // The artifact's own provenance line is the region's FIRST child and is emitted
  // by `DocBody` above, so this returns the body and nothing else.
  return <Markdown source={cleanDoc(doc.body)} />;
}

// The node that reported this row, for the copy the cache-miss placeholder needs.
// `reportedBy` is the row's own recorded author and outranks the execution
// overlay's node, which answers a different question (who was it ASSIGNED to).
function reportingNode(item: WorkItem): string | null {
  return item.reportedBy ?? item.execution?.nodeId ?? null;
}

// THE CACHE-MISS DISCRIMINATOR (43/ADR-015 F5) — the reporting node, but ONLY
// when it is ANOTHER machine. Null means "this item is mine", and every empty
// state below then keeps its m03 copy.
//
// WHY IT IS NOT A PRESENCE TEST, WHICH IS WHAT IT WAS. Before this story
// `reportedBy` reached a row only when a WORKER streamed it, so `reportedBy !=
// null` was a serviceable proxy for "this artifact lives elsewhere". This story
// widened the key to EVERY cache-published row — including the control's own —
// which turned the proxy permanently true on every mesh-enabled workspace, i.e.
// on every operator's own machine. The panel then told them that `aof-control`
// had failed to report a VERIFICATION for an item that simply has none yet, and
// deleted the `run aof:verify (Run agent)` call to action that answers it. That
// is the same defect `RemoteContentNotice` was retired FOR ("its copy became
// FALSE the moment the cache became the read surface"), made again in the
// replacement.
//
// `freshness.local` is the SAME fact the provenance line's ` (this node)` clause
// is rendered from, deliberately: AC 11's clause and this branch are one
// question asked twice, and answering them from two expressions is how they
// drift apart. A null `freshness` is a row the cache does not publish at all —
// the plain local board — where the pre-mesh rule still applies: an item another
// node EXECUTED still reports where its records are.
function remoteReporter(item: WorkItem, freshness: Freshness | null): string | null {
  if (freshness?.local === true) return null;
  return reportingNode(item);
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

// =========================================================================
// The RUNS tab (milestone 21 — DESIGN surfaces 1/2/3). Reads the item's run log
// through /api/work/run-status, pins the current run, lists prior runs
// newest-first, and offers the quiet ↻ Rerun affordance + the ⟳ poll refresh.
// All run logic is the pure runs.mjs module; this is render + fetch only.
// =========================================================================

type RunsState =
  | { kind: "loading" }
  | { kind: "ready"; runs: RunRecord[]; fetchedAt: number }
  | { kind: "error"; message: string };

// The silent poll cadence (DESIGN documented-default 3): re-fetch run state in
// place. This fetch lives in the detail panel and never touches the terminal dock
// (rendered OUTSIDE this subtree in Board.tsx), so a poll is non-tearing — a live
// session keeps streaming, unreconnected (the load({silent}) discipline).
const RUNS_POLL_MS = 5000;

function RunsTab({
  item,
  elsewhere,
  now,
  onRunAgent,
}: {
  item: WorkItem;
  elsewhere: string | null;
  // The BOARD's 1s cosmetic tick, threaded from the composition root, which keeps
  // the relative timestamps + the "refreshed Ns ago" label live without
  // re-fetching. This section used to run a SECOND interval of its own at the
  // same cadence; it is gone, and the reason lives once, at the root that owns
  // the tick (Board.tsx, `CLOCK_TICK_MS`; 43/ADR-015 F6).
  now: number;
  onRunAgent: (ref: string, command?: string) => void;
}) {
  const [state, setState] = useState<RunsState>({ kind: "loading" });
  // Ignore a stale response: only the latest request applies, so an item change
  // or an overlapping poll never clobbers the view with an out-of-date payload.
  const reqRef = useRef(0);

  const load = useCallback(
    async (silent: boolean) => {
      const myReq = (reqRef.current += 1);
      if (!silent) setState({ kind: "loading" });
      try {
        const response = await workApi.runStatus(item.ref);
        if (reqRef.current !== myReq) return;
        setState({ kind: "ready", runs: response.runs, fetchedAt: Date.now() });
      } catch (error) {
        if (reqRef.current !== myReq) return;
        // A silent poll failure must not clobber a good view — only the initial
        // (non-silent) load surfaces the error line.
        if (!silent) setState({ kind: "error", message: error instanceof Error ? error.message : "Load failed" });
      }
    },
    [item.ref]
  );

  useEffect(() => {
    void load(false);
    const poll = setInterval(() => void load(true), RUNS_POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  if (state.kind === "loading") return <p className="mono text-sm text-muted-foreground">Loading runs…</p>;
  if (state.kind === "error") return <p className="text-sm text-accent">Could not load runs: {state.message}</p>;

  const runs = state.runs;
  // The REMOTE reporter is passed so an empty LOCAL run list on an item ANOTHER
  // machine reported says where the records actually are, instead of the false
  // "this item hasn't been run" — and so an item THIS machine authored keeps that
  // m03 copy, which for it is simply true.
  if (runs.length === 0) return <RunsEmpty elsewhere={elsewhere} />;

  const nowIso = new Date(now).toISOString();
  const current = selectCurrentRun(runs);
  // History is the PRIOR runs newest-first (the current run is pinned in the strip
  // above, so it is not repeated in the list) — the mock's "N prior runs".
  const history = historyOrder(runs).filter((run) => !current || run.runId !== current.runId);
  const inFlight = isInFlight(runs);

  const onRerun = () => {
    // The rerun reaches the run-lifecycle verb (work:run-start) by REUSING the
    // existing runAgent → TerminalDock launch (ARCHITECTURE 21/ADR-002): the verb
    // is delivered to the spawned agent session as ordinary typed PTY input — the
    // board writes nothing and shells out nothing. m21 ships the FRESH path.
    const verb = rerunVerb(item.ref);
    onRunAgent(item.ref, `aof ${verb.command.replace(":", " ")} ${verb.ref}`);
  };

  return (
    <div className="space-y-4">
      <CurrentRunStrip
        current={current}
        fetchedAt={state.fetchedAt}
        nowIso={nowIso}
        rerunDisabled={inFlight}
        onRerun={onRerun}
        onRefresh={() => void load(true)}
      />
      <RunHistory runs={history} nowIso={nowIso} />
    </div>
  );
}

// The run-state chip (DESIGN surface 2 / documented-default 1): a dot + label,
// colour AND label together, a pulse for `running`, a ✓ for `done`. Token →
// theme classes (never a hex); the pulse reuses the dock's `animate-pulse` idiom.
// Deliberately a DIFFERENT primitive from the item-status glyph-ring.
function runChipClasses(token: string): { chip: string; dot: string } {
  switch (token) {
    case "primary":
      return { chip: "border-primary/30 bg-primary/10 text-primary", dot: "bg-primary" };
    case "destructive":
      return { chip: "border-destructive/30 bg-destructive/10 text-destructive", dot: "bg-destructive" };
    case "secondary":
      return { chip: "border-border bg-secondary text-muted-foreground", dot: "bg-muted-foreground" };
    case "muted":
    default:
      return { chip: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" };
  }
}

function RunStateChip({ state }: { state: string }) {
  const chip = runStateChip(state);
  const tone = runChipClasses(chip.token);
  const pulsing = chip.mark === "a pulsing dot";
  const check = chip.mark === "a ✓";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-semibold ${tone.chip}`}
      title={`run ${chip.label}`}
    >
      {check ? (
        <span
          className={`grid h-3 w-3 place-items-center rounded-full text-[8px] font-bold text-primary-foreground ${tone.dot}`}
          aria-hidden="true"
        >
          ✓
        </span>
      ) : (
        <span
          className={`inline-block h-2 w-2 rounded-full ${tone.dot} ${pulsing ? "animate-pulse" : ""}`}
          aria-hidden="true"
        />
      )}
      {chip.label}
    </span>
  );
}

// The pinned Current-run strip (DESIGN surface 2): the latest/in-flight run's
// state chip + attempt + session, then the ↻ Rerun affordance + the poll refresh.
function CurrentRunStrip({
  current,
  fetchedAt,
  nowIso,
  rerunDisabled,
  onRerun,
  onRefresh,
}: {
  current: RunRecord | null;
  fetchedAt: number;
  nowIso: string;
  rerunDisabled: boolean;
  onRerun: () => void;
  onRefresh: () => void;
}) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Current run</h3>
      <div className="space-y-3 rounded-md border border-primary/40 bg-primary/5 p-3">
        {current ? (
          <div className="flex items-center gap-2">
            <RunStateChip state={current.state} />
            <span className="mono text-xs font-bold text-foreground">#{current.attempt}</span>
            <span className="mono truncate text-xs text-muted-foreground">{shortSession(current.sessionId)}</span>
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          {/* ↻ Rerun — a quiet outline/secondary button, subordinate to the
              header's primary ▸ Run agent; disabled (not hidden) while a run is in
              flight, so the strip layout never jumps (DESIGN surface 3). */}
          <button
            type="button"
            onClick={onRerun}
            disabled={rerunDisabled}
            title={rerunDisabled ? "A run is in progress" : "Re-run the agent on this item"}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-semibold text-foreground transition hover:border-primary/50 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            <span aria-hidden="true">↻</span> Rerun
          </button>
          {rerunDisabled ? <span className="text-xs text-muted-foreground">a run is in progress</span> : null}
          <button
            type="button"
            onClick={onRefresh}
            title="Observability is poll/refresh — click to re-fetch"
            className="mono ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground transition hover:text-foreground"
          >
            {refreshedLabel(new Date(fetchedAt).toISOString(), nowIso)}
          </button>
        </div>
      </div>
    </section>
  );
}

// The newest-first run history (DESIGN surface 1): one bordered row per prior run,
// each carrying exactly its four scannable tokens — the TASKS-tab row idiom, not a
// table. The runId and the opaque brief are NOT shown; the chip IS the outcome.
function RunHistory({ runs, nowIso }: { runs: RunRecord[]; nowIso: string }) {
  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">History</span>
        <span className="mono ml-auto text-[11px] text-muted-foreground">
          {runs.length} prior run{runs.length === 1 ? "" : "s"} · newest first
        </span>
      </div>
      {runs.length === 0 ? (
        <p className="text-xs text-muted-foreground">No prior runs.</p>
      ) : (
        <ul className="space-y-2">
          {runs.map((run) => (
            <li key={run.runId} className="flex items-center gap-2.5 rounded-md border border-border p-3">
              <span className="mono shrink-0 text-xs font-bold text-foreground">#{run.attempt}</span>
              <RunStateChip state={run.state} />
              <span className="mono truncate text-xs text-muted-foreground">{shortSession(run.sessionId)}</span>
              <span className="mono ml-auto shrink-0 text-xs text-muted-foreground">{relativeTime(run.createdAt, nowIso)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// The empty state (DESIGN documented-default 5): a dashed-border card, the m03
// doc-absent convention — an item with no runs is ABSENT, not an error.
function RunsEmpty({ elsewhere }: { elsewhere: string | null }) {
  // "No runs yet" is a LIE for an item another node has run (2026-07-26): this tab
  // reads an empty LOCAL runs/ directory, and absence of a local record is not
  // absence of a run. Under milestone 43 the honest answer is the same one every
  // other cache miss gets — that node has not reported any — rather than the
  // retired "not bridged, go and watch the fleet" claim. For an item THIS machine
  // authored, though, an empty local runs/ IS an empty run history, and the m03
  // copy is the true one (ADR-015/F5).
  if (elsewhere != null) return <CachedDocAbsent what="run history" node={elsewhere} />;
  return (
    <div className="flex flex-col items-center gap-2 rounded-md border border-dashed border-border p-6 text-center">
      <span className="inline-block h-6 w-6 rounded-full border-2 border-dashed border-muted-foreground/45" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">No runs yet</p>
      <p className="text-xs text-muted-foreground">This item hasn't been run.</p>
    </div>
  );
}

// THE CACHE MISS — all that survives of the retired `RemoteContentNotice`
// (milestone 43 / story 04). Its copy ("this board bridges the item list, not its
// documents or runs … Open the fleet to watch that node") became FALSE the moment
// the cache became the read surface, and false copy on a degraded path is worse
// than no copy: it sent the reader to another screen for something that is now
// here. What remains is the honest absence, in the m03 absent-not-error
// convention — a dashed placeholder, the `muted` ramp, no error token, no link
// away, no claim about what this board can or cannot reach.
function CachedDocAbsent({ what, node }: { what: string; node: string | null }) {
  return (
    <div className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
      No cached {what} yet — {node ?? "the reporting node"} has not reported one.
    </div>
  );
}

// The run's correlation handle, truncated for the row (DESIGN surface 1: the one
// mono id shown, e.g. "sess·9f2e…"). A fresh run carries no session yet → a quiet
// placeholder. Strip any leading "sess"/"session" prefix so the rendered handle
// reads "sess·<head>…" rather than doubling the prefix.
function shortSession(sessionId: string | null): string {
  if (!sessionId) return "sess·—";
  const head = sessionId.replace(/^sess(ion)?[-_]?/i, "").slice(0, 4);
  return head ? `sess·${head}…` : "sess·—";
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
