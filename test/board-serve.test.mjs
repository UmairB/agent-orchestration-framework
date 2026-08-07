// Traceability wiring for milestone 03 / story 01 / task 05 (finding F-1):
// 05_serve-board-same-origin.feature.
//
// Covers the @executable scenarios that pin the F-1 fix: serveSetupUi serves the
// BUILT bundle (a uiRoot override) — not the vite-only dev source — so the
// same-origin /api/work* fetches and the window.location.host /ws/terminal stream
// both resolve on ONE 127.0.0.1 origin, and a first-class command launches it
// (serveBoard) reporting an honest degrade when the build is absent.
//
// Exercises the REAL server (serveSetupUi / serveBoard) against temp fixtures —
// a fixture ui/dist standing in for the built bundle, a stub spawn (no PTY), a
// real fetch, and a real ws client.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveSetupUi } from "../src/setup-ui.mjs";
import { serveBoard, boardUiDist } from "../src/board-serve.mjs";

// --- fixtures ----------------------------------------------------------------

// A repo whose .aof/aof.config.json points work.dir at wiki/work, with one
// milestone so /api/work/list returns a non-empty array (mirrors makeRepo in the
// single-server fitness function).
async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-board-serve-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(workDir, { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  await mkdir(path.join(workDir, "03_milestone_board"), { recursive: true });
  await writeFile(
    path.join(workDir, "03_milestone_board", "SPEC.md"),
    "---\ntype: milestone\nnumber: \"03\"\nslug: board\nstatus: in-progress\ntitle: \"Board\"\ncreated: 2026-06-19\nupdated: 2026-06-19\n---\n# 03\n",
    "utf8"
  );
  return { repo, workDir };
}

// Write a directory that stands in for the BUILT bundle (ui/dist): an index.html
// whose body references a hashed bundle under /assets/, plus the asset file.
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
  await writeFile(
    path.join(dir, "assets", "index-abc123.js"),
    "export const x = 1;\n",
    "utf8"
  );
  return dir;
}

// A stub spawn so a /ws/terminal handshake completes without touching node-pty.
function stubSpawn() {
  return () => ({
    pid: 1,
    onData() { return { dispose() {} }; },
    onExit() { return { dispose() {} }; },
    write() {},
    resize() {},
    kill() {},
  });
}

function openSocket(wsUrl, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      reject(new Error("WS handshake timed out"));
    }, timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve(ws);
    });
    ws.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

