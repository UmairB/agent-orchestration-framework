// Fitness function: acd-mesh-ui-write-isolation (milestone 25 / story 02;
// ARCHITECTURE 25/ADR-003 decision 5 + ADR-004 read-only — the 03/ADR-004
// write-isolation posture mirrored onto the fleet face; the mesh-face sibling of
// acd-board-write-isolation).
//
// "The fleet face performs ZERO fs write and NO shell-out (read-only render); it
//  serves NO /ws/terminal and no write route."
//
// A structural grep of src/mesh-ui-serve.mjs (comments discounted) PLUS a
// behavioural snapshot: serving the fleet view end-to-end (a static GET, several
// GET /api/mesh/status reads) mutates NO file under the workspace fixture.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function snapshotDir(dir) {
  const snap = new Map();
  async function walk(current) {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await stat(full);
        snap.set(full, `${info.mtimeMs}:${await readFile(full, "utf8")}`);
      }
    }
  }
  await walk(dir);
  return snap;
}

function diffSnapshots(before, after) {
  const changed = [];
  for (const [file, value] of after) if (before.get(file) !== value) changed.push(file);
  for (const file of before.keys()) if (!after.has(file)) changed.push(file);
  return changed;
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-write-iso-"));
  const workDir = path.join(repo, "wiki", "work");
  const meshDir = path.join(workDir, ".mesh");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(path.join(meshDir, "nodes"), { recursive: true });
  await mkdir(path.join(meshDir, "presence"), { recursive: true });
  await mkdir(path.join(meshDir, "registry"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "nodes", "n1.json"),
    JSON.stringify({ nodeId: "n1", host: "n1", os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "presence", "n1.json"),
    JSON.stringify({ nodeId: "n1", heartbeatAt: new Date().toISOString(), activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "registry", "group.json"),
    JSON.stringify({ roster: [{ nodeId: "n1", admittedAt: "2026-07-01T00:00:00.000Z", boards: ["b1"] }], boards: ["b1"], pending: [], revocations: [] }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=\"root\"></div></body></html>\n",
    "utf8"
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
  return dir;
}

export const archTests = [
  {
    name: "arch/25 ADR-004: mesh-ui-serve.mjs performs no fs write and no shell-out (read-only render)",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));
      // No fs-write call form.
      for (const verb of ["writeFile", "appendFile", "writeFileSync", "appendFileSync", "mkdir", "rm", "rmdir", "unlink", "rename"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( call — the fleet face writes nothing`
        );
      }
      // No shell-out.
      assert.ok(!/child_process/.test(source), "mesh-ui-serve.mjs imports no child_process");
      for (const verb of ["spawn", "spawnSync", "exec", "execSync", "execFile"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( shell-out`
        );
      }
    },
  },
  {
    name: "arch/25 ADR-003/004: mesh-ui-serve.mjs serves no /ws/terminal and no write route",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));
      // No terminal websocket route/path.
      assert.ok(!/["']\/ws\/terminal["']/.test(source), "mesh-ui-serve.mjs serves no /ws/terminal path");
      assert.ok(!/["']\/ws\//.test(source) || !/pathname\s*===\s*["']\/ws\//.test(source), "mesh-ui-serve.mjs declares no /ws/ HTTP route");
      // No write route: the one API route is a GET-only /api/mesh/status. A POST/PUT/
      // PATCH/DELETE handler on any /api/mesh route would be a write surface — the face
      // rejects those methods (a 405), it never routes them to a mutation.
      assert.ok(
        !/pathname\s*===\s*["']\/api\/mesh\/(issue|assign|route|revoke)["']/.test(source),
        "mesh-ui-serve.mjs declares no /api/mesh/issue|assign|route|revoke write route (m27 adds those)"
      );
      // The face rejects non-GET methods on its one route (read-only) rather than
      // dispatching them to a mutation — a method-guard is present.
      assert.ok(
        /request\.method\s*!==\s*["']GET["']/.test(source),
        "mesh-ui-serve.mjs guards its one route to GET (read-only) — a write method is rejected, never dispatched"
      );
    },
  },
  {
    name: "arch/25 ADR-004 (behavioural): serving the fleet view + reading /api/mesh/status repeatedly mutates no file under the workspace",
    run: async () => {
      const { repo, workDir } = await makeRepo();
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-write-iso-root-"));
      await writeDist(meshUiDist(root));
      let server;
      try {
        const before = await snapshotDir(workDir);
        let url;
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root }));
        // Serve the page + read the aggregate several times.
        await fetch(new URL("/", url));
        for (let i = 0; i < 3; i += 1) {
          const res = await fetch(new URL("/api/mesh/status", url));
          assert.equal(res.status, 200, "the aggregate read answers");
        }
        const after = await snapshotDir(workDir);
        assert.deepEqual(
          diffSnapshots(before, after),
          [],
          "serving + reading the fleet view changed no file under the workspace (read-only render)"
        );
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
