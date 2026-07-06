// Fitness function: acd-mesh-ui-single-server (milestone 25 / story 02;
// ARCHITECTURE 25/ADR-003 decision 2 — the 03/ADR-001 single-server precedent,
// mirrored onto the fleet face; the mesh-face sibling of acd-board-single-server).
//
// "The fleet face is served by exactly ONE http.createServer bound to 127.0.0.1; no
//  second server/port; the fleet HTTP routes live under /api/mesh* and NEVER
//  /api/work*."
//
// A structural grep of src/mesh-ui-serve.mjs (comments discounted, the call-form
// discipline) PLUS a behavioural stand-up: serveMeshUi answers GET /api/mesh/status
// as JSON on the same 127.0.0.1 port that serves the static bundle, and a /api/work
// request is a 404 (the namespaces are disjoint).
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-single-server-"));
  const meshDir = path.join(repo, ".aof", "mesh");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(path.join(meshDir, "nodes"), { recursive: true });
  await mkdir(path.join(meshDir, "presence"), { recursive: true });
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
  return repo;
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
    name: "arch/25 ADR-003: exactly ONE http.createServer bound to 127.0.0.1 in the fleet serve surface",
    run: async () => {
      const source = await readFile(MESH_UI_SERVE, "utf8");
      const clean = stripComments(source);
      // Count the CALL form `http.createServer(` — a comment naming the invariant is fine.
      const createServerCount = (clean.match(/http\.createServer\s*\(/g) ?? []).length;
      assert.equal(createServerCount, 1, "exactly one http.createServer call in mesh-ui-serve.mjs");
      // The one server binds 127.0.0.1 (the same-origin isolation model, ADR-004).
      assert.ok(
        /\.listen\s*\(\s*[^,]+,\s*["']127\.0\.0\.1["']/.test(clean),
        "the one server binds 127.0.0.1 (server.listen(port, \"127.0.0.1\", …))"
      );
      // No second server is stood up (no WebSocketServer, no attachTerminalWebSocket).
      assert.ok(!/new WebSocketServer\s*\(/.test(clean), "the fleet face stands up no WebSocketServer");
      assert.ok(!/attachTerminalWebSocket\s*\(/.test(clean), "the fleet face does not attach a terminal WebSocket");
    },
  },
  {
    name: "arch/25 ADR-003: the fleet HTTP routes live under /api/mesh* and NEVER /api/work*",
    run: async () => {
      const clean = stripComments(await readFile(MESH_UI_SERVE, "utf8"));
      // The one declared API route is /api/mesh/status.
      assert.ok(
        /pathname\s*===\s*["']\/api\/mesh\/status["']/.test(clean),
        "mesh-ui-serve.mjs declares the GET /api/mesh/status route"
      );
      // No /api/work route (string or pathname compare) is declared by the fleet face.
      assert.ok(
        !/["']\/api\/work/.test(clean),
        "mesh-ui-serve.mjs declares no /api/work route — the fleet namespace is disjoint from the board's frozen envelope"
      );
      // No terminal-ws upgrade route is served (that is one level down, in the board).
      assert.ok(!/["']\/ws\/terminal["']/.test(clean), "mesh-ui-serve.mjs serves no /ws/terminal");
    },
  },
  {
    name: "arch/25 ADR-003 (behavioural): GET /api/mesh/status answers JSON on the same 127.0.0.1 port that serves the bundle, and /api/work is a 404",
    run: async () => {
      const repo = await makeRepo();
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-single-server-root-"));
      await writeDist(meshUiDist(root));
      let server;
      try {
        let url;
        // scope:"local" (milestone 34 / story 03, ADR-006) — this fitness assertion
        // is about the single-server/disjoint-namespace INVARIANT, orthogonal to
        // global-vs-local; isolated from the ambient global store.
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "local" }));
        const address = server.address();
        assert.equal(address.address, "127.0.0.1", "the fleet server binds 127.0.0.1");

        // GET /api/mesh/status answers JSON.
        const apiRes = await fetch(new URL("/api/mesh/status", url));
        assert.equal(apiRes.status, 200, "the fleet API answers");
        assert.ok(apiRes.headers.get("content-type")?.includes("application/json"), "the API returns JSON");
        const body = await apiRes.json();
        assert.ok(Array.isArray(body.nodes), "the aggregate carries nodes");

        // A static GET serves (index.html) on the SAME port.
        const staticRes = await fetch(new URL("/", url));
        assert.equal(staticRes.status, 200, "a static GET serves on the same port");

        // A /api/work request is a 404 on the fleet face (disjoint namespace).
        const workRes = await fetch(new URL("/api/work/list", url));
        assert.equal(workRes.status, 404, "a /api/work request is a 404 on the fleet face");
        assert.equal((await workRes.json()).code, "not-found", "it is a clean not-found, no board proxied");
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
