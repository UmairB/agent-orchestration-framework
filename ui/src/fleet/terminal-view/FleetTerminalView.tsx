// Adapted from elirantutia/vibeyard (MIT) — the xterm terminal-pane wiring
// (new Terminal(), loadAddon(FitAddon), term.open(), fit(), and the dispose/close
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
// A MONITOR, NOT AN ATTACHABLE SHELL — the load-bearing posture (V2/V5/V6, T14):
//   - There is NO input region at all. No text input, no send control, no
//     type-into cursor. The row a read-write terminal would spend on an input box
//     is ABSENT, not disabled — a greyed input would falsely promise "coming soon"
//     and invite the operator to believe a keystroke reached the worker.
//   - There is NO browser->socket path: this component registers no `onData`
//     handler and never calls `.send(...)` on the socket. The socket is
//     server->browser ONLY, matching the route, which deliberately registers no
//     `ws.on("message")` sink (ADR-014 invariant 1).
//   - The xterm instance is constructed with `disableStdin: true` and a hidden,
//     non-blinking cursor, so the widget is read-only IN FACT, not merely by our
//     not wiring it up.
//   - The posture is carried by an explicit `read-only` LABEL (stream.mjs's
//     `readOnlyLabel`), never by colour or the absence of a box alone (V6).
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
// ALL the logic lives in the framework-free ./stream.mjs + ./view-state.mjs (the
// ui/src/board/terminal/*.mjs house precedent), so the @executable scenarios run
// headlessly; this file is the thin consumer.
import { useEffect, useRef, useState } from "react";
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
  const [view, setView] = useState<TerminalViewState>(() => initialTerminalViewState());
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const nodeId = stream.resolved ? stream.nodeId : null;
  const sessionId = stream.resolved ? stream.sessionId : null;

  // The subscription effect: mount xterm, open the READ-ONLY socket, paint the
  // live tail, and tear both down on cleanup (React 19 StrictMode double-invokes —
  // the dispose/close cleanup is load-bearing, the board dock's own lesson).
  useEffect(() => {
    if (!open || nodeId == null || sessionId == null) return;
    const container = viewportRef.current;
    if (!container) return;

    // V7 — a fresh subscribe starts in the honest waiting state. The mirror is
    // EPHEMERAL (ADR-014): there is no scrollback to replay, and we fabricate
    // none. An empty view is the NORMAL cold start, not a failure.
    setView(initialTerminalViewState());

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
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    try {
      fitAddon.fit();
    } catch {
      /* container not yet measured */
    }

    // The URL is built by the pure helper from the RESOLVED tuple only — an
    // unresolved stream yields null and this effect never opens a socket at all.
    const socketUrl = terminalViewSocketUrl(stream, {
      protocol: typeof window !== "undefined" ? window.location.protocol : "http:",
      host: typeof window !== "undefined" ? window.location.host : "127.0.0.1:4181",
    });
    if (socketUrl == null) {
      terminal.dispose();
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

    // Reflow on container resize. LAYOUT ONLY — unlike the board dock, the fit is
    // never reported upstream (that would be a browser-originated frame): the
    // worker's PTY geometry is the worker's own business.
    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
      } catch {
        /* container not measured */
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      terminal.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, nodeId, sessionId]);

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

  return (
    <section
      className="mt-3 flex flex-col rounded-md border border-[#1e2a44] bg-[#0f1629] text-zinc-200"
      aria-label={`Read-only terminal view for ${header.label}`}
    >
      {/* Region 1 — the stream-identity header (V1): WHICH stream this is, named
          by the assignment ref it belongs to, the node whose PTY it is, and the
          session — never a raw id alone. Region 2 — the read-only posture marker
          (V2/V6): an explicit quiet LABEL, not colour and not the mere absence of
          an input box. */}
      <header className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-[#1e2a44] px-3 py-1.5">
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
        {/* V12's hierarchy clause (DESIGN GAP-2): the toggle is the QUIETEST element
            in the header — the reading order is identity > read-only > state >
            toggle, because a control that outweighs the stream's own name inverts a
            monitor into a control. It carries the identity line's OWN chrome: the
            same `text-[11px]`, the same `text-zinc-400`, and NO weight above it
            (`font-semibold` removed).

            The reason it previously rendered LOUDER than everything else was NOT
            this class list: `ui/src/index.css` carried a hand-written, UNLAYERED
            `button { font: inherit }` that outranked every Tailwind v4 utility
            (they all live in `@layer utilities`), so this button computed 16px/400
            instead of 11px/600. Measured in headless Chromium against the built
            bundle, and fixed at the root — see the note in ui/src/index.css. */}
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="ml-auto shrink-0 rounded px-2 py-0.5 text-[11px] text-zinc-400 transition hover:bg-[#1e2a44] hover:text-zinc-100"
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
              present the byte area genuinely SHRINKS by the bar's height (the
              ResizeObserver then refits xterm into the smaller box) — the bar can
              therefore never sit on top of a glyph, which a `bottom-0` overlay
              would (measured: it hid the newest line, the very line the operator
              opened the terminal to read). V11's FIRST option — "outside the byte
              area" — rather than its second.

              V11 also dims the frozen frame of a dead stream (dead vs live), but
              the dim NEVER travels alone: the bar below always carries the meaning
              in words (V6). `waiting` has nothing to dim — its pane is empty. */}
          <div className="relative min-h-0 flex-1">
            <div
              ref={viewportRef}
              className={`absolute inset-0 p-2 ${descriptor.live || overprintable ? "" : "opacity-60"}`}
            />
            {descriptor.live || !overprintable ? null : (
              // V7 — the honest cold-start text. The pane is empty by definition
              // here (no byte has ever arrived), so nothing can be overprinted and
              // the message sits where the first line will appear. Never a spinner,
              // never a fabricated line, never a red error — an empty mirror is the
              // DESIGNED normal. This is the WAITING state's own "bar" (V11 reserves
              // top-left only for the empty pane), so it carries the REASON:
              // `no live output — assignment failed · reclaimed` on a terminal-state
              // assignment, while the header chip keeps the short `no live output`.
              <div className="pointer-events-none absolute inset-x-0 top-0 p-3">
                <p className={`mono text-xs ${tone.text}`}>{descriptor.reason ?? descriptor.text}</p>
              </div>
            )}
          </div>
          {descriptor.live || overprintable ? null : (
            // V9/V11 (DESIGN GAP-1) — `stream ended` / `disconnected` is CHROME, not
            // output, and it annotates a pane that is FULL. It renders as an OPAQUE
            // bar at the BOTTOM of the terminal pane — where the newest line is and
            // the eye already is — in the dock's OWN chrome tokens, so it reads as
            // terminal punctuation AFTER the output instead of graffiti across it,
            // and it takes its own layout space so it covers nothing.
            //
            // It used to be unbacked text painted at the top-left (an overlay
            // inherited from TerminalDock's ERROR state, which in the dock only ever
            // fires over an effectively EMPTY pane). Here it fired over a full one
            // every time a stream ended: the message and the operator's own last
            // output line collided glyph-for-glyph and BOTH became unreadable.
            <div className="shrink-0 border-t border-[#1e2a44] bg-[#0f1629] px-3 py-1.5">
              <p className={`mono text-xs ${tone.text}`}>{descriptor.reason ?? descriptor.text}</p>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
