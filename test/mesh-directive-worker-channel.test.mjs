// Supplementary wiring for milestone 35 / story 01 — the WORKER-SIDE half of tasks
// 00/02: worker-stream-client.mjs's FIRST receive listener (onMessage on
// createWorkerWsTransport, wired into connect()) and the down-channel/up-channel
// seam Story 02 depends on (onDirective(handler) / sendAssignmentStatus(...)). No
// literal feature-file scenario names this seam directly (the task features assert
// the CONTROL side's observable behaviour) — this file proves the worker-side half
// of the SAME channel: a directive delivered on the transport reaches a registered
// onDirective handler PARSED, and sendAssignmentStatus emits the up-frame shape
// task 02 specifies, over the SAME injected bidirectional fake channel
// (test/support/mesh-directive-channel-fixture.mjs).
import assert from "node:assert/strict";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import { createFakeWorkerTransport } from "./support/mesh-directive-channel-fixture.mjs";

const NOW = "2026-07-09T10:00:00.000Z";

export const meshDirectiveWorkerChannelTests = [
  {
    name: "directive-worker-channel/00 a directive delivered on the transport reaches the registered onDirective handler, parsed",
    run() {
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      const received = [];
      client.onDirective((directive) => received.push(directive));

      transport.deliver({ kind: "directive", to: "worker-a", assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW });

      assert.equal(received.length, 1);
      assert.equal(received[0].kind, "directive");
      assert.equal(received[0].assignmentId, "asg-1");
      assert.equal(received[0].itemRef, "35/01");
    },
  },
  {
    name: "directive-worker-channel/00 a caller that never registers onDirective is unaffected — zero behaviour change, no throw",
    run() {
      const transport = createFakeWorkerTransport();
      createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      assert.doesNotThrow(() => transport.deliver({ kind: "directive", to: "worker-a", assignmentId: "asg-1", itemRef: "35/01", workspaceId: "ws-1", at: NOW }));
    },
  },
  {
    name: "directive-worker-channel/00 a malformed (non-JSON) delivered message is dropped, never thrown (never-crash)",
    run() {
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      const received = [];
      client.onDirective((directive) => received.push(directive));
      assert.doesNotThrow(() => transport.deliver("{not valid json"));
      assert.equal(received.length, 0);
    },
  },
  {
    name: "directive-worker-channel/00 a non-directive frame kind delivered on the transport is ignored by onDirective",
    run() {
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      const received = [];
      client.onDirective((directive) => received.push(directive));
      transport.deliver({ kind: "heartbeat" });
      assert.equal(received.length, 0);
    },
  },
  {
    name: "directive-worker-channel/02 sendAssignmentStatus emits the up-frame { kind, nodeId, assignmentId, state, at } over the same persistent connection",
    async run() {
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      const result = await client.sendAssignmentStatus("asg-1", "accepted");
      assert.equal(result.sent, true);
      assert.equal(transport.frames.length, 1);
      const frame = transport.frames[0];
      assert.equal(frame.kind, "assignment-status");
      assert.equal(frame.nodeId, "worker-a");
      assert.equal(frame.assignmentId, "asg-1");
      assert.equal(frame.state, "accepted");
      assert.equal(frame.at, NOW);
      assert.equal("runId" in frame, false, "no runId key when none is supplied");
    },
  },
  {
    name: "directive-worker-channel/02 sendAssignmentStatus carries the runId on a running transition",
    async run() {
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      await client.sendAssignmentStatus("asg-1", "running", { runId: "run-9" });
      assert.equal(transport.frames[0].runId, "run-9");
    },
  },
  {
    name: "directive-worker-channel/02 sendAssignmentStatus streams accepted -> running -> done in order over the one connection",
    async run() {
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
      await client.sendAssignmentStatus("asg-1", "accepted");
      await client.sendAssignmentStatus("asg-1", "running", { runId: "run-9" });
      await client.sendAssignmentStatus("asg-1", "done");
      assert.deepEqual(transport.frames.map((f) => f.state), ["accepted", "running", "done"]);
    },
  },
];
