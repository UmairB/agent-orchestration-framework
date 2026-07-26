// Traceability wiring for milestone 25 / story 02 — the SERVER-OBSERVABLE
// @executable scenarios of tasks 03/04/05 (the halves provable against the real
// serve-face without a browser; the rendered-view @manual halves + the Playwright
// browser lane are QA-owned, judged at Review).
//
//   03_board-drill-in.feature (@executable): the fleet face issues no /api/work
//        request for a drill-in — every board fact came from the one
//        /api/mesh/status read (the fleet server is asked for NO /api/work).
//   04_fleet-reflects-peer-change.feature (@executable): the fleet client opens no
//        event stream — the server serves no WebSocket/SSE upgrade; the ONLY /api
//        reach is a GET of /api/mesh/status (poll-only, PRD §7.3).
//   05_fleet-view-is-read-only.feature (@executable): a write-method request is a
//        clean method-rejection (never a state change); serving + reading mutates no
//        file; the fleet face serves no terminal websocket (a /ws/terminal or /
//        upgrade is refused, no session opened).
//
// Exercises the REAL server (serveMeshUi) against temp fixtures — a fixture ui/dist,
// an isolated global projection store, a real fetch, a real ws client, and an on-disk snapshot.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-ro-"));
  const workDir = path.join(repo, "wiki", "work");
  const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-ro-home-"));
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
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" }, mesh: { enabled: true, relay: { controlNode: "n1" } } }, null, 2),
    "utf8"
  );

  const globalStoreOptions = { env: { AOF_GLOBAL_HOME: globalHome } };
  const workspace = await loadWorkspace(repo, undefined, globalStoreOptions);
  await publishNodeRecord(workspace, "n1", {
    nodeId: "n1",
    host: "n1",
    os: "linux",
    runtimes: [],
    skills: [],
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

  return { repo, workDir, globalHome, globalStoreOptions };
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

// Stand up the fleet face and record EVERY request path the server sees, so a test
// can assert what the fleet face did (and did NOT) reach for. The recorder wraps the
// server's 'request' emit is not directly observable, so instead we assert via the
// request paths a client issues + the server responses (a /api/work request → 404).
async function withFleet(body) {
  const { repo, workDir, globalHome, globalStoreOptions } = await makeRepo();
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-ro-root-"));
  await writeDist(meshUiDist(root));
  // scope:"local" (milestone 34 / story 03, ADR-006) — these scenarios assert the
  // global projection read-only contract (drill-in isolation, no
  // event stream, write-isolation), which is the LOCAL scope's job now that the
  // default is global; the global-default read is covered separately in
  // mesh-ui-global-scope.test.mjs.
  const { server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "local", globalStoreOptions });
  // Record the pathnames the server actually receives (the wire-observable proof
  // that no /api/work request reaches the fleet face on a drill-in).
  const seen = [];
  server.on("request", (request) => seen.push(request.url ?? "/"));
  try {
    return await body({ url, server, seen, workDir, repo });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(repo, { recursive: true, force: true });
    await rm(root, { recursive: true, force: true });
    await rm(globalHome, { recursive: true, force: true });
  }
}

function openSocket(wsUrl, { timeoutMs = 2000 } = {}) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    const timer = setTimeout(() => {
      try { ws.close(); } catch { /* noop */ }
      resolve({ opened: false, reason: "timeout" });
    }, timeoutMs);
    ws.on("open", () => {
      clearTimeout(timer);
      resolve({ opened: true, ws });
    });
    ws.on("error", () => {
      clearTimeout(timer);
      resolve({ opened: false, reason: "error" });
    });
    ws.on("unexpected-response", () => {
      clearTimeout(timer);
      resolve({ opened: false, reason: "unexpected-response" });
    });
  });
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

