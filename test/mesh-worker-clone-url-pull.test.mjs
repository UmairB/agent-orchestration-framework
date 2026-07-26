// test/mesh-worker-clone-url-pull.test.mjs — traceability for the ADR-010 Gap A
// EXTENDED fix (review fix, live soak 2026-07-18): a worker assigned to a
// workspace it has never checked out has no local knowledge of that workspace's
// cloneUrl, and — CONFIRMED LIVE against the real two-machine soak — the
// SYNCED-registry fallback (mesh-worker-clone-location-config.test.mjs's "Gap A
// extended" tests) cannot close this gap on its own: each node's
// global_workspace_descriptors table is independently, only LOCALLY populated,
// so a fresh worker's own copy has no row for a workspace it has never itself
// published. This module covers the PULL that actually closes it — the worker
// asks the control node directly, over the SAME live stream ADR-009's
// clone-credential PULL already uses, mirroring that mechanism exactly:
//   - worker side: requestCloneUrl (src/worker-stream-client.mjs), wired into
//     createMeshWorkerExecutionHandler's clone-on-miss fallback chain
//     (src/mesh-worker-execution.mjs).
//   - control side: applyStreamFrame / applyCloneUrlRequestFrame
//     (src/control-stream-server.mjs) — the REAL authorization + registry-read +
//     reply path, never hand-authored by this test.
//   - production wiring: startLauncher (src/mesh-launcher.mjs) — constructed the
//     way `aof mesh serve --serve` does, with NO cloneUrl-shaped test injection
//     (the SAME F12 discipline ADR-009's own guard already enforces for the
//     credential — a resolver reachable only through the test-injection spread
//     is production-dead).
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  createMeshWorkerExecutionHandler,
  resolveCloneUrl,
  meshCheckoutPath,
} from "../src/mesh-worker-execution.mjs";
import { createWorkerStreamClient } from "../src/worker-stream-client.mjs";
import {
  applyCloneUrlRequestFrame,
  buildDirectiveFrame,
  CLONE_URL_NOT_HOLDER,
  CLONE_URL_WORKSPACE_MISMATCH,
} from "../src/control-stream-server.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../src/global-work-store.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import {
  withMeshCloneFixture,
  createStatusRecorder,
  createRecordingCloneExec,
  scriptedSpawnRuntime,
  scriptedPushExec,
} from "./support/mesh-worker-clone-fixture.mjs";
import { createFakeWorkerTransport, createDirectiveChannelFixture } from "./support/mesh-directive-channel-fixture.mjs";
import { seedAssignment } from "./support/mesh-assign-fixture.mjs";

const NOW = "2026-07-18T09:00:00.000Z";
const SYNCED_CLONE_URL = "https://git.example.com/acme/synced-repo.git";

async function waitForFrame(transport, predicate, { timeoutMs = 5000, pollMs = 5 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const latest = transport.frames.at(-1);
    if (latest != null && predicate(latest)) return latest;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

async function pathExists(candidate) {
  try {
    await stat(candidate);
    return true;
  } catch {
    return false;
  }
}

async function withStore({ env }, fn) {
  const store = await openGlobalWorkProjectionStore({ env });
  try {
    return await fn(store);
  } finally {
    store.close();
  }
}

// seedWorkspaceCloneUrl — models what a REAL control node's `aof mesh repo
// publish` writes into global_workspace_descriptors.clone_url
// (global-node-registry.mjs's upsertGlobalRegistryRows) — the row the CONTROL
// SIDE of applyCloneUrlRequestFrame actually reads.
async function seedWorkspaceCloneUrl({ env }, { workspaceId, cloneUrl }) {
  await withStore({ env }, async (store) => {
    store.db.prepare(`
      INSERT INTO global_workspace_descriptors (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path, clone_url)
      VALUES (?, '/synced/root', '/synced/root/wiki/work', 'synced', 1, 'control-a', '[]', ?, '/synced/descriptor.json', ?)
      ON CONFLICT(workspace_id) DO UPDATE SET clone_url = excluded.clone_url
    `).run(workspaceId, NOW, cloneUrl);
  });
}

async function driveCloneUrlReply({ transport, targets, store, requesterNodeId, now = NOW }) {
  const upFrame = await waitForFrame(transport, (f) => f.kind === "clone-url-request");
  assert.ok(upFrame != null, "a clone-url-request frame was sent within the wait bound");
  const applied = await applyCloneUrlRequestFrame(store, upFrame, {
    nodeId: requesterNodeId,
    directiveTargets: targets,
    now,
  });
  const socket = targets.get(requesterNodeId);
  const downFrame = socket?.frames?.at(-1) ?? null;
  if (downFrame != null) transport.deliver(downFrame);
  return { upFrame, downFrame, applied };
}

const PROD_WORKER_ID = "worker-node";
const PROD_CONTROL_ID = "control-node";

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
  };
}

