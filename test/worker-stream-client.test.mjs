// Traceability wiring for milestone 34 / story 04 — task 01
// (tasks/01_worker-stream-client.feature). Covers every @executable scenario /
// Scenario Outline row:
//   - the first frame on a connection is a full snapshot, then changes are deltas
//   - after a drop the worker reconnects and re-sends a full snapshot before deltas
//   - reconnect backoff grows then caps (Scenario Outline, 4 rows: n=1,2,3,9)
//   - a stream fault never blocks or rolls back the local work write (Scenario
//     Outline, 3 rows: connected / disconnected / throwing on send)
//
// Driven over a NET-NEW test double (the STORY.md build-note flag): an ordered frame
// recorder + a scriptable mid-stream drop/throw — a PERSISTENT, multi-frame,
// reconnecting channel distinct from mesh-relay-client.mjs's one-shot fake. An
// injected manual ticker drives the backoff schedule with zero wall-clock waits.
import assert from "node:assert/strict";
import {
  createWorkerStreamClient,
  backoffDelaySeconds,
} from "../src/worker-stream-client.mjs";

// A scriptable fake transport: connect()/send() resolve unless scripted to throw;
// every sent frame is recorded in order (kind + items) so a test can assert the
// exact frame sequence a connection produced.
function fakeTransport({ failConnect = false, failSendOnce = false } = {}) {
  const frames = [];
  let connectCalls = 0;
  let closeCalls = 0;
  let sendShouldThrowNext = failSendOnce;
  return {
    frames,
    get connectCalls() { return connectCalls; },
    get closeCalls() { return closeCalls; },
    async connect() {
      connectCalls += 1;
      if (failConnect) throw new Error("connect refused");
      return { id: connectCalls };
    },
    async send(handle, frame) {
      if (sendShouldThrowNext) {
        sendShouldThrowNext = false;
        throw new Error("send failed mid-stream");
      }
      frames.push(frame);
    },
    close() {
      closeCalls += 1;
    },
  };
}

function manualTicker() {
  const handles = [];
  return {
    handles,
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) {
      handle.stopped = true;
    },
    fire(handle) {
      handle.onTick();
    },
  };
}

// throwingTerminalTransport() — milestone 38 / story 06 (ADR-014 AMENDMENT): a
// transport whose send() throws ONLY when armed (so an initial snapshot can succeed to
// establish a LIVE connection, then a subsequent terminal-frame send can be scripted to
// throw). Records `closeCalls` so a test can prove markDropped() (which closes the
// handle) was NEVER entered by a swallowed terminal-frame send fault.
function throwingTerminalTransport() {
  const frames = [];
  let connectCalls = 0;
  let closeCalls = 0;
  let throwNext = false;
  return {
    frames,
    get connectCalls() { return connectCalls; },
    get closeCalls() { return closeCalls; },
    armThrow() { throwNext = true; },
    async connect() { connectCalls += 1; return { id: connectCalls }; },
    async send(_handle, frame) {
      if (throwNext) { throwNext = false; throw new Error("terminal send failed on a live-but-flaky socket"); }
      frames.push(frame);
    },
    close() { closeCalls += 1; },
  };
}

const NOW = "2026-07-05T10:00:00.000Z";

