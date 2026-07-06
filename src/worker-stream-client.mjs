// src/worker-stream-client.mjs — the worker's persistent live-state stream client
// (milestone 34 / story 04, ADR-007). A worker opens and holds a connection to the
// control node and streams work-state as it happens: the FIRST frame on any
// (re)connection is a full SNAPSHOT, subsequent work-state changes are DELTAs; a drop
// reconnects with growing/capped backoff and re-sends a snapshot first; a stream
// fault NEVER blocks or rolls back a local work write (ADR-004 failure isolation,
// extended to the live stream).
//
// THE WIRE FRAME (an ADR-007 open question this build resolves — documented, not
// frozen elsewhere): { kind: "snapshot" | "delta", nodeId, workspaceId, items, at }.
//   - "snapshot" — items is the FULL current item-row array for the workspace (the
//                  SAME row shape global-work-store.mjs's readWorkspaceProjectionItems
//                  produces: { ref, type, slug, status, title, parent, sourcePath }).
//   - "delta"    — items is the array of CHANGED rows only (typically one).
// `at` is the ISO timestamp the frame was assembled (the injected clock, never
// wall-clock in a test).
//
// THE TRANSPORT SEAM: `transport` is INJECTED — { connect(), send(frame), close(),
// onDrop(handler) } — production wires createWorkerWsTransport() (a persistent ws@8
// socket), tests wire a fake recorder/dropper (the STORY.md build-note: the
// one-shot mesh-relay-client fake does not fit a persistent multi-frame channel, so
// this is NET-NEW test infrastructure). connect() may reject (fault); send() may
// reject/throw (fault) — BOTH are caught here and NEVER propagate to the caller of
// streamWorkerState()/notify() (ADR-004: a stream fault is a warning, never a
// rethrow).
//
// THE BACKOFF SCHEDULE (pure function, no wall clock): attempt n (1-based, the COUNT
// of consecutive drops so far) → delaySeconds = min(2^(n-1), 30). n=1→1s, 2→2s,
// 3→4s, 9→30s (the STORY.md examples, verbatim).
export function backoffDelaySeconds(attempt) {
  const n = Number.isInteger(attempt) && attempt > 0 ? attempt : 1;
  return Math.min(2 ** (n - 1), 30);
}

// buildSnapshotFrame(nodeId, workspaceId, items, now) — the FULL-state frame sent as
// the first frame on any (re)connection. A pure projection — no read, no clock other
// than the injected `now`.
export function buildSnapshotFrame(nodeId, workspaceId, items, now) {
  return { kind: "snapshot", nodeId, workspaceId, items: Array.isArray(items) ? [...items] : [], at: now };
}

// buildDeltaFrame(nodeId, workspaceId, items, now) — a CHANGED-rows-only frame. A
// pure projection, same shape family as the snapshot frame (kind differs).
export function buildDeltaFrame(nodeId, workspaceId, items, now) {
  return { kind: "delta", nodeId, workspaceId, items: Array.isArray(items) ? [...items] : [], at: now };
}

