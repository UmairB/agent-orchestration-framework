// Traceability wiring for milestone 22 / story 01 — the mesh:identity / mesh:status
// commands.
//
// Covers EVERY @executable scenario in tasks/01_mesh-identity-status-commands.feature,
// exercising the REAL in-process registry (src/command-core.mjs +
// src/commands/mesh-identity.mjs over story 00's src/mesh-store.mjs + story 01's
// src/node-identity.mjs) against a temp fixture repo — loadWorkspace + invoke, real fs,
// in-process. One test object per @executable scenario, each name tracing to feature +
// scenario. node:assert/strict.
//
//   01_mesh-identity-status-commands.feature — the two commands carry the frozen
//     {id,input,run,cli} shape; mesh:identity publishes this node's record (via the
//     store) and reads it back (republish bumps publishedAt, the id is stable, a peer's
//     record is untouched); mesh:status lists the synced roster ({ nodes:[...] }, an
//     empty roster reads as { nodes: [] }, not an error); reads mutate nothing.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { getCommand, invoke } from "../src/command-core.mjs";
import { meshDir, nodeRecordPath, publishNodeRecord } from "../src/mesh-store.mjs";

// 34/story 02 (operator directive): `skills` is REMOVED from the descriptor
// (see assembleDescriptor) — the frozen schema is six keys.
const FROZEN_KEYS = ["nodeId", "host", "os", "runtimes", "aofVersion", "publishedAt"];

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-meshcmd-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: "fixture", runtimes: ["claude", "codex"], work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  // A PER-FIXTURE global home: node records live in the MACHINE-global mesh root
  // (AOF_GLOBAL_HOME), so every test sharing one process-level home leaks its
  // seeds/publishes into the next test's roster (pre-existing at HEAD, verified
  // by stash 2026-07-30 — the file predates the m34 workspace-local → global
  // store move). Each fixture repo now carries its own isolated home, the
  // mesh-ui-global-scope idiom.
  const home = await mkdtemp(path.join(os.tmpdir(), "aof-meshcmd-home-"));
  const env = { ...process.env, AOF_GLOBAL_HOME: home };
  return { repo, workDir, env };
}

const ctxFor = async (repo, env) => ({ workspace: await loadWorkspace(repo, undefined, { env }) });

// Seed a peer node record directly through the store seam (a peer that synced into the
// tree). The record is opaque/as-is, exactly as the store persists.
async function seedPeer(workspace, id, extra = {}) {
  const record = {
    nodeId: id, host: id, os: "linux", runtimes: ["claude"], skills: [],
    aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z", ...extra,
  };
  await publishNodeRecord(workspace, id, record);
  return record;
}

