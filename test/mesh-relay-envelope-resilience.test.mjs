// Traceability wiring for milestone 23 / story 01 — task 01
// (tasks/01_relay-envelope-and-resilience.feature). The frozen, payload-agnostic envelope
// { kind, nodeId, signal } where `signal` is an OPAQUE blob forwarded unparsed, and a bad
// frame errors the SENDER with the frozen { type:'error' } control-frame without ever
// crashing the broker (03/ADR-003), and a peer disconnect leaves the broker + other peers
// intact.
//
// Covers EVERY @executable scenario / Outline ROW, in-process (serveRelay + an in-process
// `ws` client over port: 0), the ack-on-connect barrier for ordering. Resolved QA flag #1:
// the oversized threshold is config.mesh.relay.maxFrameBytes (documented default 1 MiB);
// these rows configure a small limit so "oversized" is cheap, and assert the sender gets
// OUR { type:'error' } frame (not ws's 1009 close).
import assert from "node:assert/strict";
import { WebSocket } from "ws";
import { serveRelay } from "../src/mesh-relay.mjs";

function connect(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    const errors = [];
    let joined = false;
    let settled = false;
    let closed = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("join-ack timeout")); } }, timeoutMs);
    ws.on("message", (data) => {
      const text = data.toString();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw */ }
      if (parsed && parsed.type === "joined" && !joined) {
        joined = true;
        if (!settled) { settled = true; clearTimeout(timer); resolve(handle); }
        return;
      }
      if (parsed && parsed.type === "error") errors.push(parsed);
      frames.push({ text, parsed });
    });
    ws.on("close", () => { closed = true; });
    ws.on("error", (error) => {
      // After the join ack, a transport error is recorded, not thrown (the client may
      // close); before the ack, it rejects the connect.
      if (!settled) { settled = true; clearTimeout(timer); reject(error); }
    });
    const handle = {
      get ws() { return ws; },
      frames,
      errors,
      get closed() { return closed; },
      send: (data) => ws.send(data),
      close: () => { try { ws.close(); } catch { /* noop */ } },
    };
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

const settle = (ms = 120) => new Promise((resolve) => setTimeout(resolve, ms));

const closeAll = (...handles) => { for (const h of handles) { try { h?.close?.(); } catch { /* noop */ } } };

// The forwarding Outline rows: span KNOWN/UNKNOWN kind AND JSON/non-JSON signal so
// "payload-agnostic" is proven to mean "forwards the opaque blob", not "forwards JSON it
// recognises". Each row's `signal` is forwarded BYTE-FOR-BYTE — the assertion compares the
// peer's received signal value against the sent value, by deep-equality / strict string.
const FORWARD_ROWS = [
  { label: "a presence-shaped JSON object", kind: "presence", signal: { heartbeatAt: "2026-06-30T00:00:00.000Z", activeRuns: ["23/01"], nodeId: "A" } },
  { label: "an unknown-kind (m26) opaque JSON payload", kind: "leasing", signal: { lease: "23/01", holder: "A", expiresAt: "2026-06-30T00:05:00.000Z" } },
  { label: "a deeply-nested opaque JSON blob", kind: "presence", signal: { a: { b: { c: [1, 2, { d: "deep" }] } }, e: null } },
  { label: "a non-JSON but valid-frame string signal", kind: "presence", signal: "just-a-plain-string-signal" },
];

