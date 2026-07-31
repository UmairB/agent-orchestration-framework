// Traceability wiring for milestone 35 / story 01 — task 03
// (tasks/03_control-dispatch-driver.feature, ADR-008 the control-side dispatch/
// reclaim driver — the DISPATCH half). Covers every @executable scenario / Scenario
// Outline row:
//   - the control tick dispatches an assigned row whose target is a connected peer
//   - the assign verb mints without dispatching; the driver dispatches on the next tick
//   - an already-dispatched assigned row is not re-dispatched on the next tick
//   - the tick dispatches only assigned rows targeting a connected peer (Scenario
//     Outline, 6 rows: assigned+connected dispatches; assigned+disconnected left
//     assigned; accepted/running/done/withdrawn never dispatched)
//
// Driven over startLauncher's injected-ticker seam (the mesh-coordination-launcher
// idiom — manualTicker, no wall-clock) + an INJECTED fake stream server exposing a
// dispatch recorder + a connected-peer set (the directiveTargets shape,
// test/support/mesh-directive-channel-fixture.mjs) + a real v3 store (assignment rows
// seeded directly). No live network, no tailnet.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../src/global-work-store.mjs";
import { assignWork } from "../src/mesh-assignment.mjs";
import { seedTargetNode } from "./support/mesh-assign-fixture.mjs";

