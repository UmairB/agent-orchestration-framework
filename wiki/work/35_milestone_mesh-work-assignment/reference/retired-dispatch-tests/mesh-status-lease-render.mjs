// Traceability wiring for milestone 26 / story 01 — the additive mesh:status lease
// render (tasks/03_lease-render-on-status.feature, ADR-005 consequences).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// 03_lease-render-on-status.feature, exercising the REAL in-process registry
// (src/command-core.mjs + the EXTENDED mesh:status in src/commands/mesh-identity.mjs
// over src/mesh-lease.mjs's claim read) against a temp fixture repo — loadWorkspace
// + invoke, claim/presence fixtures written directly, rendered under an INJECTED
// now (the mesh-node-staleness idioms). One test object per scenario.
//
//   03_lease-render-on-status.feature —
//     - THE LEASE LINE: per held claim item/holder/live|lapsed by THE shared
//       presence clock (the at-threshold age-60 row is the strict-> regression guard);
//     - a released file is history, not a hold;
//     - the transient two-claims window renders BOTH claims, crowns nobody;
//     - the stable --json shape ({ nodes, leases: [{ itemRef, holder, live }] }),
//       the nodes half unchanged, the render a PURE READ (never flips a lapsed claim);
//     - absence/torn tolerance: no leases dir / empty dir / torn file ⇒ never an error;
//     - THE UNCONFIGURED FLOOR: no leases key at all — byte-identical to today.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshStatusCommand } from "../src/commands/mesh-identity.mjs";
import { meshDir, nodeRecordPath, leaseClaimPath, presenceRecordPath } from "../src/mesh-store.mjs";

const NOW = "2026-07-02T12:00:00.000Z";
const before = (nowIso, seconds) => new Date(Date.parse(nowIso) - seconds * 1000).toISOString();

// A fixture repo; mesh config is injectable ({ nodeId } ⇒ configured, undefined ⇒
// the unconfigured floor). The staleness threshold is pinned at 60s where configured.
async function makeRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-status-lease-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const MESH_ON = { nodeId: "node-a", presence: { stalenessSeconds: 60 } };
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

