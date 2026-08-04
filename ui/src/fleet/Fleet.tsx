import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fleetApi } from "./api";
import type { FleetBoard, FleetNode, RunState, MeshStatus, GlobalMeshStatus, GlobalWorkspace, GlobalWorkItem, GlobalNode, FleetStatus, WorkAssignment } from "./api";
import { runStateChip, relativeTime, refreshedLabel } from "../board/runs.mjs";
import { assignmentChip, assignmentSummary } from "./assignments.mjs";
import { FleetTerminalView } from "./terminal-view/FleetTerminalView";
import { fleetCurrentWorkLines } from "./runs.mjs";
import { StatusRing, StatusChip, StatusDot } from "../board/status";
import type { WorkStatus } from "../board/api";
// milestone 43 / story 04 — the FIFTH read-only ramp, imported from the ONE
// headless module the board also imports (never a fleet copy), so the two
// surfaces cannot disagree about whether a row is stale or about how the badge
// is painted. The fleet's own delta is deliberately small: a badge in the
// milestone card's row-1 cluster with the full sentence in its `title`, and the
// legend's fourth block. There is NO Resync here — one door per item, on the
// surface that also shows WHAT is stale (DESIGN §Surface 2).
import { freshness, isCachePublished, readStalenessWindow } from "../board/freshness.mjs";
import type { Freshness } from "../board/freshness.mjs";
import { StaleBadge, FreshnessLegend } from "../board/StaleBadge";
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
  assignableNodeOptions,
} from "./scope.mjs";
import type { FleetMilestoneCard, Scope } from "./scope.d.mts";
// milestone 38 / story 04 / task 06 (DESIGN §Surface 2 Amendment 2026-07-24, F22)
// — the assign affordance's own state machine, in the house pure-helper pattern
// (there is no React test harness in this repo): AssignAffordance below holds NO
// transition logic of its own, it renders exactly what `assignAffordanceView`
// returns and delegates the whole click to `runAssign`.
import {
  POLL_MS,
  REGION5_NAME_BUDGET_CH,
  REGION5_CHIP_SLOT_BUDGET_CH,
  REGION5_DRILLIN_ABBREV_AT_CH,
  assignAtRest,
  assignAckExpired,
  assignAffordanceView,
  runAssign,
} from "./assign-affordance.mjs";
import type { AssignAffordanceState } from "./assign-affordance.d.mts";

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
// It is imported from ./assign-affordance.mjs (which owns it beside
// ASSIGN_SENT_HOLD_MS) because the poll interval and the F22 `Sent` hold are ONE
// number by design — a hold of exactly one poll interval is what guarantees there
// is never a moment between the click and a confirmation in which the surface
// says nothing. Two copies of that number could drift; one cannot.
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

  // milestone 43 / story 04 — the fleet's own reading of the SAME ramp, off the
  // SAME 1s clock the freshness label already rides. The window is read through
  // the ONE reader in `freshness.mjs`; when this payload does not carry it, the
  // ramp withholds every verdict (no badge is asserted on a window nobody
  // stated) and the legend degrades to words. Null for a row the cache does not
  // publish, which is what keeps a non-mesh fleet free of the vocabulary.
  const stalenessWindow = readStalenessWindow(status);
  const freshnessOf = useCallback(
    (item: GlobalWorkItem | null | undefined): Freshness | null =>
      item && isCachePublished(item) ? freshness(item, { now: nowMs, windowSeconds: stalenessWindow }) : null,
    [nowMs, stalenessWindow]
  );

  // milestone 38 / story 04 / task 06 (DESIGN §Surface 2 A8, F22) — on a
  // successful assign the surface fires EXACTLY ONE additional re-load, so
  // region 5's m35 `assigned` chip lands within a round trip of the 2xx instead
  // of up to one poll interval later. It is the SAME `load(scope, { silent:true })`
  // the ⟳ control fires, handed DOWN to the affordance as `onAssigned`.
  //
  // It MUST be the SILENT load: a non-silent one flips the page into its
  // loading state and UNMOUNTS the populated board, which is a far worse answer
  // than saying nothing. And it is ONE load — no new cadence, no retry ladder;
  // the existing POLL_MS poll remains the steady state, and the `Sent` hold is
  // sized to cover exactly that window if the record is not yet visible.
  const onAssigned = useCallback(() => void load(scope, { silent: true }), [load, scope]);

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
        stalenessWindow={stalenessWindow}
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
        <GlobalScopeView status={status} freshnessOf={freshnessOf} onAssigned={onAssigned} />
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
  stalenessWindow,
  onRefresh,
}: {
  group: string;
  scope: Scope;
  onScopeChange: (next: Scope) => void;
  fetchedAt: number | null;
  nowIso: string;
  // The configured cache-staleness window off the status payload, for the
  // legend's Freshness block. Null when the wire does not carry it, in which
  // case the block states the window in words rather than guessing a number.
  stalenessWindow: number | null;
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
        <Legend windowSeconds={stalenessWindow} />
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

// The legend (◷ legend) — the reader's key to node-liveness vs run-state vs
// assignment-lifecycle (never confused; item-status is one level down, not
// here). milestone 35 / story 03 (DESIGN §1 item 1 / §4 legend-parity note) —
// the "Assignment" block is the THIRD ramp, below "Node liveness" and "Run
// state", one row per lifecycle state (mark + label) so the new ramp is
// self-documenting exactly as the two existing ramps are.
//
// milestone 43 / story 04 — and "Freshness" is the FOURTH, for the same reason
// and by the same rule, painting the REAL badge component the surfaces paint
// (never a fleet-local drawing) and stating the window from the wire. It is the
// LAST block on both this legend and the board's, so the two read alike.
function Legend({ windowSeconds }: { windowSeconds: number | null }) {
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
        <span className="mt-2 block">
          <FreshnessLegend windowSeconds={windowSeconds} />
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
function GlobalScopeView({
  status,
  freshnessOf,
  onAssigned,
}: {
  status: GlobalMeshStatus;
  // The fleet's ONE freshness reading for an item row — computed once at the
  // page root off its own 1s clock and the payload's window, then handed down.
  freshnessOf: (item: GlobalWorkItem | null | undefined) => Freshness | null;
  onAssigned: () => void;
}) {
  return (
    <main className="min-w-0 flex-1 px-4 py-7 sm:px-8">
      <div className="mx-auto flex w-full min-w-0 max-w-[1240px] flex-col gap-8">
        {status.scope === "local" && status.workspaceId ? (
          <p className="mono text-xs text-muted-foreground">
            Filtered to workspace <span className="font-semibold text-foreground">{status.workspaceId}</span>
          </p>
        ) : null}
        <WorkspacesSummary workspaces={status.workspaces} />
        <MilestonesList items={status.items} workspaces={status.workspaces} nodes={status.nodes} freshnessOf={freshnessOf} onAssigned={onAssigned} />
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
function MilestonesList({ items, workspaces, nodes, freshnessOf, onAssigned }: { items: GlobalWorkItem[]; workspaces: GlobalWorkspace[]; nodes: GlobalNode[]; freshnessOf: (item: GlobalWorkItem | null | undefined) => Freshness | null; onAssigned: () => void }) {
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
              nodes={nodes}
              freshness={freshnessOf(milestone.item)}
              onAssigned={onAssigned}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function GlobalMilestoneCard({ milestone, workspace, nodes, freshness, onAssigned }: { milestone: FleetMilestoneCard; workspace: GlobalWorkspace | null; nodes: GlobalNode[]; freshness: Freshness | null; onAssigned: () => void }) {
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

  // DG-19: `·` is a PLACEHOLDER — it stands in for an absent token so the row
  // is not empty. Once the chip occupies the cluster the row is not empty, and
  // §2a's own rule already says the chip REPLACES the placeholder. The build
  // rendered both, leaving a lone `·` floating between the chip and the drill-in
  // and spending width the yield order then had to claw back.
  const secondaryIsPlaceholder = !(m.inReview > 0) && !isDone;
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
  // DG-19, the last clause: `Open board →` gives up its WORDS whole once the
  // chip's target alone needs the room. A discrete rule, not a shrink factor —
  // measured, the 1000:1 ratio still let the target truncate (the drill-in
  // yielded 13.1px, the chip 17.5px), because flexbox distributes a squeeze and
  // cannot express "this element goes away so that one can be whole".
  const abbreviateDrillIn = !!assignment
    && `→ ${assignment.targetNodeId}`.length > REGION5_DRILLIN_ABBREV_AT_CH;
  // DG-20's fit gate + DG-22's alignment consequence, decided once so the two
  // cannot disagree: when the name goes, the cluster becomes the row's leading
  // group and must be left-aligned, with only the drill-in pushed right.
  const nameDropped = !!assignment && workspaceName.length > REGION5_NAME_BUDGET_CH;
  const attention = assignment ? (
    <>
      <AssignmentChip assignment={assignment} />
      {secondaryIsPlaceholder ? null : secondaryAttention}
    </>
  ) : (
    secondaryAttention
  );

  return (
    // milestone 38 / story 04 (ADR-012) — a plain <div>, not a <button>: the
    // "assign to node" affordance below is its own interactive control, and an
    // HTML <button> may never nest another interactive element. The "Open
    // board" drill-in moves to an inner button covering the SAME clickable
    // region as before; the assign row sits BELOW it as a sibling, so neither
    // control's click bubbles into the other.
    <div className="group flex min-w-0 flex-col rounded-[10px] border border-border bg-card p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-md">
      <button
        type="button"
        onClick={onOpen}
        title={`Open board for ${workspaceName}`}
        className="flex min-w-0 flex-col text-left"
      >
        <div className="flex min-w-0 items-center gap-2">
          <StatusRing status={asWorkStatus(m.item.status)} size={18} />
          <span className="mono shrink-0 text-sm text-muted-foreground">{m.item.ref}</span>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">milestone</span>
          {/* milestone 43 / story 04 (DESIGN §Surface 2) — row 1's `ml-auto
              shrink-0` span becomes a CLUSTER of `badge + chip`, so the status
              chip keeps its exact right-edge anchor and nothing moves when a card
              crosses the threshold. Attribution here is ON DEMAND (the badge's
              `title`) rather than a new line: region 5's geometry is
              fitness-locked, the workspace strip above already carries workspace
              identity in full, and the node panel already answers "is that machine
              alive". There is NO Resync on this surface — one door per item, on
              the board, which is also the surface that shows WHAT is stale. The
              badge is a non-interactive <span>, so the drill-in <button> it sits
              inside stays a single focus stop (m38/ADR-012).

              THE FORM IS `short` AT EVERY WIDTH, pinned from the render (DESIGN
              §"The form is chosen by the SURFACE, not by the viewport",
              2026-08-03). This card's width is viewport-INVARIANT by
              construction: the grid above is `repeat(auto-fill, minmax(320px,
              1fr))`, so a wider viewport buys COLUMNS rather than width and the
              card sits in a ~300–370px band at every breakpoint — narrower at
              2560 than at 1280. A viewport-keyed ladder would therefore paint the
              WIDEST form in the NARROWER card, which reads as a bug. */}
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <StaleBadge freshness={freshness} form="short" />
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

        {/* Region 5 — the footer / attention cluster. DG-13 clause 5 (DESIGN
            §Surface 2 Amendment 2026-07-24 (b); DG-11 re-scoped here) pins the
            WIDTH PRIORITY: chip label + `→ <target>` in FULL > `Open board →` >
            the workspace name. The judged render truncated the target in EVERY
            frame that had one (`→ umairs-m…`, `→ aaa-firs…`) — "a target that
            cannot be read is a chip that has not spoken" — because the name held
            a content-sized basis and the cluster absorbed the shrink instead.
            The name took a ZERO basis (`flex-1`) so it would be fed only what is
            LEFT — but `flex-1` + `truncate` does not DROP, it STUBS, and the
            re-render caught it rendering `l…` / `le…` / `let…` for
            `let-shield-portal` in every chip-bearing frame (DG-16, which also
            falsified DG-11's "does not reproduce" note). Meanwhile the cluster's
            own `shrink-0` children overflowed their `min-w-0` wrapper and PAINTED
            OVER `Open board →` (DG-15) — a priority list built as a PAINT order
            where the rule demands a YIELD order.

            The row is now an explicit yield order, and DG-13 clause 5 gains its
            SIXTH clause: NO TWO ELEMENTS IN REGION 5 MAY OCCUPY THE SAME PIXELS.
            A lower-priority element gives up space; it never stays put and gets
            overprinted. In order of who yields first:
              1. the workspace NAME — full or nothing (DG-16), decided by a fit
                 budget (DG-20). Truncation is for elements whose PREFIX still
                 carries meaning; a workspace name's does not. It is dropped WITH
                 its separator, and it costs nothing: the WORKSPACES strip at the
                 top of this same page carries it in full.
              2. the chip's `· when · note` tail — dropped WHOLE on its own
                 budget (DG-19), never ellipsised to a `· just…` fragment.
              3. `Open board →` gives up its WORDS whole, degrading to its pinned
                 `→` with the label in `title` — so the affordance is never
                 invisible and never a mangled prefix.
              4. the chip's `→ <target>` — clause 5's protected fact, which never
                 gives way while anything above it still can.

              Each step is a DISCRETE budgeted drop, not a shrink factor. That is
              DG-19's real lesson, and it was measured rather than reasoned: with
              a 1000:1 shrink ratio the drill-in still yielded only 13.1px while
              the chip — weighted 1 — yielded 17.5, so the target truncated
              anyway. Flexbox distributes a squeeze; it cannot express "this
              element goes away so that one can be whole". The shrink factors
              remain underneath as a backstop, but they are no longer the rule.

              DG-22: and the leading group stays LEFT. When the name is dropped
              the row's free space would otherwise sit in front of the chip under
              `justify-end`, so the footer's leading edge — the column the eye
              scans for "what state is this card in" — drifted card to card for a
              reason the reader cannot see. Only the drill-in is right-aligned. */}
        <div className="mt-4 flex min-w-0 items-center justify-between gap-3 border-t border-border pt-3 text-xs">
          {/* The gate is FIT, not chip-presence (DG-20). Gating on `attention`
              would drop the name permanently — the cluster is truthy on an idle
              card too — and gating on the CHIP alone makes absence-of-name an
              accidental second signal for "this card has an assignment", which
              the chip already states. So the chip is only what applies the
              PRESSURE; the budget below is what decides. A name that still fits
              beside the chip keeps rendering (`aof` does); one that cannot is
              dropped WHOLE, with its separator — never stubbed to `l…`.

              It is `shrink-0`, NOT `flex-1`: `flex-1` carries `flex-grow:1`, so
              a KEPT name expanded into the row's free space and squeezed the
              cluster until the chip's target truncated — the name outranking the
              target, which is c5 backwards. It no longer needs to grow or shrink,
              because the fit budget above already guarantees it is short. */}
          {nameDropped ? null : (
            <span className="mono shrink-0 text-muted-foreground" title={workspaceName}>{workspaceName}</span>
          )}
          <span className={`flex min-w-0 flex-1 items-center gap-3 ${nameDropped ? "justify-between" : "justify-end"}`}>
            {attention}
            {/* An EXPLICIT floor, sized to the arrow — the picker-floor idiom
                (DG-13 c2) applied one element to the right, and the only shape
                that satisfies DG-19 in both directions. `min-w-0` alone let this
                box shrink to ZERO while its own pinned `→` overflowed it and sat
                OUTSIDE the card's content box (the shrink-0-inside-min-w-0 shape
                that caused DG-15). Removing `min-w-0` fixed the escape and
                created the opposite defect: `min-width:auto` resolved to this
                box's FULL content width, so it never yielded at all and the
                chip's target truncated instead — measured, not reasoned:
                78.7px wide with a 78.8px automatic minimum. An explicit
                `min-w-3.5` (14px ≈ the arrow's 13.7px) permits the shrink AND
                bounds it, so the words give way, the arrow always has its own
                room, and nothing leaves the card. */}
            <span
              className="flex min-w-3.5 shrink-1000 items-baseline font-semibold text-primary group-hover:underline"
              title={opening ? "Opening board..." : openError ? "Open failed" : "Open board"}
            >
              {abbreviateDrillIn && !opening && !openError ? null : (
                <span className="min-w-0 truncate">{opening ? "Opening board..." : openError ? "Open failed" : "Open board"}</span>
              )}
              {/* `whitespace-pre` keeps the separating space: a flex item's own
                  leading whitespace is otherwise collapsed, and the label would
                  read `Open board→`. The space is part of the label's identity,
                  not decoration. */}
              {opening || openError ? null : <span className="shrink-0 whitespace-pre">{" →"}</span>}
            </span>
          </span>
        </div>
      </button>

      {/* milestone 38 / story 04 — ADR-012 AMENDMENT (BLOCKER F21): the
          affordance is handed the ITEM's OWN workspaceId, the SAME value the
          drill-in button above already passes to fleetApi.boardUrl. This face is
          GLOBAL — every card on it may belong to a different workspace — so an
          assign that did not carry it resolved the ref against the DAEMON's own
          workspace and, on a ref collision, dispatched a completely different
          milestone off a `200 ok`. */}
      <AssignAffordance ref={m.item.ref} workspaceId={m.item.workspaceId} nodes={nodes} onAssigned={onAssigned} />

      {/* milestone 38 / story 06 / task 04 (BLOCKER F-38.06c; ADR-013 + ADR-014,
          DESIGN §Surface 3) — the READ-ONLY terminal-VIEW for THIS card's
          assignment. A sibling of the drill-in button (never nested inside it: a
          terminal is interactive chrome and an HTML <button> may not contain
          another interactive element). The component itself renders NOTHING when
          the assignment carries no resolvable (nodeId, sessionId) tuple — an
          assignment whose worker has not captured a session yet shows no terminal
          and opens no socket (ADR-014 invariant 4). */}
      {assignment ? <FleetTerminalView assignment={assignment} itemRef={m.item.ref} /> : null}
    </div>
  );
}

// The "assign to node" affordance (milestone 38 / story 04; ARCHITECTURE
// ADR-012 + its 2026-07-24 AMENDMENT; DESIGN §Surface 2 A1–A11) — a worker-node
// picker, PRODUCER-FED from the SAME real roster the node panel renders
// (`assignableNodeOptions`, ./scope.mjs), and the "Assign" action, which POSTs
// the ONE fleet-face mutation route (`fleetApi.assign`). Empty roster ⇒ the
// picker is disabled (there is nothing to assign to yet) — never an invented
// placeholder target. A gate refusal (unknown/ineligible node, already-active
// item, …) surfaces as an inline `destructive` error, coded by the verb
// (ADR-012 inv.3) — this affordance re-implements no arbitration of its own.
//
// F21 (BLOCKER, live soak 2026-07-24): the POST carries the ITEM's OWN
// `workspaceId` — this face is GLOBAL, so without it the route resolved every
// ref against the daemon's own workspace and mis-dispatched.
//
// F22 (live soak 2026-07-24; DESIGN §Surface 2 Amendment): a `200 ok` used to
// produce NO transition, NO indicator and NO chip — the operator only knew it
// had worked by reading the raw API response. Both halves of the designer's
// answer are built here, and BOTH live in ./assign-affordance.mjs so they are
// exercisable without a React harness:
//   (a) on success the surface fires EXACTLY ONE additional SILENT re-load
//       (`onAssigned`, wired in <Fleet> to `load(scope, { silent:true })`), so
//       region 5's m35 `assigned` chip lands within a round trip;
//   (b) the SAME button reads `Sent` — `muted`, disabled, the `primary` tint
//       DROPPED, the picker frozen on the chosen node — held for exactly one
//       poll interval, then decaying to the terminal resting state with nothing
//       left over. It reports the CALL; region 5 reports the ASSIGNMENT.
// This component holds NO transition logic of its own: every rendered fact
// comes from `assignAffordanceView` and the click is `runAssign`.
function AssignAffordance({ ref, workspaceId, nodes, onAssigned }: { ref: string; workspaceId: string; nodes: GlobalNode[]; onAssigned: () => void }) {
  const options = assignableNodeOptions(nodes);
  const [selected, setSelected] = useState(options[0] ?? "");
  const [ack, setAck] = useState<AssignAffordanceState>(assignAtRest);
  // VERIFICATION (UI phase selection, 2026-07-25) — the lifecycle command the worker
  // runs (refine → continue → verify), a NET-NEW control that lives OUTSIDE the assign
  // row's fitness-locked `picker · action · message` geometry (DG-13): the node picker's
  // parent row must stay exactly `select · button`, so the phase select is its own row
  // above the divider. Defaults to `refine` (the pre-existing dispatch default), so an
  // operator who ignores it gets byte-identical behaviour; `continue`/`verify` are the
  // opt-in phases for an already-refined item.
  const [lifecyclePhase, setLifecyclePhase] = useState<"refine" | "continue" | "verify">("refine");
  // REVIEW FIX QA-a (2026-07-24) — F21's defect class, relocated to the NODE
  // axis: the row must never NAME one target and POST another. This face is a
  // long-lived monitor that re-polls every POLL_MS, so the roster under the
  // picker CHANGES while the row is mounted (a node's registry descriptor stops
  // resolving and `queryGlobalRegistry` drops it from the roster, while
  // `assignWork`'s node-known gate reads `global_nodes` DIRECTLY — so a node can
  // leave the picker and stay assign-eligible). Remembered state alone went
  // stale: the <select>'s DOM value coerces to the first surviving option while
  // React state kept the departed id, so the operator read one name and the POST
  // carried another — and `Sent` then sat beside the WRONG name.
  //
  // So the target is DERIVED, not remembered: `selected` is the operator's
  // preference and `target` is the only value this component renders OR sends.
  // One value cannot disagree with itself.
  const target = options.includes(selected) ? selected : (options[0] ?? "");
  const view = assignAffordanceView({ phase: ack.phase, error: ack.error, detail: ack.detail, hasOptions: options.length > 0, selected: target });

  // A7 — the acknowledgment is held for `view.holdMs` (exactly one poll
  // interval) and then DECAYS to rest: picker enabled, the same node still
  // selected, `Assign →` back in its `primary` tint, message slot empty.
  // Nothing persists. A view with `holdMs === null` schedules nothing, which is
  // what makes "no hold on a refusal" structural rather than remembered.
  const holdMs = view.holdMs;
  useEffect(() => {
    if (holdMs == null) return;
    const timer = setTimeout(() => setAck(assignAckExpired), holdMs);
    return () => clearTimeout(timer);
  }, [holdMs, ack.phase]);

  const onAssign = useCallback(
    async (event: React.MouseEvent) => {
      event.stopPropagation();
      if (!target) return;
      await runAssign(
        // REVIEW FIX F-F — bound to its own object rather than handed over
        // unbound: `fleetApi.assign` is safe standalone today only because its
        // body happens to touch no `this`, which is a property of the current
        // implementation, not of the seam.
        { assign: fleetApi.assign.bind(fleetApi), onAssigned, onState: setAck },
        // QA-a — the SAME derived value the row renders. The name the operator
        // reads and the id the route receives are one datum. `phase` is the
        // operator-chosen lifecycle command (VERIFICATION 2026-07-25).
        { ref, nodeId: target, workspaceId, phase: lifecyclePhase }
      );
    },
    [ref, workspaceId, target, onAssigned, lifecyclePhase]
  );

  return (
    <div className="min-w-0" onClick={(event) => event.stopPropagation()}>
      {/* VERIFICATION (UI phase selection, 2026-07-25) — the "what to run" control,
          its OWN row ABOVE the assign divider so the fitness-locked assign row below
          stays exactly `select · button (· message)` (DG-13; the geometry test asserts
          rowChildTypes). Its aria-label deliberately does NOT start with "Assign " so
          the fleet harness never mistakes it for a node picker. Disabled while a
          dispatch is in flight, mirroring the node picker. */}
      <div className="mt-3 flex items-center gap-2 text-xs">
        <span className="shrink-0 text-muted-foreground">Run</span>
        <select
          aria-label={`Lifecycle phase to run on ${ref}`}
          value={lifecyclePhase}
          disabled={view.pickerDisabled}
          onChange={(event) => setLifecyclePhase(event.target.value as "refine" | "continue" | "verify")}
          className="mono rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground disabled:opacity-50"
        >
          <option value="refine">Refine — break down / author contracts</option>
          <option value="continue">Continue — build tasks to green + review</option>
          <option value="verify">Verify — checks + accept</option>
        </select>
      </div>
      {/* The assign row — GEOMETRY-LOCKED (DG-13). Its class list and its exact
          `select · button (· message)` membership are asserted by
          test/fleet-assign-row-geometry.test.mjs; do not add elements here. */}
      <div className="mt-3 flex min-w-0 items-center gap-2 border-t border-border pt-3 text-xs">
      {/* DG-13 clause 2 (DESIGN §Surface 2 Amendment 2026-07-24 (b)) — the
          picker has a FLOOR and never yields to the message. The real-assign
          render caught `min-w-0` letting it collapse to a BARE CHEVRON (~26px,
          down from ~284px) in the refused frame, so the operator could not see
          which node was selected at the exact moment they had to re-aim. The
          floor is the helper's (≥14ch of the node id PLUS the select's own
          chrome) and is phase-independent: no state can shrink it. */}
      <select
        aria-label={`Assign ${ref} to a worker node`}
        value={target}
        disabled={view.pickerDisabled}
        onChange={(event) => setSelected(event.target.value)}
        style={{ minWidth: view.pickerMinWidth }}
        className="mono flex-1 truncate rounded-md border border-border bg-muted px-2 py-1 text-[11px] text-muted-foreground disabled:opacity-50"
      >
        {view.pickerPlaceholder ? (
          <option value="">{view.pickerPlaceholder}</option>
        ) : (
          options.map((nodeId) => (
            <option key={nodeId} value={nodeId}>
              {nodeId}
            </option>
          ))
        )}
      </select>
      {/* A9/A10 — the `muted` acknowledgment DROPS the low-emphasis `primary`
          tint rather than adding anything to it (the quietest state the row ever
          renders): same box, same padding, same type, same height — only the
          label and the tint change. No mark, no glyph, no toast, no motion.

          DG-13 clause 1 — and the same WIDTH. The render caught the action
          narrowing 67px -> 44px on the `Sent` label swap, with the picker
          absorbing the difference, so the row reflowed on every state change.
          The inner span reserves the helper's constant width (sized to the
          longest label the action ever reads, `Assigning…`) in EVERY state
          including disabled, so a label swap can no longer move anything. It is
          a sizing shell, not a second element in the row: the row's children
          are still picker · action · message. */}
      <button
        type="button"
        disabled={view.actionDisabled}
        onClick={onAssign}
        className={
          view.actionTone === "muted"
            ? "shrink-0 rounded-md border border-border bg-muted px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition disabled:cursor-not-allowed"
            : "shrink-0 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition hover:bg-primary/20 disabled:cursor-not-allowed disabled:opacity-50"
        }
      >
        <span className="block whitespace-nowrap text-center" style={{ width: view.actionWidth }}>{view.actionLabel}</span>
      </button>
      {/* DG-13 clause 3 — the message slot is the element that YIELDS: it takes
          what is left, truncates, and carries the full server text in its native
          `title` (the idiom DG-10 already uses for the session id). What it
          RENDERS is the shaped, outcome-first copy (clause 4) — `already
          assigned → <holder>`, not the sentence that spends its width on the ref
          region 1 already shows. */}
      {view.message ? <span className="mono min-w-0 shrink truncate text-[10.5px] text-destructive" title={view.messageTitle ?? view.message}>{view.message}</span> : null}
      </div>
    </div>
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
  // DG-19's substance: the tail is BUDGETED, not truncated. A squeeze (however
  // lopsided the shrink factors) cannot express a terminal drop — it left the
  // LOWEST-priority element alive as `· just…` while the drill-in's words, ranked
  // above it, rendered zero glyphs. When the whole slot does not fit, the tail
  // goes WHOLE and the target keeps the room; the `title` still carries all of it.
  const tailText = `${at ? ` · ${relativeTime(at)}` : ""}${chip.note ? ` · ${chip.note}` : ""}`;
  const slotFits = `→ ${assignment.targetNodeId}${tailText}`.length <= REGION5_CHIP_SLOT_BUDGET_CH;
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
          instead of displacing or clipping the drill-in.

          DG-13 clause 5 (Amendment 2026-07-24 (b)) splits that ONE slot in two,
          because "truncates here" was truncating the wrong half: the judged
          render showed `→ umairs-m…` in every frame carrying a chip. The
          `→ <target>` half is what the chip EXISTS to say and never truncates;
          the `· <when> · <note>` tail is "all else" and is the half that yields.
          `whitespace-pre` (rather than `truncate`'s `nowrap`) keeps the tail's
          leading separator space, so the rendered text is byte-identical to the
          single-slot version. The full string stays in the `title` on the
          wrapper, so nothing is lost when the tail is cut.

          DG-15 (2026-07-24 re-render) — the target half was `shrink-0` inside a
          `min-w-0` wrapper with nothing clipping it, so a 30-character node id
          OVERFLOWED the wrapper and PAINTED OVER the sibling `Open board →`:
          the id's trailing glyph and the action's leading glyph occupied the
          same pixels, destroying BOTH. Clause 5 outranks `Open board →` — but it
          expresses that as a YIELD order, never a paint order. The target now
          shrinks (factor 1) only after `Open board →` (factor 999) and the tail
          (factor 9999) are exhausted, and when it finally must, it truncates
          INSIDE its own box. The whole string is still in the wrapper's
          `title`. */}
      <span className="mono flex min-w-0 items-center text-[11px] text-muted-foreground" title={`→ ${assignment.targetNodeId}${at ? ` · ${relativeTime(at)}` : ""}${chip.note ? ` · ${chip.note}` : ""}`}>
        <span className="min-w-0 shrink truncate whitespace-pre">→ {assignment.targetNodeId}</span>
        {slotFits && tailText ? (
          <span className="min-w-0 shrink-1000000 overflow-hidden text-ellipsis whitespace-pre">{tailText}</span>
        ) : null}
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
