// Traceability wiring for milestone 33 / story 01 — the ws@8 broker retires as the
// liveness transport (tasks/02_broker-retirement.feature, ADR-002.1/.4/.consequence).
//
// Covers the feature's THREE dedicated @executable scenarios (the reused-guard
// Scenario Outline is @executable-by-construction — covered by simply running the
// named arch-tests themselves, not re-implemented here per the feature's own SEAM
// SPLIT note). Exercises the REAL production functions — invoke("mesh:status", …)
// over src/commands/mesh-identity.mjs, src/mesh-fabric.mjs's resolvePeers-shaped
// fixture injection (ctx.fabricPeers, task 01's cutover seam), and src/mesh-store.mjs
// — against a temp fixture repo. No mock/spy of src/mesh-relay.mjs; the "broker never
// started" proof is TWO real facts: (a) a static source-import check (this test's own
// file never imports mesh-relay.mjs, and neither does mesh-identity.mjs — confirmed by
// reading the actual source, not asserting a belief) and (b) mesh:status is driven to
// a FULLY POPULATED render using ONLY the fabric+git seams, with no relay/registry
// enrollment call ever made in this test's own control flow.
//
//   02_broker-retirement.feature —
//     - a node's presence/liveness view is fully populated with the broker never
//       started: mesh:status renders every synced peer + its fabric-sourced liveness,
//       with serveRelay/mesh-presence-subscriber/mesh-presence-cache never in the path;
//     - a peer's liveness is visible with NO device-code enrollment / ws upgrade
//       auth-gate — tailnet membership is the sole admission boundary;
//     - with neither broker nor fabric configured, presence still renders from the
//       reused git floor (no data lost by the broker's removal).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { publishPresenceRecord } from "../src/mesh-presence.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MESH_IDENTITY = path.join(repoRoot, "src", "commands", "mesh-identity.mjs");