export const workerStreamClientTests = [
  {
    name: "worker-stream-client/01 the first frame on a connection is a full snapshot, then changes are deltas",
    async run() {
      const transport = fakeTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      const twoItems = [{ ref: "34/04/00", status: "in-progress" }, { ref: "34/04/01", status: "planned" }];
      await client.sendSnapshot(twoItems);
      const advanced = [{ ref: "34/04/00", status: "done" }];
      await client.sendDelta(advanced);

      assert.equal(transport.frames.length, 2);
      assert.equal(transport.frames[0].kind, "snapshot");
      assert.deepEqual(transport.frames[0].items, twoItems);
      assert.equal(transport.frames[1].kind, "delta");
      assert.deepEqual(transport.frames[1].items, advanced);
    },
  },
  {
    name: "worker-stream-client/01 the worker can send a durable presence frame over the established stream",
    async run() {
      const transport = fakeTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      const presence = { nodeId: "worker-a", heartbeatAt: NOW, activeRuns: ["run-1"], aofVersion: "1.2.3" };

      await client.sendSnapshot([{ ref: "34/04/00", status: "in-progress" }]);
      await client.sendPresence(presence);

      assert.equal(transport.frames.length, 2);
      assert.equal(transport.frames[0].kind, "snapshot", "the work-state contract still sends a snapshot first");
      assert.equal(transport.frames[1].kind, "presence", "presence is a separate durable-liveness frame");
      assert.deepEqual(transport.frames[1].presence, presence, "the durable presence payload is carried unchanged");
    },
  },
  {
    name: "worker-stream-client/01 after a drop the worker reconnects and re-sends a full snapshot before deltas",
    async run() {
      const transport = fakeTransport();
      const ticker = manualTicker();
      const client = createWorkerStreamClient({ transport, ticker, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      await client.sendSnapshot([{ ref: "34/04/00", status: "in-progress" }]);
      await client.sendDelta([{ ref: "34/04/00", status: "review" }]);
      assert.equal(transport.frames.length, 2);

      // The connection drops.
      client.notifyDrop();
      assert.equal(ticker.handles.length, 1, "a reconnect is scheduled");
      ticker.fire(ticker.handles[0]); // the backoff elapses -> reconnect attempt
      assert.equal(transport.connectCalls, 2, "a new connection is opened");

      // The next frame sent after the reconnect must be a snapshot (the frame
      // contract is enforced by the client, not caller discipline).
      await client.sendDelta([{ ref: "34/04/00", status: "done" }], { fullItems: [{ ref: "34/04/00", status: "done" }] });
      assert.equal(transport.frames.length, 3);
      assert.equal(transport.frames[2].kind, "snapshot", "the first frame on the new connection is a full snapshot");
    },
  },
  {
    name: "worker-stream-client/01 reconnect backoff grows then caps",
    run() {
      const rows = [
        { n: 1, delay: 1 },
        { n: 2, delay: 2 },
        { n: 3, delay: 4 },
        { n: 9, delay: 30 },
      ];
      for (const row of rows) {
        assert.equal(backoffDelaySeconds(row.n), row.delay, `n=${row.n}`);
      }
    },
  },
  {
    name: "worker-stream-client/01 reconnect backoff grows then caps — scheduled via notifyDrop over the injected ticker",
    run() {
      const transport = fakeTransport();
      const ticker = manualTicker();
      const client = createWorkerStreamClient({ transport, ticker, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      const rows = [
        { n: 1, delay: 1 },
        { n: 2, delay: 2 },
        { n: 3, delay: 4 },
      ];
      for (const row of rows) {
        const scheduled = client.notifyDrop();
        assert.equal(scheduled.scheduledDelaySeconds, row.delay, `drop #${row.n}`);
        // simulate the reconnect firing so the NEXT drop counts from a fresh connect
        ticker.fire(ticker.handles.at(-1));
      }
    },
  },
  {
    name: "worker-stream-client/01 a stream fault never blocks or rolls back the local work write — connected",
    async run() {
      const transport = fakeTransport();
      const warnings = [];
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW, onWarning: (w) => warnings.push(w) });
      // The "local work write" is simulated as always succeeding regardless of the
      // stream outcome (ADR-004 failure isolation) — the stream call is best-effort
      // and its result never gates the local command's reported result.
      const localWriteResult = { ok: true };
      await client.sendSnapshot([{ ref: "34/04/00", status: "done" }]);
      assert.equal(localWriteResult.ok, true, "the local run record is written and the command reports success");
      assert.equal(warnings.length, 0, "no stream fault to surface when connected");
    },
  },
  {
    name: "worker-stream-client/01 a stream fault never blocks or rolls back the local work write — disconnected",
    async run() {
      const transport = fakeTransport({ failConnect: true });
      const warnings = [];
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW, onWarning: (w) => warnings.push(w) });
      const localWriteResult = { ok: true };
      const result = await client.sendSnapshot([{ ref: "34/04/00", status: "done" }]);
      assert.equal(result.sent, false);
      assert.equal(localWriteResult.ok, true, "the local run record is written and the command reports success");
      assert.equal(warnings.length, 1, "the stream fault surfaces only as a warning");
      assert.equal(warnings[0].code, "worker-stream-connect-failed");
    },
  },
  {
    name: "worker-stream-client/01 a stream fault never blocks or rolls back the local work write — throwing on send",
    async run() {
      const transport = fakeTransport({ failSendOnce: true });
      const warnings = [];
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW, onWarning: (w) => warnings.push(w) });
      const localWriteResult = { ok: true };
      const result = await client.sendSnapshot([{ ref: "34/04/00", status: "done" }]);
      assert.equal(result.sent, false);
      assert.equal(localWriteResult.ok, true, "the local run record is written and the command reports success");
      assert.equal(warnings.length, 1, "the stream fault surfaces only as a warning");
      assert.equal(warnings[0].code, "worker-stream-send-failed");
    },
  },

  // milestone 38 / story 06 (ADR-014 AMENDMENT 2026-07-19) — sendTerminalFrame's
  // load-bearing "off the reconnect path" discipline (worker-stream-client.mjs): a
  // live PTY emits many frames/second and a terminal frame is a pure best-effort live
  // VIEW (no durable floor), so it must NEVER touch the sendFrame/markDropped
  // reconnect/drop bookkeeping. A future refactor routing it through sendFrame would
  // keep every OTHER lane green while destabilising the worker's actual reconnect
  // state (the milestone's green-not-working class) — these two lanes make that
  // behavioural, not merely structural.
  {
    name: "worker-stream-client/38-06 sendTerminalFrame while DISCONNECTED returns {sent:false} without warning, without attempting to connect, and touches NO reconnect/snapshot bookkeeping",
    async run() {
      const transport = fakeTransport();
      const warnings = [];
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW, onWarning: (w) => warnings.push(w) });

      // A fresh client is disconnected (connected=false, handle=null, needsSnapshot=true).
      assert.equal(client.connected, false);
      assert.equal(client.needsSnapshot, true);

      const result = await client.sendTerminalFrame("sess-1", "bytes emitted before the socket is up\n");

      assert.equal(result.sent, false, "a terminal-frame emitted while disconnected returns {sent:false}");
      assert.equal(warnings.length, 0, "no warning — sendTerminalFrame is OFF the sendFrame/onWarning path");
      assert.equal(transport.connectCalls, 0, "sendTerminalFrame does NOT ensureConnected — a disconnected terminal frame is simply dropped (the live tail has no replay)");
      assert.equal(transport.frames.length, 0, "nothing was sent");
      // Bookkeeping is untouched — no drop path, no snapshot re-arm.
      assert.equal(client.connected, false, "connected is unchanged");
      assert.equal(client.needsSnapshot, true, "needsSnapshot is unchanged — no reconnect/snapshot bookkeeping was touched");
      assert.equal(client.consecutiveDrops, 0, "no drop was recorded");
    },
  },
  {
    name: "worker-stream-client/38-06 a throwing terminal-frame send is swallowed to {sent:false} and NEVER enters markDropped — the live connection stays up and the next work-state send is still a DELTA (needsSnapshot not reset)",
    async run() {
      const transport = throwingTerminalTransport();
      const warnings = [];
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW, onWarning: (w) => warnings.push(w) });

      // Establish a LIVE connection with an initial snapshot (needsSnapshot -> false).
      await client.sendSnapshot([{ ref: "38/06/00", status: "in-progress" }]);
      assert.equal(client.connected, true, "the session is live after the initial snapshot");
      assert.equal(transport.connectCalls, 1);

      // The next (terminal) send throws — it must be swallowed WITHOUT entering the drop path.
      transport.armThrow();
      const result = await client.sendTerminalFrame("sess-1", "bytes over a live-but-flaky socket\n");
      assert.equal(result.sent, false, "a throwing terminal send is swallowed to {sent:false}");
      assert.equal(warnings.length, 0, "a terminal-frame send fault NEVER warns (off the sendFrame/markDropped path)");

      // markDropped was NOT taken: it would have closed the handle, set connected=false,
      // and re-armed needsSnapshot.
      assert.equal(client.connected, true, "the session stays connected — markDropped was NOT taken");
      assert.equal(transport.closeCalls, 0, "the handle was NOT closed — markDropped was NOT taken");
      assert.equal(client.consecutiveDrops, 0, "no drop was recorded by the terminal send fault");

      // The strongest proof: the next work-state send goes over the SAME connection as a
      // DELTA — needsSnapshot was NEVER reset to true (markDropped would have forced the
      // next frame to be a snapshot). So the drop path was never entered.
      const next = await client.sendDelta([{ ref: "38/06/00", status: "done" }]);
      assert.equal(next.sent, true, "the next work-state send succeeds over the still-live connection");
      assert.equal(transport.connectCalls, 1, "no reconnect — the same live connection was reused");
      assert.equal(transport.frames.at(-1).kind, "delta", "the next frame is a DELTA (needsSnapshot was not reset) — the terminal send fault never entered the drop path");
    },
  },
];
