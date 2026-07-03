// src/mesh-presence-subscriber.mjs — the NODE-SIDE PERSISTENT relay SUBSCRIBER
// (milestone 23 / story 02 / ADR-003, finding F1 — the missing CONSUMER hop). m23 shipped
// the PUSH (mesh:heartbeat's best-effort relay push), the BROKER (serveRelay fans a frame
// out to connected peers), and the GIT-READ status render — but NO node-side consumer:
// createRelayClient is PUSH-ONLY (connect → push ONE frame → dispose), so a fanned-out
// signal reached nobody and mesh:status only ever changed after a ≤30s git sync. This
// module closes the last hop of the observable's data-path: producer → transport →
// **consumer** → render.
//
// It is the READ-SIDE MIRROR of the push seam (ADR-003 / fitness #4): the push accelerates
// WRITES; this accelerates READS. It holds ONE persistent connection to the control node's
// relay and, on EACH fanned-out { kind:"presence" } frame, applies the opaque signal into
// the in-memory liveness cache (src/mesh-presence-cache.mjs) mesh:status reads — so a peer's
// pushed change surfaces ≤5s over the relay, WITHOUT a git sync. Git stays the durable
// authority: the cache is a fast-path projection, never a second system of record.
//
// NEVER-CRASH / GRACEFUL DEGRADATION (03/ADR-003 + fitness #4, consumer-side): a bad inbound
// frame (malformed / non-JSON / oversized / unknown-kind) is IGNORED — the handler never
// throws and the persistent connection is kept. A relay that is DOWN / unreachable /
// unconfigured is a CLEAN degrade: startPresenceSubscriber resolves with connected:false and
// never throws or blocks the status/heartbeat path. Correctness NEVER depends on the relay
// (mesh:status still renders the ≤30s git-synced records) — the relay is the accelerator,
// git is the floor.
//
// STATELESS CONSUMER (fitness #1, consumer-side): this module performs NO durable write and
// imports NEITHER a record-schema persistence seam (mesh-store.mjs's
// publishPresenceRecord/presenceRecordPath) NOR mesh-presence.mjs's write path NOR node:fs —
// it applies into the in-memory cache ONLY. The only imports are the frame-size seam from
// mesh-relay.mjs (DEFAULT_MAX_FRAME_BYTES / resolveMaxFrameBytes — shared with the broker so
// the over-limit contract is one number) and the production ws@8 socket. The arch-test
// acd-presence-subscriber-cache-only (fitness #7, ADR-004) enforces this discipline over
// this module's source.
import { WebSocket } from "ws";
import { DEFAULT_MAX_FRAME_BYTES, resolveMaxFrameBytes } from "./mesh-relay.mjs";

// resolveMaxFrameBytes is re-exported so a caller building the production transport can size
// the parse from config through ONE seam (the same number serveRelay enforces on the wire).
export { resolveMaxFrameBytes };

// The byte-length of an inbound ws frame, tolerant of Buffer / ArrayBuffer / ArrayBuffer
// view / array-of-Buffer / string shapes (ws delivers any of these depending on
// fragmentation). The SAME frameByteLength shape serveRelay's hand-rolled over-limit check
// uses — measured in BYTES, never characters — so the consumer-side limit matches the wire.
function frameByteLength(data) {
  if (data == null) return 0;
  if (Buffer.isBuffer(data)) return data.length;
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + frameByteLength(part), 0);
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  return Buffer.byteLength(String(data));
}

