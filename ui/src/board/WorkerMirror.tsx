// The board's embedded WORKER MIRROR (m42 wave (b), TECH_DEBT item 6's console
// leg): the read-only live view of a worker's session, painted INSIDE the board
// instead of a link-out to the fleet. Rides the fleet's existing
// `GET /ws/terminal-view?nodeId=&sessionId=` route on the FIXED fleet port
// (:4181 — the documented contract; the board itself runs on an ephemeral port,
// which is why the socket targets the fleet host explicitly).
//
// Read-only IN FACT (the FleetTerminalView discipline, reused): xterm's
// disableStdin refuses input, and nothing this browser originates ever travels
// up the socket — no handshake, no resize, no keystrokes. The mirror is
// EPHEMERAL (ADR-014): no scrollback replay, an empty view is the honest cold
// start, and a dropped stream says so rather than freezing on the last frame.
import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

const WORKER_COLS = 80;
const WORKER_ROWS = 24;
const FLEET_PORT = 4181;

type MirrorState = "waiting" | "live" | "closed" | "error";

export function WorkerMirror({ nodeId, sessionId }: { nodeId: string; sessionId: string }) {
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [state, setState] = useState<MirrorState>("waiting");

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    setState("waiting");

    const terminal = new Terminal({
      convertEol: true,
      disableStdin: true,
      cursorBlink: false,
      cursorStyle: "underline",
      fontSize: 11,
      fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
      theme: { background: "#0b0f14", foreground: "#d7dde3" },
    });
    terminal.open(viewport);
    // The WORKER's fixed geometry (the FleetTerminalView lesson): claude's
    // absolutely-addressed TUI lands column-for-column at 80×24; fitting to the
    // pane is what garbles the render.
    terminal.resize(WORKER_COLS, WORKER_ROWS);

    const socketUrl = `ws://${window.location.hostname}:${FLEET_PORT}/ws/terminal-view?nodeId=${encodeURIComponent(nodeId)}&sessionId=${encodeURIComponent(sessionId)}`;
    const socket = new WebSocket(socketUrl);
    socket.binaryType = "arraybuffer";
    socket.onmessage = (event) => {
      const data = event.data;
      if (typeof data === "string") terminal.write(data);
      else terminal.write(new Uint8Array(data as ArrayBuffer));
      setState("live");
    };
    socket.onclose = () => setState((current) => (current === "error" ? current : "closed"));
    socket.onerror = () => setState("error");

    return () => {
      try {
        socket.close();
      } catch {
        /* already closing */
      }
      terminal.dispose();
    };
  }, [nodeId, sessionId]);

  return (
    <div className="mt-2 overflow-hidden rounded-md border border-border bg-[#0b0f14]">
      <div className="mono flex items-center gap-2 border-b border-border/60 px-2 py-1 text-[10px] text-muted-foreground">
        <span className="rounded bg-muted/60 px-1 py-0.5 font-semibold uppercase tracking-wide">read-only</span>
        <span className="truncate">{nodeId} · session {sessionId.slice(0, 8)}…</span>
        <span className="ml-auto">
          {state === "waiting" && "waiting for output"}
          {state === "live" && "live"}
          {state === "closed" && "stream ended"}
          {state === "error" && "mirror unavailable (is the fleet on :4181?)"}
        </span>
      </div>
      <div ref={viewportRef} className="max-h-64 overflow-auto p-1" />
    </div>
  );
}
