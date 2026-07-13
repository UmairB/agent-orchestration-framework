// Traceability wiring for milestone 35 / story 02 — task 06
// (tasks/06_reclaim-scheduler.feature, ADR-008 the control-side dispatch/reclaim
// driver — the RECLAIM half). Covers every @executable scenario:
//   - a dual-stale assignment converges to reclaimed on the control tick
//   - the control tick leaves a fresh assignment untouched
//   - one control tick both reclaims a dual-stale assignment and dispatches an
//     assigned one (proving the shared driver)
//
// Driven over startLauncher's injected-ticker seam (no wall-clock) + a real v3
// store/run/presence fixture (findWork/startRun/heartbeat/publishPresenceRecord —
// the SAME idiom test/mesh-assignment-reclaim.test.mjs uses for the pure decision) +
// an injected fake stream server (the dispatch half's fixture, reused for scenario 3).
import assert from "node:assert/strict";
import path from "node:path";
import { startLauncher } from "../src/mesh-launcher.mjs";
import { loadWorkspace, findWork } from "../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { assembleAssignmentRecord, insertAssignment, readAssignment } from "../src/assignment-record.mjs";
import { publishPresenceRecord } from "../src/mesh-presence.mjs";
import { startRun, heartbeat, readRuns, isRetryable } from "../src/run-store.mjs";
import { DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS } from "../src/mesh-assignment-reclaim.mjs";
import { withMeshWorkerExecFixture } from "./support/mesh-worker-exec-fixture.mjs";

const NOW = "2026-07-09T12:00:00.000Z";
const TARGET_NODE = "node-b";
const secondsBefore = (iso, seconds) => new Date(Date.parse(iso) - seconds * 1000).toISOString();
const msBefore = (iso, ms) => new Date(Date.parse(iso) - ms).toISOString();

const PRESENCE_STALE = secondsBefore(NOW, 120); // > 90s ⇒ stale
const PRESENCE_FRESH = secondsBefore(NOW, 30); // <= 90s ⇒ fresh
const HEARTBEAT_STALE = msBefore(NOW, DEFAULT_ASSIGNMENT_HEARTBEAT_STALE_MS + 60_000); // > 15m ⇒ stale

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

// The SAME fake control-stream-server shape the dispatch-driver test uses (a real
// directiveTargets.get + dispatchDirective recorder) — reused here so scenario 3
// ("one tick both reclaims and dispatches") can prove the shared driver.
function fakeStreamServer({ connectedNodeIds = [] } = {}) {
  const dispatched = [];
  const connected = new Set(connectedNodeIds);
  return {
    dispatched,
    directiveTargets: { get(nodeId) { return connected.has(nodeId) ? { fake: true } : null; } },
    dispatchDirective(directive) { dispatched.push(directive); return { sent: true }; },
    updatePeers() {},
    stop() {},
  };
}

