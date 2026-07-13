// Traceability wiring for milestone 35 / story 01 — task 02
// (tasks/02_assignment-status-uplink.feature). Covers every @executable scenario /
// Scenario Outline row:
//   - each reported state lands as the assignment record's new state (Scenario
//     Outline, 4 rows: accepted / running-with-runId / done / failed)
//   - a frame cannot advance an assignment held by another node (T6)
//   - the holding node's own connection advances its assignment (T6)
//   - an unrecognised frame kind is a no-op (never-crash)
//
// Driven over applyStreamFrame/applyAssignmentStatusFrame directly, with an injected
// connection identity (options.nodeId — the 34/story-04 injected-admission
// precedent) and a REAL v3 store fixture (ADR-001's dedicated writer,
// updateAssignmentState) — the reusable test/support/mesh-assign-fixture.mjs story
// 00 added. No live ws. Depends on story 00 — the ingest advances the record story
// 00 minted.
import assert from "node:assert/strict";
import { applyStreamFrame, applyAssignmentStatusFrame } from "../src/control-stream-server.mjs";
import { readAssignment } from "../src/assignment-record.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { withMeshAssignFixture, seedAssignment } from "./support/mesh-assign-fixture.mjs";

const NOW = "2026-07-09T10:00:00.000Z";

async function withStore({ home }, fn) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

export const meshAssignmentStatusUplinkTests = [
  {
    name: "assignment-status-uplink/02 each reported state lands as the assignment record's new state — accepted",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-1", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "assigned", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-1", state: "accepted", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, true);
          const record = readAssignment(store, "asg-1");
          assert.equal(record.state, "accepted");
          assert.equal(record.runId, null);
        });
      });
    },
  },
  {
    name: "assignment-status-uplink/02 each reported state lands as the assignment record's new state — running with runId run-9",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-1", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-1", state: "running", runId: "run-9", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, true);
          const record = readAssignment(store, "asg-1");
          assert.equal(record.state, "running");
          assert.equal(record.runId, "run-9");
        });
      });
    },
  },
  {
    name: "assignment-status-uplink/02 each reported state lands as the assignment record's new state — done",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-1", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "running", runId: "run-9", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-1", state: "done", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, true);
          const record = readAssignment(store, "asg-1");
          assert.equal(record.state, "done");
          assert.equal(record.runId, "run-9", "the run link set by the running transition is preserved, not clobbered by a state-only frame");
        });
      });
    },
  },
  {
    name: "assignment-status-uplink/02 each reported state lands as the assignment record's new state — failed",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-1", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "running", runId: "run-9", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-1", state: "failed", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, true);
          const record = readAssignment(store, "asg-1");
          assert.equal(record.state, "failed");
        });
      });
    },
  },
  {
    name: "assignment-status-uplink/02 a frame cannot advance an assignment held by another node",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-b", itemRef: "35/01", workspaceId, targetNodeId: "worker-b", issuer: "control-a", state: "running", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          // A frame arrives on worker-a's CONNECTION (options.nodeId: "worker-a")
          // self-declaring nodeId "worker-b" and trying to advance worker-b's
          // assignment — frame.nodeId must never override the connection identity.
          const frame = { kind: "assignment-status", nodeId: "worker-b", assignmentId: "asg-b", state: "done", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, false, "the assignment is not advanced");
          const record = readAssignment(store, "asg-b");
          assert.equal(record.state, "running", "its recorded state is unchanged");
        });
      });
    },
  },
  {
    name: "assignment-status-uplink/02 the holding node's own connection advances its assignment",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-a", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", nodeId: "worker-a", assignmentId: "asg-a", state: "running", runId: "run-3", at: NOW };
          const result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          assert.equal(result.applied, true);
          const record = readAssignment(store, "asg-a");
          assert.equal(record.state, "running");
          assert.equal(record.runId, "run-3");
        });
      });
    },
  },
  {
    name: "assignment-status-uplink/02 an unrecognised frame kind is a no-op",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-1", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "assigned", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "some-unrecognised-kind", nodeId: "worker-a", assignmentId: "asg-1", state: "done", at: NOW };
          let threw = false;
          let result;
          try {
            result = await applyStreamFrame(store, frame, { now: NOW, nodeId: "worker-a" });
          } catch {
            threw = true;
          }
          assert.equal(threw, false, "the server does not crash");
          assert.equal(result.code, "unknown-frame-kind");
          const record = readAssignment(store, "asg-1");
          assert.equal(record.state, "assigned", "no assignment record is changed");
        });
      });
    },
  },
  {
    name: "assignment-status-uplink/02 a status frame carrying no connection nodeId and no self-declared frame.nodeId is a no-op (contract-shape guard, R4/m23)",
    async run() {
      await withMeshAssignFixture(async ({ workspaceId, home }) => {
        await seedAssignment({ home }, { assignmentId: "asg-1", itemRef: "35/01", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "assigned", assignedAt: NOW });
        await withStore({ home }, async (store) => {
          const frame = { kind: "assignment-status", assignmentId: "asg-1", state: "done", at: NOW };
          const result = await applyAssignmentStatusFrame(store, frame, { now: NOW });
          assert.equal(result.applied, false);
          assert.equal(result.code, "assignment-status-frame-invalid");
        });
      });
    },
  },
];
