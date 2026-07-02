// Traceability wiring for milestone 23 / story 01 — task 00
// (tasks/00_relay-broker-fanout.feature). serveRelay stands up a stateless ws@8 broker
// that fans one node's signal out to the OTHER nodes and persists nothing.
//
// Covers EVERY @executable scenario, exercising the REAL in-process serveRelay
// (src/mesh-relay.mjs) over an EPHEMERAL port (port: 0) with an in-process `ws` client —
// NO spawn (the 22/R3 flake is sidestepped by going fully in-process). The ack-on-connect
// (join-confirm) barrier ({ type:'joined' }) is the DETERMINISTIC proof a peer is in the
// broadcast set before the sender publishes — every ordering-sensitive assertion awaits
// each peer's ack first (a raw `open` await is racy: open fires before the server-side
// connection handler has registered the socket). One test object per @executable scenario.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveRelay } from "../src/mesh-relay.mjs";

// --- the in-process ws harness ------------------------------------------------

// Connect a ws client and resolve ONLY after its { type:'joined' } ack arrives (the
// deterministic barrier — the client is provably in the broker's clients set). Returns
// { ws, frames } where frames collects every NON-ack frame (parsed when JSON).
function connect(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const frames = [];
    let joined = false;
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) { settled = true; reject(new Error("join-ack timeout")); }
    }, timeoutMs);
    ws.on("message", (data) => {
      const text = data.toString();
      let parsed = null;
      try { parsed = JSON.parse(text); } catch { /* raw, non-JSON frame */ }
      if (parsed && parsed.type === "joined" && !joined) {
        joined = true;
        if (!settled) { settled = true; clearTimeout(timer); resolve({ ws, frames }); }
        return;
      }
      frames.push({ text, parsed });
    });
    ws.on("error", (error) => {
      if (!settled) { settled = true; clearTimeout(timer); reject(error); }
    });
  });
}

// Poll until predicate() is true or the timeout elapses. Used to await a fanned-out frame
// deterministically (after the ack barrier the only remaining variable is in-process
// delivery, which is immediate — the poll is a tight, bounded wait, never a sleep).
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

// A small settle window: after the ack barrier, give the broker a beat to have NOT
// delivered a frame where the assertion is "received nothing" (no-self-echo / late-joiner
// misses-early). Short + bounded; the positive deliveries are awaited via waitFor.
function settle(ms = 120) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const closeAll = async (...clients) => {
  for (const c of clients) {
    try { c?.ws?.close?.(); } catch { /* noop */ }
  }
};

const envelope = (kind, nodeId, signal) => JSON.stringify({ kind, nodeId, signal });

// A recursive byte-stable snapshot of a directory tree (path → bytes) for the
// filesystem-untouched assertion. Returns a Map of relative-path → content string.
async function snapshotTree(root) {
  const snap = new Map();
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(abs, relPath);
      } else {
        snap.set(relPath, await readFile(abs, "utf8"));
      }
    }
  }
  await walk(root, "");
  return snap;
}

function snapshotsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (!b.has(k) || b.get(k) !== v) return false;
  }
  return true;
}

