// src/mesh-terminal-relay-bridge.mjs — the WORKER-SIDE half of the milestone 38 /
// story 06 cross-machine terminal BRIDGE (ADR-014). The net-new work: relay a
// worker's live PTY byte stream (the SAME `term.onData` shape terminal-ws.mjs's
// wireSession and mesh-worker-execution.mjs's driveInteractiveClaudeSession both
// already drive) over the FROZEN `mesh-relay.mjs` envelope as a NEW opaque `signal`
// kind — `"terminal-frame"` — routed by (nodeId, sessionId), with ZERO change to
// the relay itself (the m26-leasing property: an unknown `kind` rides the wire,
// forwarded byte-for-byte, `mesh-relay.mjs:279-298,592-602`).
//
// THE FROZEN ENVELOPE STAYS EXACTLY { kind, nodeId, signal } — `sessionId` rides
// INSIDE the opaque `signal` (beside the PTY bytes), never as a fourth top-level
// envelope key (the relay's `parseEnvelope` reads only `{ kind, nodeId }` and never
// parses `signal` content — ADR-014 invariant 2).
//
// READ-ONLY BY CONSTRUCTION (ADR-014 invariant 1 / SECURITY T14): this module has
// NO write-direction sink. `wireTerminalBridge` below subscribes ONLY to
// `term.onData` (the PTY's OUTPUT stream) — it never calls `term.write` and never
// reads anything OTHER than the chunk `term.onData` itself hands it (no credential
// env, no askpass file, no mint reply) — so the streamed signal is sourced
// EXCLUSIVELY from the PTY's own printed output, exactly as SECURITY T14 requires.
import { WebSocket } from "ws";

// The NEW opaque relay `kind` this bridge introduces (ADR-014 decision 1). A single
// source so the bridge and its tests agree on the literal.
export const TERMINAL_FRAME_KIND = "terminal-frame";

// loopbackRelayUrl(config) → string | null — milestone 38 / story 06 (ADR-014
// AMENDMENT 2026-07-19, hardening owed-before-done). The SHARED dial-url derivation for
// BOTH relay transports below (createTerminalRelayPushTransport, the control-side
// loopback push) AND the fleet subscriber (createTerminalMirrorSubscriberTransport,
// mesh-terminal-mirror.mjs) — both import THIS helper.
//
// WHY: `config.mesh.relay.url` is OVERLOADED — its port + path also drive the FABRIC
// control-stream endpoint (mesh-launcher.mjs substitutes the per-peer fabric HOST onto
// that same port/path). An operator who sets `relay.url` to the control node's FABRIC
// address would therefore silently aim the relay legs at the control-STREAM server
// (which speaks the fabric stream protocol, not the relay fan-out) — a wrong-server
// dial that clean-degrades to NO frames with NO error. The relay legs are SAME-MACHINE
// only (serveRelay binds LOOPBACK — mesh-relay.mjs:622), so this derives ONLY the port
// + path from relay.url and FORCES the host to 127.0.0.1, making the loopback leg
// immune to that overload. UNCONFIGURED (`relay.url` absent/blank/malformed) → null,
// the SAME null-degrade the factories already keep (caller returns a null transport).
export function loopbackRelayUrl(config) {
  const raw = config?.mesh?.relay?.url;
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  const port = parsed.port ? `:${parsed.port}` : "";
  return `${parsed.protocol}//127.0.0.1${port}${parsed.pathname}${parsed.search}`;
}

// buildTerminalFrameEnvelope(nodeId, sessionId, bytes) — the FROZEN
// { kind, nodeId, signal } envelope (mesh-relay.mjs / mesh-relay-client.mjs's own
// relayEnvelope/leaseRelayEnvelope shape), with `signal` carrying BOTH the
// sessionId (the routing metadata the relay never parses) and the PTY bytes
// VERBATIM — byte-for-byte what `term.onData` emitted, coerced to a string ONLY
// (never re-encoded/rewritten). A pure projection of its inputs — no fs, no clock,
// no network.
export function buildTerminalFrameEnvelope(nodeId, sessionId, bytes) {
  return {
    kind: TERMINAL_FRAME_KIND,
    nodeId,
    signal: { sessionId: sessionId ?? null, bytes },
  };
}

