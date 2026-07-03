// Traceability wiring for milestone 25 / story 02 / task 00 —
// tasks/00_mesh-ui-serve.feature (@executable).
//
// Covers EVERY @executable scenario / Scenario-Outline row: the `aof mesh ui`
// serve-face stands up ONE 127.0.0.1 server on its documented default port (4181),
// serving the built ui/dist bundle + the single GET /api/mesh/status route which
// answers the mesh:status aggregate (deep-equal to `aof mesh status --json` for the
// same fixture — one command, two faces); the /api/mesh namespace is DISJOINT from
// the board's frozen /api/work (a board request is a 404, never a proxied board); an
// unknown route is a clean { ok:false, error, code:"not-found" } envelope and a miss
// never crashes the server; a missing bundle + an occupied port are friendly refusals
// (the board's ui-build-missing / EADDRINUSE posture, mirrored), never a stack trace.
//
// Exercises the REAL server (serveMeshUi) against temp fixtures — a fixture ui/dist
// standing in for the built bundle, planted .mesh node/presence/registry records so
// the aggregate is non-empty, a real fetch, and the real CLI (spawn) for the parity
// oracle. node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, DEFAULT_MESH_UI_PORT, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// --- fixtures ----------------------------------------------------------------

// A repo whose .aof/aof.config.json points work.dir at wiki/work, with planted
// .mesh node/presence/registry records so the mesh:status aggregate is non-empty.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-serve-"));
  const workDir = path.join(repo, "wiki", "work");
  const meshDir = path.join(repo, ".aof", "mesh");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(path.join(meshDir, "nodes"), { recursive: true });
  await mkdir(path.join(meshDir, "presence"), { recursive: true });
  await mkdir(path.join(meshDir, "registry"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", runtimes: ["claude"], work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  // one live node
  await writeFile(
    path.join(meshDir, "nodes", "mac-studio.json"),
    JSON.stringify({ nodeId: "mac-studio", host: "mac-studio", os: "darwin", runtimes: ["claude"], skills: ["a", "b"], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "presence", "mac-studio.json"),
    JSON.stringify({ nodeId: "mac-studio", heartbeatAt: new Date().toISOString(), activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
  // a registered board
  await writeFile(
    path.join(meshDir, "registry", "group.json"),
    JSON.stringify({ roster: [{ nodeId: "mac-studio", admittedAt: "2026-07-01T00:00:00.000Z", boards: ["let-shield"] }], boards: ["let-shield"], pending: [], revocations: [] }, null, 2),
    "utf8"
  );
  return { repo, workDir };
}

// Write a directory that stands in for the BUILT bundle (ui/dist): an index.html
// referencing a hashed asset, plus the asset — the same shape board-serve.test uses.
async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    [
      "<!doctype html>",
      "<html>",
      "  <head>",
      "    <meta charset=\"UTF-8\" />",
      "    <script type=\"module\" crossorigin src=\"/assets/index-abc123.js\"></script>",
      "  </head>",
      "  <body><div id=\"root\"></div></body>",
      "</html>",
      "",
    ].join("\n"),
    "utf8"
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
  return dir;
}

// A repoRoot fixture whose ui/dist holds a built bundle so serveMeshUi(repoRoot)
// resolves to a dir with index.html — mirrors board-serve.test's repoRoot fixture.
async function makeRepoRootWithDist() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-root-"));
  await writeDist(meshUiDist(root));
  return root;
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

// The CLI --json parity oracle: run `aof mesh status --json` against the SAME
// fixture repo (a separate process reading the fixture disk — it never talks to the
// fleet server, so spawnSync is safe here) and parse its stdout.
function cliStatusJson(repo) {
  const result = spawnCliSync(process.execPath, [cliPath, "mesh", "status", "--json"], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, NODE_NO_WARNINGS: "1" },
  });
  assert.equal(result.status, 0, `aof mesh status --json exits 0 (stderr: ${result.stderr})`);
  return JSON.parse(result.stdout);
}

export const meshUiServeTests = [
  // ═══ Scenario: aof mesh ui starts the fleet server on 127.0.0.1 ═══════════
  {
    name: "mesh-ui-serve/00 the fleet server starts, binds 127.0.0.1, and the page + its API answer on one same-origin port",
    async run() {
      const { repo } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        let fleetUrl;
        ({ server, url, fleetUrl } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root }));
        const address = server.address();
        assert.equal(address.address, "127.0.0.1", "the server binds 127.0.0.1");
        // the announce carries the ?mode=fleet selector (the single bundle, fleet mode)
        assert.ok(fleetUrl.includes("mode=fleet"), "the returned fleetUrl carries ?mode=fleet");

        // the fleet page (static index) and its API answer on the SAME origin/port
        const page = await fetch(new URL("/", url));
        assert.equal(page.status, 200, "the fleet page serves on the one origin");
        const pageBody = await page.text();
        assert.ok(pageBody.includes("/assets/"), "the served index is the built bundle (references /assets/)");
        assert.ok(!pageBody.includes("/src/main.tsx"), "it serves the built index, not the dev source");

        const api = await fetch(new URL("/api/mesh/status", url));
        assert.equal(api.status, 200, "GET /api/mesh/status answers on the same port");
        assert.ok(api.headers.get("content-type")?.includes("application/json"), "the API returns JSON");
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // The documented default port literal (4181) is exported + distinct from the
  // board's 4180 and assets-ui's 4177/4178 (a build-time choice the feature pins).
  {
    name: "mesh-ui-serve/00 the documented default port is 4181, distinct from the board's 4180 and assets-ui 4177/4178",
    async run() {
      assert.equal(DEFAULT_MESH_UI_PORT, 4181, "the fleet default port is 4181");
      for (const collided of [4177, 4178, 4180]) {
        assert.notEqual(DEFAULT_MESH_UI_PORT, collided, `4181 does not collide with ${collided}`);
      }
    },
  },

  // ═══ Scenario: a missing UI build is refused with the friendly build-missing line ═══
  {
    name: "mesh-ui-serve/00 a missing ui/dist build is a friendly ui-build-missing refusal, not a crash",
    async run() {
      const { repo } = await makeRepo();
      // a repoRoot WITHOUT ui/dist
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-nobuild-"));
      let rejected;
      let server;
      try {
        try {
          ({ server } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root }));
        } catch (error) {
          rejected = error;
        }
        assert.ok(rejected, "serveMeshUi rejects when the build is missing");
        assert.equal(rejected.code, "ui-build-missing", "the rejection carries the ui-build-missing code");
        assert.ok(
          /build/i.test(rejected.message) && /npm --prefix ui run build/.test(rejected.message),
          "the message tells the operator to build the UI first"
        );
        assert.equal(server, undefined, "no server was left listening");
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ═══ Scenario: a port already in use is refused with the friendly port-in-use line ═══
  // The serve-face rejects with EADDRINUSE (the CLI verb maps it to the friendly
  // "Port N is already in use. Pass --port <n> to pick another." line) — the
  // structural half here is that binding an occupied port rejects, not crashes.
  {
    name: "mesh-ui-serve/00 an occupied port rejects with EADDRINUSE (the friendly port-in-use refusal), not a crash",
    async run() {
      const { repo } = await makeRepo();
      const root = await makeRepoRootWithDist();
      // occupy a port with a throwaway server
      const blocker = http.createServer(() => {});
      await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
      const occupied = blocker.address().port;
      let rejected;
      let server;
      try {
        try {
          ({ server } = await serveMeshUi({ projectDir: repo, port: occupied, repoRoot: root }));
        } catch (error) {
          rejected = error;
        }
        assert.ok(rejected, "serveMeshUi rejects when the port is occupied");
        assert.equal(rejected.code, "EADDRINUSE", "the rejection is a benign EADDRINUSE the CLI maps to the friendly line");
      } finally {
        if (server) await closeServer(server);
        await new Promise((resolve) => blocker.close(resolve));
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ═══ Scenario: GET /api/mesh/status answers the mesh:status aggregate ═══════
  // The load-bearing PARITY assertion (one command, two faces): the web payload
  // deep-equals what `aof mesh status --json` prints for the SAME fixture.
  {
    name: "mesh-ui-serve/00 GET /api/mesh/status carries the nodes-and-boards aggregate and deep-equals `aof mesh status --json`",
    async run() {
      const { repo } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root }));
        const response = await fetch(new URL("/api/mesh/status", url));
        assert.equal(response.status, 200);
        const payload = await response.json();
        // it carries the nodes-and-boards aggregate mesh:status returns
        assert.ok(Array.isArray(payload.nodes), "the payload carries a nodes array");
        assert.ok(Array.isArray(payload.boards), "the payload carries a boards array");
        assert.ok(payload.nodes.some((n) => n.nodeId === "mac-studio"), "the planted node surfaces");
        assert.ok(payload.boards.some((b) => b.ref === "let-shield"), "the registered board surfaces");

        // deep-equals the CLI --json for the same fixture (the parity oracle)
        const cli = cliStatusJson(repo);
        assert.deepEqual(payload, cli, "the /api/mesh/status payload deep-equals `aof mesh status --json` for the same fixture");
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ═══ Scenario: the fleet face serves no /api/work route ════════════════════
  {
    name: "mesh-ui-serve/00 the /api/mesh namespace is disjoint from /api/work — a board request is a 404, never a proxied board",
    async run() {
      const { repo } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root }));
        for (const route of ["/api/work/list", "/api/work/doc?ref=03&doc=SPEC", "/api/work/run-status?ref=03"]) {
          const response = await fetch(new URL(route, url));
          assert.equal(response.status, 404, `${route} is a 404 on the fleet face (no /api/work)`);
          const body = await response.json();
          assert.equal(body.ok, false, `${route} answers a clean error envelope`);
          assert.equal(body.code, "not-found", `${route} is a not-found, no board data proxied`);
        }
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ═══ Scenario Outline: an unknown /api/mesh route answers a clean not-found and the server survives ═══
  {
    name: "mesh-ui-serve/00 an unknown /api/mesh route answers a clean not-found envelope and a follow-up read proves the miss did not crash the server",
    async run() {
      const routes = ["/api/mesh/does-not-exist", "/api/mesh/status/extra", "/api/mesh/"];
      const { repo } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root }));
        for (const route of routes) {
          const response = await fetch(new URL(route, url));
          assert.equal(response.status, 404, `${route} is a 404`);
          const body = await response.json();
          assert.deepEqual(
            Object.keys(body).sort(),
            ["code", "error", "ok"],
            `${route} carries exactly { ok, error, code }`
          );
          assert.equal(body.ok, false, `${route} → ok:false`);
          assert.equal(body.code, "not-found", `${route} → code:"not-found"`);

          // a follow-up read still answers — the miss did not crash the server
          const followup = await fetch(new URL("/api/mesh/status", url));
          assert.equal(followup.status, 200, `after ${route}, /api/mesh/status still answers (server survived)`);
        }
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
