// Fitness function for milestone 03 / ADR-001:
// "The board surface is served by exactly ONE http.createServer on one 127.0.0.1
//  port; the board's HTTP routes live only under /api/work* and the terminal
//  WebSocket only at /ws/terminal (via `ws` noServer + server.on('upgrade'));
//  there is no second http.createServer and no second port for the terminal."
//
// Source-grep the UI-server surface (setup-ui.mjs + terminal-ws.mjs) AND a
// behavioural check: stand up serveSetupUi (stub spawn, no real PTY) and assert a
// GET /api/work/list returns JSON, a static GET serves, AND a WS handshake to
// /ws/terminal succeeds on the SAME port.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { serveSetupUi } from "../../src/setup-ui.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-single-server-"));
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
  return repo;
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

export const archTests = [
  {
    name: "arch/ADR-001: exactly ONE http.createServer across the UI-server surface",
    run: async () => {
      const setupUi = await readFile(path.join(repoRoot, "src", "setup-ui.mjs"), "utf8");
      const terminalWs = await readFile(path.join(repoRoot, "src", "terminal-ws.mjs"), "utf8");
      const combined = setupUi + "\n" + terminalWs;
      // Count the CALL form `http.createServer(` — the structural invariant — so a
      // comment that merely names the invariant ("one http.createServer") is fine.
      const createServerCount = (combined.match(/http\.createServer\s*\(/g) ?? []).length;
      assert.equal(createServerCount, 1, "exactly one http.createServer call in the UI-server surface");
      // The single createServer lives in setup-ui.mjs; terminal-ws.mjs attaches.
      assert.ok(/http\.createServer\s*\(/.test(setupUi), "the one http.createServer call is in setup-ui.mjs");
      assert.ok(!/http\.createServer\s*\(/.test(terminalWs), "terminal-ws.mjs stands up NO server of its own");
    },
  },
  {
    name: "arch/ADR-001: the terminal is wired via server.on('upgrade') + noServer, routing only /ws/terminal",
    run: async () => {
      const terminalWs = await readFile(path.join(repoRoot, "src", "terminal-ws.mjs"), "utf8");
      assert.ok(/server\.on\(\s*["']upgrade["']/.test(terminalWs), "wires the HTTP upgrade event");
      assert.ok(/new WebSocketServer\(\s*\{\s*noServer:\s*true/.test(terminalWs), "uses a noServer WebSocketServer");
      assert.ok(/handleUpgrade\(/.test(terminalWs), "completes the upgrade via handleUpgrade");
      // The only routed WS pathname is /ws/terminal.
      const wsPaths = [...terminalWs.matchAll(/["'](\/ws\/[\w-]+)["']/g)].map((m) => m[1]);
      const unique = [...new Set(wsPaths)];
      assert.deepEqual(unique, ["/ws/terminal"], "the single WS pathname is /ws/terminal");
      // A non-matching upgrade is destroyed (the ws default branch).
      assert.ok(/socket\.destroy\(\)/.test(terminalWs), "an unknown upgrade pathname is socket.destroy()'d");
    },
  },
  {
    name: "arch/ADR-001: no board HTTP route begins with /ws/ (the namespaces are disjoint)",
    run: async () => {
      const boardUi = await readFile(path.join(repoRoot, "src", "board-ui.mjs"), "utf8");
      const setupUi = await readFile(path.join(repoRoot, "src", "setup-ui.mjs"), "utf8");
      // Board HTTP routes live under /api/work*; none is a /ws/ string.
      for (const [label, text] of [["board-ui.mjs", boardUi], ["setup-ui.mjs", setupUi]]) {
        const wsRoutes = [...text.matchAll(/pathname\s*===\s*["'](\/ws\/[^"']*)["']/g)];
        assert.equal(wsRoutes.length, 0, `${label} declares no HTTP route under /ws/`);
      }
    },
  },
  {
    name: "arch/ADR-001 (behavioural): /api/work/list, a static GET, and a /ws/terminal handshake all succeed on the SAME port",
    run: async () => {
      const repo = await makeRepo();
      const { server, url } = await serveSetupUi(null, { projectDir: repo, port: 0, spawn: stubSpawn() });
      const address = server.address();
      try {
        // GET /api/work/list returns JSON.
        const apiRes = await fetch(new URL("/api/work/list", url));
        assert.equal(apiRes.status, 200, "the HTTP API answers");
        assert.ok(apiRes.headers.get("content-type")?.includes("application/json"), "the API returns JSON");
        const list = await apiRes.json();
        // m43 / story 04 (ADR-010/R4.1) — the board's list ROUTE now answers the envelope
        // `{ items, stalenessSeconds }`: the cache-staleness window is ONE number for the
        // whole response, so it has no honest home on a row, and the envelope is the one
        // place to put it. (`work:list`'s command result and `aof work list --json`'s flat
        // array are untouched — that split is the point of R4.1.) The rows still arrive as
        // a JSON array, one level down; THIS file's invariant is the single server on a
        // single port, and it is unmoved — only the smoke read of the body follows the
        // sanctioned envelope change.
        assert.ok(Array.isArray(list.items), "the work list rows are a JSON array on the { items, stalenessSeconds } envelope");

        // A static GET serves (index.html at the root).
        const staticRes = await fetch(new URL("/", url));
        assert.equal(staticRes.status, 200, "a static GET serves on the same port");

        // A /ws/terminal handshake succeeds on the SAME port.
        const ws = await openSocket(`ws://127.0.0.1:${address.port}/ws/terminal?ref=03&provider=claude`);
        assert.equal(ws.readyState, WebSocket.OPEN, "the WS upgrade handshakes on the same port");
        await new Promise((resolve) => { ws.on("close", resolve); ws.close(); });
      } finally {
        await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