// parseInboundFrame(data, maxFrameBytes) → the parsed envelope object, or null. NEVER
// throws. The consumer-side mirror of serveRelay's parseEnvelope, plus the over-limit floor:
//   (1) OVER-LIMIT FIRST: a frame whose byte length exceeds maxFrameBytes is dropped (null)
//       before any parse — the same defence the broker applies, applied read-side.
//   (2) COERCE TO TEXT + JSON.parse in a try/catch → null on any parse failure (a malformed
//       / non-JSON frame is ignored, never a throw).
//   (3) ENVELOPE SHAPE: a parsed value that is not a non-null object, or whose `kind` is not
//       a string, is null (a frame missing `kind` is ignored). `signal` content is NOT read
//       here — the cache's apply() decides whether the kind/record is one it stores, so this
//       parse stays payload-agnostic about signal CONTENT (the ADR-001 discipline, read-side).
export function parseInboundFrame(data, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES) {
  // (1) Over-limit — drop before parsing (never allocate/parse an enormous frame).
  if (frameByteLength(data) > maxFrameBytes) return null;

  // (2) Coerce to text + parse. A binary/odd frame stringifies to something JSON.parse
  // rejects → null. Never throws.
  const text = typeof data === "string" ? data : Buffer.isBuffer(data) ? data.toString() : String(data);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }

  // (3) Envelope shape: a non-null object with a string `kind`. `signal` is left untouched.
  if (value == null || typeof value !== "object") return null;
  if (typeof value.kind !== "string") return null;
  return value;
}

// startPresenceSubscriber({ transport, cache, leaseCache, maxFrameBytes }) →
// { connected, stop() }.
// Wire an injected transport { onMessage(fn), connect(), close?() } to the liveness cache so
// EACH inbound frame is parsed + applied. The transport is INJECTED (the @executable
// feasibility lever, mirroring the injected relay client of task 00): a fanned-out frame can
// be delivered synchronously in CI with NO real ws server, NO wall-clock; the production
// socket path (createSubscriberTransport) is exercised by the @manual fleet spike only.
//
// THE ADDITIVE LEASE BRANCH (m26 / ADR-004.2): the optional `leaseCache` (a
// createLeaseCache instance) receives the SAME parsed frame — each cache's own apply()
// decides what it stores (the presence cache ignores kind:"lease", the lease cache
// ignores kind:"presence"), so the ONE handler applies BOTH kinds with no kind branch
// here (the parse stays payload-agnostic). Backwards-compatible: callers that pass no
// leaseCache behave exactly as before. Both applies stay IN MEMORY ONLY — this module
// still performs no durable write and imports no persist seam (fitness #11,
// acd-lease-cache-only, extending the fitness-#7 cache-only gate).
//
// GRACEFUL DEGRADATION (fitness #4, read-side): transport == null (the unconfigured relay) is
// a CLEAN degrade — return { connected:false, stop(){} } with no crash, no throw. A
// connect() that throws (relay down / unreachable) is CAUGHT → connected:false; the
// subscriber neither crashes nor blocks the status/heartbeat path. mesh:status still renders
// the ≤30s git-synced records.
//
// PERSISTENT (the property createRelayClient lacked): ONE connection; the handler applies
// EACH inbound frame; the connection is NOT torn down between frames. The handler is
// registered BEFORE connect() so no early frame is missed, and it NEVER throws (a bad frame
// is swallowed so the persistent connection is kept).
export async function startPresenceSubscriber({ transport, cache, leaseCache, maxFrameBytes = DEFAULT_MAX_FRAME_BYTES } = {}) {
  // Unconfigured relay ⇒ clean degrade: no transport to subscribe over. No crash, no throw
  // — mesh:status simply reads git only (the floor).
  if (transport == null) {
    return { connected: false, stop() {} };
  }

  // Register the message handler BEFORE connecting so an early fanned-out frame is not
  // missed. The handler NEVER throws: a bad frame is ignored (parseInboundFrame → null →
  // apply(null) → false) and the persistent connection is kept. The try/catch is the
  // never-crash belt (a truly odd transport delivery must not tear down the subscriber).
  // ONE parse, BOTH applies (m26 / ADR-004.2): each cache's own apply() ignores the kind
  // it does not store, so the handler stays kind-blind — and both applies are in-memory
  // only (no durable write, fitness #11).
  transport.onMessage((data) => {
    try {
      const frame = parseInboundFrame(data, maxFrameBytes);
      cache?.apply(frame);
      leaseCache?.apply(frame);
    } catch {
      // never-crash: ignore a bad frame, keep the persistent connection.
    }
  });

  // Best-effort connect: a relay-down / unreachable / unconfigured connect is CAUGHT, never
  // thrown (the read-side mirror of ADR-003 / fitness #4). connected reflects whether the
  // one persistent connection came up; either way the subscriber returns cleanly.
  let connected = false;
  try {
    await transport.connect();
    connected = true;
  } catch {
    connected = false;
  }

  return {
    connected,
    // stop() disposes the ONE persistent connection. Guarded so a half-open / already-closing
    // transport can never throw out of teardown.
    stop() {
      try {
        transport.close?.();
      } catch {
        // already closing — nothing to dispose.
      }
    },
  };
}

