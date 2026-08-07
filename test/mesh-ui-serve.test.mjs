// Traceability wiring for milestone 25 / story 02 / task 00 —
// tasks/00_mesh-ui-serve.feature (@executable).
//
// Covers EVERY @executable scenario / Scenario-Outline row: the `aof mesh ui`
// serve-face stands up ONE 127.0.0.1 server on its documented default port (4181),
// serving the built ui/dist bundle, the GET /api/mesh/status route which
// answers the global mesh projection (with --local narrowing work items to the
// current workspace), and GET /api/mesh/board-url for real board drill-ins; the /api/mesh namespace is DISJOINT from
// the board's frozen /api/work (a board request is a 404, never a proxied board); an
// unknown route is a clean { ok:false, error, code:"not-found" } envelope and a miss
// never crashes the server; a missing bundle + an occupied port are friendly refusals
// (the board's ui-build-missing / EADDRINUSE posture, mirrored), never a stack trace.
//
// Exercises the REAL server (serveMeshUi) against temp fixtures — a fixture ui/dist
// standing in for the built bundle, an isolated global projection store, and real
// fetches against the server. node:assert/strict.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, DEFAULT_MESH_UI_PORT, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// --- fixtures ----------------------------------------------------------------

// A repo whose config points work.dir at wiki/work, with one work item and one
// node record published into an isolated global mesh projection store.
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-serve-"));
  const workDir = path.join(repo, "wiki", "work");
  const globalHome = path.join(repo, "global-home");
  const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 34\nslug: global-mesh\nstatus: in-progress\ntitle: Global Mesh\n---\n",
    "utf8"
  );
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", runtimes: ["claude"], work: { dir: "./wiki/work" }, mesh: { enabled: true, relay: { controlNode: "mac-studio" } } }, null, 2),
    "utf8"
  );

  const globalStoreOptions = { env: { AOF_GLOBAL_HOME: globalHome } };
  const workspace = await loadWorkspace(repo, undefined, globalStoreOptions);
  await publishNodeRecord(workspace, "mac-studio", {
    nodeId: "mac-studio",
    host: "mac-studio",
    os: "darwin",
    runtimes: ["claude"],
    skills: ["a", "b"],
    aofVersion: "0.1.0",
    publishedAt: "2026-06-29T00:00:00.000Z",
  });
  const store = await openGlobalWorkProjectionStore(globalStoreOptions);
  try {
    await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-04T10:05:00.000Z" });
    await publishGlobalRegistryDescriptorsToStore(store, workspace, { now: "2026-07-04T10:05:00.000Z" });
  } finally {
    store.close();
  }

  return { repo, workDir, globalStoreOptions };
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

