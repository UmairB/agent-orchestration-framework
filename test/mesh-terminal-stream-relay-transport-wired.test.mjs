// test/mesh-terminal-stream-relay-transport-wired.test.mjs — producer-fed behavioural
// coverage for the milestone 38 / story 06 ADR-014 AMENDMENT (2026-07-19, closing
// BLOCKER F-38.06 — the HYBRID transport). The fitness
// `acd-terminal-stream-transport-wired` pins the SOURCE SHAPE (the worker's
// onOutputChunk wired to client.sendTerminalFrame, control's onTerminalFrame branch +
// known-port loopback broker, the fleet's loopback subscriber). It cannot itself prove
// a frame actually TRAVERSES the two legs — that is what this module closes, entirely
// in-process, entirely against the REAL production modules (the milestone's defining
// producer-fed rule, F1/F4/F12/F-38.05: a consumer proven only against a convenient
// fixture ships green-but-inert).
//
// THE HYBRID, each leg on the transport its bind fits:
//   - CROSS-MACHINE (worker -> control): the FABRIC. A REAL createWorkerStreamClient
//     over a REAL createWorkerWsTransport -> a REAL startControlStreamServer; the
//     worker's terminal-frame reaches control's onTerminalFrame sink with the
//     CONNECTION-bound nodeId (T6), and is NEVER store-applied (ADR-014 inv.3 — the
//     REAL global store is queried and stays empty).
//   - SAME-MACHINE (control -> the fleet-UI process): a LOOPBACK relay. control's
//     onTerminalFrame pushes each fabric-received frame into a REAL serveRelay() broker
//     (EXACTLY the launcher wiring: onTerminalFrame: (frame) => controlTerminalPush?.push(frame)),
//     a REAL createTerminalMirrorSubscriberTransport feeds a REAL createTerminalMirror,
//     and a REAL serveMeshUi `/ws/terminal-view` client observes the exact bytes.
// The full chain is driven end-to-end so the transport genuinely carries a frame; an
// unroutable frame is proven dropped over that same real chain.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveRelay } from "../src/mesh-relay.mjs";
import { startControlStreamServer } from "../src/control-stream-server.mjs";
import { createWorkerStreamClient, createWorkerWsTransport } from "../src/worker-stream-client.mjs";
import {
  createTerminalMirror,
  createTerminalMirrorSubscriberTransport,
  startTerminalMirrorSubscriber,
} from "../src/mesh-terminal-mirror.mjs";
import { createTerminalRelayPushTransport } from "../src/mesh-terminal-relay-bridge.mjs";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { openGlobalWorkProjectionStore, queryGlobalWorkProjection } from "../src/global-work-store.mjs";

const NOW = "2026-07-19T10:00:00.000Z";

function waitFor(predicate, { timeoutMs = 2500, label = "condition" } = {}) {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const tick = () => {
      let ok = false;
      try { ok = predicate(); } catch { ok = false; }
      if (ok) return resolve();
      if (Date.now() - start > timeoutMs) return reject(new Error(`waitFor(${label}) timeout`));
      setTimeout(tick, 5);
    };
    tick();
  });
}

const settle = (ms = 200) => new Promise((resolve) => setTimeout(resolve, ms));

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=\"root\"></div></body></html>\n",
    "utf8",
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
}

// openTerminalView(baseUrl, { nodeId, sessionId }) — a REAL ws client opening the REAL
// `/ws/terminal-view` route (mirrors test/mesh-fleet-terminal-view-mirror.test.mjs).
function openTerminalView(baseUrl, { nodeId, sessionId, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const wsUrl = new URL("/ws/terminal-view", baseUrl.replace(/^http/, "ws"));
    if (nodeId != null) wsUrl.searchParams.set("nodeId", nodeId);
    if (sessionId != null) wsUrl.searchParams.set("sessionId", sessionId);
    const ws = new WebSocket(wsUrl);
    const frames = [];
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; resolve({ opened: false, ws: null, frames }); } }, timeoutMs);
    ws.on("open", () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ opened: true, ws, frames }); } });
    ws.on("message", (data) => frames.push(data.toString()));
    ws.on("error", () => { if (!settled) { settled = true; clearTimeout(timer); resolve({ opened: false, ws: null, frames }); } });
  });
}

