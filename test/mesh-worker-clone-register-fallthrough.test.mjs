// test/mesh-worker-clone-register-fallthrough.test.mjs — traceability for milestone
// 38 / story 01 task 02 (02_register-and-fallthrough.feature). Every @executable
// scenario + Examples row wired to the real engine surface: workerHasRepo /
// cloneRepoForWorkspace / createMeshWorkerExecutionHandler (src/mesh-worker-
// execution.mjs), reusing addWorktree VERBATIM (src/mesh-worktree.mjs).
import assert from "node:assert/strict";
import {
  workerHasRepo,
  cloneRepoForWorkspace,
  createMeshWorkerExecutionHandler,
} from "../src/mesh-worker-execution.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { readJson } from "../src/fs.mjs";
import { loadWorkspace } from "../src/work.mjs";
import path from "node:path";
import { execFile } from "node:child_process";
import {
  withMeshCloneFixture,
  createStatusRecorder,
  createRecordingCloneExec,
  scriptedSpawnRuntime,
  scriptedPushExec,
} from "./support/mesh-worker-clone-fixture.mjs";

export const meshWorkerCloneRegisterFallthroughTests = [
  // Scenario: a successful clone registers both repo-availability facts and the guard then passes
  {
    name: "task02/38 worker-repo-checkout: a successful clone registers both facts and workerHasRepo re-check returns true; the handler reaches addWorktree->startRun (no new worktree call site)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env, headSha }) => {
      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      // The worktree exec is left at its REAL default (mesh-worktree.mjs's own git
      // spawn against the fixture's real git repo) — this task's scope is the
      // register-then-fallthrough bracket, and RESEARCH.md §1.6 / the m35 fixtures
      // already exercise real worktree mechanics; only the CLONE step is faked
      // (no real forge/network, per the developer-amigo feasibility seat).
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        now: () => "2026-07-10T09:00:00.000Z",
        globalWorkStoreOptions: { env },
      });

      const hasRepoBefore = await workerHasRepo(workspace, workspaceId, "worker-a", { globalWorkStoreOptions: { env } });
      assert.equal(hasRepoBefore, false, "before the clone, workerHasRepo is false");

      await handler({ assignmentId: "asg-02-success", itemRef, workspaceId });

      // Both facts written.
      const onDiskConfig = await readJson(path.join(workspace.projectRoot, ".aof", "aof.config.json"));
      assert.equal(onDiskConfig.mesh.repo.published, true);
      assert.equal(onDiskConfig.mesh.repo.workspaceId, workspaceId);

      const store = await openGlobalWorkProjectionStore({ env });
      try {
        const row = store.db.prepare("SELECT 1 FROM global_node_workspaces WHERE node_id = ? AND workspace_id = ?").get("worker-a", workspaceId);
        assert.ok(row, "a global_node_workspaces row exists for (worker-a, workspaceId)");
      } finally {
        store.close();
      }

      // Re-check passes; the handler reached accepted->running->done (the existing
      // m35 addWorktree->startRun flow — no new worktree call site, this task's
      // fixture's exec fake is the ONLY worktree-add call the handler makes). Reload
      // from disk (the ORIGINAL `workspace` object is a snapshot from before the
      // clone — the marker was written to disk by writeRepoPublishedMarker).
      const reloadedWs = await loadWorkspace(workspace.projectRoot, undefined, { env });
      const hasRepoAfter = await workerHasRepo(reloadedWs, workspaceId, "worker-a", { globalWorkStoreOptions: { env } });
      assert.equal(hasRepoAfter, true);

      const states = status.frames.map((f) => f.state);
      assert.deepEqual(states, ["accepted", "running", "done"]);
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: a failed clone registers nothing and streams a loud coded failed
  {
    name: "task02/38 worker-repo-checkout: a failed clone registers neither fact and streams a loud coded failed",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec({ status: 1, stdout: "", stderr: "fatal: could not read from remote" });
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
      });

      await handler({ assignmentId: "asg-02-cloneFail", itemRef, workspaceId });

      const onDiskConfig = await readJson(path.join(workspace.projectRoot, ".aof", "aof.config.json"));
      assert.equal(onDiskConfig.mesh.repo?.published, undefined, "no published marker was written");

      const store = await openGlobalWorkProjectionStore({ env });
      try {
        const row = store.db.prepare("SELECT 1 FROM global_node_workspaces WHERE node_id = ? AND workspace_id = ?").get("worker-a", workspaceId);
        assert.equal(row, undefined, "no global_node_workspaces row was written");
      } finally {
        store.close();
      }

      assert.equal(status.frames.length, 1);
      assert.equal(status.frames[0].state, "failed");
      assert.ok(status.frames[0].code, "a code is present on the failed frame");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: before any clone the worker lacks both facts and workerHasRepo is false
  {
    name: "task02/38 worker-repo-checkout: before any clone the worker lacks both facts, workerHasRepo is false, the worker enters the clone-on-miss prefix rather than refusing outright",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const hasRepo = await workerHasRepo(workspace, workspaceId, "worker-a", { globalWorkStoreOptions: { env } });
      assert.equal(hasRepo, false);

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        exec: async () => ({ status: 0, stdout: "", stderr: "" }),
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });
      await handler({ assignmentId: "asg-02-prefix", itemRef: "38/00", workspaceId });
      // The clone-on-miss prefix was entered (a clone spawn happened) rather than an
      // outright refusal.
      assert.equal(cloneExec.calls.length, 1, "the worker attempted a clone rather than refusing outright");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario Outline: the re-checked guard reflects exactly which repo-availability facts the clone wrote
  {
    name: "task02/38 worker-repo-checkout: Examples — workerHasRepo reflects EXACTLY which facts are present (the join semantics)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const { writeRepoPublishedMarker } = await import("../src/mesh-repo-marker.mjs");
      const configPath = path.join(workspace.projectRoot, ".aof", "aof.config.json");

      async function writeRow() {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run("worker-a", workspaceId);
        } finally {
          store.close();
        }
      }

      // marker=written, row=written -> true
      await writeRepoPublishedMarker({ configPath, workspaceId, now: "2026-07-10T09:00:00.000Z" });
      await writeRow();
      let ws = await import("../src/work.mjs").then((m) => m.loadWorkspace(workspace.projectRoot, undefined, { env }));
      assert.equal(await workerHasRepo(ws, workspaceId, "worker-a", { globalWorkStoreOptions: { env } }), true, "marker=written, row=written -> true");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  {
    name: "task02/38 worker-repo-checkout: Examples — marker written, row absent -> false (half-registered never reads as available)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const { writeRepoPublishedMarker } = await import("../src/mesh-repo-marker.mjs");
      const configPath = path.join(workspace.projectRoot, ".aof", "aof.config.json");
      await writeRepoPublishedMarker({ configPath, workspaceId, now: "2026-07-10T09:00:00.000Z" });
      const ws = await import("../src/work.mjs").then((m) => m.loadWorkspace(workspace.projectRoot, undefined, { env }));
      assert.equal(await workerHasRepo(ws, workspaceId, "worker-a", { globalWorkStoreOptions: { env } }), false);
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  {
    name: "task02/38 worker-repo-checkout: Examples — marker absent, row written -> false (half-registered never reads as available)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      const store = await openGlobalWorkProjectionStore({ env });
      try {
        store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run("worker-a", workspaceId);
      } finally {
        store.close();
      }
      assert.equal(await workerHasRepo(workspace, workspaceId, "worker-a", { globalWorkStoreOptions: { env } }), false);
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  {
    name: "task02/38 worker-repo-checkout: Examples — marker absent, row absent -> false (nothing registered)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, env }) => {
      assert.equal(await workerHasRepo(workspace, workspaceId, "worker-a", { globalWorkStoreOptions: { env } }), false);
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario: after registration the handler reaches the existing addWorktree seam, not a new worktree call site
  {
    name: "task02/38 worker-repo-checkout: after registration the handler streams accepted->running as m35 does; the worktree is materialized via the EXISTING addWorktree seam; no second worktree add call site",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const worktreeExecCalls = [];
      // A RECORDING-but-delegating exec: records every worktree call's argv then
      // spawns the REAL git binary (so the worktree genuinely materializes and
      // findWork can resolve inside it — this task's scope is the register-then-
      // fallthrough bracket, exercised over a REAL worktree, matching the m35
      // fixture precedent; only the CLONE step itself is faked).
      const recordingExec = (args, opts) => {
        worktreeExecCalls.push(args);
        return new Promise((resolve, reject) => {
          execFile("git", args, { cwd: opts?.cwd, windowsHide: true }, (error, stdout, stderr) => {
            if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
              reject(error);
              return;
            }
            resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
          });
        });
      };
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        exec: recordingExec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });
      await handler({ assignmentId: "asg-02-existingSeam", itemRef, workspaceId });

      const states = status.frames.map((f) => f.state);
      assert.deepEqual(states.slice(0, 2), ["accepted", "running"]);
      const addCalls = worktreeExecCalls.filter((args) => args[0] === "worktree" && args[1] === "add");
      assert.equal(addCalls.length, 1, "exactly ONE worktree add call — the existing mesh-worktree.mjs seam, no new call site");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
  // Scenario Outline: a clone that fails at any stage registers neither fact and streams a loud coded failed
  {
    name: "task02/38 worker-repo-checkout: Examples — a clone failure at any stage registers neither fact, streams a loud coded failed, and a subsequent re-check returns false",
    run: async () => {
      const failureModes = [
        { label: "non-zero git exit", script: { status: 1, stdout: "", stderr: "fatal: repository not found" } },
        { label: "clone spawn cannot start", script: () => { throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" }); } },
        { label: "authenticated-URL / auth error", script: { status: 128, stdout: "", stderr: "fatal: Authentication failed" } },
      ];
      for (const { label, script } of failureModes) {
        await withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
          const status = createStatusRecorder();
          const cloneExec = createRecordingCloneExec(script);
          const handler = createMeshWorkerExecutionHandler({
            pushExec: scriptedPushExec(),
            loadWs: () => Promise.resolve(workspace),
            nodeId: "worker-a",
            sendAssignmentStatus: status.sendAssignmentStatus,
            cloneExec: cloneExec.exec,
            globalWorkStoreOptions: { env },
          });
          await handler({ assignmentId: `asg-02-fail-${label}`, itemRef, workspaceId });

          const onDiskConfig = await readJson(path.join(workspace.projectRoot, ".aof", "aof.config.json"));
          assert.equal(onDiskConfig.mesh.repo?.published, undefined, `[${label}] no published marker written`);

          const store = await openGlobalWorkProjectionStore({ env });
          try {
            const row = store.db.prepare("SELECT 1 FROM global_node_workspaces WHERE node_id = ? AND workspace_id = ?").get("worker-a", workspaceId);
            assert.equal(row, undefined, `[${label}] no global_node_workspaces row written`);
          } finally {
            store.close();
          }

          assert.equal(status.frames.length, 1, `[${label}] exactly one frame`);
          assert.equal(status.frames[0].state, "failed", `[${label}] the frame is failed`);
          assert.ok(status.frames[0].code, `[${label}] a code is present`);

          const stillFalse = await workerHasRepo(workspace, workspaceId, "worker-a", { globalWorkStoreOptions: { env } });
          assert.equal(stillFalse, false, `[${label}] a subsequent workerHasRepo re-check returns false`);
        }, { cloneUrl: "https://git.example.com/acme/secret.git" });
      }
    },
  },
  // Scenario: a re-dispatch of an already-provisioned assignment re-clones nothing and re-runs nothing
  {
    name: "task02/38 worker-repo-checkout: a re-dispatch of an already-provisioned assignment is ignored by dispatch-once (no re-clone, no re-run)",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        cloneExec: cloneExec.exec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });

      await handler({ assignmentId: "asg-1", itemRef, workspaceId });
      assert.equal(status.frames.at(-1)?.state, "done", "the first dispatch actually completes (real worktree materialized)");
      const framesAfterFirst = status.frames.length;
      const clonesAfterFirst = cloneExec.calls.length;
      const rowsAfterFirst = await countMembershipRows(env, workspaceId);

      // Re-dispatch the SAME assignmentId.
      await handler({ assignmentId: "asg-1", itemRef, workspaceId });

      assert.equal(status.frames.length, framesAfterFirst, "no re-sent accepted/running/done frames");
      assert.equal(cloneExec.calls.length, clonesAfterFirst, "no second clone attempted");
      assert.equal(await countMembershipRows(env, workspaceId), rowsAfterFirst, "no second global_node_workspaces row or run created");
    }, { cloneUrl: "https://git.example.com/acme/secret.git" }),
  },
];

async function countMembershipRows(env, workspaceId) {
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM global_node_workspaces WHERE workspace_id = ?").get(workspaceId);
    return rows.n;
  } finally {
    store.close();
  }
}
