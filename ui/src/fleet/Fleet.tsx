import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PlusCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fleetApi } from "./api";
import type { FleetBoard, FleetNode, RunState, MeshStatus } from "./api";
import { runStateChip, relativeTime, refreshedLabel } from "../board/runs.mjs";

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

// The client poll cadence (DESIGN default / PRD §7.3): visibility is poll /
// relay-presence, NEVER a push event stream — the client opens no WebSocket / SSE.
const POLL_MS = 5000;
// The freshness-label tick — advances the "refreshed Ns ago" age without a re-poll.
const CLOCK_MS = 1000;

export function Fleet() {
  const [status, setStatus] = useState<MeshStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
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
  // (the freshness label stops advancing), never the page-error.
  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const next = await fleetApi.status();
      setStatus(next);
      setFetchedAt(Date.now());
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll-only freshness (NO WebSocket, NO SSE): a silent re-poll on the cadence
  // keeps the view current within the m23 presence bound + one poll.
  useEffect(() => {
    const poll = setInterval(() => void load({ silent: true }), POLL_MS);
    return () => clearInterval(poll);
  }, [load]);

  useEffect(() => {
    const clock = setInterval(() => setNowMs(Date.now()), CLOCK_MS);
    return () => clearInterval(clock);
  }, []);

  const nowIso = useMemo(() => new Date(nowMs).toISOString(), [nowMs]);
  const nodes = status?.nodes ?? [];
  const boards = status?.boards ?? [];

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <TopBar
        group={groupName}
        fetchedAt={fetchedAt}
        nowIso={nowIso}
        onRefresh={() => void load({ silent: true })}
      />

      {loading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState message={error} onRetry={() => void load()} />
      ) : nodes.length === 0 ? (
        // empty fleet (no roster) — a centered dashed placeholder, NOT an error.
        <EmptyFleet />
      ) : (
        // populated — the two card grids. A stale node RENDERS (degraded liveness,
        // never dropped); a nodes-but-no-boards fleet shows the Boards dashed
        // placeholder, never an error.
        <main className="flex-1 px-8 py-7">
          <div className="mx-auto flex w-full max-w-[1240px] flex-col gap-8">
            <NodesRegion nodes={nodes} />
            <BoardsRegion boards={boards} nodes={nodes} isControlNode={status?.isControlNode === true} />
          </div>
        </main>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────── top bar ──────────

function TopBar({
  group,
  fetchedAt,
  nowIso,
  onRefresh,
}: {
  group: string;
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
      <span className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
        <Legend />
        {/* ⟳ refresh — click re-polls in place (non-tearing, keep-last-good on a
            failed silent poll). NO push/stream chrome. It both shows freshness AND
            triggers a manual re-poll. */}
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

// The three-ramp legend (◷ legend) — the reader's key to node-liveness vs
// run-state (never confused; item-status is one level down, not here).
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
        <span className="block space-y-0.5">
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-primary" /> running</span>
          <span className="flex items-center gap-1.5"><span className="inline-block h-2 w-2 rounded-full bg-destructive" /> failed</span>
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
  const runs = node.presence?.activeRuns?.length ?? 0;
  const runtimes = node.runtimes ?? [];
  const skills = node.skills ?? [];
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
      {/* row 3: what it's running — the activeRuns count (0 → idle) */}
      <p className={`mt-2 text-[13px] ${runs > 0 ? "font-semibold text-primary" : "text-muted-foreground"}`}>
        {runs === 0 ? "idle" : `running ${runs} ${plural(runs, "run")}`}
      </p>
      {/* row 4: the quiet capability footer — runtimes + N skills */}
      <p className="mono mt-3 truncate border-t border-border pt-2.5 text-[10.5px] text-muted-foreground">
        {runtimes.length ? `${runtimes.join(", ")} · ${skills.length} ${plural(skills.length, "skill")}` : "not enrolled · no skills"}
      </p>
    </div>
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

function BoardsRegion({ boards, nodes, isControlNode }: { boards: FleetBoard[]; nodes: FleetNode[]; isControlNode: boolean }) {
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
            <BoardTile key={board.ref} board={board} nodes={nodes} isControlNode={isControlNode} />
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

function BoardTile({ board, nodes, isControlNode }: { board: FleetBoard; nodes: FleetNode[]; isControlNode: boolean }) {
  const state = boardRunState(board);
  return (
    // The TILE CARD is the picker's positioning context (review fix — the open
    // popover is anchored to the TILE, not the trigger button): `relative` here,
    // unchanged from before, is what `AssignPicker`'s `absolute` now targets.
    <div className="relative flex flex-col gap-3.5 rounded-lg border border-border bg-card px-4 py-3.5 shadow-sm transition hover:border-muted-foreground/40 hover:shadow-md">
      {/* row 1: board name over its quiet "on <nodeId>" owner (stacked) */}
      <div className="flex flex-col gap-1">
        <span className="mono truncate text-[15px] font-semibold tracking-tight text-foreground">{board.ref}</span>
        {board.owner ? (
          <span className="mono text-[11px] text-muted-foreground">on {board.owner}</span>
        ) : null}
      </div>
      {/* row 2: the m21 run-state chip (verbatim) · the [⊕ assign] write control
          (milestone 27 / story 02, ADR-006 — the FIRST write affordance on this
          surface, control-node-gated TRUE ABSENCE, DESIGN default 3) · the Open
          board → drill-in */}
      <div className="flex items-center gap-2">
        {state === null ? (
          <span className="text-xs font-medium text-muted-foreground">No runs yet</span>
        ) : (
          <RunStateChip state={state} />
        )}
        {isControlNode ? <AssignAffordance board={board} nodes={nodes} /> : null}
        <BoardDrillIn board={board} />
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────── the [assign ▸] affordance ─

// milestone 27 / story 02 (ADR-006 / DESIGN "the issue / assign affordance") —
// the FIRST write control on the fleet face. Rendered IFF isControlNode is true
// (a genuine conditional omission at the CALL SITE above — never a disabled
// attribute here; DESIGN default 3's true-absence mandate). Six states: idle ·
// (gated-hidden lives at the call site) · open/picking-target · submitting ·
// success · error.
type AssignPhase = "idle" | "open" | "submitting" | "success" | "error";

function AssignAffordance({ board, nodes }: { board: FleetBoard; nodes: FleetNode[] }) {
  const [phase, setPhase] = useState<AssignPhase>("idle");
  const [target, setTarget] = useState<string>(""); // "" = Any node (the untargeted default)
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const open = phase === "open" || phase === "submitting" || phase === "error";

  const close = useCallback(() => {
    setPhase("idle");
    setTarget("");
    setErrorMessage(null);
  }, []);

  // Escape / click-away dismisses with NO write (DESIGN: "the read-only default
  // is always one keystroke away" — the picker only STAGES, Issue COMMITS).
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) close();
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onPointerDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [open, close]);

  const onIssue = useCallback(async () => {
    setPhase("submitting");
    setErrorMessage(null);
    try {
      const to = target.trim() === "" ? undefined : target.trim();
      await fleetApi.issue(board.ref, to);
      setPhase("success");
      // A quiet, calm confirmation — then back to idle (DESIGN: not a loud
      // toast/banner; a brief tile-scoped micro-acknowledgement).
      setTimeout(() => setPhase((p) => (p === "success" ? "idle" : p)), 1800);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Could not issue.");
      setPhase("error");
    }
  }, [board.ref, target]);

  // review fix: `containerRef` now wraps the TRIGGER AND the picker together
  // (a plain Fragment-scoped span, not `relative` itself — the tile card one
  // level up is the positioning context the picker anchors to). Click-away
  // detection still works identically (a click inside the relocated picker is
  // still "inside" this ref); only WHERE the picker paints moved.
  return (
    <span ref={containerRef} className="contents">
      <span className="relative inline-flex">
        {/* the idle trigger — a quiet, small primary/teal button; NEVER disabled/
            greyed on a non-control node (the gate is a true absence one level up) */}
        <Button
          type="button"
          size="sm"
          variant="default"
          onClick={() => setPhase("open")}
          aria-label={`Issue work into ${board.ref}`}
          className="gap-1.5 px-2.5"
        >
          <PlusCircle className="h-3.5 w-3.5" aria-hidden="true" />
          assign
        </Button>

        {phase === "success" ? (
          <span className="absolute left-0 top-full z-20 mt-1.5 whitespace-nowrap rounded-md border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            issued ✓ — an eligible node will pick it up
          </span>
        ) : null}
      </span>

      {open ? (
        <AssignPicker
          board={board}
          nodes={nodes}
          target={target}
          onTargetChange={setTarget}
          submitting={phase === "submitting"}
          errorMessage={phase === "error" ? errorMessage : null}
          onCancel={close}
          onIssue={onIssue}
        />
      ) : null}
    </span>
  );
}

// The target picker — a small anchored popover using EXISTING kit primitives
// (a bordered/shadowed `bg-popover` panel, the same idiom the top bar's Legend
// already uses — DESIGN: "NOT a full modal, no page dim"). ONE grouped picker:
// Any node (default) · Nodes (nodeId + liveness dot, from status.nodes) ·
// Capabilities (the union of node.runtimes + node.skills) — populated from data
// already fetched, no new endpoint.
function AssignPicker({
  board,
  nodes,
  target,
  onTargetChange,
  submitting,
  errorMessage,
  onCancel,
  onIssue,
}: {
  board: FleetBoard;
  nodes: FleetNode[];
  target: string;
  onTargetChange: (value: string) => void;
  submitting: boolean;
  errorMessage: string | null;
  onCancel: () => void;
  onIssue: () => void;
}) {
  const capabilities = useMemo(() => {
    const set = new Set<string>();
    for (const node of nodes) {
      for (const runtime of node.runtimes ?? []) set.add(runtime);
      for (const skill of node.skills ?? []) set.add(skill);
    }
    return Array.from(set);
  }, [nodes]);

  return (
    <div
      role="dialog"
      aria-label={`Issue into ${board.ref}`}
      // Anchored to the TILE CARD (BoardTile's own `relative` root), NOT the
      // trigger button (review fix, round 2): the picker is `w-72` (288px) —
      // wider than the trigger's clearance to EITHER tile edge, so anchoring to
      // the TRIGGER always overflows one side or the other (left-0 bled into
      // the right neighbor tile; right-0 then clipped off the left viewport
      // edge on the leftmost tile). The TILE CARD is itself ~w-72 in the
      // auto-fill grid, so a `left-0 top-full` popover relative to the TILE
      // drops straight below, flush with the tile's own left edge — on-screen
      // for the leftmost tile, and never over a NEIGHBOUR tile (it only ever
      // extends as wide as its own tile, downward, never sideways into the
      // next column).
      className="absolute left-0 top-full z-30 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md"
    >
      <p className="mb-2 text-xs font-semibold text-foreground">Issue into {board.ref}</p>

      <div className="mb-2.5 flex flex-col gap-1 text-xs">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name={`assign-target-${board.ref}`}
            checked={target === ""}
            disabled={submitting}
            onChange={() => onTargetChange("")}
          />
          Any node <span className="text-muted-foreground">(default)</span>
        </label>
      </div>

      {nodes.length > 0 ? (
        <div className="mb-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Nodes</p>
          <div className="flex flex-col gap-1 text-xs">
            {nodes.map((node) => (
              <label key={node.nodeId} className="flex items-center gap-2">
                <input
                  type="radio"
                  name={`assign-target-${board.ref}`}
                  checked={target === node.nodeId}
                  disabled={submitting}
                  onChange={() => onTargetChange(node.nodeId)}
                />
                <PresenceDot liveness={livenessOf(node)} size="sm" />
                <span className="mono">{node.nodeId}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {capabilities.length > 0 ? (
        <div className="mb-2.5">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Capabilities</p>
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {capabilities.map((cap) => (
              <label key={cap} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name={`assign-target-${board.ref}`}
                  checked={target === cap}
                  disabled={submitting}
                  onChange={() => onTargetChange(cap)}
                />
                <span className="mono">{cap}</span>
              </label>
            ))}
          </div>
        </div>
      ) : null}

      {errorMessage ? (
        <div className="mb-2.5 flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] font-medium text-accent">
          <span className="grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-accent text-[9px] font-bold text-accent-foreground" aria-hidden="true">!</span>
          Could not issue: {errorMessage}
        </div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel} disabled={submitting}>
          Cancel
        </Button>
        {errorMessage ? (
          <Button type="button" size="sm" variant="default" onClick={onIssue} disabled={submitting}>
            Retry
          </Button>
        ) : (
          <Button type="button" size="sm" variant="default" onClick={onIssue} disabled={submitting}>
            {submitting ? "Issuing…" : "Issue ▸"}
          </Button>
        )}
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

function LoadingState() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <span className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-primary" aria-hidden="true" />
        Loading fleet…
      </div>
    </div>
  );
}

// A PAGE-level failure to reach the mesh (distinct from a stale node, which is
// normal rendered degradation) — an accent pill + Retry.
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-center gap-3 text-center">
        <div className="flex items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-4 py-2.5 text-sm font-medium text-accent">
          <span className="grid h-4.5 w-4.5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-accent-foreground" aria-hidden="true">!</span>
          Could not load the mesh: {message}
        </div>
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-4 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20"
        >
          ⟳ Retry
        </button>
      </div>
    </div>
  );
}

// Empty fleet (no roster) — a centered dashed placeholder, NOT an error (mirrors the
// CLI's "No nodes in the mesh roster."). Names the enrol path so a fresh install has
// a next step.
function EmptyFleet() {
  return (
    <div className="flex flex-1 items-center justify-center p-10">
      <div className="flex max-w-md flex-col items-center gap-4 rounded-xl border border-dashed border-border bg-card/50 px-8 py-9 text-center">
        <span className="grid h-11 w-11 place-items-center rounded-xl border-2 border-dashed border-muted-foreground/40 text-xl text-muted-foreground" aria-hidden="true">✦</span>
        <span className="text-[15px] font-semibold text-foreground">No nodes in the group yet</span>
        <span className="text-[12.5px] leading-relaxed text-muted-foreground">
          Enrol a machine to bring it onto the mesh — run one of these on the box you want to add:
        </span>
        <span className="flex w-full flex-col gap-2">
          <span className="mono rounded-md border border-border bg-muted px-3 py-2 text-left text-[11.5px] text-muted-foreground">aof mesh invite</span>
          <span className="mono rounded-md border border-border bg-muted px-3 py-2 text-left text-[11.5px] text-muted-foreground">aof mesh join</span>
        </span>
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
