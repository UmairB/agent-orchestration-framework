// Traceability wiring for milestone 23 / story 00 — mesh:heartbeat assembles and
// publishes this node's presence record (tasks/00_presence-record.feature).
//
// Covers EVERY @executable scenario in tasks/00_presence-record.feature, exercising
// the REAL in-process registry (src/command-core.mjs + src/commands/mesh-heartbeat.mjs
// over src/mesh-presence.mjs + the m22 src/mesh-store.mjs presence seam) against a temp
// fixture repo — loadWorkspace + invoke, real fs, in-process. One test object per
// @executable scenario, each name tracing to feature + scenario. node:assert/strict.
//
//   00_presence-record.feature — mesh:heartbeat publishes THIS node's presence record
//     (the frozen { nodeId, heartbeatAt, activeRuns, aofVersion } schema, byte-equivalent
//     on read-back); activeRuns is READ from the run records (exactly the running runs,
//     no queued/terminal, never a run-record mutation); the record is a rebuildable
//     projection of the clock + run records; a republish bumps heartbeatAt, keeps nodeId
//     stable, and leaves a peer's presence record byte-untouched. Git alone, no relay.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, presenceRecordPath } from "../src/mesh-store.mjs";

// milestone 38 / story 00 (ADR-001) — the presence record grows ADDITIVELY to FIVE
// keys (`sessions` inserted before the trailing `aofVersion`); mesh:heartbeat does
// not yet read session records, so it always emits `sessions: []` (absent-is-benign)
// — the m23 four keys keep their relative order and their VALUES stay byte-identical.
const FROZEN_KEYS = ["nodeId", "heartbeatAt", "activeRuns", "sessions", "aofVersion"];
const NODE_ID = "test-node-a";

