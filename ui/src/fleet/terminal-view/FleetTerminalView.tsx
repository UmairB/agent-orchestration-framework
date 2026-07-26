// Adapted from elirantutia/vibeyard (MIT) — the xterm terminal-pane wiring
// (new Terminal(), loadAddon(FitAddon), term.open(), and the dispose/close
// cleanup), reached here through ui/src/board/TerminalDock.tsx, which ported it
// first. vibeyard is MIT-licensed; see the repo NOTICE file. The INPUT half of that
// original wiring (term.onData -> carrier) is DELIBERATELY not ported: this view is
// a read-only monitor (see below).
//
// The fleet's READ-ONLY terminal-VIEW (milestone 38 / story 06 / task 04; BLOCKER
// F-38.06c. ARCHITECTURE ADR-013 + ADR-014, carve-out #2; SECURITY T14; DESIGN
// §Surface 3 V1-V12 — V10/V11/V12's hierarchy clause added at the 2026-07-23 render
// review, GAP-1/GAP-2/GAP-3). The browser CONSUMER the mirror never had: an assignment's
// card resolves its (nodeId, sessionId) from the ADR-013 `session_id` now surfaced
// on the read shape, subscribes to the fleet face's read-only
// `GET /ws/terminal-view?nodeId=&sessionId=` route (src/mesh-ui-serve.mjs), and
// mirrors the worker's live PTY tail.
//
// RENDER GEOMETRY (live two-machine soak fix, 2026-07-25). The worker spawns its
// interactive `claude` PTY at a FIXED 80×24 (src/mesh-worker-execution.mjs), and
// `claude`'s TUI paints every line for THAT screen with absolute cursor addressing.
// The first cut fit xterm to the tiny card pane (~46×10), so the 80-column paint
// overlapped itself into an unreadable scatter. This view now renders at EXACTLY the
// worker's geometry (terminal.resize(WORKER_TERMINAL_COLS, WORKER_TERMINAL_ROWS)) and
// SCALES the fixed-size result with a single CSS transform (geometry.mjs's
// terminalFitScale) into whatever box is available — the inline card peek scales it
// DOWN, the full-screen EXPAND overlay scales it UP, off ONE xterm instance and ONE
// socket (xterm's DOM renderer — no canvas/webgl addon is loaded — scales crisply
// both ways). Expanding moves that one host between the inline pane and a portal
// overlay; it never opens a second socket, so the live tail is never dropped or
// duplicated (the mirror is ephemeral — a re-subscribe would show an empty pane).
//
// A MONITOR, NOT AN ATTACHABLE SHELL — the load-bearing posture (V2/V5/V6, T14):
//   - There is NO input region at all — inline OR expanded. No text input, no send
//     control, no type-into cursor. The row a read-write terminal would spend on an
//     input box is ABSENT, not disabled — a greyed input would falsely promise
//     "coming soon" and invite the operator to believe a keystroke reached the worker.
//   - There is NO browser->socket path: this component registers no `onData`
//     handler and never calls `.send(...)` on the socket. The socket is
//     server->browser ONLY, matching the route, which deliberately registers no
//     `ws.on("message")` sink (ADR-014 invariant 1). The EXPAND control is a pure
//     layout affordance — it moves where the read-only mirror is painted, nothing more.
//   - The xterm instance is constructed with `disableStdin: true` and a hidden,
//     non-blinking cursor, so the widget is read-only IN FACT, not merely by our
//     not wiring it up.
//   - The posture is carried by an explicit `read-only` LABEL (stream.mjs's
//     `readOnlyLabel`), never by colour or the absence of a box alone (V6) — and the
//     label rides the header in BOTH the inline and the expanded surface.
//
// ON `terminal.write(...)`: that is the RENDER direction — bytes the SERVER sent
// being painted into a browser-side xterm SCREEN. There is no PTY, no child
// process, and no stdin on this side of the wire at all; ADR-014 invariant 1's
// `term.write` clause governs a source that feeds a WORKER's PTY stdin
// (server-side: the bridge, the mirror, the route), which a browser view
// structurally cannot be. The invariant that DOES bind here — no browser-originated
// frame up the terminal-view socket — is asserted structurally over this file by
// `acd-fleet-terminal-mirror-read-only`.
//
// V3 — the terminal rendering is the board `TerminalDock`'s idiom REUSED (the same
// `@xterm/xterm` + FitAddon wiring, the same mono font stack, the same dark
// viewport theme, the same dot+label state indicator classes). No fleet-local
// terminal chrome, colour, frame, or "streaming" accent is invented here.
//
// ALL the framework-free logic lives in ./stream.mjs + ./view-state.mjs + the render
// GEOMETRY in ./geometry.mjs (the ui/src/board/terminal/*.mjs house precedent), so
// the @executable scenarios run headlessly; this file is the thin consumer.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2 } from "lucide-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import type { WorkAssignment } from "../api";
import {
  resolveTerminalStream,
  terminalStreamHeader,
  terminalViewSocketUrl,
} from "./stream.mjs";
import {
  WORKER_TERMINAL_COLS,
  WORKER_TERMINAL_ROWS,
  terminalFitScale,
} from "./geometry.mjs";
import {
  initialTerminalViewState,
  terminalViewOnBytes,
  terminalViewOnClose,
  terminalViewOnError,
  describeTerminalViewState,
  TERMINAL_VIEW_STATES,
  type TerminalViewState,
} from "./view-state.mjs";

