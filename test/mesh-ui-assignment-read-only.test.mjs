// Traceability wiring for milestone 35 / story 03 / task 02 —
// tasks/02_read-only-invariant.feature (@executable).
//
// ADR-007 (this milestone) — the fleet UI stays READ-ONLY; story 03 extends the
// READ shape only, never the write posture. This RE-ARMS the m34 read-only
// posture (34/ADR-007) over the story-03 status extension: every non-GET/HEAD is
// a clean 405 with an `Allow: GET, HEAD` header + body code "method-not-allowed";
// GET/HEAD are still served; NO /api/mesh/issue mutating route exists; every
// WebSocket upgrade destroys the socket; the extended read path performs zero fs
// write and no shell-out; the route table is still exactly the two GET routes +
// the static bundle.
//
// SUPERSEDED IN PLACE at milestone 38 / story 04 (ADR-012) — /api/mesh/assign is
// no longer a hypothetical "would-be" route: it is the fleet face's ONE
// sanctioned write exception (SECURITY T13, arch-owned by the new
// acd-fleet-face-single-mutation-route). The rows below that named it as
// still-refused now assert the WEAKER (but still load-bearing) claim this
// file's charter needs: an UNAUTHENTICATED bare POST (no Origin, no body) is
// STILL refused — never a 200 — even though the route itself now exists.
//
// Exercises the REAL server (serveMeshUi) against temp fixtures with an injected
// globalStoreOptions, mirroring test/mesh-ui-serve.test.mjs / mesh-ui-read-only-
// contract.test.mjs's serve-face convention — a fixture ui/dist, an isolated
// global projection store, real fetches + a real ws client.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WebSocket } from "ws";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { insertAssignment } from "../src/assignment-record.mjs";
import { assembleAssignmentRecord } from "../src/assignment-record.mjs";

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-assign-ro-"));
  const workDir = path.join(repo, "wiki", "work");
  const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-assign-ro-home-"));
  const milestoneDir = path.join(workDir, "35_milestone_mesh-work-assignment");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 35\nslug: mesh-work-assignment\nstatus: in-progress\ntitle: Mesh Work Assignment\n---\n",
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
    const published = await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-08T10:05:00.000Z" });
    await publishGlobalRegistryDescriptorsToStore(store, workspace, { now: "2026-07-08T10:05:00.000Z" });
    // Plant a real assignment row so the extended read path (task 00) has
    // something to thread through — proving the READ side works while this
    // task proves the WRITE side stays closed.
    insertAssignment(store, assembleAssignmentRecord({
      itemRef: "35",
      workspaceId: published.workspaceId,
      targetNodeId: "n1",
      issuer: "operator",
      state: "running",
      now: "2026-07-08T10:05:00.000Z",
    }));
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

