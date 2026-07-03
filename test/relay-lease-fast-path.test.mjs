// Traceability wiring for milestone 26 / story 02 — the lease intent on the relay's
// second wire kind + the in-memory lease cache defer
// (tasks/02_relay-fast-path-defer.feature, ADR-004.1/.2 + ADR-005's disk??cache overlay).
//
// Covers EVERY @executable scenario / Scenario-Outline row. The wire-shape row drives
// the REGISTERED work:run-start with an injected relay stub (the claim path pushes the
// frozen envelope); the receive rows drive the RESOLVED locked shape: ONE
// createLeaseCache() instance, the persistent subscriber (INJECTED transport — frames
// delivered synchronously, no real ws server) applying { kind:"lease" } frames into it,
// and invoke("work:next", …, { workspace, leaseCache }) overlaying that SAME instance
// into story 01's frozen buildLeaseView hint slot. The fixtures are NON-git repos, so
// "no git sync produced the skip" holds by construction, belt-and-braced by a
// partition-root byte snapshot.
//
//   02_relay-fast-path-defer.feature —
//     - the frozen { kind:"lease", nodeId, signal } envelope, the claim record verbatim
//       as the opaque signal;
//     - a peer's intent heard over the relay defers this node's next BEFORE any git
//       sync (zero git traffic produced the skip);
//     - latest-signal-wins keyed by itemRef; other items' entries untouched;
//     - applying lease frames writes NOTHING durable — the partition root is
//       byte-unchanged, no lease file appears;
//     - the bad-frame matrix: malformed / kind-less / unknown-kind / oversized /
//       non-object signal / no-itemRef — ignored, never a crash, the view uncorrupted;
//     - skip-only influence, both halves: a cache entry never unleases a disk lease
//       (git wins) and a cached intent never becomes a lease of record.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, leaseClaimPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { LEASE_SIGNAL_KIND } from "../src/mesh-relay-client.mjs";
import { createLeaseCache, createPresenceCache } from "../src/mesh-presence-cache.mjs";
import { startPresenceSubscriber } from "../src/mesh-presence-subscriber.mjs";
import { DEFAULT_MAX_FRAME_BYTES } from "../src/mesh-relay.mjs";
import { readItemClaims, buildLeaseView } from "../src/mesh-lease.mjs";
import { aofVersion } from "../src/commands/mesh-identity.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const NODE_ID = "node-a";

function frontmatter(fields) {
  const body = Object.entries(fields).map(([k, v]) => `${k}: ${v}`).join("\n");
  return `---\n${body}\n---\n`;
}

// A two-story work repo (the work-next fixture shape) whose config pins mesh.nodeId —
// NON-git by design: zero git traffic is possible, so the defer rows' "no git sync"
// holds by construction.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-lease-fastpath-"));
  const workDir = path.join(repo, "wiki", "work");
  const mDir = path.join(workDir, "00_milestone_m0");
  await mkdir(mDir, { recursive: true });
  await writeFile(
    path.join(mDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "00", slug: "m0", status: "in-progress", created: "2026-07-01", updated: "2026-07-01" }),
    "utf8"
  );
  for (const s of [{ number: "00", slug: "story-a" }, { number: "01", slug: "story-b" }]) {
    const sDir = path.join(mDir, "stories", `${s.number}_story_${s.slug}`);
    await mkdir(sDir, { recursive: true });
    await writeFile(
      path.join(sDir, "STORY.md"),
      frontmatter({ type: "story", number: s.number, slug: s.slug, status: "not-started", created: "2026-07-01", updated: "2026-07-01", parent: "00" }),
      "utf8"
    );
  }
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: { nodeId: NODE_ID, presence: { stalenessSeconds: 60 }, relay: { url: "ws://127.0.0.1:7799/ws/relay" } },
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const workspace = await loadWorkspace(repo);
  return { repo, workDir, workspace };
}

// The injected fake transport (the m23 makeFakeTransport idiom): frames delivered
// SYNCHRONOUSLY over the ONE captured handler; close() tracked for the kept-connection
// assertion.
function makeFakeTransport() {
  const calls = { connects: 0, closes: 0 };
  let handler = null;
  return {
    calls,
    deliver(frame) {
      if (handler) handler(frame);
    },
    transport: {
      onMessage(fn) {
        handler = fn;
      },
      async connect() {
        calls.connects += 1;
      },
      close() {
        calls.closes += 1;
      },
    },
  };
}

