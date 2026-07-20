// test/mesh-fleet-terminal-view-mirror.test.mjs — traceability for milestone 38 /
// story 06, task 01 (tasks/01_fleet-terminal-view-mirror.feature, ADR-014). The
// fleet face gains a READ-ONLY terminal-VIEW route serving an IN-MEMORY EPHEMERAL
// mirror of the relayed bytes — never a system of record; rebuild starts empty —
// multiplexing multiple (nodeId, sessionId) streams; an unresolvable frame is
// DROPPED, never broadcast to an unrelated card.
//
// PRODUCER-FED (ADR-008): every scenario drives the REAL src/mesh-ui-serve.mjs
// `serveMeshUi()` server (a REAL loopback http server, a REAL `GET
// /ws/terminal-view?nodeId=&sessionId=` upgrade, a REAL `ws` client) — never a
// stub of the fleet route. Every applied frame is built through the REAL
// buildTerminalFrameEnvelope (task 00's module) — never a hand-authored
// convenient record shape.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { createTerminalMirror } from "../src/mesh-terminal-mirror.mjs";
import { buildTerminalFrameEnvelope } from "../src/mesh-terminal-relay-bridge.mjs";

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=\"root\"></div></body></html>\n",
    "utf8",
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
}

// withFleetServer(fn, { terminalMirror }) — the REAL serveMeshUi server, no
// mesh-enabled workspace needed (global scope's default — story 06 touches only
// the terminal-VIEW upgrade, which needs no store/assignment machinery at all).
async function withFleetServer(fn, { terminalMirror } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-terminal-view-"));
  const root = path.join(tmp, "repo");
  const distRoot = path.join(tmp, "dist");
  const home = path.join(tmp, "home");
  try {
    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeFile(
      path.join(root, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" } }, null, 2)}\n`,
      "utf8",
    );
    await writeDist(meshUiDist(distRoot));
    const globalStoreOptions = { env: { AOF_GLOBAL_HOME: home } };
    const session = await serveMeshUi({ projectDir: root, port: 0, repoRoot: distRoot, globalStoreOptions, terminalMirror });
    try {
      return await fn(session);
    } finally {
      await new Promise((resolve) => session.server.close(resolve));
    }
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// openTerminalView(url, { nodeId, sessionId }) — a REAL ws client opening the
// REAL /ws/terminal-view route. Resolves { opened, ws, frames } — frames
// collects every server->browser message received (raw text/bytes).
function openTerminalView(baseUrl, { nodeId, sessionId, timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const wsUrl = new URL("/ws/terminal-view", baseUrl.replace(/^http/, "ws"));
    if (nodeId != null) wsUrl.searchParams.set("nodeId", nodeId);
    if (sessionId != null) wsUrl.searchParams.set("sessionId", sessionId);
    const ws = new WebSocket(wsUrl);
    const frames = [];
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; resolve({ opened: false, ws: null, frames }); }
    }, timeoutMs);
    ws.on("open", () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ opened: true, ws, frames }); }
    });
    ws.on("message", (data) => frames.push(data.toString()));
    ws.on("error", () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ opened: false, ws: null, frames }); }
    });
    ws.on("unexpected-response", () => {
      if (!settled) { settled = true; clearTimeout(timer); resolve({ opened: false, ws: null, frames }); }
    });
  });
}

