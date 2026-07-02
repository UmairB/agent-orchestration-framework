// Traceability wiring for milestone 25 / story 01 — the boards projection
// (tasks/00_boards-projection.feature).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/00_boards-projection.feature, exercising the REAL in-process registry
// (src/command-core.mjs + the EXTENDED mesh:status in src/commands/mesh-identity.mjs
// over src/mesh-registry.mjs + src/mesh-presence.mjs) against a temp fixture repo —
// loadWorkspace + invoke, real fs, in-process. `now` is an INJECTED value (white-box
// over the inputs). One test object per scenario (outline rows folded into one entry
// iterating the rows). node:assert/strict.
//
// THE BOARD→ACTIVE-RUNS SEAM (ADR-005 / finding F1): a board's activeRuns is its OWNER
// node's synced presence.activeRuns — the ONLY fleet-durable run signal. The shipped
// build read <workDir>/<slug>/, which had NO runtime producer (aof items are direct
// children of workDir; each board keeps its own git — a peer board's runs never sync
// here). presence.activeRuns is authored by mesh:heartbeat as the node's running run
// ids (already filtered to state === "running", m23) and git-synced under
// .mesh/presence; mesh:status reads it back and attributes it to the board's owner.
// The fixtures below plant the OWNER's presence.activeRuns so the projection reads it.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, nodeRecordPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { registryPath, registryDir, emptyRegistry, admitNode, registerBoard } from "../src/mesh-registry.mjs";

const NOW = "2026-07-01T12:00:00.000Z";

async function makeRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-boards-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