// createWorkerStreamClient({ transport, ticker, nodeId, workspaceId, now, onWarning })
// → { connect(), sendSnapshot(items), sendDelta(items), notifyDrop(), stop() }.
//
// The self-healing session object: on connect() (first call, or after notifyDrop()
// schedules + fires a reconnect), the FIRST frame sent on the new connection is
// ALWAYS a snapshot (the caller supplies the CURRENT full item set to connect() so a
// reconnect can re-snapshot without the caller re-deriving "am I fresh"). Every
// send() after that connect is a delta until the next reconnect.
//
//   transport   — INJECTED { connect(): Promise<handle>, send(handle, frame):
//                 Promise<void>, close(handle): void }. Production default is
//                 createWorkerWsTransport() (a real ws@8 socket to the resolved
//                 control-node dial address).
//   ticker      — INJECTED { start(intervalSeconds, onTick) -> handle, stop(handle) }
//                 (the launcher intervalTicker-compatible contract) driving the backoff
//                 reconnect timer. Defaults to the real intervalTicker() import when
//                 absent — but tests always inject a manual one (no wall-clock wait).
//   nodeId, workspaceId — carried on every frame.
//   now         — () => string | string, the injected clock for frame timestamps.
//   onWarning   — (warning) => void, invoked (never thrown) when a connect/send fault
//                 occurs — the ADR-004 failure-isolation surface: the caller's local
//                 work write already happened; this is a best-effort side channel.
//
// FAILURE ISOLATION: every transport call is wrapped in try/catch. A connect/send
// fault NEVER rejects out of sendSnapshot/sendDelta/notifyDrop — it is reported via
// onWarning and the session marks itself disconnected (a fault behaves exactly like a
// drop: the NEXT successful send re-snapshots).
export function createWorkerStreamClient({
  transport,
  ticker,
  nodeId,
  workspaceId,
  now = () => new Date().toISOString(),
  onWarning = () => {},
} = {}) {
  let handle = null;
  let connected = false;
  let needsSnapshot = true; // the very first frame on the very first connection is a snapshot too
  let consecutiveDrops = 0;
  let reconnectHandle = null;
  let stopped = false;

  const resolveNow = () => (typeof now === "function" ? now() : now);

  const warn = (code, error) => {
    onWarning({ code, message: error?.message ?? String(error ?? "stream fault"), path: null });
  };

  // markDropped() — a connect/send fault OR an explicit notifyDrop(): the session
  // is no longer connected, so the NEXT frame (once reconnected) must be a snapshot.
  function markDropped() {
    connected = false;
    needsSnapshot = true;
    if (handle != null) {
      try { transport.close(handle); } catch { /* already gone */ }
    }
    handle = null;
  }

  // ensureConnected() — connect the transport if not already connected. A connect
  // fault is caught (ADR-004) and reported via onWarning; the session stays
  // disconnected (the caller's send is then skipped, never thrown).
  //
  // review fix P0.4: consecutiveDrops resets HERE, on a successful (re)connect —
  // not only in sendFrame's success branch. A clean reconnect that then sits idle
  // (no send yet) used to leave the counter high, so the NEXT drop's backoff would
  // escalate toward the 30s cap even though the connection in between was healthy.
  async function ensureConnected() {
    if (connected) return true;
    try {
      handle = await transport.connect();
      connected = true;
      consecutiveDrops = 0;
      return true;
    } catch (error) {
      warn("worker-stream-connect-failed", error);
      markDropped();
      return false;
    }
  }

  // sendFrame(frame) — the ONE transport-facing send, wrapped for failure isolation.
  // A send fault is caught, reported, and marks the session dropped (so the next
  // attempt re-snapshots) — it NEVER rejects to the caller.
  async function sendFrame(frame) {
    const ok = await ensureConnected();
    if (!ok) return { sent: false };
    try {
      await transport.send(handle, frame);
      consecutiveDrops = 0;
      return { sent: true };
    } catch (error) {
      warn("worker-stream-send-failed", error);
      markDropped();
      return { sent: false };
    }
  }

  // sendSnapshot(items) — always the SNAPSHOT frame kind, regardless of prior state
  // (a caller may force a re-sync at any time). Successfully sending it clears the
  // "needs a snapshot next" flag.
  async function sendSnapshot(items) {
    const result = await sendFrame(buildSnapshotFrame(nodeId, workspaceId, items, resolveNow()));
    if (result.sent) needsSnapshot = false;
    return result;
  }

  // sendDelta(items) — the delta frame kind UNLESS the session currently needs a
  // fresh snapshot (fresh connection / just-recovered-from-a-drop): the FRAME
  // CONTRACT is enforced HERE, not by caller discipline — "the first frame on any
  // (re)connection is a full snapshot" holds even if the caller calls sendDelta()
  // first after a drop (the contract wins over the caller's requested kind; the
  // caller supplies `fullItems` for exactly this case — see the class doc-comment).
  async function sendDelta(deltaItems, { fullItems } = {}) {
    if (needsSnapshot) {
      const items = Array.isArray(fullItems) ? fullItems : deltaItems;
      return sendSnapshot(items);
    }
    return sendFrame(buildDeltaFrame(nodeId, workspaceId, deltaItems, resolveNow()));
  }

  // notifyDrop() — an explicit signal the connection dropped (production wires this
  // from the transport's own onDrop/close event); schedules a backoff reconnect over
  // the injected ticker. The reconnect itself does not resend a frame on its own — a
  // subsequent sendSnapshot/sendDelta call re-connects and the FRAME CONTRACT
  // (needsSnapshot) guarantees the next frame sent is a snapshot.
  function notifyDrop() {
    if (stopped) return;
    markDropped();
    consecutiveDrops += 1;
    const delaySeconds = backoffDelaySeconds(consecutiveDrops);
    if (ticker == null) return { scheduledDelaySeconds: delaySeconds };
    reconnectHandle = ticker.start(delaySeconds, () => {
      ticker.stop(reconnectHandle);
      reconnectHandle = null;
      // The reconnect attempt itself: connect now, so a subsequent send finds the
      // transport already up. A fault here is caught by ensureConnected/markDropped
      // and simply re-schedules on the NEXT explicit notifyDrop() (production calls
      // notifyDrop again from the transport's error/close handler).
      ensureConnected().catch(() => {});
    });
    return { scheduledDelaySeconds: delaySeconds };
  }

  function stop() {
    stopped = true;
    if (reconnectHandle != null && ticker != null) {
      ticker.stop(reconnectHandle);
      reconnectHandle = null;
    }
    markDropped();
  }

  return {
    ensureConnected,
    sendSnapshot,
    sendDelta,
    notifyDrop,
    stop,
    get connected() { return connected; },
    get needsSnapshot() { return needsSnapshot; },
    get consecutiveDrops() { return consecutiveDrops; },
  };
}

