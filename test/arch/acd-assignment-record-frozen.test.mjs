// Fitness function: acd-assignment-record-frozen (milestone 35 / ADR-001, fitness #3)
// — "The assignment assembler returns EXACTLY the frozen key set, in order."
//
// Proof: call assembleAssignmentRecord with representative input; assert
// Object.keys(record) deep-equals the frozen ten, order-sensitive (mirroring the
// run record's 14-key freeze / the presence record's 4-key freeze). Self-check
// (m03 non-vacuous): a planted assembler returning an extra/missing/reordered key
// fails the SAME order-sensitive assertion the real assembler passes.
import assert from "node:assert/strict";
import { assembleAssignmentRecord } from "../../src/assignment-record.mjs";

const FROZEN_KEYS = [
  "assignmentId", "itemRef", "workspaceId", "targetNodeId", "issuer",
  "state", "runId", "assignedAt", "updatedAt", "reclaimedAt",
];

export const archTests = [
  {
    name: "arch/35 ADR-001 (acd-assignment-record-frozen): the assembler returns EXACTLY the ten frozen keys, in order",
    run: async () => {
      const record = assembleAssignmentRecord({
        itemRef: "35/00",
        workspaceId: "ws-1",
        targetNodeId: "worker-a",
        issuer: "control-a",
        now: "2026-07-08T10:00:00.000Z",
      });
      assert.deepEqual(Object.keys(record), FROZEN_KEYS, "assembler key order matches the frozen ten");
    },
  },
  {
    name: "arch/35 ADR-001 (acd-assignment-record-frozen): the freeze holds across explicit state/runId/reclaimedAt overrides",
    run: async () => {
      const record = assembleAssignmentRecord({
        itemRef: "35/01",
        workspaceId: "ws-2",
        targetNodeId: "worker-b",
        issuer: "control-b",
        state: "running",
        runId: "run-1",
        reclaimedAt: null,
        now: "2026-07-08T10:00:00.000Z",
      });
      assert.deepEqual(Object.keys(record), FROZEN_KEYS);
    },
  },
  {
    name: "arch/35 ADR-001 (acd-assignment-record-frozen): self-check — a planted assembler with an extra/missing/reordered key fails the SAME assertion the real one passes",
    run: async () => {
      const real = assembleAssignmentRecord({
        itemRef: "35/00", workspaceId: "ws-1", targetNodeId: "worker-a", issuer: "control-a", now: "2026-07-08T10:00:00.000Z",
      });
      assert.deepEqual(Object.keys(real), FROZEN_KEYS, "the real assembler is clean");

      const extraKey = { ...real, extra: "smuggled" };
      assert.notDeepEqual(Object.keys(extraKey), FROZEN_KEYS, "a planted extra key trips the detector");

      const { runId, ...missingKey } = real;
      assert.notDeepEqual(Object.keys(missingKey), FROZEN_KEYS, "a planted missing key trips the detector");

      const reordered = { assignmentId: real.assignmentId, itemRef: real.itemRef, state: real.state, workspaceId: real.workspaceId, targetNodeId: real.targetNodeId, issuer: real.issuer, runId: real.runId, assignedAt: real.assignedAt, updatedAt: real.updatedAt, reclaimedAt: real.reclaimedAt };
      assert.notDeepEqual(Object.keys(reordered), FROZEN_KEYS, "a planted reordering trips the order-sensitive detector");
    },
  },
];