function waitFor(predicate, { timeoutMs = 1500, label = "condition" } = {}) {
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

const settle = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

export const meshFleetTerminalViewMirrorTests = [
  // --- Scenario: the mirror is in-memory + EPHEMERAL — it writes no durable
  //     record, and a rebuild starts empty ---
  {
    name: "task01/38-06 the mirror is in-memory + EPHEMERAL — no durable record; a rebuild starts empty; a late subscriber gets no persisted history",
    async run() {
      const mirror = createTerminalMirror();
      await withFleetServer(async ({ url }) => {
        // Given terminal-frames for (node-a, sess-1) have flowed through the mirror.
        const client = await openTerminalView(url, { nodeId: "node-a", sessionId: "sess-1" });
        assert.ok(client.opened, "the terminal-VIEW route accepts a real ws upgrade with nodeId+sessionId");
        const envelope = buildTerminalFrameEnvelope("node-a", "sess-1", "hello live terminal\n");
        mirror.apply(envelope);
        await waitFor(() => client.frames.length >= 1, { label: "client receives the frame" });
        assert.equal(client.frames[0], "hello live terminal\n");
        client.ws.close();

        // Then discarding and recreating the mirror yields an EMPTY mirror.
        const rebuilt = createTerminalMirror();
        assert.equal(rebuilt.size, 0, "a freshly created mirror starts with zero live (nodeId,sessionId) subscriptions");

        // And a client that subscribes AFTER frames have flowed is not served a
        // persisted full history — the SAME mirror, a NEW subscriber for the SAME
        // tuple, sees nothing from before it connected.
        const lateClient = await openTerminalView(url, { nodeId: "node-a", sessionId: "sess-1" });
        assert.ok(lateClient.opened);
        await settle();
        assert.equal(lateClient.frames.length, 0, "a late subscriber is not served a persisted full history — the mirror is a live tail, never a system of record");
        lateClient.ws.close();
      }, { terminalMirror: mirror });

      // No durable record — mirror.apply() writes nothing (there is no fs handle
      // anywhere on this module; the fitness acd-fleet-terminal-mirror-read-only
      // (task 02) enforces this structurally over the real source).
    },
  },

  // --- Scenario: opening an assignment's card discovers its stream from the
  //     surfaced session_id — an assignment with none never subscribes to a
  //     guessed/wrong session ---
  {
    name: "task01/38-06 opening a card resolves the (nodeId,sessionId) join key from a surfaced session_id; an assignment with NO session_id never subscribes to a guessed session",
    async run() {
      await withFleetServer(async ({ url }) => {
        // Given an assignment record surfacing nodeId "node-a" and session_id "sess-1".
        const card = await openTerminalView(url, { nodeId: "node-a", sessionId: "sess-1" });
        assert.ok(card.opened, "the fleet resolves exactly the surfaced (nodeId, sessionId) and subscribes to that stream");

        // And an assignment with NO session_id surfaced yet shows no terminal
        // stream — it never subscribes to a guessed or wrong session. The route
        // structurally REFUSES an upgrade missing either half of the tuple — a
        // frontend literally cannot open a guessed/partial subscription.
        const noSessionId = await openTerminalView(url, { nodeId: "node-a", sessionId: undefined });
        assert.equal(noSessionId.opened, false, "no session_id surfaced yet -> the terminal-VIEW upgrade is refused, never a guessed subscription");
        const noNodeId = await openTerminalView(url, { nodeId: undefined, sessionId: "sess-1" });
        assert.equal(noNodeId.opened, false, "no nodeId -> the terminal-VIEW upgrade is refused likewise");

        card.ws.close();
      });
    },
  },

  // --- Scenario: a frame with no resolvable (nodeId, sessionId) is DROPPED,
  //     never broadcast to an unrelated card ---
  {
    name: "task01/38-06 a frame for an unresolvable (nodeId,sessionId) is DROPPED — never delivered to an unrelated open card, never errors, never tears down existing streams",
    async run() {
      const mirror = createTerminalMirror();
      await withFleetServer(async ({ url }) => {
        // Given a terminal-VIEW open on (node-a, sess-1).
        const openCard = await openTerminalView(url, { nodeId: "node-a", sessionId: "sess-1" });
        assert.ok(openCard.opened);

        // When a terminal-frame arrives for (node-z, sess-unknown) that matches no
        // open card.
        const unroutable = buildTerminalFrameEnvelope("node-z", "sess-unknown", "should never appear anywhere\n");
        const delivered = mirror.apply(unroutable);

        // Then it is dropped by the mirror — never delivered to the (node-a,
        // sess-1) view.
        assert.equal(delivered, false, "apply() reports the unroutable frame was NOT delivered anywhere");
        await settle();
        assert.equal(openCard.frames.length, 0, "the (node-a, sess-1) view received NOTHING for the unroutable frame");

        // And the arrival of that unroutable frame does not error nor tear down
        // the existing streams — the SAME (node-a, sess-1) stream still works.
        const followUp = buildTerminalFrameEnvelope("node-a", "sess-1", "still alive\n");
        mirror.apply(followUp);
        await waitFor(() => openCard.frames.length >= 1, { label: "the existing stream still receives its own frames" });
        assert.equal(openCard.frames[0], "still alive\n");

        openCard.ws.close();
      }, { terminalMirror: mirror });
    },
  },

  // --- Scenario Outline: the mirror MULTIPLEXES — each terminal-VIEW receives
  //     only its own (nodeId, sessionId), no cross-talk ---
  {
    name: "task01/38-06 Scenario Outline — the mirror MULTIPLEXES 3 concurrent (nodeId,sessionId) streams with NO cross-talk (incl. same-node multiplex)",
    async run() {
      const mirror = createTerminalMirror();
      await withFleetServer(async ({ url }) => {
        // Given concurrent terminal-frames flowing for (node-a, sess-1),
        // (node-b, sess-2), and (node-a, sess-2).
        const rows = [
          { nodeId: "node-a", sessionId: "sess-1", bytes: "node-a/sess-1 output\n" },
          { nodeId: "node-b", sessionId: "sess-2", bytes: "node-b/sess-2 output\n" },
          { nodeId: "node-a", sessionId: "sess-2", bytes: "node-a/sess-2 output\n" },
        ];
        const cards = new Map();
        for (const row of rows) {
          const card = await openTerminalView(url, { nodeId: row.nodeId, sessionId: row.sessionId });
          assert.ok(card.opened, `terminal-VIEW opened for (${row.nodeId}, ${row.sessionId})`);
          cards.set(`${row.nodeId}::${row.sessionId}`, card);
        }

        for (const row of rows) {
          mirror.apply(buildTerminalFrameEnvelope(row.nodeId, row.sessionId, row.bytes));
        }

        for (const row of rows) {
          const key = `${row.nodeId}::${row.sessionId}`;
          const card = cards.get(key);
          await waitFor(() => card.frames.length >= 1, { label: `card ${key} receives its own frame` });
          assert.equal(card.frames[0], row.bytes, `card (${row.nodeId}, ${row.sessionId}) received exactly its own frame`);
        }

        // And it receives NO frame for any other (nodeId, sessionId) — no
        // cross-talk between streams, including the same-node (node-a) pair.
        for (const row of rows) {
          const key = `${row.nodeId}::${row.sessionId}`;
          const card = cards.get(key);
          assert.equal(card.frames.length, 1, `card (${row.nodeId}, ${row.sessionId}) received EXACTLY one frame — no cross-talk from the other two streams`);
        }

        for (const card of cards.values()) card.ws.close();
      }, { terminalMirror: mirror });
    },
  },
];