// Plant a node record (so the node appears in the mesh:status roster).
async function seedNode(workspace, id) {
  const record = { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" };
  await mkdir(path.join(meshDir(workspace), "nodes"), { recursive: true });
  await writeFile(nodeRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
}

// Plant a presence record with the given heartbeatAt + activeRuns (the m23 presence
// shape). activeRuns is the OWNER's running run ids — the fleet run signal (ADR-005).
async function seedPresence(workspace, id, heartbeatAt, activeRuns = []) {
  const record = { nodeId: id, heartbeatAt, activeRuns, aofVersion: "0.1.0" };
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(presenceRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
}

// Plant a group registry file on disk (the m24 seam). Built through the pure add-only
// helpers so the on-disk shape is m24's exact { roster, boards, pending, revocations }.
async function seedRegistry(workspace, registry) {
  await mkdir(registryDir(workspace), { recursive: true });
  await writeFile(registryPath(workspace), JSON.stringify(registry, null, 2), "utf8");
}

// Snapshot every file under the repo root (for the pure-read byte-unchanged assertion).
async function snapshotRepo(repo) {
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
  await walk(repo, "");
  return snap;
}

const boardOf = (result, ref) => result.boards.find((b) => b.ref === ref);
const nodeOf = (result, id) => result.nodes.find((n) => n.nodeId === id);

const RUN_A = "20260701T120000000Z-0001";
const RUN_B = "20260701T120000000Z-0002";

export const meshFleetBoardsProjectionTests = [
  // ══ Scenario: mesh:status carries every registered board with its owner and its owner's active runs ══
  {
    name: "mesh-fleet-boards-projection/00 mesh:status carries every registered board with its owner and its owner's active runs",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // A registry: node-a owns let-shield, node-b owns voice-vox-web.
        let reg = emptyRegistry();
        reg = admitNode(reg, { nodeId: "node-a", admittedAt: NOW, boards: ["let-shield"] });
        reg = admitNode(reg, { nodeId: "node-b", admittedAt: NOW, boards: ["voice-vox-web"] });
        reg = registerBoard(reg, "let-shield");
        reg = registerBoard(reg, "voice-vox-web");
        await seedRegistry(ctx.workspace, reg);
        // node-a's presence carries ONE running run id; node-b's carries none.
        await seedPresence(ctx.workspace, "node-a", NOW, [RUN_A]);
        await seedPresence(ctx.workspace, "node-b", NOW, []);

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        assert.deepEqual(result.boards.map((b) => b.ref).sort(), ["let-shield", "voice-vox-web"], "exactly let-shield and voice-vox-web");
        const shield = boardOf(result, "let-shield");
        const voice = boardOf(result, "voice-vox-web");
        assert.equal(shield.owner, "node-a", "let-shield owner is node-a");
        assert.deepEqual(shield.activeRuns, [RUN_A], "let-shield carries exactly its owner's one running run id");
        assert.equal(voice.owner, "node-b", "voice-vox-web owner is node-b");
        assert.deepEqual(voice.activeRuns, [], "voice-vox-web carries an empty activeRuns (not dropped, not an error)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a roster entry carrying two boards yields two board entries with the one owner ══
  {
    name: "mesh-fleet-boards-projection/00 a roster entry carrying two boards yields two board entries with the one owner",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        let reg = emptyRegistry();
        reg = admitNode(reg, { nodeId: "node-a", admittedAt: NOW, boards: ["let-shield", "voice-vox-web"] });
        await seedRegistry(ctx.workspace, reg);
        await seedPresence(ctx.workspace, "node-a", NOW, [RUN_A]);

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        const refs = result.boards.map((b) => b.ref).sort();
        assert.deepEqual(refs, ["let-shield", "voice-vox-web"], "let-shield and voice-vox-web, each exactly once");
        assert.equal(result.boards.length, 2, "no duplicate entries");
        assert.equal(boardOf(result, "let-shield").owner, "node-a", "let-shield owned by node-a");
        assert.equal(boardOf(result, "voice-vox-web").owner, "node-a", "voice-vox-web owned by node-a");
        // The fleet signal is per-owner, not per-board — both boards carry node-a's run.
        assert.deepEqual(boardOf(result, "let-shield").activeRuns, [RUN_A], "let-shield carries its owner's run");
        assert.deepEqual(boardOf(result, "voice-vox-web").activeRuns, [RUN_A], "voice-vox-web carries the same owner's run");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a roster node with an empty boards list stays in the nodes half and adds no board entry ══
  {
    name: "mesh-fleet-boards-projection/00 a roster node with an empty boards list stays in the nodes half and adds no board entry",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        let reg = emptyRegistry();
        reg = admitNode(reg, { nodeId: "node-c", admittedAt: NOW, boards: [] });
        await seedRegistry(ctx.workspace, reg);
        await seedNode(ctx.workspace, "node-c");
        await seedPresence(ctx.workspace, "node-c", NOW);

        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        assert.ok(nodeOf(result, "node-c"), "node-c appears in the nodes half");
        assert.deepEqual(result.boards.filter((b) => b.owner === "node-c"), [], "no board owned by node-c");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a board carries every one of its owner's active run ids ══
  {
    name: "mesh-fleet-boards-projection/00 a board carries every one of its owner's active run ids, no duplicates",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        let reg = emptyRegistry();
        reg = admitNode(reg, { nodeId: "node-a", admittedAt: NOW, boards: ["let-shield"] });
        await seedRegistry(ctx.workspace, reg);
        // node-a's presence carries TWO running run ids.
        await seedPresence(ctx.workspace, "node-a", NOW, [RUN_A, RUN_B]);

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        const shield = boardOf(result, "let-shield");
        assert.deepEqual([...shield.activeRuns].sort(), [RUN_A, RUN_B].sort(), "exactly the owner's two running run ids");
        assert.equal(new Set(shield.activeRuns).size, shield.activeRuns.length, "no duplicates");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a board whose owner has no presence reads an empty activeRuns ══
  {
    name: "mesh-fleet-boards-projection/00 a board whose owner has no presence reads an empty activeRuns (the peer / degradation case)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        let reg = emptyRegistry();
        reg = admitNode(reg, { nodeId: "node-a", admittedAt: NOW, boards: ["let-shield"] });
        await seedRegistry(ctx.workspace, reg);
        // No presence record for node-a — the owner's run signal is unavailable.

        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        const shield = boardOf(result, "let-shield");
        assert.equal(shield.owner, "node-a", "let-shield still owned by node-a");
        assert.deepEqual(shield.activeRuns, [], "an owner with no presence reads an empty activeRuns");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a board carried only on a roster entry still surfaces in the projection ══
  {
    name: "mesh-fleet-boards-projection/00 a board carried only on a roster entry still surfaces (union enumeration)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // node-a carries let-shield on its roster entry, but the top-level boards[] does
        // NOT include it (registerBoard never ran) — the union must still surface it.
        let reg = emptyRegistry();
        reg = admitNode(reg, { nodeId: "node-a", admittedAt: NOW, boards: ["let-shield"] });
        assert.ok(!reg.boards.includes("let-shield"), "precondition: top-level boards[] does not include let-shield");
        await seedRegistry(ctx.workspace, reg);

        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        const shield = boardOf(result, "let-shield");
        assert.ok(shield, "let-shield appears in the boards list (from the roster half of the union)");
        assert.equal(shield.owner, "node-a", "with its owner node-a");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the nodes half of the aggregate is unchanged for existing consumers ══
  {
    name: "mesh-fleet-boards-projection/00 the nodes half of the aggregate is unchanged for existing consumers (additive)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        await seedNode(ctx.workspace, "node-a");
        await seedPresence(ctx.workspace, "node-a", NOW);
        let reg = emptyRegistry();
        reg = registerBoard(reg, "let-shield");
        await seedRegistry(ctx.workspace, reg);

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        assert.ok(Array.isArray(result.nodes), "nodes is a list");
        const node = nodeOf(result, "node-a");
        assert.equal(typeof node.nodeId, "string", "node carries a nodeId");
        assert.ok(node.presence && typeof node.stale === "boolean", "node carries presence + stale");
        // The node entry carries NO boards-derived key (the join never reshapes a node).
        assert.ok(!("boards" in node), "node-a carries no boards key");
        assert.ok(!("owner" in node) && !("activeRuns" in node) && !("ref" in node), "node-a carries no boards-derived key");
        // The boards projection sits alongside as a new top-level key.
        assert.ok(Array.isArray(result.boards), "boards sits alongside as a new top-level key");
        assert.ok(boardOf(result, "let-shield"), "let-shield is in the boards projection");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: aggregating the fleet changes no files (pure read) ══
  {
    name: "mesh-fleet-boards-projection/00 aggregating the fleet changes no files (a pure read)",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // A populated registry, node records, and presence records (with active runs).
        let reg = emptyRegistry();
        reg = admitNode(reg, { nodeId: "node-a", admittedAt: NOW, boards: ["let-shield"] });
        reg = registerBoard(reg, "let-shield");
        await seedRegistry(ctx.workspace, reg);
        await seedNode(ctx.workspace, "node-a");
        await seedPresence(ctx.workspace, "node-a", NOW, [RUN_A]);
        // Record the whole repo's on-disk state.
        const before = await snapshotRepo(repo);

        await invoke("mesh:status", { now: NOW }, ctx);

        const after = await snapshotRepo(repo);
        assert.deepEqual(after, before, "the workspace's on-disk state is byte-unchanged (the aggregate is a pure read)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