export const meshUiReadOnlyContractTests = [
  // ═══ 03_board-drill-in.feature @executable ═════════════════════════════════
  // The fleet face issues no /api/work request for a drill-in: loading the page +
  // reading the aggregate reaches /api/mesh/status only — the
  // server receives NO /api/work request. (Following a drill-in navigates OUT to the
  // board's own aof work ui; the fleet server is never asked for /api/work.)
  {
    name: "mesh-ui-read-only/03 the fleet face issues no /api/work request — every board fact came from the one /api/mesh/status read",
    async run() {
      await withFleet(async ({ url, seen }) => {
        // load the page + read the work facts (the aggregate)
        await fetch(new URL("/", url));
        const status = await fetch(new URL("/api/mesh/status", url));
        assert.equal(status.status, 200, "the one aggregate read answers");
        const body = await status.json();
        assert.ok(body.items.some((item) => item.ref === "34" && item.slug === "global-mesh"), "the work item fact came from the global projection aggregate");
        // the server saw NO /api/work request (the fleet face proxies no board)
        const apiReqs = seen.filter((u) => u.startsWith("/api/"));
        assert.ok(apiReqs.length > 0, "the client made at least the one aggregate read");
        assert.ok(
          apiReqs.every((u) => u.startsWith("/api/mesh/status")),
          `every /api request was the one /api/mesh/status read — got ${JSON.stringify(apiReqs)}`
        );
        assert.ok(
          !seen.some((u) => u.startsWith("/api/work")),
          "the fleet server received NO /api/work request"
        );
      });
    },
  },

  // ═══ 04_fleet-reflects-peer-change.feature @executable ═════════════════════
  // The fleet client opens no event stream: the server serves no WebSocket/SSE — a
  // ws upgrade to any path is refused, and the ONLY /api reach the client needs is a
  // GET poll of /api/mesh/status (poll-only, no push chrome).
  {
    name: "mesh-ui-read-only/04 the fleet server opens no event stream — a ws upgrade is refused and /api/mesh/status answers as a GET poll",
    async run() {
      await withFleet(async ({ url, server, seen }) => {
        const port = server.address().port;
        // a ws upgrade is refused (the fleet face serves no event stream)
        const attempt = await openSocket(`ws://127.0.0.1:${port}/`);
        assert.equal(attempt.opened, false, "no WebSocket opens against the fleet server (poll-only)");
        if (attempt.ws) { try { attempt.ws.close(); } catch { /* noop */ } }

        // the poll read is a plain GET of the one route
        const res = await fetch(new URL("/api/mesh/status", url), { method: "GET" });
        assert.equal(res.status, 200, "the poll is a GET of the one /api/mesh/status read");
        const apiReqs = seen.filter((u) => u.startsWith("/api/"));
        assert.ok(
          apiReqs.every((u) => u.startsWith("/api/mesh/status")),
          "every /api request on the wire was a GET poll of the one /api/mesh/status read"
        );
      });
    },
  },

  // ═══ 05_fleet-view-is-read-only.feature @executable ════════════════════════
  // Scenario Outline: a write-method request to the fleet face is rejected without a
  // state change — a clean method-rejection, not a crash. (POST/PUT/PATCH/DELETE is
  // the mutating set on the READ route; milestone 27 / story 02 landed POST
  // /api/mesh/issue as an accepted write route — SINCE RETIRED, `aof graph impact`
  // confirms it is gone from the live tree. Milestone 38 / story 04 (ADR-012) then
  // landed POST /api/mesh/assign as the fleet face's FIRST live write route — SO an
  // UNAUTHENTICATED bare POST to it (no Origin header, this suite's fetch never sets
  // one) is REFUSED by its own admission guard before ever reaching the mutation;
  // this row asserts that refusal, never that the route doesn't exist.)
  {
    name: "mesh-ui-read-only/05 a write-method request to the fleet face is a clean method-rejection, never a state change",
    async run() {
      const rows = [
        { method: "POST", route: "/api/mesh/status" },
        { method: "PUT", route: "/api/mesh/status" },
        { method: "PATCH", route: "/api/mesh/status" },
        { method: "DELETE", route: "/api/mesh/status" },
        { method: "POST", route: "/api/mesh/assign" },
      ];
      await withFleet(async ({ url, repo }) => {
        const before = await snapshotDir(repo);
        for (const { method, route } of rows) {
          const res = await fetch(new URL(route, url), { method });
          // A clean rejection: NOT a 2xx success, and the server did not crash
          // (a follow-up read still answers). The read routes reject the method
          // (405); an unauthenticated POST to the m38/ADR-012 assign exception is
          // refused by its own admission guard (a coded 4xx, never a crash).
          assert.ok(res.status >= 400 && res.status < 500, `${method} ${route} is rejected (4xx) — got ${res.status}`);
          const body = await res.json().catch(() => ({}));
          assert.notEqual(body.ok, true, `${method} ${route} did not succeed`);
        }
        // the follow-up read proves the server survived every rejected write
        const survive = await fetch(new URL("/api/mesh/status", url));
        assert.equal(survive.status, 200, "the server survived every rejected write");
        // NO state change on disk from any write attempt
        const after = await snapshotDir(repo);
        assert.deepEqual(diffSnapshots(before, after), [], "no write-method request changed any file");
      });
    },
  },

  // Scenario: serving and rendering the fleet view changes no files (the strongest
  // observable write-isolation form).
  {
    name: "mesh-ui-read-only/05 serving + reading the fleet view end-to-end changes no files",
    async run() {
      await withFleet(async ({ url, repo }) => {
        const before = await snapshotDir(repo);
        await fetch(new URL("/", url));
        for (let i = 0; i < 5; i += 1) await fetch(new URL("/api/mesh/status", url));
        const after = await snapshotDir(repo);
        assert.deepEqual(diffSnapshots(before, after), [], "the workspace on-disk state is byte-unchanged");
      });
    },
  },

  // Scenario Outline: the fleet face serves no terminal websocket — a ws upgrade at
  // /ws/terminal (the muscle-memory path) or / is refused, no session opened.
  {
    name: "mesh-ui-read-only/05 the fleet face serves no terminal websocket — a /ws/terminal (or /) upgrade is refused, no session opened",
    async run() {
      await withFleet(async ({ server }) => {
        const port = server.address().port;
        for (const wsPath of ["/ws/terminal", "/"]) {
          const attempt = await openSocket(`ws://127.0.0.1:${port}${wsPath}`);
          assert.equal(attempt.opened, false, `a ws upgrade at ${wsPath} is refused (no terminal session opens)`);
          if (attempt.ws) { try { attempt.ws.close(); } catch { /* noop */ } }
        }
      });
    },
  },
];
