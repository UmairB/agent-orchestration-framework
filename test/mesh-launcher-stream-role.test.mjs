// Traceability wiring for milestone 34 / story 04 — review fix P1.7: the launcher
// integration test the brief calls for ("assemble + unit-test the worker dial").
// Covers, over INJECTED exec + INJECTED transport (no live tailnet, no real ws
// socket):
//   - control role → startLauncher binds a control-stream server (peerNodeIds +
//     peersByAddress resolved via the SAME injected fabric fixture);
//   - worker role with a resolvable control node → startLauncher constructs a
//     worker-stream client with a transport pointed at the RESOLVED dial address
//     and pushes an initial snapshot frame (P1.7b: the dial is assembled +
//     connected, not merely constructed inert);
//   - standalone role → neither a streamServer nor a streamClient is started;
//   - a worker whose control node is ABSENT from the fabric enters stream-degraded
//     — a client is still returned (so streamClient/stop() stay well-defined) but
//     carries NO transport, and NO connection attempt is made (task 00's clean
//     degrade, verbatim — asserted here by the injected transport's connect never
//     being invoked).
//
// VERIFY FOLLOW-UP (34/story 04, built at aof:verify): the worker daemon now keeps
// the stream CURRENT via a periodic re-snapshot ticker (the STREAM-SYNC block in
// startLauncher) — not merely pushed-once-at-connect. The tests below prove that
// production path is WIRED (a tick re-snapshots the CURRENT projection, converging a
// local advance) and that its cadence stays under the server's stale window, so the
// two-machine soak validates a live promise the daemon actually keeps. STILL deferred:
// a per-mutation INSTANT delta (run-start/run-complete → sendDelta) is a later
// optimization over this ~cadence-bounded convergence, not a correctness gap.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { startLauncher } from "../src/mesh-launcher.mjs";
import { workspaceIdFor } from "../src/global-work-store.mjs";
import { DEFAULT_HEARTBEAT_WINDOW_SECONDS } from "../src/control-stream-server.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";

const CONTROL_ID = "control-node";
const WORKER_ID = "worker-node";

function statusFixtureFor(selfHostName, peers = {}) {
  return {
    BackendState: "Running",
    Self: { HostName: selfHostName, DNSName: `${selfHostName}.tail1a2b.ts.net.`, TailscaleIPs: ["100.1.1.1"], Online: true },
    Peer: peers,
  };
}

function fixturedExec(payload) {
  return async () => ({ stdout: JSON.stringify(payload), status: 0 });
}

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

// A scriptable fake worker-stream transport (the worker-stream-client.test.mjs
// fakeTransport idiom) — records connect/send calls so the test can assert the
// dial was genuinely used, not merely constructed.
function fakeWorkerTransport() {
  const frames = [];
  let connectCalls = 0;
  let dropHandler = null;
  return {
    frames,
    get connectCalls() { return connectCalls; },
    async connect() {
      connectCalls += 1;
      return { id: connectCalls };
    },
    async send(handle, frame) {
      frames.push(frame);
    },
    close() {},
    onDrop(handler) { dropHandler = handler; },
    // test-only hook so a scenario COULD simulate a transport drop if needed later
    simulateDrop() { dropHandler?.(); },
  };
}

// `peers` — the OTHER nodeIds this launcher's own node roster should carry (mesh-
// store.mjs published node records) so mesh-fabric's resolvePeers can JOIN the
// fixtured tailscale HostName against a real roster entry (the same join every
// OTHER launcher test seeds via mesh:heartbeat/mesh:invite in production — here
// seeded directly via publishNodeRecord, the story-00 seam).
async function makeRepo({ nodeId, controlNode, relayUrl = "ws://control-node.test:4182/ws/relay", fabric = true, seedItem = true, peers = [] } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-launcher-stream-role-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  if (seedItem) {
    const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
    await mkdir(milestoneDir, { recursive: true });
    await writeFile(
      path.join(milestoneDir, "SPEC.md"),
      "---\ntype: milestone\nnumber: 34\nslug: global-mesh\nstatus: in-progress\ntitle: Global Mesh\n---\n",
      "utf8"
    );
  }
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: {
      nodeId,
      ...(fabric ? { fabric: "tailscale" } : {}),
      ...(controlNode !== undefined ? { relay: { controlNode, ...(relayUrl !== null ? { url: relayUrl } : {}) } } : {}),
    },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const ws = await loadWorkspace(repo);
  for (const id of [nodeId, ...peers]) {
    await publishNodeRecord(ws, id, { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "1.0.0", publishedAt: "2026-07-05T10:00:00.000Z" });
  }
  return repo;
}

