// test/mesh-terminal-mirror-reconnect.test.mjs — VERIFICATION (relay-subscriber
// reconnect, live soak 2026-07-25).
//
// THE DEFECT, measured REPEATEDLY on the live control node: the fleet UI and the relay
// broker live in TWO processes (`aof mesh ui` / `aof mesh serve --serve`), and every
// deploy restarts both. `startTerminalMirrorSubscriber` connected EXACTLY ONCE and, on
// failure, set `connected:false` FOREVER — no retry, no reconnect, no drop handler. The
// UI boots in ~1s while the broker must bind the fabric + open the store first, so the UI
// reliably LOST the race, gave up permanently, and EVERY terminal view read `waiting for
// output` until a human restarted the UI process. To the operator that is indistinguishable
// from the terminal feature being broken — and it recurred on every single deploy.
//
// These lanes pin the fix at the seam: the subscriber RETRIES on the shared backoff ladder
// until the broker appears, recovers from a post-open DROP, and never reconnects after
// stop(). The timers are injected, so the retry loop is driven with no wall clock.
import assert from "node:assert/strict";
import { createTerminalMirror, startTerminalMirrorSubscriber } from "../src/mesh-terminal-mirror.mjs";
import { TERMINAL_FRAME_KIND } from "../src/mesh-terminal-relay-bridge.mjs";

// A controllable clock: setTimeoutFn/clearTimeoutFn doubles that queue callbacks so a
// test fires the retry itself (no wall-clock wait anywhere in this file).
function manualClock() {
  let next = 1;
  const pending = new Map();
  return {
    pending,
    setTimeoutFn(fn, delayMs) {
      const id = next++;
      pending.set(id, { fn, delayMs });
      return id;
    },
    clearTimeoutFn(id) { pending.delete(id); },
    // Fire every currently-scheduled timer (a scheduled retry may schedule the next one).
    async fireAll() {
      const scheduled = [...pending.entries()];
      pending.clear();
      for (const [, entry] of scheduled) await entry.fn();
      return scheduled.map(([, entry]) => entry.delayMs);
    },
  };
}

// A fake subscribe transport whose connect() fails until `up` is set — the broker
// not-yet-listening shape, exactly the deploy race. Records connect attempts and exposes
// the registered handlers so a test can deliver a frame or simulate a drop.
function fakeTransport({ up = false } = {}) {
  const t = {
    up,
    connectAttempts: 0,
    closed: 0,
    messageHandler: null,
    dropHandler: null,
    onMessage(fn) { t.messageHandler = fn; },
    onDrop(fn) { t.dropHandler = fn; },
    async connect() {
      t.connectAttempts += 1;
      if (!t.up) throw new Error("ECONNREFUSED: the relay broker is not listening yet");
      return { ok: true };
    },
    close() { t.closed += 1; },
    // Test affordances
    deliver(frame) { t.messageHandler?.(JSON.stringify(frame)); },
    drop() { t.dropHandler?.(); },
  };
  return t;
}

// The FROZEN envelope (mesh-terminal-relay-bridge's buildTerminalFrameEnvelope): the
// sessionId rides INSIDE `signal`, never as a top-level key.
function terminalFrame(sessionId, bytes) {
  return { kind: TERMINAL_FRAME_KIND, nodeId: "umairs-mac-mini", signal: { sessionId, bytes } };
}

