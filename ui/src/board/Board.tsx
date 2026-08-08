import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { workApi } from "./api";
import type { WorkItem } from "./api";
import { deriveBoard, milestoneOfGate } from "./model";
import { primaryAction } from "./action.mjs";
import { freshness, isCachePublished, readCacheNodeId, readStalenessWindow } from "./freshness.mjs";
import type { Freshness, FreshnessRecord } from "./freshness.mjs";
import { FreshnessLegend } from "./StaleBadge";
import { Overview } from "./Overview";
import { BoardLanes } from "./BoardLanes";
import { DetailPanel } from "./DetailPanel";
import { TerminalDock } from "./TerminalDock";
// milestone 45 / story 03 — the shell's named regions. The board contributes its legend and
// sync to the surface slot, and its `serverGone` strip to the notice rail; with no shell
// present (the headless harness) both render exactly where they always did.
import { SurfaceNotice, SurfaceSlot } from "../app/SurfaceSlot";
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

// The COSMETIC CLOCK TICK (milestone 43 / DESIGN §"The threshold crossing";
// ADR-010 R4.4). THE board tree's ONE tick: the runs section used to keep a
// second interval at this same cadence and it is gone (ADR-015/F6 — "lifting a
// derivation a level means the lower one GOES"; it was also redundant, since
// `now` is state here and nothing below is memoised). `ui/src/fleet/Fleet.tsx`
// keeps its own and correctly so — it is a separate application ROOT, not a
// second home inside this tree.
const CLOCK_TICK_MS = 1000;

