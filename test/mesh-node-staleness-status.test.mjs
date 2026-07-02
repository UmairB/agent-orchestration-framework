// Traceability wiring for milestone 23 / story 00 — mesh:status renders each node's
// presence with a stale flag (tasks/01_node-staleness-and-status.feature).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/01_node-staleness-and-status.feature, exercising the REAL in-process registry
// (src/command-core.mjs + the EXTENDED mesh:status in src/commands/mesh-identity.mjs
// over src/mesh-presence.mjs) against a temp fixture repo — loadWorkspace + invoke,
// real fs, in-process. `now` and `heartbeatAt` are driven as INJECTED values (white-box
// over the staleness inputs, never wall-clock — the 22/R2 discipline). One test object
// per scenario (outline rows folded into one entry iterating the rows). node:assert/strict.
//
//   01_node-staleness-and-status.feature — the strict-`>` staleness boundary (the m20
//     isStale shape: now − heartbeatAt > threshold, age == threshold ⇒ still live); the
//     config.mesh.presence.stalenessSeconds threshold with a DOCUMENTED default
//     (absent/malformed/negative/null ⇒ default, no error); the never-beat node
//     (node record but no presence) reads as no-presence + stale false; an empty roster
//     reads as { nodes: [] }; the stable { nodes: [ { nodeId, presence?, stale } ] } shape;
//     status writes nothing (a pure read).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, nodeRecordPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { DEFAULT_PRESENCE_STALENESS_SECONDS } from "../src/mesh-presence.mjs";

const NOW = "2026-06-30T12:00:00.000Z";

// A fixture repo with an optional mesh.presence config block. The work stream is a
// single milestone (mesh:status reads node records, not work items, so a minimal stream
// suffices).
async function makeRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-status-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

