// task 03 — a done assignment removes its worktree with `git worktree remove`, a
// failed assignment retains it for inspection, and retention is bounded by a
// documented default (milestone 35 / story 02, ADR-004). Exercised over a REAL `git
// worktree add`/`remove` in a temp fixture repo (RESEARCH.md §4 measured); the
// done/failed terminal is reached via the run-lifecycle bracketing of task 02 with an
// injected runtime spawn scripted to each outcome; retention sweeping is driven with
// an injected clock past the documented ceiling.
import assert from "node:assert/strict";
import { loadWorkspace } from "../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../src/mesh-worker-execution.mjs";
import { addWorktree, removeWorktree, listWorktrees, meshWorktreePath, sweepRetainedWorktrees, DEFAULT_WORKTREE_RETENTION_MS } from "../src/mesh-worktree.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedSpawnRuntime } from "./support/mesh-worker-exec-fixture.mjs";

const NODE_ID = "worker-a";

async function readyFixture(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  return loadWorkspace(fx.root, undefined, { env: fx.env });
}

function driveAssignment(fx, ws, assignmentId, spawnOutcome, now) {
  const recorder = createStatusRecorder();
  const handler = createMeshWorkerExecutionHandler({
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    spawnRuntime: scriptedSpawnRuntime(spawnOutcome),
    now: () => now,
    globalWorkStoreOptions: { env: fx.env },
  });
  return handler({ kind: "directive", to: NODE_ID, assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: now }).then(() => recorder);
}

export const meshWorktreeCleanupRetentionTests = [
  {
    name: "worktree-cleanup-retention/03 a done assignment removes its worktree with git worktree remove, leaving the path reusable for a subsequent add",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NOW = "2026-07-09T09:00:00.000Z";
      const ws = await readyFixture(fx);
      await driveAssignment(fx, ws, "asg-cleanup-done", "done", NOW);

      const worktreePath = meshWorktreePath(fx.root, "asg-cleanup-done");
      const { existsSync } = await import("node:fs");
      assert.equal(existsSync(worktreePath), false, "the worktree directory no longer exists");

      const { existsSync: exists2 } = await import("node:fs");
      const path = await import("node:path");
      const adminEntry = path.join(fx.root, ".git", "worktrees", "asg-cleanup-done");
      assert.equal(exists2(adminEntry), false, 'its ".git/worktrees/" admin entry no longer exists');

      // A subsequent worktree add at the SAME path succeeds (no stale prunable metadata blocking it).
      const readded = await addWorktree(fx.root, "asg-cleanup-done", fx.headSha);
      assert.equal(readded, worktreePath, "a subsequent worktree add at the same path succeeds");
      await removeWorktree(fx.root, "asg-cleanup-done", { force: true });
    }),
  },
  {
    name: "worktree-cleanup-retention/03 cleanup does not leave stale prunable admin metadata behind",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NOW = "2026-07-09T09:00:00.000Z";
      const ws = await readyFixture(fx);
      await driveAssignment(fx, ws, "asg-no-prunable", "done", NOW);

      const entries = await listWorktrees(fx.root);
      assert.ok(!entries.some((e) => e.path.includes("asg-no-prunable") && e.prunable), 'no stale ".git/worktrees/" entry for the assignment is reported as prunable by "git worktree list"');
      assert.ok(!entries.some((e) => e.path.includes("asg-no-prunable")), "the assignment's worktree entry is gone entirely (removed clean, never left prunable)");
    }),
  },
  {
    name: "worktree-cleanup-retention/03 a failed assignment retains its worktree for inspection — the checkout stays on disk, its admin entry stays registered",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NOW = "2026-07-09T09:00:00.000Z";
      const ws = await readyFixture(fx);
      await driveAssignment(fx, ws, "asg-retain-failed", "failed", NOW);

      const worktreePath = meshWorktreePath(fx.root, "asg-retain-failed");
      const { existsSync } = await import("node:fs");
      assert.equal(existsSync(worktreePath), true, "the worktree still exists on disk");

      const entries = await listWorktrees(fx.root);
      assert.ok(entries.some((e) => e.path.includes("asg-retain-failed")), 'its ".git/worktrees/" admin entry is still registered');

      await removeWorktree(fx.root, "asg-retain-failed", { force: true });
    }),
  },
  {
    name: "worktree-cleanup-retention/03 a retained failed worktree is kept within the documented default and swept past it — Scenario Outline (2 rows)",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const NOW = "2026-07-09T09:00:00.000Z";
      const ws = await readyFixture(fx);
      await driveAssignment(fx, ws, "asg-within-ceiling", "failed", NOW);
      await driveAssignment(fx, ws, "asg-past-ceiling", "failed", NOW);

      const retained = [
        { assignmentId: "asg-within-ceiling", failedAt: NOW },
        { assignmentId: "asg-past-ceiling", failedAt: NOW },
      ];
      // Sweep at a `now` where "asg-within-ceiling" is still inside the documented
      // default and "asg-past-ceiling" is past it (a distinct, EARLIER failedAt for
      // the past-ceiling entry makes this deterministic without waiting real time).
      retained[1].failedAt = new Date(Date.parse(NOW) - (DEFAULT_WORKTREE_RETENTION_MS + 60_000)).toISOString();
      const sweepNow = NOW;

      const result = await sweepRetainedWorktrees(fx.root, retained, { now: sweepNow });
      assert.deepEqual(result.kept, ["asg-within-ceiling"], "the within-default worktree is kept for inspection");
      assert.deepEqual(result.swept, ["asg-past-ceiling"], 'the past-default worktree is swept with "git worktree remove" (pruned)');

      const { existsSync } = await import("node:fs");
      assert.equal(existsSync(meshWorktreePath(fx.root, "asg-within-ceiling")), true, "the within-default worktree is still on disk");
      assert.equal(existsSync(meshWorktreePath(fx.root, "asg-past-ceiling")), false, "the past-default worktree is gone");

      await removeWorktree(fx.root, "asg-within-ceiling", { force: true });
    }),
  },
];