export function Board() {
  const [items, setItems] = useState<WorkItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The configured staleness window, straight off the list envelope (43/ADR-010
  // R4.1). It is NOT defaulted here and there is no literal anywhere in `ui/`:
  // when the wire does not carry it the surfaces degrade to words rather than
  // guess a number, because a guessed window would keep reading "5 minutes" long
  // after an operator configured 30 — a second threshold by another route.
  const [stalenessWindow, setStalenessWindow] = useState<number | null>(null);
  // WHICH MACHINE "here" is, off the same envelope — so a row this node itself
  // published reads `(this node)` rather than being silently un-attributed.
  // Under this milestone the control is simply one more writer into the cache,
  // so its rows are attributed like anyone else's. Null until the wire says.
  const [thisNode, setThisNode] = useState<string | null>(null);
  // Armed by a Resync waiting for a pushed copy (43/ADR-010 R4.3). See the poll
  // effect below: it is what turns "no answer" from a structural guarantee into
  // a measurement.
  const [resyncWatching, setResyncWatching] = useState(false);

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
  // 2026-07-27 (measured): the board server lives on an EPHEMERAL port and dies
  // with every daemon restart — an open tab then points at a dead port and every
  // action silently does nothing (the operator clicked Continue into the void).
  // Consecutive silent-load failures flip this; the banner says so honestly and
  // links the fleet (its port is FIXED), where a fresh board link lives.
  const [serverGone, setServerGone] = useState(false);
  const silentFailures = useRef(0);

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
      const envelope = await workApi.list();
      setItems(envelope.items);
      setStalenessWindow(readStalenessWindow(envelope));
      setThisNode(readCacheNodeId(envelope));
      silentFailures.current = 0;
      setServerGone(false);
    } catch (e) {
      if (silent) {
        silentFailures.current += 1;
        if (silentFailures.current >= 3) setServerGone(true);
      } else {
        setError(e instanceof Error ? e.message : "Failed to load");
      }
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // THE COSMETIC TICK, AT THE ITEM-SURFACE LEVEL (DESIGN §"The threshold
  // crossing"; 43/ADR-010 R4.4 — load-bearing, not a detail). Cache freshness is
  // judged against a LIVE clock, never against fetch time: the list only
  // re-polls while something is EXECUTING (below), so a SETTLED item — which is
  // the common case for a stale row, since it is stale precisely because its
  // owner stopped reporting — would otherwise never grow its badge until a
  // manual `⟳ sync`. The tick already existed inside the runs section and the
  // fleet; the lane, overview and header badges need it a level up, here — and
  // the runs section's own copy was DELETED rather than left beside it, which is
  // what "lift" means (ADR-015/F6). It re-renders and fetches NOTHING, so the
  // badge appears within one second of the crossing with no network activity.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => clearInterval(tick);
  }, []);

  // The ONE call site for the freshness ramp on this surface: every badge and
  // every provenance line on the board reads this, so one `now` and one window
  // serve them all. Null for a row the cache does not publish (a workspace that
  // is not mesh-enabled omits the provenance keys entirely) — such a board keeps
  // its plain local default with no freshness vocabulary at all.
  //
  // It takes any record carrying the two wire keys, not only a WorkItem, because
  // the ramp has TWO subjects: the ROW's freshness and each ARTIFACT's own — "a
  // doc can be older than the row that names it" (ADR-006). One predicate, two
  // subjects, one `now`, one window.
  const freshnessOf = useCallback(
    (record: FreshnessRecord | null | undefined): Freshness | null =>
      record && isCachePublished(record) ? freshness(record, { now, windowSeconds: stalenessWindow, thisNode }) : null,
    [now, stalenessWindow, thisNode]
  );

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

  // …and the SAME CADENCE, armed for the SAME reason, while a Resync is watching
  // for the copy it asked for (43/ADR-010 R4.3). It is the mirror image of the
  // rule above: the list is sync-gated on a quiet board, and a stale row is
  // stale precisely BECAUSE nothing is executing — so without this bounded poll
  // "no answer inside the watch window" would be guaranteed by construction
  // rather than measured, and the surface would be lying by shape. It disarms
  // with the window rather than becoming a second permanent poll.
  //
  // It is its OWN effect, and that is load-bearing rather than tidy. Folding it
  // into the clause above would put `runningRefs` in its dependency list, and
  // that set is REPLACED by every run-status probe — on the SAME 5s cadence — so
  // the poll's interval would be cleared and re-armed at the exact instant it was
  // due, and would never actually fire. (Measured, not reasoned: the watch window
  // elapsed with exactly one list request on the wire, the initial load.) The two
  // signals SHARE THE CADENCE, which is the m21/R2 rule; sharing the effect is
  // what breaks it.
  useEffect(() => {
    if (!resyncWatching) return;
    const poll = setInterval(() => void load({ silent: true }), RUNNING_PROBE_MS);
    return () => clearInterval(poll);
  }, [resyncWatching, load]);

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
        // A NETWORK-level failure on loopback means the board server itself is gone
        // (fetch rejects with TypeError) — raise the dead-server banner immediately
        // rather than waiting for the silent poll to notice (2026-07-27: the
        // operator clicked Continue into a dead port and saw "nothing").
        if (error instanceof TypeError) setServerGone(true);
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
    // milestone 45 / story 03 — the board is `content:fixed` (DESIGN §The shell's layout
    // primitives 2): descendants own scroll, never the region itself. `h-screen` was 100vh,
    // which under the shell overflows its box by exactly the chrome height; the published
    // primitive (ADR-005 contract point 7) is the honest replacement, and its `0px` fallback
    // keeps this identical when the surface is mounted with no shell. It is a `<div>` and no
    // longer the document's `<main>`: DESIGN §Accessibility 6 allows exactly one, and the shell
    // owns it.
    <div className="flex h-[calc(100dvh_-_var(--aof-shell-chrome-height,0px))] flex-col overflow-hidden bg-background text-foreground">
      {/* R1 — the notice rail. This strip is full-bleed and must sit ABOVE the chrome and push
          it down; the shell is the only thing that can guarantee that, so the board CONTRIBUTES
          it rather than painting it above a bar of its own. The strip itself is unchanged, down
          to its `role="alert"` and its sentence. With no shell present it renders exactly where
          it always did — first child of the board's root. */}
      {serverGone ? (
        <SurfaceNotice deps={[serverGone]} className="shrink-0">
          <div className="flex shrink-0 items-center gap-2 border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-xs text-destructive" role="alert">
            <span aria-hidden="true">⚠</span>
            <span>
              This board&apos;s server is gone (the daemon restarted — board ports are per-session). Buttons on this tab do
              nothing. Reopen the board from{" "}
              {/* m45/ADR-002 — the fleet's PATH. ABSOLUTE and hard-coded on purpose: a
                  board port is ephemeral and the fleet's is fixed at 4181, which is the
                  whole reason this banner can name it at all. No `scope`: this link never
                  carried one and the migration invents nothing. */}
              <a className="underline" href="http://127.0.0.1:4181/fleet">
                the fleet
              </a>
              .
            </span>
          </div>
        </SurfaceNotice>
      ) : null}
      {/* The board's own `<header>` is ABSORBED into the shell's bar (DESIGN §Accessibility 6:
          one banner; DG-45-1: one brand mark — the board's bare glyph becomes the shell's filled
          tile; and the wordmark loses its route word, because the nav names the route and a
          second word would say it twice). What survives is what is the BOARD's: its status
          legend and its ⟳ sync, contributed to the shell's right-anchored surface slot. */}
      <SurfaceSlot deps={[stalenessWindow, load]} className="flex items-center justify-end gap-4 px-4 py-2 text-xs text-muted-foreground">
        <StatusLegend windowSeconds={stalenessWindow} />
        <button
          type="button"
          onClick={() => void load({ silent: true })}
          className="transition hover:text-foreground"
          aria-label="Sync work stream"
        >
          ⟳ sync
        </button>
      </SurfaceSlot>

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
            freshnessOf={freshnessOf}
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
                freshnessOf={freshnessOf}
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
                freshnessOf={freshnessOf}
                now={now}
                pollMs={RUNNING_PROBE_MS}
                onResyncWatch={setResyncWatching}
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
          // DG-45-2 — the dispatch notice is a TOAST (z-40), not the shell's fullscreen
          // occupant. The top rung means one thing now, and ui/src/app/shell-layout.mjs is
          // where every rung is spelled.
          className={`fixed bottom-4 right-4 z-40 max-w-md rounded-md border px-3 py-2 text-sm shadow-lg ${
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
    </div>
  );
}

// A compact "◷ status legend" hover affordance in the top bar. Each row paints
// the REAL <StatusRing> shape (the same glyph-ring the cards show) next to its
// label, so the legend mirrors the painted ramp 1:1 — not a different vocabulary
// of inline text glyphs.
//
// milestone 43 — and now a FRESHNESS block below a divider, for exactly that
// reason and by exactly that rule: a new read-only vocabulary that is not in the
// legend is a vocabulary the operator must guess. It paints the REAL badge
// component (the m35 precedent, where the fleet legend's assignment block paints
// real chips rather than drawings) and states the window from the wire, in words
// — degrading to an unquantified sentence, never a guessed number, when the wire
// did not carry one. The block renders from the ramp module alone, so it is
// correct before any data has arrived.
function StatusLegend({ windowSeconds }: { windowSeconds: number | null }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" className="transition hover:text-foreground" aria-label="Status legend">
        ◷ status legend
      </button>
      {open ? (
        // DG-45-2 — a legend is a POPOVER (z-20).
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card p-2 shadow-lg">
          {LANE_ORDER.map((status) => (
            <p key={status} className="flex items-center gap-2 py-0.5 text-xs text-foreground">
              <StatusRing status={status} size={14} />
              <span>{statusMeta(status).short}</span>
            </p>
          ))}
          <span className="my-1.5 block border-t border-border" />
          <FreshnessLegend windowSeconds={windowSeconds} />
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