// Seed a node record (so the node appears in the mesh:status roster).
async function seedNode(workspace, id) {
  const record = { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" };
  await mkdir(path.join(meshDir(workspace), "nodes"), { recursive: true });
  await writeFile(nodeRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
}

// Seed a presence record for a node with the given heartbeatAt.
async function seedPresence(workspace, id, heartbeatAt) {
  const record = { nodeId: id, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" };
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(presenceRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
}

// An ISO instant `seconds` before NOW.
function before(nowIso, seconds) {
  return new Date(Date.parse(nowIso) - seconds * 1000).toISOString();
}

// Snapshot every file under the partition root (for the byte-unchanged R4 assertion).
async function snapshotTree(workspace) {
  const root = meshDir(workspace);
  const snap = {};
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
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

const nodeOf = (result, id) => result.nodes.find((n) => n.nodeId === id);

export const meshNodeStalenessStatusTests = [
  // ══ Scenario Outline: mesh:status flags a node stale only when now − heartbeatAt strictly exceeds the threshold ══
  {
    name: "mesh-node-staleness-status/01 mesh:status flags a node stale only when now − heartbeatAt strictly exceeds the threshold (strict >)",
    async run() {
      // Threshold fixed at 60s; the AT-threshold row (age 60 ⇒ live) is load-bearing.
      const rows = [
        { age: 0, stale: false },
        { age: 30, stale: false },
        { age: 59, stale: false },
        { age: 60, stale: false },
        { age: 61, stale: true },
        { age: 600, stale: true },
      ];
      for (const row of rows) {
        const { repo } = await makeRepo({ mesh: { presence: { stalenessSeconds: 60 } } });
        try {
          const ctx = await ctxFor(repo);
          await seedNode(ctx.workspace, "node-x");
          await seedPresence(ctx.workspace, "node-x", before(NOW, row.age));
          const result = await invoke("mesh:status", { now: NOW }, ctx);
          const node = nodeOf(result, "node-x");
          assert.ok(node, `node-x is in the roster (age ${row.age})`);
          assert.ok(node.presence, `node-x is rendered with presence (age ${row.age})`);
          assert.equal(node.stale, row.stale, `node-x stale is ${row.stale} at age ${row.age} (threshold 60, strict >)`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: an absent or malformed stalenessSeconds falls back to the documented default ══
  {
    name: "mesh-node-staleness-status/01 an absent or malformed stalenessSeconds falls back to the documented default",
    async run() {
      // configured → the mesh block to write (undefined ⇒ no mesh block at all).
      const cases = [
        { label: "absent (unset)", mesh: undefined },
        { label: "not-a-number", mesh: { presence: { stalenessSeconds: "not-a-number" } } },
        { label: "a negative number", mesh: { presence: { stalenessSeconds: -5 } } },
        { label: "null", mesh: { presence: { stalenessSeconds: null } } },
      ];
      for (const c of cases) {
        const { repo } = await makeRepo({ mesh: c.mesh });
        try {
          const ctx = await ctxFor(repo);
          await seedNode(ctx.workspace, "node-x");
          // A heartbeat 1 second before now — well within the documented default.
          await seedPresence(ctx.workspace, "node-x", before(NOW, 1));
          let result, threw = false;
          try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
          assert.equal(threw, false, `no error is raised (${c.label})`);
          const node = nodeOf(result, "node-x");
          // The default in force ⇒ a 1s-old heartbeat reads live (stale false).
          assert.equal(node.stale, false, `node-x stale is false under the documented default (${c.label})`);
          // The documented default is the single source — a heartbeat at the default
          // boundary would still be live (strict >), but one PAST it would be stale,
          // confirming the threshold-in-force IS the documented default.
          const { repo: repo2 } = await makeRepo({ mesh: c.mesh });
          try {
            const ctx2 = await ctxFor(repo2);
            await seedNode(ctx2.workspace, "node-x");
            await seedPresence(ctx2.workspace, "node-x", before(NOW, DEFAULT_PRESENCE_STALENESS_SECONDS + 1));
            const r2 = await invoke("mesh:status", { now: NOW }, ctx2);
            assert.equal(nodeOf(r2, "node-x").stale, true, `a heartbeat past the documented default (${DEFAULT_PRESENCE_STALENESS_SECONDS}s) is stale (${c.label}) — the threshold in force IS the default`);
          } finally {
            await rm(repo2, { recursive: true, force: true });
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: a node with a node record but no presence record reads as no-presence and not stale ══
  {
    name: "mesh-node-staleness-status/01 a node with a node record but no presence record reads as no-presence and not stale, not an error",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        await seedNode(ctx.workspace, "node-x"); // a node record, NO presence record.
        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        const node = nodeOf(result, "node-x");
        assert.ok(node, "node-x appears in the roster");
        assert.ok(!("presence" in node), "node-x has no presence (the key is absent, not an error)");
        assert.equal(node.stale, false, "node-x stale is false (a never-beat node is unknown liveness, not stale)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:status on an empty roster returns an empty list, not an error ══
  {
    name: "mesh-node-staleness-status/01 mesh:status on an empty roster returns an empty list, not an error",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised on an empty roster");
        // The feature asserts "an empty node list" + "the stable { nodes: [] } shape".
        // milestone 25 / story 01 (ADR-002) EXTENDS mesh:status additively with a top-
        // level `boards` projection alongside the nodes half (never reshaping it), so the
        // empty-fleet aggregate is { nodes: [], boards: [] }. The nodes half stays the
        // stable empty node list this scenario pins — asserted directly so the additive
        // boards key is compatible, not a whole-object equality the extension would break.
        assert.deepEqual(result.nodes, [], "the stable empty node list (the { nodes: [] } half)");
        assert.deepEqual(result.boards, [], "the additive boards projection is the empty list on an empty fleet");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: mesh:status renders a stable --json shape carrying each node's presence and stale flag, writes nothing ══
  {
    name: "mesh-node-staleness-status/01 mesh:status renders a stable --json shape carrying each node's presence and stale flag, and writes nothing",
    async run() {
      const { repo } = await makeRepo({ mesh: { presence: { stalenessSeconds: 60 } } });
      try {
        const ctx = await ctxFor(repo);
        // node-live: fresh heartbeat; node-stale: well past the threshold; node-bare: no presence.
        await seedNode(ctx.workspace, "node-live");
        await seedPresence(ctx.workspace, "node-live", before(NOW, 5));
        await seedNode(ctx.workspace, "node-stale");
        await seedPresence(ctx.workspace, "node-stale", before(NOW, 600));
        await seedNode(ctx.workspace, "node-bare");
        const before2 = await snapshotTree(ctx.workspace);
        const result = await invoke("mesh:status", { now: NOW }, ctx);
        // The stable shape.
        assert.ok(Array.isArray(result.nodes), "the --json result is a stable { nodes: [...] } shape");
        for (const node of result.nodes) {
          assert.equal(typeof node.nodeId, "string", "each node carries a nodeId");
          assert.equal(typeof node.stale, "boolean", "each node carries a stale flag");
        }
        const live = nodeOf(result, "node-live");
        const stale = nodeOf(result, "node-stale");
        const bare = nodeOf(result, "node-bare");
        assert.ok(live.presence && live.stale === false, "node-live carries its presence and stale false");
        assert.ok(stale.presence && stale.stale === true, "node-stale carries its presence and stale true");
        assert.ok(!("presence" in bare) && bare.stale === false, "node-bare carries no presence and stale false");
        // Exactly those three node ids (no extras, none dropped).
        assert.deepEqual(result.nodes.map((n) => n.nodeId).sort(), ["node-bare", "node-live", "node-stale"], "exactly those three node ids");
        // Status is a pure read — the partition root is byte-unchanged.
        assert.deepEqual(await snapshotTree(ctx.workspace), before2, "partition root byte-unchanged (status is a pure read)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
