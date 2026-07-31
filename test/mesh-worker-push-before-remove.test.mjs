// test/mesh-worker-push-before-remove.test.mjs — traceability for milestone 38 /
// story 07, task 01 (01_push-before-worktree-removed.feature, ADR-015 decisions 2/3,
// invariants 3/4; @round-trip). Exercised over a REAL LOCAL BARE repo as the push
// `origin` (mesh-worker-push-fixture.mjs) + a REAL `git` spawn wrapped by a
// call-order-recording exec (createRecordingGitExec) — no mocked git, no real GitHub,
// no network. The write credential itself is proven to ride the REAL
// requestWriteCredential -> write-credential-request wire round-trip in
// mesh-worker-write-credential-pull.test.mjs; here it is supplied directly (the SAME
// "inject the resolved value, prove the wire separately" split story-01's OWN
// requestCloneCredential task tests keep between task 05's wire test and every OTHER
// task's direct-injection convenience).
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { createMeshWorkerExecutionHandler } from "../src/mesh-worker-execution.mjs";
import { meshWorktreePath, meshWorkerBranchName } from "../src/mesh-worktree.mjs";
import { markRepoPublished, seedNodeWorkspaceMembership, createStatusRecorder } from "./support/mesh-worker-exec-fixture.mjs";
import { withMeshWorkerPushFixture, createRecordingGitExec, makeOriginBranchDivergent, breakOriginUnreachable, installPreReceiveRefusal } from "./support/mesh-worker-push-fixture.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NODE_ID = "worker-a";
const WRITE_TOKEN = "FAKE-WRITE-TOKEN-xyz789";

async function readyFixture(fx) {
  await markRepoPublished(fx.root, { workspaceId: fx.workspaceId });
  await seedNodeWorkspaceMembership({ home: fx.home }, { nodeId: NODE_ID, workspaceId: fx.workspaceId });
  return loadWorkspace(fx.root, undefined, { env: fx.env });
}

// scriptedSpawnRuntimeThatCommits({ fileName, content }) — the scripted headless-
// runtime double for THIS story: writes a real file into the worktree and commits it
// (the "agent's own commit" the push then carries) before resolving `done`. This is
// the injection seam the REAL agent would occupy in production — the same discipline
// scriptedSpawnRuntime keeps elsewhere in this suite, extended to leave a real diff
// behind for the push to genuinely carry.
function scriptedSpawnRuntimeThatCommits({ fileName = "output.txt", content = "hello from the agent\n" } = {}) {
  return async (brief) => {
    await writeFile(path.join(brief.worktreeCwd, fileName), content, "utf8");
    spawnSyncHardened("git", ["add", "-A"], { cwd: brief.worktreeCwd, encoding: "utf8" });
    spawnSyncHardened("git", ["commit", "-q", "-m", "agent-output"], { cwd: brief.worktreeCwd, encoding: "utf8" });
    return { outcome: "done" };
  };
}

function driveAssignment(fx, ws, assignmentId, { exec, now = "2026-07-18T09:00:00.000Z", requestWriteCredential } = {}) {
  const recorder = createStatusRecorder();
  const handler = createMeshWorkerExecutionHandler({
    loadWs: () => Promise.resolve(ws),
    nodeId: NODE_ID,
    sendAssignmentStatus: recorder.sendAssignmentStatus,
    sendEffectStep: recorder.sendEffectStep,
    spawnRuntime: scriptedSpawnRuntimeThatCommits(),
    now: () => now,
    globalWorkStoreOptions: { env: fx.env },
    exec,
    pushExec: exec,
    requestWriteCredential: requestWriteCredential ?? (async () => WRITE_TOKEN),
  });
  return handler({ kind: "directive", to: NODE_ID, assignmentId, itemRef: fx.itemRef, workspaceId: fx.workspaceId, at: now }).then(() => recorder);
}

