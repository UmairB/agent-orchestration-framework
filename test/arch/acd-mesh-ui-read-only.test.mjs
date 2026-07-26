// Fitness function: acd-mesh-ui-read-only (milestone 35 / story 03; ARCHITECTURE
// ADR-007 — "assign is CLI-only; the fleet UI stays read-only and renders
// lifecycle; a guarded same-origin+json POST is deferred, not designed").
//
// SUPERSEDED IN PLACE at milestone 38 / story 04 (ADR-012) — the m35/ADR-007
// deferral is REALIZED: the fleet face gains its FIRST live write route, a
// guarded same-origin+json `POST /api/mesh/assign` wrapping `assignWork`
// verbatim (SECURITY T13). This file's job narrows accordingly: it still
// RE-ARMS the m34 read-only guarantee (acd-mesh-ui-write-isolation) that every
// route OTHER than that one exception stays exactly as read-only as before —
// `acd-fleet-face-single-mutation-route` (the new, story-04-owned fitness) is
// what now arms the ONE exception's own structural invariants; this file
// asserts there is no SECOND one.
//
// "The mesh UI serve face exposes no assignment write route OTHER than the one
//  m38/ADR-012 exception: every other non-GET/HEAD is a 405; POST /api/mesh/issue
//  |route|revoke never exist; the upgrade is destroyed; the extended status
//  shape added no OTHER mutating handler."
//
// A structural grep of src/mesh-ui-serve.mjs (comments discounted) PLUS a
// behavioural exercise of the real server: every mutating method on the two
// GET routes 405s with the Allow header, no /api/mesh/issue|route|revoke route
// resolves to a 2xx, every upgrade is destroyed, and the route table is still
// exactly the two GET routes + the ONE POST /api/mesh/assign exception + the
// static bundle.
import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
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

