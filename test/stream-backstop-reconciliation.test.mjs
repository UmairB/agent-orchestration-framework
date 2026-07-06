// Traceability wiring for milestone 34 / story 04 — task 03
// (tasks/03_backstop-and-reconciliation.feature). Covers every @executable scenario /
// Scenario Outline row:
//   - with the stream down, git-sync still delivers the worker's records to the
//     control node (a REAL bare-remote git fixture, the milestone-22 precedent)
//   - a change missed during a disconnect is reconciled by the reconnect snapshot
//     (over the injected worker-stream-client fake transport + control-stream apply)
//   - the control-node view labels each worker's freshness (Scenario Outline, 3 rows:
//     live / stale / never-connected)
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { syncMesh, runsPathspec } from "../src/mesh-sync.mjs";
import { meshDir } from "../src/mesh-store.mjs";
import { openGlobalWorkProjectionStore, queryGlobalWorkProjection } from "../src/global-work-store.mjs";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import { applyStreamFrame, freshnessLabel } from "../src/control-stream-server.mjs";
import { spawnSyncHardened } from "./support/cli-spawn.mjs";

const NOW = "2026-07-05T10:00:00.000Z";

function git(cwd, args) {
  const result = spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
  return { status: typeof result.status === "number" ? result.status : 1, stdout: result.stdout ?? "", stderr: result.stderr ?? "", error: result.error };
}

function configIdentity(repo) {
  git(repo, ["config", "user.email", "fixture@aof.local"]);
  git(repo, ["config", "user.name", "aof fixture"]);
  git(repo, ["config", "commit.gpgsign", "false"]);
  git(repo, ["config", "core.autocrlf", "false"]);
  git(repo, ["config", "core.eol", "lf"]);
}

// A worker clone + a control-node clone of the SAME bare remote, mirroring
// mesh-git-sync-transport.test.mjs's fixture — this feature's "control node syncs the
// mesh bus" scenario needs BOTH sides of the same git-as-bus fixture, not just one.
async function buildTwoNodeFixture() {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-stream-backstop-"));
  const bare = path.join(tmp, "remote.git");
  await mkdir(bare, { recursive: true });
  let r = git(bare, ["init", "--bare", "-q", "-b", "main"]);
  if (r.error || r.status !== 0) {
    git(bare, ["init", "--bare", "-q"]);
    git(bare, ["symbolic-ref", "HEAD", "refs/heads/main"]);
  }

  const workerClone = path.join(tmp, "worker");
  git(tmp, ["clone", "-q", bare, "worker"]);
  configIdentity(workerClone);
  git(workerClone, ["checkout", "-q", "-b", "main"]);
  const workerWorkspace = { workDir: path.join(workerClone, "wiki", "work"), projectRoot: workerClone };
  await mkdir(path.join(meshDir(workerWorkspace), "nodes"), { recursive: true });
  await writeFile(path.join(workerClone, ".gitattributes"), "* -text\n", "utf8");
  await writeFile(path.join(workerClone, "README.md"), "fixture\n", "utf8");
  git(workerClone, ["add", "-A"]);
  git(workerClone, ["commit", "-q", "-m", "initial"]);
  git(workerClone, ["push", "-q", "-u", "origin", "main"]);

  const controlClone = path.join(tmp, "control");
  git(tmp, ["clone", "-q", bare, "control"]);
  configIdentity(controlClone);
  git(controlClone, ["checkout", "-q", "main"]);
  const controlWorkspace = { workDir: path.join(controlClone, "wiki", "work"), projectRoot: controlClone };
  await mkdir(path.join(meshDir(controlWorkspace), "nodes"), { recursive: true });

  return { tmp, bare, workerWorkspace, controlWorkspace };
}

const cleanup = (fixture) => rm(fixture.tmp, { recursive: true, force: true });

// A minimal run record under the runs-pathspec tree (the SAME shape run-complete
// writes) so a real syncMesh({ roots: [meshDir, runsPathspec] }) tick moves it.
function runRecordPath(workspace, ref) {
  return path.join(workspace.workDir, ...ref.split("/"), "runs", "run-001.json");
}

async function writeRunRecord(workspace, ref, body) {
  const filePath = runRecordPath(workspace, ref);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(body, null, 2), "utf8");
  return filePath;
}