export const boardServeTests = [
  // === serveSetupUi serves the BUILT bundle, not the dev source =============
  {
    name: "board-serve/05 serving with a built uiRoot returns the built index, not the dev source",
    async run() {
      const { repo } = await makeRepo();
      const dist = await writeDist(await mkdtemp(path.join(os.tmpdir(), "aof-board-dist-")));
      let server;
      try {
        let url;
        ({ server, url } = await serveSetupUi(null, { projectDir: repo, port: 0, uiRoot: dist }));
        const response = await fetch(new URL("/", url));
        assert.equal(response.status, 200, "the root serves the built index");
        const body = await response.text();
        assert.ok(body.includes("/assets/"), "the built index references the hashed bundle under /assets/");
        assert.ok(!body.includes("/src/main.tsx"), "the served index does not reference the vite-only dev source");
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(dist, { recursive: true, force: true });
      }
    },
  },

  // === API + bundle asset + terminal WS all resolve on the one origin =======
  {
    name: "board-serve/05 the API, a bundle asset, and the terminal WS all resolve on the one served origin",
    async run() {
      const { repo } = await makeRepo();
      const dist = await writeDist(await mkdtemp(path.join(os.tmpdir(), "aof-board-dist-")));
      let server;
      try {
        let url;
        ({ server, url } = await serveSetupUi(null, { projectDir: repo, port: 0, uiRoot: dist, spawn: stubSpawn() }));
        const port = server.address().port;

        // The work-list API answers on the same origin. m43 / story 04 (ADR-010/R4.1): the
        // route's response is the `{ items, stalenessSeconds }` envelope — the rows are
        // still a flat array, one level down. This scenario's subject is the ONE ORIGIN,
        // which is unmoved.
        const apiRes = await fetch(new URL("/api/work/list", url));
        assert.equal(apiRes.status, 200, "the work-list API answers");
        const list = (await apiRes.json()).items;
        assert.ok(Array.isArray(list), "the rows are a flat JSON array");
        assert.ok(list.length >= 1, "the array is non-empty");

        // The hashed bundle asset serves with a JavaScript content type.
        const assetRes = await fetch(new URL("/assets/index-abc123.js", url));
        assert.equal(assetRes.status, 200, "the hashed bundle asset serves");
        assert.ok(
          assetRes.headers.get("content-type")?.includes("text/javascript"),
          "the asset is served with a JavaScript content type"
        );

        // The terminal WS handshake opens on the SAME port.
        const ws = await openSocket(`ws://127.0.0.1:${port}/ws/terminal?ref=03&provider=claude`);
        assert.equal(ws.readyState, WebSocket.OPEN, "the handshake succeeds on the same port");
        await new Promise((resolve) => { ws.on("close", resolve); ws.close(); });
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(dist, { recursive: true, force: true });
      }
    },
  },

  // === the launch command serves the build + a board-mode URL ===============
  {
    name: "board-serve/05 the board launch command serves the built bundle and prints the board-mode URL",
    async run() {
      const { repo } = await makeRepo();
      // A fixture repoRoot whose ui/dist holds the built index, so
      // boardUiDist(repoRoot) resolves to a dir with index.html.
      const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aof-board-root-"));
      await writeDist(boardUiDist(repoRoot));
      let server;
      try {
        let url;
        let boardUrl;
        ({ server, url, boardUrl } = await serveBoard({ projectDir: repo, port: 0, repoRoot, spawn: stubSpawn() }));
        // m45 / story 04 (ADR-002) — the announced URL is the board's PATH, not the
        // retired `?mode=board` selector. Read through `new URL` rather than as a
        // substring: `…/board&x=1` would satisfy an `includes("/board")` while parsing as
        // a pathname of `/board&x=1` (the glued-query failure this story's traps name).
        const parsedBoardUrl = new URL(boardUrl);
        assert.equal(parsedBoardUrl.pathname, "/board", "the returned boardUrl names the ADR-002 board path");
        assert.equal(parsedBoardUrl.searchParams.get("mode"), null, "…and no `mode` selector survives on it");
        assert.equal(parsedBoardUrl.search, "", "…nor any other parameter this URL never carried");

        const response = await fetch(new URL("/", url));
        assert.equal(response.status, 200, "it serves the built board on a single 127.0.0.1 origin");
        const body = await response.text();
        assert.ok(body.includes("/assets/"), "it serves the built index, referencing /assets/");
        assert.ok(!body.includes("/src/main.tsx"), "it does not serve the dev source");
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(repoRoot, { recursive: true, force: true });
      }
    },
  },

  // === a missing build is reported, not served ==============================
  {
    name: "board-serve/05 a missing build is reported, not silently served from source",
    async run() {
      const { repo } = await makeRepo();
      // A repoRoot WITHOUT ui/dist.
      const repoRoot = await mkdtemp(path.join(os.tmpdir(), "aof-board-nobuild-"));
      let rejected;
      let server;
      try {
        try {
          ({ server } = await serveBoard({ projectDir: repo, port: 0, repoRoot }));
        } catch (error) {
          rejected = error;
        }
        assert.ok(rejected, "serveBoard rejects when the build is missing");
        assert.equal(rejected.code, "ui-build-missing", "the rejection carries the ui-build-missing code");
        assert.ok(
          /build/.test(rejected.message) && /npm --prefix ui run build/.test(rejected.message),
          "the message reports the build is missing and how to produce it"
        );
        assert.equal(server, undefined, "no server was left listening");
      } finally {
        if (server) await closeServer(server);
        await rm(repo, { recursive: true, force: true });
        await rm(repoRoot, { recursive: true, force: true });
      }
    },
  },
];