// Snapshot the on-disk bytes of every file under the partition root (for the
// byte-unchanged R4 assertions). Returns a map of relative path → bytes.
async function snapshotTree(workspace) {
  const root = meshDir(workspace);
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

export const meshIdentityStatusCommandsTests = [
  // ══ Scenario: mesh:identity publishes this node's record and returns it ══════
  {
    name: "mesh-identity-status-commands/01 mesh:identity publishes this node's record and returns it",
    async run() {
      const { repo, workDir, env } = await makeRepo();
      try {
        const ctx = await ctxFor(repo, env);
        const record = await invoke("mesh:identity", {}, ctx);
        // The returned record carries the complete frozen schema.
        assert.deepEqual(Object.keys(record), FROZEN_KEYS, "complete frozen schema, in order");
        // A node record for this node's id is persisted under the partition root.
        const onDisk = await readFile(nodeRecordPath(ctx.workspace, record.nodeId), "utf8");
        // The persisted record is byte-equivalent to the returned record.
        assert.equal(onDisk, JSON.stringify(record, null, 2), "persisted record byte-equivalent to returned");
        // The file is under meshDir/nodes/.
        assert.ok(nodeRecordPath(ctx.workspace, record.nodeId).startsWith(meshDir(ctx.workspace)), "under the partition root");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: republishing bumps publishedAt, keeps the id stable, leaves peers untouched ═
  {
    name: "mesh-identity-status-commands/01 republishing through mesh:identity bumps publishedAt, keeps the id stable, and leaves peers untouched",
    async run() {
      const { repo, env } = await makeRepo();
      try {
        const ctx = await ctxFor(repo, env);
        const first = await invoke("mesh:identity", {}, ctx);
        // A peer record exists in the tree; record its on-disk bytes.
        await seedPeer(ctx.workspace, "umair-mbp");
        const peerPath = nodeRecordPath(ctx.workspace, "umair-mbp");
        const peerBefore = await readFile(peerPath, "utf8");
        await new Promise((resolve) => setTimeout(resolve, 2));
        // Republish this node (config now carries the persisted id → stable).
        const ctx2 = await ctxFor(repo, env);
        const second = await invoke("mesh:identity", {}, ctx2);
        assert.equal(second.nodeId, first.nodeId, "the node id is unchanged");
        assert.ok(Date.parse(second.publishedAt) >= Date.parse(first.publishedAt), "publishedAt at or after the previous publish");
        // Still exactly one record file for this node's id.
        const files = await readdir(path.join(meshDir(ctx2.workspace), "nodes"));
        const own = files.filter((f) => f === `${first.nodeId}.json`);
        assert.equal(own.length, 1, "exactly one record file for this node's id");
        // The peer record on disk is byte-identical to before the republish.
        assert.equal(await readFile(peerPath, "utf8"), peerBefore, "peer record byte-identical after republish");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:identity reads a node's record back by id ═════════════════
  {
    name: "mesh-identity-status-commands/01 mesh:identity reads a node's record back by id",
    async run() {
      const { repo, env } = await makeRepo();
      try {
        const ctx = await ctxFor(repo, env);
        const peer = await seedPeer(ctx.workspace, "umair-mbp");
        const before = await snapshotTree(ctx.workspace);
        // Read the peer back.
        const read = await invoke("mesh:identity", { ref: "umair-mbp" }, ctx);
        assert.deepEqual(read, peer, "the result is the peer's node record");
        // An absent id reads as absent (null), not an error — invoke raises nothing.
        let absent, threw = false;
        try {
          absent = await invoke("mesh:identity", { ref: "never-synced" }, ctx);
        } catch {
          threw = true;
        }
        assert.equal(threw, false, "invoke raises no error for an absent read");
        assert.equal(absent, null, "the result is absent (not an error)");
        // A read never writes — the partition root is byte-unchanged.
        assert.deepEqual(await snapshotTree(ctx.workspace), before, "partition root byte-unchanged (read never writes)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:status lists every node record in the synced tree ═════════
  {
    name: "mesh-identity-status-commands/01 mesh:status lists every node record in the synced tree",
    async run() {
      const { repo, env } = await makeRepo();
      try {
        const ctx = await ctxFor(repo, env);
        await seedPeer(ctx.workspace, "umair-desktop");
        await seedPeer(ctx.workspace, "umair-mbp");
        await seedPeer(ctx.workspace, "build-server");
        const before = await snapshotTree(ctx.workspace);
        const result = await invoke("mesh:status", {}, ctx);
        // The stable { nodes:[...] } shape.
        assert.ok(Array.isArray(result.nodes), "the --json result is a stable { nodes:[...] } shape");
        const ids = result.nodes.map((n) => n.nodeId).sort();
        assert.deepEqual(ids, ["build-server", "umair-desktop", "umair-mbp"], "exactly those three node ids (no extras, none dropped)");
        // Each node carries its id + capabilities.
        for (const node of result.nodes) {
          assert.equal(typeof node.nodeId, "string");
          assert.ok(Array.isArray(node.runtimes) && Array.isArray(node.skills), "node carries capabilities");
        }
        // status is a pure read — the partition root is byte-unchanged.
        assert.deepEqual(await snapshotTree(ctx.workspace), before, "partition root byte-unchanged (status is a pure read)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:status on an empty roster returns an empty list, not an error ═
  {
    name: "mesh-identity-status-commands/01 mesh:status on an empty roster returns an empty list, not an error",
    async run() {
      const { repo, env } = await makeRepo();
      try {
        const ctx = await ctxFor(repo, env);
        let result, threw = false;
        try {
          result = await invoke("mesh:status", {}, ctx);
        } catch {
          threw = true;
        }
        assert.equal(threw, false, "no error is raised on an empty roster");
        // The feature asserts "an empty node list" + "the stable { nodes: [] } shape".
        // milestone 25 / story 01 (ADR-002) EXTENDS mesh:status additively with a top-
        // level `boards` projection (the boards half sits ALONGSIDE the nodes half, never
        // reshaping it), so the empty-fleet aggregate is { nodes: [], boards: [] }. The
        // nodes half stays the stable empty node list this scenario pins — asserted
        // directly (nodes === []) so the additive boards key is compatible, not a
        // whole-object equality that the sanctioned extension would break.
        assert.deepEqual(result.nodes, [], "the stable empty node list (the { nodes: [] } half)");
        assert.deepEqual(result.boards, [], "the additive boards projection is the empty list on an empty fleet");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Frozen { id, input, run, cli } shape — the two registered commands ═══════
  {
    name: "mesh-identity-status-commands/01 the two commands carry the frozen { id, input, run, cli } shape",
    async run() {
      for (const id of ["mesh:identity", "mesh:status"]) {
        const command = getCommand(id);
        assert.ok(command, `${id} is registered`);
        assert.equal(command.id, id, `${id} carries its id`);
        assert.equal(typeof command.run, "function", `${id} has a run function`);
        assert.ok(command.input && typeof command.input === "object", `${id} has an input schema`);
        assert.ok(command.cli && typeof command.cli.argv === "function" && typeof command.cli.render === "function" && typeof command.cli.json === "function", `${id} has a cli adapter`);
      }
    },
  },
];