const STATUS_FIXTURE = (nodeId) => ({
  BackendState: "Running",
  Self: { HostName: nodeId, DNSName: `${nodeId}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
  Peer: {},
});

async function seedRunningAssignment(fx, store, { assignmentId = "asg-1", runHeartbeatAt }) {
  const matches = await findWork(fx.workDir, fx.itemRef);
  const item = matches[0];
  const runRecord = await startRun(item, { now: secondsBefore(NOW, 600), node: TARGET_NODE });
  await heartbeat(item, runRecord.runId, { now: runHeartbeatAt });

  const record = assembleAssignmentRecord({
    assignmentId,
    itemRef: fx.itemRef,
    workspaceId: fx.workspaceId,
    targetNodeId: TARGET_NODE,
    issuer: "control-a",
    state: "running",
    runId: runRecord.runId,
    now: secondsBefore(NOW, 600),
  });
  insertAssignment(store, record);
  return { item, runRecord, record };
}

async function seedPresence(fx, nodeId, heartbeatAt) {
  if (heartbeatAt == null) return;
  await publishPresenceRecord(fx.workspace, nodeId, { nodeId, heartbeatAt, activeRuns: [], aofVersion: "1.0.0" });
}

// Reconfigures the fixture's aof.config.json to name THIS node as the control node
// (the reclaim-scheduler feature needs a control-role launcher; the shared exec
// fixture defaults to a bare mesh.nodeId with no relay.controlNode).
async function markAsControlNode(fx) {
  const { readJson, writeText } = await import("../src/fs.mjs");
  const configPath = path.join(fx.root, ".aof", "aof.config.json");
  const onDisk = await readJson(configPath);
  onDisk.mesh = { ...onDisk.mesh, fabric: "tailscale", relay: { controlNode: onDisk.mesh.nodeId } };
  await writeText(configPath, `${JSON.stringify(onDisk, null, 2)}\n`);
}

export const meshReclaimSchedulerTests = [
  {
    name: "reclaim-scheduler/06 a dual-stale assignment converges to reclaimed on the control tick",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markAsControlNode(fx);
      const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      let seeded;
      try {
        seeded = await seedRunningAssignment(fx, store, { runHeartbeatAt: HEARTBEAT_STALE });
        await seedPresence(fx, TARGET_NODE, PRESENCE_STALE);
      } finally {
        store.close();
      }

      const controlTicker = manualTicker();
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const handle = await startLauncher(ws, {
        exec: async () => ({ stdout: JSON.stringify(STATUS_FIXTURE(ws.config.mesh.nodeId)), status: 0 }),
        platform: "linux",
        peerPollTicker: manualTicker(),
        propagationTicker: manualTicker(),
        globalWorkStoreOptions: fx.env ? { env: fx.env } : {},
        startControlStreamServer: async () => fakeStreamServer({}),
        controlDispatchReclaimTicker: controlTicker,
        now: () => NOW,
      });
      assert.equal(handle.refused, undefined, "the daemon starts");

      controlTicker.fire(controlTicker.handles[0]);
      await new Promise((resolve) => setTimeout(resolve, 25));

      const store2 = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      try {
        const after = readAssignment(store2, seeded.record.assignmentId);
        assert.equal(after.state, "reclaimed", 'the assignment "asg-1" reads state "reclaimed"');
        assert.equal(after.reclaimedAt, NOW, 'it carries a "reclaimedAt" stamp of "now"');
      } finally {
        store2.close();
      }

      const runs = await readRuns(seeded.item);
      const run = runs.find((r) => r.runId === seeded.runRecord.runId);
      assert.equal(run.state, "failed", "the linked run is force-failed");
      assert.equal(run.failureReason, "runtime_offline");
      assert.equal(isRetryable(run.failureReason), true);

      handle.stop();
    }),
  },
  {
    name: "reclaim-scheduler/06 the control tick leaves a fresh assignment untouched",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markAsControlNode(fx);
      const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      let seeded;
      try {
        seeded = await seedRunningAssignment(fx, store, { runHeartbeatAt: HEARTBEAT_STALE });
        await seedPresence(fx, TARGET_NODE, PRESENCE_FRESH);
      } finally {
        store.close();
      }

      const controlTicker = manualTicker();
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const handle = await startLauncher(ws, {
        exec: async () => ({ stdout: JSON.stringify(STATUS_FIXTURE(ws.config.mesh.nodeId)), status: 0 }),
        platform: "linux",
        peerPollTicker: manualTicker(),
        propagationTicker: manualTicker(),
        globalWorkStoreOptions: fx.env ? { env: fx.env } : {},
        startControlStreamServer: async () => fakeStreamServer({}),
        controlDispatchReclaimTicker: controlTicker,
        now: () => NOW,
      });
      assert.equal(handle.refused, undefined);

      controlTicker.fire(controlTicker.handles[0]);
      await new Promise((resolve) => setTimeout(resolve, 25));

      const store2 = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      try {
        const after = readAssignment(store2, seeded.record.assignmentId);
        assert.equal(after.state, "running", 'the assignment "asg-1" still reads state "running"');
        assert.equal(after.reclaimedAt, null, 'no "reclaimedAt" stamp is written');
      } finally {
        store2.close();
      }

      handle.stop();
    }),
  },
  {
    name: "reclaim-scheduler/06 one control tick both reclaims a dual-stale assignment and dispatches an assigned one",
    run: async () => withMeshWorkerExecFixture(async (fx) => {
      await markAsControlNode(fx);
      const store = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      let seeded;
      try {
        seeded = await seedRunningAssignment(fx, store, { runHeartbeatAt: HEARTBEAT_STALE });
        await seedPresence(fx, TARGET_NODE, PRESENCE_STALE);

        // A second "assigned" assignment "asg-2" targeting a connected peer "node-a".
        const record2 = assembleAssignmentRecord({
          assignmentId: "asg-2",
          itemRef: fx.itemRef,
          workspaceId: fx.workspaceId,
          targetNodeId: "node-a",
          issuer: "control-a",
          state: "assigned",
          now: secondsBefore(NOW, 60),
        });
        insertAssignment(store, record2);
      } finally {
        store.close();
      }

      const controlTicker = manualTicker();
      const server = fakeStreamServer({ connectedNodeIds: ["node-a"] });
      const ws = await loadWorkspace(fx.root, undefined, { env: fx.env });
      const handle = await startLauncher(ws, {
        exec: async () => ({ stdout: JSON.stringify(STATUS_FIXTURE(ws.config.mesh.nodeId)), status: 0 }),
        platform: "linux",
        peerPollTicker: manualTicker(),
        propagationTicker: manualTicker(),
        globalWorkStoreOptions: fx.env ? { env: fx.env } : {},
        startControlStreamServer: async () => server,
        controlDispatchReclaimTicker: controlTicker,
        now: () => NOW,
      });
      assert.equal(handle.refused, undefined);

      controlTicker.fire(controlTicker.handles[0]);
      await new Promise((resolve) => setTimeout(resolve, 25));

      const store2 = await openGlobalWorkProjectionStore(fx.env ? { env: fx.env } : {});
      try {
        const asg1 = readAssignment(store2, seeded.record.assignmentId);
        assert.equal(asg1.state, "reclaimed", '"asg-1" reads state "reclaimed"');
      } finally {
        store2.close();
      }

      assert.equal(server.dispatched.length, 1, "a directive is dispatched for asg-2 to node-a");
      assert.equal(server.dispatched[0].assignmentId, "asg-2");
      assert.equal(server.dispatched[0].to, "node-a");

      handle.stop();
    }),
  },
];