async function makeRepo({ fabricConfigured = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-broker-retirement-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: fabricConfigured ? { nodeId: "test-node-self", fabric: "tailscale" } : {},
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return repo;
}

async function seedNode(workspace, id) {
  const record = { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" };
  await publishNodeRecord(workspace, id, record);
  return record;
}

const cleanup = (repo) => rm(repo, { recursive: true, force: true });
const NOW = "2026-07-04T10:00:00.000Z";
const nodeOf = (result, id) => result.nodes.find((n) => n.nodeId === id);

export const meshBrokerRetirementTests = [
  // ══ Scenario: a node's presence and liveness view is fully populated with the
  //    broker never started ══
  {
    name: "mesh-broker-retirement/02 a node's presence and liveness view is fully populated with the broker never started",
    async run() {
      const repo = await makeRepo();
      try {
        const ws = await loadWorkspace(repo);
        await seedNode(ws, "umairs-mbp");
        await seedNode(ws, "build-linux");

        // resolvePeers reports "umairs-mbp" online true and "build-linux" online false —
        // injected via ctx.fabricPeers (task 01's cutover seam), exactly the shape
        // src/mesh-fabric.mjs's resolvePeers returns. NO serveRelay import, NO ws
        // client, NO relay setup exists anywhere in this test's control flow.
        const fabricPeers = [
          { nodeId: "umairs-mbp", dialAddress: "100.90.11.5", online: true, host: "umairs-mbp" },
          { nodeId: "build-linux", dialAddress: "100.70.22.9", online: false, host: "build-linux" },
        ];
        const result = await invoke("mesh:status", { now: NOW }, { workspace: ws, fabricPeers });

        // The status lists both peers from the synced roster.
        assert.ok(nodeOf(result, "umairs-mbp") != null, 'the status lists "umairs-mbp" from the synced roster');
        assert.ok(nodeOf(result, "build-linux") != null, 'the status lists "build-linux" from the synced roster');

        // Each peer's liveness is sourced from the fabric peer-map: umairs-mbp live
        // (Online pre-filter, no git sync needed), build-linux offline (Online:false).
        const mbp = nodeOf(result, "umairs-mbp");
        assert.ok(mbp.presence != null, "umairs-mbp carries a presence projection sourced from the fabric");
        assert.equal(mbp.stale, false, "umairs-mbp is rendered live (fabric Online pre-filter)");
        // build-linux has NO disk presence and Online:false ⇒ mergePresence(null, null)
        // ⇒ null ⇒ the "no presence" branch (never falsely rendered live).
        const linux = nodeOf(result, "build-linux");
        assert.equal(linux.presence, undefined, "build-linux carries no presence (the fabric never reported it Online, and no git sync ran)");
        assert.equal(linux.stale, false, 'build-linux is "no presence", not stale (you can only be stale once you have beat)');

        // No relay subscriber connection was opened and no relay cache was consulted —
        // structurally true because those modules are DELETED (src/mesh-presence-
        // subscriber.mjs, src/mesh-presence-cache.mjs no longer exist on disk), so this
        // test's own successful invoke() proves no such import was reachable at all.
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ Scenario: a peer's liveness is visible without any device-code enrollment or ws
  //    upgrade auth-gate ══
  {
    name: "mesh-broker-retirement/02 a peer's liveness is visible without any device-code enrollment or ws upgrade auth-gate",
    async run() {
      const repo = await makeRepo();
      try {
        const ws = await loadWorkspace(repo);
        // Peer "umairs-mbp" was never enrolled via a device code and holds no relay
        // credential — the fixture never calls mesh:invite/mesh:join, never writes a
        // registry roster entry, never presents a credential over any ws upgrade. It
        // is on the tailnet and Online per the fabric peer-map alone.
        await seedNode(ws, "umairs-mbp");
        const fabricPeers = [{ nodeId: "umairs-mbp", dialAddress: "100.90.11.5", online: true, host: "umairs-mbp" }];

        const result = await invoke("mesh:status", { now: NOW }, { workspace: ws, fabricPeers });
        const peer = nodeOf(result, "umairs-mbp");
        assert.ok(peer != null, '"umairs-mbp" is rendered');
        assert.ok(peer.presence != null, '"umairs-mbp" is rendered live (fabric Online pre-filter)');
        assert.equal(peer.stale, false, '"umairs-mbp" is rendered live, not stale');

        // No /enroll POST and no ws upgrade auth-gate check was required — no HTTP
        // request, no WebSocket client, no mesh-registry credential read appears
        // anywhere in this test: tailnet membership (the injected fabricPeers Online
        // signal) is the ONLY admission fact consulted.
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ Scenario: with neither broker nor fabric read, presence still renders from the
  //    reused git records ══
  {
    name: "mesh-broker-retirement/02 with neither broker nor fabric read, presence still renders from the reused git records",
    async run() {
      const repo = await makeRepo({ fabricConfigured: false });
      try {
        const ws = await loadWorkspace(repo);
        await seedNode(ws, "peer-git");
        await publishPresenceRecord(ws, "peer-git", { nodeId: "peer-git", heartbeatAt: NOW, activeRuns: ["run-1"], aofVersion: "0.1.0" });

        // No relay broker is started (no serveRelay import anywhere in this test) and
        // config has no fabric configured (config.mesh has no `fabric` key) — NO
        // ctx.fabricPeers injected either, so resolvePeers is never even reachable.
        const result = await invoke("mesh:status", { now: NOW }, { workspace: ws });

        const peer = nodeOf(result, "peer-git");
        assert.ok(peer != null && peer.presence != null, "presence renders from the synced git presence records (the reused durable floor)");
        assert.equal(peer.presence.heartbeatAt, NOW, "the git-durable heartbeat is rendered");
        assert.deepEqual(peer.presence.activeRuns, ["run-1"], "no presence data was lost — the removal of the relay bus lost no presence data (liveness, not data, was ever the relay's job)");
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ══ Structural confirmation (feature's RESOLVED analysis, cited as the reason the
  //    behavioural rows above are reachable at all): mesh:status's home module
  //    (mesh-identity.mjs) has NO static import of mesh-relay.mjs / mesh-relay-
  //    client.mjs — the retired subscriber/cache modules no longer exist on disk at
  //    all. A real source read, not an assertion of belief. ══
  {
    name: "mesh-broker-retirement/02 mesh:status's home module imports NO relay/broker module — the broker is structurally unreachable from the liveness render",
    async run() {
      const source = await readFile(MESH_IDENTITY, "utf8");
      const importSpecifiers = [...source.matchAll(/\bfrom\s+["']([^"']+)["']/g)].map((m) => m[1]);
      assert.ok(!importSpecifiers.some((s) => /mesh-relay(-client)?\.mjs$/.test(s)), "mesh-identity.mjs imports no mesh-relay.mjs / mesh-relay-client.mjs");
      assert.ok(!importSpecifiers.some((s) => /mesh-presence-(subscriber|cache)\.mjs$/.test(s)), "mesh-identity.mjs imports no mesh-presence-subscriber.mjs / mesh-presence-cache.mjs (they no longer exist)");
      // Non-vacuous: the retired modules genuinely do not exist on disk (deleted by
      // this story's task 02) — confirming the import COULD NOT resolve even if written.
      const subscriberPath = path.join(repoRoot, "src", "mesh-presence-subscriber.mjs");
      const cachePath = path.join(repoRoot, "src", "mesh-presence-cache.mjs");
      await assert.rejects(() => readFile(subscriberPath), "src/mesh-presence-subscriber.mjs does not exist on disk (deleted)");
      await assert.rejects(() => readFile(cachePath), "src/mesh-presence-cache.mjs does not exist on disk (deleted)");
    },
  },
];
