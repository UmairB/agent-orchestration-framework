// Adapted from elirantutia/vibeyard (MIT) — the xterm terminal-pane wiring
// (terminal-pane.ts: new Terminal(), loadAddon(FitAddon/WebLinksAddon),
// term.open(), fit(), term.onData → carrier, carrier → term.write(), and the
// dispose/close cleanup), re-homed off vibeyard's Electron IPC carrier
// (window.vibeyard.pty.*) onto a browser WebSocket at /ws/terminal. vibeyard is
// MIT-licensed; see the repo NOTICE file. ADR-003: the frozen wire envelope
// (raw PTY frames + JSON {resize}/{exit}/{error}); DESIGN §4: the dock chrome,
// provider picker (exactly-one-selected), the connection-state ramp, and the
// dark viewport with collapse/close controls.
import { useEffect, useMemo, useRef, useState } from "react";
import type * as React from "react";
import {
  X,
  ChevronDown,
  ChevronUp,
  RotateCw,
} from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { cn } from "@/lib/utils";
import {
  initialPicker,
  selectProvider,
  isSelected,
  type ProviderId,
  type PickerState,
} from "./terminal/provider-picker.mjs";
import {
  initialDockState,
  dockConnecting,
  dockRunning,
  dockStateFromControl,
  DOCK_STATES,
  type DockState,
} from "./terminal/dock-state.mjs";
import { emitFit, type ResizeMessage } from "./terminal/resize.mjs";

