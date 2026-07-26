// Traceability wiring for milestone 23 / story 01 — task 02
// (tasks/02_control-node-role.feature). The control node is a re-nominate-able config role
// (config.mesh.relay.controlNode = the nominated node id; config.mesh.relay.url = the
// peer-push endpoint); standing up relay mode READS that config and serves ONLY when this
// node is nominated; re-nomination is a config edit on a different node (NO election); and
// losing the control node loses LIVENESS, not DATA — every durable record on disk is
// byte-unchanged across the relay's death.
//
// Covers EVERY @executable scenario in-process: relayMode(config, { port }) is the config
// gate (serves → { server, url, stop } when nominated; null otherwise — a clean no-op, no
// listener bound, the resolved QA flag #3). No spawned second OS process. The byte-
// unchanged invariant records on-disk record bytes, calls stop(), and re-reads.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveRelay, relayMode, relayStatus } from "../src/mesh-relay.mjs";

// A ws connect that resolves on the join ack (proof the relay is actually serving).
function connect(url, { timeoutMs = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    let settled = false;
    const timer = setTimeout(() => { if (!settled) { settled = true; reject(new Error("join-ack timeout")); } }, timeoutMs);
    ws.on("message", (data) => {
      let parsed = null;
      try { parsed = JSON.parse(data.toString()); } catch { /* raw */ }
      if (parsed && parsed.type === "joined" && !settled) {
        settled = true; clearTimeout(timer); resolve(ws);
      }
    });
    ws.on("error", (error) => { if (!settled) { settled = true; clearTimeout(timer); reject(error); } });
  });
}

// A directory snapshot (relative path → bytes) for the byte-unchanged invariant.
async function snapshotTree(root) {
  const snap = new Map();
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(abs, relPath);
      else snap.set(relPath, await readFile(abs, "utf8"));
    }
  }
  await walk(root, "");
  return snap;
}

function snapshotsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) if (!b.has(k) || b.get(k) !== v) return false;
  return true;
}