const NODE_ID = "control-a";
const STATUS_FIXTURE = {
  BackendState: "Running",
  Self: { HostName: NODE_ID, DNSName: `${NODE_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
  Peer: {},
};

function manualTicker() {
  const handles = [];
  return {
    handles,
    start(intervalSeconds, onTick) {
      const handle = { intervalSeconds, onTick, stopped: false };
      handles.push(handle);
      return handle;
    },
    stop(handle) { handle.stopped = true; },
    fire(handle) { return handle.onTick(); },
  };
}

// A fake control-stream server exposing the EXACT shape the driver reads:
// `directiveTargets.get(nodeId)` (a connected-peer resolver) + `dispatchDirective`
// (a recorder), mirroring startControlStreamServer's real returned handle.
function fakeStreamServer({ connectedNodeIds = [], sendResults = null } = {}) {
  const dispatched = [];
  const connected = new Set(connectedNodeIds);
  // sendResults: an optional queue of `{ sent }` results dispatchDirective returns in
  // order (one per call), falling back to `{ sent: true }` once exhausted — lets a
  // test simulate a target present in directiveTargets but not yet OPEN (review fix,
  // live soak 2026-07-17): the map entry exists (fakeStreamServer's own `connected`
  // check passes) while the underlying send still fails.
  const results = Array.isArray(sendResults) ? [...sendResults] : null;
  return {
    dispatched,
    connected,
    directiveTargets: {
      get(nodeId) { return connected.has(nodeId) ? { fake: true } : null; },
    },
    dispatchDirective(directive) {
      dispatched.push(directive);
      return results != null && results.length > 0 ? results.shift() : { sent: true };
    },
    updatePeers() {},
    stop() {},
  };
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-control-dispatch-driver-"));
  const workDir = path.join(repo, "wiki", "work");
  const milestoneDir = path.join(workDir, "35_milestone_demo");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 35\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
    "utf8",
  );
  const storyDir = path.join(milestoneDir, "stories", "01_story_story-01");
  await mkdir(storyDir, { recursive: true });
  await writeFile(
    path.join(storyDir, "STORY.md"),
    "---\ntype: story\nnumber: 01\nslug: story-01\nparent: 35\nstatus: not-started\ntitle: Story 01\n---\n",
    "utf8",
  );
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: { nodeId: NODE_ID, fabric: "tailscale", relay: { controlNode: NODE_ID } },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

const cleanup = (repo) => rm(repo, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });

function launcherOptions(repo, options = {}) {
  const env = { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") };
  return {
    exec: async () => ({ stdout: JSON.stringify(STATUS_FIXTURE), status: 0 }),
    platform: "linux",
    peerPollTicker: manualTicker(),
    propagationTicker: manualTicker(),
    globalWorkStoreOptions: { env },
    ...options,
  };
}

async function seedAssignedRow(repo, { assignmentId = "asg-1", itemRef = "35/01", targetNodeId = "worker-a", state = "assigned" } = {}) {
  const env = { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") };
  const ws = await loadWorkspace(repo, undefined, { env });
  const workspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot);
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    store.db.prepare(`
      INSERT INTO global_assignments
        (assignment_id, item_ref, workspace_id, target_node_id, issuer, state, run_id, assigned_at, updated_at, reclaimed_at)
      VALUES (?, ?, ?, ?, 'control-a', ?, NULL, '2026-07-09T09:00:00.000Z', '2026-07-09T09:00:00.000Z', NULL)
    `).run(assignmentId, itemRef, workspaceId, targetNodeId, state);
  } finally {
    store.close();
  }
  return { workspaceId };
}

async function readRows(repo, workspaceId, itemRef) {
  const env = { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") };
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    return store.db.prepare("SELECT * FROM global_assignments WHERE workspace_id = ? AND item_ref = ? ORDER BY assigned_at").all(workspaceId, itemRef);
  } finally {
    store.close();
  }
}

export const meshControlDispatchDriverTests = [
  {
    name: "control-dispatch-driver/03 the control tick dispatches an assigned row whose target is a connected peer",
    async run() {
      const repo = await makeRepo();
      try {
        const { workspaceId } = await seedAssignedRow(repo, { assignmentId: "asg-1", itemRef: "35/01", targetNodeId: "worker-a" });
        const controlTicker = manualTicker();
        const server = fakeStreamServer({ connectedNodeIds: ["worker-a"] });
        const handle = await startLauncher(await loadWorkspace(repo, undefined, { env: { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") } }), launcherOptions(repo, {
          startControlStreamServer: async () => server,
          controlDispatchReclaimTicker: controlTicker,
        }));
        assert.equal(handle.refused, undefined, "the daemon starts");

        controlTicker.fire(controlTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));

        assert.equal(server.dispatched.length, 1, "a directive is dispatched for the connected-target assigned row");
        const directive = server.dispatched[0];
        assert.equal(directive.assignmentId, "asg-1");
        assert.equal(directive.itemRef, "35/01");
        assert.equal(directive.workspaceId, workspaceId);
        assert.equal(directive.to, "worker-a");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "control-dispatch-driver/03 the assign verb mints without dispatching; the driver dispatches on the next tick",
    async run() {
      const repo = await makeRepo();
      try {
        const env = { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") };
        const ws = await loadWorkspace(repo, undefined, { env });
        const workspaceId = ws.config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot);
        await seedTargetNode({ home: path.join(repo, ".global-aof") }, {
          nodeId: "worker-a", workspaceId, member: true, published: true, projectRoot: ws.projectRoot, workDir: ws.workDir,
        });

        // No control tick has yet fired: assignWork mints and returns; nothing dispatched.
        const minted = await assignWork(ws, "35/01", "worker-a", { globalWorkStoreOptions: { env }, now: "2026-07-08T11:00:00.000Z" });
        assert.equal(minted.ok, true, "an assigned row is minted");
        assert.equal(minted.state, "assigned");

        const rowsBefore = await readRows(repo, workspaceId, "35/01");
        assert.equal(rowsBefore.length, 1, "one assignment row exists");
        assert.equal(rowsBefore[0].state, "assigned");

        // Now drive a control tick over a fresh launcher pointed at the SAME global home.
        const controlTicker = manualTicker();
        const server = fakeStreamServer({ connectedNodeIds: ["worker-a"] });
        const ws2 = await loadWorkspace(repo, undefined, { env });
        const handle = await startLauncher(ws2, launcherOptions(repo, {
          startControlStreamServer: async () => server,
          controlDispatchReclaimTicker: controlTicker,
        }));
        assert.equal(handle.refused, undefined, "the second launcher starts");
        assert.equal(server.dispatched.length, 0, "no directive dispatched before any tick fires");

        controlTicker.fire(controlTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));

        assert.equal(server.dispatched.length, 1, "a directive is dispatched for that assignment to worker-a on the tick");
        assert.equal(server.dispatched[0].to, "worker-a");
        assert.equal(server.dispatched[0].assignmentId, minted.assignmentId);
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "control-dispatch-driver/03 an already-dispatched assigned row is not re-dispatched on the next tick",
    async run() {
      const repo = await makeRepo();
      try {
        await seedAssignedRow(repo, { assignmentId: "asg-1", itemRef: "35/01", targetNodeId: "worker-a" });
        const controlTicker = manualTicker();
        const server = fakeStreamServer({ connectedNodeIds: ["worker-a"] });
        const handle = await startLauncher(await loadWorkspace(repo, undefined, { env: { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") } }), launcherOptions(repo, {
          startControlStreamServer: async () => server,
          controlDispatchReclaimTicker: controlTicker,
        }));
        assert.equal(handle.refused, undefined);

        controlTicker.fire(controlTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(server.dispatched.length, 1, "the first tick dispatches once");

        // "asg-1" is still in state "assigned" (the worker has not yet reported accepted).
        controlTicker.fire(controlTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(server.dispatched.length, 1, "no further directive is dispatched for asg-1 on the second tick");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "control-dispatch-driver/03 the tick dispatches only assigned rows targeting a connected peer — Scenario Outline (6 rows)",
    async run() {
      const rows = [
        { state: "assigned", target: "worker-a", connected: ["worker-a"], dispatched: true },
        { state: "assigned", target: "worker-b", connected: ["worker-a"], dispatched: false },
        { state: "accepted", target: "worker-a", connected: ["worker-a"], dispatched: false },
        { state: "running", target: "worker-a", connected: ["worker-a"], dispatched: false },
        { state: "done", target: "worker-a", connected: ["worker-a"], dispatched: false },
        { state: "withdrawn", target: "worker-a", connected: ["worker-a"], dispatched: false },
      ];
      for (const row of rows) {
        const repo = await makeRepo();
        try {
          await seedAssignedRow(repo, { assignmentId: "asg-x", itemRef: "35/01", targetNodeId: row.target, state: row.state });
          const controlTicker = manualTicker();
          const server = fakeStreamServer({ connectedNodeIds: row.connected });
          const handle = await startLauncher(await loadWorkspace(repo, undefined, { env: { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") } }), launcherOptions(repo, {
            startControlStreamServer: async () => server,
            controlDispatchReclaimTicker: controlTicker,
          }));
          assert.equal(handle.refused, undefined);

          controlTicker.fire(controlTicker.handles[0]);
          await new Promise((resolve) => setTimeout(resolve, 25));

          const label = `[state=${row.state} target=${row.target} connected=${row.connected.join(",")}]`;
          if (row.dispatched) {
            assert.equal(server.dispatched.length, 1, `${label} a directive is dispatched`);
          } else {
            assert.equal(server.dispatched.length, 0, `${label} no directive is dispatched`);
          }
          const stored = await readRows(repo, workspaceIdFor(path.resolve(repo)), "35/01");
          assert.equal(stored[0].state, row.state, `${label} the row's state is byte-unchanged by the tick (dispatch never mutates state)`);
          handle.stop();
        } finally {
          await cleanup(repo);
        }
      }
    },
  },
  {
    name: "control-dispatch-driver/03 a dispatch attempt that does not actually send (target present but not OPEN) is retried on the next tick",
    async run() {
      const repo = await makeRepo();
      try {
        await seedAssignedRow(repo, { assignmentId: "asg-1", itemRef: "35/01", targetNodeId: "worker-a" });
        const controlTicker = manualTicker();
        // The FIRST dispatch attempt reports sent:false (e.g. the socket is in
        // directiveTargets but still mid-handshake, not yet OPEN) — the once-guard
        // must NOT swallow this row; the SECOND attempt succeeds.
        const server = fakeStreamServer({ connectedNodeIds: ["worker-a"], sendResults: [{ sent: false, code: "target-not-connected" }] });
        const handle = await startLauncher(await loadWorkspace(repo, undefined, { env: { AOF_GLOBAL_HOME: path.join(repo, ".global-aof") } }), launcherOptions(repo, {
          startControlStreamServer: async () => server,
          controlDispatchReclaimTicker: controlTicker,
        }));
        assert.equal(handle.refused, undefined);

        controlTicker.fire(controlTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(server.dispatched.length, 1, "a dispatch attempt is made on the first tick");

        controlTicker.fire(controlTicker.handles[0]);
        await new Promise((resolve) => setTimeout(resolve, 25));
        assert.equal(server.dispatched.length, 2, "a send that did not complete is retried on the next tick, not permanently marked dispatched");
        assert.equal(server.dispatched[1].assignmentId, "asg-1");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
];