// A fixture repo whose config PINS mesh.nodeId (so the resolved id is stable + known)
// and whose work stream is a single milestone the test controls. The mesh.nodeId pin
// means deriveNodeId returns it verbatim — heartbeat and identity share the same id.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-presence-"));
  const workDir = path.join(repo, "wiki", "work");
  const milestoneDir = path.join(workDir, "23_milestone_control-node-relay");
  await mkdir(milestoneDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { nodeId: NODE_ID } }, null, 2)}\n`,
    "utf8"
  );
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    `---\ntype: milestone\nnumber: 23\nslug: control-node-relay\nstatus: in-progress\ntitle: "Control Node Relay"\ncreated: 2026-06-30\nupdated: 2026-06-30\n---\n# 23\n`,
    "utf8"
  );
  return { repo, workDir, milestoneDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

// Seed a run record directly under the milestone's runs/ dir (the run-store path seam),
// in the given state. A direct write so the test controls the exact run set.
async function seedRun(milestoneDir, runId, state, createdAt = "2026-06-29T00:00:00.000Z") {
  const runsDir = path.join(milestoneDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const record = {
    runId, itemRef: "23", state, attempt: 1, outcome: state === "running" || state === "queued" ? null : state,
    sessionId: null, brief: {}, createdAt, updatedAt: createdAt,
    failureReason: null, heartbeatAt: null, retryOf: null, reclaimedAt: null,
  };
  await writeFile(path.join(runsDir, `${runId}.json`), JSON.stringify(record, null, 2), "utf8");
  return path.join(runsDir, `${runId}.json`);
}

// Seed a peer's presence record directly through the store seam (a peer that synced in).
async function seedPeerPresence(workspace, id) {
  const record = { nodeId: id, heartbeatAt: "2026-06-29T00:00:00.000Z", activeRuns: [], aofVersion: "0.1.0" };
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(presenceRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
  return record;
}

export const meshPresenceRecordTests = [
  // ══ Scenario: mesh:heartbeat publishes this node's presence record with the complete frozen schema ══
  {
    name: "mesh-presence-record/00 mesh:heartbeat publishes this node's presence record with the complete frozen schema",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // Given this node has no running runs → When I invoke mesh:heartbeat.
        const record = await invoke("mesh:heartbeat", { now: "2026-06-30T10:00:00.000Z" }, ctx);
        // A presence record for this node's id is persisted under the presence seam.
        const onDiskPath = presenceRecordPath(ctx.workspace, NODE_ID);
        assert.ok(onDiskPath.startsWith(meshDir(ctx.workspace)), "persisted under the partition root's presence seam");
        const onDisk = await readFile(onDiskPath, "utf8");
        // The frozen schema, all keys present, in order, no extras.
        assert.deepEqual(Object.keys(record), FROZEN_KEYS, "carries no keys beyond the frozen schema (in order)");
        assert.equal(record.nodeId, NODE_ID, "nodeId equals this node's mesh.nodeId");
        // heartbeatAt is an ISO-8601 UTC-Z instant.
        assert.match(record.heartbeatAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "heartbeatAt is ISO-8601 UTC-Z");
        assert.deepEqual(record.activeRuns, [], "activeRuns is an empty list");
        assert.deepEqual(record.sessions, [], "sessions is the empty array (mesh:heartbeat reads no session records) — present, not omitted");
        assert.equal(typeof record.aofVersion, "string", "aofVersion is a string");
        assert.ok(record.aofVersion.length > 0, "aofVersion is non-empty");
        // 1c — the m23 FOUR-KEY projection (nodeId, heartbeatAt, activeRuns,
        // aofVersion) is byte-identical to a HAND-BUILT m23 record for the same
        // values, asserted directly here (not merely inherited from the separate
        // acd-session-presence-additive arch-test) — the ADR-001 freeze.
        const m23HandBuilt = { nodeId: record.nodeId, heartbeatAt: record.heartbeatAt, activeRuns: record.activeRuns, aofVersion: record.aofVersion };
        assert.equal(
          JSON.stringify(m23HandBuilt),
          JSON.stringify({ nodeId: NODE_ID, heartbeatAt: record.heartbeatAt, activeRuns: [], aofVersion: record.aofVersion }),
          "the four m23 keys are byte-identical to a hand-built m23 record",
        );
        // The persisted record is byte-equivalent to the returned record.
        assert.equal(onDisk, JSON.stringify(record, null, 2), "persisted record byte-equivalent to returned");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:heartbeat reads activeRuns from the run records and lists exactly the in-flight run ids ══
  {
    name: "mesh-presence-record/00 mesh:heartbeat reads activeRuns from the run records and lists exactly the in-flight run ids",
    async run() {
      const { repo, milestoneDir } = await makeRepo();
      try {
        // Three running runs, one queued, one terminal (done).
        await seedRun(milestoneDir, "run-a1", "running");
        await seedRun(milestoneDir, "run-b2", "running");
        await seedRun(milestoneDir, "run-c3", "running");
        await seedRun(milestoneDir, "run-q0", "queued");
        await seedRun(milestoneDir, "run-z9", "done");
        const ctx = await ctxFor(repo);
        const record = await invoke("mesh:heartbeat", { now: "2026-06-30T10:00:00.000Z" }, ctx);
        // activeRuns lists EXACTLY the three running runs (no extras, none dropped).
        assert.deepEqual([...record.activeRuns].sort(), ["run-a1", "run-b2", "run-c3"], "activeRuns lists exactly the three running runs");
        assert.ok(!record.activeRuns.includes("run-q0"), "does not list the queued run");
        assert.ok(!record.activeRuns.includes("run-z9"), "does not list the terminal run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: publishing presence reads the run records without mutating them ══
  {
    name: "mesh-presence-record/00 publishing presence reads the run records without mutating them",
    async run() {
      const { repo, milestoneDir } = await makeRepo();
      try {
        const runPath = await seedRun(milestoneDir, "run-a1", "running");
        const before = await readFile(runPath, "utf8");
        const ctx = await ctxFor(repo);
        const record = await invoke("mesh:heartbeat", { now: "2026-06-30T10:00:00.000Z" }, ctx);
        assert.ok(record.activeRuns.includes("run-a1"), "activeRuns lists run-a1");
        // The run record on disk is byte-identical to before the heartbeat (a READ).
        assert.equal(await readFile(runPath, "utf8"), before, "run-a1 run record byte-identical after the heartbeat");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the presence record is a rebuildable projection of the clock and the run records ══
  {
    name: "mesh-presence-record/00 the presence record is a rebuildable projection of the clock and the run records",
    async run() {
      const { repo, milestoneDir } = await makeRepo();
      try {
        await seedRun(milestoneDir, "run-a1", "running");
        const ctx = await ctxFor(repo);
        const instant = "2026-06-30T10:00:00.000Z";
        const first = await invoke("mesh:heartbeat", { now: instant }, ctx);
        // Re-derive from the SAME injected instant + the SAME run records.
        const second = await invoke("mesh:heartbeat", { now: instant }, await ctxFor(repo));
        assert.deepEqual(second, first, "the second record is content-equivalent to the first (a deterministic projection)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: republishing presence bumps heartbeatAt, keeps nodeId stable, leaves a peer's presence byte-untouched ══
  {
    name: "mesh-presence-record/00 republishing presence bumps heartbeatAt, keeps nodeId stable, and leaves a peer's presence record byte-untouched",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        const first = await invoke("mesh:heartbeat", { now: "2026-06-30T10:00:00.000Z" }, ctx);
        // A peer presence record exists in the tree; record its on-disk bytes.
        await seedPeerPresence(ctx.workspace, "umair-mbp");
        const peerPath = presenceRecordPath(ctx.workspace, "umair-mbp");
        const peerBefore = await readFile(peerPath, "utf8");
        // Republish with a LATER injected instant.
        const second = await invoke("mesh:heartbeat", { now: "2026-06-30T10:05:00.000Z" }, await ctxFor(repo));
        assert.equal(second.nodeId, first.nodeId, "nodeId is unchanged");
        assert.ok(Date.parse(second.heartbeatAt) > Date.parse(first.heartbeatAt), "heartbeatAt is strictly after the previous");
        // Still exactly one presence record file for this node's id.
        const files = await readdir(path.join(meshDir(ctx.workspace), "presence"));
        assert.equal(files.filter((f) => f === `${NODE_ID}.json`).length, 1, "exactly one presence record file for this node's id");
        // The peer presence record on disk is byte-identical to before the republish.
        assert.equal(await readFile(peerPath, "utf8"), peerBefore, "peer presence record byte-identical after the republish");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
