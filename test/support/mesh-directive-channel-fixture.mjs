// Shared NET-NEW test infrastructure for milestone 35 / story 01 (the control→worker
// command channel): a PERSISTENT, BIDIRECTIONAL fake channel extending the 34/story-04
// one-way fakes (test/control-stream-server.test.mjs's admission/apply units,
// test/worker-stream-client.test.mjs's fakeTransport). Budgeted by STORY.md as "the
// milestone's biggest harness piece" — used across all three task-01 feature files.
//
// WHY NET-NEW: the 34/story-04 fakes are ONE-WAY (worker -> control only, a single
// fake socket per test). Story 01 needs:
//   (a) a SERVER-SIDE fake ws per connected worker, individually addressable and
//       independently closable/erroring — so "worker-a got exactly one frame,
//       worker-b got none" and "worker-a's socket errors, worker-b's is untouched"
//       are directly observable, matching real ws@8's per-socket close/error
//       semantics `sendDirective`/the targeting map depend on (readyState, etc);
//   (b) a DOWN-CHANNEL delivery path INTO a worker-side onMessage handler — the
//       34/story-04 fakeTransport has no such path (it is send-only, matching the
//       PRE-story-01 worker-stream-client.mjs);
//   (c) an ORDERED PER-SOCKET frame recorder on the server's fan-in side (which
//       frames the SERVER received from which worker) — reused from 34/story-04's
//       applyStreamFrame-driven pattern, unchanged;
//   (d) a scriptable MID-STREAM drop (closing/erroring one named worker's socket
//       without touching any other worker's).
import { WebSocket } from "ws";

// createFakeServerSocket(nodeId) — a MINIMAL stand-in for a real `ws` connection
// object, carrying exactly the surface control-stream-server.mjs's sendDirective
// touches (`readyState`, `send`) plus an ordered recorder of every frame written to
// it (so "worker-a's socket received exactly one frame" is a plain array assertion).
export function createFakeServerSocket(nodeId) {
  const frames = [];
  const socket = {
    nodeId,
    readyState: WebSocket.OPEN,
    frames,
    send(raw) {
      if (socket.readyState !== WebSocket.OPEN) {
        throw new Error(`cannot send on a socket that is not OPEN (state=${socket.readyState})`);
      }
      frames.push(typeof raw === "string" ? JSON.parse(raw) : raw);
    },
    // close()/error() — a scriptable mid-stream drop: flips readyState CLOSED
    // (mirroring ws@8's own constant) so a subsequent sendDirective resolving THIS
    // socket sees it as no-longer-open, exactly as the real close/error handlers'
    // directiveTargets.deleteIfCurrent would have already removed it from the map —
    // both paths are exercised by the fixture below (removeWorker calls both).
    close() {
      socket.readyState = WebSocket.CLOSED;
    },
    error() {
      socket.readyState = WebSocket.CLOSED;
    },
  };
  return socket;
}

// createDirectiveChannelFixture() — the bidirectional fixture: a Map<nodeId,
// fakeServerSocket> standing in for the SAME shape createDirectiveTargetRegistry's
// internal map holds, plus helpers to connect/disconnect a worker (populating/
// clearing the map exactly as wss.on("connection")/"close"/"error" do in
// control-stream-server.mjs) and to build a worker-side transport whose onMessage
// delivery is wired directly to the matching server-side socket's send() calls (the
// down-channel delivery path).
export function createDirectiveChannelFixture() {
  const targets = new Map();
  return {
    targets: {
      // The EXACT two-method shape sendDirective(targets, nodeId, directive) reads
      // — a direct stand-in for createDirectiveTargetRegistry()'s public surface.
      get(nodeId) { return targets.get(nodeId) ?? null; },
      set(nodeId, ws) { targets.set(nodeId, ws); },
    },
    // connectWorker(nodeId) — populates the targeting map (mirrors
    // wss.on("connection")'s directiveTargets.set(nodeId, ws)) and returns the fake
    // server-side socket so a test can assert on `.frames`.
    connectWorker(nodeId) {
      const socket = createFakeServerSocket(nodeId);
      targets.set(nodeId, socket);
      return socket;
    },
    // disconnectWorker(nodeId, { via }) — a scriptable mid-stream drop: closes or
    // errors the named worker's socket AND removes it from the targeting map
    // (mirroring ws.on("close"/"error") -> directiveTargets.deleteIfCurrent). Every
    // OTHER worker's entry is untouched.
    disconnectWorker(nodeId, { via = "close" } = {}) {
      const socket = targets.get(nodeId);
      if (socket == null) return;
      if (via === "error") socket.error(); else socket.close();
      targets.delete(nodeId);
    },
  };
}

// createFakeWorkerTransport() — a worker-side transport implementing the FULL
// `{ connect, send, close, onDrop, onMessage }` seam (worker-stream-client.mjs's
// createWorkerWsTransport shape) as a plain in-memory double: connect() always
// resolves; send() records frames (extending 34/story-04's fakeTransport recorder);
// onMessage(handler) registers a receive handler; deliver(frame) is the fixture's
// DOWN-CHANNEL delivery path a test calls to simulate "a directive arrived on this
// worker's socket".
export function createFakeWorkerTransport() {
  const frames = [];
  let messageHandler = null;
  let dropHandler = null;
  let connectCalls = 0;
  return {
    frames,
    get connectCalls() { return connectCalls; },
    async connect() {
      connectCalls += 1;
      return { id: connectCalls };
    },
    async send(_handle, frame) {
      frames.push(frame);
    },
    close() { /* no-op fake */ },
    onDrop(handler) {
      dropHandler = typeof handler === "function" ? handler : null;
    },
    onMessage(handler) {
      messageHandler = typeof handler === "function" ? handler : null;
    },
    // deliver(frame) — the down-channel delivery path: hands a frame (object or raw
    // JSON string, mirroring what a real ws "message" event payload can be) to
    // whatever onMessage(handler) is CURRENTLY registered — exactly as ws@8's
    // "message" event would after createWorkerWsTransport's connect() wiring.
    deliver(frame) {
      const raw = typeof frame === "string" ? frame : JSON.stringify(frame);
      messageHandler?.(raw);
    },
    // simulateDrop() — the fixture's mid-stream drop for the WORKER side (distinct
    // from disconnectWorker above, which drops the SERVER's view of the socket).
    simulateDrop() {
      dropHandler?.();
    },
  };
}
