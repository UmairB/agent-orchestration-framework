// task 01 — `aof mesh assign <ref> --to <nodeId>` mints an assigned record and
// enforces one active assignment per item (milestone 35 / story 00, ADR-001/003/007).
// Hermetic over AOF_GLOBAL_HOME opening a v3 store + an injected clock. Every target
// is available here (the repo-availability gate itself is task 03's own suite).
import assert from "node:assert/strict";
import { assignWork } from "../src/mesh-assignment.mjs";
import { withMeshAssignFixture, seedTargetNode, seedAssignment, readAssignmentRows } from "./support/mesh-assign-fixture.mjs";

const NOW = "2026-07-08T12:00:00.000Z";

async function seedAvailable(env, workspaceId, root, workDir, nodeId = "worker-a") {
  await seedTargetNode(env, { nodeId, workspaceId, member: true, published: true, projectRoot: root, workDir });
}

export const meshAssignVerbTests = [
  {
    name: "mesh-assign-verb/00 assigning a resolvable ref mints an assigned record targeting the node",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedAvailable({ home }, workspaceId, root, workDir);
      const result = await assignWork(workspace, "35/00", "worker-a", { ...ctx, now: NOW });
      assert.equal(result.ok, true);
      assert.equal(result.state, "assigned");
      assert.equal(result.targetNodeId, "worker-a");
      assert.equal(result.issuer, "control-a");
      assert.equal(result.assignedAt, NOW);
      assert.equal(result.updatedAt, NOW);
      assert.equal(result.runId, null);
      assert.equal(result.reclaimedAt, null);

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 1, "one assignment minted for that item on its workspace");
    }),
  },
  {
    name: "mesh-assign-verb/01 a second assign is refused while a prior is ACTIVE, succeeds once TERMINAL",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-a");
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-b");

      const activePriors = ["assigned", "accepted", "running"];
      for (const prior of activePriors) {
        await withMeshAssignFixture(async (inner) => {
          await seedAvailable({ home: inner.home }, inner.workspaceId, inner.root, inner.workDir, "worker-a");
          await seedAvailable({ home: inner.home }, inner.workspaceId, inner.root, inner.workDir, "worker-b");
          await seedAssignment({ home: inner.home }, {
            assignmentId: `prior-${prior}`,
            itemRef: "35/00",
            workspaceId: inner.workspaceId,
            targetNodeId: "worker-a",
            issuer: "control-a",
            state: prior,
            assignedAt: "2026-07-08T11:00:00.000Z",
          });
          const result = await assignWork(inner.workspace, "35/00", "worker-b", { ...inner.ctx, now: NOW });
          assert.equal(result.ok, false, `prior "${prior}" refuses a second active assign`);
          assert.equal(result.code, "assignment-already-active");
          const rows = await readAssignmentRows({ home: inner.home }, inner.workspaceId, "35/00");
          assert.equal(rows.length, 1, "nothing minted");
        });
      }

      const terminalPriors = ["done", "failed", "withdrawn", "reclaimed"];
      for (const prior of terminalPriors) {
        await withMeshAssignFixture(async (inner) => {
          await seedAvailable({ home: inner.home }, inner.workspaceId, inner.root, inner.workDir, "worker-a");
          await seedAvailable({ home: inner.home }, inner.workspaceId, inner.root, inner.workDir, "worker-b");
          await seedAssignment({ home: inner.home }, {
            assignmentId: `prior-${prior}`,
            itemRef: "35/00",
            workspaceId: inner.workspaceId,
            targetNodeId: "worker-a",
            issuer: "control-a",
            state: prior,
            assignedAt: "2026-07-08T11:00:00.000Z",
          });
          const result = await assignWork(inner.workspace, "35/00", "worker-b", { ...inner.ctx, now: NOW });
          assert.equal(result.ok, true, `prior "${prior}" allows a fresh assign`);
          assert.equal(result.targetNodeId, "worker-b");
          assert.equal(result.state, "assigned");
        });
      }
    }),
  },
  {
    name: "mesh-assign-verb/02 refusing a second active assign names the holding node and mints nothing",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-a");
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-b");
      await seedAssignment({ home }, {
        assignmentId: "active-1",
        itemRef: "35/00",
        workspaceId,
        targetNodeId: "worker-a",
        issuer: "control-a",
        state: "running",
        assignedAt: "2026-07-08T11:00:00.000Z",
      });

      const result = await assignWork(workspace, "35/00", "worker-b", { ...ctx, now: NOW });
      assert.equal(result.ok, false);
      assert.equal(result.code, "assignment-already-active");
      assert.equal(result.holder, "worker-a");
      assert.match(result.error, /worker-a/);

      const rows = await readAssignmentRows({ home }, workspaceId, "35/00");
      assert.equal(rows.length, 1, "the global_assignments row count for that item is unchanged");
      assert.ok(rows.every((row) => row.target_node_id !== "worker-b"), "no assignment targeting worker-b was minted");
    }),
  },
  {
    name: "mesh-assign-verb/03 an unresolvable ref is refused with a coded miss and mints nothing",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedAvailable({ home }, workspaceId, root, workDir);
      const result = await assignWork(workspace, "35/99", "worker-a", { ...ctx, now: NOW });
      assert.equal(result.ok, false);
      assert.equal(result.code, "ref-not-found");
      const rows = await readAssignmentRows({ home }, workspaceId, "35/99");
      assert.equal(rows.length, 0, "no assignment is minted");
    }),
  },
  {
    name: "mesh-assign-verb/04 the --json envelope is a single ok-or-error shape across cases",
    run: async () => withMeshAssignFixture(async ({ workspace, workspaceId, ctx, home, root, workDir }) => {
      await seedAvailable({ home }, workspaceId, root, workDir, "worker-a");

      // a clean mint on a resolvable ref
      const clean = await assignWork(workspace, "35/00", "worker-a", { ...ctx, now: NOW });
      assert.equal(clean.ok, true);
      assert.equal(clean.assignmentId != null, true);

      // a second active assign on the same item
      const dup = await assignWork(workspace, "35/00", "worker-a", { ...ctx, now: NOW });
      assert.equal(dup.ok, false);
      assert.equal(dup.code, "assignment-already-active");

      // an unresolvable ref
      const missing = await assignWork(workspace, "35/99", "worker-a", { ...ctx, now: NOW });
      assert.equal(missing.ok, false);
      assert.equal(missing.code, "ref-not-found");
    }),
  },
];