// wireTerminalBridge(term, { nodeId, sessionId, push }) → { dispose() }.
//
// Subscribes to `term.onData` (duck-typed EXACTLY like terminal-ws.mjs's
// wireSession / mesh-worker-execution.mjs's driveInteractiveClaudeSession already
// consume it — an IPty-shaped object exposing `onData(cb) -> { dispose() }`). For
// EACH emitted chunk it builds the FROZEN envelope (above) and hands it to the
// INJECTED `push(envelope)` — the ONLY thing this function reads to build a frame
// is the chunk `term.onData` itself delivered (SECURITY T14: no credential env, no
// askpass file, no mint reply ever enters the signal).
//
// `sessionId` may be a plain string (fixed for the bridge's lifetime) OR a
// `() => string | null` resolver — the ADR-013 mid-stream-capture case: an
// assignment's REAL session_id is often not yet known on the FIRST few chunks
// (captured only once the ADR-013-amendment transcript-dir watch resolves the
// driven session's own `<session_id>.jsonl`, mesh-worker-execution.mjs's
// `capturedSessionId` — never a PTY-printed marker), so a caller may pass a
// resolver that reads whatever has been captured so far. A still-unresolved
// sessionId rides as `null` — task 01's mirror drops a frame it cannot route
// (ADR-014 invariant 4), so an early, session-less frame is simply dropped
// downstream, never delivered to the wrong card.
//
// PUSH IS FIRE-AND-FORGET (the "accelerator, never floor" discipline every other
// relay push in this codebase keeps, mesh-relay-client.mjs/mesh-presence-loop.mjs):
// a push fault (relay down, transport not yet connected, …) is caught and
// swallowed — it must NEVER stall or crash the PTY session's own data flow. There
// is no durable floor for a live terminal mirror (unlike presence's git write) —
// a dropped frame is simply a gap in the LIVE view, never a correctness fault.
export function wireTerminalBridge(term, { nodeId, sessionId, push } = {}) {
  if (term == null || typeof term.onData !== "function") {
    return { dispose() {} };
  }
  const resolveSessionId = () => (typeof sessionId === "function" ? sessionId() : sessionId ?? null);
  const sub = term.onData((chunk) => {
    const envelope = buildTerminalFrameEnvelope(nodeId, resolveSessionId(), String(chunk));
    try {
      const result = push?.(envelope);
      if (result && typeof result.catch === "function") {
        result.catch(() => {
          // a relay push fault must never stall/crash the PTY session — the frame is
          // simply lost from the live mirror (no durable floor for a terminal mirror).
        });
      }
    } catch {
      // a synchronous push fault is swallowed for the exact same reason.
    }
  });
  return {
    dispose() {
      try {
        sub?.dispose?.();
      } catch {
        // already disposed — nothing to do.
      }
    },
  };
}

// createTerminalRelayPushTransport(config, { timeoutMs }) →
// { push(envelope): Promise<void>, close() } | null — the PRODUCTION push
// transport: a PERSISTENT ws@8 socket to `config.mesh.relay.url`, mirroring
// mesh-presence-subscriber.mjs's `createSubscriberTransport` connect() shape
// (m23/ADR-003 — resolve on the broker's `{ type:'joined' }` ack), but for
// SENDING: a live PTY emits many frames per second, so — unlike
// mesh-relay-client.mjs's ONE-SHOT connect→push-one-frame→dispose presence
// client — this transport connects ONCE (lazily, on the first push) and REUSES
// the SAME socket for every subsequent push. UNCONFIGURED (no
// config.mesh.relay.url) returns null so wireTerminalBridge's caller degrades to
// "no push attempted" (the same clean-degrade posture mesh-relay-client.mjs's
// createRelayClient keeps). Real-socket behaviour is exercised by the @manual
// two-machine soak (task 03), not @executable CI — this stays a thin seam,
// exactly like createRelayClient / createSubscriberTransport.
export function createTerminalRelayPushTransport(config, { timeoutMs = 3000 } = {}) {
  // ADR-014 AMENDMENT hardening — dial the FORCED-LOOPBACK url (loopbackRelayUrl),
  // never the raw config.mesh.relay.url whose host is overloaded onto the fabric
  // control-stream endpoint. Unconfigured -> null -> the caller degrades to no push.
  const url = loopbackRelayUrl(config);
  if (url == null) {
    return null;
  }

  let socket = null;
  let connecting = null;

  function connectOnce() {
    if (socket != null && socket.readyState === WebSocket.OPEN) {
      return Promise.resolve(socket);
    }
    if (connecting != null) return connecting;
    connecting = new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          try { ws.close(); } catch { /* noop */ }
          reject(new Error("terminal relay connect: join-ack timeout"));
        }
      }, timeoutMs);
      ws.on("message", (data) => {
        let parsed = null;
        try { parsed = JSON.parse(data.toString()); } catch { /* raw frame */ }
        if (parsed && parsed.type === "joined" && !settled) {
          settled = true;
          clearTimeout(timer);
          socket = ws;
          resolve(ws);
        }
      });
      ws.on("error", (error) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(error); return; }
        socket = null;
      });
      ws.on("close", () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("terminal relay connect: socket closed before the join ack"));
          return;
        }
        socket = null;
      });
    }).finally(() => {
      connecting = null;
    });
    return connecting;
  }

  return {
    async push(envelope) {
      const ws = await connectOnce();
      return new Promise((resolve, reject) => {
        ws.send(JSON.stringify(envelope), (error) => (error ? reject(error) : resolve()));
      });
    },
    close() {
      try { socket?.close(); } catch { /* already closing */ }
      socket = null;
    },
  };
}
