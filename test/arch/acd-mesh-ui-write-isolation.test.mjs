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
  // milestone 27 / story 02 (ADR-006.2), then milestone 38 / story 04 (ADR-012) —
  // SUPERSEDED IN PLACE a second time: the m25 assertion "the fleet face writes
  // NOTHING and serves no write route" moved to a BOUNDED-WRITE shape at m27
  // (POST /api/mesh/issue, since RETIRED — `aof graph impact` confirms it is gone
  // from the live tree, ADR-012's codebase-graph grounding), and now moves again
  // to m38's bounded-write shape: POST /api/mesh/assign, wrapping `assignWork`
  // VERBATIM (no registry/invoke door this time — ADR-012's own grounding: "the
  // UI route becomes an 8th CALLER of that SAME core, never a re-implementation").
  // XOR/consistency-phrased across THREE trees: the m25 zero-write tree (vacuously
  // satisfied), the RETIRED m27 issue tree (kept live so a reversion is still
  // caught), and the CURRENT m38 assign tree. RED in any broken half: a second
  // write route, a write path that bypasses assignWork, or a /ws/terminal.
  {
    name: "arch/25-27-38 ADR-003/004/006.2/012: mesh-ui-serve.mjs serves no /ws/terminal, and is EITHER write-nothing (m25) OR bounded-write to exactly POST /api/mesh/issue via invoke (m27, retired) OR bounded-write to exactly POST /api/mesh/assign via assignWork (m38/ADR-012, XOR/consistency)",
    run: async () => {
      const source = stripComments(await readFile(MESH_UI_SERVE, "utf8"));

      // No terminal websocket route/path — UNCHANGED on every tree.
      assert.ok(!/["']\/ws\/terminal["']/.test(source), "mesh-ui-serve.mjs serves no /ws/terminal path");
      assert.ok(!/["']\/ws\//.test(source) || !/pathname\s*===\s*["']\/ws\//.test(source), "mesh-ui-serve.mjs declares no /ws/ HTTP route");

      const declaresIssueRoute = /pathname\s*===\s*["']\/api\/mesh\/issue["']/.test(source);
      const declaresAssignRoute = /pathname\s*===\s*["']\/api\/mesh\/assign["']/.test(source);
      const declaresOtherWriteRoute = /pathname\s*===\s*["']\/api\/mesh\/(route|revoke)["']/.test(source);

      assert.ok(
        !(declaresIssueRoute && declaresAssignRoute),
        "mesh-ui-serve.mjs never declares BOTH /api/mesh/issue and /api/mesh/assign — at most one write-route tree is live"
      );
      assert.ok(
        !declaresOtherWriteRoute,
        "mesh-ui-serve.mjs declares no /api/mesh/route|revoke sibling — never a THIRD write route"
      );

      if (!declaresIssueRoute && !declaresAssignRoute) {
        // The m25 zero-write tree: no write route at all — vacuously satisfied.
        assert.ok(
          /request\.method\s*!==\s*["']GET["']/.test(source),
          "mesh-ui-serve.mjs guards its one route to GET (read-only) — a write method is rejected, never dispatched"
        );
      } else if (declaresIssueRoute) {
        // The RETIRED m27 tree — kept live only so a reversion is still caught by
        // this detector; the current tree (below) is what mesh-ui-serve.mjs ships.
        assert.ok(
          /invoke\s*\(\s*["']mesh:issue["']/.test(source),
          "mesh-ui-serve.mjs reaches the mutation via invoke(\"mesh:issue\") — the ONE registry door"
        );
        assert.ok(
          !/from\s*["']\.\/mesh-issuance\.mjs["']/.test(source) && !/require\(\s*["']\.\/mesh-issuance\.mjs["']\s*\)/.test(source),
          "mesh-ui-serve.mjs imports NO ./mesh-issuance.mjs — the mutation reaches ONLY through invoke"
        );
      } else {
        // The CURRENT m38 / ADR-012 tree: POST /api/mesh/assign wraps assignWork
        // VERBATIM — no low-level global_assignments writer reachable except
        // through that verb (ADR-012 inv.2).
        assert.ok(
          /assignWork\s*\(/.test(source),
          "mesh-ui-serve.mjs reaches the mutation via assignWork(...) — the gated verb, wrapped verbatim"
        );
        assert.ok(
          !/insertAssignment\s*\(/.test(source),
          "mesh-ui-serve.mjs makes no direct insertAssignment( call — the mint reaches ONLY through assignWork's own gates"
        );
        assert.ok(
          !/from\s*["']\.\/assignment-record\.mjs["']/.test(source),
          "mesh-ui-serve.mjs imports NO ./assignment-record.mjs (the low-level table writer) — the mutation reaches ONLY through the verb"
        );
      }

      // No fs-write call form and no shell-out, on EVERY tree — the face itself
      // performs no mutation of its own regardless of which half is satisfied.
      for (const verb of ["writeFile", "appendFile", "writeFileSync", "appendFileSync", "mkdir", "rm", "rmdir", "unlink", "rename"]) {
        assert.ok(
          !new RegExp(`\\b${verb}\\s*\\(`).test(source),
          `mesh-ui-serve.mjs makes no ${verb}( call — the face itself writes nothing (the mutation, if any, is behind the verb/invoke)`
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
      // A broken-half fixture: a SECOND write route (/api/mesh/route) declared
      // alongside /api/mesh/assign — the detector must FIRE on this shape, proving
      // it is not vacuously green on the guarded m38 tree either.
      const plantedSecondWriteRoute = stripComments(`
        if (pathname === "/api/mesh/assign") {
          const result = await assignWork(workspace, body.ref, body.nodeId, ctx);
          sendJson(response, 200, result);
        }
        if (pathname === "/api/mesh/route") {
          sendJson(response, 200, { ok: true });
        }
      `);
      assert.ok(
        /pathname\s*===\s*["']\/api\/mesh\/route["']/.test(plantedSecondWriteRoute),
        "self-check: the detector sees the planted /api/mesh/route sibling"
      );
      assert.ok(
        /pathname\s*===\s*["']\/api\/mesh\/(route|revoke)["']/.test(plantedSecondWriteRoute),
        "self-check: the detector FIRES on a planted SECOND write route (/api/mesh/route) beside /api/mesh/assign — this is the broken half"
      );

      // A broken-half fixture: /api/mesh/assign reaching the mutation via a DIRECT
      // insertAssignment call, bypassing assignWork's own gates.
      const plantedBypassVerb = stripComments(`
        import { insertAssignment } from "./assignment-record.mjs";
        if (pathname === "/api/mesh/assign") {
          insertAssignment(store, { itemRef: body.ref, targetNodeId: body.nodeId });
        }
      `);
      assert.ok(
        /insertAssignment\s*\(/.test(plantedBypassVerb) && /from\s*["']\.\/assignment-record\.mjs["']/.test(plantedBypassVerb),
        "self-check: the detector sees the planted direct insertAssignment bypass (the broken half — skipping the verb's gates)"
      );

      // The accepted guarded form (the shape this story ships) stays quiet on both
      // checks above.
      const accepted = stripComments(`
        if (pathname === "/api/mesh/assign") {
          const result = await assignWork(assignWorkspace, ref, nodeId, { globalWorkStoreOptions: globalStoreOptions ?? {} });
          sendJson(response, 200, result);
        }
      `);
      assert.ok(
        !/pathname\s*===\s*["']\/api\/mesh\/(route|revoke)["']/.test(accepted),
        "self-check: the accepted single-route form declares no second write route"
      );
      assert.ok(
        /assignWork\s*\(/.test(accepted) && !/insertAssignment\s*\(/.test(accepted),
        "self-check: the accepted form reaches the mutation via assignWork(...), never a direct insertAssignment("
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
