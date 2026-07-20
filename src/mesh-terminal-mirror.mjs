// src/mesh-terminal-mirror.mjs — the FLEET-FACE half of the milestone 38 / story 06
// cross-machine terminal BRIDGE (ADR-014, carve-out #2). An IN-MEMORY EPHEMERAL
// mirror of the relayed `"terminal-frame"` signals (src/mesh-terminal-relay-
// bridge.mjs), keyed by the (nodeId, sessionId) routing tuple — the
// mesh-presence-subscriber pattern (m23/ADR-004; RETIRED at m33/ADR-002.1's cutover
// to the fabric peer-map, but its DISCIPLINE — an in-memory ephemeral tail applying
// a fanned-out relay signal, writing NO durable record, NEVER a second system of
// record — is exactly what this module follows): kill it and the fleet loses the
// LIVE terminal VIEW, not data (a run's durable bookkeeping is the run record; its
// diff is story 07's push).
//
// PURE IN-MEMORY — NO fs, NO record schema, NO durable write. This module imports
// NEITHER a durable-write seam (node:fs / node:fs/promises / fs.mjs / mesh-
// presence.mjs / mesh-store.mjs) NOR references publishPresenceRecord /
// presenceRecordPath / writeText / writeFile — the applied frame is provably a
// live projection, never an authority. The arch-test
// acd-fleet-terminal-mirror-read-only (task 02) enforces this discipline
// structurally over this module's source.
//
// A LIVE TAIL, NEVER A REPLAY LOG (task 01 scenario 1): the mirror holds NO past
// bytes at all — it only forwards each frame, as it arrives, to whichever
// (nodeId, sessionId) subscribers are CURRENTLY subscribed. A client that
// subscribes AFTER frames have flowed sees nothing that already passed; discarding
// and recreating the mirror yields an empty mirror.
//
// UNRESOLVABLE FRAMES ARE DROPPED, NEVER BROADCAST (ADR-014 invariant 4 / task 01
// scenario 3): a frame whose (nodeId, sessionId) matches no open subscription is
// simply not delivered anywhere — it is not an error, and it never disturbs an
// unrelated (nodeId, sessionId)'s live stream.
import { WebSocket } from "ws";
import { DEFAULT_MAX_FRAME_BYTES, resolveMaxFrameBytes } from "./mesh-relay.mjs";
import { TERMINAL_FRAME_KIND, loopbackRelayUrl } from "./mesh-terminal-relay-bridge.mjs";

export { resolveMaxFrameBytes };

// routingKey(nodeId, sessionId) — the ONE (nodeId, sessionId) → string key both
// apply() and subscribe() use, so the two sides can never drift on how a tuple is
// joined. A missing half never matches anything (no accidental "undefined::x").
function routingKey(nodeId, sessionId) {
  if (typeof nodeId !== "string" || nodeId.length === 0) return null;
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  return `${nodeId}::${sessionId}`;
}

// createTerminalMirror() — the in-memory, EPHEMERAL, live-tail mirror. A plain
// closure over a Map<routingKey, Set<listener>> — no fs handle, no socket held
// here (transport is a SEPARATE, injected concern — startTerminalMirrorSubscriber
// below). Holds ZERO bytes once delivered: a frame is forwarded synchronously to
// the CURRENT listener set for its tuple and then discarded — nothing is buffered
// for a future subscriber (the never-a-replay-log invariant).
export function createTerminalMirror() {
  const listenersByKey = new Map();

  return {
    // apply(envelope) → boolean (true iff the frame was delivered to at least one
    // listener). IGNORES anything that is not a well-formed terminal-frame
    // envelope carrying a resolvable (nodeId, sessionId) — returns false (never
    // throws) unless:
    //   - envelope is a non-null object,
    //   - envelope.kind === TERMINAL_FRAME_KIND (a presence/lease/unknown kind is
    //     ignored — this mirror is kind-blind to everything else, exactly as the
    //     presence cache ignores kind:"lease"),
    //   - envelope.signal is a non-null object carrying a string sessionId,
    //   - envelope.nodeId is a non-empty string.
    // A frame whose (nodeId, sessionId) matches no open subscription is DROPPED —
    // never broadcast to an unrelated card, never an error, never tears down an
    // existing stream (ADR-014 invariant 4).
    apply(envelope) {
      if (envelope == null || typeof envelope !== "object") return false;
      if (envelope.kind !== TERMINAL_FRAME_KIND) return false;
      const signal = envelope.signal;
      if (signal == null || typeof signal !== "object") return false;
      const key = routingKey(envelope.nodeId, signal.sessionId);
      if (key == null) return false;
      const listeners = listenersByKey.get(key);
      if (listeners == null || listeners.size === 0) return false;
      for (const listener of listeners) {
        try {
          listener(signal.bytes);
        } catch {
          // a listener fault must never break delivery to the OTHER listeners, nor
          // crash the mirror's own apply() — the never-crash discipline every
          // other mesh consumer in this codebase keeps.
        }
      }
      return true;
    },

    // subscribe(nodeId, sessionId, listener) → unsubscribe(). Registers a listener
    // for EXACTLY this (nodeId, sessionId) tuple — it receives ONLY frames whose
    // routing tuple matches (no cross-talk between streams, task 01's multiplex
    // scenario). A resolvable-but-empty tuple (no nodeId/sessionId supplied) never
    // matches anything (routingKey returns null) — subscribing is then a no-op
    // that always returns a safe unsubscribe().
    subscribe(nodeId, sessionId, listener) {
      const key = routingKey(nodeId, sessionId);
      if (key == null || typeof listener !== "function") {
        return () => {};
      }
      let set = listenersByKey.get(key);
      if (set == null) {
        set = new Set();
        listenersByKey.set(key, set);
      }
      set.add(listener);
      return () => {
        const current = listenersByKey.get(key);
        if (current == null) return;
        current.delete(listener);
        if (current.size === 0) listenersByKey.delete(key);
      };
    },

    // size → the count of DISTINCT (nodeId, sessionId) tuples with at least one
    // live listener (diagnostic-only; never used for a routing/admission decision).
    get size() {
      return listenersByKey.size;
    },
  };
}