export const meshRelayBrokerFanoutTests = [
  // --- Scenario: serveRelay returns a { server, url, stop } serve unit on a live
  //     ephemeral port (the assigned port, not the requested 0) ---
  {
    name: "mesh-relay/00 serveRelay returns a { server, url, stop } serve unit on a live ephemeral port",
    async run() {
      const relay = await serveRelay({ port: 0 });
      try {
        // It exposes a server, a url, and a stop function.
        assert.ok(relay.server, "the serve unit exposes a server");
        assert.equal(typeof relay.url, "string", "the serve unit exposes a url string");
        assert.equal(typeof relay.stop, "function", "the serve unit exposes a stop function");
        // The url carries the ACTUAL assigned port (not the requested 0).
        const assignedPort = relay.server.address().port;
        assert.ok(assignedPort > 0, "the server bound a real ephemeral port");
        assert.ok(relay.url.includes(`:${assignedPort}`), `the url carries the assigned port ${assignedPort} (not 0) — got ${relay.url}`);
        assert.ok(!relay.url.includes(":0/"), "the url does not carry the requested port 0");
        // A ws client can complete a connection handshake against that url.
        const a = await connect(relay.url);
        assert.ok(a.ws, "a ws client completed a connection handshake against the url");
        await closeAll(a);
      } finally {
        await relay.stop();
      }
    },
  },

  // --- Scenario: a signal published by one node is fanned out to the other nodes and
  //     never echoed to the sender ---
  {
    name: "mesh-relay/00 a signal is fanned out to the other nodes and never echoed to the sender",
    async run() {
      const relay = await serveRelay({ port: 0 });
      let a, b, c;
      try {
        // Three nodes A, B, C connected and their handshakes completed (the ack barrier).
        a = await connect(relay.url);
        b = await connect(relay.url);
        c = await connect(relay.url);
        // When node A publishes a signal frame.
        a.ws.send(envelope("presence", "A", { hello: "world" }));
        // Then B and C receive A's signal frame.
        await waitFor(() => b.frames.length >= 1, { label: "B receives" });
        await waitFor(() => c.frames.length >= 1, { label: "C receives" });
        assert.equal(b.frames[0].parsed.nodeId, "A", "node B received node A's signal frame");
        assert.equal(c.frames[0].parsed.nodeId, "A", "node C received node A's signal frame");
        // And A receives NO frame for its own signal (no self-echo).
        await settle();
        assert.equal(a.frames.length, 0, "node A received no frame for its own signal (the relay does not echo the sender)");
      } finally {
        await closeAll(a, b, c);
        await relay.stop();
      }
    },
  },

  // --- Scenario: brokering a signal writes no durable artifact — the filesystem is
  //     untouched ---
  {
    name: "mesh-relay/00 brokering a signal writes no durable artifact — the filesystem under the workspace is byte-unchanged",
    async run() {
      // A workspace dir the relay COULD (but must not) write under.
      const workspace = await mkdtemp(path.join(os.tmpdir(), "aof-relay-fs-"));
      await mkdir(path.join(workspace, "wiki", "work", ".mesh", "presence"), { recursive: true });
      await writeFile(path.join(workspace, "wiki", "work", ".mesh", "presence", "seed.json"), '{"seed":true}\n', "utf8");
      const relay = await serveRelay({ port: 0, config: { mesh: { nodeId: "A" } } });
      let a, b;
      try {
        // Given two nodes connected and I record the filesystem state under the workspace.
        a = await connect(relay.url);
        b = await connect(relay.url);
        const before = await snapshotTree(workspace);
        // When one node publishes a signal frame and the other receives it.
        a.ws.send(envelope("presence", "A", { runs: ["23/01"] }));
        await waitFor(() => b.frames.length >= 1, { label: "B receives" });
        await settle();
        // Then no file was created, modified, or deleted on disk for that signal; no
        // presence record or relay log was written; the workspace is byte-unchanged.
        const after = await snapshotTree(workspace);
        assert.ok(snapshotsEqual(before, after), "the filesystem under the workspace is byte-unchanged from before the publish (no file created/modified/deleted)");
        // Belt-and-braces: only the seed record exists — no relay log appeared.
        const presence = await readdir(path.join(workspace, "wiki", "work", ".mesh", "presence"));
        assert.deepEqual(presence, ["seed.json"], "no presence record or relay log was written (the in-flight signal stays in memory only)");
      } finally {
        await closeAll(a, b);
        await relay.stop();
        await rm(workspace, { recursive: true, force: true });
      }
    },
  },

  // --- Scenario: a late-joining node receives only signals published after it connects
  //     (the relay is not a replay log) ---
  {
    name: "mesh-relay/00 a late-joining node receives only signals published after it connects (not a replay log)",
    async run() {
      const relay = await serveRelay({ port: 0 });
      let a, b;
      try {
        // Given node A is connected and publishes "early" with no other node present.
        a = await connect(relay.url);
        a.ws.send(envelope("presence", "A", "early"));
        await settle();
        // When node B connects after "early" was published (await B's ack barrier).
        b = await connect(relay.url);
        // And node A then publishes "late".
        a.ws.send(envelope("presence", "A", "late"));
        // Then B receives "late" (published while B was connected)…
        await waitFor(() => b.frames.length >= 1, { label: "B receives late" });
        assert.equal(b.frames[0].parsed.signal, "late", "node B received the 'late' frame (published while B was connected)");
        // …and B does NOT receive "early" (it was not connected when "early" was published).
        await settle();
        assert.ok(
          !b.frames.some((f) => f.parsed && f.parsed.signal === "early"),
          "node B did not receive the 'early' frame (the relay is an ephemeral broker, not a replay log)"
        );
      } finally {
        await closeAll(a, b);
        await relay.stop();
      }
    },
  },

  // --- Scenario: stop() tears the broker down cleanly so the port frees and new connects
  //     fail; an already-open connection is closed (not left dangling) ---
  {
    name: "mesh-relay/00 stop() tears the broker down cleanly — the port frees, new connects fail, the open connection is closed",
    async run() {
      const relay = await serveRelay({ port: 0 });
      const url = relay.url;
      // Given a node is connected to the relay.
      const a = await connect(url);
      let aClosed = false;
      a.ws.on("close", () => { aClosed = true; });
      // When I call stop() on the serve unit.
      await relay.stop();
      // Then the previously-open connection is closed (not left dangling).
      await waitFor(() => aClosed, { label: "open connection closed", timeoutMs: 2000 }).catch(() => {});
      assert.ok(aClosed, "the previously-open connection was closed (not left dangling against a dead server)");
      // And a fresh ws client connecting to the same url FAILS (the port is freed).
      const connectFailed = await new Promise((resolve) => {
        const ws = new WebSocket(url);
        let done = false;
        const finish = (failed) => { if (!done) { done = true; resolve(failed); } };
        ws.on("open", () => { try { ws.close(); } catch { /* noop */ } finish(false); });
        ws.on("error", () => finish(true));
        setTimeout(() => finish(true), 1500);
      });
      assert.ok(connectFailed, "a fresh ws client connecting to the stopped relay's url fails (the server stopped listening and the port is freed)");
    },
  },
];
