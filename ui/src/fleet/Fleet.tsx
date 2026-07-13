import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fleetApi } from "./api";
import type { FleetBoard, FleetNode, RunState, MeshStatus, GlobalMeshStatus, GlobalWorkspace, GlobalWorkItem, GlobalNode, FleetStatus, WorkAssignment } from "./api";
import { runStateChip, relativeTime, refreshedLabel } from "../board/runs.mjs";
import { assignmentChip, assignmentSummary } from "./assignments.mjs";
import { fleetCurrentWorkLines } from "./runs.mjs";
import { StatusRing, StatusChip, StatusDot } from "../board/status";
import type { WorkStatus } from "../board/api";
import {
  scopeLabel,
  scopeFromSearch,
  withScopeParam,
  pageState,
  emptyStateCopy,
  nodePanelFacts,
  nodeCurrentWork,
  diagnosticsSummary,
  errorPathFor,
  milestoneCardModels,
} from "./scope.mjs";
import type { FleetMilestoneCard, Scope } from "./scope.d.mts";

// The read-only "fleet mission-control" web surface (milestone 25 / story 02;
// DESIGN surface 1 → the committed mock `mocks/Mesh.dc.html`). A slim top bar over
// two stacked regions — NODES (the fleet's machines + their live presence) and
// BOARDS (every board being worked on across the group). It renders the ONE
// /api/mesh/status aggregate (ADR-002/ADR-003) and writes nothing: the only
// interactions are the drill-in + the ⟳ refresh. Three read-only ramps, three
// primitives, never merged:
//   - node-presence (a presence dot + relative-age label) — NEW to the fleet;
//   - run-state (the m21 dot+label chip, ui/src/board/runs.mjs) — REUSED verbatim;
//   - item-status (the m03 glyph-ring) — NOT on this surface (one level down).
//
// milestone 34 / story 03 (ADR-006; DESIGN.md) — the page now ALSO renders the
// GLOBAL scope: a scope control (Global/Local, always visible in the top bar), a
// workspaces summary, milestone cards with workspace identity, a node panel
// (roles/capabilities/fabric addresses), and a health/diagnostics region. The
// scope lives in the URL (`?scope=<global|local>`) so a refresh/poll/bookmark
// keeps the selected scope, and switching scope re-queries WITHOUT a full page
// remount (task 02 scenario 3) — the SAME <Fleet> instance just re-fetches under
// the new scope. Render-logic that must be node:test-exercisable (scope-active
// derivation, state selection, filtering, the credential guard) lives in the pure
// ./scope.mjs helper this component imports (the house pattern — see
// ui/src/board/runs.mjs) since there is no React test harness in this repo.

// The client poll cadence (DESIGN default / PRD §7.3): visibility is poll /
// relay-presence, NEVER a push event stream — the client opens no WebSocket / SSE.
const POLL_MS = 5000;
// The freshness-label tick — advances the "refreshed Ns ago" age without a re-poll.
const CLOCK_MS = 1000;

// A GLOBAL-shaped status carries `workspaces`/`items` arrays; the LOCAL shape
// carries `boards`. Narrowing on the presence of `workspaces` (rather than
// `scope`, which the local shape may omit on old fixtures) keeps this robust
// either way.
function isGlobalStatus(status: FleetStatus | null): status is GlobalMeshStatus {
  return status != null && Array.isArray((status as GlobalMeshStatus).workspaces);
}