// parseInboundTerminalFrame(data, maxFrameBytes) → the parsed envelope, or null.
// NEVER throws. The consumer-side mirror of serveRelay's own parseEnvelope, plus
// the over-limit floor — the SAME shape mesh-presence-subscriber.mjs's
// parseInboundFrame kept (m23/ADR-003): over-limit first (dropped before parsing),
// then a guarded JSON.parse, then an envelope-shape check (`kind` is a string).
// `signal` content is NOT inspected here — createTerminalMirror's own apply()
// decides whether the kind/shape is one it stores, keeping this parse
// payload-agnostic about signal CONTENT.
function frameByteLength(data) {
  if (data == null) return 0;
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + frameByteLength(part), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return Buffer.byteLength(String(data));
}

export function parseInboundTerminalFrame(data, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
  if (frameByteLength(data) > maxFrameBytes) return null;
  const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString() : String(data);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (value == null || typeof value !== "object") return null;
  if (typeof value.kind !== "string") return null;
  return value;
}

// startTerminalMirrorSubscriber({ transport, mirror, maxFrameBytes }) →
// { connected, stop() }. Wires an INJECTED transport { onMessage(fn), connect(),
// close?() } to the mirror so each inbound relay frame is parsed + applied —
// mirroring mesh-presence-subscriber.mjs's startPresenceSubscriber shape exactly
// (the SAME @executable feasibility lever: a fanned-out frame is delivered
// synchronously in CI with no real ws server; the production socket path
// (createTerminalMirrorSubscriberTransport, below) is exercised only by the
// @manual two-machine soak).
//
// GRACEFUL DEGRADATION: transport == null (the unconfigured relay) is a CLEAN
// degrade — { connected:false, stop(){} }, no crash. A connect() that throws
// (relay down/unreachable) is caught → connected:false; the fleet face still
// serves its terminal-VIEW route, simply with nothing flowing through it yet.
export async function startTerminalMirrorSubscriber({ transport, mirror, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES } = {}) {
  if (transport == null) {
    return { connected: false, stop() {} };
  }

  transport.onMessage((data) => {
    try {
      const frame = parseInboundTerminalFrame(data, maxFrameBytes);
      mirror?.apply(frame);
    } catch {
      // never-crash: ignore a bad frame, keep the persistent connection.
    }
  });

  let connected = false;
  try {
    await transport.connect();
    connected = true;
  } catch {
    connected = false;
  }

  return {
    connected,
    stop() {
      try {
        transport.close?.();
      } catch {
        // already closing — nothing to dispose.
      }
    },
  };
}

// createTerminalMirrorSubscriberTransport(config, { timeoutMs }) →
// { onMessage(fn), connect(), close() } | null — the PRODUCTION persistent
// SUBSCRIBE transport, modelled on mesh-presence-subscriber.mjs's
// createSubscriberTransport (byte-for-byte the SAME connect/ack/deliver shape):
// ONE socket, opened once, delivering EVERY non-ack inbound frame to the
// registered onMessage handler for the socket's whole lifetime. Unconfigured (no
// config.mesh.relay.url) returns null so the caller degrades to "the mirror never
// receives a live frame" rather than crashing the fleet face. Real-socket
// behaviour is exercised by the @manual soak, not @executable CI.
export function createTerminalMirrorSubscriberTransport(config, { timeoutMs = 3000 } = {}) {
  // ADR-014 AMENDMENT hardening — subscribe over the FORCED-LOOPBACK url
  // (loopbackRelayUrl), never the raw config.mesh.relay.url whose host is overloaded
  // onto the fabric control-stream endpoint (a non-loopback host would silently point
  // this subscriber at the wrong server -> no frames). Unconfigured -> null -> the
  // fleet mirror simply never receives a live frame (the same clean-degrade).
  const url = loopbackRelayUrl(config);
  if (url == null) {
    return null;
  }

  let socket = null;
  let handler = null;

  return {
    onMessage(fn) {
      handler = fn;
    },
    connect() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch { /* noop */ }
            reject(new Error("terminal mirror subscribe: join-ack timeout"));
          }
        }, timeoutMs);
        ws.on("message", (data) => {
          let parsed = null;
          try { parsed = JSON.parse(data.toString()); } catch { /* raw/opaque frame */ }
          if (parsed && parsed.type === "joined" && !settled) {
            settled = true;
            clearTimeout(timer);
            socket = ws;
            resolve(ws);
            return;
          }
          if (parsed && parsed.type === "joined") return;
          if (handler) {
            try { handler(data); } catch { /* the handler never-crashes on its own */ }
          }
        });
        ws.on("error", (error) => {
          if (!settled) { settled = true; clearTimeout(timer); reject(error); }
        });
        ws.on("close", () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error("terminal mirror subscribe: socket closed before the join ack"));
          }
        });
      });
    },
    close() {
      try { socket?.close(); } catch { /* already closing */ }
      socket = null;
    },
  };
}