function productionLikeWorkerTransport() {
  const frames = [];
  let connectCalls = 0;
  let messageHandler = null;
  return {
    frames,
    get connectCalls() { return connectCalls; },
    async connect() { connectCalls += 1; return { id: connectCalls }; },
    async send(_handle, frame) { frames.push(frame); },
    close() {},
    onDrop() {},
    onMessage(handler) { messageHandler = typeof handler === "function" ? handler : null; },
    deliver(frame) { messageHandler?.(typeof frame === "string" ? frame : JSON.stringify(frame)); },
  };
}

async function withProductionWiringFixture(fn) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-cloneurl-prodwiring-"));
  try {
    const root = path.join(tmp, "repo");
    const workDir = path.join(root, "wiki", "work");
    const milestoneDir = path.join(workDir, "38_milestone_clonedemo");
    const storyDir = path.join(milestoneDir, "stories", "00_story_clonedemo-00");
    await mkdir(storyDir, { recursive: true });
    await writeFile(path.join(milestoneDir, "SPEC.md"), "---\ntype: milestone\nnumber: 38\nslug: clonedemo\nstatus: in-progress\ntitle: Demo\n---\n", "utf8");
    await writeFile(path.join(storyDir, "STORY.md"), "---\ntype: story\nnumber: 00\nslug: clonedemo-00\nparent: 38\nstatus: not-started\ntitle: Demo story\n---\n", "utf8");
    const itemRef = "38/00";
    await mkdir(path.join(root, ".aof"), { recursive: true });
    const config = {
      name: "demo",
      work: { dir: "./wiki/work" },
      // Deliberately NO mesh.repo.cloneUrl here — this workspace is a DIFFERENT
      // one from what the worker is being assigned to below (a totally separate
      // workspaceId is used for the directive), so the worker's own launch-
      // workspace resolveCloneUrl(ws) is null by construction, exactly like the
      // real clone-on-miss case.
      mesh: {
        nodeId: PROD_WORKER_ID,
        fabric: "tailscale",
        relay: { controlNode: PROD_CONTROL_ID, url: "ws://control-node.test:4182/ws/relay" },
      },
    };
    await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    // review fix (live soak, 2026-07-18) — an ISOLATED AOF_GLOBAL_HOME is not
    // optional here: loadWorkspace/publishNodeRecord/startLauncher all touch
    // real global state without one, and this fixture's OWN node id
    // ("umairs-msi" is NOT used here, but a same-machine dev running this suite
    // against a REAL live control daemon must never have this fixture's fake
    // worker/control node records land in the REAL ~/.aof registry). Copied from
    // (and this same fix is owed back to) mesh-worker-clone-credential-pull.test.mjs's
    // sibling withProductionWiringFixture, which has the SAME gap.
    const env = { ...process.env, AOF_GLOBAL_HOME: path.join(tmp, ".global-aof") };
    const ws = await loadWorkspace(root, undefined, { env });
    await publishNodeRecord(ws, PROD_WORKER_ID, { nodeId: PROD_WORKER_ID, host: PROD_WORKER_ID, os: "linux", runtimes: [], skills: [], aofVersion: "1.0.0", publishedAt: NOW });
    await publishNodeRecord(ws, PROD_CONTROL_ID, { nodeId: PROD_CONTROL_ID, host: PROD_CONTROL_ID, os: "linux", runtimes: [], skills: [], aofVersion: "1.0.0", publishedAt: NOW });
    return await fn({ tmp, root, ws, itemRef, env });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

export const meshWorkerCloneUrlPullTests = [
  {
    name: "clone-url-pull: on a clone miss with NO local cloneUrl, the worker sends ONE clone-url-request naming assignmentId+workspaceId, control replies with the registry's clone_url, and the worker clones with it",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      assert.equal(resolveCloneUrl(workspace), null, "no local cloneUrl is configured for this workspace");
      const assignmentId = "asg-cu-pull";
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId, itemRef, workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      await seedWorkspaceCloneUrl({ env }, { workspaceId, cloneUrl: SYNCED_CLONE_URL });

      const transport = createFakeWorkerTransport();
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneUrl: (request) => client.requestCloneUrl(request),
        cloneExec: cloneExec.exec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });

      const handlerPromise = handler({ assignmentId, itemRef, workspaceId });
      const { upFrame, downFrame } = await withStore({ env }, (store) => driveCloneUrlReply({
        transport, targets: channel.targets, store, requesterNodeId: "worker-a",
      }));

      assert.equal(upFrame.kind, "clone-url-request");
      assert.equal(upFrame.assignmentId, assignmentId);
      assert.equal(upFrame.workspaceId, workspaceId);
      assert.equal(downFrame.kind, "clone-url");
      assert.equal(downFrame.cloneUrl, SYNCED_CLONE_URL);

      await handlerPromise;

      assert.equal(transport.frames.filter((f) => f.kind === "clone-url-request").length, 1, "exactly one clone-url-request is ever sent");
      assert.equal(cloneExec.calls.length, 1, "the clone is attempted");
      assert.equal(cloneExec.calls[0].args[3], SYNCED_CLONE_URL, "the clone spawn's argv carries the PULLED cloneUrl");
      assert.ok(status.frames.some((f) => f.state === "accepted"), "the directive proceeds past the repo guard");
    }, { cloneUrl: undefined }),
  },
  {
    name: "clone-url-pull: the worker's OWN local cloneUrl wins — no clone-url-request is ever sent when a local value already resolves",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      assert.equal(resolveCloneUrl(workspace), "https://git.example.com/acme/local.git");
      const assignmentId = "asg-cu-localwins";
      const transport = createFakeWorkerTransport();
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneUrl: (request) => client.requestCloneUrl(request),
        cloneExec: cloneExec.exec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });

      await handler({ assignmentId, itemRef, workspaceId });

      assert.equal(transport.frames.filter((f) => f.kind === "clone-url-request").length, 0, "no PULL is ever attempted when the local config already resolves");
      assert.equal(cloneExec.calls[0].args[3], "https://git.example.com/acme/local.git");
    }, { cloneUrl: "https://git.example.com/acme/local.git" }),
  },
  {
    name: "clone-url-pull: the PRODUCTION wiring supplies the resolver — startLauncher, constructed exactly as `aof mesh serve --serve` does with NO cloneUrl-shaped test injection, genuinely attempts a clone-url pull on a clone miss (the F12-equivalent guard)",
    run: async () => withProductionWiringFixture(async ({ ws, itemRef, env }) => {
      const exec = async () => ({
        stdout: JSON.stringify({
          BackendState: "Running",
          Self: { HostName: PROD_WORKER_ID, DNSName: `${PROD_WORKER_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
          Peer: { a: { HostName: PROD_CONTROL_ID, DNSName: `${PROD_CONTROL_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.90.249.80"], Online: true } },
        }),
        status: 0,
      });
      const transport = productionLikeWorkerTransport();
      const handle = await startLauncher(ws, {
        exec,
        platform: "linux",
        ticker: manualTicker(),
        peerPollTicker: manualTicker(),
        createWorkerWsTransport: () => transport,
        // review fix (live soak, 2026-07-18) — the SAME isolated env every internal
        // store-open this launcher makes must use, never the real machine's.
        globalWorkStoreOptions: { env },
        // DELIBERATELY NO workerExecutionOptions / createMeshWorkerExecutionHandler
        // override — production's OWN wiring, exactly as `aof mesh serve --serve`
        // builds it.
        workerStreamClientOptions: { cloneUrlTimeoutMs: 40 },
      });
      try {
        assert.equal(handle.role, "worker");
        const otherWorkspaceId = workspaceIdFor(path.join(ws.projectRoot, "..", "some-other-workspace"));
        transport.deliver({ kind: "directive", to: PROD_WORKER_ID, assignmentId: "asg-cu-prodwire", itemRef, workspaceId: otherWorkspaceId, at: NOW });
        const request = await waitForFrame(transport, (f) => f.kind === "clone-url-request");
        assert.ok(request != null, "the production-wired handler genuinely attempted to pull a cloneUrl on the miss — the resolver reaches a real, working transport, not merely a present-but-inert value");
        assert.equal(request.assignmentId, "asg-cu-prodwire");
        await new Promise((resolve) => setTimeout(resolve, 80));
      } finally {
        handle.stop();
      }
    }),
  },
  {
    name: "clone-url-pull: control authorizes the request before answering — a non-holder's request is refused, and the refusal is loud and coded, never a silent empty reply",
    run: async () => withMeshCloneFixture(async ({ env, workspaceId }) => {
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId: "asg-cu-notholder", itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      await seedWorkspaceCloneUrl({ env }, { workspaceId, cloneUrl: SYNCED_CLONE_URL });
      const channel = createDirectiveChannelFixture();
      const socket = channel.connectWorker("worker-b");
      await withStore({ env }, async (store) => {
        const frame = { kind: "clone-url-request", nodeId: "worker-b", assignmentId: "asg-cu-notholder", workspaceId, at: NOW };
        const result = await applyCloneUrlRequestFrame(store, frame, {
          nodeId: "worker-b", // genuinely NOT the holder
          directiveTargets: channel.targets,
          now: NOW,
        });
        assert.equal(result.applied, false);
        assert.equal(result.code, CLONE_URL_NOT_HOLDER);
      });
      assert.equal(socket.frames.length, 1, "a coded reply IS sent — never a silent drop");
      const reply = socket.frames[0];
      assert.equal(reply.kind, "clone-url");
      assert.equal(reply.cloneUrl, null, "no cloneUrl is handed back");
      assert.equal(reply.code, CLONE_URL_NOT_HOLDER);
    }),
  },
  {
    name: "clone-url-pull (SECURITY, F15-equivalent): a holder naming a DIFFERENT workspaceId than its assignment's own row is refused clone-url-workspace-mismatch — control never substitutes the row's real workspaceId silently",
    run: async () => withMeshCloneFixture(async ({ env, workspaceId }) => {
      const attackerChosenWorkspaceId = "ws-SOMEONE-ELSES-REPO";
      await seedAssignment({ home: env.AOF_GLOBAL_HOME }, {
        assignmentId: "asg-cu-f15", itemRef: "38/00", workspaceId, targetNodeId: "worker-a", issuer: "control-a", state: "accepted", assignedAt: NOW,
      });
      await seedWorkspaceCloneUrl({ env }, { workspaceId: attackerChosenWorkspaceId, cloneUrl: "https://git.example.com/attacker/decoy.git" });
      await seedWorkspaceCloneUrl({ env }, { workspaceId, cloneUrl: SYNCED_CLONE_URL });
      const channel = createDirectiveChannelFixture();
      const socket = channel.connectWorker("worker-a");
      await withStore({ env }, async (store) => {
        const frame = { kind: "clone-url-request", nodeId: "worker-a", assignmentId: "asg-cu-f15", workspaceId: attackerChosenWorkspaceId, at: NOW };
        const result = await applyCloneUrlRequestFrame(store, frame, {
          nodeId: "worker-a", // the genuine holder — the holder check alone would PASS
          directiveTargets: channel.targets,
          now: NOW,
        });
        assert.equal(result.applied, false, "refused despite holding the assignment");
        assert.equal(result.code, CLONE_URL_WORKSPACE_MISMATCH);
      });
      const reply = socket.frames[0];
      assert.equal(reply.cloneUrl, null, "no cloneUrl is handed back — never the attacker's decoy, never the row's real value either");
      assert.equal(reply.code, CLONE_URL_WORKSPACE_MISMATCH);
    }),
  },
  {
    name: "clone-url-pull: Examples — the request is refused by control (unknown assignment) -> falls through to the local registry tier, and finally the loud coded assignment-repo-unavailable when that is empty too",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-cu-refused";
      // Deliberately NO seeded assignment row -> applyCloneUrlRequestFrame refuses
      // (unknown assignment); NO registry row seeded either -> tier 3 is also empty.
      const transport = createFakeWorkerTransport();
      const channel = createDirectiveChannelFixture();
      channel.connectWorker("worker-a");
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, cloneUrlTimeoutMs: 2000 });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneUrl: (request) => client.requestCloneUrl(request),
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
      });

      const handlerPromise = handler({ assignmentId, itemRef, workspaceId });
      await withStore({ env }, (store) => driveCloneUrlReply({
        transport, targets: channel.targets, store, requesterNodeId: "worker-a",
      }));
      await handlerPromise;

      assert.equal(cloneExec.calls.length, 0, "no clone exec call was ever attempted");
      const finalFrame = status.frames.at(-1);
      assert.equal(finalFrame.state, "failed");
      assert.equal(finalFrame.code, "assignment-repo-unavailable");
      assert.equal(await pathExists(meshCheckoutPath(workspaceId, { env })), false, "no partial checkout is left behind");
    }, { cloneUrl: undefined }),
  },
  {
    name: "clone-url-pull: Examples — the request times out with no reply -> falls through to the local registry tier (never a hang), and the loud coded assignment-repo-unavailable when that is empty too",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-cu-timeout";
      const transport = createFakeWorkerTransport(); // nothing ever delivers a reply
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, cloneUrlTimeoutMs: 30 });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneUrl: (request) => client.requestCloneUrl(request),
        cloneExec: cloneExec.exec,
        globalWorkStoreOptions: { env },
      });

      await handler({ assignmentId, itemRef, workspaceId });

      assert.equal(cloneExec.calls.length, 0, "no clone exec call was ever attempted");
      const finalFrame = status.frames.at(-1);
      assert.equal(finalFrame.state, "failed");
      assert.equal(finalFrame.code, "assignment-repo-unavailable");
      assert.equal(await pathExists(meshCheckoutPath(workspaceId, { env })), false, "no partial checkout is left behind, never a hang");
    }, { cloneUrl: undefined }),
  },
  {
    name: "clone-url-pull: a timed-out PULL still falls through to a resolvable local-registry tier — the PULL's failure is not the LAST word",
    run: async () => withMeshCloneFixture(async ({ workspace, workspaceId, itemRef, env }) => {
      const assignmentId = "asg-cu-timeout-fallthrough";
      await seedWorkspaceCloneUrl({ env }, { workspaceId, cloneUrl: SYNCED_CLONE_URL });
      const transport = createFakeWorkerTransport(); // nothing ever delivers a reply -> PULL times out
      const client = createWorkerStreamClient({ transport, nodeId: "worker-a", workspaceId, now: () => NOW, cloneUrlTimeoutMs: 30 });

      const status = createStatusRecorder();
      const cloneExec = createRecordingCloneExec();
      const handler = createMeshWorkerExecutionHandler({
        pushExec: scriptedPushExec(),
        loadWs: () => Promise.resolve(workspace),
        nodeId: "worker-a",
        sendAssignmentStatus: status.sendAssignmentStatus,
        requestCloneUrl: (request) => client.requestCloneUrl(request),
        cloneExec: cloneExec.exec,
        spawnRuntime: scriptedSpawnRuntime("done"),
        globalWorkStoreOptions: { env },
      });

      await handler({ assignmentId, itemRef, workspaceId });

      assert.equal(cloneExec.calls.length, 1, "the clone still proceeds — tier 3 (the local registry) resolved it after the PULL timed out");
      assert.equal(cloneExec.calls[0].args[3], SYNCED_CLONE_URL);
    }, { cloneUrl: undefined }),
  },
  {
    name: "clone-url-pull: buildDirectiveFrame still returns EXACTLY its frozen five keys — a cloneUrl handed to the directive builder reaches no frame, ever (the SAME ADR-002/ADR-009 invariant applies to this new PULL too)",
    run: async () => {
      const frame = buildDirectiveFrame("worker-a", {
        assignmentId: "asg-cu-frame",
        itemRef: "38/00",
        workspaceId: "ws-cu",
        at: NOW,
        cloneUrl: "https://git.example.com/should/never-land.git",
      });
      assert.deepEqual(Object.keys(frame), ["kind", "to", "assignmentId", "itemRef", "workspaceId", "at"]);
      assert.ok(!JSON.stringify(frame).includes("should/never-land"), "no cloneUrl value reaches the directive frame — it is PULLED, never pushed");
    },
  },
];
