// Traceability wiring for milestone 33 / story 01 — the fabric-liveness cutover.
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/01_fabric-liveness-cutover.feature: mergePresence reconciling a disk record
// against a fabric-liveness value (git wins a tie); mesh:status sourcing a live
// candidate off the fabric Online pre-filter (via ctx.fabricPeers, INJECTED exactly as
// ctx.relayClient is); resolvePeerReachability's Online-≠-dialable handled outcomes
// (reachable / unreachable / offline) over an injected dial closure — PLUS (review
// Fix 3) the honest "online (undialed)" outcome when NO dialer is injected at all
// (never silently assumed "reachable" without a probe); the presence record
// assembly/read staying byte-unchanged; the unconfigured-mesh no-fabric-read floor.
// One test object per @executable scenario (Scenario-Outline rows folded into one
// entry iterating the rows). node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, presenceRecordPath, nodeRecordPath, publishNodeRecord } from "../src/mesh-store.mjs";
import {
  mergePresence,
  resolvePeerReachability,
  assemblePresenceRecord,
  publishPresenceRecord,
  readPresenceRecord,
} from "../src/mesh-presence.mjs";

const NOW = "2026-07-04T10:00:00.000Z";

async function makeRepo({ configureFabric = true } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-fabric-liveness-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = {
    name: "fixture",
    work: { dir: "./wiki/work" },
    mesh: configureFabric ? { nodeId: "test-node-self", fabric: "tailscale" } : {},
  };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo, extra = {}) => ({ workspace: await loadWorkspace(repo), ...extra });
const nodeOf = (result, id) => result.nodes.find((n) => n.nodeId === id);

