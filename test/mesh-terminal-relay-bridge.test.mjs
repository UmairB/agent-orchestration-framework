// test/mesh-terminal-relay-bridge.test.mjs — traceability for milestone 38 / story
// 06, task 00 (tasks/00_pty-bytes-ride-relay-signal.feature, ADR-014). The
// worker's PTY byte stream rides the FROZEN mesh-relay.mjs envelope as a NEW
// opaque `signal` kind ("terminal-frame"), routed by (nodeId, sessionId), with
// ZERO relay change.
//
// PRODUCER-FED (the milestone's earned lesson, ADR-008): scenario 1 + the routing
// Outline drive the REAL wireTerminalBridge over a REAL node-pty-shaped PTY
// (createScriptedPty — the SAME fixture story 05 built, so `term.onData`'s
// contract is genuinely exercised, not a hand-authored convenient shape).
// Scenario 2 (the relay-envelope-unbroken proof) drives the REAL, unmodified
// src/mesh-relay.mjs `serveRelay()` broker over a REAL in-process ws socket, AND
// the REAL production `createTerminalRelayPushTransport` — the SAME in-process-
// real-relay harness test/mesh-relay-broker-fanout.test.mjs and
// test/mesh-relay-envelope-resilience.test.mjs already established for m23/m26's
// own "a new kind rides the wire with zero relay change" precedent — never a
// hand-built stub of what the relay's parseEnvelope/fan-out "should" do.
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { serveRelay } from "../src/mesh-relay.mjs";
import {
  TERMINAL_FRAME_KIND,
  wireTerminalBridge,
  createTerminalRelayPushTransport,
} from "../src/mesh-terminal-relay-bridge.mjs";
import { createScriptedPty } from "./support/mesh-worker-terminal-fixture.mjs";

// capturePty() — builds a REAL createScriptedPty and captures its onWrite
// emit-control the FIRST time write() is called, so a test can then emit
// arbitrary PTY OUTPUT bytes at will via emit.emitData(bytes) — the term.onData
// stream wireTerminalBridge subscribes to. write("") is a no-op "prime" call (no
// driver types anything into this PTY in these scenarios — only OUTPUT matters).
function capturePty() {
  let emit = null;
  const pty = createScriptedPty({ onWrite: (ctrl) => { emit = ctrl; } });
  return {
    pty,
    emitData(bytes) {
      if (emit == null) pty.write("");
      emit.emitData(bytes);
    },
  };
}

// A fake relay transport that RECORDS every routed envelope (the feature
// Background's literal seam) — push() resolves immediately, no real socket.
function createRecordingRelayTransport() {
  const recorded = [];
  return {
    recorded,
    async push(envelope) {
      recorded.push(envelope);
    },
  };
}

// --- the REAL in-process relay harness (mirrors test/mesh-relay-broker-fanout /
// mesh-relay-envelope-resilience's own connect()/waitFor() shape) ---

function connect(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    let joined = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("join-ack timeout")); }
    }, timeoutMs);
    ws.on("message", (data) => {
      const text = data.toString();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw, non-JSON frame */ }
      if (parsed && parsed.type === "joined" && !joined) {
        joined = true;
        if (!settled) { settled = true; clearTimeout(timer); resolve({ ws, frames }); }
        return;
      }
      frames.push({ text, parsed });
    });
    ws.on("error", (error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(error); }
    });
  });
}

