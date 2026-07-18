// test/mesh-worktree-branch-not-detached.test.mjs — traceability for milestone 38 /
// story 07, task 00 (00_real-branch-not-detached.feature, ADR-015 decision 1).
// Exercised against the REAL `createMeshWorkerExecutionHandler` driving a REAL `git
// worktree add -b <branch>` in a disposable temp fixture repo (the story-01 real-
// local-repo pattern, mesh-worker-exec-fixture.mjs) + the REAL `git symbolic-ref` /
// `git rev-parse` / `git branch --list` / `git check-ref-format` binaries — no injected
// git exec fake for the branch-existence assertions themselves (task 00's own
// Background: "@executable over a REAL LOCAL git repo ... NO real GitHub, NO network").
import assert from "node:assert/strict";
import { loadWorkspace } from "../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../src/mesh-worker-execution.mjs";
import { meshWorktreePath, meshWorkerBranchName, listWorktrees, removeWorktree } from "../src/mesh-worktree.mjs";
import { withMeshWorkerExecFixture, markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder, scriptedSpawnRuntime, scriptedPushExec } from "./support/mesh-worker-exec-fixture.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NODE_ID = "worker-a";

async function readyFixture(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  return loadWorkspace(fx.root, undefined, { env: fx.env });
}

// materializeOnly(fx, ws, assignmentId, now) — drives the handler with a `failed`
// scripted outcome (never a real push attempt — task 00 cares about the CHECKOUT
// shape only) + a stub pushExec (belt-and-braces, unreachable on this outcome).
async function materializeOnly(fx, ws, assignmentId, now) {
  const recorder = createStatusRecorder();
  const handler = createMeshWorkerExecutionHandler({
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    spawnRuntime: scriptedSpawnRuntime("failed"),
    pushExec: scriptedPushExec(),
    now: () => now,
    globalWorkStoreOptions: { env: fx.env },
  });
  await handler({ kind: "directive", to: NODE_ID, assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: now });
  return recorder;
}

function git(cwd, args) {
  return spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
}