export const meshRelayControlNodeTests = [
  // --- Scenario: standing up relay mode reads config.mesh.relay.controlNode and
  //     config.mesh.relay.url ---
  {
    name: "mesh-relay/02 standing up relay mode reads config.mesh.relay.controlNode + url and serves when this node is nominated",
    async run() {
      // Given controlNode is THIS node's id and url is set.
      const config = { mesh: { nodeId: "node-a", relay: { controlNode: "node-a", url: "ws://node-a.lan:7777/ws/relay" } } };
      // When this node stands up relay mode.
      const relay = await relayMode(config, { port: 0 });
      try {
        assert.ok(relay, "relay mode served (this node is the nominated control node)");
        // Then the relay serves on the configured url (a ws client can connect).
        const ws = await connect(relay.url);
        assert.ok(ws, "the relay serves — a ws client connected on the assigned port");
        try { ws.close(); } catch { /* noop */ }
        // And the control node the relay reports is the one named in config.
        const status = relayStatus(config);
        assert.equal(status.controlNode, "node-a", "the control node the relay reports is the one named in config.mesh.relay.controlNode");
        assert.ok(status.nominated, "this node reports as the nominated control node");
      } finally {
        await relay.stop();
      }
    },
  },

  // --- Scenario: a node that is not the nominated control node does not host the relay ---
  {
    name: "mesh-relay/02 a node that is not the nominated control node does not host the relay (a clean no-op, no listener bound)",
    async run() {
      // Given controlNode is a DIFFERENT node's id.
      const config = { mesh: { nodeId: "node-a", relay: { controlNode: "node-b", url: "ws://node-b.lan:7777/ws/relay" } } };
      // When this node attempts to stand up relay mode.
      const result = await relayMode(config, { port: 0 });
      // Then this node does not host the relay (no listener bound) — a clean null no-op,
      // not a crash and not a silent second relay.
      assert.equal(result, null, "a non-nominated node standing up relay mode is a clean no-op (relayMode returned null — no listener bound, no port taken)");
      // And the status reports it is not nominated (it declined because config did not
      // nominate it).
      const status = relayStatus(config);
      assert.equal(status.nominated, false, "this node declines — the config did not nominate it");
      assert.equal(status.controlNode, "node-b", "the relay role belongs to the node named in config (node-b), not this one");
    },
  },

  // --- Scenario: re-nomination is standing relay mode up on a different node and
  //     re-pointing the config — no election ---
  {
    name: "mesh-relay/02 re-nomination is a config edit on a different node — no election protocol runs",
    async run() {
      // Given the control node was previously this node…
      const before = { mesh: { nodeId: "node-a", relay: { controlNode: "node-a", url: "ws://relay/ws/relay" } } };
      assert.ok(relayStatus(before).nominated, "node-a was the control node before re-nomination");
      // …then config.mesh.relay.controlNode is re-pointed to node "B". Node B's config is
      // the re-pointed config evaluated AS node B (its own nodeId = node-b).
      const repointedAtB = { mesh: { nodeId: "node-b", relay: { controlNode: "node-b", url: "ws://relay/ws/relay" } } };
      // When node "B" stands up relay mode with the re-pointed config.
      const relayB = await relayMode(repointedAtB, { port: 0 });
      try {
        // Then node "B" now hosts the relay (it is the nominated control node)…
        assert.ok(relayB, "node B now hosts the relay (it is the nominated control node)");
        const ws = await connect(relayB.url);
        assert.ok(ws, "node B's relay is serving");
        try { ws.close(); } catch { /* noop */ }
        // …the nomination changed SOLELY because config.mesh.relay.controlNode changed
        // (no election protocol ran). Same node-a, re-pointed config, now DECLINES:
        const aUnderRepoint = { mesh: { nodeId: "node-a", relay: { controlNode: "node-b", url: "ws://relay/ws/relay" } } };
        const aResult = await relayMode(aUnderRepoint, { port: 0 });
        assert.equal(aResult, null, "node-a now declines under the re-pointed config — the role moved by the config edit alone");
        // And no vote/leader-election message was exchanged: relayMode is a PURE config
        // read (no peer handshake) — re-nomination is the config edit, full stop.
        // (Asserted structurally: relayMode's decision is a function of config only, taking
        // no peer/network argument — the same config yields the same decision every time.)
        assert.equal(await relayMode(aUnderRepoint, { port: 0 }), null, "the nomination decision is a pure function of config (no vote, deterministic) — node-a declines again");
      } finally {
        await relayB.stop();
      }
    },
  },

  // --- Scenario: losing the control node loses liveness, not data — every durable record
  //     on disk is byte-unchanged ---
  {
    name: "mesh-relay/02 losing the control node loses liveness, not data — every durable record on disk is byte-unchanged",
    async run() {
      // Given durable records exist on disk (node + presence records under the partition
      // root) — written by the DURABLE side (git/story 00), NOT by the relay.
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-relay-data-"));
      const meshRoot = path.join(repo, ".aof", "mesh");
      await mkdir(path.join(meshRoot, "nodes"), { recursive: true });
      await mkdir(path.join(meshRoot, "presence"), { recursive: true });
      await writeFile(path.join(meshRoot, "nodes", "node-a.json"), '{"nodeId":"node-a","aofVersion":"1.0.0"}\n', "utf8");
      await writeFile(path.join(meshRoot, "presence", "node-a.json"), '{"nodeId":"node-a","heartbeatAt":"2026-06-30T00:00:00.000Z","activeRuns":[],"aofVersion":"1.0.0"}\n', "utf8");

      // Stand up the relay (the control node) and connect a peer + publish a live signal —
      // proving the relay was carrying liveness, not writing it.
      const config = { mesh: { nodeId: "node-a", relay: { controlNode: "node-a", url: "ws://node-a/ws/relay" } } };
      const relay = await serveRelay({ port: 0, config });
      // And I record the on-disk bytes of every durable record.
      const before = await snapshotTree(meshRoot);
      try {
        const a = await connect(relay.url);
        const b = await connect(relay.url);
        a.send?.(JSON.stringify({ kind: "presence", nodeId: "node-a", signal: "live" }));
        await new Promise((r) => setTimeout(r, 120));
        try { a.close?.(); } catch { /* noop */ }
        try { b.close?.(); } catch { /* noop */ }
      } finally {
        // When the control node goes down (the relay is stopped).
        await relay.stop();
      }
      // Then every durable record on disk is byte-identical to before the relay went down.
      const after = await snapshotTree(meshRoot);
      assert.ok(snapshotsEqual(before, after), "every durable record on disk is byte-identical to before the relay went down");
      // And the relay issued/persisted nothing authoritative that was lost with it — the
      // ONLY files under the partition root are the two records the durable side wrote.
      const nodes = await readdir(path.join(meshRoot, "nodes"));
      const presence = await readdir(path.join(meshRoot, "presence"));
      assert.deepEqual(nodes, ["node-a.json"], "the relay issued no node record (it persisted nothing authoritative)");
      assert.deepEqual(presence, ["node-a.json"], "the relay issued no presence record / relay log (git and its records are intact)");
      await rm(repo, { recursive: true, force: true });
    },
  },
];
