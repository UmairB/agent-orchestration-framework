// Traceability wiring for milestone 25 / story 01 — the fleet aggregate degrades
// gracefully (tasks/02_graceful-degradation.feature).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/02_graceful-degradation.feature, exercising the REAL in-process registry
// (src/command-core.mjs + the EXTENDED mesh:status in src/commands/mesh-identity.mjs)
// against a temp fixture repo — loadWorkspace + invoke, real fs, in-process — plus one
// CLI-spawn scenario (the stale node still renders). `now` is INJECTED for the invoke
// scenarios. node:assert/strict.
//
// THE DEGRADATION THE AGGREGATE OWNS (DEV correction, task 02): readRegistry tolerates
// ONLY ENOENT — an unparseable registry THROWS (JSON.parse outside its try/catch), a
// wrong-shape registry PARSES but is a non-registry value. So the boards projection
// owns BOTH halves: (a) wrap readRegistry in try/catch so a THROW degrades to empty
// boards; (b) shape-guard the parsed value so a non-registry shape degrades to empty
// boards, not a crash on `.boards`/`.roster`. Both must degrade IDENTICALLY to an empty
// boards projection with the node roster intact.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshDir, nodeRecordPath, presenceRecordPath } from "../src/mesh-store.mjs";
import { registryPath, registryDir } from "../src/mesh-registry.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

const NOW = "2026-07-01T12:00:00.000Z";

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-degrade-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

