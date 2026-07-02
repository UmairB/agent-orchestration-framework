// Traceability wiring for milestone 23 / story 02 — task 03
// (tasks/03_relay-receive-and-apply.feature, finding F1). The node-side PERSISTENT relay
// subscriber applies fanned-out presence signals so a peer's change surfaces in mesh:status
// ≤5s over the relay — the missing CONSUMER hop (producer → transport → consumer → render).
//
// Covers EVERY @executable scenario / Scenario-Outline row, exercising the REAL in-process
// registry (src/command-core.mjs + the EXTENDED mesh:status in src/commands/mesh-identity.mjs
// over src/mesh-presence.mjs + src/mesh-presence-cache.mjs + src/mesh-presence-subscriber.mjs)
// against a temp fixture repo — loadWorkspace + invoke, real fs, in-process. The subscriber
// takes an INJECTED fake transport (a tiny in-test stub that captures the onMessage handler
// so a fanned-out frame is delivered synchronously) — NO real ws server, NO wall-clock. The
// injected presence cache is driven into mesh:status via invoke("mesh:status", { now },
// { workspace, presenceCache }). One test object per @executable scenario (the bad-frame
// Scenario Outline folded into one entry iterating the rows). node:assert/strict.
//
//   03_relay-receive-and-apply.feature — a delivered peer presence signal surfaces in
//     mesh:status WITHOUT a git sync; a newer heartbeat supersedes an older one (latest wins)
//     and this node's own record is untouched; the applied signal is a LIVENESS CACHE (git
//     remains the source of truth — a same-heartbeat git sync reconciles to the durable
//     bytes, and the subscriber wrote no new durable record); a bad inbound frame (malformed
//     / missing kind / oversized / unknown-kind) is ignored, never crashing; relay-down (and
//     transport == null) degrades cleanly to the git floor; the subscriber is PERSISTENT
//     (one connection, successive frames applied, not torn down between frames).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, presenceRecordPath, nodeRecordPath } from "../src/mesh-store.mjs";
import { PRESENCE_SIGNAL_KIND } from "../src/mesh-relay-client.mjs";
import { publishPresenceRecord } from "../src/mesh-presence.mjs";
import { createPresenceCache } from "../src/mesh-presence-cache.mjs";
import {
  startPresenceSubscriber,
  parseInboundFrame,
} from "../src/mesh-presence-subscriber.mjs";
import { DEFAULT_MAX_FRAME_BYTES } from "../src/mesh-relay.mjs";

const THIS_NODE = "test-node-self";
const NOW = "2026-06-30T12:00:00.000Z";

// A fixture repo pinning this node's mesh.nodeId + a configured relay url (so the
// "configured" posture holds; every scenario INJECTS the transport, so the url only models
// configured-vs-unconfigured). A minimal work stream suffices — mesh:status reads records.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-receive-apply-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: { nodeId: THIS_NODE, relay: { controlNode: THIS_NODE, url: "ws://127.0.0.1:7777/ws/relay" } },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

// An INJECTED fake transport: it captures the onMessage handler so a fanned-out frame is
// delivered SYNCHRONOUSLY by calling deliver(frame). connect() resolves (or throws when
// `connectFails`). It tracks close() calls so the persistent-connection assertion can prove
// the connection was NOT torn down between frames. It is PERSISTENT: deliver() applies each
// frame over the ONE captured handler; nothing closes between frames.
function makeFakeTransport({ connectFails = false } = {}) {
  const calls = { onMessages: 0, connects: 0, closes: 0 };
  let handler = null;
  return {
    calls,
    // deliver(frame) → invoke the registered handler with the raw frame (as the ws message).
    deliver(frame) {
      if (handler) handler(frame);
    },
    transport: {
      onMessage(fn) {
        calls.onMessages += 1;
        handler = fn;
      },
      async connect() {
        calls.connects += 1;
        if (connectFails) throw new Error("relay subscribe: connect refused (unreachable)");
      },
      close() {
        calls.closes += 1;
      },
    },
  };
}

// Build a frozen { kind:"presence", nodeId, signal } envelope carrying a peer's presence
// record as the opaque signal (the shape the broker fans out, JSON-serialised as the wire
// frame would be).
function presenceFrame(peerId, heartbeatAt, activeRuns = []) {
  const signal = { nodeId: peerId, heartbeatAt, activeRuns, aofVersion: "0.1.0" };
  return JSON.stringify({ kind: PRESENCE_SIGNAL_KIND, nodeId: peerId, signal });
}

