// Traceability wiring for milestone 25 / story 01 — the `aof mesh status` render
// (tasks/01_mesh-status-render.feature).
//
// Covers EVERY @executable scenario / Scenario-Outline row in
// tasks/01_mesh-status-render.feature, driving the REAL CLI through child processes:
// spawnCliSync(node, [bin/aof.mjs, "mesh", "status", …], { cwd }) against a temp
// fixture repo. One test object per scenario (outline rows folded into one entry
// iterating the rows). node:assert/strict.
//
// The CLI face renders against WALL-CLOCK now (argv injects no `now`), so a "fresh
// heartbeat" is planted at the current instant (live) and an "aged past threshold"
// heartbeat far in the past (stale under the default 90s threshold). The boards
// section + its running counts are driven by the OWNER node's presence.activeRuns
// (ADR-005 / finding F1) — the fleet-durable run signal the projection reads.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnCliSync } from "./support/cli-spawn.mjs";
import { meshDir } from "../src/mesh-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

async function buildFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-fleet-render-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(aofDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", runtimes: ["claude"], work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { root, workDir };
}

const meshRoot = (workDir) => meshDir({ workDir });

async function seedNode(workDir, id) {
  const nodesDir = path.join(meshRoot(workDir), "nodes");
  await mkdir(nodesDir, { recursive: true });
  const record = { nodeId: id, host: id, os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" };
  await writeFile(path.join(nodesDir, `${id}.json`), JSON.stringify(record, null, 2), "utf8");
}

// Plant a presence record with the given heartbeatAt + activeRuns (the OWNER's running
// run ids — the fleet run signal, ADR-005).
async function seedPresence(workDir, id, heartbeatAt, activeRuns = []) {
  const presenceDir = path.join(meshRoot(workDir), "presence");
  await mkdir(presenceDir, { recursive: true });
  const record = { nodeId: id, heartbeatAt, activeRuns, aofVersion: "0.1.0" };
  await writeFile(path.join(presenceDir, `${id}.json`), JSON.stringify(record, null, 2), "utf8");
}

// Plant a group registry file (the m24 shape) directly on disk.
async function seedRegistry(workDir, registry) {
  const registryDir = path.join(meshRoot(workDir), "registry");
  await mkdir(registryDir, { recursive: true });
  await writeFile(path.join(registryDir, "group.json"), JSON.stringify(registry, null, 2), "utf8");
}

// N synthetic running run ids (the owner's presence.activeRuns) — the fleet run count.
const runIds = (n) => Array.from({ length: n }, (_, i) => `20260701T120000000Z-${String(i).padStart(4, "0")}`);

// A registry admitting one node carrying a board.
function registryWith(nodeId, board) {
  return { roster: [{ nodeId, admittedAt: "2026-07-01T00:00:00.000Z", boards: [board] }], boards: [board], pending: [], revocations: [] };
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

const FRESH = () => new Date().toISOString();
const AGED = "2000-01-01T00:00:00.000Z"; // far past the 90s default staleness threshold.

export const meshStatusFleetRenderTests = [
  // ══ Scenario Outline: each node renders as one line with its liveness token ══
  {
    name: "mesh-status-fleet-render/01 each node renders as one line with its liveness token (live / stale / no presence)",
    async run() {
      const rows = [
        { node: "mac-studio", plant: "fresh", token: "live" },
        { node: "old-laptop", plant: "aged", token: "stale" },
        { node: "new-peer", plant: "none", token: "no presence" },
      ];
      for (const row of rows) {
        const { root, workDir } = await buildFixture();
        try {
          await seedNode(workDir, row.node);
          if (row.plant === "fresh") await seedPresence(workDir, row.node, FRESH());
          else if (row.plant === "aged") await seedPresence(workDir, row.node, AGED);
          const result = runCli(root, ["mesh", "status"]);
          assert.equal(result.status, 0, `mesh status exits 0 (${row.node}; stderr: ${result.stderr})`);
          assert.ok(
            result.stdout.includes(`${row.node} — ${row.token}`),
            `render carries the line "${row.node} — ${row.token}" (got: ${JSON.stringify(result.stdout)})`
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: each registered board renders one line with its owner and its running count ══
  {
    name: "mesh-status-fleet-render/01 each registered board renders one line with its owner and its running count (zero-count listed)",
    async run() {
      for (const running of [0, 1, 2]) {
        const { root, workDir } = await buildFixture();
        try {
          await seedNode(workDir, "node-a");
          // The owner's presence carries `running` active run ids — the fleet run signal.
          await seedPresence(workDir, "node-a", FRESH(), runIds(running));
          await seedRegistry(workDir, registryWith("node-a", "let-shield"));
          const result = runCli(root, ["mesh", "status"]);
          assert.equal(result.status, 0, `mesh status exits 0 (running ${running}; stderr: ${result.stderr})`);
          // A boards section renders after the node roster.
          const boardsIdx = result.stdout.indexOf("BOARDS");
          const nodeIdx = result.stdout.indexOf("node-a — ");
          assert.ok(boardsIdx >= 0, `a boards section renders (got: ${JSON.stringify(result.stdout)})`);
          assert.ok(nodeIdx >= 0 && nodeIdx < boardsIdx, "the boards section renders AFTER the node roster");
          // A let-shield line carrying its owner node-a.
          const shieldLine = result.stdout.split("\n").find((l) => l.includes("let-shield"));
          assert.ok(shieldLine, `a let-shield line renders (got: ${JSON.stringify(result.stdout)})`);
          assert.ok(shieldLine.includes("node-a"), `the let-shield line carries its owner node-a (got: ${JSON.stringify(shieldLine)})`);
          // The line carries the running count in the rendered `running <n>` shape
          // (src renders `${board.ref}${ownerSuffix} — running ${running}`). Assert the
          // literal `running N` — a bare `\bN\b` could be satisfied by a stray digit in
          // a slug/nodeId, and a regression to `(N)` / `N active` would falsely pass.
          assert.ok(
            new RegExp(`running ${running}\\b`).test(shieldLine),
            `the let-shield line carries the running count as "running ${running}" (got: ${JSON.stringify(shieldLine)})`
          );
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: an empty roster renders the explicit no-nodes line ══
  {
    name: "mesh-status-fleet-render/01 an empty roster renders the explicit no-nodes line",
    async run() {
      const { root } = await buildFixture();
      try {
        const result = runCli(root, ["mesh", "status"]);
        assert.equal(result.status, 0, `mesh status exits 0 on an empty fleet (stderr: ${result.stderr})`);
        assert.equal(result.stdout.trim(), "No nodes in the mesh roster.", "the render is exactly the no-nodes line");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: an empty node roster with a registered board still renders the boards section ══
  {
    name: "mesh-status-fleet-render/01 an empty node roster with a registered board still renders the boards section",
    async run() {
      const { root, workDir } = await buildFixture();
      try {
        // No node records; a registry whose roster admits node-b with let-shield.
        await seedRegistry(workDir, registryWith("node-b", "let-shield"));
        const result = runCli(root, ["mesh", "status"]);
        assert.equal(result.status, 0, `mesh status exits 0 (stderr: ${result.stderr})`);
        // The no-nodes line for the nodes half.
        assert.ok(result.stdout.includes("No nodes in the mesh roster."), "the no-nodes line renders for the nodes half");
        // The boards section still lists let-shield (an empty node roster never blanks boards).
        assert.ok(result.stdout.includes("let-shield"), "the boards section still lists let-shield");
        // And it appears AFTER the no-nodes line.
        assert.ok(
          result.stdout.indexOf("No nodes in the mesh roster.") < result.stdout.indexOf("let-shield"),
          "the boards section renders below the nodes-half line"
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: aof mesh status --json emits the { nodes, boards } aggregate as clean JSON ══
  {
    name: "mesh-status-fleet-render/01 aof mesh status --json emits the { nodes, boards } aggregate as clean JSON",
    async run() {
      const { root, workDir } = await buildFixture();
      try {
        await seedNode(workDir, "node-a");
        await seedPresence(workDir, "node-a", FRESH(), runIds(1));
        await seedRegistry(workDir, registryWith("node-a", "let-shield"));
        const result = runCli(root, ["mesh", "status", "--json"]);
        assert.equal(result.status, 0, `mesh status --json exits 0 (stderr: ${result.stderr})`);
        // stdout is exactly one parseable JSON document — the { nodes, boards } aggregate.
        let parsed;
        assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, "stdout is exactly one parseable JSON document");
        assert.ok(Array.isArray(parsed.nodes) && Array.isArray(parsed.boards), "the { nodes, boards } aggregate");
        // No human-render line is mixed into the JSON stream.
        assert.ok(!result.stdout.includes("No nodes in the mesh roster."), "no friendly line in the JSON stream");
        assert.ok(!/\bBOARDS\b/.test(result.stdout.replace(/"[^"]*"/g, "")), "no human BOARDS heading in the JSON stream");
        assert.ok(parsed.boards.some((b) => b.ref === "let-shield" && b.owner === "node-a"), "the board carries its ref + owner");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: aof mesh status --json on an empty fleet emits the empty aggregate, not the friendly line ══
  {
    name: "mesh-status-fleet-render/01 aof mesh status --json on an empty fleet emits the empty aggregate, not the friendly line",
    async run() {
      const { root } = await buildFixture();
      try {
        const result = runCli(root, ["mesh", "status", "--json"]);
        assert.equal(result.status, 0, `mesh status --json exits 0 on an empty fleet (stderr: ${result.stderr})`);
        const parsed = JSON.parse(result.stdout);
        // milestone 27 / story 01 (ADR-004 consequences) — the RIPPLE: mesh:status
        // gained the UNCONDITIONAL additive isControlNode marker (present even
        // unconfigured, false — never absent). The empty aggregate is otherwise
        // exactly { nodes: [], boards: [] }.
        assert.deepEqual(
          parsed,
          { nodes: [], boards: [], isControlNode: false },
          "the empty aggregate is exactly { nodes: [], boards: [], isControlNode: false }"
        );
        assert.ok(!result.stdout.includes("No nodes in the mesh roster."), "the friendly line does not appear on stdout");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