// createSubscriberTransport(config, { timeoutMs }) → { onMessage(fn), connect(), close() } |
// null. The PRODUCTION ws@8 transport, or null when UNCONFIGURED (no config.mesh.relay.url)
// so startPresenceSubscriber degrades to the git floor. Modelled on createRelayClient.connect
// (src/mesh-relay-client.mjs) but PERSISTENT: connect() opens ONE socket, resolves on the
// { type:"joined" } ack (rejecting on error / close-before-ack / timeout), and thereafter
// delivers EVERY non-ack inbound frame to the registered onMessage handler — it does NOT
// close after the first frame (the exact property the push-only client lacked). This real
// socket path is exercised by the @manual fleet spike, NOT @executable CI — it stays a thin
// seam.
export function createSubscriberTransport(config, { timeoutMs = 3000 } = {}) {
  const url = config?.mesh?.relay?.url;
  // Unconfigured — no url to subscribe over: null so the subscriber degrades to git only.
  if (typeof url !== "string" || url.length === 0) {
    return null;
  }

  let socket = null;
  // The registered inbound-frame handler (startPresenceSubscriber sets it via onMessage
  // BEFORE connect()). Held so every non-ack frame after the join ack is delivered to it.
  let handler = null;

  return {
    // Register the handler that receives EACH non-ack inbound frame. Called before connect()
    // so no early frame is missed once the socket delivers.
    onMessage(fn) {
      handler = fn;
    },

    // Open the ONE persistent socket and resolve on the join ack (the same barrier the relay
    // client awaits). Rejects on a socket error, a clean close BEFORE the ack, or an ack
    // timeout — the caller's try/catch (in startPresenceSubscriber) swallows it (degrade to
    // git). After the ack, every non-ack frame is delivered to the registered handler; the
    // socket is NOT closed between frames (persistent).
    connect() {
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let settled = false;
        const timer = setTimeout(() => {
          if (!settled) {
            settled = true;
            try { ws.close(); } catch { /* noop */ }
            reject(new Error("relay subscribe: join-ack timeout"));
          }
        }, timeoutMs);
        ws.on("message", (data) => {
          // Read just enough to distinguish the join ACK from a fanned-out frame. The ack is
          // the connect barrier; every OTHER frame is delivered to the persistent handler
          // (its own try/catch decides what to apply — this transport stays payload-agnostic).
          let parsed = null;
          try { parsed = JSON.parse(data.toString()); } catch { /* raw/opaque frame */ }
          if (parsed && parsed.type === "joined" && !settled) {
            settled = true;
            clearTimeout(timer);
            socket = ws;
            resolve(ws);
            return;
          }
          // A control-frame ack after settle (there is only one) is ignored; every other
          // frame is a fanned-out envelope — deliver the RAW bytes to the handler.
          if (parsed && parsed.type === "joined") return;
          if (handler) {
            try { handler(data); } catch { /* the handler never-crashes on its own */ }
          }
        });
        ws.on("error", (error) => {
          if (!settled) { settled = true; clearTimeout(timer); reject(error); }
          // A post-ack error simply ends the persistent connection; startPresenceSubscriber
          // already resolved connected:true. The next mesh:status still reads git.
        });
        ws.on("close", () => {
          if (!settled) {
            settled = true;
            clearTimeout(timer);
            reject(new Error("relay subscribe: socket closed before the join ack"));
          }
        });
      });
    },

    // Dispose the persistent socket.
    close() {
      try { socket?.close(); } catch { /* already closing */ }
      socket = null;
    },
  };
}