// A JSON control message is distinguished from raw PTY bytes by being a JSON
// object (ADR-003). Anything that does not parse to an object is terminal bytes.
function parseControl(text: string): { type: string; exitCode?: number; message?: string } | null {
  if (!text.startsWith("{")) return null;
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

// Dock height bounds (px) for the layout-only resize affordance. The min is
// roughly the collapsed-header height; the max is clamped at drag time to ~half
// the viewport.
const DOCK_MIN_HEIGHT = 48;
const DOCK_DEFAULT_HEIGHT = 280;

// Providers offered in the picker. claude-only for now (codex/gemini are paused at
// the operator's request); the provider seam (provider-picker.mjs + the server)
// still supports all three, so re-enabling is just widening this list.
const VISIBLE_PROVIDERS: ProviderId[] = ["claude"];

export function TerminalDock({
  targetRef,
  command,
  onClose,
}: {
  // The ref the SESSION is bound to (independent of the live board selection) and
  // the state-aware aof slash-command to type on connect (null → ad-hoc agent).
  targetRef: string | null;
  command: string | null;
  onClose?: () => void;
}) {
  const [picker, setPicker] = useState<PickerState>(() => initialPicker());
  const [dock, setDock] = useState<DockState>(() => initialDockState());
  const [collapsed, setCollapsed] = useState(false);
  // A run token: bumping it re-runs the session effect (Run / Restart).
  const [runToken, setRunToken] = useState(0);
  // Layout-only dock height (DESIGN §4 / overarching layout: the dock is
  // drag-resizable). Not wired to item status (DESIGN Default 5).
  const [height, setHeight] = useState(DOCK_DEFAULT_HEIGHT);

  const viewportRef = useRef<HTMLDivElement | null>(null);
  // Tracks an in-flight resize drag: the pointer Y where the drag began and the
  // dock height at that moment.
  const dragRef = useRef<{ startY: number; startHeight: number } | null>(null);
  const providerId = picker.selected;

  // The layout-only vertical resize affordance (DESIGN §4): drag the top edge to
  // grow/shrink the dock. Plain pointer events with capture; clamped to
  // [DOCK_MIN_HEIGHT, ~half the viewport]. The xterm FitAddon auto-fits on the
  // resulting container resize via the session effect's ResizeObserver.
  const onResizePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    dragRef.current = { startY: event.clientY, startHeight: height };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onResizePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    // Dragging up (smaller clientY) grows the dock.
    const delta = drag.startY - event.clientY;
    const max = typeof window !== "undefined" ? Math.round(window.innerHeight / 2) : 600;
    const next = Math.min(Math.max(drag.startHeight + delta, DOCK_MIN_HEIGHT), max);
    setHeight(next);
  };
  const onResizePointerUp = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    dragRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      /* pointer already released */
    }
  };

  // The session effect: mount xterm, open the WS, wire the frozen envelope, and
  // tear both down on cleanup (React 19 StrictMode double-invokes — the
  // dispose/close cleanup is load-bearing, RESEARCH §4).
  useEffect(() => {
    // NOTE: collapsing must NOT tear the session down — the WS/PTY stay alive and
    // the viewport is only hidden (CSS), so the running agent keeps going in the
    // background and its scrollback is intact on expand. Only ✕ (onClose →
    // unmount) ends the session. So `collapsed` is deliberately NOT a dependency.
    if (!targetRef) return; // nothing bound to run against
    const container = viewportRef.current;
    if (!container) return;

    setDock(dockConnecting());

    const term = new Terminal({
      convertEol: true,
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      theme: { background: "#0b0f14", foreground: "#d7dde3" },
      allowProposedApi: true,
    });
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(new WebLinksAddon());
    term.open(container);
    try {
      fitAddon.fit();
    } catch {
      /* container not yet measured */
    }

    const wsUrl = terminalWsUrl(targetRef, providerId);
    const socket = new WebSocket(wsUrl);
    socket.binaryType = "arraybuffer";
    let lastFit: ResizeMessage | null = null;
    let running = false;

    // Auto-type the state-aware command ONCE per session, as ordinary input —
    // the same raw path normal keystrokes take (NOT a JSON frame; ADR-003 wire
    // envelope is unchanged). It fires on the FIRST server output chunk, or a
    // ~700ms fallback after open (whichever first), so the agent's prompt is up.
    // Re-running (provider change / restart) re-arms it via the effect re-run.
    let commandSent = false;
    let commandTimer: ReturnType<typeof setTimeout> | null = null;
    const sendCommand = () => {
      if (commandSent || !command) return;
      commandSent = true;
      if (commandTimer !== null) {
        clearTimeout(commandTimer);
        commandTimer = null;
      }
      if (socket.readyState === WebSocket.OPEN) socket.send(command + "\r");
    };

    const sendResize = () => {
      if (socket.readyState !== WebSocket.OPEN) return;
      try {
        fitAddon.fit();
      } catch {
        return;
      }
      const result = emitFit(term.cols, term.rows, (frame) => socket.send(frame), lastFit);
      lastFit = result.message;
    };

    socket.onopen = () => {
      sendResize();
      // Fallback: if no output arrives, still type the command after a beat so an
      // already-idle prompt receives it. Cleared the moment it fires (first chunk).
      if (command) commandTimer = setTimeout(sendCommand, 700);
    };

    // WS → term: raw frames are bytes; JSON objects are control messages.
    socket.onmessage = (event) => {
      const data = event.data;
      if (typeof data === "string") {
        const control = parseControl(data);
        if (control) {
          setDock((current) => dockStateFromControl(current, control));
          return;
        }
        if (!running) {
          running = true;
          setDock(dockRunning());
        }
        term.write(data);
        sendCommand(); // first server output chunk → type the command once
        return;
      }
      // Binary frame → bytes.
      if (!running) {
        running = true;
        setDock(dockRunning());
      }
      term.write(new Uint8Array(data as ArrayBuffer));
      sendCommand(); // first server output chunk → type the command once
    };

    socket.onerror = () => {
      setDock((current) =>
        current.state === DOCK_STATES.RUNNING || current.state === DOCK_STATES.EXITED
          ? current
          : dockStateFromControl(current, { type: "error", message: "connection failed" })
      );
    };

    // term → WS: raw input frames.
    const dataSub = term.onData((input) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(input);
    });

    // Reflow on container resize → a single resize per fit.
    const resizeObserver = new ResizeObserver(() => sendResize());
    resizeObserver.observe(container);

    return () => {
      if (commandTimer !== null) clearTimeout(commandTimer);
      resizeObserver.disconnect();
      dataSub.dispose();
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetRef, command, providerId, runToken]);

  const stateLabel = useMemo(() => describeState(dock), [dock]);

  return (
    <section
      className="flex flex-col border-t border-[#1e2a44] bg-[#0f1629] text-zinc-200"
      aria-label="Terminal dock"
      style={collapsed ? undefined : { height }}
    >
      {/* Layout-only resize handle (DESIGN §4): drag the dock's top edge to
          grow/shrink it. No-op while collapsed. */}
      {collapsed ? null : (
        <div
          role="separator"
          aria-orientation="horizontal"
          aria-label="Resize terminal dock"
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          className="h-1.5 w-full shrink-0 cursor-row-resize bg-transparent hover:bg-primary/40"
        />
      )}
      {/* DESIGN §"Terminal dock": dark dock, restyled chrome — same WS/provider/
          resize behavior, only the look changes. */}
      <header className="flex items-center gap-3 border-b border-[#1e2a44] px-4 py-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold tracking-wide text-zinc-300">
          <span aria-hidden="true">▣</span> TERMINAL
        </span>

        {/* Provider picker — radio-semantics, exactly one selected (DESIGN §4). The
            selected provider carries a teal dot. Changing the provider re-runs the
            session effect (providerId is a dep), which tears down a live WS/PTY —
            so the segments are DISABLED while a session is RUNNING (the cheap
            data-loss guard; exactly-one-selected is preserved). */}
        <span className="text-xs text-zinc-500">provider:</span>
        <div
          role="radiogroup"
          aria-label="Agent provider"
          className="grid grid-flow-col gap-1 rounded-md border border-[#1e2a44] bg-[#0b1120] p-1"
        >
          {VISIBLE_PROVIDERS.map((id) => {
            const active = isSelected(picker, id);
            const locked = dock.state === DOCK_STATES.RUNNING;
            return (
              <button
                key={id}
                type="button"
                role="radio"
                aria-checked={active}
                disabled={locked}
                title={locked ? "Stop the running session to switch provider" : undefined}
                onClick={() => setPicker((current) => selectProvider(current, id))}
                className={cn(
                  "flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  active ? "bg-primary text-primary-foreground" : "text-zinc-400 hover:text-zinc-100",
                  locked && "cursor-not-allowed opacity-60 hover:text-zinc-400"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full",
                    active ? "bg-primary-foreground" : "bg-transparent"
                  )}
                  aria-hidden="true"
                />
                {id}
              </button>
            );
          })}
        </div>

        <span className="mono text-xs text-zinc-500">
          {targetRef ? (
            <>
              item <span className="text-zinc-300">{targetRef}</span>
            </>
          ) : (
            "no item selected"
          )}
        </span>

        {/* Connection-state indicator — dot + label, the DESIGN §4 ramp. */}
        <span className="flex items-center gap-1.5 text-xs">
          <span className={cn("inline-block h-2 w-2 rounded-full", stateLabel.dotClass)} aria-hidden="true" />
          <span className={stateLabel.darkTextClass}>{stateLabel.text}</span>
        </span>

        <span className="ml-auto flex items-center gap-1">
          {dock.state === DOCK_STATES.EXITED || dock.state === DOCK_STATES.ERROR ? (
            <button
              type="button"
              onClick={() => setRunToken((token) => token + 1)}
              aria-label="Restart session"
              className="grid h-7 w-7 place-items-center rounded text-zinc-400 transition hover:bg-[#1e2a44] hover:text-zinc-100"
            >
              <RotateCw className="h-4 w-4" aria-hidden="true" />
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            aria-label={collapsed ? "Expand terminal dock" : "Collapse terminal dock"}
            className="grid h-7 w-7 place-items-center rounded text-zinc-400 transition hover:bg-[#1e2a44] hover:text-zinc-100"
          >
            {collapsed ? <ChevronUp className="h-4 w-4" aria-hidden="true" /> : <ChevronDown className="h-4 w-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close terminal dock"
            className="grid h-7 w-7 place-items-center rounded text-zinc-400 transition hover:bg-[#1e2a44] hover:text-zinc-100"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </span>
      </header>

      {/* The body stays MOUNTED while collapsed (only hidden) so the xterm pane and
          its WebSocket/PTY survive a collapse — the agent keeps running in the
          background and its scrollback is preserved on expand. */}
      <div className={cn("relative min-h-0 flex-1 bg-[#0b0f14]", collapsed && "hidden")}>
        {targetRef ? (
          <div ref={viewportRef} className="absolute inset-0 p-2" />
        ) : (
          <div className="grid h-full place-items-center p-6 text-center">
            <p className="mono text-xs text-zinc-400">No session. Press Run agent on an item.</p>
          </div>
        )}
        {dock.state === DOCK_STATES.ERROR ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 p-3">
            <p className="mono text-xs text-destructive">{dock.message}</p>
          </div>
        ) : null}
      </div>
    </section>
  );
}

// Build the /ws/terminal URL carrying the thin launch contract (ref + provider).
function terminalWsUrl(ref: string, provider: ProviderId): string {
  const scheme = typeof window !== "undefined" && window.location.protocol === "https:" ? "wss" : "ws";
  const host = typeof window !== "undefined" ? window.location.host : "127.0.0.1:4177";
  const params = new URLSearchParams({ ref, provider });
  return `${scheme}://${host}/ws/terminal?${params.toString()}`;
}

// Map the dock state onto the DESIGN §4 ramp (dot colour + label text). The dark
// dock chrome needs a light-on-dark text variant alongside the token dot colour.
function describeState(dock: DockState): { text: string; dotClass: string; textClass: string; darkTextClass: string } {
  switch (dock.state) {
    case DOCK_STATES.CONNECTING:
      // Stay on the named DESIGN §4 secondary ramp (still pulsing).
      return { text: "connecting…", dotClass: "animate-pulse bg-secondary", textClass: "text-muted-foreground", darkTextClass: "text-zinc-400" };
    case DOCK_STATES.RUNNING:
      return { text: "running", dotClass: "bg-primary", textClass: "text-primary", darkTextClass: "text-primary" };
    case DOCK_STATES.EXITED:
      return dock.reads === "failure"
        ? { text: `exited (${dock.exitCode})`, dotClass: "bg-destructive", textClass: "text-destructive", darkTextClass: "text-red-400" }
        : { text: `exited (${dock.exitCode})`, dotClass: "bg-muted-foreground", textClass: "text-muted-foreground", darkTextClass: "text-zinc-400" };
    case DOCK_STATES.ERROR:
      return { text: "error", dotClass: "bg-destructive", textClass: "text-destructive", darkTextClass: "text-red-400" };
    case DOCK_STATES.IDLE:
    default:
      return { text: "idle", dotClass: "bg-muted-foreground", textClass: "text-muted-foreground", darkTextClass: "text-zinc-400" };
  }
}