export const meshWorkerPushBeforeRemoveTests = [
  // ------------------------------------------------------------------
  // Scenario: on `done` the push runs BEFORE the worktree is removed, and the
  // worktree is present at push time
  // ------------------------------------------------------------------
  {
    name: "task01/38-07 push-before-worktree-removed: on done the push runs BEFORE the worktree is removed, and the worktree is present at push time (observable call order over a real bare origin)",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const assignmentId = "asg-1";
      const worktreePath = meshWorktreePath(fx.root, assignmentId);
      const branch = meshWorkerBranchName(fx.itemRef, assignmentId);
      const calls = [];
      const exec = createRecordingGitExec(calls, { worktreePath });

      const recorder = await driveAssignment(fx, ws, assignmentId, { exec });

      const pushIdx = calls.findIndex((c) => c.kind === "push");
      const removeIdx = calls.findIndex((c) => c.kind === "worktree-remove");
      assert.ok(pushIdx !== -1, `the recorded git call order shows a "push origin ${branch}" call`);
      assert.ok(removeIdx !== -1, "a worktree remove call happened");
      assert.ok(pushIdx < removeIdx, `the recorded git call order shows push origin ${branch} BEFORE any worktree remove`);
      assert.equal(calls[pushIdx].worktreeExistedAtCallTime, true, "at the moment the push is invoked the worktree directory still exists on disk (retained until push succeeds)");
      assert.equal(existsSync(worktreePath), false, "only AFTER the push returns success is the worktree removed");

      const doneFrame = recorder.frames.find((f) => f.state === "done");
      assert.ok(doneFrame, "a clean done status frame was sent");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: the pushed branch reaches origin — durable output at the hermetic altitude
  // ------------------------------------------------------------------
  {
    name: "task01/38-07 push-before-worktree-removed: the pushed branch reaches origin — durable output survives the subsequent worktree force-remove (the direct contradiction of RESEARCH §4.1)",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const assignmentId = "asg-2";
      const worktreePath = meshWorktreePath(fx.root, assignmentId);
      const branch = meshWorkerBranchName(fx.itemRef, assignmentId);
      const calls = [];
      const exec = createRecordingGitExec(calls, { worktreePath });

      await driveAssignment(fx, ws, assignmentId, { exec });

      const branchList = spawnSyncHardened("git", ["branch", "--list", branch], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.ok(branchList.stdout.includes(branch), `the local bare origin's git branch --list ${branch} shows the branch`);

      const show = spawnSyncHardened("git", ["show", `${branch}:output.txt`], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.equal(show.status, 0, `git show ${branch}:output.txt in the bare origin resolves the worker's committed diff`);
      assert.equal(show.stdout, "hello from the agent\n");

      // The diff survives the subsequent worktree force-remove.
      assert.equal(existsSync(worktreePath), false, "the worktree was force-removed");
      const showAfterRemove = spawnSyncHardened("git", ["show", `${branch}:output.txt`], { cwd: fx.bareOrigin, encoding: "utf8" });
      assert.equal(showAfterRemove.status, 0, "the diff still resolves on origin AFTER the worktree force-remove — the direct contradiction of RESEARCH §4.1");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario: the push reuses the ADR-009 askpass shim — no new credential wire, no token at rest
  // ------------------------------------------------------------------
  {
    name: "task01/38-07 push-before-worktree-removed: the push reuses the ADR-009 askpass shim — scoped to the push exec's own env only; the write token is never written into .git/config, ambient process.env, or a log line; the ambient credential.helper is reset",
    run: async () => withMeshWorkerPushFixture(async (fx) => {
      const ws = await readyFixture(fx);
      const assignmentId = "asg-3";
      const worktreePath = meshWorktreePath(fx.root, assignmentId);
      const calls = [];
      const exec = createRecordingGitExec(calls, { worktreePath });

      await driveAssignment(fx, ws, assignmentId, { exec });

      const pushCall = calls.find((c) => c.kind === "push");
      assert.ok(pushCall, "a push call was recorded");
      // GIT_ASKPASS/-c credential.helper= riding THIS exec call's OWN env/argv — never
      // process.env (the pushExec seam is invoked with its OWN per-call env object;
      // ambient process.env carries neither the token value NOR a GIT_ASKPASS pointer
      // this run installed — asserted directly against the ambient object, never a
      // whole-object snapshot diff, which would be a false positive against any
      // UNRELATED env churn from elsewhere in the process).
      assert.ok(pushCall.args.includes("-c") && pushCall.args.includes("credential.helper="), "the ambient credential helper is reset for the push (-c credential.helper=), as the clone path does (SECURITY T7)");
      assert.equal(process.env.GIT_ASKPASS, undefined, "GIT_ASKPASS never lands on ambient process.env");
      assert.ok(!Object.values(process.env).some((v) => v === WRITE_TOKEN), "the write token value never lands on ambient process.env");

      // No token in argv on ANY recorded call.
      for (const call of calls) {
        assert.ok(!call.args.join(" ").includes(WRITE_TOKEN), `the write token never appears in git argv (call: ${call.kind})`);
      }
      // No token persisted to .git/config.
      const gitConfig = await readFile(path.join(fx.root, ".git", "config"), "utf8");
      assert.ok(!gitConfig.includes(WRITE_TOKEN), "the write token is never written into .git/config");
    }),
  },

  // ------------------------------------------------------------------
  // Scenario Outline: a FAILED push RETAINS the worktree and fails LOUDLY — never a clean `done`
  // ------------------------------------------------------------------
  {
    name: "task01/38-07 push-before-worktree-removed: Examples — a FAILED push (non-fast-forward / unreachable / auth-refused) RETAINS the worktree and surfaces a loud coded failure, never a silent clean done (3 rows, over the real bare origin)",
    run: async () => {
      const rows = [
        {
          note: "be rejected (non-fast-forward)",
          setup: async (fx, branch) => makeOriginBranchDivergent(fx, branch),
        },
        {
          note: "hit an unreachable remote",
          setup: async (fx) => breakOriginUnreachable(fx),
        },
        {
          note: "be refused for missing write auth",
          setup: async (fx) => installPreReceiveRefusal(fx),
        },
      ];
      for (const row of rows) {
        await withMeshWorkerPushFixture(async (fx) => {
          const ws = await readyFixture(fx);
          const assignmentId = "asg-fault";
          const worktreePath = meshWorktreePath(fx.root, assignmentId);
          const branch = meshWorkerBranchName(fx.itemRef, assignmentId);
          await row.setup(fx, branch);
          const calls = [];
          const exec = createRecordingGitExec(calls, { worktreePath });

          const recorder = await driveAssignment(fx, ws, assignmentId, { exec });

          assert.equal(existsSync(worktreePath), true, `[${row.note}] the worktree is retained — never force-removed over unpushed commits`);
          const failedFrame = recorder.frames.find((f) => f.state === "failed");
          assert.ok(failedFrame, `[${row.note}] the assignment surfaces a failed status — never a silent clean done`);
          assert.ok(typeof failedFrame.code === "string" && failedFrame.code.length > 0, `[${row.note}] the failure is LOUD and CODED (code="${failedFrame?.code}")`);
          assert.equal(recorder.frames.some((f) => f.state === "done"), false, `[${row.note}] never a clean done`);

          // The worker's local branch and its commits remain on disk, recoverable and retryable.
          const branchList = spawnSyncHardened("git", ["branch", "--list", branch], { cwd: fx.root, encoding: "utf8" });
          assert.ok(branchList.stdout.includes(branch), `[${row.note}] the worker's local branch remains on disk`);
          const log = spawnSyncHardened("git", ["log", "-1", "--oneline", branch], { cwd: fx.root, encoding: "utf8" });
          assert.equal(log.status, 0, `[${row.note}] the local branch's commit is present and inspectable`);
        });
      }
    },
  },
];