export const meshTerminalMirrorReconnectTests = [
  {
    name: "mirror-subscriber: the broker is DOWN at boot (the deploy race) — the subscriber RETRIES and connects once the broker comes up, instead of degrading forever",
    run: async () => {
      const clock = manualClock();
      const transport = fakeTransport({ up: false });
      const mirror = createTerminalMirror();
      const sub = await startTerminalMirrorSubscriber({
        transport, mirror, setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn,
      });

      assert.equal(sub.connected, false, "the first connect fails — the broker is not listening yet");
      assert.equal(transport.connectAttempts, 1);
      assert.ok(clock.pending.size > 0, "…and a RETRY is scheduled (the pre-fix build scheduled nothing and stayed dead forever)");

      // Still down: the retry fires, fails, and schedules another (unbounded by design).
      await clock.fireAll();
      assert.equal(transport.connectAttempts, 2, "the retry really attempted a reconnect");
      assert.equal(sub.connected, false);
      assert.ok(clock.pending.size > 0, "…and keeps retrying while the broker is down");

      // The broker finishes booting → the very next retry connects.
      transport.up = true;
      await clock.fireAll();
      assert.equal(sub.connected, true, "the subscriber recovers on its own once the broker appears — no operator action, no UI restart");

      // …and frames now actually reach the mirror (the fact the operator cares about).
      const seen = [];
      mirror.subscribe("umairs-mac-mini", "sess-1", (frame) => seen.push(frame));
      transport.deliver(terminalFrame("sess-1", "hello from the worker"));
      assert.equal(seen.length, 1, "a relayed terminal frame reaches the mirror after the recovery");
      sub.stop();
    },
  },
  {
    name: "mirror-subscriber: a POST-OPEN drop (the broker restarts later) re-enters the retry loop and reconnects — the one-shot build never noticed the socket died",
    run: async () => {
      const clock = manualClock();
      const transport = fakeTransport({ up: true });
      const sub = await startTerminalMirrorSubscriber({
        transport, mirror: createTerminalMirror(), setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn,
      });
      assert.equal(sub.connected, true, "connected at boot");
      assert.equal(clock.pending.size, 0, "a healthy connection schedules no retry");

      // The broker goes away mid-life (a `mesh serve` restart).
      transport.up = false;
      transport.drop();
      assert.equal(sub.connected, false, "the drop is observed — the subscriber knows it is deaf");
      assert.ok(clock.pending.size > 0, "…and a reconnect is scheduled");

      await clock.fireAll();                       // still down
      assert.equal(sub.connected, false);
      transport.up = true;                          // broker back
      await clock.fireAll();
      assert.equal(sub.connected, true, "the subscriber re-subscribes itself after the broker returns");
      sub.stop();
    },
  },
  {
    name: "mirror-subscriber: stop() ends the loop — no further connect attempts, and the transport is disposed",
    run: async () => {
      const clock = manualClock();
      const transport = fakeTransport({ up: false });
      const sub = await startTerminalMirrorSubscriber({
        transport, mirror: createTerminalMirror(), setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn,
      });
      assert.equal(transport.connectAttempts, 1);
      sub.stop();
      assert.equal(transport.closed, 1, "stop() disposes the transport");
      assert.equal(clock.pending.size, 0, "…and cancels the pending retry");

      transport.up = true;
      await clock.fireAll();
      assert.equal(transport.connectAttempts, 1, "a stopped subscriber never reconnects");
      assert.equal(sub.connected, false);
    },
  },
  {
    name: "mirror-subscriber: an unconfigured relay (no transport) still degrades cleanly — no crash, no retry loop",
    run: async () => {
      const sub = await startTerminalMirrorSubscriber({ transport: null, mirror: createTerminalMirror() });
      assert.equal(sub.connected, false);
      sub.stop(); // must not throw
    },
  },
  {
    name: "mirror-subscriber: the retry backoff GROWS and is capped (the shared worker-stream ladder, never a second definition)",
    run: async () => {
      const clock = manualClock();
      const transport = fakeTransport({ up: false });
      const sub = await startTerminalMirrorSubscriber({
        transport, mirror: createTerminalMirror(), setTimeoutFn: clock.setTimeoutFn, clearTimeoutFn: clock.clearTimeoutFn,
      });
      const delays = [];
      for (let i = 0; i < 8; i += 1) {
        const fired = await clock.fireAll();
        delays.push(...fired);
      }
      assert.ok(delays.length >= 6, "several retries were scheduled while the broker stayed down");
      // Growing, then capped at 30s — the worker client's own documented ladder.
      assert.ok(delays[1] >= delays[0], `the delay grows: ${delays.slice(0, 4).join(",")}`);
      assert.ok(delays.every((d) => d <= 30_000), `no delay exceeds the 30s cap — got ${delays.join(",")}`);
      sub.stop();
    },
  },
];
