import { useCallback, useEffect, useMemo, useState } from "react";
import { workApi } from "./api";
import type { WorkItem } from "./api";
import { deriveBoard, milestoneOfGate } from "./model";
import { primaryAction } from "./action.mjs";
import { Overview } from "./Overview";
import { BoardLanes } from "./BoardLanes";
import { DetailPanel } from "./DetailPanel";
import { TerminalDock } from "./TerminalDock";
import type { DockSession } from "./TerminalDock";
import { StatusRing, statusMeta, LANE_ORDER } from "./status";

// The two-level work board (DESIGN — two views in one screen). A slim top bar
// over either VIEW 1 (the "Work items" overview of milestone cards) or VIEW 2
// (the status-lane board for a focus = "all" | <milestoneRef>). A fixed detail
// column (selection-driven) and a collapsible terminal dock complete the screen.
// The data source is the flat /api/work/list contract (ADR-002) via api.ts.
type View = "overview" | "board";

// The lane-card in-flight-dot re-probe cadence (DESIGN documented-default 3 —
// observability is poll/refresh), matching the RUNS-tab poll so the active-run
// signal stays live everywhere it is surfaced.
const RUNNING_PROBE_MS = 5000;

export function Board() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [view, setView] = useState<View>("overview");
  const [focus, setFocus] = useState<"all" | string>("all");
  const [selectedRef, setSelectedRef] = useState<string | null>(() => hashRef());
  const [switchOpen, setSwitchOpen] = useState(false);
  // The terminal dock binds to its OWN session ref + command, tracked separately
  // from the live board selection: the dock stays on the session you launched
  // even as you click around the board (DESIGN — the dock is session-bound).
  const [dockOpen, setDockOpen] = useState(false);
  // ONE session descriptor (m42 item 6): local pty OR the fleet mirror — the
  // dock is the board's single terminal surface for both.
  const [dockSession, setDockSession] = useState<DockSession | null>(null);
  // Per-gate "waiting on" labels (DESIGN VIEW 1, preferred-if-cheap from /next).
  const [gateWaiting, setGateWaiting] = useState<Record<string, string[]>>({});
  // Refs with a live `running` run — drives the lane-card in-flight pulse dot
  // (DESIGN surface 2b). Probed read-only from /api/work/run-status, scoped to the
  // focused board so the active runs are visible from the board itself.
  const [runningRefs, setRunningRefs] = useState<Set<string>>(() => new Set());

  const load = useCallback(async ({ silent = false } = {}) => {
    // A SILENT refresh (the top-bar ⟳ sync) updates the stream IN PLACE — it must
    // NOT flip to the full-screen loading/error branch, because that unmounts the
    // board subtree (incl. the terminal dock) and would tear down a running
    // session. Only the initial load (and explicit Retry) shows the loading state.
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      setItems(await workApi.list());
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const derived = useMemo(() => deriveBoard(items), [items]);

  // If a hash deep-link (#03/02) selects a story, open its milestone's board.
  useEffect(() => {
    if (items.length === 0 || !selectedRef) return;
    const item = derived.byRef.get(selectedRef);
    if (!item) return;
    if (item.type === "story" && item.parent) {
      const ms = derived.milestones.find((m) => m.stories.some((s) => s.ref === selectedRef));
      if (ms) {
        setFocus(ms.num);
        setView("board");
      }
    } else if (item.type === "milestone") {
      setFocus(item.ref);
      setView("board");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items.length]);

  // Best-effort gate "waiting on": ask /api/work/next scoped to each gate's
  // accepted milestone; surface the returned waitingOn when blocked. Cheap and
  // read-only (next changes no files). Failures degrade to an omitted label.
  useEffect(() => {
    if (derived.uat.length === 0) return;
    let cancelled = false;
    (async () => {
      const out: Record<string, string[]> = {};
      for (const gate of derived.uat) {
        const ms = milestoneOfGate(derived, gate);
        const scope = ms ? ms.num : gate.ref;
        try {
          const next = await workApi.next(scope);
          if (next.state === "blocked" && Array.isArray(next.waitingOn) && next.waitingOn.length > 0) {
            out[gate.ref] = next.waitingOn;
          }
        } catch {
          /* omit on failure */
        }
      }
      if (!cancelled) setGateWaiting(out);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived.uat.map((u) => u.ref).join(",")]);

  // Lane-card in-flight dots (DESIGN surface 2b): probe run-status for the items
  // shown as lane cards in the current scope and collect those with a `running`
  // run. Read-only (run-status changes no files) and bounded to the focused
  // scope; failures degrade to an omitted dot (mirrors the gateWaiting loop). The
  // probe RE-POLLS on the observability cadence (DESIGN documented-default 3 —
  // observability is poll/refresh) so a run that starts/finishes lights/clears its
  // dot live, in parity with the RUNS-tab poll, with NO full board-list reload (the
  // read-mostly list stays sync-gated; only this active-run signal re-fetches).
  useEffect(() => {
    if (view !== "board") return;
    const refs =
      focus === "all"
        ? derived.milestones.map((m) => m.item.ref)
        : derived.milestones.find((m) => m.num === focus)?.stories.map((s) => s.ref) ?? [];
    if (refs.length === 0) {
      setRunningRefs(new Set());
      return;
    }
    let cancelled = false;
    const probe = async () => {
      const live = new Set<string>();
      await Promise.all(
        refs.map(async (ref) => {
          try {
            const { runs } = await workApi.runStatus(ref);
            if (runs.some((run) => run.state === "running")) live.add(ref);
          } catch {
            /* omit on failure */
          }
        })
      );
      if (!cancelled) setRunningRefs(live);
    };
    void probe();
    const poll = setInterval(() => void probe(), RUNNING_PROBE_MS);
    return () => {
      cancelled = true;
      clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, focus, items]);

  // While ANY item is executing (a mesh assignment is active, or a local run is
  // live), the list itself re-fetches silently on the same observability cadence.
  // The execution overlay — node, state, and the SESSION ID the "View terminal"
  // mirror needs — rides /api/work/list, so a sync-gated list froze the primary
  // action at page-load state: a session captured seconds after dispatch never
  // reached an open board, and the operator had to hard-refresh to be OFFERED the
  // terminal (measured live, 2026-07-27). A quiet board stays sync-gated — this
  // poll arms only while work is genuinely in flight, and load({silent}) updates
  // in place (never the loading branch, so the dock is never torn down).
  useEffect(() => {
    const executing = items.some((item) => item.execution?.active === true) || runningRefs.size > 0;
    if (!executing) return;
    const poll = setInterval(() => void load({ silent: true }), RUNNING_PROBE_MS);
    return () => clearInterval(poll);
  }, [items, runningRefs, load]);

  const selectedItem = useMemo(
    () => items.find((item) => item.ref === selectedRef) ?? null,
    [items, selectedRef]
  );

  // The state-aware primary action for the selected item. `hasBreakdown` is true
  // for a milestone with >= 1 story (else Refine first); non-milestones default
  // to a breakdown (aof:continue itself redirects to refine when a contract is
  // thin). `liveForRef` is true when the dock is open and bound to this ref.
  const selectedAction = useMemo(() => {
    if (!selectedItem) return null;
    const hasBreakdown =
      selectedItem.type === "milestone"
        ? (derived.milestones.find((m) => m.num === selectedItem.ref)?.stories.length ?? 0) > 0
        : true;
    const liveForRef = dockOpen && dockSession?.ref === selectedItem.ref;
    return primaryAction(selectedItem, { hasBreakdown, liveForRef });
  }, [selectedItem, derived, dockOpen, dockSession]);

  const select = useCallback((ref: string) => {
    setSelectedRef(ref);
    if (typeof window !== "undefined") window.location.hash = ref;
  }, []);

  // Launch (or re-launch) a session: bind the dock to this ref + the state-aware
  // command (typed as ordinary input on connect), open the dock, and select the
  // item. A null command spawns the interactive agent (ad-hoc).
  const runAgent = useCallback(
    (ref: string, command?: string) => {
      setDockSession({ kind: "local", ref, command: command ?? null });
      setDockOpen(true);
      select(ref);
    },
    [select]
  );

  // CONTINUE — the one action that must NOT decide for itself where it runs
  // (2026-07-26). It asks the server: the node that last worked on this item, or here
  // when nothing ever has. `local` opens the dock exactly as before; `remote` opens NO
  // local session — it dispatched to a worker, so the board just refreshes and the row
  // reports "running on <node>". Clicking Continue on a milestone a worker owns can no
  // longer start a rival run against this machine's checkout.
  const [dispatch, setDispatch] = useState<{ ref: string; message: string; error: boolean } | null>(null);
  const continueWork = useCallback(
    async (ref: string, phase: "continue" | "refine" | "verify" = "continue") => {
      select(ref);
      setDispatch(null);
      try {
        // m42 wave (b) — one door per act: refine/verify ride the same envelope.
        const result = await workApi.dispatchPhase(phase, { ref });
        if (result.where === "local") {
          runAgent(ref, result.command ?? `/aof:${phase} ${ref}`);
          return;
        }
        // "running": the ref (or its milestone scope) already has an active run —
        // nothing was spawned or minted; say where it is instead of racing it.
        setDispatch({
          ref,
          message: result.where === "running"
            ? `Already running on ${result.node ?? "a worker"}`
            : `${phase === "continue" ? "Continuing" : phase === "refine" ? "Refining" : "Verifying"} on ${result.node}`,
          error: false,
        });
        await load({ silent: true });
      } catch (error) {
        // Surfaced, never swallowed: a refused continue (already running, node
        // unreachable, repo unavailable) must say so — silence here reads as "nothing
        // happened" when something was actively refused.
        setDispatch({ ref, message: error instanceof Error ? error.message : String(error), error: true });
      }
    },
    [load, runAgent, select]
  );

  // Re-reveal the existing session's dock (no re-launch) — the "View terminal"
  // action when a live session is already bound to the selected item.
  const viewTerminal = useCallback(() => {
    setDockOpen(true);
  }, []);

  // Open the dock as the READ-ONLY MIRROR of a worker's live session (m42 item 6:
  // one terminal surface — a remote session is a SOURCE of the dock).
  const openMirror = useCallback(
    (ref: string, nodeId: string, sessionId: string) => {
      setDockSession({ kind: "remote", ref, nodeId, sessionId });
      setDockOpen(true);
      select(ref);
    },
    [select]
  );

  const openMilestone = useCallback(
    (ref: string) => {
      setFocus(ref);
      setView("board");
      // Default-select the MILESTONE itself, so the detail panel shows the
      // milestone's status + its SPEC/VERIFICATION/RETROSPECTIVE/Findings by
      // default. Clicking a story card then switches the panel to that story's
      // view (its user story + tasks). (DESIGN §2 — milestone-default.)
      select(ref);
    },
    [select]
  );

  // Clicking empty lane area deselects the story → back to the milestone view
  // (select the focused milestone). With focus = "all" there is no single
  // milestone, so clear the selection (panel shows the "select an item" prompt).
  const deselect = useCallback(() => {
    if (focus !== "all") {
      select(focus);
    } else {
      setSelectedRef(null);
      if (typeof window !== "undefined") window.location.hash = "";
    }
  }, [focus, select]);

  const openGate = useCallback(
    (gate: WorkItem) => {
      const ms = milestoneOfGate(derived, gate);
      if (ms) {
        setFocus(ms.num);
        setView("board");
      }
      select(gate.ref);
    },
    [derived, select]
  );

  return (
    <main className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <span className="flex items-center gap-2">
          <span className="text-lg text-primary" aria-hidden="true">
            ✦
          </span>
          <span className="text-sm font-bold">aof</span>
          <span className="text-sm text-muted-foreground">Work Board</span>
        </span>
        <span className="ml-auto flex items-center gap-4 text-xs text-muted-foreground">
          <StatusLegend />
          <button
            type="button"
            onClick={() => void load({ silent: true })}
            className="transition hover:text-foreground"
            aria-label="Sync work stream"
          >
            ⟳ sync
          </button>
        </span>
      </header>

      {loading ? (
        <div className="mono p-6 text-sm text-muted-foreground">Loading work stream...</div>
      ) : error ? (
        <div className="space-y-3 p-6">
          <p className="text-sm text-accent">Could not load the work stream: {error}</p>
          <button
            type="button"
            onClick={() => void load()}
            className="rounded-md border border-border bg-card px-3 py-1.5 text-sm transition hover:border-primary/50"
          >
            Retry
          </button>
        </div>
      ) : items.length === 0 ? (
        <div className="m-6 rounded-md border border-dashed border-border p-6 text-sm text-muted-foreground">
          No work items yet — run <span className="mono">aof work init</span> to seed the stream.
        </div>
      ) : view === "overview" ? (
        // Overview is its own full-width screen — no detail column, no dock.
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <Overview
            derived={derived}
            gateWaiting={gateWaiting}
            onOpenMilestone={openMilestone}
            onOpenGate={openGate}
          />
        </div>
      ) : (
        // Board view: lanes + the selection-driven detail column. The terminal
        // dock is rendered OUTSIDE this conditional (below) so it never unmounts.
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_382px]">
            <div className="min-h-0 overflow-hidden">
              <BoardLanes
                derived={derived}
                focus={focus}
                selectedRef={selectedRef}
                runningRefs={runningRefs}
                switchOpen={switchOpen}
                onToggleSwitch={() => setSwitchOpen((v) => !v)}
                onCloseSwitch={() => setSwitchOpen(false)}
                onSetFocus={(f) => {
                  setFocus(f);
                  setSwitchOpen(false);
                }}
                onSelect={select}
                onDeselect={deselect}
                onBackToOverview={() => {
                  setView("overview");
                  setSwitchOpen(false);
                }}
              />
            </div>
            <div className="min-h-0 overflow-hidden border-l border-border">
              <DetailPanel
                item={selectedItem}
                action={selectedAction}
                actor="you"
                onRunAgent={runAgent}
                onContinue={continueWork}
                onMirror={openMirror}
                onViewTerminal={viewTerminal}
                onRevealRef={select}
              />
            </div>
          </div>
      )}

      {/* The terminal dock is a PERSISTENT bottom dock — rendered OUTSIDE the
          loading/error/overview/board conditional so NOTHING in the board content
          (a stream sync, a view switch, the loading state, a re-render) can unmount
          it and tear down the running session. It only appears once Run agent has
          opened a session (dockOpen), and binds to its own dockRef. */}
      {/* Where a continue went. A REMOTE continue opens no terminal here, so without
          this the click would look like nothing happened — and a REFUSED one (already
          running, node unreachable) must say so out loud rather than vanish. */}
      {dispatch ? (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-50 max-w-md rounded-md border px-3 py-2 text-sm shadow-lg ${
            dispatch.error ? "border-accent bg-background text-accent" : "border-border bg-background text-foreground"
          }`}
        >
          <span className="mono text-xs text-muted-foreground">{dispatch.ref}</span>{" "}
          {dispatch.message}
          <button type="button" onClick={() => setDispatch(null)} className="ml-3 text-xs underline">
            dismiss
          </button>
        </div>
      ) : null}

      {dockOpen ? (
        <TerminalDock session={dockSession} onClose={() => setDockOpen(false)} />
      ) : null}
    </main>
  );
}

// A compact "◷ status legend" hover affordance in the top bar. Each row paints
// the REAL <StatusRing> shape (the same glyph-ring the cards show) next to its
// label, so the legend mirrors the painted ramp 1:1 — not a different vocabulary
// of inline text glyphs.
function StatusLegend() {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="transition hover:text-foreground" aria-label="Status legend">
        ◷ status legend
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-md border border-border bg-card p-2 shadow-lg">
          {LANE_ORDER.map((status) => (
            <p key={status} className="flex items-center gap-2 py-0.5 text-xs text-foreground">
              <StatusRing status={status} size={14} />
              <span>{statusMeta(status).short}</span>
            </p>
          ))}
        </div>
      ) : null}
    </span>
  );
}

function hashRef(): string | null {
  if (typeof window === "undefined") return null;
  const hash = window.location.hash.replace(/^#/, "").trim();
  return hash || null;
}
