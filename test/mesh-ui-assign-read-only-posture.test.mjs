// Traceability wiring for milestone 38 / story 04 / task 02 —
// tasks/02_read-only-posture-preserved.feature (@executable).
//
// ARCHITECTURE 38/ADR-006 (the read-only fleet face) + 38/ADR-012 invariant #4
// (the face stays OTHERWISE read-only: one loopback http.createServer, no
// low-level writer import, no /ws/terminal) + #1 (exactly one mutation route).
// SECURITY T13 control (b) — a cross-origin write MUST be refused; control (c) —
// the carve-out is EXACTLY one route.
//
// @executable over the REAL serveMeshUi + a real fetch (Node's fetch sets an
// arbitrary Origin / content-type a real browser cannot — driving the whole
// CSRF matrix, the retired m27 mesh-issue-route-same-origin idiom). Every
// REFUSED row asserts NO global_assignments row was minted.
import assert from "node:assert/strict";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { WebSocket } from "ws";
import { withAssignRouteFixture, postAssign, seedTargetNode, readAssignmentRows } from "./support/mesh-ui-assign-fixture.mjs";

async function snapshotDir(dir) {
  const snap = new Map();
  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === ".git") continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.isFile()) {
        const info = await stat(full);
        snap.set(full, `${info.mtimeMs}:${await readFile(full, "utf8").catch(() => "<binary>")}`);
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

export const meshUiAssignReadOnlyPostureTests = [
  // ══ Scenario Outline: a write to any path OTHER than the carve-out stays a clean 405/404 ══
  {
    name: "mesh-ui-assign-read-only-posture/02 a write to any path OTHER than the carve-out stays a clean 405/404 — the read-only posture, one exception",
    async run() {
      const rows = [
        { method: "POST", path: "/api/mesh/status", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "POST", path: "/api/mesh/board-url", status: 405, code: "method-not-allowed", allow: "GET, HEAD" },
        { method: "PUT", path: "/api/mesh/assign", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "DELETE", path: "/api/mesh/assign", status: 405, code: "method-not-allowed", allow: "POST" },
        { method: "POST", path: "/api/mesh/revoke", status: 404, code: "not-found", allow: null },
        { method: "POST", path: "/api/mesh/issue", status: 404, code: "not-found", allow: null },
      ];
      await withAssignRouteFixture(async ({ url, home, root, workspaceId }) => {
        const before = await snapshotDir(root);
        for (const row of rows) {
          const res = await fetch(new URL(row.path, url), {
            method: row.method,
            headers: { origin: new URL(url).origin, "content-type": "application/json" },
          });
          assert.equal(res.status, row.status, `${row.method} ${row.path} is ${row.status}`);
          const body = await res.json();
          assert.equal(body.code, row.code, `${row.method} ${row.path} carries code "${row.code}"`);
          if (row.status === 405) {
            assert.equal(res.headers.get("allow"), row.allow, `${row.method} ${row.path} carries Allow: ${row.allow}`);
          }
        }
        const rowsMinted = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(rowsMinted.length, 0, "no global_assignments row was minted");
        const after = await snapshotDir(root);
        assert.deepEqual(diffSnapshots(before, after), [], "no file changed under the workspace");
        const survive = await fetch(new URL("/api/mesh/status", url));
        assert.equal(survive.status, 200, "a follow-up GET /api/mesh/status still answers 200");
      });
    },
  },

  // ══ Scenario: the fleet face stands up exactly ONE loopback-bound server and still serves no terminal upgrade ══
  {
    name: "mesh-ui-assign-read-only-posture/02 the fleet face stands up exactly ONE loopback-bound server and still serves no terminal upgrade",
    async run() {
      await withAssignRouteFixture(async ({ server }) => {
        const address = server.address();
        assert.equal(address.address, "127.0.0.1", "the running serve-face is bound to 127.0.0.1 only");

        for (const wsPath of ["/ws/terminal", "/"]) {
          const attempt = await openSocket(`ws://127.0.0.1:${address.port}${wsPath}`);
          assert.equal(attempt.opened, false, `a ws upgrade at ${wsPath} is refused — the socket is destroyed, no session opens`);
          if (attempt.ws) { try { attempt.ws.close(); } catch { /* noop */ } }
        }
      });
    },
  },

  // ══ Scenario Outline: the CSRF posture — only a same-origin JSON write is admitted ══
  {
    name: "mesh-ui-assign-read-only-posture/02 the CSRF posture — only a same-origin JSON write is admitted; a cross-origin / forgeable write is refused",
    async run() {
      const rows = [
        { case: "same-origin + json", origin: "SAME", contentType: "application/json", verdict: "ACCEPTED" },
        { case: "cross-origin + json", origin: "http://evil.test", contentType: "application/json", verdict: "REFUSED" },
        { case: "no-origin + browser form", origin: undefined, contentType: "application/x-www-form-urlencoded", verdict: "REFUSED" },
        { case: "same-origin + non-json", origin: "SAME", contentType: "text/plain", verdict: "REFUSED" },
      ];
      for (const row of rows) {
        await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
          await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });
          const res = await postAssign(url, { ref: "38/04", nodeId: "worker-a", workspaceId: "OWN", origin: row.origin, contentType: row.contentType });
          const rows2 = await readAssignmentRows({ home }, workspaceId, "38/04");
          if (row.verdict === "ACCEPTED") {
            assert.equal(res.status, 200, `${row.case} is ACCEPTED (200)`);
            assert.equal(rows2.length, 1, `${row.case} minted EXACTLY ONE assigned row`);
          } else {
            assert.ok(res.status >= 400 && res.status < 500, `${row.case} is REFUSED (a coded 4xx) — got ${res.status}`);
            const body = await res.json();
            assert.notEqual(body.ok, true, `${row.case} did not succeed`);
            assert.equal(rows2.length, 0, `${row.case} minted NO global_assignments row`);
          }
        });
      }
    },
  },

  // ══ Scenario: the face exposes no ungated mint — the ONLY path to a global_assignments write is the gated verb ══
  {
    name: "mesh-ui-assign-read-only-posture/02 the face exposes no ungated mint — a gate-refused POST mints nothing, and a subsequent eligible assign mints EXACTLY ONE gated row",
    async run() {
      await withAssignRouteFixture(async ({ url, home, workspaceId }) => {
        await seedTargetNode({ home }, { nodeId: "worker-a", workspaceId, member: true, published: true });

        const refused = await postAssign(url, { ref: "38/04", nodeId: "ghost", workspaceId: "OWN", origin: "SAME", contentType: "application/json" });
        assert.ok(refused.status >= 400 && refused.status < 500, "the unknown-node assign is refused");
        const afterRefusal = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(afterRefusal.length, 0, "NO global_assignments row exists for the item — there is no mint that skipped the gates");

        const accepted = await postAssign(url, { ref: "38/04", nodeId: "worker-a", workspaceId: "OWN", origin: "SAME", contentType: "application/json" });
        assert.equal(accepted.status, 200, "a subsequent same-origin assign for the eligible \"worker-a\" succeeds");
        const afterAccept = await readAssignmentRows({ home }, workspaceId, "38/04");
        assert.equal(afterAccept.length, 1, "EXACTLY ONE gated row was minted");
        assert.equal(afterAccept[0].target_node_id, "worker-a");
      });
    },
  },
];