// The state dot + text classes — byte-for-byte the board dock's `describeState`
// tone map (TerminalDock.tsx), reused so the two terminals speak ONE state
// vocabulary. Colour NEVER travels alone: every state also renders its text label.
function stateClasses(token: string): { dot: string; text: string } {
  if (token === "primary") return { dot: "bg-primary", text: "text-primary" };
  if (token === "destructive") return { dot: "bg-destructive", text: "text-red-400" };
  return { dot: "bg-muted-foreground", text: "text-zinc-400" };
}

export function FleetTerminalView({
  assignment,
  itemRef,
}: {
  assignment: WorkAssignment;
  itemRef?: string | null;
}) {
  // ADR-014 invariant 4 — the FULL (nodeId, sessionId) tuple or nothing. A card
  // whose worker has not captured a session yet resolves to NO stream and renders
  // NO terminal (and therefore opens no socket): never a guessed, defaulted, or
  // sibling session.
  const stream = resolveTerminalStream(assignment);
  const header = terminalStreamHeader(stream, {
    itemRef,
    assignmentId: assignment?.assignmentId,
  });

  const [open, setOpen] = useState(false);
  // The layout-only EXPAND state: false = inline card peek, true = full-screen
  // portal overlay. Pure presentation — it moves WHERE the read-only mirror paints,
  // never what it can do (still no input path, still one socket).
  const [expanded, setExpanded] = useState(false);
  const [view, setView] = useState<TerminalViewState>(() => initialTerminalViewState());
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const overlayViewportRef = useRef<HTMLDivElement | null>(null);
  // The ONE xterm instance and the ONE host element it renders into — held across
  // renders so the EXPAND toggle can re-parent the SAME painted terminal between the
  // inline pane and the overlay without tearing the socket down.
  const termRef = useRef<Terminal | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);

  const nodeId = stream.resolved ? stream.nodeId : null;
  const sessionId = stream.resolved ? stream.sessionId : null;

  // Collapsing the terminal also collapses any expansion — an expanded overlay for a
  // terminal that is no longer open would be an orphan covering the screen.
  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  // The subscription effect: mount ONE xterm at the worker's fixed geometry, open the
  // READ-ONLY socket, paint the live tail, and tear both down on cleanup (React 19
  // StrictMode double-invokes — the dispose/close cleanup is load-bearing, the board
  // dock's own lesson).
  useEffect(() => {
    if (!open || nodeId == null || sessionId == null) return;
    const inline = viewportRef.current;
    if (!inline) return;

    // V7 — a fresh subscribe starts in the honest waiting state. The mirror is
    // EPHEMERAL (ADR-014): there is no scrollback to replay, and we fabricate
    // none. An empty view is the NORMAL cold start, not a failure.
    setView(initialTerminalViewState());

    // The host the xterm paints into. It is what the CSS-transform fit scales, and
    // what the expand toggle re-parents. Anchored top-left of whichever pane holds
    // it; the scaled 80×24 screen always sits inside that pane.
    const host = document.createElement("div");
    host.style.position = "absolute";
    host.style.top = "0";
    host.style.left = "0";
    host.style.transformOrigin = "top left";
    hostRef.current = host;
    inline.appendChild(host);

    const terminal = new Terminal({
      convertEol: true,
      // Read-only IN FACT: xterm itself refuses stdin, so no keystroke can ever
      // become an `onData` event, and there is no type-into cursor to invite one.
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "underline",
      fontSize: 13,
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      theme: { background: "#0b0f14", foreground: "#d7dde3" },
      allowProposedApi: true,
    });
    termRef.current = terminal;
    // The board dock's FitAddon idiom is REUSED (V3), but this view does NOT fit to
    // the pane: it drives xterm to the WORKER's fixed 80×24 so claude's absolutely
    // addressed TUI lands column-for-column, then scales that fixed screen to the
    // pane with a CSS transform below. Fitting to the pane is exactly what garbled
    // the render (a 46-col xterm painting an 80-col screen).
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(host);
    terminal.resize(WORKER_TERMINAL_COLS, WORKER_TERMINAL_ROWS);

    // The URL is built by the pure helper from the RESOLVED tuple only — an
    // unresolved stream yields null and this effect never opens a socket at all.
    const socketUrl = terminalViewSocketUrl(stream, {
      protocol: typeof window !== "undefined" ? window.location.protocol : "http:",
      host: typeof window !== "undefined" ? window.location.host : "127.0.0.1:4181",
    });
    if (socketUrl == null) {
      terminal.dispose();
      termRef.current = null;
      host.remove();
      hostRef.current = null;
      return;
    }
    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";

    // server -> browser ONLY. There is deliberately no `socket.onopen` handshake
    // frame, no resize frame, no keystroke forwarding — nothing this browser
    // originates ever travels up this socket.
    socket.onmessage = (event) => {
      const data = event.data;
      if (typeof data === "string") terminal.write(data);
      else terminal.write(new Uint8Array(data as ArrayBuffer));
      setView((current) => terminalViewOnBytes(current));
    };
    // V9 — a closed or dropped stream SAYS so; it never freezes on the last frame
    // pretending to still be live.
    socket.onclose = () => setView((current) => terminalViewOnClose(current));
    socket.onerror = () => setView((current) => terminalViewOnError(current));

    return () => {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      terminal.dispose();
      termRef.current = null;
      try {
        host.remove();
      } catch {
        /* already detached */
      }
      hostRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId, sessionId]);

  // The mount + fit effect: place the ONE host into whichever pane is active (inline
  // or, when expanded, the portal overlay), scale the fixed 80×24 screen to that
  // pane, and re-fit on every resize. Runs AFTER the subscription effect (definition
  // order) so termRef/hostRef are populated; re-runs on EXPAND to re-parent and re-fit.
  useEffect(() => {
    if (!open || nodeId == null || sessionId == null) return;
    const host = hostRef.current;
    if (host == null) return;
    const active = expanded ? overlayViewportRef.current : viewportRef.current;
    if (active == null) return;
    if (host.parentElement !== active) active.appendChild(host);

    const fit = () => {
      // The intrinsic size is the terminal's OWN pixel screen (transform-independent
      // layout metric — a CSS transform on the host never changes a descendant's
      // offsetWidth), so it stays the true 80×24 size however the host is scaled.
      const screen = host.querySelector<HTMLElement>(".xterm-screen");
      const intrinsicWidth = screen?.offsetWidth ?? host.offsetWidth;
      const intrinsicHeight = screen?.offsetHeight ?? host.offsetHeight;
      const scale = terminalFitScale({
        intrinsicWidth,
        intrinsicHeight,
        boxWidth: active.clientWidth,
        boxHeight: active.clientHeight,
      });
      host.style.transform = `scale(${scale})`;
    };

    fit();
    // One deferred re-fit: the pane may not be laid out on the tick the host lands in
    // it (the very first paint, or the frame the overlay mounts).
    const raf = requestAnimationFrame(fit);
    const resizeObserver = new ResizeObserver(() => fit());
    resizeObserver.observe(active);

    return () => {
      cancelAnimationFrame(raf);
      resizeObserver.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, expanded, nodeId, sessionId]);

  // V1 — a terminal with no visible owner is never rendered. `terminalStreamHeader`
  // returns null both for an unresolved tuple and for a stream it cannot name, so
  // this ONE guard covers "no terminal, no socket" and "no anonymous terminal".
  if (header == null) return null;

  // V10 (DESIGN §Surface 3, ruled 2026-07-23 — GAP-3; corrected §Correction 3): the
  // assignment ROW is handed to the DESCRIBER, never to the resolver above. The
  // describer settles terminal-ness through the SAME `assignmentChip` the fleet
  // already speaks (so `withdrawn`/`stale` can never leak past a hand-maintained
  // list). A stream that captured a session on an assignment that has since finished
  // still resolves and is still watchable (routing is tuple-only, ADR-014 inv.4); it
  // simply must not read `waiting for output` forever, because nothing can ever
  // arrive. Presentation only — no filter, no hidden stream.
  const descriptor = describeTerminalViewState(view, { assignment });
  const tone = stateClasses(descriptor.token);
  // V11 — `waiting` is the ONLY non-live state whose pane is empty BY DEFINITION
  // (nothing has ever been painted into it), so it is the only one that may write on
  // the byte area itself. Every other non-live state annotates a pane that holds the
  // operator's last output line.
  const overprintable = descriptor.state === TERMINAL_VIEW_STATES.WAITING;

  // The stream-identity + read-only + state row, shared verbatim by the inline header
  // and the expanded overlay header so the two surfaces speak ONE identity (V1) and
  // BOTH carry the read-only posture as a LABEL (V2/V6), never colour alone.
  const identity = (
    <>
      <span className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold tracking-wide text-zinc-300">
        <span aria-hidden="true">▣</span> TERMINAL
      </span>
      <span className="mono min-w-0 truncate text-[11px] text-zinc-400" title={`${header.label} · ${header.sessionLabel}`}>
        {header.label} · {header.sessionLabel}
      </span>
      <span
        className="shrink-0 rounded border border-[#1e2a44] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-400"
        title="This view mirrors the worker's terminal. It cannot type: keystrokes never reach the worker."
      >
        {header.readOnlyLabel}
      </span>
      {open ? (
        <span className="flex shrink-0 items-center gap-1.5 text-[11px]">
          <span
            className={`inline-block h-2 w-2 rounded-full ${tone.dot} ${descriptor.motion === "pulse" ? "animate-pulse" : ""}`}
            aria-hidden="true"
          />
          <span className={tone.text}>{descriptor.text}</span>
        </span>
      ) : null}
    </>
  );

  return (
    <>
      <section
        className="mt-3 flex flex-col rounded-md border border-[#1e2a44] bg-[#0f1629] text-zinc-200"
        aria-label={`Read-only terminal view for ${header.label}`}
      >
        {/* Region 1 — the stream-identity header (V1). Region 2 — the read-only
            posture marker (V2/V6). Both live in the shared `identity` above. The
            controls trail it: EXPAND (a quiet layout affordance, only while open) then
            the Watch/Hide toggle (V12: the toggle stays the quietest element). */}
        <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#1e2a44] px-3 py-1.5">
          {identity}
          {open ? (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              title="Expand terminal to full screen"
              aria-label="Expand terminal to full screen"
              className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-[#1e2a44] hover:text-zinc-100"
            >
              <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          {/* V12's hierarchy clause (DESIGN GAP-2): the toggle is the QUIETEST element
              in the header — the reading order is identity > read-only > state >
              expand > toggle. It carries the identity line's OWN chrome: the same
              `text-[11px]`, the same `text-zinc-400`, and NO weight above it. */}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            className={`${open ? "" : "ml-auto "}shrink-0 rounded px-2 py-0.5 text-[11px] text-zinc-400 transition hover:bg-[#1e2a44] hover:text-zinc-100`}
          >
            {open ? "Hide terminal" : "Watch terminal →"}
          </button>
        </header>

        {/* Region 3 — the live byte stream, in the board dock's terminal idiom. There
            is NO region 4: a read-write terminal's input row is ABSENT here, not
            disabled. */}
        {open ? (
          <div className="flex h-48 min-h-0 flex-col bg-[#0b0f14]">
            {/* The BYTE AREA. `flex-1` + `min-h-0`, so when the non-live bar below is
                present the byte area genuinely SHRINKS by the bar's height (the fit
                then re-scales the fixed screen into the smaller box) — the bar can
                therefore never sit on top of a glyph. V11's FIRST option — "outside
                the byte area". */}
            <div className="relative min-h-0 flex-1">
              <div
                ref={viewportRef}
                className={`absolute inset-0 overflow-hidden p-2 ${descriptor.live || overprintable ? "" : "opacity-60"}`}
              />
              {descriptor.live || !overprintable ? null : (
                // V7 — the honest cold-start text. The pane is empty by definition
                // here (no byte has ever arrived), so nothing can be overprinted and
                // the message sits where the first line will appear.
                <div className="pointer-events-none absolute inset-x-0 top-0 p-3">
                  <p className={`mono text-xs ${tone.text}`}>{descriptor.reason ?? descriptor.text}</p>
                </div>
              )}
            </div>
            {descriptor.live || overprintable ? null : (
              // V9/V11 (DESIGN GAP-1) — `stream ended` / `disconnected` is CHROME, not
              // output, and it annotates a pane that is FULL. It renders as an OPAQUE
              // bar at the BOTTOM of the terminal pane, in the dock's OWN chrome
              // tokens, and takes its own layout space so it covers nothing.
              <div className="shrink-0 border-t border-[#1e2a44] bg-[#0f1629] px-3 py-1.5">
                <p className={`mono text-xs ${tone.text}`}>{descriptor.reason ?? descriptor.text}</p>
              </div>
            )}
          </div>
        ) : null}
      </section>

      {/* The full-screen EXPAND overlay (portal to <body> so no card ancestor's
          stacking or overflow can clip it). It carries the SAME identity + read-only
          + state header, and hosts the SAME xterm (moved here by the fit effect) at a
          comfortable, readable scale. Layout only — still no input path, still one
          socket. The inline bar above renders BEFORE this overlay's, so the V11
          "the message never overprints" bar the fitness reads is the inline (opaque,
          in-flow) one. */}
      {open && expanded
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex flex-col bg-[#0b0f14] text-zinc-200"
              role="dialog"
              aria-modal="true"
              aria-label={`Read-only terminal view for ${header.label}`}
            >
              <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#1e2a44] bg-[#0f1629] px-4 py-2">
                {identity}
                <button
                  type="button"
                  onClick={() => setExpanded(false)}
                  title="Collapse terminal"
                  aria-label="Collapse terminal"
                  className="ml-auto shrink-0 rounded px-1.5 py-0.5 text-[11px] text-zinc-400 transition hover:bg-[#1e2a44] hover:text-zinc-100"
                >
                  <Minimize2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </header>
              <div className="relative min-h-0 flex-1 bg-[#0b0f14]">
                <div
                  ref={overlayViewportRef}
                  className={`absolute inset-0 overflow-hidden p-3 ${descriptor.live || overprintable ? "" : "opacity-60"}`}
                />
                {descriptor.live || overprintable ? null : (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 border-t border-[#1e2a44] bg-[#0f1629] px-4 py-1.5">
                    <p className={`mono text-xs ${tone.text}`}>{descriptor.reason ?? descriptor.text}</p>
                  </div>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
