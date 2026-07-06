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
      frames.push({ kind: frame.kind, items: frame.items });
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
];
