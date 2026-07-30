// Traceability wiring for milestone 22 / story 01 — the CLI face over mesh:identity /
// mesh:status.
//
// Covers EVERY @executable scenario in tasks/02_mesh-identity-cli-face.feature, driving
// the REAL CLI through child processes: spawnSync(node, [cli.mjs, …], { cwd }) against a
// temp fixture repo. One test object per @executable scenario (Scenario-Outline rows
// folded into one entry iterating the rows), each name tracing to feature + scenario.
//
//   02_mesh-identity-cli-face.feature — argv → invoke → render/--json over the
//     registered commands; the publish confirmation names the node id; --json emits the
//     node record / the stable { nodes:[...] } shape; the error-code matrix (each code
//     emits ONE { ok:false, error, code } envelope on stdout + non-zero exit); the
//     single-parseable-JSON-document discipline.
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
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-meshcli-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(aofDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(aofDir, "aof.config.json"),
    `${JSON.stringify({ name: "fixture", runtimes: ["claude", "codex"], work: { dir: "./wiki/work" } }, null, 2)}\n`,
    "utf8"
  );
  return { root, workDir };
}

// Seed a peer node record directly under the partition root (.mesh/nodes/<id>.json).
async function seedPeer(workDir, id) {
  const nodesDir = path.join(meshDir({ workDir }), "nodes");
  await mkdir(nodesDir, { recursive: true });
  const record = {
    nodeId: id, host: id, os: "linux", runtimes: ["claude"], skills: ["aof-developer"],
    aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z",
  };
  await writeFile(path.join(nodesDir, `${id}.json`), JSON.stringify(record, null, 2), "utf8");
  return record;
}