function waitFor(predicate, { timeoutMs = 1500, label = "condition" } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = predicate(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`waitFor(${label}) timeout`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const closeAll = async (...clients) => {
  for (const c of clients) {
    try { c?.ws?.close?.(); } catch { /* noop */ }
  }
};

export const meshTerminalRelayBridgeTests = [
  // --- Scenario: the PTY output rides a NEW kind as the opaque signal, routed by
  //     (nodeId, sessionId) ---
  {
    name: "task00/38-06 the PTY output rides the NEW terminal-frame kind as the opaque signal, routed by (nodeId, sessionId), bytes carried byte-for-byte",
    async run() {
      const relayTransport = createRecordingRelayTransport();
      const { pty, emitData } = capturePty();
      const bridge = wireTerminalBridge(pty, { nodeId: "node-a", sessionId: "sess-1", push: relayTransport.push });
      try {
        // When the PTY source emits bytes for node "node-a", session "sess-1".
        emitData("hello from the worker's live terminal\n");
        await waitFor(() => relayTransport.recorded.length >= 1, { label: "envelope recorded" });

        const envelope = relayTransport.recorded[0];
        // Then each recorded envelope's kind is the NEW terminal-frame kind, never
        // "presence" nor a mutated existing kind.
        assert.equal(envelope.kind, TERMINAL_FRAME_KIND, 'the envelope kind is the NEW "terminal-frame" kind');
        assert.notEqual(envelope.kind, "presence", "never the presence kind");
        // And the envelope's nodeId is "node-a" (the routing field the relay reads).
        assert.equal(envelope.nodeId, "node-a", "the envelope's top-level nodeId is the routing field the relay reads");
        // And the sessionId "sess-1" rides INSIDE the opaque signal, never as a new
        // top-level envelope key.
        assert.equal(envelope.signal.sessionId, "sess-1", "sessionId rides inside signal");
        assert.equal(envelope.sessionId, undefined, "sessionId is NOT a top-level envelope key");
        // And the PTY bytes are carried in signal byte-for-byte — unmodified from
        // what term.onData emitted.
        assert.equal(envelope.signal.bytes, "hello from the worker's live terminal\n", "the PTY bytes are byte-for-byte unmodified in signal.bytes");
      } finally {
        bridge.dispose();
      }
    },
  },

  // --- Scenario: the relay envelope shape is UNBROKEN — a new kind rides with
  //     zero relay change --- (driven against the REAL serveRelay() broker)
  {
    name: "task00/38-06 the relay envelope shape is UNBROKEN — the REAL relay forwards the terminal-frame envelope with EXACTLY {kind,nodeId,signal}, unparsed, unknown-kind-forwarded",
    async run() {
      const relay = await serveRelay({ port: 0 });
      let sender, peer;
      try {
        sender = await connect(relay.url);
        peer = await connect(relay.url);

        // The bridge pushes through the REAL production transport, over a REAL
        // ws socket to the REAL relay — the sender IS the worker's own relay push.
        const senderTransport = createTerminalRelayPushTransport({ mesh: { relay: { url: relay.url } } });
        const { pty, emitData } = capturePty();
        const bridge = wireTerminalBridge(pty, {
          nodeId: "node-a",
          sessionId: "sess-1",
          push: (envelope) => senderTransport.push(envelope),
        });
        try {
          emitData("real relay round-trip bytes\n");
          await waitFor(() => peer.frames.length >= 1, { label: "peer receives the terminal-frame envelope" });
        } finally {
          bridge.dispose();
          senderTransport.close();
        }

        const received = peer.frames[0].parsed;
        // EXACTLY the frozen envelope keys { kind, nodeId, signal } — no fourth
        // top-level key.
        assert.deepEqual(Object.keys(received).sort(), ["kind", "nodeId", "signal"], "the received envelope has EXACTLY the frozen top-level keys — no fourth key");
        assert.equal(received.kind, TERMINAL_FRAME_KIND);
        assert.equal(received.nodeId, "node-a");
        assert.equal(received.signal.sessionId, "sess-1");
        assert.equal(received.signal.bytes, "real relay round-trip bytes\n", "the relay fans the ORIGINAL frame bytes out unparsed — no rewrite, no re-serialization");

        // An UNKNOWN kind is forwarded, never rejected (the m26 leasing property
        // this bridge relies on) — sent directly, bypassing the bridge, to prove
        // the RELAY's own behaviour (not a bridge-side assumption).
        sender.ws.send(JSON.stringify({ kind: "some-future-unknown-kind", nodeId: "node-z", signal: { anything: true } }));
        await waitFor(() => peer.frames.length >= 2, { label: "peer receives the unknown-kind frame" });
        assert.equal(peer.frames[1].parsed.kind, "some-future-unknown-kind", "an unknown kind is forwarded, never rejected");
      } finally {
        await closeAll(sender, peer);
        await relay.stop();
      }
    },
  },

  // --- Scenario Outline: the routing key is (nodeId, sessionId) — incl.
  //     same-node multiplex (row 3: node-a again, a second session) ---
  ...[
    { nodeId: "node-a", sessionId: "5f3c1e00-ab90-4d21-9f7a-0011223344aa" },
    { nodeId: "node-b", sessionId: "7e21aa10-cd34-4a55-8b0c-99887766ddee" },
    { nodeId: "node-a", sessionId: "0c14bb20-ef56-4c66-7d1e-1122aabbccdd" },
  ].map((row, index) => ({
    name: `task00/38-06 Scenario Outline row ${index + 1}: the routing tuple is exactly (${row.nodeId}, ${row.sessionId})`,
    async run() {
      // A SHARED recording transport across rows — proves node-a's TWO sessions
      // (row 1 + row 3) never collide on the same recorder (the same-node
      // multiplex property the Outline's row 3 exists to prove).
      const relayTransport = createRecordingRelayTransport();
      const { pty, emitData } = capturePty();
      const bridge = wireTerminalBridge(pty, { nodeId: row.nodeId, sessionId: row.sessionId, push: relayTransport.push });
      try {
        emitData(`output for ${row.nodeId}/${row.sessionId}\n`);
        await waitFor(() => relayTransport.recorded.length >= 1, { label: "envelope recorded" });
        const envelope = relayTransport.recorded[relayTransport.recorded.length - 1];
        assert.equal(envelope.nodeId, row.nodeId, `the recorded envelope's nodeId is ${row.nodeId}`);
        assert.equal(envelope.signal.sessionId, row.sessionId, `the sessionId extracted from inside signal is ${row.sessionId}`);
        assert.deepEqual(
          [envelope.nodeId, envelope.signal.sessionId],
          [row.nodeId, row.sessionId],
          `the stream's routing tuple is exactly (${row.nodeId}, ${row.sessionId})`,
        );
      } finally {
        bridge.dispose();
      }
    },
  })),
];