export const meshRelayEnvelopeResilienceTests = [
  // --- Scenario Outline: the relay forwards every envelope shape unchanged, never
  //     branching on signal content (one test object per row) ---
  ...FORWARD_ROWS.map((row) => ({
    name: `mesh-relay/01 forwards the "${row.label}" envelope unchanged (routes by frame, not by signal content)`,
    async run() {
      const relay = await serveRelay({ port: 0 });
      let sender, peer;
      try {
        sender = await connect(relay.url);
        peer = await connect(relay.url);
        // Given the sender frames an envelope with this kind + signal; when it publishes.
        const sent = JSON.stringify({ kind: row.kind, nodeId: "A", signal: row.signal });
        sender.send(sent);
        // Then the peer receives an envelope with this kind…
        await waitFor(() => peer.frames.length >= 1, { label: "peer receives" });
        const received = peer.frames[0].parsed;
        assert.equal(received.kind, row.kind, `the peer receives an envelope with kind "${row.kind}"`);
        // …and the peer's signal is byte-identical to the sent signal (forwarded unparsed):
        // the received frame text is byte-identical to the sent frame text.
        assert.equal(peer.frames[0].text, sent, "the peer's envelope signal is byte-identical (forwarded unparsed, never rewritten)");
        assert.deepEqual(received.signal, row.signal, "the relay neither rewrote the signal nor rejected the kind (it routed by frame, not by field)");
      } finally {
        closeAll(sender, peer);
        await relay.stop();
      }
    },
  })),

  // --- Scenario Outline: a malformed, non-JSON, or oversized frame errors the sender with
  //     the frozen control-frame and never crashes the broker (one test object per row) ---
  ...[
    { label: "a malformed frame that is not the { kind } envelope", make: () => JSON.stringify({ notAnEnvelope: true, missing: "kind" }), maxFrameBytes: undefined },
    { label: "non-JSON garbage bytes", make: () => " not json at all }{", maxFrameBytes: undefined },
    { label: "an oversized frame over the configured limit", make: () => "x".repeat(2000), maxFrameBytes: 64 },
  ].map((row) => ({
    name: `mesh-relay/01 "${row.label}" errors the sender with the frozen control-frame and never crashes the broker`,
    async run() {
      const config = row.maxFrameBytes ? { mesh: { relay: { maxFrameBytes: row.maxFrameBytes } } } : undefined;
      const relay = await serveRelay({ port: 0, config });
      let sender, peer;
      try {
        // Given a sender and a peer, the peer's connection open and healthy.
        sender = await connect(relay.url);
        peer = await connect(relay.url);
        // When the sender sends the bad input.
        sender.send(row.make());
        // Then the sender receives a frozen { type:'error', message } control-frame.
        await waitFor(() => sender.errors.length >= 1, { label: "sender error" });
        assert.equal(sender.errors[0].type, "error", "the sender received a frozen { type:'error' } control-frame");
        assert.equal(typeof sender.errors[0].message, "string", "the control-frame carries a message");
        // And the broker process does not crash and keeps serving (a fresh client joins).
        const probe = await connect(relay.url);
        assert.ok(probe, "the broker keeps serving after the bad frame (it did not crash)");
        probe.close();
        await settle();
        // And the peer's connection is still open; the peer is unaffected (no error, no
        // forwarded garbage).
        assert.ok(!peer.closed, "the peer's connection is still open (one client's bad frame did not drop the others)");
        assert.equal(peer.errors.length, 0, "the peer received no error frame");
        assert.equal(peer.frames.length, 0, "the peer received no forwarded garbage (nothing was fanned out for the bad frame)");
      } finally {
        closeAll(sender, peer);
        await relay.stop();
      }
    },
  })),

  // --- Scenario: the maxFrameBytes limit is enforced with strict-`>` (the off-by-one
  //     boundary) — a frame of EXACTLY maxFrameBytes is accepted/forwarded, maxFrameBytes+1
  //     errors with the frozen control-frame (craft F6 boundary row) ---
  {
    name: "mesh-relay/01 a frame of exactly maxFrameBytes is forwarded and maxFrameBytes+1 errors with the frozen control-frame (the strict-> boundary)",
    async run() {
      // A SMALL configured limit so the boundary frames are cheap to build/send.
      const maxFrameBytes = 256;
      const relay = await serveRelay({ port: 0, config: { mesh: { relay: { maxFrameBytes } } } });
      let sender, peer;
      try {
        sender = await connect(relay.url);
        peer = await connect(relay.url);

        // Build a VALID { kind, nodeId, signal } envelope whose serialized byte length is
        // EXACTLY `targetBytes` by padding the string `signal` to fit (the frame is ASCII,
        // so 1 char === 1 byte). The frame must be a real envelope so a within-limit frame
        // is FORWARDED (not rejected as malformed) — the boundary is about size, not shape.
        const frameOfBytes = (targetBytes) => {
          const base = { kind: "presence", nodeId: "A", signal: "" };
          const baseLen = Buffer.byteLength(JSON.stringify(base));
          const pad = targetBytes - baseLen;
          assert.ok(pad >= 0, "the target frame size leaves room for the envelope scaffold");
          const frame = JSON.stringify({ kind: "presence", nodeId: "A", signal: "x".repeat(pad) });
          assert.equal(Buffer.byteLength(frame), targetBytes, `the frame is exactly ${targetBytes} bytes`);
          return frame;
        };

        // (1) EXACTLY maxFrameBytes → accepted and FORWARDED to the peer (the strict-`>`
        // check does NOT reject the equal-to-limit frame), and the sender gets NO error.
        const atLimit = frameOfBytes(maxFrameBytes);
        sender.send(atLimit);
        await waitFor(() => peer.frames.length >= 1, { label: "peer receives the at-limit frame" });
        assert.equal(peer.frames[0].text, atLimit, "a frame of EXACTLY maxFrameBytes is forwarded byte-for-byte (accepted at the boundary)");
        assert.equal(sender.errors.length, 0, "a frame of exactly maxFrameBytes raises NO error control-frame (strict-> accepts the equal-to-limit frame)");

        // (2) maxFrameBytes + 1 → the frozen { type:'error' } control-frame to the sender,
        // and NOTHING new is forwarded to the peer (the over-limit frame is not fanned out).
        const overLimit = frameOfBytes(maxFrameBytes + 1);
        sender.send(overLimit);
        await waitFor(() => sender.errors.length >= 1, { label: "sender error on over-limit" });
        assert.equal(sender.errors[0].type, "error", "a frame of maxFrameBytes+1 errors the sender with the frozen { type:'error' } control-frame");
        assert.equal(typeof sender.errors[0].message, "string", "the over-limit control-frame carries a message");
        await settle();
        assert.equal(peer.frames.length, 1, "the over-limit frame was NOT forwarded to the peer (only the at-limit frame reached it)");
      } finally {
        closeAll(sender, peer);
        await relay.stop();
      }
    },
  },

  // --- Scenario: a peer disconnecting mid-session leaves the broker and the other peers
  //     intact ---
  {
    name: "mesh-relay/01 a peer disconnecting mid-session leaves the broker and the other peers intact",
    async run() {
      const relay = await serveRelay({ port: 0 });
      let a, b, c;
      try {
        // Given three nodes A, B, C connected.
        a = await connect(relay.url);
        b = await connect(relay.url);
        c = await connect(relay.url);
        // When node C disconnects mid-session.
        c.close();
        await settle();
        // Then the broker stays alive (a fresh client still joins).
        const probe = await connect(relay.url);
        assert.ok(probe, "the broker process stays alive (it did not tear down on the disconnect)");
        probe.close();
        // And A and B remain connected.
        assert.ok(!a.closed && !b.closed, "node A and node B remain connected");
        // And a signal published by A is still fanned out to B (the survivors carry on).
        a.send(JSON.stringify({ kind: "presence", nodeId: "A", signal: "after-c-left" }));
        await waitFor(() => b.frames.length >= 1, { label: "B receives survivor frame" });
        assert.equal(b.frames[0].parsed.signal, "after-c-left", "a signal published by node A is still fanned out to node B");
        // And no error frame was raised to A or B by C's departure.
        assert.equal(a.errors.length, 0, "node A received no error frame from C's departure");
        assert.equal(b.errors.length, 0, "node B received no error frame from C's departure");
      } finally {
        closeAll(a, b, c);
        await relay.stop();
      }
    },
  },
];