async function seedNode(workspace, id) {
  const record = { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" };
  await mkdir(path.join(meshDir(workspace), "nodes"), { recursive: true });
  await writeFile(nodeRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
}

async function seedPresence(workspace, id, heartbeatAt) {
  const record = { nodeId: id, heartbeatAt, activeRuns: [], aofVersion: "0.1.0" };
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeFile(presenceRecordPath(workspace, id), JSON.stringify(record, null, 2), "utf8");
}

// Plant raw bytes at the registry path (for the torn/foreign-shape rows).
async function seedRegistryRaw(workspace, raw) {
  await mkdir(registryDir(workspace), { recursive: true });
  await writeFile(registryPath(workspace), raw, "utf8");
}

const boardOf = (result, ref) => result.boards.find((b) => b.ref === ref);
const nodeOf = (result, id) => result.nodes.find((n) => n.nodeId === id);

// An ISO instant `seconds` before NOW (for the stale-node CLI render).
function before(nowIso, seconds) {
  return new Date(Date.parse(nowIso) - seconds * 1000).toISOString();
}

export const meshFleetGracefulDegradationTests = [
  // ══ Scenario: with no registry file the aggregate degrades to the node roster ══
  {
    name: "mesh-fleet-graceful-degradation/02 with no registry file the aggregate degrades to the node roster",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        await seedNode(ctx.workspace, "node-a");
        await seedPresence(ctx.workspace, "node-a", NOW);
        // No registry file exists.
        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        assert.ok(nodeOf(result, "node-a"), "node-a is carried in the nodes half as usual");
        assert.deepEqual(result.boards, [], "the boards projection is an empty list");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a torn or foreign-shaped registry degrades to an empty boards projection ══
  {
    name: "mesh-fleet-graceful-degradation/02 a torn or foreign-shaped registry degrades to an empty boards projection, not an error",
    async run() {
      const rows = [
        { label: "unparseable bytes (not JSON)", raw: "this is not json {{{" },
        { label: "the JSON object {} (no roster, no boards)", raw: "{}" },
        { label: "a JSON object whose roster and boards are null", raw: JSON.stringify({ roster: null, boards: null }) },
        { label: "a JSON array where the registry object should be", raw: JSON.stringify(["let-shield", "voice-vox-web"]) },
      ];
      for (const row of rows) {
        const { repo } = await makeRepo();
        try {
          const ctx = await ctxFor(repo);
          await seedNode(ctx.workspace, "node-a");
          await seedPresence(ctx.workspace, "node-a", NOW);
          await seedRegistryRaw(ctx.workspace, row.raw);
          let result, threw = false;
          try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
          assert.equal(threw, false, `no error is raised (${row.label})`);
          assert.ok(nodeOf(result, "node-a"), `node-a is carried in the nodes half (${row.label})`);
          assert.deepEqual(result.boards, [], `the boards projection is an empty list (${row.label})`);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: an empty registry renders the same as no registry ══
  {
    name: "mesh-fleet-graceful-degradation/02 an empty registry renders the same as no registry",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // The m24 emptyRegistry() literal, planted explicitly.
        await seedRegistryRaw(ctx.workspace, JSON.stringify({ roster: [], boards: [], pending: [], revocations: [] }));
        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        assert.deepEqual(result.boards, [], "the boards projection is an empty list");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a stale node still renders in full, with its board still listed (CLI render) ══
  {
    name: "mesh-fleet-graceful-degradation/02 a stale node still renders in full, with its board still listed",
    async run() {
      const { repo, workDir } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // node-a: presence heartbeatAt well past the staleness threshold (a year ago).
        await seedNode(ctx.workspace, "node-a");
        await seedPresence(ctx.workspace, "node-a", before(NOW, 400 * 24 * 3600));
        await seedRegistryRaw(
          ctx.workspace,
          JSON.stringify({ roster: [{ nodeId: "node-a", admittedAt: NOW, boards: ["let-shield"] }], boards: ["let-shield"], pending: [], revocations: [] })
        );
        // Drive through the REAL CLI (wall-clock now) — the aged heartbeat reads stale.
        const result = spawnCliSync(process.execPath, [cliPath, "mesh", "status"], {
          cwd: repo, encoding: "utf8", env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        const stdout = result.stdout ?? "";
        assert.equal(result.status, 0, `mesh status exits 0 (stderr: ${result.stderr})`);
        // node-a renders with the "stale" token (not dropped, not an error).
        assert.ok(stdout.includes("node-a — stale"), `node-a renders with the stale token (got: ${JSON.stringify(stdout)})`);
        // let-shield still renders in the boards section with its owner node-a.
        const shieldLine = stdout.split("\n").find((l) => l.includes("let-shield"));
        assert.ok(shieldLine, "let-shield still renders in the boards section");
        assert.ok(shieldLine.includes("node-a"), `the let-shield line carries its owner node-a (got: ${JSON.stringify(shieldLine)})`);
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a board whose owner is missing from the roster renders ownerless, not an error ══
  {
    name: "mesh-fleet-graceful-degradation/02 a board whose owner is missing from the roster renders ownerless (owner key OMITTED), not an error",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // A registry that registers let-shield top-level, but whose roster admits NO node
        // carrying it (a torn half-sync — registerBoard ran, admitNode did not).
        await seedRegistryRaw(
          ctx.workspace,
          JSON.stringify({ roster: [], boards: ["let-shield"], pending: [], revocations: [] })
        );
        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        const shield = boardOf(result, "let-shield");
        assert.ok(shield, "let-shield appears in the boards projection");
        // The owner key is OMITTED entirely (absent, NOT null — the m23 never-beat idiom).
        assert.ok(!("owner" in shield), "the owner key is OMITTED (absent, not null)");
        assert.equal(shield.owner, undefined, "no owner is claimed");
        // ref + activeRuns keys are still present.
        assert.equal(shield.ref, "let-shield", "the ref key is present");
        assert.ok(Array.isArray(shield.activeRuns), "the activeRuns key is present");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a board whose owner has no synced presence reads as zero active runs ══
  {
    name: "mesh-fleet-graceful-degradation/02 a board whose owner has no synced presence reads as zero active runs",
    async run() {
      const { repo } = await makeRepo();
      try {
        const ctx = await ctxFor(repo);
        // node-b owns remote-board but NO presence record for node-b has reached this node
        // (a peer whose presence has not synced yet), so its activeRuns floor to [] under
        // ADR-005 (the owner-presence run source).
        await seedRegistryRaw(
          ctx.workspace,
          JSON.stringify({ roster: [{ nodeId: "node-b", admittedAt: NOW, boards: ["remote-board"] }], boards: ["remote-board"], pending: [], revocations: [] })
        );
        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        const remote = boardOf(result, "remote-board");
        assert.ok(remote, "remote-board appears in the boards projection");
        assert.equal(remote.owner, "node-b", "with its owner node-b");
        assert.deepEqual(remote.activeRuns, [], "its activeRuns list is empty (an absent run seam is degradation, not an error)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