// Seed a node record (so a node with only a git-durable presence — not in the relay cache —
// still appears in the roster; mesh:status iterates node records, so a presence-only node
// with no node record never surfaces, exactly as story 00 rendered it).
async function seedNode(workspace, id) {
  const record = { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" };
  await mkdir(path.join(meshDir(workspace), "nodes"), { recursive: true });
  await writeFile(nodeRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
}

// Seed this node's own presence record on disk (git-durable) so the "own record untouched"
// assertion has a baseline to compare against.
async function seedOwnPresence(workspace, heartbeatAt) {
  const record = { nodeId: THIS_NODE, heartbeatAt, activeRuns: ["run-self-1"], aofVersion: "0.1.0" };
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(presenceRecordPath(workspace, THIS_NODE), JSON.stringify(record, null, 2), "utf8");
}

const ctxFor = async (repo, presenceCache) => ({ workspace: await loadWorkspace(repo), presenceCache });
const nodeOf = (result, id) => result.nodes.find((n) => n.nodeId === id);

// The presence file names under presence/ (to assert the durable surface — a relay-only peer
// leaves NO file; the subscriber writes NO new durable record).
async function presenceFiles(workspace) {
  try {
    return (await readdir(path.join(meshDir(workspace), "presence"))).filter((n) => n.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

const ISO = (base, deltaSeconds) => new Date(Date.parse(base) + deltaSeconds * 1000).toISOString();

export const meshRelayReceiveApplyTests = [
  // ══ Scenario: a delivered peer presence signal surfaces in mesh:status without a git sync ══
  {
    name: "mesh-relay-receive-apply/03 a delivered peer presence signal surfaces in mesh:status without a git sync",
    async run() {
      const { repo } = await makeRepo();
      try {
        const cache = createPresenceCache();
        const fake = makeFakeTransport();
        // Subscribe over the injected transport (persistent), handler applies into the cache.
        const sub = await startPresenceSubscriber({ transport: fake.transport, cache });
        assert.equal(sub.connected, true, "the subscriber connected over the injected transport");

        const ctx = await ctxFor(repo, cache);
        // The peer is unknown before any frame arrives (no node record, no cache entry).
        const beforeFrame = await invoke("mesh:status", { now: NOW }, ctx);
        assert.equal(nodeOf(beforeFrame, "peer-b"), undefined, "peer-b is not yet in this node's view");

        // The relay delivers a fanned-out { kind:"presence" } frame for peer-b carrying its
        // presence record (activeRuns from the delivered signal). NO git sync has run.
        const peerHeartbeat = ISO(NOW, -3);
        fake.deliver(presenceFrame("peer-b", peerHeartbeat, ["run-b-1", "run-b-2"]));

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        const peer = nodeOf(result, "peer-b");
        assert.ok(peer, "peer-b now surfaces in mesh:status (applied purely over the relay)");
        assert.ok(peer.presence, "peer-b carries its presence from the delivered signal");
        assert.equal(peer.presence.heartbeatAt, peerHeartbeat, "peer-b's presence carries the delivered heartbeatAt");
        assert.deepEqual(peer.presence.activeRuns, ["run-b-1", "run-b-2"], "peer-b's presence carries activeRuns from the delivered signal");
        assert.equal(peer.stale, false, "peer-b is live (fresh heartbeat, applied over the relay)");

        // No git sync was performed to surface it — there is NO presence file on disk for
        // peer-b (it arrived purely over the relay, held only in the cache).
        const files = await presenceFiles(ctx.workspace);
        assert.ok(!files.includes("peer-b.json"), "no git-durable presence record for peer-b on disk (it arrived purely over the relay, no git sync)");

        sub.stop();
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a newer delivered heartbeat supersedes an older one for the same peer ══
  {
    name: "mesh-relay-receive-apply/03 a newer delivered heartbeat supersedes an older one for the same peer (latest wins), this node's own record untouched",
    async run() {
      const { repo } = await makeRepo();
      try {
        const cache = createPresenceCache();
        const fake = makeFakeTransport();
        const sub = await startPresenceSubscriber({ transport: fake.transport, cache });
        const ctx = await ctxFor(repo, cache);

        // This node's OWN node record + durable presence record are seeded on disk —
        // applying a PEER's signal must never touch this node's own presence.
        const ownHeartbeat = ISO(NOW, -10);
        await seedNode(ctx.workspace, THIS_NODE);
        await seedOwnPresence(ctx.workspace, ownHeartbeat);
        const ownBytesBefore = await readFile(presenceRecordPath(ctx.workspace, THIS_NODE), "utf8");

        // An earlier signal for the peer, then a NEWER one (later heartbeatAt, changed
        // activeRuns). Latest wins.
        const older = ISO(NOW, -30);
        const newer = ISO(NOW, -5);
        fake.deliver(presenceFrame("peer-b", older, ["run-b-old"]));
        fake.deliver(presenceFrame("peer-b", newer, ["run-b-new"]));

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        const peer = nodeOf(result, "peer-b");
        assert.ok(peer && peer.presence, "peer-b surfaces with presence");
        assert.equal(peer.presence.heartbeatAt, newer, "mesh:status reflects the NEWER heartbeat (the latest signal wins)");
        assert.deepEqual(peer.presence.activeRuns, ["run-b-new"], "the newer signal's activeRuns are reflected");

        // An OLDER frame arriving after the newer one does NOT regress the view (latest wins
        // is strict — an equal-or-older heartbeat is dropped).
        fake.deliver(presenceFrame("peer-b", older, ["run-b-old"]));
        const afterStale = await invoke("mesh:status", { now: NOW }, ctx);
        assert.equal(nodeOf(afterStale, "peer-b").presence.heartbeatAt, newer, "a later-arriving older heartbeat does not regress the view");

        // This node's own presence record is BYTE-UNCHANGED — applying a peer's signal never
        // touches THIS node's own presence.
        const ownBytesAfter = await readFile(presenceRecordPath(ctx.workspace, THIS_NODE), "utf8");
        assert.equal(ownBytesAfter, ownBytesBefore, "this node's own durable presence record is byte-unchanged by applying a peer's signal");
        // This node's own cache entry is untouched — the cache is keyed by the peer's id.
        assert.equal(cache.get(THIS_NODE), null, "this node's own id is not in the peer liveness cache");
        const own = nodeOf(afterStale, THIS_NODE);
        assert.ok(own && own.presence, "this node still renders its own git-durable presence");
        assert.equal(own.presence.heartbeatAt, ownHeartbeat, "this node's own rendered heartbeat is its git-durable one");

        sub.stop();
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the applied relay signal is a liveness cache — git remains the source of truth ══
  {
    name: "mesh-relay-receive-apply/03 the applied relay signal is a liveness cache — git remains the source of truth (a same-heartbeat git sync reconciles to the durable bytes)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const cache = createPresenceCache();
        const fake = makeFakeTransport();
        const sub = await startPresenceSubscriber({ transport: fake.transport, cache });
        const ctx = await ctxFor(repo, cache);

        // The peer's presence arrives over the relay first (cache-only, no disk record).
        const heartbeat = ISO(NOW, -4);
        fake.deliver(presenceFrame("peer-b", heartbeat, ["run-b-1"]));
        assert.ok(!(await presenceFiles(ctx.workspace)).includes("peer-b.json"), "before the git sync, peer-b is cache-only (no disk record)");

        // Now a git sync pulls the peer's DURABLE record to disk with the SAME heartbeat —
        // written through the presence write seam (publishPresenceRecord), as the git bus
        // would carry it. This is the ONLY presence file the git bus carried for peer-b.
        const durable = { nodeId: "peer-b", heartbeatAt: heartbeat, activeRuns: ["run-b-1"], aofVersion: "0.1.0" };
        await publishPresenceRecord(ctx.workspace, "peer-b", durable);
        const durableBytes = await readFile(presenceRecordPath(ctx.workspace, "peer-b"), "utf8");

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        const peer = nodeOf(result, "peer-b");
        assert.ok(peer && peer.presence, "peer-b surfaces with presence");
        // A tie (same heartbeat) reconciles to the GIT-DURABLE record bytes — git is the
        // authority, so the render reflects the durable object, not the cache projection.
        assert.deepEqual(peer.presence, durable, "peer-b's presence reconciles to the git-durable record (the tie broke in favour of git)");

        // The subscriber wrote NO new durable record the git bus did not already carry: the
        // ONLY presence file on disk for peer-b is the one the git sync (publishPresenceRecord)
        // wrote, byte-identical to what we seeded.
        const files = await presenceFiles(ctx.workspace);
        assert.deepEqual(files, ["peer-b.json"], "the only presence file on disk is the git-durable one (the subscriber wrote no durable record)");
        assert.equal(await readFile(presenceRecordPath(ctx.workspace, "peer-b"), "utf8"), durableBytes, "the git-durable bytes are untouched by the subscriber");

        sub.stop();
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a bad inbound frame is ignored, never crashing the subscriber or corrupting the view ══
  {
    name: "mesh-relay-receive-apply/03 a bad inbound frame is ignored, never crashing the subscriber or corrupting the view (Scenario Outline, folded)",
    async run() {
      // The rows: malformed non-JSON; a frame missing kind; an oversized frame over the
      // limit; an unknown-kind (m26 leasing) frame. Each is delivered after a GOOD peer
      // presence is already applied; the good entry must be unchanged and nothing throws.
      const oversized = JSON.stringify({
        kind: PRESENCE_SIGNAL_KIND,
        nodeId: "peer-huge",
        signal: { nodeId: "peer-huge", heartbeatAt: NOW, activeRuns: [], aofVersion: "0.1.0", pad: "x".repeat(DEFAULT_MAX_FRAME_BYTES + 1024) },
      });
      // `parsesToNull` marks WHERE the frame is rejected: the malformed / missing-kind /
      // oversized rows are dropped by parseInboundFrame itself (→ null); the unknown-kind
      // (m26 leasing) row is a WELL-FORMED envelope (kind is a string) so parseInboundFrame
      // returns it — payload-agnostic about the kind VALUE (the ADR-001 discipline, read-
      // side) — and it is the CACHE's apply() that ignores a non-"presence" kind. Either way
      // the good entry is unchanged and nothing leaks. `ignoredBy` names the seam that drops it.
      const rows = [
        { label: "a malformed non-JSON frame", frame: "this is not json {{{", parsesToNull: true },
        { label: "a frame missing the kind field", frame: JSON.stringify({ nodeId: "peer-x", signal: { nodeId: "peer-x", heartbeatAt: NOW } }), parsesToNull: true },
        { label: "an oversized frame over the limit", frame: oversized, parsesToNull: true },
        { label: "an unknown-kind (m26 leasing) frame", frame: JSON.stringify({ kind: "lease", nodeId: "peer-x", signal: { nodeId: "peer-x", heartbeatAt: NOW } }), parsesToNull: false },
      ];
      for (const row of rows) {
        const { repo } = await makeRepo();
        try {
          const cache = createPresenceCache();
          const fake = makeFakeTransport();
          const sub = await startPresenceSubscriber({ transport: fake.transport, cache });
          const ctx = await ctxFor(repo, cache);

          // A valid peer presence is already applied (the good entry to protect).
          const goodHeartbeat = ISO(NOW, -6);
          fake.deliver(presenceFrame("peer-good", goodHeartbeat, ["run-good"]));
          const good = nodeOf(await invoke("mesh:status", { now: NOW }, ctx), "peer-good");
          assert.ok(good && good.presence, `[${row.label}] the good peer presence is applied`);

          // Deliver the bad frame — startPresenceSubscriber's handler must not throw.
          assert.doesNotThrow(() => fake.deliver(row.frame), `[${row.label}] delivering a bad frame does not throw`);

          // The previously-applied peer presence is UNCHANGED, and no bad-frame peer leaked
          // into the view.
          const after = await invoke("mesh:status", { now: NOW }, ctx);
          const goodAfter = nodeOf(after, "peer-good");
          assert.ok(goodAfter && goodAfter.presence, `[${row.label}] the good peer presence is still present`);
          assert.equal(goodAfter.presence.heartbeatAt, goodHeartbeat, `[${row.label}] the good peer presence is unchanged`);
          assert.deepEqual(goodAfter.presence.activeRuns, ["run-good"], `[${row.label}] the good peer's activeRuns are unchanged`);
          assert.equal(nodeOf(after, "peer-x"), undefined, `[${row.label}] no bad-frame peer leaked into the view`);
          assert.equal(nodeOf(after, "peer-huge"), undefined, `[${row.label}] the oversized-frame peer did not leak into the view`);
          assert.equal(cache.size, 1, `[${row.label}] the cache still holds exactly the one good entry`);

          // parseInboundFrame itself is total — it NEVER throws on a bad frame. The
          // malformed / missing-kind / oversized rows are dropped at parse (→ null); the
          // unknown-kind row is a well-formed envelope parseInboundFrame returns (it is the
          // cache's apply() that ignores the non-"presence" kind — asserted below).
          const parsed = parseInboundFrame(row.frame);
          if (row.parsesToNull) {
            assert.equal(parsed, null, `[${row.label}] parseInboundFrame returns null for the bad frame (never throws)`);
          } else {
            assert.ok(parsed != null && typeof parsed.kind === "string" && parsed.kind !== PRESENCE_SIGNAL_KIND, `[${row.label}] parseInboundFrame returns a well-formed non-presence envelope (payload-agnostic about the kind value)`);
            // The cache is the seam that ignores an unknown kind: applying it returns false
            // and the entry is not stored.
            assert.equal(cache.apply(parsed), false, `[${row.label}] the cache ignores an unknown-kind envelope (apply returns false)`);
            assert.equal(cache.get("peer-x"), null, `[${row.label}] the unknown-kind peer is not cached`);
          }

          sub.stop();
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: with the relay down the subscriber degrades cleanly to the git floor ══
  {
    name: "mesh-relay-receive-apply/03 with the relay down the subscriber degrades cleanly to the git floor (connect throws AND transport == null)",
    async run() {
      // Case A: a transport whose connect() throws (the relay is configured but unreachable).
      {
        const { repo } = await makeRepo();
        try {
          const cache = createPresenceCache();
          const fake = makeFakeTransport({ connectFails: true });
          let sub;
          await assert.doesNotReject(async () => {
            sub = await startPresenceSubscriber({ transport: fake.transport, cache });
          }, "startPresenceSubscriber resolves even when connect() throws (never propagates the throw)");
          assert.equal(sub.connected, false, "connected is false when the relay is unreachable");

          const ctx = await ctxFor(repo, cache);
          // A git-synced node + presence record still renders (the ≤30s floor).
          const gitHeartbeat = ISO(NOW, -8);
          await seedNode(ctx.workspace, "peer-git");
          await publishPresenceRecord(ctx.workspace, "peer-git", { nodeId: "peer-git", heartbeatAt: gitHeartbeat, activeRuns: ["run-git"], aofVersion: "0.1.0" });
          const result = await invoke("mesh:status", { now: NOW }, ctx);
          const peer = nodeOf(result, "peer-git");
          assert.ok(peer && peer.presence, "mesh:status still renders the git-synced presence record (the ≤30s floor)");
          assert.equal(peer.presence.heartbeatAt, gitHeartbeat, "the git-synced heartbeat is rendered");
          // stop() on a never-connected subscriber neither crashes nor blocks.
          assert.doesNotThrow(() => sub.stop(), "stop() on a never-connected subscriber does not crash");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }

      // Case B: no transport at all (unconfigured relay) — a clean degrade, no crash.
      {
        const { repo } = await makeRepo();
        try {
          const cache = createPresenceCache();
          let sub;
          await assert.doesNotReject(async () => {
            sub = await startPresenceSubscriber({ transport: null, cache });
          }, "startPresenceSubscriber resolves cleanly when there is no transport (unconfigured relay)");
          assert.equal(sub.connected, false, "connected is false with no transport");
          assert.doesNotThrow(() => sub.stop(), "stop() with no transport does not crash");

          const ctx = await ctxFor(repo, cache);
          const gitHeartbeat = ISO(NOW, -8);
          await seedNode(ctx.workspace, "peer-git");
          await publishPresenceRecord(ctx.workspace, "peer-git", { nodeId: "peer-git", heartbeatAt: gitHeartbeat, activeRuns: [], aofVersion: "0.1.0" });
          const result = await invoke("mesh:status", { now: NOW }, ctx);
          assert.ok(nodeOf(result, "peer-git")?.presence, "mesh:status still renders the git-synced record with no relay configured");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: the subscriber holds a persistent connection and applies successive signals ══
  {
    name: "mesh-relay-receive-apply/03 the subscriber holds a persistent connection and applies successive signals (not torn down between frames)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const cache = createPresenceCache();
        const fake = makeFakeTransport();
        const sub = await startPresenceSubscriber({ transport: fake.transport, cache });
        assert.equal(sub.connected, true, "the subscriber connected");
        assert.equal(fake.calls.connects, 1, "exactly ONE connection was opened");

        const ctx = await ctxFor(repo, cache);
        // Three successive { kind:"presence" } frames for DIFFERENT peers on the ONE
        // connection.
        fake.deliver(presenceFrame("peer-1", ISO(NOW, -3), ["run-1"]));
        fake.deliver(presenceFrame("peer-2", ISO(NOW, -2), ["run-2"]));
        fake.deliver(presenceFrame("peer-3", ISO(NOW, -1), ["run-3"]));

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        for (const id of ["peer-1", "peer-2", "peer-3"]) {
          const peer = nodeOf(result, id);
          assert.ok(peer && peer.presence, `${id} surfaces in mesh:status (all three applied on one connection)`);
        }

        // The connection was NOT torn down between frames — it is persistent, not one-shot.
        // No close() was called across the three deliveries, and only one connect() opened it.
        assert.equal(fake.calls.closes, 0, "the connection was not closed between frames (persistent, not one-shot)");
        assert.equal(fake.calls.connects, 1, "no re-connection happened between frames (one persistent connection)");
        assert.equal(fake.calls.onMessages, 1, "the handler was registered exactly once (one persistent connection)");

        // Only stop() disposes it.
        sub.stop();
        assert.equal(fake.calls.closes, 1, "stop() disposed the one persistent connection");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
