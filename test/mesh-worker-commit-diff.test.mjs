// test/mesh-worker-commit-diff.test.mjs — VERIFICATION F-38.06i (live two-machine soak
// 2026-07-25). Story 07's push-home (ADR-015) shipped verified against a scripted agent
// that COMMITTED its own diff (mesh-worker-push-before-remove.test.mjs's
// `scriptedSpawnRuntimeThatCommits`). The REAL agent — interactive `claude` running a
// directive — does NOT commit: it leaves its output UNCOMMITTED in the worktree. So the
// real push carried the branch at its base commit and the worker's work stayed stranded
// (measured: a full refine — 7 stories + ADRs + ~180KB of docs — never left the Mac; the
// board read "not-started" over completed work). The fix commits the diff in the handler
// (the mesh's concern, not the agent's) right before the push. These lanes drive the REAL
// createMeshWorkerExecutionHandler over a REAL local bare origin with an agent double that
// leaves an UNCOMMITTED diff (the real producer's shape), plus scripted-exec units for the
// clean-no-op / aof-excluded / loud-failure edges.
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { createMeshWorkerExecutionHandler, commitWorktreeChanges } from "../src/mesh-worker-execution.mjs";
import { meshWorktreePath, meshWorkerBranchName } from "../src/mesh-worktree.mjs";
import { markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder } from "./support/mesh-worker-exec-fixture.mjs";
import { withMeshWorkerPushFixture } from "./support/mesh-worker-push-fixture.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NODE_ID = "worker-a";

async function readyFixture(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  return loadWorkspace(fx.root, undefined, { env: fx.env });
}

// A REAL git exec — every add/reset/commit/push/worktree op runs against the real repo
// and the real bare origin (no mock git). This is the seam the handler's exec + pushExec
// occupy in production.
function realGitExec(args, { cwd, env } = {}) {
  const r = spawnSyncHardened("git", args, { cwd, env, encoding: "utf8" });
  return { status: r.status ?? 1, stdout: String(r.stdout ?? ""), stderr: String(r.stderr ?? "") };
}

// The REAL agent's shape: writes files into the worktree and returns `done` WITHOUT
// committing (the exact behaviour interactive `claude` running a directive has).
function scriptedAgentUncommitted(writeFn) {
  return async (brief) => {
    await writeFn(brief.worktreeCwd);
    return { outcome: "done" };
  };
}

function driveAssignment(fx, ws, assignmentId, { spawnRuntime, now = "2026-07-18T09:00:00.000Z" } = {}) {
  const recorder = createStatusRecorder();
  const handler = createMeshWorkerExecutionHandler({
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    spawnRuntime,
    now: () => now,
    globalWorkStoreOptions: { env: fx.env },
    exec: realGitExec,
    pushExec: realGitExec,
    requestWriteCredential: async () => null, // local bare origin needs no auth
  });
  return handler({ kind: "directive", to: NODE_ID, assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: now }).then(() => recorder);
}

// A scripted git exec for the UNIT edges — records argv, returns scripted status/stdout.
function scriptedExec(script = {}) {
  const calls = [];
  const exec = async (args, opts) => {
    calls.push({ args, opts });
    const sub = args.includes("commit") ? "commit" : args.includes("add") ? "add" : args.includes("reset") ? "reset" : args.includes("diff") ? "diff" : args[0];
    const r = script[sub] ?? { status: 0, stdout: "", stderr: "" };
    return { status: 0, stdout: "", stderr: "", ...r };
  };
  return { exec, calls };
}