const cleanup = (repo) => rm(repo, { recursive: true, force: true });

export const meshLauncherStreamRoleTests = [
  {
    name: "mesh-launcher-stream-role/04 a control-role launcher binds a control-stream server (peerNodeIds + peersByAddress resolved via the injected fabric fixture)",
    async run() {
      const repo = await makeRepo({ nodeId: CONTROL_ID, controlNode: CONTROL_ID, peers: [WORKER_ID] });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(CONTROL_ID, {
          a: { HostName: WORKER_ID, DNSName: `${WORKER_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.2.2.2"], Online: true },
        }));
        let startServerArgs = null;
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          startControlStreamServer: async (args) => {
            startServerArgs = args;
            return { stop() {}, updatePeers() {} };
          },
        });
        assert.equal(handle.refused, undefined, "the daemon starts");
        assert.equal(handle.role, "control", "this node resolves as the control role");
        assert.ok(handle.streamServer != null, "a streamServer was started");
        assert.equal(handle.streamClient, null, "a control node starts NO worker-stream client");
        assert.ok(startServerArgs != null, "startControlStreamServer was invoked");
        assert.equal(startServerArgs.port, 4182, "the control service binds the stable port from config.mesh.relay.url so join/workers have a known endpoint");
        assert.equal(typeof startServerArgs.httpHandler, "function", "the control service hosts the enrollment HTTP route on the same server as worker streams");
        assert.deepEqual(startServerArgs.peerNodeIds, [WORKER_ID], "the admission roster carries the resolved worker peer");
        assert.ok(Array.isArray(startServerArgs.peersByAddress), "an already-resolved peer→dialAddress roster is handed to the server");
        assert.ok(startServerArgs.peersByAddress.some((p) => p.nodeId === WORKER_ID && p.dialAddress === "100.2.2.2"));
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 a control-role launcher without relay.url still binds the default enrollment/stream port",
    async run() {
      const repo = await makeRepo({ nodeId: CONTROL_ID, controlNode: CONTROL_ID, relayUrl: null, peers: [WORKER_ID] });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(CONTROL_ID, {
          a: { HostName: WORKER_ID, DNSName: `${WORKER_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.2.2.2"], Online: true },
        }));
        let startServerArgs = null;
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          startControlStreamServer: async (args) => {
            startServerArgs = args;
            return { stop() {}, updatePeers() {} };
          },
        });
        assert.equal(handle.refused, undefined, "the daemon starts");
        assert.equal(handle.role, "control");
        assert.equal(startServerArgs?.port, 4182, "control-node-only global config must expose the stable join endpoint");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 a worker-role launcher with a resolvable control node constructs a client with a transport pointed at the resolved dial address and pushes a snapshot",
    async run() {
      const repo = await makeRepo({ nodeId: WORKER_ID, controlNode: CONTROL_ID, peers: [CONTROL_ID] });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(WORKER_ID, {
          a: { HostName: CONTROL_ID, DNSName: `${CONTROL_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.90.249.80"], Online: true },
        }));
        let resolvedUrl = null;
        const transport = fakeWorkerTransport();
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          createWorkerWsTransport: (url) => {
            resolvedUrl = url;
            return transport;
          },
        });
        assert.equal(handle.refused, undefined, "the daemon starts");
        assert.equal(handle.role, "worker");
        assert.equal(handle.streamServer, null, "a worker starts NO control-stream server");
        assert.ok(handle.streamClient != null, "a streamClient was constructed");
        assert.equal(resolvedUrl, "ws://100.90.249.80:4182/ws/relay", "the transport is pointed at the fabric-resolved control-node endpoint, using the configured service port/path");
        assert.equal(transport.connectCalls, 1, "the transport was actually connected (not merely constructed inert)");
        assert.equal(transport.frames.length, 2, "an initial snapshot and durable presence frame were pushed so the stream genuinely carries state and liveness");
        assert.equal(transport.frames[0].kind, "snapshot");
        assert.equal(transport.frames[1].kind, "presence");
        assert.equal(transport.frames[1].presence.nodeId, WORKER_ID);
        // The frame's workspaceId matches the SAME id the global projection
        // publishes under (review fix P0.1 — never a phantom "null" workspace).
        assert.equal(handle.streamClient.connected, true, "the client reports itself connected after the initial push");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 a worker-role launcher without relay.url still dials the default control stream URL",
    async run() {
      const repo = await makeRepo({ nodeId: WORKER_ID, controlNode: CONTROL_ID, relayUrl: null, peers: [CONTROL_ID] });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(WORKER_ID, {
          a: { HostName: CONTROL_ID, DNSName: `${CONTROL_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.90.249.80"], Online: true },
        }));
        let resolvedUrl = null;
        const transport = fakeWorkerTransport();
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          createWorkerWsTransport: (url) => {
            resolvedUrl = url;
            return transport;
          },
        });
        assert.equal(handle.refused, undefined, "the daemon starts");
        assert.equal(handle.role, "worker");
        assert.equal(resolvedUrl, "ws://100.90.249.80:4182/ws/relay", "control-node-only global config must still produce the stable worker dial URL");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 the worker's streamed workspaceId matches workspaceIdFor(projectRoot) — never null (review fix P0.1)",
    async run() {
      const repo = await makeRepo({ nodeId: WORKER_ID, controlNode: CONTROL_ID, peers: [CONTROL_ID] });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(WORKER_ID, {
          a: { HostName: CONTROL_ID, DNSName: `${CONTROL_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.90.249.80"], Online: true },
        }));
        const { createWorkerStreamClient: realCreateWorkerStreamClient } = await import("../src/worker-stream-client.mjs");
        let capturedWorkspaceId;
        const transport = fakeWorkerTransport();
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          createWorkerWsTransport: () => transport,
          // Delegate straight to the REAL client factory (synchronous, per its own
          // production signature) so the rest of the flow (connect/snapshot) still
          // exercises production behaviour end to end — this only intercepts the
          // options to read workspaceId, never replaces the session logic itself.
          createWorkerStreamClient: (opts) => {
            capturedWorkspaceId = opts.workspaceId;
            return realCreateWorkerStreamClient(opts);
          },
        });
        assert.equal(capturedWorkspaceId, workspaceIdFor(ws.projectRoot), "the frame workspaceId is the SAME id the projection/backstop publishes under");
        assert.notEqual(capturedWorkspaceId, null, "never a phantom null workspace");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 a standalone-role launcher starts neither a streamServer nor a streamClient",
    async run() {
      const repo = await makeRepo({ nodeId: "solo-node" });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor("solo-node", {}));
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
        });
        assert.equal(handle.refused, undefined);
        assert.equal(handle.role, "standalone");
        assert.equal(handle.streamServer, null);
        assert.equal(handle.streamClient, null);
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 a worker whose control node is absent from the fabric enters stream-degraded mode — a client exists but makes NO connection attempt",
    async run() {
      const repo = await makeRepo({ nodeId: WORKER_ID, controlNode: CONTROL_ID });
      try {
        const ws = await loadWorkspace(repo);
        // The control node is NOT listed as a peer at all.
        const exec = fixturedExec(statusFixtureFor(WORKER_ID, {}));
        let transportConstructed = false;
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          createWorkerWsTransport: () => {
            transportConstructed = true;
            return fakeWorkerTransport();
          },
        });
        assert.equal(handle.refused, undefined, "the daemon still starts (stream-degraded retry state, never a refusal)");
        assert.equal(handle.role, "worker");
        assert.ok(handle.streamClient != null, "streamClient/stop() stay well-defined even in the degrade branch");
        assert.equal(transportConstructed, false, "NO transport is constructed when the control node cannot be resolved on the fabric");
        assert.equal(handle.streamClient.connected, false, "no connection attempt is made");
        assert.ok(
          handle.warnings.some((w) => w.code === "worker-stream-target-unresolved" && /stream sync will retry/.test(w.message)),
          "the clean stream retry degrade message is reported"
        );
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    // THE VERIFY-FOLLOW-UP CORE: proves the worker daemon re-snapshots its CURRENT
    // projection on the stream-sync ticker — so a local work advance converges over the
    // stream WITHOUT a reconnect. This test fails against the pre-fix daemon (which
    // pushed exactly one snapshot at connect and never again).
    name: "mesh-launcher-stream-role/04 the worker daemon re-snapshots its CURRENT projection on the stream-sync ticker — a local advance converges over the stream",
    async run() {
      const repo = await makeRepo({ nodeId: WORKER_ID, controlNode: CONTROL_ID, peers: [CONTROL_ID] });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(WORKER_ID, {
          a: { HostName: CONTROL_ID, DNSName: `${CONTROL_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.90.249.80"], Online: true },
        }));
        const transport = fakeWorkerTransport();
        const streamSyncTicker = manualTicker();
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          streamSyncTicker,
          createWorkerWsTransport: () => transport,
        });
        // At connect the daemon pushed a snapshot of the current projection plus durable presence.
        assert.equal(transport.frames.length, 2, "one initial snapshot plus presence at connect");
        assert.equal(transport.frames[0].kind, "snapshot");
        assert.equal(transport.frames[0].items.length, 1, "the initial snapshot carries the seeded milestone only");
        assert.equal(transport.frames[1].kind, "presence", "the connect path also forwards durable worker presence");

        // A stream-sync ticker WAS registered, and its cadence is under the server's
        // stale window so a running worker stays "live" (never silently stale).
        assert.equal(streamSyncTicker.handles.length, 1, "the worker registered a stream-sync ticker");
        assert.ok(
          streamSyncTicker.handles[0].intervalSeconds < DEFAULT_HEARTBEAT_WINDOW_SECONDS,
          `stream-sync cadence (${streamSyncTicker.handles[0].intervalSeconds}s) must be under the ${DEFAULT_HEARTBEAT_WINDOW_SECONDS}s stale window`
        );

        // A work item advances locally (a new story lands) — the SEPARATE-process
        // reality the daemon can't observe in-memory. The next tick must re-snapshot it.
        const storyDir = path.join(repo, "wiki", "work", "34_milestone_global-mesh", "stories", "00_story_new");
        await mkdir(storyDir, { recursive: true });
        await writeFile(
          path.join(storyDir, "STORY.md"),
          "---\ntype: story\nnumber: 00\nslug: new\nparent: 34\nstatus: in-progress\ntitle: New Story\n---\n",
          "utf8"
        );
        await streamSyncTicker.fire(streamSyncTicker.handles[0]);

        assert.equal(transport.frames.length, 4, "the stream-sync tick pushed another snapshot plus presence frame (the daemon keeps work and liveness current)");
        assert.equal(transport.frames[2].kind, "snapshot", "the re-sync work frame is a snapshot");
        assert.equal(transport.frames[2].items.length, 2, "the re-snapshot reflects the ADVANCE (milestone + the new story) — convergence over the stream");
        assert.equal(transport.frames[3].kind, "presence", "the re-sync path refreshes durable worker presence too");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 a control-role node runs NO stream-sync ticker (only workers push their state)",
    async run() {
      const repo = await makeRepo({ nodeId: CONTROL_ID, controlNode: CONTROL_ID, peers: [WORKER_ID] });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(CONTROL_ID, {
          a: { HostName: WORKER_ID, DNSName: `${WORKER_ID}.tail1a2b.ts.net.`, TailscaleIPs: ["100.2.2.2"], Online: true },
        }));
        const streamSyncTicker = manualTicker();
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          streamSyncTicker,
          startControlStreamServer: async () => ({ stop() {}, updatePeers() {} }),
        });
        assert.equal(handle.role, "control");
        assert.equal(streamSyncTicker.handles.length, 0, "a control node pushes nothing — no stream-sync ticker");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
  {
    name: "mesh-launcher-stream-role/04 a stream-degraded worker (control unresolvable) runs NO stream-sync ticker — nothing to push into",
    async run() {
      const repo = await makeRepo({ nodeId: WORKER_ID, controlNode: CONTROL_ID });
      try {
        const ws = await loadWorkspace(repo);
        const exec = fixturedExec(statusFixtureFor(WORKER_ID, {})); // control absent from the fabric
        const streamSyncTicker = manualTicker();
        const handle = await startLauncher(ws, {
          exec,
          platform: "linux",
          ticker: manualTicker(),
          peerPollTicker: manualTicker(),
          streamSyncTicker,
          createWorkerWsTransport: () => fakeWorkerTransport(),
        });
        assert.equal(handle.role, "worker");
        assert.equal(streamSyncTicker.handles.length, 0, "no live transport → no stream-sync ticker (no warning spam into a null transport)");
        handle.stop();
      } finally {
        await cleanup(repo);
      }
    },
  },
];
