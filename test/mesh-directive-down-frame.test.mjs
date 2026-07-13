// Traceability wiring for milestone 35 / story 01 — task 00
// (tasks/00_directive-down-frame.feature). Covers every @executable scenario /
// Scenario Outline row:
//   - a directive frame carries the assignment it dispatches, addressed to one node
//   - a directive reaches a node only while its connection is live (Scenario
//     Outline, 3 rows: connects / connects-then-closes / connects-then-errors)
//   - a directive reaches exactly the addressed worker and no other (Scenario
//     Outline, 2 rows: target worker-a / target worker-b)
//   - a directive to a node with no live connection is a coded refusal and sends
//     nothing
//
// Driven over the INJECTED bidirectional fake channel (test/support/
// mesh-directive-channel-fixture.mjs) — no live ws. sendDirective/
// buildDirectiveFrame are exercised directly against the SAME two-method targets
// shape createDirectiveTargetRegistry's internals expose. One additional
// end-to-end test drives the REAL startControlStreamServer + a real loopback ws +
// the real createWorkerWsTransport, proving the production wiring (not just the
// fake) carries a directive all the way to the worker client's onDirective handler.
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  sendDirective,
  buildDirectiveFrame,
  ASSIGNMENT_TARGET_NOT_CONNECTED,
  startControlStreamServer,
} from "../src/control-stream-server.mjs";
import { createWorkerStreamClient, createWorkerWsTransport } from "../src/worker-stream-client.mjs";
import { createDirectiveChannelFixture } from "./support/mesh-directive-channel-fixture.mjs";

const NOW = "2026-07-09T10:00:00.000Z";

async function withGlobalHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-directive-down-frame-"));
  try {
    return await fn({ env: { AOF_GLOBAL_HOME: home } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

function waitFor(predicate, { timeoutMs = 2000, intervalMs = 10 } = {}) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) { resolve(); return; }
      if (Date.now() - start > timeoutMs) { reject(new Error("timed out waiting for condition")); return; }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export const meshDirectiveDownFrameTests = [
  {
    name: "directive-down-frame/00 a directive frame carries the assignment it dispatches, addressed to one node",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");

      const directive = buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW });
      const result = sendDirective(channel.targets, "worker-a", directive);

      assert.equal(result.sent, true);
      assert.equal(workerA.frames.length, 1);
      const frame = workerA.frames[0];
      assert.equal(frame.kind, "directive");
      assert.equal(frame.to, "worker-a");
      assert.equal(frame.assignmentId, "asg-1");
      assert.equal(frame.itemRef, "35/01");
      assert.equal(frame.workspaceId, "ws-1");
      assert.equal(frame.at, NOW);
    },
  },
  {
    name: "directive-down-frame/00 a directive reaches a node only while its connection is live — connects: writes the directive to worker-a's socket",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const result = sendDirective(channel.targets, "worker-a", buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
      assert.equal(result.sent, true);
      assert.equal(workerA.frames.length, 1);
    },
  },
  {
    name: "directive-down-frame/00 a directive reaches a node only while its connection is live — connects then its socket closes: refused with code assignment-target-not-connected",
    run() {
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      channel.disconnectWorker("worker-a", { via: "close" });
      const result = sendDirective(channel.targets, "worker-a", buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
      assert.equal(result.sent, false);
      assert.equal(result.code, ASSIGNMENT_TARGET_NOT_CONNECTED);
    },
  },
  {
    name: "directive-down-frame/00 a directive reaches a node only while its connection is live — connects then its socket errors: refused with code assignment-target-not-connected",
    run() {
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      channel.disconnectWorker("worker-a", { via: "error" });
      const result = sendDirective(channel.targets, "worker-a", buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
      assert.equal(result.sent, false);
      assert.equal(result.code, ASSIGNMENT_TARGET_NOT_CONNECTED);
    },
  },
  {
    name: "directive-down-frame/00 a directive reaches exactly the addressed worker and no other — target worker-a",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const workerB = channel.connectWorker("worker-b");
      const result = sendDirective(channel.targets, "worker-a", buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
      assert.equal(result.sent, true);
      assert.equal(workerA.frames.length, 1, "worker-a receives exactly one directive frame");
      assert.equal(workerB.frames.length, 0, "worker-b receives no frame");
    },
  },
  {
    name: "directive-down-frame/00 a directive reaches exactly the addressed worker and no other — target worker-b",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      const workerB = channel.connectWorker("worker-b");
      const result = sendDirective(channel.targets, "worker-b", buildDirectiveFrame("worker-b", { assignmentId: "asg-2", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
      assert.equal(result.sent, true);
      assert.equal(workerB.frames.length, 1, "worker-b receives exactly one directive frame");
      assert.equal(workerA.frames.length, 0, "worker-a receives no frame");
    },
  },
  {
    name: "directive-down-frame/00 a directive to a node with no live connection is a coded refusal and sends nothing",
    run() {
      const channel = createDirectiveChannelFixture();
      const workerA = channel.connectWorker("worker-a");
      // no connection for "worker-b" at all
      const result = sendDirective(channel.targets, "worker-b", buildDirectiveFrame("worker-b", { assignmentId: "asg-3", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
      assert.equal(result.sent, false);
      assert.equal(result.code, ASSIGNMENT_TARGET_NOT_CONNECTED);
      assert.equal(workerA.frames.length, 0, "no directive frame is written to any socket");
    },
  },
  {
    name: "directive-down-frame/00 end-to-end over a REAL loopback ws: a dispatched directive reaches the worker's registered onDirective handler",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const server = await startControlStreamServer({
          peerNodeIds: ["worker-a"],
          peersByAddress: [{ nodeId: "worker-a", dialAddress: "127.0.0.1" }],
          storeOptions: { env },
        });
        try {
          const port = server.server.address().port;
          const transport = createWorkerWsTransport(`ws://127.0.0.1:${port}/`);
          const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
          const received = [];
          client.onDirective((directive) => received.push(directive));

          await client.ensureConnected();
          await waitFor(() => server.directiveTargets.get("worker-a") != null);

          const result = server.dispatchDirective(buildDirectiveFrame("worker-a", { assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
          assert.equal(result.sent, true);

          await waitFor(() => received.length === 1);
          assert.equal(received[0].assignmentId, "asg-1");
          assert.equal(received[0].to, "worker-a");
        } finally {
          server.stop();
        }
      });
    },
  },
];