export function Fleet() {
  const [status, setStatus] = useState<FleetStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // review fix P0.5: the FAILED response's `path` (a global-store-unavailable 503
  // carries the global mesh database path) — captured separately from `status`
  // because a first-load failure leaves `status` null (there is no prior payload to
  // attach it to). errorPathFor (./scope.mjs) prefers this over any path a stale
  // `status` might already carry, so a first-load 503 still names the path.
  const [errorPath, setErrorPath] = useState<string | null>(null);
  // The active scope — sourced from the URL so a refresh/poll/bookmark keeps the
  // selected scope (task 02 scenario 2's "the refresh control keeps the local
  // scope on the next poll"; DESIGN "must make scope obvious enough…").
  const [scope, setScope] = useState<Scope>(() => scopeFromSearch(safeSearch()));
  // The last SUCCESSFUL poll instant — drives the "refreshed Ns ago" freshness
  // label. A failed silent re-poll does NOT advance it (keep-last-good).
  const [fetchedAt, setFetchedAt] = useState<number | null>(null);
  // A live clock so the freshness label ages between polls.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const groupName = useGroupName();

  // The m03 load({silent}) idiom (KEEP-LAST-GOOD): a SILENT refresh updates in
  // place — it never flips to the full-screen loading/error branch (that would
  // unmount the populated subtree and tear the view). Only the first load + an
  // explicit Retry show loading/error; a mid-session poll miss is surfaced QUIETLY
  // (the freshness label stops advancing), never the page-error. The active
  // `scope` always rides along on the request (task 01's `?scope=` deep-link) —
  // a scope switch re-queries under the NEW scope without remounting the page.
  const load = useCallback(async (targetScope: Scope, { silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
      setErrorPath(null);
    }
    try {
      const next = await fleetApi.status(targetScope);
      setStatus(next);
      setFetchedAt(Date.now());
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : "Failed to load");
        setErrorPath(errorPathFor(e as Error & { path?: string | null }, null));
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

  // Poll-only freshness (NO WebSocket, NO SSE): a silent re-poll on the cadence
  // keeps the view current within the m23 presence bound + one poll. The poll
  // re-reads under the CURRENT scope (task 02 scenario 2 — the refresh/poll keeps
  // the selected scope, never silently reverting to the default).
  useEffect(() => {
    const poll = setInterval(() => void load(scope, { silent: true }), POLL_MS);
    return () => clearInterval(poll);
  }, [load, scope]);

  useEffect(() => {
    const clock = setInterval(() => setNowMs(Date.now()), CLOCK_MS);
    return () => clearInterval(clock);
  }, []);

  // Switching scope (task 02 scenario 3): update the URL's `?scope=` (pushState —
  // no navigation, no remount) and let the effect above re-query under the new
  // scope. The <Fleet> instance itself never unmounts.
  const onScopeChange = useCallback((next: Scope) => {
    setScope(next);
    try {
      const url = `${location.pathname}${withScopeParam(location.search, next)}`;
      history.pushState(null, "", url);
    } catch {
      /* history may be unavailable in a non-browser test host — the state still updates */
    }
  }, []);

  const nowIso = useMemo(() => new Date(nowMs).toISOString(), [nowMs]);
  const state = pageState({ loading, error, status });

  return (
    // DESIGN GAP D1 (HIGH, review fix) — `overflow-x-hidden` here is the page-level
    // backstop: milestone cards and long workspace labels should shrink inside the
    // content rail, while this belt-and-braces
    // guard ensures the PAGE body/root itself never grows a horizontal scrollbar
    // at a 360–414px viewport, matching task-02's "no text overlaps at 360px" for
    // the now-populated global state too.
    <div className="flex min-h-screen flex-col overflow-x-hidden bg-background text-foreground">
      <TopBar
        group={groupName}
        scope={scope}
        onScopeChange={onScopeChange}
        fetchedAt={fetchedAt}
        nowIso={nowIso}
        onRefresh={() => void load(scope, { silent: true })}
      />

      {state === "loading" ? (
        <LoadingState />
      ) : state === "error" ? (
        <ErrorState message={error ?? "Failed to load"} path={errorPath} scope={scope} onRetry={() => void load(scope)} />
      ) : state === "empty" ? (
        // empty fleet — a centered dashed placeholder, NOT an error (task 03
        // scenario 1: "does not call the mesh broken or failed").
        <EmptyFleet scope={scope} />
      ) : isGlobalStatus(status) ? (
        <GlobalScopeView status={status} />
      ) : (
        // populated — the two LOCAL card grids. A stale node RENDERS (degraded
        // liveness, never dropped); a nodes-but-no-boards fleet shows the Boards
        // dashed placeholder, never an error.
        <main className="flex-1 px-8 py-7">
          <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-8">
            <NodesRegion nodes={status?.nodes ?? []} />
            <BoardsRegion boards={status?.boards ?? []} />
          </div>
        </main>
      )}
    </div>
  );
}

// The location.search read, guarded for a non-browser test host (scope.mjs's
// scopeFromSearch is itself pure/headless; this wrapper is the ONLY DOM touch).
function safeSearch(): string {
  try {
    return location.search;
  } catch {
    return "";
  }
}

// ─────────────────────────────────────────────────────────── top bar ──────────

function TopBar({
  group,
  scope,
  onScopeChange,
  fetchedAt,
  nowIso,
  onRefresh,
}: {
  group: string;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
  fetchedAt: number | null;
  nowIso: string;
  onRefresh: () => void;
}) {
  const freshness =
    fetchedAt === null
      ? "⟳ refreshed just now"
      : refreshedLabel(new Date(fetchedAt).toISOString(), nowIso);
  return (
    <header className="sticky top-0 z-10 flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
      {/* the filled ✦ mark → aof · Mesh · <group chip> — echoing the board's top bar */}
      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-primary text-sm font-bold text-primary-foreground" aria-hidden="true">
        ✦
      </span>
      <span className="text-sm font-bold tracking-tight">aof</span>
      <span className="text-sm text-muted-foreground">Mesh</span>
      <span className="h-4 w-px bg-border" aria-hidden="true" />
      <span className="mono rounded-md border border-border bg-muted px-2 py-0.5 text-xs text-muted-foreground">{group}</span>
      {/* milestone 34 / story 03 (ADR-006; DESIGN "scope control") — the ALWAYS
          visible Global/Local switch. Present in every page state (loading/error/
          empty/populated — task 02 scenario 4's "the scope control region is
          visible" even while pending) since it lives in the top-level shell, not
          the body region that swaps under it. */}
      <span className="h-4 w-px bg-border" aria-hidden="true" />
      <ScopeControl scope={scope} onScopeChange={onScopeChange} />
      <span className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
        <Legend />
        {/* ⟳ refresh — click re-polls in place (non-tearing, keep-last-good on a
            failed silent poll). NO push/stream chrome. It both shows freshness AND
            triggers a manual re-poll. Re-polls under the CURRENT scope (task 02
            scenario 2 — refresh never silently reverts to the default scope). */}
        <button
          type="button"
          onClick={onRefresh}
          className="mono rounded px-2 py-1 transition hover:bg-muted hover:text-foreground"
          aria-label="Refresh the fleet view"
          title="Visibility is poll/refresh — click to re-poll"
        >
          {freshness}
        </button>
      </span>
    </header>
  );
}

// The scope control (DESIGN "Scope control: shows Global as the active scope and
// exposes a clear local/current-workspace option" / "--local: shows Local as
// active"). A two-way toggle, ALWAYS both options visible (never a hidden
// dropdown) so the operator can never mistake which scope is active — colour AND
// label travel together, mirroring the run-state chip's own "never colour alone"
// discipline.
function ScopeControl({ scope, onScopeChange }: { scope: Scope; onScopeChange: (next: Scope) => void }) {
  return (
    <span className="flex items-center gap-1 rounded-md border border-border bg-muted p-0.5 text-xs" role="group" aria-label="Scope">
      {(["global", "local"] as const).map((candidate) => (
        <button
          key={candidate}
          type="button"
          aria-pressed={scope === candidate}
          onClick={() => onScopeChange(candidate)}
          className={`rounded px-2 py-1 font-semibold transition ${
            scope === candidate
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:bg-card hover:text-foreground"
          }`}
        >
          {scopeLabel(candidate)}
        </button>
      ))}
    </span>
  );
}

// The four-ramp legend (◷ legend) — the reader's key to node-liveness vs
// run-state vs assignment-lifecycle (never confused; item-status is one level
// down, not here). milestone 35 / story 03 (DESIGN §1 item 1 / §4 legend-parity
// note) — the "Assignment" block is the THIRD ramp, below "Node liveness" and
// "Run state", one row per lifecycle state (mark + label) so the new ramp is
// self-documenting exactly as the two existing ramps are.
function Legend() {
  return (
    <span className="group relative" aria-label="Legend">
      <span className="cursor-default select-none">◷ legend</span>
      <span className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden w-64 rounded-md border border-border bg-popover p-3 text-xs text-popover-foreground shadow-md group-hover:block">
        <span className="mb-1 block font-semibold uppercase tracking-wide text-muted-foreground">Node liveness</span>
        <span className="mb-2 block space-y-0.5">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-primary" /> live</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full border border-muted-foreground/50" /> stale</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full border border-dashed border-muted-foreground/40" /> no presence</span>
        </span>
        <span className="mb-1 block font-semibold uppercase tracking-wide text-muted-foreground">Run state</span>
        <span className="mb-2 block space-y-0.5">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-primary" /> running</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-destructive" /> failed</span>
        </span>
        <span className="mb-1 block font-semibold uppercase tracking-wide text-muted-foreground">Assignment</span>
        <span className="block space-y-0.5">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full border border-muted-foreground/50" /> assigned</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-muted-foreground" /> accepted</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary" /> running</span>
          <span className="flex items-center gap-1.5"><span className="grid h-3 w-3 place-items-center rounded-full bg-primary text-[8px] font-bold text-primary-foreground">✓</span> done</span>
          <span className="flex items-center gap-1.5"><span className="grid h-3 w-3 place-items-center rounded-full bg-destructive text-[8px] font-bold text-destructive-foreground">!</span> failed</span>
        </span>
      </span>
    </span>
  );
}

// The small uppercase region header — `NODES  <summary>` / `BOARDS  <summary>`.
function RegionHeader({ label, summary }: { label: string; summary: string }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
      <h2 className="text-[11px] font-bold uppercase tracking-[0.09em] text-muted-foreground">{label}</h2>
      <span className="text-xs text-muted-foreground">{summary}</span>
    </div>
  );
}

// ═══════════════════════════════════════ GLOBAL scope body (milestone 34 / 03) ═

// The GLOBAL scope's populated body (DESIGN.md's four global regions, in order):
// workspaces summary, milestone list (with workspace identity), node panel
// (control/worker, roles, last seen, capabilities, fabric addresses), and the
// health/diagnostics region. Renders EITHER the full machine-wide view (scope:
// "global") or the SAME regions narrowed to one workspace when the operator
// deep-linked `?scope=local` on a globally-started server (scope:"local" but
// still the global-shaped payload — task 01 scenario 3); the CURRENT workspace
// path is surfaced when the narrowing is active (DESIGN "--local … current
// workspace path/name is visible").
function GlobalScopeView({ status }: { status: GlobalMeshStatus }) {
  return (
    <main className="min-w-0 flex-1 px-4 py-7 sm:px-8">
      <div className="mx-auto flex w-full min-w-0 max-w-[1240px] flex-col gap-8">
        {status.scope === "local" && status.workspaceId ? (
          <p className="mono text-xs text-muted-foreground">
            Filtered to workspace <span className="font-semibold text-foreground">{status.workspaceId}</span>
          </p>
        ) : null}
        <WorkspacesSummary workspaces={status.workspaces} />
        <MilestonesList items={status.items} workspaces={status.workspaces} />
        <GlobalNodePanel nodes={status.nodes} />
        <DiagnosticsRegion status={status} />
      </div>
    </main>
  );
}

// The workspaces summary (DESIGN "lists mesh-enabled workspaces known to the
// global store, with status/freshness").
//
// DESIGN GAP D1 (review fix) — a long `projectRoot` path's INTRINSIC content
// width can exceed its grid track even with `truncate` set, because a grid/flex
// item's default `min-width` is `auto` (its content), not `0`; `truncate` alone
// only takes effect once `min-width:0` lets the box actually shrink below that
// content width. `min-w-0` on the card is what makes the pre-existing `truncate`
// genuinely clip a long path instead of forcing the grid — and the page — wider.
function WorkspacesSummary({ workspaces }: { workspaces: GlobalWorkspace[] }) {
  const summary = `${workspaces.length} ${plural(workspaces.length, "workspace")}`;
  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <RegionHeader label="Workspaces" summary={summary} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
        {workspaces.map((workspace) => (
          <div key={workspace.workspaceId} className="flex min-w-0 flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
            <span className="truncate text-[13px] font-bold text-foreground">{workspace.name ?? workspace.workspaceId}</span>
            <span className="mono truncate text-[11px] text-muted-foreground" title={workspace.projectRoot}>{workspace.projectRoot}</span>
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${workspace.meshEnabled ? "bg-primary" : "border border-muted-foreground/50"}`} aria-hidden="true" />
              {workspace.meshEnabled ? "mesh enabled" : "not propagating"}
              {workspace.lastPublishedAt ? ` · ${relativeTime(workspace.lastPublishedAt)}` : ""}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

// The milestone list. The global projection still carries stories/tasks for API
// consumers and local filtering, but this overview intentionally stays at the
// milestone level and reuses the work-board card language: status ring/chip,
// progress track, and child story dots derived from the same flat item stream.
function MilestonesList({ items, workspaces }: { items: GlobalWorkItem[]; workspaces: GlobalWorkspace[] }) {
  const milestones = milestoneCardModels(items);
  const workspaceFor = (workspaceId: string) => workspaces.find((w) => w.workspaceId === workspaceId) ?? null;
  const summary = `${milestones.length} ${plural(milestones.length, "milestone")}`;
  return (
    <section className="flex min-w-0 flex-col gap-3.5">
      <RegionHeader label="Milestones" summary={summary} />
      {milestones.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No milestones published yet.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-4">
          {milestones.map((milestone) => (
            <GlobalMilestoneCard
              key={`${milestone.item.workspaceId}:${milestone.item.ref}`}
              milestone={milestone}
              workspace={workspaceFor(milestone.item.workspaceId)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GlobalMilestoneCard({ milestone, workspace }: { milestone: FleetMilestoneCard; workspace: GlobalWorkspace | null }) {
  const m = milestone;
  const isDone = m.item.status === "done";
  const progressLabel = m.total === 0 ? "not started" : "stories done";
  const title = m.item.title ?? m.item.slug ?? m.item.ref;
  const workspaceName = workspace?.name ?? workspace?.workspaceId ?? m.item.workspaceId;
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState(false);
  const onOpen = useCallback(async () => {
    setOpening(true);
    setOpenError(false);
    try {
      const url = await fleetApi.boardUrl(m.item.workspaceId, m.item.ref);
      window.location.assign(url);
    } catch {
      setOpenError(true);
      setOpening(false);
    }
  }, [m.item.workspaceId, m.item.ref]);

  let secondaryAttention = <span className="text-muted-foreground">·</span>;
  if (m.inReview > 0) {
    secondaryAttention = <span className="text-accent">◔ {m.inReview} in review</span>;
  } else if (isDone) {
    secondaryAttention = <span className="text-primary">✓ accepted</span>;
  }

  // milestone 35 / story 03 (DESIGN §2a) — the assignment chip is the PRIMARY
  // attention-row occupant, sitting BEFORE the in-review/accepted token when
  // both apply (assignment first — it is the more actionable state) and
  // replacing the muted `·` placeholder when the item carries one. It never
  // displaces the right-aligned "Open board →" drill-in.
  const assignment = m.item.assignment;
  const attention = assignment ? (
    <>
      <AssignmentChip assignment={assignment} />
      {secondaryAttention}
    </>
  ) : (
    secondaryAttention
  );

  return (
    <button
      type="button"
      onClick={onOpen}
      title={`Open board for ${workspaceName}`}
      className="group flex min-w-0 flex-col rounded-[10px] border border-border bg-card p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md"
    >
      <div className="flex min-w-0 items-center gap-2">
        <StatusRing status={asWorkStatus(m.item.status)} size={18} />
        <span className="mono shrink-0 text-sm text-muted-foreground">{m.item.ref}</span>
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">milestone</span>
        <span className="ml-auto shrink-0">
          <StatusChip status={asWorkStatus(m.item.status)} />
        </span>
      </div>

      <h3 className="mt-2 truncate text-[16px] font-bold leading-snug" title={title}>{title}</h3>

      <div className="mt-3">
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{progressLabel}</span>
          <span className="mono">
            {m.done} / {m.total}
          </span>
        </div>
        <MilestoneProgressTrack milestone={m} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {m.stories.length === 0 ? (
          <span className="text-xs text-muted-foreground">—</span>
        ) : (
          <>
            {m.stories.map((story) => (
              <StatusDot key={`${story.workspaceId}:${story.ref}`} status={asWorkStatus(story.status)} size={8} title={`${story.ref} · ${story.status ?? "unknown"}`} />
            ))}
            <span className="ml-1 text-[11px] text-muted-foreground">
              {m.stories.length} stor{m.stories.length === 1 ? "y" : "ies"}
            </span>
          </>
        )}
      </div>

      <div className="mt-4 flex min-w-0 items-center justify-between gap-3 border-t border-border pt-3 text-xs">
        <span className="mono min-w-0 truncate text-muted-foreground" title={workspaceName}>{workspaceName}</span>
        <span className="flex min-w-0 shrink items-center gap-3">
          {attention}
          <span className="shrink-0 font-semibold text-primary group-hover:underline">{opening ? "Opening board..." : openError ? "Open failed" : "Open board →"}</span>
        </span>
      </div>
    </button>
  );
}
function MilestoneProgressTrack({ milestone }: { milestone: FleetMilestoneCard }) {
  const m = milestone;
  if (m.total === 0) {
    return <div className="mt-1.5 h-1.5 w-full rounded-full bg-muted" />;
  }
  const donePct = (m.done / m.total) * 100;
  const remainderPct = 100 - donePct;
  const active = m.item.status === "in-progress" || m.inProgress + m.inReview + m.blocked > 0;
  return (
    <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {donePct > 0 ? (
        <div className="h-full" style={{ width: `${donePct}%`, background: "var(--color-primary)" }} />
      ) : null}
      {remainderPct > 0 && active ? (
        <div className="aof-pending h-full" style={{ width: `${remainderPct}%` }} />
      ) : null}
    </div>
  );
}

function asWorkStatus(status: string | null | undefined): WorkStatus | null {
  return status as WorkStatus | null;
}
// The global node panel (DESIGN "shows control and worker nodes, last seen,
// roles/capabilities, and fabric address when known"). Uses nodePanelFacts
// (./scope.mjs) so the SAME projection + credential guard the fitness unit tests
// governs the rendered fields — no descriptor field is printed raw.
function GlobalNodePanel({ nodes }: { nodes: GlobalNode[] }) {
  const summary = `${nodes.length} ${plural(nodes.length, "node")}`;
  return (
    <section className="flex flex-col gap-3.5">
      <RegionHeader label="Nodes" summary={summary} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
        {nodes.map((node) => {
          const facts = nodePanelFacts(node);
          // finding F9 (aof:verify 38) — THIS is the card the web app actually
          // renders in production (mesh-ui-serve.mjs serves BOTH scopes from
          // queryGlobalMeshStatus, so isGlobalStatus(status) is always true and
          // NodeCard/NodesRegion never mount there). F6 put `presence` on the
          // wire; this calls nodeCurrentWork (./scope.mjs), the SAME
          // fleetCurrentWorkLines projection NodeCard already calls — no forked
          // collapse rule (DESIGN §Surface 1's row 3) — kept in scope.mjs (not
          // inline) so node:test exercises the EXACT function this component
          // renders from, with no React harness needed.
          const currentWork = nodeCurrentWork(node);
          return (
            <div key={facts.nodeId ?? node.nodeId} className="flex flex-col gap-1.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
              <div className="flex items-center gap-2">
                <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${facts.freshness === "live" ? "bg-primary" : "border border-muted-foreground/50"}`} aria-hidden="true" />
                <span className="mono truncate text-[13px] font-bold text-foreground">{facts.nodeId}</span>
                {facts.role ? (
                  <span className="ml-auto shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {facts.role}
                  </span>
                ) : null}
              </div>
              <span className="mono truncate text-[11px] text-muted-foreground">{facts.host ?? "—"}</span>
              <span className="text-[11px] text-muted-foreground">
                {facts.lastSeenAt ? `last seen ${relativeTime(facts.lastSeenAt)}` : "never seen"}
              </span>
              {/* row 3 equivalent — the current-work line (DESIGN §Surface 1: a
                  SINGLE text line, same text-[13px] slot, no new chip/dot/badge;
                  idle=muted, running/working=primary; two repos comma-joined;
                  the run wins when both exist — all already resolved upstream by
                  fleetCurrentWorkLines, never re-derived here). Placed between
                  the presence-age row and the footer-ish rows, per the DESIGN row
                  order (identity → presence-age → current-work → footer). */}
              {currentWork.lines.map((line, index) => (
                <p
                  key={`${facts.nodeId ?? node.nodeId}-current-work-${index}`}
                  className={`text-[13px] ${currentWork.token === "primary" ? "font-semibold text-primary" : "text-muted-foreground"}`}
                >
                  {line}
                </p>
              ))}
              <AssignmentSummaryLine assignments={node.assignments} />
              {/* DESIGN GAP D2 (review fix) — the fabric-address row is now ALWAYS
                  rendered, even when unknown: an absent address used to omit this
                  row entirely, so "no address known" read identically to "this
                  slot doesn't exist," making "unknown" indistinguishable from
                  "dropped." Degrading to an explicit "unknown" keeps the affordance
                  present and legible either way. */}
              <span className="mono truncate text-[10.5px] text-muted-foreground">
                fabric addr: {facts.fabricAddress ?? "unknown"}
              </span>
              <span className="mono truncate border-t border-border pt-2 text-[10.5px] text-muted-foreground">
                {facts.capabilities.length ? facts.capabilities.join(", ") : "no capabilities"}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// The health/diagnostics region (DESIGN "shows projection freshness, disabled/
// non-propagating workspaces, and store errors"; task 03 scenario 4 — never hides
// healthy workspaces/nodes, just adds a summary alongside them).
function DiagnosticsRegion({ status }: { status: GlobalMeshStatus }) {
  const summary = diagnosticsSummary(status);
  return (
    <section className="flex flex-col gap-2">
      <RegionHeader label="Diagnostics" summary="" />
      <div className="flex flex-wrap gap-3 rounded-lg border border-border bg-card/60 px-4 py-3 text-[11.5px] text-muted-foreground">
        <span>
          Projection: {summary.projectedAt ? `updated ${relativeTime(summary.projectedAt)}` : "no snapshot yet"}
        </span>
        <span aria-hidden="true">·</span>
        <span>{summary.skippedWorkspaceCount} disabled/skipped {plural(summary.skippedWorkspaceCount, "workspace")}</span>
        <span aria-hidden="true">·</span>
        <span>{summary.descriptorErrorCount} descriptor {plural(summary.descriptorErrorCount, "error")}</span>
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────── NODES region ───────

function NodesRegion({ nodes }: { nodes: FleetNode[] }) {
  const live = nodes.filter((n) => livenessOf(n) === "live").length;
  const stale = nodes.filter((n) => livenessOf(n) === "stale").length;
  const offline = nodes.filter((n) => livenessOf(n) === "no-presence").length;
  const summary = `${nodes.length} ${plural(nodes.length, "node")} · ${live} live · ${stale} stale · ${offline} offline`;
  return (
    <section className="flex flex-col gap-3.5">
      <RegionHeader label="Nodes" summary={summary} />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3.5">
        {nodes.map((node) => (
          <NodeCard key={node.nodeId} node={node} />
        ))}
      </div>
    </section>
  );
}

function NodeCard({ node }: { node: FleetNode }) {
  const liveness = livenessOf(node);
  const runtimes = node.runtimes ?? [];
  const skills = node.skills ?? [];
  // milestone 38 / story 00 (ADR-004; DESIGN §Surface 1) — row 3 grows a THIRD
  // label on the SAME text line: `idle` / `running N runs` / `working · <repo>
  // (session)`, reusing the run-state ramp's two tokens (primary active / muted
  // quiet — never a new dot/chip/badge). The projection is the ONE pure helper
  // (ui/src/fleet/runs.mjs's fleetCurrentWorkLines) both the desktop and web
  // views consume — this component renders ONLY what it hands back.
  const currentWork = fleetCurrentWorkLines(node.presence ?? {});
  return (
    <div className="flex flex-col rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm">
      {/* row 1: presence dot + mono nodeId + right group (this-node tag + version) */}
      <div className="flex items-center gap-2">
        <PresenceDot liveness={liveness} size="sm" />
        <span className="mono truncate text-[13px] font-bold text-foreground">{node.nodeId}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {/* the "this node" tag — an identity label, not a colour change; renders
              only when mesh:status flags the local node (design-gap B). */}
          {node.local ? (
            <span className="rounded border border-border bg-card px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-muted-foreground">
              this node
            </span>
          ) : null}
          {node.aofVersion ? (
            <span className="mono rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
              {node.aofVersion}
            </span>
          ) : null}
        </span>
      </div>
      {/* row 2: the presence-age line — the node-presence ramp (dot + label) */}
      <div className="mt-2.5 flex items-center gap-2">
        <PresenceDot liveness={liveness} size="md" />
        <PresenceLabel node={node} liveness={liveness} />
      </div>
      {/* row 3: the current-work line(s) — idle / running N runs / working ·
          <repo> (session), one line per resolved workspace (ADR-004). */}
      {currentWork.lines.map((line, index) => (
        <p
          key={`${index}-${line}`}
          className={`text-[13px] ${index === 0 ? "mt-2" : "mt-0.5"} ${currentWork.token === "primary" ? "font-semibold text-primary" : "text-muted-foreground"}`}
        >
          {line}
        </p>
      ))}
      {/* row 4: the quiet capability footer — runtimes + N skills */}
      <p className="mono mt-3 truncate border-t border-border pt-2.5 text-[10.5px] text-muted-foreground">
        {runtimes.length ? `${runtimes.join(", ")} · ${skills.length} ${plural(skills.length, "skill")}` : "not enrolled · no skills"}
      </p>
    </div>
  );
}

// The node-side assignments summary line (milestone 35 / story 03; DESIGN §2b
// SECONDARY attachment) — a compact muted line, `assignments: N running · N
// accepted · N assigned`, listing ONLY non-zero states in the same brightness
// order the ramp climbs. A degraded (failed/reclaimed) held assignment renders
// its count in the destructive token so it is visible on the WORKER card too
// ("degraded states must be visible"). All-zero (or no assignments at all) ⇒
// the row is OMITTED entirely — "absent, not false," never "0 assignments".
// The pure tally lives in ./assignments.mjs's `assignmentSummary` (task 01);
// this component is a thin consumer.
function AssignmentSummaryLine({ assignments }: { assignments?: WorkAssignment[] }) {
  const summary = assignmentSummary(assignments) as { state: string; count: number }[];
  if (summary.length === 0) return null;
  // DESIGN §2b fix (review GAP-2) — the PURE tally (./assignments.mjs) orders
  // states by the ramp's brightness (running…failed last), which is correct for
  // the pure projection but meant the destructive "failed" bucket sat at the
  // truncating tail of this line and was the FIRST thing lost to ellipsis. The
  // render layer splits the line into a shrink-0 "failed" prefix (never
  // truncated) and a single truncating span for everything else — a truncated
  // non-degraded tail is acceptable, a truncated failed count is not.
  const failed = summary.filter((entry) => entry.state === "failed");
  const rest = summary.filter((entry) => entry.state !== "failed");
  const restText = rest.map((entry) => `${entry.count} ${entry.state}`).join(" · ");
  return (
    <span className="mono flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
      <span className="shrink-0">assignments:</span>
      {failed.map((entry) => (
        <span key={entry.state} className="shrink-0 text-destructive">
          {entry.count} {entry.state}
          {rest.length > 0 ? " ·" : ""}
        </span>
      ))}
      {rest.length > 0 ? <span className="min-w-0 truncate">{restText}</span> : null}
    </span>
  );
}

// The node-presence ramp — the locked three-state mapping (DESIGN checklist item 3):
// live = teal (primary) filled dot; stale = muted hollow dot; no-presence = dashed
// muted dot. Colour AND label ALWAYS travel together (never colour alone). Stale is
// `secondary`/muted, NEVER `destructive` — degraded liveness, not data loss.
type Liveness = "live" | "stale" | "no-presence";

function livenessOf(node: FleetNode): Liveness {
  if (!node.presence) return "no-presence";
  return node.stale ? "stale" : "live";
}

function presenceDotClass(liveness: Liveness): string {
  if (liveness === "live") return "bg-primary";
  if (liveness === "stale") return "border border-muted-foreground/50 bg-card";
  return "border border-dashed border-muted-foreground/40 bg-card opacity-75";
}

function PresenceDot({ liveness, size }: { liveness: Liveness; size: "sm" | "md" }) {
  const dim = size === "sm" ? "h-2 w-2" : "h-2.5 w-2.5";
  return <span className={`inline-block shrink-0 rounded-full ${dim} ${presenceDotClass(liveness)}`} aria-label={liveness} />;
}

function PresenceLabel({ node, liveness }: { node: FleetNode; liveness: Liveness }) {
  if (liveness === "no-presence") {
    return <span className="mono text-[11.5px] font-medium text-muted-foreground">no presence</span>;
  }
  const age = relativeTime(node.presence!.heartbeatAt) as string;
  if (liveness === "live") {
    return <span className="mono text-[11.5px] font-medium text-primary">♥ {age}</span>;
  }
  // stale — quiet/muted, never alarm-red.
  return <span className="mono text-[11.5px] font-medium text-muted-foreground">stale · {age}</span>;
}

// ──────────────────────────────────────────────────────── BOARDS region ────────

function BoardsRegion({ boards }: { boards: FleetBoard[] }) {
  const running = boards.filter((b) => boardRunState(b) === "running").length;
  const summary = `${boards.length} ${plural(boards.length, "board")} · ${running} running`;
  return (
    <section className="flex flex-col gap-3.5">
      <RegionHeader label="Boards" summary={summary} />
      {boards.length === 0 ? (
        // nodes-but-no-boards — a dashed placeholder, NOT an error (absent, not
        // broken; the empty-fleet no-roster case is handled one level up).
        <div className="rounded-lg border border-dashed border-border bg-card/40 p-6 text-sm text-muted-foreground">
          No boards registered in the group yet.
        </div>
      ) : (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(272px,1fr))] gap-3.5">
          {boards.map((board) => (
            <BoardTile key={board.ref} board={board} />
          ))}
        </div>
      )}
    </section>
  );
}

// A board's current-run state, from the aggregate. The enriched currentRun wins when
// present; else a non-empty activeRuns means at least one running run; else the board
// has no run to render.
function boardRunState(board: FleetBoard): RunState | null {
  if (board.currentRun && board.currentRun.state) return board.currentRun.state;
  if ((board.activeRuns?.length ?? 0) > 0) return "running";
  return null;
}

function BoardTile({ board }: { board: FleetBoard }) {
  const state = boardRunState(board);
  return (
    <div className="relative flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm transition hover:border-muted-foreground/40 hover:shadow-md">
      {/* row 1: board name over its quiet "on <nodeId>" owner (stacked) */}
      <div className="flex flex-col gap-1">
        <span className="mono truncate text-[15px] font-semibold tracking-tight text-foreground">{board.ref}</span>
        {board.owner ? (
          <span className="mono text-[11px] text-muted-foreground">on {board.owner}</span>
        ) : null}
      </div>
      {/* row 2: the m21 run-state chip (verbatim) · the Open board → drill-in */}
      <div className="flex items-center gap-2">
        {state === null ? (
          <span className="text-xs font-medium text-muted-foreground">No runs yet</span>
        ) : (
          <RunStateChip state={state} />
        )}
        <BoardDrillIn board={board} />
      </div>
    </div>
  );
}

// The run-state chip — m21's ramp VERBATIM (DESIGN checklist item 5): queued grey ·
// running teal + pulse · done teal + ✓ · failed red (destructive) · cancelled grey.
// The token→class mapping mirrors the board's runChipClasses so the chip reads
// byte-identically to the board's (one vocabulary, one product).
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
  const chip = runStateChip(state) as { label: string; token: string; mark: string };
  const tone = runChipClasses(chip.token);
  const pulsing = chip.mark === "a pulsing dot";
  const check = chip.mark === "a ✓";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold ${tone.chip}`}
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

// The assignment-lifecycle chip (milestone 35 / story 03; DESIGN §2a/§4) — the
// PRIMARY attachment on GlobalMilestoneCard's attention row. Mirrors
// RunStateChip byte-for-byte (the SAME `runChipClasses(token)` tone map, the
// SAME pill shape) — reusing the run-chip primitive/vocabulary is the DESIGN
// review's explicit conformance bar (a fleet-local chip system is a GAP). The
// pure state -> descriptor mapping lives in ./assignments.mjs's
// `assignmentChip` (task 01) — this component is a thin consumer: it applies
// NO ramp logic of its own.
//
// Anatomy: `<mark> <label> → <nodeId> · <relative-time> [· <note>]` — the
// `→ nodeId` / `· time` / `· note` are chip-adjacent mono text OUTSIDE the
// pill (like the board tile's `on <owner>` line), so the pill itself stays the
// run-chip shape.
function AssignmentChip({ assignment }: { assignment: WorkAssignment }) {
  const chip = assignmentChip(assignment) as { label: string; token: string; mark: string; motion: string; note?: string };
  const tone = runChipClasses(chip.token);
  const pulsing = chip.motion === "pulse";
  const check = chip.mark === "a ✓";
  const bang = chip.mark === "a !";
  const at = assignment.assignedAt ?? assignment.updatedAt;
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      <span
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border px-2.5 py-0.5 text-xs font-semibold ${tone.chip}`}
        title={`assignment ${chip.label}`}
      >
        {check || bang ? (
          <span
            className={`grid h-3 w-3 place-items-center rounded-full text-[8px] font-bold text-primary-foreground ${tone.dot}`}
            aria-hidden="true"
          >
            {check ? "✓" : "!"}
          </span>
        ) : (
          <span
            className={`inline-block h-2 w-2 rounded-full ${tone.dot} ${pulsing ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
        )}
        {chip.label}
      </span>
      {/* DESIGN §2a fix (review GAP-1): this adjacent mono text is the ONE
          shrinkable/truncating element in the assignment attention-row cluster —
          the pill above and the sibling "Open board →" label both stay shrink-0
          (see GlobalMilestoneCard), so a long nodeId/time/note truncates here
          instead of displacing or clipping the drill-in. */}
      <span className="mono min-w-0 truncate text-[11px] text-muted-foreground" title={`→ ${assignment.targetNodeId}${at ? ` · ${relativeTime(at)}` : ""}${chip.note ? ` · ${chip.note}` : ""}`}>
        → {assignment.targetNodeId}
        {at ? ` · ${relativeTime(at)}` : ""}
        {chip.note ? ` · ${chip.note}` : ""}
      </span>
    </span>
  );
}

// The drill-in (DESIGN → "Open board →"; task 03 / ADR-003 decision 4) — a LINK,
// never an embed or a proxy: the fleet view never fetches a board's /api/work. The
// locality two-case split is decided by the aggregate's `local` marker (design-gap B):
//   - LOCAL board → a real navigating link out to its OWN aof work ui;
//   - PEER board  → the honest-locality affordance: an "Open board →" control that
//     copies the `aof work ui` command (attributed to the owner node), NEVER a dead
//     href that would dead-end on this machine.
// Both read as "Open board →" (mock parity); only the mechanism differs by locality.
function BoardDrillIn({ board }: { board: FleetBoard }) {
  const [copied, setCopied] = useState(false);
  const onCopy = useCallback(() => {
    try {
      void navigator.clipboard?.writeText("aof work ui");
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      /* clipboard may be unavailable — the tooltip still names the command */
    }
  }, []);

  if (board.local) {
    // A locally-served board navigates out to its OWN aof work ui (a link, never an
    // embed/proxy — no /api/work is issued on drill-in's behalf).
    return (
      <a
        href="/?mode=board"
        className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary transition hover:underline"
      >
        Open board →
      </a>
    );
  }

  // A peer-only board: the honest-locality affordance — clicking copies the renamed
  // `aof work ui` verb to run on the owner node (named by the tile's "on <owner>"
  // label + the copy confirmation). It is NOT a link that dead-ends here.
  return (
    <button
      type="button"
      onClick={onCopy}
      title={board.owner ? `Run \`aof work ui\` on ${board.owner} to open this board` : "Run `aof work ui` on its owner node"}
      className="ml-auto inline-flex items-center gap-1 text-xs font-semibold text-primary transition hover:underline"
    >
      {copied ? "✓ copied aof work ui" : "Open board →"}
    </button>
  );
}

// ───────────────────────────────────────────────────────── whole-page states ──

// milestone 34 / story 03 (task 02 scenario 4) — the loading state reserves the
// SAME region layout the populated global view uses (workspace summary / milestones /
// node panel / diagnostics), so nothing reflows when data arrives and no
// text overlaps at a 360px viewport (each placeholder is a fixed-height block, not
// text that could wrap unpredictably). The scope control itself lives in the
// TopBar (always mounted, task 02 scenario 4's "the scope control region is
// visible" — true even here, one level up from this body).
function LoadingState() {
  return (
    <main className="flex-1 px-4 py-7 sm:px-8">
      <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-8">
        <RegionPlaceholder label="Workspaces" />
        <RegionPlaceholder label="Milestones" />
        <RegionPlaceholder label="Nodes" />
        <RegionPlaceholder label="Diagnostics" />
      </div>
    </main>
  );
}

function RegionPlaceholder({ label }: { label: string }) {
  return (
    <section className="flex flex-col gap-2" aria-busy="true" aria-label={`Loading ${label}`}>
      <span className="h-3 w-24 animate-pulse rounded bg-muted" aria-hidden="true" />
      <span className="h-16 w-full animate-pulse rounded-lg border border-border bg-card/40" aria-hidden="true" />
    </section>
  );
}

// A PAGE-level failure to reach the mesh (distinct from a stale node, which is
// normal rendered degradation) — an accent pill + Retry. milestone 34 / story 03
// (task 03 scenario 2) — a global-store-unavailable error names the global mesh
// PATH so the operator knows exactly which file to inspect, and Retry keeps the
// CURRENT scope (never silently falling back to the other scope). review fix
// P0.5: `path` is passed down ALREADY resolved (Fleet.tsx's errorPathFor call) —
// this component only renders it, it does not re-derive it from `status` (which is
// null on a first-load failure and so was never a reliable source on its own).
function ErrorState({ message, path, scope, onRetry }: { message: string; path: string | null; scope: Scope; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent">
          <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground" aria-hidden="true">!</span>
          Could not load the mesh: {message}
        </div>
        {path ? (
          <p className="mono text-[11px] text-muted-foreground">Global mesh store: {path}</p>
        ) : null}
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
        >
          ⟳ Retry {scopeLabel(scope)}
        </button>
      </div>
    </div>
  );
}

// Empty fleet — a centered dashed placeholder, NOT an error (mirrors the CLI's "No
// nodes in the mesh roster."). milestone 34 / story 03 (task 03 scenario 1) — the
// GLOBAL empty copy explains that no mesh-enabled workspace has published yet
// (never "broken"/"failed"); the LOCAL empty copy keeps the pre-existing
// enrol-a-node guidance, unchanged.
function EmptyFleet({ scope }: { scope: Scope }) {
  const copy = emptyStateCopy(scope);
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/50 px-8 py-9 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-dashed border-muted-foreground/40 text-xl text-muted-foreground" aria-hidden="true">✦</span>
        <span className="text-[15px] font-semibold text-foreground">
          {scope === "local" ? "No nodes in the group yet" : "No mesh-enabled workspaces yet"}
        </span>
        <span className="text-[12.5px] leading-relaxed text-muted-foreground">{copy}</span>
        {scope === "local" ? (
          <span className="flex w-full flex-col gap-2">
            <span className="mono rounded-md border border-border bg-muted px-3 py-2 text-left text-[11.5px] text-muted-foreground">aof mesh invite</span>
            <span className="mono rounded-md border border-border bg-muted px-3 py-2 text-left text-[11.5px] text-muted-foreground">aof mesh join</span>
          </span>
        ) : (
          <span className="flex w-full flex-col gap-2">
            <span className="mono rounded-md border border-border bg-muted px-3 py-2 text-left text-[11.5px] text-muted-foreground">config.mesh.enabled: true</span>
          </span>
        )}
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────── helpers ─────────

function plural(n: number, word: string): string {
  return n === 1 ? word : `${word}s`;
}

// The group name for the top bar. There is no group name in the mesh:status
// aggregate (ADR-002 — one command, no second read), so the fleet view reads it from
// the ?group= query when supplied, else a neutral default.
function useGroupName(): string {
  const ref = useRef<string>("");
  if (!ref.current) {
    try {
      ref.current = new URLSearchParams(location.search).get("group") || "fleet";
    } catch {
      ref.current = "fleet";
    }
  }
  return ref.current;
}