export const archTests = [
  {
    name: "arch/35-38 ADR-007/012: mesh-ui-serve.mjs declares NO /api/mesh/issue|route|revoke mutating route — the ONLY write exception is POST /api/mesh/assign (38/ADR-012), guarded to POST only",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));

      // The m35/ADR-007 deferral names — never a second write route besides the
      // one m38/ADR-012 exception.
      assert.ok(
        !/pathname\s*===\s*["']\/api\/mesh\/issue["']/.test(source),
        "mesh-ui-serve.mjs declares no /api/mesh/issue route"
      );
      assert.ok(
        !/pathname\s*===\s*["']\/api\/mesh\/(route|revoke)["']/.test(source),
        "mesh-ui-serve.mjs declares no /api/mesh/route or /api/mesh/revoke route"
      );
      // The route table is the two GET reads + the ONE POST /api/mesh/assign
      // exception + the static-bundle fallthrough — never a fourth /api/mesh/* route.
      const declaredApiRoutes = [...source.matchAll(/pathname\s*===\s*["'](\/api\/mesh\/[a-zA-Z-]+)["']/g)].map((m) => m[1]);
      const uniqueRoutes = [...new Set(declaredApiRoutes)].sort();
      assert.deepEqual(
        uniqueRoutes,
        ["/api/mesh/assign", "/api/mesh/board-url", "/api/mesh/status"].sort(),
        "the route table is exactly the two GET routes (board-url, status) plus the ONE POST /api/mesh/assign exception — no fourth /api/mesh/* route exists"
      );

      // The two READ routes still guard themselves to GET/HEAD (a write method
      // is rejected, never dispatched to a handler) — UNCHANGED by the exception.
      const getHeadGuardCount = (source.match(/request\.method\s*!==\s*["']GET["']\s*&&\s*request\.method\s*!==\s*["']HEAD["']/g) ?? []).length;
      assert.ok(getHeadGuardCount >= 1, "mesh-ui-serve.mjs guards its GET/HEAD route(s) before any handler body runs");
      // The ONE write route guards itself to POST only (a GET/PUT/DELETE on
      // /api/mesh/assign is a rejection, never a dispatch to the verb).
      assert.ok(
        /request\.method\s*!==\s*["']POST["']/.test(source),
        "mesh-ui-serve.mjs guards its ONE write route to POST before dispatching to assignWork"
      );

      // No fs-write call form and no shell-out of the FACE's own — the ONE
      // mutation rides entirely inside assignWork's own gated store write.
      for (const verb of ["writeFile", "appendFile", "writeFileSync", "appendFileSync", "mkdir", "rm", "rmdir", "unlink", "rename"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( call — the face itself writes nothing`
        );
      }
      assert.ok(!/child_process/.test(source), "mesh-ui-serve.mjs imports no child_process");
      for (const verb of ["spawn", "spawnSync", "exec", "execSync", "execFile"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( shell-out`
        );
      }

      // No WebSocket upgrade route — every upgrade is refused unconditionally.
      assert.ok(
        /server\.on\(\s*["']upgrade["']/.test(source),
        "mesh-ui-serve.mjs registers an 'upgrade' handler"
      );
      assert.ok(
        /socket\.destroy\(\)/.test(source),
        "the upgrade handler destroys the socket — no WebSocket session is ever established"
      );

      // --- m03 non-vacuous planted-violation self-check ---
      // A broken fixture: a SECOND write route (/api/mesh/issue) declared
      // alongside the sanctioned /api/mesh/assign — the detector must FIRE (fail)
      // on this shape, proving the route-table assertion is not vacuously green.
      const plantedWriteRoute = stripComments(`
        if (pathname === "/api/mesh/status") {
          if (request.method !== "GET" && request.method !== "HEAD") { sendMethodNotAllowed(response, "GET, HEAD"); return; }
          sendJson(response, 200, await queryGlobalMeshStatus());
          return;
        }
        if (pathname === "/api/mesh/board-url") {
          if (request.method !== "GET" && request.method !== "HEAD") { sendMethodNotAllowed(response, "GET, HEAD"); return; }
          sendJson(response, 200, {});
          return;
        }
        if (pathname === "/api/mesh/assign") {
          if (request.method !== "POST") { sendMethodNotAllowed(response, "POST"); return; }
          const result = await assignWork(assignWorkspace, body.ref, body.nodeId, {});
          sendJson(response, 200, result);
          return;
        }
        if (pathname === "/api/mesh/issue") {
          const body = await readJsonBody(request);
          await insertAssignment(store, body);
          sendJson(response, 200, { ok: true });
          return;
        }
      `);
      const plantedRoutes = [...plantedWriteRoute.matchAll(/pathname\s*===\s*["'](\/api\/mesh\/[a-zA-Z-]+)["']/g)].map((m) => m[1]);
      const plantedUnique = [...new Set(plantedRoutes)].sort();
      assert.notDeepEqual(
        plantedUnique,
        ["/api/mesh/assign", "/api/mesh/board-url", "/api/mesh/status"].sort(),
        "self-check: the detector FIRES on a planted FOURTH route (/api/mesh/issue) beside the sanctioned exception — the broken half"
      );
      assert.ok(
        plantedRoutes.includes("/api/mesh/issue"),
        "self-check: the detector sees the planted /api/mesh/issue route"
      );

      // A broken fixture: an upgrade handler that does NOT destroy the socket
      // (e.g. hands it to a WebSocketServer instead) — the detector must FIRE.
      const plantedOpenUpgrade = stripComments(`
        server.on("upgrade", (request, socket, head) => {
          wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
        });
      `);
      assert.ok(
        /server\.on\(\s*["']upgrade["']/.test(plantedOpenUpgrade) && !/socket\.destroy\(\)/.test(plantedOpenUpgrade),
        "self-check: the detector sees the planted open-upgrade handler that never destroys the socket — the broken half"
      );
    },
  },
  {
    name: "arch/35-38 ADR-007/012 (behavioural): every non-GET/HEAD on the two read routes is a 405, no /api/mesh/issue route ever resolves to a 2xx, a write method on /api/mesh/assign that isn't POST is a 405, an unauthenticated POST to /api/mesh/assign is refused (never a 200), every upgrade is destroyed",
    run: async () => {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-ro-fitness-"));
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-ro-fitness-root-"));
      const globalHome = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-ro-fitness-home-"));
      let server;
      try {
        const workDir = path.join(repo, "wiki", "work");
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
        await writeDist(meshUiDist(root));

        const globalStoreOptions = { env: { AOF_GLOBAL_HOME: globalHome } };
        ({ server } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "global", globalStoreOptions }));
        const address = server.address();
        const url = `http://127.0.0.1:${address.port}/`;

        // every mutating method on the two read routes is a clean 405
        for (const route of ["/api/mesh/status", "/api/mesh/board-url"]) {
          for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
            const res = await fetch(new URL(route, url), { method });
            assert.equal(res.status, 405, `${method} ${route} is a 405`);
            assert.equal(res.headers.get("allow"), "GET, HEAD", `${method} ${route} carries the Allow header`);
          }
        }

        // /api/mesh/issue (the RETIRED m27 route) never resolves to a 2xx on any method
        for (const method of ["POST", "PUT", "DELETE"]) {
          const res = await fetch(new URL("/api/mesh/issue", url), { method });
          assert.ok(res.status === 404, `${method} /api/mesh/issue is not-found`);
        }

        // milestone 38 / story 04 (ADR-012) — the ONE exception: a write method
        // on /api/mesh/assign that is NOT POST is still a clean 405 naming POST.
        for (const method of ["PUT", "PATCH", "DELETE", "GET"]) {
          const res = await fetch(new URL("/api/mesh/assign", url), { method });
          assert.equal(res.status, 405, `${method} /api/mesh/assign is a 405`);
          assert.equal(res.headers.get("allow"), "POST", `${method} /api/mesh/assign carries the Allow: POST header`);
        }
        // an UNAUTHENTICATED (no Origin) POST is refused — never a 200, and this
        // fitness function (unlike acd-fleet-face-single-mutation-route) does not
        // assert the exact refusal code, only that the ONE exception still never
        // succeeds for a request that skips the admission guard.
        const unauthedPost = await fetch(new URL("/api/mesh/assign", url), { method: "POST" });
        assert.ok(unauthedPost.status >= 400 && unauthedPost.status < 500, "an unauthenticated POST to /api/mesh/assign is refused (4xx), never a 200");

        // GET is still served
        const getRes = await fetch(new URL("/api/mesh/status", url));
        assert.equal(getRes.status, 200, "GET /api/mesh/status is still served");

        // every upgrade is destroyed
        const attempt = await openSocket(`ws://127.0.0.1:${address.port}/ws/terminal`);
        assert.equal(attempt.opened, false, "the upgrade is refused — the socket is destroyed");
        if (attempt.ws) { try { attempt.ws.close(); } catch { /* noop */ } }
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await rm(repo, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
        await rm(globalHome, { recursive: true, force: true });
      }
    },
  },
];