async function seedClaim(workspace, itemRef, nodeId, state = "claimed") {
  const target = leaseClaimPath(workspace, itemRef, nodeId);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(
    target,
    JSON.stringify({ itemRef, nodeId, state, claimedAt: before(NOW, 3600), runId: null, aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
}

// Snapshot every file under the partition root (the pure-read assertion).
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

export const meshStatusLeaseRenderTests = [
  // ══ Scenario Outline: each held claim renders its item, its holder and live|lapsed ══
  {
    name: "mesh-status-lease/03 each held claim renders its item, holder and live|lapsed by the presence clock — the at-threshold age-60 row renders LIVE (strict >)",
    async run() {
      const rows = [
        { age: 30, live: true, renders: "live" },
        { age: 60, live: true, renders: "live" }, // the strict-> regression guard
        { age: 61, live: false, renders: "lapsed" },
      ];
      for (const row of rows) {
        const { repo } = await makeRepo({ mesh: MESH_ON });
        try {
          const ctx = await ctxFor(repo);
          await seedClaim(ctx.workspace, "item-x", "node-b", "claimed");
          await seedPresence(ctx.workspace, "node-b", before(NOW, row.age));

          const result = await invoke("mesh:status", { now: NOW }, ctx);

          const lease = result.leases.find((l) => l.itemRef === "item-x");
          assert.ok(lease, `the lease section lists item-x (age ${row.age})`);
          assert.equal(lease.holder, "node-b", `item-x is held by node-b (age ${row.age})`);
          assert.equal(lease.live, row.live, `the lease's live flag is ${row.live} at age ${row.age} (threshold 60, strict >)`);
          // The human face renders the live|lapsed literal.
          const rendered = meshStatusCommand.cli.render(result);
          assert.ok(
            rendered.includes(`item-x — held by node-b (${row.renders})`),
            `the human render carries "item-x — held by node-b (${row.renders})" at age ${row.age}`
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ (review QA N1) the documented default threshold, resolved through the REAL command path ══
  // Mesh configured with NO stalenessSeconds at all: the 90s documented default must
  // govern the lease clock through the production config-consuming path (command →
  // resolveStalenessSeconds → claimLiveness) — never a test-computed threshold. A
  // 91s-old holder maps lapsed (strict >: 91 > 90); a 90s-old holder is still live.
  {
    name: "mesh-status-lease/03 with NO stalenessSeconds configured the documented 90s default governs the lease clock through the real command path — age 91 renders lapsed, age 90 still live",
    async run() {
      const rows = [
        { age: 90, live: true, renders: "live" }, // at the default boundary — still fresh (strict >)
        { age: 91, live: false, renders: "lapsed" }, // past the default — lapsed via the resolved default
      ];
      for (const row of rows) {
        // mesh.nodeId only — NO presence block, so the threshold in force must be
        // the resolver's documented default, reached through the command itself.
        const { repo } = await makeRepo({ mesh: { nodeId: "node-a" } });
        try {
          const ctx = await ctxFor(repo);
          await seedClaim(ctx.workspace, "item-x", "node-b", "claimed");
          await seedPresence(ctx.workspace, "node-b", before(NOW, row.age));

          const result = await invoke("mesh:status", { now: NOW }, ctx);

          const lease = result.leases.find((l) => l.itemRef === "item-x");
          assert.ok(lease, `the lease section lists item-x (age ${row.age}, default threshold)`);
          assert.equal(
            lease.live,
            row.live,
            `under the documented 90s default a ${row.age}s-old holder's lease is live=${row.live} (resolved through the real command path)`
          );
          assert.ok(
            meshStatusCommand.cli.render(result).includes(`item-x — held by node-b (${row.renders})`),
            `the human render carries "${row.renders}" at age ${row.age} under the default`
          );
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: a released claim is a withdrawal, not a hold ══
  {
    name: "mesh-status-lease/03 a released claim is a withdrawal, not a hold — only claimed files render as leases",
    async run() {
      const { repo } = await makeRepo({ mesh: MESH_ON });
      try {
        const ctx = await ctxFor(repo);
        await seedClaim(ctx.workspace, "item-x", "node-b", "released");
        await seedClaim(ctx.workspace, "item-y", "node-c", "claimed");
        await seedPresence(ctx.workspace, "node-c", before(NOW, 5));

        const result = await invoke("mesh:status", { now: NOW }, ctx);

        assert.equal(result.leases.length, 1, "the lease section lists exactly one lease");
        assert.equal(result.leases[0].itemRef, "item-y", "the one lease is item-y");
        assert.equal(result.leases[0].holder, "node-c", "held by node-c");
        assert.ok(
          !result.leases.some((l) => l.itemRef === "item-x"),
          "item-x appears in no lease line (a released file is history, not a hold)"
        );
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the transient two-claims window renders both claims, crowns nobody ══
  {
    name: "mesh-status-lease/03 during the transient two-claims window the render reports BOTH claims and resolves no winner — no error",
    async run() {
      const { repo } = await makeRepo({ mesh: MESH_ON });
      try {
        const ctx = await ctxFor(repo);
        await seedClaim(ctx.workspace, "item-x", "node-a", "claimed");
        await seedClaim(ctx.workspace, "item-x", "node-b", "claimed");
        await seedPresence(ctx.workspace, "node-a", before(NOW, 5));
        await seedPresence(ctx.workspace, "node-b", before(NOW, 5));

        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");

        const itemX = result.leases.filter((l) => l.itemRef === "item-x");
        assert.equal(itemX.length, 2, "the lease section lists item-x twice — once per claimant");
        assert.deepEqual(
          itemX.map((l) => l.holder).sort(),
          ["node-a", "node-b"],
          "one entry per claimant"
        );
        // The render crowns no winner: no lease entry carries any winner/holder-of-record
        // marker beyond the per-claim { itemRef, holder, live } vocabulary.
        for (const lease of itemX) {
          assert.deepEqual(Object.keys(lease).sort(), ["holder", "itemRef", "live"], "a lease entry carries exactly itemRef/holder/live — no winner resolution");
        }
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the stable --json shape + the pure read ══
  {
    name: "mesh-status-lease/03 mesh:status renders the stable { nodes, leases: [{ itemRef, holder, live }] } shape additively — and writes nothing, never flipping a lapsed claim",
    async run() {
      const { repo } = await makeRepo({ mesh: MESH_ON });
      try {
        const ctx = await ctxFor(repo);
        await seedNode(ctx.workspace, "node-b");
        await seedClaim(ctx.workspace, "item-x", "node-b", "claimed");
        await seedPresence(ctx.workspace, "node-b", before(NOW, 5)); // live
        await seedClaim(ctx.workspace, "item-y", "node-c", "claimed");
        await seedPresence(ctx.workspace, "node-c", before(NOW, 600)); // lapsed
        const treeBefore = await snapshotTree(ctx.workspace);
        const lapsedBytesBefore = await readFile(leaseClaimPath(ctx.workspace, "item-y", "node-c"), "utf8");

        const result = await invoke("mesh:status", { now: NOW }, ctx);

        // The stable shape: the m23 nodes half unchanged, the leases key additive.
        assert.ok(Array.isArray(result.nodes), "the --json result carries the stable nodes half");
        assert.ok(Array.isArray(result.leases), "the --json result carries the additive leases key");
        const nodeB = result.nodes.find((n) => n.nodeId === "node-b");
        assert.ok(nodeB && nodeB.presence && typeof nodeB.stale === "boolean", "the nodes half is the unchanged m23 { nodeId, presence?, stale } shape");
        for (const lease of result.leases) {
          assert.deepEqual(Object.keys(lease).sort(), ["holder", "itemRef", "live"], "each lease is exactly { itemRef, holder, live }");
        }
        const leaseX = result.leases.find((l) => l.itemRef === "item-x");
        const leaseY = result.leases.find((l) => l.itemRef === "item-y");
        assert.ok(leaseX && leaseX.holder === "node-b" && leaseX.live === true, "the lease for item-x carries holder node-b and live true");
        assert.ok(leaseY && leaseY.holder === "node-c" && leaseY.live === false, "the lease for item-y carries holder node-c and live false (rendered lapsed)");
        // The pure read: the lapsed claim was never "helpfully" flipped, and the
        // whole partition root is byte-unchanged.
        const lapsedBytesAfter = await readFile(leaseClaimPath(ctx.workspace, "item-y", "node-c"), "utf8");
        assert.equal(lapsedBytesAfter, lapsedBytesBefore, "node-c's lapsed claim file is byte-unchanged — still state claimed");
        assert.equal(JSON.parse(lapsedBytesAfter).state, "claimed", "the render never flips a lapsed claim");
        assert.deepEqual(await snapshotTree(ctx.workspace), treeBefore, "the partition root is byte-unchanged (status is a pure read)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: zero leases renders an empty section; a torn claim file is skipped ══
  {
    name: "mesh-status-lease/03 zero leases renders an empty section and a torn claim file is skipped — never an error (absent dir / empty dir / torn-beside-healthy)",
    async run() {
      const cases = [
        {
          label: "absent (no leases directory at all)",
          seed: async () => {},
          expect: (leases) => assert.deepEqual(leases, [], "an empty leases list (absent dir)"),
        },
        {
          label: "an empty leases directory",
          seed: async (ws) => mkdir(path.join(meshDir(ws), "leases"), { recursive: true }),
          expect: (leases) => assert.deepEqual(leases, [], "an empty leases list (empty dir)"),
        },
        {
          label: "one torn claim beside node-b's healthy claim on item-x",
          seed: async (ws) => {
            await seedClaim(ws, "item-x", "node-b", "claimed");
            await seedPresence(ws, "node-b", before(NOW, 5));
            const torn = leaseClaimPath(ws, "item-x", "node-torn");
            await writeFile(torn, "{ this is not json", "utf8");
          },
          expect: (leases) => {
            assert.equal(leases.length, 1, "exactly the one healthy lease (the torn file skipped)");
            assert.equal(leases[0].itemRef, "item-x", "the healthy lease is item-x");
            assert.equal(leases[0].holder, "node-b", "held by node-b");
          },
        },
      ];
      for (const c of cases) {
        const { repo } = await makeRepo({ mesh: MESH_ON });
        try {
          const ctx = await ctxFor(repo);
          await c.seed(ctx.workspace);
          let result, threw = false;
          try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
          assert.equal(threw, false, `no error is raised (${c.label})`);
          assert.ok(Array.isArray(result.leases), `the leases key is present and a list (${c.label})`);
          c.expect(result.leases);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: the unconfigured floor — no lease section at all ══
  {
    name: "mesh-status-lease/03 with mesh unconfigured the status render is byte-identical to today — NO leases key (absent, not empty), even with claim files on disk",
    async run() {
      const { repo } = await makeRepo(); // no mesh config — the unconfigured floor
      try {
        const ctx = await ctxFor(repo);
        await seedNode(ctx.workspace, "node-b");
        await seedPresence(ctx.workspace, "node-b", before(NOW, 5));

        // Today's baseline for THIS tree — captured BEFORE any lease bytes exist
        // (review QA N2: byte-compare against the real today, not a proxy).
        const today = await invoke("mesh:status", { now: NOW }, ctx);
        const todayRender = meshStatusCommand.cli.render(today);
        const todayJson = JSON.stringify(meshStatusCommand.cli.json(today));

        // Claim files now EXIST on disk under the lease tree.
        await seedClaim(ctx.workspace, "item-x", "node-b", "claimed");

        let result, threw = false;
        try { result = await invoke("mesh:status", { now: NOW }, ctx); } catch { threw = true; }
        assert.equal(threw, false, "no error is raised");
        assert.ok(!("leases" in result), "the leases key is ABSENT (not empty) — the configured-but-zero distinction");
        // Byte-identical to today's for that tree — render AND --json.
        assert.equal(meshStatusCommand.cli.render(result), todayRender, "the human render is byte-identical to today's for that tree");
        assert.equal(JSON.stringify(meshStatusCommand.cli.json(result)), todayJson, "the --json result is byte-identical to today's for that tree");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