// createWorkerWsTransport(url, { WebSocketImpl } = {}) → { connect, send, close,
// onDrop } — the PRODUCTION transport: a persistent ws@8 socket to the resolved
// control-node dial address (never a hand-derived URL — the caller resolves `url`
// via mesh-fabric's resolvePeers). connect() resolves once the socket is OPEN;
// send() JSON-serialises the frame and writes it; close() disposes the socket.
// Exercised for real only by the @manual two-machine soak (task 04) — @executable
// coverage always injects a fake transport (the STORY.md build-note: a persistent
// multi-frame channel needs a net-new double, the one-shot mesh-relay-client fake
// does not fit).
//
// onDrop(handler) — review fix P1.7b: registers the ONE handler the launcher
// bridges to the client's own notifyDrop() when the CURRENT connected socket
// closes/errors post-open (a pre-open error is already reported through connect()'s
// own rejection, never double-reported here). Additive — a caller that never calls
// onDrop gets byte-identical connect/send/close behaviour.
export function createWorkerWsTransport(url, { WebSocketImpl } = {}) {
  let dropHandler = null;
  let currentSocket = null;
  return {
    async connect() {
      const { WebSocket } = WebSocketImpl ? { WebSocket: WebSocketImpl } : await import("ws");
      return new Promise((resolve, reject) => {
        const ws = new WebSocket(url);
        let settled = false;
        ws.on("open", () => {
          if (!settled) {
            settled = true;
            currentSocket = ws;
            resolve(ws);
          }
        });
        ws.on("error", (error) => {
          if (!settled) { settled = true; reject(error); return; }
          // A post-open error is a drop, not a connect fault — bridged the same as
          // "close" below (either can fire first depending on the failure mode).
          if (currentSocket === ws) {
            currentSocket = null;
            dropHandler?.();
          }
        });
        ws.on("close", () => {
          if (!settled) return; // a pre-open close is surfaced via the error branch above
          if (currentSocket === ws) {
            currentSocket = null;
            dropHandler?.();
          }
        });
      });
    },
    async send(ws, frame) {
      return new Promise((resolve, reject) => {
        ws.send(JSON.stringify(frame), (error) => (error ? reject(error) : resolve()));
      });
    },
    close(ws) {
      if (currentSocket === ws) currentSocket = null;
      try { ws.close(); } catch { /* already closing */ }
    },
    onDrop(handler) {
      dropHandler = typeof handler === "function" ? handler : null;
    },
  };
}