export const meshUiServeTests = [
  // ═══ Scenario: aof mesh ui starts the fleet server on 127.0.0.1 ═══════════
  {
    name: "mesh-ui-serve/00 the fleet server starts, binds 127.0.0.1, and the page + its API answer on one same-origin port",
    async run() {
      const { repo, globalStoreOptions } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        let fleetUrl;
        // scope:"local" — this scenario is about serve MECHANICS (one origin, the
        // static bundle + the API), not the global-vs-local data source, so it stays
        // isolated from whatever global store (if any) exists on the host machine.
        ({ server, url, fleetUrl } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "local", globalStoreOptions }));
        const address = server.address();
        assert.equal(address.address, "127.0.0.1", "the server binds 127.0.0.1");
        // m45 / story 04 (ADR-002) — the announce names the fleet's PATH on this server's
        // own origin; the `?mode=fleet` selector it used to carry is retired (a bookmark
        // of it still works — ADR-003 translates it at the entry — but nothing mints it).
        // Parsed, never matched as a substring: `…/fleet&scope=global` would pass an
        // `includes("/fleet")` while being a pathname with no parameters at all.
        const parsedFleetUrl = new URL(fleetUrl);
        assert.equal(parsedFleetUrl.pathname, "/fleet", "the returned fleetUrl names the ADR-002 fleet path");
        assert.equal(parsedFleetUrl.searchParams.get("mode"), null, "…and no `mode` selector survives on it");
        assert.equal(parsedFleetUrl.host, `127.0.0.1:${address.port}`, "…on this server's own origin");

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
      const { repo, globalStoreOptions } = await makeRepo();
      // a repoRoot WITHOUT ui/dist
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-nobuild-"));
      let rejected;
      let server;
      try {
        try {
          ({ server } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, globalStoreOptions }));
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
      const { repo, globalStoreOptions } = await makeRepo();
      const root = await makeRepoRootWithDist();
      // occupy a port with a throwaway server
      const blocker = http.createServer(() => {});
      await new Promise((resolve) => blocker.listen(0, "127.0.0.1", resolve));
      const occupied = blocker.address().port;
      let rejected;
      let server;
      try {
        try {
          ({ server } = await serveMeshUi({ projectDir: repo, port: occupied, repoRoot: root, globalStoreOptions }));
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

  // ═══ Scenario: GET /api/mesh/status answers the local-filtered global projection ═══
  // milestone 34 / story 03 (ADR-006): local mode is the same machine-wide
  // projection with work items narrowed to the current workspace id; nodes remain
  // machine-wide.
  {
    name: "mesh-ui-serve/00 GET /api/mesh/status carries the local-filtered global projection (scope: local)",
    async run() {
      const { repo, globalStoreOptions } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "local", globalStoreOptions }));
        const response = await fetch(new URL("/api/mesh/status", url));
        assert.equal(response.status, 200);
        const payload = await response.json();
        assert.ok(Array.isArray(payload.nodes), "the payload carries a machine-wide nodes array");
        assert.ok(Array.isArray(payload.workspaces), "the payload carries a workspaces array");
        assert.ok(Array.isArray(payload.items), "the payload carries a work items array");
        assert.equal(payload.scope, "local");
        assert.equal(payload.currentWorkspace, path.resolve(repo));
        assert.ok(payload.nodes.some((n) => n.nodeId === "mac-studio"), "the planted node surfaces");
        assert.ok(payload.workspaces.some((w) => w.projectRoot === path.resolve(repo)), "the current workspace surfaces");
        assert.ok(payload.items.some((item) => item.ref === "34" && item.slug === "global-mesh"), "the planted work item surfaces");
        assert.ok(payload.items.every((item) => item.workspaceId === payload.workspaceId), "local scope filters work items to the current workspace id");
        assert.ok(payload.nodes.some((n) => n.workspaceIds?.includes(payload.workspaceId)), "the machine-wide node roster retains workspace membership");
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
      const { repo, globalStoreOptions } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        // scope:"local" — the /api/work disjoint-namespace concern is orthogonal to
        // global-vs-local; isolated from the ambient global store.
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "local", globalStoreOptions }));
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


  // ═══ Scenario: a milestone drill-in opens a real workspace board URL ═══════
  {
    name: "mesh-ui-serve/00 board-url drill-in starts and reuses the selected workspace's real board server",
    async run() {
      const { repo, globalStoreOptions } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "global", globalStoreOptions }));
        const statusResponse = await fetch(new URL("/api/mesh/status", url));
        assert.equal(statusResponse.status, 200, "the global mesh status answers");
        const status = await statusResponse.json();
        const workspaceId = status.workspaces[0]?.workspaceId;
        assert.ok(workspaceId, "the fixture publishes a workspace id");

        const firstResponse = await fetch(new URL(`/api/mesh/board-url?workspaceId=${encodeURIComponent(workspaceId)}&ref=34`, url));
        assert.equal(firstResponse.status, 200, "the board-url route answers");
        const first = await firstResponse.json();
        assert.equal(first.workspaceId, workspaceId, "the response is for the selected workspace");
        assert.equal(first.ref, "34", "the response carries the requested milestone ref");
        // m45 / story 04 (ADR-002) — the drill-in URL is the board's PATH on the
        // workspace's OWN board origin, and its `#ref` fragment is unchanged. Parsed
        // rather than substring-matched, for the same reason as the announce above.
        const parsedDrillIn = new URL(first.url);
        assert.equal(parsedDrillIn.pathname, "/board", "the drill-in URL names the ADR-002 board path");
        assert.equal(parsedDrillIn.searchParams.get("mode"), null, "…with no `mode` selector on it");
        assert.equal(parsedDrillIn.hash, "#34", "…and it still selects the requested milestone by fragment");

        const boardList = await fetch(new URL("/api/work/list", first.url));
        assert.equal(boardList.status, 200, "the returned board origin serves /api/work/list");
        // m43 / story 04 (ADR-010/R4.1) — the board route answers the
        // `{ items, stalenessSeconds }` envelope; the drill-in assertion is about WHICH
        // workspace's stream the returned origin serves, which is unmoved.
        const items = (await boardList.json()).items;
        assert.ok(items.some((item) => item.ref === "34" && item.title === "Global Mesh"), "the board serves the selected workspace's work stream");

        const secondResponse = await fetch(new URL(`/api/mesh/board-url?workspaceId=${encodeURIComponent(workspaceId)}&ref=34`, url));
        assert.equal(secondResponse.status, 200, "a second drill-in answers");
        const second = await secondResponse.json();
        assert.equal(second.url, first.url, "the workspace board server is reused, not relaunched per click");
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
      const { repo, globalStoreOptions } = await makeRepo();
      const root = await makeRepoRootWithDist();
      let server;
      try {
        let url;
        // scope:"local" — the unknown-route survival concern is orthogonal to
        // global-vs-local; isolated from the ambient global store.
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "local", globalStoreOptions }));
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