async function seedPeer(workspace, id) {
  const record = { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" };
  await publishNodeRecord(workspace, id, record);
  return record;
}

export const meshFabricLivenessCutoverTests = [
  {
    // m42 wave (b) / m38-F23 — THE MEASURED DEFECT, flipped green: fabricLivenessFor
    // rebuilt a four-key pseudo record with heartbeatAt=now, which always won the
    // merge, so `sessions` was DESTROYED for every fabric-ONLINE node on every tick —
    // the desktop fleet read `idle` during live work, and the feature only worked
    // while the fabric believed the node was OFFLINE. Liveness must SHARPEN the
    // heartbeat, never rebuild the record.
    name: "mesh-fabric-liveness-cutover/m42-F23 an ONLINE node's sessions survive the fabric-liveness merge — liveness sharpens the heartbeat, never rebuilds the record",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ws = await loadWorkspace(repo);
        await seedPeer(ws, "peer-live");
        // The disk record is OLDER than `now` (the destructive path: the fabric
        // pseudo-record wins the merge) and carries a live session.
        const older = new Date(Date.parse(NOW) - 30_000).toISOString();
        await publishPresenceRecord(ws, "peer-live", assemblePresenceRecord({
          nodeId: "peer-live",
          heartbeatAt: older,
          activeRuns: ["42"],
          sessions: [{ workspaceId: "ws-1", repo: "let-shield-portal", assistant: "claude", lastPingAt: older }],
          aofVersion: "0.1.0",
        }));

        const fabricPeers = [{ nodeId: "peer-live", dialAddress: "100.90.11.5", online: true, host: "peer-live" }];
        const result = await invoke("mesh:status", { now: NOW }, { workspace: ws, fabricPeers });
        const peer = nodeOf(result, "peer-live");
        assert.ok(peer?.presence, "the online node carries a presence projection");
        assert.equal(peer.presence.sessions.length, 1, "sessions SURVIVE the liveness merge for an ONLINE node (F23: they were destroyed on every tick)");
        assert.equal(peer.presence.sessions[0].repo, "let-shield-portal", "the surviving session is the disk record's own, verbatim");
        assert.deepEqual(peer.presence.activeRuns, ["42"], "activeRuns still ride through (the pre-fix carve-out keeps working)");
        assert.equal(peer.presence.heartbeatAt, NOW, "…while liveness still sharpened the heartbeat to now (the fabric's one legitimate contribution)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  // ══ Scenario Outline: mergePresence reconciles the git-disk record against the
  //    fabric peer-map liveness, git authority preserved on a tie ══
  {
    name: "mesh-fabric-liveness-cutover/01 mergePresence reconciles the git-disk record against the fabric peer-map liveness, git authority preserved on a tie (Scenario Outline, folded)",
    async run() {
      const disk = { nodeId: "umairs-mbp", heartbeatAt: "2026-07-04T10:00:00.000Z", activeRuns: ["run-disk"], aofVersion: "0.1.0" };
      const fabricNewer = { nodeId: "umairs-mbp", heartbeatAt: "2026-07-04T10:00:05.000Z", activeRuns: [], aofVersion: "" };
      const fabricEqual = { nodeId: "umairs-mbp", heartbeatAt: "2026-07-04T10:00:00.000Z", activeRuns: [], aofVersion: "" };

      // yes / yes / yes → fabric
      assert.deepEqual(mergePresence(disk, fabricNewer), fabricNewer, "disk present + fabric online + strictly newer ⇒ fabric wins");
      // yes / yes / no (equal) → disk
      assert.deepEqual(mergePresence(disk, fabricEqual), disk, "disk present + fabric online + equal/older ⇒ disk wins (git authority)");
      // no / yes / n/a → fabric
      assert.deepEqual(mergePresence(null, fabricNewer), fabricNewer, "no disk record + fabric online ⇒ fabric is all we have");
      // yes / no signal / n/a → disk
      assert.deepEqual(mergePresence(disk, null), disk, "disk present + no fabric signal ⇒ disk wins (the git-only floor)");
    },
  },

  // ══ Scenario: an Online peer from the fabric peer-map is rendered a live candidate
  //    without a git sync ══
  {
    name: "mesh-fabric-liveness-cutover/01 an Online peer from the fabric peer-map is rendered a live candidate without a git sync",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ws = await loadWorkspace(repo);
        // resolvePeers reports "peer-b" online true — injected via ctx.fabricPeers
        // (mirroring ctx.relayClient), so mesh:status is exercised with NO tailnet.
        const fabricPeers = [{ nodeId: "peer-b", dialAddress: "100.90.11.5", online: true, host: "peer-b" }];
        const result = await invoke("mesh:status", { now: NOW }, { workspace: ws, fabricPeers });
        const peer = nodeOf(result, "peer-b");
        assert.ok(peer, "peer-b surfaces in mesh:status (sourced purely from the fabric Online pre-filter)");
        assert.ok(peer.presence, "peer-b carries a presence projection");
        assert.equal(peer.stale, false, "peer-b is a live candidate (no git sync required)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: an Online-but-refused dial is a handled "unreachable" outcome
  //    distinct from "offline" ══
  {
    name: 'mesh-fabric-liveness-cutover/01 an Online-but-refused dial is a handled "unreachable" outcome distinct from "offline" (Scenario Outline, folded)',
    async run() {
      const rows = [
        { online: true, dial: async () => {}, outcome: "reachable" },
        { online: true, dial: async () => { const e = new Error("refused"); e.code = "ECONNREFUSED"; throw e; }, outcome: "unreachable (check shields-up/ACL)" },
        { online: false, dial: async () => { throw new Error("must not be called"); }, outcome: "offline" },
      ];
      for (const row of rows) {
        let dialCalled = false;
        const dial = async (addr) => {
          dialCalled = true;
          return row.dial(addr);
        };
        let outcome;
        await assert.doesNotReject(async () => {
          outcome = await resolvePeerReachability(row.online, "100.90.11.5", { dial });
        }, `[online:${row.online}] resolving reachability never throws`);
        assert.equal(outcome, row.outcome, `[online:${row.online}] the handled outcome matches`);
        if (row.online === false) {
          assert.equal(dialCalled, false, "an offline peer is never dialed");
        }
      }
    },
  },

  // ══ REGRESSION (review Fix 3): with NO injected dialer, an Online peer must NEVER
  //    resolve to "reachable" — that would assert a probe that never ran. It resolves
  //    to the honest, distinct "online (undialed)" outcome instead ══
  {
    name: 'mesh-fabric-liveness-cutover/01 REGRESSION: with no injected dialer, an Online peer resolves to the honest "online (undialed)" outcome, NEVER "reachable" without a probe',
    async run() {
      const outcome = await resolvePeerReachability(true, "100.90.11.5", {});
      assert.notEqual(outcome, "reachable", "an absent dialer must never be treated as a resolved probe");
      assert.equal(outcome, "online (undialed)", 'the honest outcome names the peer Online but undialed');

      // Also true when options itself is entirely omitted.
      const outcomeNoOptions = await resolvePeerReachability(true, "100.90.11.5");
      assert.equal(outcomeNoOptions, "online (undialed)", "the same honest outcome holds when options is omitted entirely");

      // offline still short-circuits before any dialer concern, dialer or not.
      assert.equal(await resolvePeerReachability(false, "100.90.11.5"), "offline", "offline is unaffected by dialer presence/absence");
    },
  },

  // ══ Scenario: the git presence record assembly and read-back are byte-unchanged by
  //    the liveness cutover ══
  {
    name: "mesh-fabric-liveness-cutover/01 the git presence record assembly and read-back are byte-unchanged by the liveness cutover",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ws = await loadWorkspace(repo);
        const record = assemblePresenceRecord({ nodeId: "node-a", heartbeatAt: "2026-07-04T10:05:00.000Z", activeRuns: [], aofVersion: "0.1.0" });
        // milestone 38 / story 00 (ADR-001) — the presence record grows ADDITIVELY to
        // FIVE keys (`sessions` inserted before `aofVersion`); this call site supplies
        // no sessions, so it emits sessions:[] (absent-is-benign) and the ORIGINAL
        // four keys' relative order and values are unchanged.
        assert.deepEqual(Object.keys(record), ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion"], "the record carries EXACTLY the frozen five keys in order (sessions additive)");
        assert.deepEqual(record.sessions, [], "sessions is the empty array — this call site reads no session records");
        await publishPresenceRecord(ws, "node-a", record);
        const written = await readFile(presenceRecordPath(ws, "node-a"), "utf8");
        const readBack = await readPresenceRecord(ws, "node-a");
        assert.deepEqual(readBack, record, "the read-back is content-equivalent to the written record");
        assert.equal(written, `${JSON.stringify(record, null, 2)}`, "the durable floor's bytes are the frozen pretty-JSON form, unchanged by the cutover");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: an unconfigured mesh renders git-only presence with no fabric read
  //    attempted ══
  {
    name: "mesh-fabric-liveness-cutover/01 an unconfigured mesh renders git-only presence with no fabric read attempted",
    async run() {
      const { repo } = await makeRepo({ configureFabric: false });
      try {
        const ws = await loadWorkspace(repo);
        await seedPeer(ws, "peer-git");
        await publishPresenceRecord(ws, "peer-git", assemblePresenceRecord({ nodeId: "peer-git", heartbeatAt: NOW, activeRuns: [], aofVersion: "0.1.0" }));
        // NO ctx.fabricPeers injected AND no config.mesh.fabric declared — resolvePeers
        // must never be reached (production would call the real execFile("tailscale")
        // otherwise; this asserts the render never attempts it by asserting the render
        // is exactly the git-only floor).
        const result = await invoke("mesh:status", { now: NOW }, { workspace: ws });
        const peer = nodeOf(result, "peer-git");
        assert.ok(peer && peer.presence, "presence renders from the synced git presence records");
        assert.equal(peer.presence.heartbeatAt, NOW, "the git-durable heartbeat is rendered, byte-identical to the pre-cutover behaviour");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
