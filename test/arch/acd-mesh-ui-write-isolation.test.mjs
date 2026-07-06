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
  const meshDir = path.join(repo, ".aof", "mesh");
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
  // milestone 27 / story 02 (ADR-006.2) — SUPERSEDED IN PLACE: the m25 assertion
  // "the fleet face writes NOTHING and serves no write route" moves to a BOUNDED-
  // WRITE shape. XOR/consistency-phrased (the acd-mesh-issue-route-same-origin
  // template): GREEN on the m25 zero-write tree (no /api/mesh/issue|assign|route|
  // revoke route declared at all — vacuously satisfied) OR on the exactly-one-
  // route tree (POST /api/mesh/issue declared, reaching the mutation ONLY via
  // invoke("mesh:issue"), no direct mesh-issuance/operation import, no bare
  // writeFile/child_process, and NO other write route / no /ws/terminal). RED
  // only in the broken half: a write route that bypasses the door, a SECOND
  // write route, or a /ws/terminal.
  {
    name: "arch/25-27 ADR-003/004/006.2: mesh-ui-serve.mjs serves no /ws/terminal, and is EITHER write-nothing (m25) OR bounded-write to exactly POST /api/mesh/issue via invoke(\"mesh:issue\") (m27, XOR/consistency)",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));

      // No terminal websocket route/path — UNCHANGED on both trees.
      assert.ok(!/["']\/ws\/terminal["']/.test(source), "mesh-ui-serve.mjs serves no /ws/terminal path");
      assert.ok(!/["']\/ws\//.test(source) || !/pathname\s*===\s*["']\/ws\//.test(source), "mesh-ui-serve.mjs declares no /ws/ HTTP route");

      const declaresIssueRoute = /pathname\s*===\s*["']\/api\/mesh\/issue["']/.test(source);
      const declaresAnyOtherWriteRoute = /pathname\s*===\s*["']\/api\/mesh\/(assign|route|revoke)["']/.test(source);

      if (!declaresIssueRoute) {
        // The m25 zero-write tree: no /api/mesh/issue|assign|route|revoke route at
        // all — vacuously satisfied (there is no write route to bound yet).
        assert.ok(
          !declaresAnyOtherWriteRoute,
          "no /api/mesh/issue route yet, and no /api/mesh/assign|route|revoke route either (the m25 read-only state)"
        );
        // The face rejects non-GET methods on its one route (read-only) rather than
        // dispatching them to a mutation — a method-guard is present.
        assert.ok(
          /request\.method\s*!==\s*["']GET["']/.test(source),
          "mesh-ui-serve.mjs guards its one route to GET (read-only) — a write method is rejected, never dispatched"
        );
      } else {
        // The m27 bounded-write tree: POST /api/mesh/issue is declared. It must be
        // the ONLY write route — no assign/route/revoke sibling exists.
        assert.ok(
          !declaresAnyOtherWriteRoute,
          "mesh-ui-serve.mjs declares NO /api/mesh/assign|route|revoke route — /api/mesh/issue is the ONLY write route"
        );
        // It reaches the mutation ONLY via invoke("mesh:issue") — never a direct
        // mesh-issuance import (acd-mesh-ui-no-core-import's own concern, restated
        // here as the bounded-write invariant).
        assert.ok(
          /invoke\s*\(\s*["']mesh:issue["']/.test(source),
          "mesh-ui-serve.mjs reaches the mutation via invoke(\"mesh:issue\") — the ONE registry door"
        );
        assert.ok(
          !/from\s*["']\.\/mesh-issuance\.mjs["']/.test(source) && !/require\(\s*["']\.\/mesh-issuance\.mjs["']\s*\)/.test(source),
          "mesh-ui-serve.mjs imports NO ./mesh-issuance.mjs — the mutation reaches ONLY through invoke"
        );
      }

      // No fs-write call form and no shell-out, on EITHER tree — the face itself
      // performs no mutation of its own regardless of which half is satisfied.
      for (const verb of ["writeFile", "appendFile", "writeFileSync", "appendFileSync", "mkdir", "rm", "rmdir", "unlink", "rename"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( call — the face itself writes nothing (the mutation, if any, is behind invoke)`
        );
      }
      assert.ok(!/child_process/.test(source), "mesh-ui-serve.mjs imports no child_process");
      for (const verb of ["spawn", "spawnSync", "exec", "execSync", "execFile"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( shell-out`
        );
      }

      // --- m03 non-vacuous planted-violation self-check ---
      // A broken-half fixture: a SECOND write route (/api/mesh/assign) declared
      // alongside /api/mesh/issue — the detector must FIRE (fail the assertion) on
      // this shape, proving it is not vacuously green on the guarded tree either.
      const plantedSecondWriteRoute = stripComments(`
        if (pathname === "/api/mesh/issue") {
          const result = await invoke("mesh:issue", body, { workspace });
          sendJson(response, 200, result);
        }
        if (pathname === "/api/mesh/assign") {
          const result = await invoke("mesh:assign", body, { workspace });
          sendJson(response, 200, result);
        }
      `);
      const plantedDeclaresIssue = /pathname\s*===\s*["']\/api\/mesh\/issue["']/.test(plantedSecondWriteRoute);
      const plantedDeclaresOther = /pathname\s*===\s*["']\/api\/mesh\/(assign|route|revoke)["']/.test(plantedSecondWriteRoute);
      assert.ok(plantedDeclaresIssue, "self-check: the detector sees the planted /api/mesh/issue route");
      assert.ok(plantedDeclaresOther, "self-check: the detector FIRES on a planted SECOND write route (/api/mesh/assign) — this is the broken half");

      // A broken-half fixture: /api/mesh/issue reaching the mutation via a DIRECT
      // mesh-issuance import, bypassing the registry door.
      const plantedBypassDoor = stripComments(`
        import { issueDirective } from "./mesh-issuance.mjs";
        if (pathname === "/api/mesh/issue") {
          await issueDirective(workspace, nodeId, ref, directive);
        }
      `);
      assert.ok(
        /from\s*["']\.\/mesh-issuance\.mjs["']/.test(plantedBypassDoor),
        "self-check: the detector sees the planted direct mesh-issuance import (the broken half — bypassing the registry door)"
      );

      // The accepted guarded form (the shape this story ships) stays quiet on both
      // checks above.
      const accepted = stripComments(`
        if (pathname === "/api/mesh/issue") {
          const result = await invoke("mesh:issue", { ref: body.ref, to: body.to }, { workspace });
          sendJson(response, 200, result);
        }
      `);
      assert.ok(
        !/pathname\s*===\s*["']\/api\/mesh\/(assign|route|revoke)["']/.test(accepted),
        "self-check: the accepted single-route form declares no second write route"
      );
      assert.ok(
        /invoke\s*\(\s*["']mesh:issue["']/.test(accepted),
        "self-check: the accepted form reaches the mutation via invoke(\"mesh:issue\")"
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
        const before = await snapshotDir(repo);
        let url;
        // scope:"local" (milestone 34 / story 03, ADR-006) — this fitness assertion
        // is about read-only-ness of the WORKSPACE directory, orthogonal to
        // global-vs-local; isolated from the ambient global store.
        ({ server, url } = await serveMeshUi({ projectDir: repo, port: 0, repoRoot: root, scope: "local" }));
        // Serve the page + read the aggregate several times.
        await fetch(new URL("/", url));
        for (let i = 0; i < 3; i += 1) {
          const res = await fetch(new URL("/api/mesh/status", url));
          assert.equal(res.status, 200, "the aggregate read answers");
        }
        const after = await snapshotDir(repo);
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