function fakeTransport() {
  const frames = [];
  return {
    frames,
    async connect() { return {}; },
    async send(_handle, frame) { frames.push(frame); },
    close() {},
  };
}

async function withGlobalHome(fn) {
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-stream-backstop-store-"));
  try {
    return await fn({ env: { AOF_GLOBAL_HOME: home } });
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}

export const streamBackstopReconciliationTests = [
  {
    name: "stream-backstop-reconciliation/03 with the stream down, git-sync still delivers the worker's completed run to the control node",
    async run() {
      const fx = await buildTwoNodeFixture();
      try {
        // The worker's stream to the control node is unavailable (never opened in
        // this scenario) — the ONLY delivery path exercised here is git-sync.
        await writeRunRecord(fx.workerWorkspace, "34/04/00", { ref: "34/04/00", status: "completed", nodeId: "worker-a" });
        const workerSync = await syncMesh(fx.workerWorkspace, { roots: [meshDir(fx.workerWorkspace), runsPathspec(fx.workerWorkspace)] });
        assert.equal(workerSync.committed, true, "the worker committed + pushed its completed run");

        // The control node syncs the mesh bus (pulls the worker's pushed commit).
        const controlSync = await syncMesh(fx.controlWorkspace, { roots: [meshDir(fx.controlWorkspace), runsPathspec(fx.controlWorkspace)] });
        assert.ok(!controlSync.reason, "the control node's pull succeeded");

        const { existsSync } = await import("node:fs");
        assert.ok(
          existsSync(runRecordPath(fx.controlWorkspace, "34/04/00")),
          "the control node's checkout now contains the worker's completed run record",
        );
      } finally {
        await cleanup(fx);
      }
    },
  },
  {
    name: "stream-backstop-reconciliation/03 a change missed during a disconnect is reconciled by the reconnect snapshot",
    async run() {
      await withGlobalHome(async ({ env }) => {
        const store = await openGlobalWorkProjectionStore({ env });
        try {
          const transport = fakeTransport();
          const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId: "ws-worker-a", now: () => NOW });

          // Connected: an initial snapshot with one item running.
          await client.sendSnapshot([{ ref: "34/04/00", type: "task", slug: "worker-role", status: "in-progress", title: "Worker role", parent: "34/04", sourcePath: "/x.md" }]);
          await applyStreamFrame(store, transport.frames[0], { now: NOW });

          // The connection drops; the worker advances the item WHILE disconnected —
          // no frame is sent for this change (the stream is down).
          client.notifyDrop();

          // The worker reconnects — the frame contract guarantees the NEXT frame is a
          // fresh full snapshot reflecting the worker's TRUE current state, including
          // the change missed during the outage.
          const currentState = [{ ref: "34/04/00", type: "task", slug: "worker-role", status: "done", title: "Worker role", parent: "34/04", sourcePath: "/x.md" }];
          await client.sendSnapshot(currentState);
          const reconnectFrame = transport.frames.at(-1);
          assert.equal(reconnectFrame.kind, "snapshot", "the reconnect frame is a full snapshot");
          assert.deepEqual(reconnectFrame.items, currentState, "the reconnect snapshot includes the advanced item");

          await applyStreamFrame(store, reconnectFrame, { now: NOW });
          const projection = queryGlobalWorkProjection(store, { workspaceId: "ws-worker-a" });
          assert.equal(projection.items.length, 1);
          assert.equal(projection.items[0].status, "done", "the control node's global store matches the worker's current state");
        } finally {
          store.close();
        }
      });
    },
  },
  {
    name: "stream-backstop-reconciliation/03 the control-node view labels each worker's freshness",
    run() {
      const rows = [
        { situation: "streaming and heartbeating now", connected: true, everConnected: true, lastHeartbeatAt: NOW, now: NOW, freshness: "live" },
        { situation: "previously streamed but its stream has dropped", connected: false, everConnected: true, lastHeartbeatAt: NOW, now: NOW, freshness: "stale" },
        { situation: "visible on the fabric but has never opened a stream", connected: false, everConnected: false, lastHeartbeatAt: null, now: NOW, freshness: "never-connected" },
      ];
      for (const row of rows) {
        assert.equal(
          freshnessLabel({ connected: row.connected, everConnected: row.everConnected, lastHeartbeatAt: row.lastHeartbeatAt, now: row.now, windowSeconds: 30 }),
          row.freshness,
          row.situation,
        );
      }
    },
  },
];