export const meshTerminalStreamRelayTransportWiredTests = [
  // --- CROSS-MACHINE leg: worker -> control over the REAL fabric; reaches
  //     onTerminalFrame with the connection-bound nodeId, never store-applied ---
  {
    name: "38-06/ADR-014-AMENDMENT fabric leg: a worker's terminal-frame rides UP the REAL stream client to the REAL control-stream-server, reaches onTerminalFrame with the CONNECTION-bound nodeId (T6), and is NEVER store-applied (ADR-014 inv.3)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-terminal-fabric-"));
      const received = [];
      const server = await startControlStreamServer({
        peerNodeIds: ["worker-conn"],
        // The connection resolves to "worker-conn" regardless of what the worker
        // self-declares — the admission/attribution identity (T6).
        resolveOrigin: () => ({ nodeId: "worker-conn" }),
        storeOptions: { env: { AOF_GLOBAL_HOME: home } },
        onTerminalFrame: (frame, meta) => received.push({ frame, meta }),
      });
      let client;
      try {
        const port = server.server.address().port;
        const transport = createWorkerWsTransport(`ws://127.0.0.1:${port}/`);
        // The worker self-declares a DIFFERENT nodeId than its connection resolves to —
        // so the T6 assertion below (onTerminalFrame is handed the connection-bound id)
        // is non-vacuous.
        client = createWorkerStreamClient({ transport, nodeId: "worker-self-declared", workspaceId: "ws-1", now: () => NOW });
        assert.equal(await client.ensureConnected(), true, "the worker connects to the REAL control-stream server");

        const sent = await client.sendTerminalFrame("sess-1", "live pty bytes over the fabric\n");
        assert.equal(sent.sent, true, "the terminal-frame was sent up the fabric connection");
        await waitFor(() => received.length >= 1, { label: "control receives the terminal-frame on its onTerminalFrame sink" });

        const { frame, meta } = received[0];
        assert.equal(frame.kind, "terminal-frame", "the branched frame is the terminal-frame kind");
        assert.equal(frame.signal.sessionId, "sess-1", "the sessionId rides inside the opaque signal");
        assert.equal(frame.signal.bytes, "live pty bytes over the fabric\n", "the exact PTY bytes crossed the fabric byte-for-byte");
        // T6: the sink is handed the CONNECTION-bound nodeId, never the self-declared one.
        assert.equal(meta.nodeId, "worker-conn", "onTerminalFrame is handed the CONNECTION-bound nodeId (T6), never the worker's self-declared frame.nodeId");
        assert.equal(frame.nodeId, "worker-self-declared", "the frame still self-declares the worker's own nodeId — which the sink deliberately ignores");

        // (b) NEVER persisted — the terminal-frame branched BEFORE applyStreamFrame, so
        // the REAL global store was never touched.
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          assert.equal(queryGlobalWorkProjection(store).items.length, 0, "the terminal-frame wrote NOTHING to the global store (never store-applied — ADR-014 inv.3)");
        } finally {
          store.close();
        }
      } finally {
        client?.stop?.();
        server.stop();
        await rm(home, { recursive: true, force: true });
      }
    },
  },

  // --- FULL HYBRID end-to-end: worker -> fabric -> control -> loopback relay ->
  //     mirror -> /ws/terminal-view client; plus the unroutable-drop over that chain ---
  {
    name: "38-06/ADR-014-AMENDMENT full hybrid end-to-end: worker sendTerminalFrame -> REAL control onTerminalFrame -> REAL serveRelay loopback broker -> REAL mirror subscriber -> a /ws/terminal-view client observes the exact bytes; an unroutable frame is DROPPED and the live stream keeps working",
    async run() {
      const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-terminal-hybrid-"));
      const distRoot = path.join(tmp, "dist");
      const home = path.join(tmp, "home");
      const root = path.join(tmp, "repo");
      await mkdir(path.join(root, ".aof"), { recursive: true });
      await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" } }, null, 2)}\n`, "utf8");
      await writeDist(meshUiDist(distRoot));

      // The SAME-MACHINE loopback relay leg, keyed by config.mesh.relay.url (exactly the
      // production seam createTerminalRelayPushTransport / createTerminalMirrorSubscriberTransport
      // both read).
      const relay = await serveRelay({ port: 0 });
      const config = { mesh: { relay: { url: relay.url } } };
      // control's loopback push into the broker — the SAME transport the launcher's
      // onTerminalFrame closes over.
      const controlPush = createTerminalRelayPushTransport(config);

      // The REAL fabric control server: its onTerminalFrame bridges fabric->loopback,
      // byte-for-byte the launcher's `onTerminalFrame: (frame) => controlTerminalPush?.push(frame)`.
      const controlServer = await startControlStreamServer({
        peerNodeIds: ["worker-a"],
        resolveOrigin: () => ({ nodeId: "worker-a" }),
        storeOptions: { env: { AOF_GLOBAL_HOME: home } },
        onTerminalFrame: (frame) => controlPush.push(frame),
      });

      // The REAL fleet mirror, fed by the REAL loopback subscriber transport.
      const mirror = createTerminalMirror();
      const subscriber = await startTerminalMirrorSubscriber({ transport: createTerminalMirrorSubscriberTransport(config), mirror });
      assert.ok(subscriber.connected, "the fleet subscriber connects to the REAL loopback relay broker");

      const session = await serveMeshUi({ projectDir: root, port: 0, repoRoot: distRoot, globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } }, terminalMirror: mirror });

      let client;
      let viewer;
      try {
        viewer = await openTerminalView(session.url, { nodeId: "worker-a", sessionId: "sess-1" });
        assert.ok(viewer.opened, "the /ws/terminal-view card for (worker-a, sess-1) opens");

        const port = controlServer.server.address().port;
        client = createWorkerStreamClient({ transport: createWorkerWsTransport(`ws://127.0.0.1:${port}/`), nodeId: "worker-a", workspaceId: "ws-1", now: () => NOW });
        assert.equal(await client.ensureConnected(), true, "the worker connects to the REAL control-stream server");

        // The whole chain, end-to-end.
        await client.sendTerminalFrame("sess-1", "hello across the hybrid\n");
        await waitFor(() => viewer.frames.length >= 1, { label: "the /ws/terminal-view client observes the streamed bytes end-to-end" });
        assert.equal(viewer.frames[0], "hello across the hybrid\n", "the exact PTY bytes traversed worker -> fabric -> control -> loopback relay -> mirror -> browser");

        // An UNROUTABLE frame (a session no card is open for) is dropped over the SAME
        // real chain — never delivered to the (worker-a, sess-1) card.
        await client.sendTerminalFrame("sess-UNKNOWN", "should never reach the sess-1 card\n");
        await settle();
        assert.equal(viewer.frames.length, 1, "an unroutable terminal-frame is DROPPED — never delivered to the (worker-a, sess-1) card");

        // …and the live stream keeps working after the unroutable frame.
        await client.sendTerminalFrame("sess-1", "still streaming\n");
        await waitFor(() => viewer.frames.length >= 2, { label: "the open card still receives its own frames after the unroutable one" });
        assert.equal(viewer.frames[1], "still streaming\n");
      } finally {
        client?.stop?.();
        try { viewer?.ws?.close?.(); } catch { /* noop */ }
        await new Promise((resolve) => session.server.close(resolve));
        subscriber.stop();
        controlPush.close();
        controlServer.stop();
        await relay.stop();
        await rm(tmp, { recursive: true, force: true });
      }
    },
  },
];