// A peer's lease-intent frame: the frozen { kind:"lease", nodeId, signal } envelope,
// JSON-serialised as the fanned-out wire frame would be.
function leaseFrame(itemRef, nodeId, state = "claimed", claimedAt = "2026-07-02T11:59:00.000Z") {
  const signal = { itemRef, nodeId, state, claimedAt, runId: null, aofVersion: "0.1.0" };
  return JSON.stringify({ kind: LEASE_SIGNAL_KIND, nodeId, signal });
}

async function seedClaim(workspace, itemRef, nodeId, state = "claimed") {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ itemRef, nodeId, state, claimedAt: "2026-07-02T11:00:00.000Z", runId: null, aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

async function seedPresence(workspace, nodeId, heartbeatAt) {
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(
    presenceRecordPath(workspace, nodeId),
    JSON.stringify({ nodeId, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

// A recursive byte snapshot of a directory tree (absent dir ⇒ {}).
async function snapshotTree(root) {
  const snap = {};
  async function walk(dir, rel) {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(abs, r);
      else snap[r] = await readFile(abs, "utf8");
    }
  }
  await walk(root, "");
  return snap;
}

const cleanup = (dir) => rm(dir, { recursive: true, force: true });

export const relayLeaseFastPathTests = [
  // ══ Scenario: the pushed lease intent rides the frozen envelope with the claim
  //    record as the opaque signal ══
  {
    name: "relay-lease-fastpath/02 the pushed lease intent is EXACTLY { kind:'lease', nodeId, signal } with this node's claim record as the opaque signal, byte-for-byte",
    async run() {
      const fx = await makeRepo();
      try {
        const pushed = [];
        const relayClient = {
          async connect() {
            return { close() {} };
          },
          async push(envelope) {
            pushed.push(envelope);
          },
        };
        // This node claims a ready item; its lease intent is pushed on the claim path.
        // (The non-git fixture syncs as the degraded no-op — the acquire holds.)
        await invoke("work:run-start", { ref: "00/00", now: NOW }, { workspace: fx.workspace, relayClient });

        assert.equal(pushed.length, 1, "exactly one envelope was pushed carrying the intent");
        const envelope = pushed[0];
        assert.deepEqual(Object.keys(envelope), ["kind", "nodeId", "signal"], "the envelope is EXACTLY { kind, nodeId, signal }");
        assert.equal(envelope.kind, "lease", "the envelope carries kind lease");
        assert.equal(envelope.nodeId, NODE_ID, "the envelope carries this node's nodeId");
        // The opaque signal is this node's claim record for the item, byte-for-byte
        // (as it stood at push time — runId null, tied after the mint).
        const expected = { itemRef: "00/00", nodeId: NODE_ID, state: "claimed", claimedAt: NOW, runId: null, aofVersion: aofVersion() };
        assert.equal(JSON.stringify(envelope.signal), JSON.stringify(expected), "the signal is the claim record, byte-for-byte");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: a peer's lease intent heard over the relay defers this node's next
  //    before any git sync ══
  {
    name: "relay-lease-fastpath/02 a peer's lease intent heard over the relay defers this node's next BEFORE any git sync — the item is skipped and the next actionable offered",
    async run() {
      const fx = await makeRepo();
      try {
        // ONE shared cache instance: the subscriber applies into it; work:next overlays it.
        const leaseCache = createLeaseCache();
        const fake = makeFakeTransport();
        await startPresenceSubscriber({ transport: fake.transport, cache: createPresenceCache(), leaseCache });

        // No git sync has run (the fixture is not even a git repo) — the disk is
        // unleased. Snapshot the work tree to prove the skip produced zero bytes.
        const before = await snapshotTree(fx.workDir);

        // The injected transport delivers a fanned-out { kind:"lease" } frame carrying
        // a peer's claim intent for story-a.
        fake.deliver(leaseFrame("00/00", "node-b"));

        const result = await invoke("work:next", { now: NOW }, { workspace: fx.workspace, leaseCache });

        assert.equal(result.state, "ready", "next still offers a ready item");
        assert.notEqual(result.ref, "00/00", "the intent-claimed item is not offered (deferred to the peer)");
        assert.equal(result.ref, "00/01", "the next actionable item is offered instead");
        assert.deepEqual(await snapshotTree(fx.workDir), before, "no git sync / no write produced the skip — the defer arrived purely over the relay");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: a newer lease signal for the same item supersedes the older —
  //    one entry per itemRef ══
  {
    name: "relay-lease-fastpath/02 a newer lease signal for the same item supersedes the older — exactly one entry per itemRef, other items untouched",
    async run() {
      const leaseCache = createLeaseCache();
      const fake = makeFakeTransport();
      await startPresenceSubscriber({ transport: fake.transport, cache: createPresenceCache(), leaseCache });

      // An earlier intent for item X and one for item Y. The baseline is CLONED — a
      // reference to the cache's own object would let an in-place mutation pass the
      // deepEqual unnoticed (QA W3).
      fake.deliver(leaseFrame("00/00", "node-b", "claimed", "2026-07-02T11:00:00.000Z"));
      fake.deliver(leaseFrame("00/01", "node-c", "claimed", "2026-07-02T11:00:00.000Z"));
      const yBefore = structuredClone(leaseCache.get("00/01"));

      // A newer signal for the SAME item X supersedes.
      fake.deliver(leaseFrame("00/00", "node-d", "claimed", "2026-07-02T11:30:00.000Z"));

      assert.equal(leaseCache.ids().filter((id) => id === "00/00").length, 1, "exactly one entry for the item");
      assert.equal(leaseCache.get("00/00").nodeId, "node-d", "the entry reflects the newer signal (latest wins)");
      assert.equal(leaseCache.get("00/00").claimedAt, "2026-07-02T11:30:00.000Z", "the newer signal's stamp is the cached one");
      assert.deepEqual(leaseCache.get("00/01"), yBefore, "every other item's entry is untouched by the apply");
      assert.equal(leaseCache.size, 2, "one entry per itemRef across the two items");
    },
  },

  // ══ Scenario: applying lease frames writes nothing durable ══
  {
    name: "relay-lease-fastpath/02 applying lease frames writes NOTHING durable — the partition root is byte-unchanged and no lease file appears on disk",
    async run() {
      const fx = await makeRepo();
      try {
        // A clean working tree under the partition root (seed one presence record so
        // the root exists and the byte-compare is non-vacuous).
        await seedPresence(fx.workspace, NODE_ID, NOW);
        const before = await snapshotTree(fx.repo);

        const leaseCache = createLeaseCache();
        const fake = makeFakeTransport();
        await startPresenceSubscriber({ transport: fake.transport, cache: createPresenceCache(), leaseCache });

        // Several lease frames for different items and peers.
        fake.deliver(leaseFrame("00/00", "node-b"));
        fake.deliver(leaseFrame("00/01", "node-c"));
        fake.deliver(leaseFrame("00", "node-d"));

        assert.deepEqual(await snapshotTree(fx.repo), before, "every file under the partition root (and the whole fixture) is byte-unchanged after the applies");
        assert.ok(!existsSync(path.join(meshDir(fx.workspace), "leases")), "no new lease file appeared on disk (the intents live in memory only)");
        assert.equal(leaseCache.size, 3, "the intents landed in the in-memory cache (the applies were not vacuous)");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario Outline: a bad inbound frame is ignored — never a crash, never a
  //    corrupted lease view ══
  {
    name: "relay-lease-fastpath/02 a bad inbound frame (malformed / kind-less / unknown-kind / oversized / non-object signal / no-itemRef) is ignored — never a crash, the connection kept, the applied intent unchanged",
    async run() {
      const leaseCache = createLeaseCache();
      const fake = makeFakeTransport();
      const sub = await startPresenceSubscriber({ transport: fake.transport, cache: createPresenceCache(), leaseCache });
      assert.equal(sub.connected, true, "the subscriber is connected");

      // A peer's valid lease intent is already applied. The baseline is CLONED — a
      // reference to the cache's own object would let an in-place mutation pass the
      // deepEqual unnoticed (QA W3).
      fake.deliver(leaseFrame("00/00", "node-b"));
      const applied = structuredClone(leaseCache.get("00/00"));
      assert.ok(applied != null, "the valid intent was applied");

      const badFrames = [
        ["a malformed non-JSON frame", "{{not json"],
        ["a frame missing the kind field", JSON.stringify({ nodeId: "node-x", signal: { itemRef: "00/01" } })],
        ["a frame with an unknown kind", JSON.stringify({ kind: "gossip", nodeId: "node-x", signal: { itemRef: "00/01" } })],
        ["an oversized frame over the byte limit", `"${"x".repeat(DEFAULT_MAX_FRAME_BYTES + 1)}"`],
        ["a lease frame whose signal is not an object", JSON.stringify({ kind: "lease", nodeId: "node-x", signal: "not-an-object" })],
        ["a lease frame whose signal has no itemRef", JSON.stringify({ kind: "lease", nodeId: "node-x", signal: { nodeId: "node-x", state: "claimed" } })],
      ];
      for (const [label, frame] of badFrames) {
        assert.doesNotThrow(() => fake.deliver(frame), `${label} does not crash the subscriber`);
        assert.equal(fake.calls.closes, 0, `${label}: the persistent connection is kept`);
        assert.deepEqual(leaseCache.get("00/00"), applied, `${label}: the previously-applied lease intent is unchanged`);
        assert.equal(leaseCache.size, 1, `${label}: the lease view is not corrupted (no ghost entry)`);
      }
    },
  },

  // ══ Scenario: a cache entry can never unlease a disk lease — the durable claim wins ══
  {
    name: "relay-lease-fastpath/02 a cache entry can never UNLEASE a disk lease — a released-state frame changes nothing, the item stays skipped on the disk evidence",
    async run() {
      const fx = await makeRepo();
      try {
        // A peer's LIVE claim is on this node's disk (git-synced), presence fresh.
        await seedClaim(fx.workspace, "00/00", "node-b", "claimed");
        await seedPresence(fx.workspace, "node-b", NOW);

        const leaseCache = createLeaseCache();
        const fake = makeFakeTransport();
        await startPresenceSubscriber({ transport: fake.transport, cache: createPresenceCache(), leaseCache });
        // A frame for the same item suggesting the claim is gone (a released signal).
        fake.deliver(leaseFrame("00/00", "node-b", "released"));

        const result = await invoke("work:next", { now: NOW }, { workspace: fx.workspace, leaseCache });
        assert.equal(result.ref, "00/01", "the item is still not offered — the disk lease wins (the cache can only add a skip, never remove one)");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },

  // ══ Scenario: a cached intent never becomes a lease of record ══
  {
    name: "relay-lease-fastpath/02 a cached intent never becomes a lease of record — with no disk claim the durable view stays unleased; the intent's only effect is the advisory skip",
    async run() {
      const fx = await makeRepo();
      try {
        const leaseCache = createLeaseCache();
        const fake = makeFakeTransport();
        await startPresenceSubscriber({ transport: fake.transport, cache: createPresenceCache(), leaseCache });
        fake.deliver(leaseFrame("00/00", "node-b"));

        // The item's DURABLE lease state, read off disk: no claim file exists, so the
        // durable view reads unleased — the cached intent granted nothing durable.
        const diskClaims = await readItemClaims(fx.workspace, "00/00");
        assert.deepEqual(diskClaims, [], "no claim file for the item exists on disk");
        const durableView = buildLeaseView(diskClaims, new Map(), { nowMs: Date.parse(NOW), thresholdMs: 60_000 });
        assert.ok(!durableView.has("00/00"), "the durable view reads unleased (the cached intent granted nothing durable)");

        // The cached intent's ONLY effect is the advisory skip in this node's next.
        const withCache = await invoke("work:next", { now: NOW }, { workspace: fx.workspace, leaseCache });
        assert.equal(withCache.ref, "00/01", "the cached intent's only effect is the advisory skip");
        const withoutCache = await invoke("work:next", { now: NOW }, { workspace: fx.workspace });
        assert.equal(withoutCache.ref, "00/00", "without the cache the durable view offers the item (nothing durable was granted)");
      } finally {
        await cleanup(fx.repo);
      }
    },
  },
];