async function withFleet(body) {
  const { repo, workDir, globalHome, globalStoreOptions } = await makeRepo();
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-assign-ro-root-"));
  await writeDist(meshUiDist(root));
  const { server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "global", globalStoreOptions });
  try {
    return await body({ url, server, workDir, repo });
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

export const meshUiAssignmentReadOnlyTests = [
  // Scenario Outline: every non-GET/HEAD method on a mesh route is a 405
  // method-rejection with an Allow header.
  {
    name: "mesh-ui-assignment-read-only/02 every non-GET/HEAD method on /api/mesh/status or /api/mesh/board-url is a clean 405 with an Allow header",
    async run() {
      const rows = [
        { method: "POST", route: "/api/mesh/status" },
        { method: "PUT", route: "/api/mesh/status" },
        { method: "PATCH", route: "/api/mesh/status" },
        { method: "DELETE", route: "/api/mesh/status" },
        { method: "POST", route: "/api/mesh/board-url" },
        { method: "PUT", route: "/api/mesh/board-url" },
        { method: "DELETE", route: "/api/mesh/board-url" },
      ];
      await withFleet(async ({ url }) => {
        for (const { method, route } of rows) {
          const res = await fetch(new URL(route, url), { method });
          assert.equal(res.status, 405, `${method} ${route} is a 405`);
          assert.equal(res.headers.get("allow"), "GET, HEAD", `${method} ${route} carries the Allow header`);
          const body = await res.json();
          assert.equal(body.code, "method-not-allowed", `${method} ${route} carries the method-not-allowed code`);
          assert.notEqual(body.ok, true, `${method} ${route} did not succeed`);
        }
      });
    },
  },

  // Scenario: GET and HEAD on the status route are still served.
  {
    name: "mesh-ui-assignment-read-only/02 GET and HEAD on /api/mesh/status are still served 200",
    async run() {
      await withFleet(async ({ url }) => {
        const getRes = await fetch(new URL("/api/mesh/status", url), { method: "GET" });
        assert.equal(getRes.status, 200, "GET is served");
        const body = await getRes.json();
        assert.ok(Array.isArray(body.items), "the extended read shape still answers with items");

        const headRes = await fetch(new URL("/api/mesh/status", url), { method: "HEAD" });
        assert.equal(headRes.status, 200, "HEAD falls through to the same read");
      });
    },
  },

  // Scenario Outline: /api/mesh/issue is not a mutating handler (never existed);
  // an UNAUTHENTICATED bare request to /api/mesh/assign — the m38/ADR-012 write
  // exception — is still refused (never a 2xx), and a non-POST method on it is
  // a clean 405.
  {
    name: "mesh-ui-assignment-read-only/02 /api/mesh/issue never succeeds, and an unauthenticated/wrong-method request to /api/mesh/assign (the m38/ADR-012 exception) never succeeds either",
    async run() {
      const rows = [
        { method: "POST", route: "/api/mesh/assign" },
        { method: "POST", route: "/api/mesh/issue" },
        { method: "DELETE", route: "/api/mesh/assign" },
        { method: "PUT", route: "/api/mesh/assign" },
      ];
      await withFleet(async ({ url, repo }) => {
        const before = await snapshotDir(repo);
        for (const { method, route } of rows) {
          const res = await fetch(new URL(route, url), { method });
          assert.ok(res.status >= 400 && res.status < 500, `${method} ${route} is a clean refusal (4xx) — got ${res.status}`);
          const body = await res.json().catch(() => ({}));
          assert.notEqual(body.ok, true, `${method} ${route} did not succeed — no 2xx write acknowledgement`);
        }
        const after = await snapshotDir(repo);
        assert.deepEqual(diffSnapshots(before, after), [], "no request in this unauthenticated/wrong-method matrix wrote any file under the workspace");
      });
    },
  },

  // Scenario Outline: every upgrade attempt is refused — the socket is
  // destroyed, no session opens.
  {
    name: "mesh-ui-assignment-read-only/02 every WebSocket upgrade attempt is refused — socket destroyed, no session opens",
    async run() {
      await withFleet(async ({ server }) => {
        const port = server.address().port;
        for (const wsPath of ["/ws/terminal", "/api/mesh/status", "/"]) {
          const attempt = await openSocket(`ws://127.0.0.1:${port}${wsPath}`);
          assert.equal(attempt.opened, false, `an upgrade at ${wsPath} is refused (no session opens)`);
          if (attempt.ws) { try { attempt.ws.close(); } catch { /* noop */ } }
        }
      });
    },
  },

  // Scenario: the story-03 extended status shape added no write branch OF ITS
  // OWN — the read-only route table is unchanged by IT (the separate, later,
  // m38/ADR-012 assign exception is a different story's deliberate addition,
  // asserted structurally by acd-fleet-face-single-mutation-route, not here).
  {
    name: "mesh-ui-assignment-read-only/02 the extended status shape added no write branch of its own — /api/mesh/issue still never exists, an unauthenticated assign POST still never succeeds, zero fs write, no shell-out",
    async run() {
      await withFleet(async ({ url, repo, server }) => {
        const before = await snapshotDir(repo);
        // exercise the routes end to end
        await fetch(new URL("/", url));
        const status = await fetch(new URL("/api/mesh/status", url));
        assert.equal(status.status, 200);
        const statusBody = await status.json();
        // the story-03 assignment rows are threaded through the status read path
        const assignedItem = statusBody.items.find((item) => item.ref === "35");
        assert.ok(assignedItem, "the planted item surfaces in the extended read");
        assert.ok(assignedItem.assignment, "the assignment row is threaded through the read path");
        assert.equal(assignedItem.assignment.state, "running");

        // /api/mesh/issue was never added by ANY story to date.
        const issueAttempt = await fetch(new URL("/api/mesh/issue", url), { method: "POST" });
        assert.equal(issueAttempt.status, 404, "no issue route exists");
        // an UNAUTHENTICATED bare POST to /api/mesh/assign (the m38/ADR-012
        // exception) is still refused after the extended read path has been
        // exercised — the route exists, but a request that skips its own
        // admission guard never succeeds.
        const assignAttempt = await fetch(new URL("/api/mesh/assign", url), { method: "POST" });
        assert.ok(assignAttempt.status >= 400 && assignAttempt.status < 500, "an unauthenticated assign POST is refused (4xx), never a 2xx");

        const after = await snapshotDir(repo);
        assert.deepEqual(diffSnapshots(before, after), [], "the extended read path performed zero fs write under the workspace");
      });
    },
  },
];
