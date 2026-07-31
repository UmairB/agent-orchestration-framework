// task 02 — `aof mesh assign <ref> --withdraw` revokes an assignment as a state write,
// never a row delete (milestone 35 / story 00, ADR-001/003). Hermetic over
// AOF_GLOBAL_HOME opening a v3 store + an injected clock.
import assert from "node:assert/strict";
import { assignWork, withdrawWork } from "../src/mesh-assignment.mjs";
import { withMeshAssignFixture, seedTargetNode, seedAssignment, readAssignmentRows } from "./support/mesh-assign-fixture.mjs";

const NOW = "2026-07-08T12:00:00.000Z";

async function seedAvailable(env, workspaceId, root, workDir, nodeId = "worker-a") {
  await seedTargetNode(env, { nodeId, workspaceId, member: true, published: true, projectRoot: root, workDir });
}

export const meshAssignWithdrawTests = [
  {
    name: "mesh-assign-withdraw/00 withdrawing an active assignment flips its state to withdrawn and preserves every other key",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-a");
      const minted = await assignWork(workspace, "35/00", "worker-a", { ...ctx, now: "2026-07-08T11:00:00.000Z" });
      assert.equal(minted.ok, true);

      const result = await withdrawWork(workspace, "35/00", { ...ctx, now: NOW });
      assert.equal(result.ok, true);
      assert.equal(result.assignment.state, "withdrawn");
      assert.equal(result.assignment.updatedAt, NOW, "updatedAt is restamped");

      for (const key of ["assignmentId", "itemRef", "workspaceId", "targetNodeId", "issuer", "runId", "assignedAt", "reclaimedAt"]) {
        assert.equal(result.assignment[key], minted[key], `${key} is byte-unchanged`);
      }

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 1, "the row was updated in place, never deleted");
    }),
  },
  {
    name: "mesh-assign-withdraw/01 withdrawing an already-withdrawn assignment re-writes withdrawn without deleting the row",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home }) => {
      await seedAssignment({ home }, {
        assignmentId: "already-withdrawn",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "worker-a",
        issuer: "control-a",
        state: "withdrawn",
        assignedAt: "2026-07-08T10:00:00.000Z",
        updatedAt: "2026-07-08T10:30:00.000Z",
      });

      const result = await withdrawWork(workspace, "35/00", { ...ctx, now: NOW });
      assert.equal(result.ok, true);
      assert.equal(result.assignment.state, "withdrawn");

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 1, "no second assignment row was created");
    }),
  },
  {
    name: "mesh-assign-withdraw/02 withdrawing a never-assigned ref yields a benign null and fabricates nothing",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home }) => {
      const result = await withdrawWork(workspace, "35/00", { ...ctx, now: NOW });
      assert.equal(result.ok, true, "the operation is not an error");
      assert.equal(result.assignment, null, "the result is a benign null");

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 0, "no assignment row is fabricated for that item");
    }),
  },
  {
    // QA advisory A3 (review fix, 2026-07-09): withdraw only flips the ACTIVE
    // assignment (assigned/accepted/running) — the feature's "flips the ACTIVE
    // assignment" wording. When the latest row is already terminal but NOT
    // `withdrawn` (done/failed/reclaimed — a worker- or reclaim-owned outcome),
    // withdraw must return a benign null and rewrite nothing, never reclassify a
    // completed/failed/reclaimed row as withdrawn.
    name: "mesh-assign-withdraw/04 withdrawing when the latest row is already terminal-but-not-withdrawn (done/failed/reclaimed) yields a benign null and rewrites nothing — Scenario Outline",
    run: async () => {
      for (const state of ["done", "failed", "reclaimed"]) {
        await withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home }) => {
          await seedAssignment({ home }, {
            assignmentId: `terminal-${state}`,
            itemRef: "35/00",
            workspaceId,
            targetNodeId: "worker-a",
            issuer: "control-a",
            state,
            runId: state === "done" || state === "failed" || state === "reclaimed" ? "run-1" : null,
            assignedAt: "2026-07-08T10:00:00.000Z",
            updatedAt: "2026-07-08T10:30:00.000Z",
          });

          const result = await withdrawWork(workspace, "35/00", { ...ctx, now: NOW });
          assert.equal(result.ok, true, `[${state}] the operation is not an error`);
          assert.equal(result.assignment, null, `[${state}] the result is a benign null`);

          const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
          assert.equal(rows.length, 1, `[${state}] no second row was created`);
          assert.equal(rows[0].state, state, `[${state}] the row's state is byte-unchanged — never reclassified as withdrawn`);
          assert.equal(rows[0].updated_at, "2026-07-08T10:30:00.000Z", `[${state}] updatedAt is byte-unchanged — no rewrite`);
        });
      }
    },
  },
  {
    name: "mesh-assign-withdraw/03 after withdraw a fresh assign on the same item passes the uniqueness check",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-a");
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-b");
      await seedAssignment({ home }, {
        assignmentId: "running-1",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "worker-a",
        issuer: "control-a",
        state: "running",
        assignedAt: "2026-07-08T10:00:00.000Z",
      });

      const withdrawal = await withdrawWork(workspace, "35/00", { ...ctx, now: "2026-07-08T11:00:00.000Z" });
      assert.equal(withdrawal.ok, true);
      assert.equal(withdrawal.assignment.state, "withdrawn");

      const second = await assignWork(workspace, "35/00", "worker-b", { ...ctx, now: NOW });
      assert.equal(second.ok, true, "the second assign succeeds");
      assert.equal(second.state, "assigned");
      assert.equal(second.targetNodeId, "worker-b", 'a fresh "assigned" record targeting "worker-b" is minted');

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 2, "the withdrawn assignment row is retained alongside the fresh mint");
      assert.ok(rows.some((row) => row.assignment_id === "running-1" && row.state === "withdrawn"));
    }),
  },
];