export const meshWorktreeBranchNotDetachedTests = [
  // ------------------------------------------------------------------
  // Scenario: the worktree is checked out on a real branch — HEAD is on it, not detached
  // ------------------------------------------------------------------
  {
    name: "task00/38-07 real-branch-not-detached: the worktree is checked out on a real branch — HEAD is on it, not detached",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const NOW = "2026-07-18T09:00:00.000Z";
      const assignmentId = "asg-1";
      await materializeOnly(fx, ws, assignmentId, NOW);
      const worktreePath = meshWorktreePath(fx.root, assignmentId);
      const expectedBranch = meshWorkerBranchName(fx.itemRef, assignmentId);

      try {
        const symbolicRef = git(worktreePath, ["symbolic-ref", "--short", "HEAD"]);
        assert.equal(symbolicRef.status, 0, "git symbolic-ref --short HEAD resolves (fails on a detached HEAD)");
        assert.ok(symbolicRef.stdout.trim().startsWith("aof/mesh/"), "the resolved branch is under aof/mesh/");
        assert.equal(symbolicRef.stdout.trim(), expectedBranch);

        const abbrevRef = git(worktreePath, ["rev-parse", "--abbrev-ref", "HEAD"]);
        assert.equal(abbrevRef.stdout.trim(), expectedBranch, "abbrev-ref is the branch name, never the literal HEAD (a detached head)");
        assert.notEqual(abbrevRef.stdout.trim(), "HEAD");

        const branchList = git(fx.root, ["branch", "--list", expectedBranch]);
        assert.ok(branchList.stdout.includes(expectedBranch), `the branch ${expectedBranch} (the ADR-015 DOCUMENTED convention for this clean itemRef) exists in git branch --list`);

        const entries = await listWorktrees(fx.root);
        const entry = entries.find((e) => e.path.includes(assignmentId));
        assert.ok(entry, "listWorktrees reports the worktree entry");
        assert.equal(entry.detached, false, "listWorktrees reports detached: false");
        assert.equal(entry.branch, `refs/heads/${expectedBranch}`, "listWorktrees reports the branch set");
      } finally {
        await removeWorktree(fx.root, assignmentId, { force: true });
      }
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: two assignments for the SAME item get DISTINCT branches, keyed by assignmentId
  // ------------------------------------------------------------------
  {
    name: "task00/38-07 real-branch-not-detached: two assignments for the SAME item get DISTINCT branches, keyed by assignmentId",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const NOW = "2026-07-18T09:00:00.000Z";
      await materializeOnly(fx, ws, "asg-1", NOW);
      await materializeOnly(fx, ws, "asg-2", NOW);
      try {
        const branch1 = meshWorkerBranchName(fx.itemRef, "asg-1");
        const branch2 = meshWorkerBranchName(fx.itemRef, "asg-2");
        assert.notEqual(branch1, branch2, "the two branches are distinct");
        assert.notEqual(meshWorktreePath(fx.root, "asg-1"), meshWorktreePath(fx.root, "asg-2"), "collision-free by the assignmentId key, mirroring meshWorktreePath");
        const list = git(fx.root, ["branch", "--list"]);
        assert.ok(list.stdout.includes(branch1), "branch for asg-1 exists");
        assert.ok(list.stdout.includes(branch2), "branch for asg-2 exists");
      } finally {
        await removeWorktree(fx.root, "asg-1", { force: true });
        await removeWorktree(fx.root, "asg-2", { force: true });
      }
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: a ref-hostile itemRef/assignmentId sanitizes to a VALID git branch
  // ------------------------------------------------------------------
  {
    name: "task00/38-07 real-branch-not-detached: Examples — a ref-hostile itemRef/assignmentId sanitizes to a VALID git branch, prefixed aof/mesh/, distinct per assignment (12 rows)",
    run: () => {
      const rows = [
        { itemRef: "38-07-worker", assignmentId: "asg-1", note: "already clean — passes through valid" },
        { itemRef: "38/07", assignmentId: "asg-1", note: "slash — valid path-component or collapsed" },
        { itemRef: "feat 1", assignmentId: "asg-1", note: "space — forbidden, must sanitize" },
        { itemRef: "feat~1", assignmentId: "asg-1", note: "tilde — forbidden" },
        { itemRef: "a^b", assignmentId: "asg-1", note: "caret — forbidden" },
        { itemRef: "ns:ref", assignmentId: "asg-1", note: "colon — forbidden" },
        { itemRef: "v1..v2", assignmentId: "asg-1", note: "double-dot — forbidden" },
        { itemRef: "head@{0}", assignmentId: "asg-1", note: "@{ sequence — forbidden" },
        { itemRef: ".hidden", assignmentId: "asg-1", note: "leading dot on component — forbidden" },
        { itemRef: "a\\b", assignmentId: "asg-1", note: "backslash — forbidden" },
        { itemRef: "feat?x", assignmentId: "asg-1", note: "question mark — forbidden" },
        { itemRef: "38-07", assignmentId: "asg/../x", note: "hostile assignmentId — must sanitize too" },
      ];
      for (const row of rows) {
        const branch = meshWorkerBranchName(row.itemRef, row.assignmentId);
        assert.ok(branch.startsWith("aof/mesh/"), `[${row.note}] the branch name starts with aof/mesh/ (got "${branch}")`);
        const checkRef = spawnSyncHardened("git", ["check-ref-format", `refs/heads/${branch}`], { encoding: "utf8" });
        assert.equal(checkRef.status, 0, `[${row.note}] "${branch}" passes git check-ref-format (a valid, checkout-able git ref)`);
        // the branch embeds a slug of assignmentId — every SAFE (non-hostile)
        // character of assignmentId survives verbatim in the branch's tail.
        const assignmentSafeChars = String(row.assignmentId).replace(/[^A-Za-z0-9._-]/g, "");
        if (assignmentSafeChars.length > 0) {
          assert.ok(branch.includes(assignmentSafeChars.slice(0, 3)), `[${row.note}] the branch embeds a slug of "${row.assignmentId}" so it is distinct per assignment`);
        }
      }
    },
  },
];