export const meshWorkerCommitDiffTests = [
  {
    name: "task01/38-07 (F-38.06i) the REAL agent leaves an UNCOMMITTED diff; the handler commits it before the push, and it reaches origin — the work is no longer stranded",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const assignmentId = "asg-uncommitted";
      const branch = meshWorkerBranchName(fx.itemRef, assignmentId);
      const worktreePath = meshWorktreePath(fx.root, assignmentId);

      const recorder = await driveAssignment(fx, ws, assignmentId, {
        spawnRuntime: scriptedAgentUncommitted(async (wt) => {
          await writeFile(path.join(wt, "refined-output.md"), "# the worker's produced work\n", "utf8");
        }),
      });

      // The done frame is sent (the loop closes), the worktree is force-removed AFTER push.
      assert.ok(recorder.frames.find((f) => f.state === "done"), "a clean done status frame was sent");
      assert.equal(existsSync(worktreePath), false, "the worktree is force-removed only after the commit+push succeeded");

      // The agent's UNCOMMITTED file now reaches origin — because the HANDLER committed it.
      const show = spawnSyncHardened("git", ["show", `${branch}:refined-output.md`], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.equal(show.status, 0, "the agent's file — which it never committed — reaches origin, committed by the handler");
      assert.equal(show.stdout, "# the worker's produced work\n");

      // …committed under the mesh identity, not a random/empty author.
      const author = spawnSyncHardened("git", ["log", "-1", "--format=%an", branch], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.ok(author.stdout.includes("aof-mesh"), "the diff is committed under the aof-mesh worker identity");
    }),
  },
  {
    name: "task01/38-07 (F-38.06i) a produce-NOTHING run makes NO empty commit — a clean done, the branch unchanged on origin",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const assignmentId = "asg-empty";
      const branch = meshWorkerBranchName(fx.itemRef, assignmentId);

      const baseTip = spawnSyncHardened("git", ["rev-parse", "HEAD"], { cwd: fx.root, encoding: "utf8" }).stdout.trim();
      const recorder = await driveAssignment(fx, ws, assignmentId, {
        spawnRuntime: async () => ({ outcome: "done" }), // writes nothing
      });

      assert.ok(recorder.frames.find((f) => f.state === "done"), "a produce-nothing run still reports a clean done");
      // The branch on origin points at the base tip — no fabricated empty commit.
      const originTip = spawnSyncHardened("git", ["rev-parse", branch], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.equal(originTip.stdout.trim(), baseTip, "no empty commit was fabricated — the branch on origin is the base tip");
    }),
  },
  {
    name: "task01/38-07 (F-38.06i) commitWorktreeChanges: a DIRTY worktree stages all, EXCLUDES .aof, and commits under a mesh identity with --no-verify",
    run: async () => {
      const { exec, calls } = scriptedExec({ diff: { status: 0, stdout: "wiki/work/18/STORY.md\n" } });
      const result = await commitWorktreeChanges("/tmp/wt", { message: "msg", node: "worker-a", pushExec: exec });
      assert.deepEqual(result, { committed: true });
      const kinds = calls.map((c) => (c.args.includes("commit") ? "commit" : c.args[0]));
      assert.deepEqual(kinds, ["add", "reset", "diff", "commit"], "the sequence is add -A, reset -- .aof, diff --cached, commit");
      assert.deepEqual(calls[0].args, ["add", "-A"]);
      assert.deepEqual(calls[1].args, ["reset", "-q", "--", ".aof"], "aof's own config/state is never synced home");
      const commitArgs = calls[3].args;
      assert.ok(commitArgs.includes("--no-verify"), "the headless commit skips hooks the worktree cannot run");
      assert.ok(commitArgs.some((a) => a.startsWith("user.name=aof-mesh")), "committed under the aof-mesh identity");
      assert.ok(commitArgs.includes("msg"), "the given message is used");
    },
  },
  {
    name: "task01/38-07 (F-38.06i) commitWorktreeChanges: a CLEAN worktree is a no-op — { committed: false }, never an empty commit",
    run: async () => {
      const { exec, calls } = scriptedExec({ diff: { status: 0, stdout: "  \n" } }); // nothing staged
      const result = await commitWorktreeChanges("/tmp/wt", { message: "msg", node: "worker-a", pushExec: exec });
      assert.deepEqual(result, { committed: false });
      assert.ok(!calls.some((c) => c.args.includes("commit")), "no commit is ever attempted on a clean worktree");
    },
  },
  {
    name: "task01/38-07 (F-38.06i) commitWorktreeChanges: a failing git commit THROWS a coded `commit-failed` (loud, retained — never a silent done over an uncommitted diff)",
    run: async () => {
      const { exec } = scriptedExec({ diff: { status: 0, stdout: "file\n" }, commit: { status: 1, stderr: "hook rejected" } });
      await assert.rejects(
        () => commitWorktreeChanges("/tmp/wt", { message: "msg", node: "worker-a", pushExec: exec }),
        (error) => error.code === "commit-failed",
        "a non-zero git commit surfaces a coded commit-failed",
      );
    },
  },
];