function runCli(root, args) {
  const result = spawnCliSync(process.execPath, [cliPath, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const meshIdentityCliFaceTests = [
  // ══ Scenario: aof mesh identity publishes this node and renders a confirmation ═
  {
    name: "mesh-identity-cli-face/02 aof mesh identity publishes this node and renders a confirmation",
    async run() {
      const { root } = await buildFixture();
      try {
        const human = runCli(root, ["mesh", "identity"]);
        assert.equal(human.status, 0, `identity exits 0 (stderr: ${human.stderr})`);
        assert.ok(/Node\s+\S+/.test(human.stdout), "the confirmation names this node's id");
        const json = runCli(root, ["mesh", "identity", "--json"]);
        assert.equal(json.status, 0, `identity --json exits 0 (stderr: ${json.stderr})`);
        const record = JSON.parse(json.stdout);
        // 34/story 02 (operator directive): `skills` is REMOVED from the
        // descriptor (see assembleDescriptor) — the frozen schema is six keys.
        assert.deepEqual(
          Object.keys(record),
          ["nodeId", "host", "os", "runtimes", "aofVersion", "publishedAt"],
          "the JSON is a node record carrying the complete frozen schema"
        );
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: aof mesh identity <id> reads that node's record ════════════════
  {
    name: "mesh-identity-cli-face/02 aof mesh identity with an id reads that node's record",
    async run() {
      const { root, workDir } = await buildFixture();
      try {
        await seedPeer(workDir, "umair-mbp");
        const result = runCli(root, ["mesh", "identity", "umair-mbp", "--json"]);
        assert.equal(result.status, 0, `identity <id> --json exits 0 (stderr: ${result.stderr})`);
        const record = JSON.parse(result.stdout);
        assert.equal(record.nodeId, "umair-mbp", "the JSON node record nodeId is umair-mbp");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: aof mesh status renders the node roster ════════════════════════
  {
    name: "mesh-identity-cli-face/02 aof mesh status renders the node roster",
    async run() {
      const { root, workDir } = await buildFixture();
      try {
        await seedPeer(workDir, "umair-desktop");
        await seedPeer(workDir, "umair-mbp");
        const json = runCli(root, ["mesh", "status", "--json"]);
        assert.equal(json.status, 0, `status --json exits 0 (stderr: ${json.stderr})`);
        const parsed = JSON.parse(json.stdout);
        assert.ok(Array.isArray(parsed.nodes), "the JSON has a 'nodes' array");
        const ids = parsed.nodes.map((n) => n.nodeId).sort();
        assert.deepEqual(ids, ["umair-desktop", "umair-mbp"], "both nodes carried with their ids");
        for (const node of parsed.nodes) {
          assert.ok(Array.isArray(node.runtimes) && Array.isArray(node.skills), "each node carries capabilities");
        }
        const human = runCli(root, ["mesh", "status"]);
        assert.equal(human.status, 0, `status exits 0 (stderr: ${human.stderr})`);
        assert.ok(/umair-desktop/.test(human.stdout) && /umair-mbp/.test(human.stdout), "the output lists each node with its id");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a bad invocation emits one structured error envelope ════
  {
    name: "mesh-identity-cli-face/02 a bad invocation emits one structured error envelope and exits non-zero",
    async run() {
      const { root, workDir } = await buildFixture();
      try {
        await seedPeer(workDir, "umair-mbp");
        const rows = [
          { invocation: ["identity", "never-synced"], code: "node-not-found" },
          { invocation: ["identity", ""], code: "invalid-input" },
          // m42 wave (d) leg d1 (wave 3) — the mesh verbs ride the ONE generic
          // face, whose spec-parse refusal is the MORE SPECIFIC "unknown-flag"
          // code (previously the mesh face folded it into "invalid-input").
          { invocation: ["identity", "--bogus-flag"], code: "unknown-flag" },
          { invocation: ["status", "--bogus-flag"], code: "unknown-flag" },
          { invocation: ["status", "umair-mbp"], code: "invalid-input" },
        ];
        for (const { invocation, code } of rows) {
          const result = runCli(root, ["mesh", ...invocation, "--json"]);
          assert.notEqual(result.status, 0, `aof mesh ${invocation.join(" ")} --json exits non-zero (got ${result.status})`);
          let parsed;
          assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `aof mesh ${invocation.join(" ")} --json is a single parseable JSON envelope (stdout: ${result.stdout.slice(0, 200)})`);
          assert.equal(parsed.ok, false, `${invocation.join(" ")} → ok:false`);
          assert.equal(parsed.code, code, `${invocation.join(" ")} → code:${code}`);
          assert.equal(typeof parsed.error, "string", `${invocation.join(" ")} → error message present`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: every --json invocation prints exactly one parseable JSON document ═
  {
    name: "mesh-identity-cli-face/02 every --json invocation prints exactly one parseable JSON document",
    async run() {
      const { root, workDir } = await buildFixture();
      try {
        await seedPeer(workDir, "umair-mbp");
        const invocations = [
          ["mesh", "identity", "--json"],
          ["mesh", "identity", "umair-mbp", "--json"],
          ["mesh", "status", "--json"],
          ["mesh", "identity", "never-synced", "--json"],
          ["mesh", "status", "--bogus-flag", "--json"],
        ];
        for (const args of invocations) {
          const result = runCli(root, args);
          // stdout parses as exactly ONE JSON document — JSON.parse over the whole
          // stdout succeeds (a human line before/after would break it).
          let parsed;
          assert.doesNotThrow(() => { parsed = JSON.parse(result.stdout); }, `${args.join(" ")} stdout parses as exactly one JSON document (stdout: ${result.stdout.slice(0, 200)})`);
          assert.ok(parsed !== undefined, `${args.join(" ")} produced a JSON value`);
          // No human-rendered line precedes or follows: stdout, trimmed, equals the
          // re-serialised parse (whitespace-only diff aside).
          assert.equal(result.stdout.trim(), JSON.stringify(parsed, null, 2), `${args.join(" ")} prints no human line around the JSON`);
        }
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
