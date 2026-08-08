// Traceability wiring for milestone 34 / story 03 — the mesh-UI global-scope
// contract:
//
//   tasks/00_cli-scope-selection.feature (@executable) — `aof mesh ui` selects
//     scope "global" by default and scope "local" under --local; an unrecognized
//     flag is rejected BEFORE serveMeshUi is ever called.
//   tasks/01_mesh-ui-api-scope-switch.feature (@executable) — GET /api/mesh/status
//     defaults to the global projection query; --local (or ?scope=local) narrows the
//     same global projection to the current workspace; an unsupported ?scope= value is//     a clean 400 invalid-scope; the write/namespace isolation matrix is unchanged.
//
// The CLI-level scenarios drive the REAL CLI (bin/aof.mjs mesh ui) via spawn (the
// mesh-ui-cli-face.test.mjs idiom) with AOF_GLOBAL_HOME relocated to an isolated
// temp home so a global default run never touches the operator's real global
// store. The API-level scenarios drive serveMeshUi directly (the mesh-ui-serve.
// test.mjs idiom) against a REAL global projection store built with the story
// 00/02 publish helpers (no mock query layer — the same publish→query round trip
// story 00/02's own tests use).
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, meshUiDist } from "../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { spawnCliSync } from "./support/cli-spawn.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliPath = path.join(repoRoot, "bin", "aof.mjs");

// --- fixtures ----------------------------------------------------------------

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

async function makeRepoRootWithDist() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-root-"));
  await writeDist(meshUiDist(root));
  return root;
}

// A workspace whose config points work.dir at wiki/work and (optionally) enables
// mesh global propagation — the global-node-registry.test.mjs makeWorkspace idiom.
async function makeWorkspace(root, { name = path.basename(root), mesh = {}, seedItem = true, env } = {}) {
  const workDir = path.join(root, "wiki", "work");
  if (seedItem) {
    const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
    await mkdir(milestoneDir, { recursive: true });
    await writeFile(
      path.join(milestoneDir, "SPEC.md"),
      "---\ntype: milestone\nnumber: 34\nslug: global-mesh\nstatus: in-progress\ntitle: Global Mesh\n---\n",
      "utf8"
    );
  } else {
    await mkdir(workDir, { recursive: true });
  }
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: { enabled: true, ...mesh } }, null, 2)}\n`,
    "utf8"
  );
  return loadWorkspace(root, undefined, { env });
}

// A LOCAL (non-global-propagating) workspace whose .aof/mesh holds node/presence
// records so the legacy local fixture remains non-empty — mirrors
// mesh-ui-serve.test.mjs's makeRepo, but WITHOUT mesh.enabled (local-only fixture;
// the global default scenario must not depend on any global propagation).
async function makeLocalRepo() {
  // realpath: macOS's os.tmpdir() is a /var → /private/var symlink, and the
  // spawned CLI resolves its cwd — a raw mkdtemp path would fail the Project:-
  // line identity comparison (pre-existing at HEAD, verified by stash
  // 2026-07-30; the mesh-assign-fixture realpath precedent).
  const repo = await realpath(await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-local-")));
  const meshDir = path.join(repo, ".aof", "mesh");
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  await mkdir(path.join(meshDir, "nodes"), { recursive: true });
  await mkdir(path.join(meshDir, "presence"), { recursive: true });
  await writeFile(
    path.join(repo, ".aof", "aof.config.json"),
    JSON.stringify({ name: "fixture", work: { dir: "./wiki/work" } }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "nodes", "local-node.json"),
    JSON.stringify({ nodeId: "local-node", host: "local-node", os: "win32", runtimes: ["claude"], skills: [], aofVersion: "0.1.0", publishedAt: "2026-06-29T00:00:00.000Z" }, null, 2),
    "utf8"
  );
  await writeFile(
    path.join(meshDir, "presence", "local-node.json"),
    JSON.stringify({ nodeId: "local-node", heartbeatAt: new Date().toISOString(), activeRuns: [], aofVersion: "0.1.0" }, null, 2),
    "utf8"
  );
  return repo;
}

async function seedNode(workspace, nodeId, fields = {}) {
  await publishNodeRecord(workspace, nodeId, {
    nodeId,
    host: fields.host ?? nodeId,
    os: fields.os ?? "win32",
    runtimes: fields.runtimes ?? [],
    skills: fields.skills ?? [],
    aofVersion: fields.aofVersion ?? "1.0.0",
    publishedAt: fields.publishedAt ?? "2026-07-04T10:00:00.000Z",
  });
}

async function buildGlobalFixture(home) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-store-"));
  const env = { AOF_GLOBAL_HOME: home };
  const alpha = await makeWorkspace(path.join(tmp, "alpha"), { mesh: { nodeId: "node-a" }, env });
  const beta = await makeWorkspace(path.join(tmp, "beta"), { mesh: { nodeId: "node-b" }, env });
  await seedNode(alpha, "node-a");
  await seedNode(beta, "node-b");

  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  let alphaId;
  try {
    const alphaResult = await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-04T10:05:00.000Z" });
    alphaId = alphaResult.workspaceId;
    await store.publishWorkspaceSnapshot(beta, { now: "2026-07-04T10:05:00.000Z" });
    await publishGlobalRegistryDescriptorsToStore(store, alpha, { now: "2026-07-04T10:05:00.000Z" });
    await publishGlobalRegistryDescriptorsToStore(store, beta, { now: "2026-07-04T10:05:00.000Z" });
  } finally {
    store.close();
  }
  return { tmp, alphaId, alphaRoot: alpha.projectRoot, betaRoot: beta.projectRoot };
}

async function closeServer(server) {
  await new Promise((resolve) => server.close(resolve));
}

async function cleanup(...dirs) {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
}

// --- CLI-level launch helper (mirrors mesh-ui-cli-face.test.mjs's launchFleet) ---

function launchFleet(cwd, args, env, { readyRe = /Open this URL in your browser:\s*\S+/, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    import("node:child_process").then(({ spawn }) => {
      const child = spawn(process.execPath, [cliPath, ...args], {
        cwd,
        env: { ...process.env, NODE_NO_WARNINGS: "1", ...env },
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        try { child.kill("SIGTERM"); } catch { /* noop */ }
        reject(new Error(`fleet launch timed out; stdout=<${stdout}> stderr=<${stderr}>`));
      }, timeoutMs);
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
        if (!settled && readyRe.test(stdout)) {
          settled = true;
          clearTimeout(timer);
          resolve({
            child,
            get stdout() { return stdout; },
            get stderr() { return stderr; },
            stop: () =>
              new Promise((res) => {
                child.on("close", () => res());
                try { child.kill("SIGTERM"); } catch { res(); }
              }),
          });
        }
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => { stderr += chunk; });
      child.on("close", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`fleet exited before readiness; stdout=<${stdout}> stderr=<${stderr}>`));
      });
      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      });
    });
  });
}

export const meshUiGlobalScopeTests = [
  // ═══ task 00 — CLI scope selection ═══════════════════════════════════════════

  {
    name: "mesh-ui-global-scope/00 `aof mesh ui` starts the global mesh view by default (no workspace required, scope=global in the announced URL)",
    async run() {
      const localOnlyDir = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-nowks-"));
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-home-"));
      let handle;
      try {
        // The CWD is deliberately NOT a mesh-enabled workspace (no .aof at all) —
        // the scenario's "does not require the current directory to be a
        // mesh-enabled workspace before starting" assertion.
        handle = await launchFleet(localOnlyDir, ["mesh", "ui", "--port", "0"], { AOF_GLOBAL_HOME: home });
        assert.ok(handle.stdout.includes("AOF mesh ui is running locally."), "prints the human announce line");
        // m45 / story 04 (ADR-002) — the announce names the fleet's PATH and carries the
        // default scope as a REAL query parameter on it. Read through `new URL`: this is
        // the exact line whose `&scope=` used to be concatenated onto a URL assumed to
        // carry a query, and `…/fleet&scope=global` would satisfy `/scope=global/` while
        // being a pathname with no parameters — the substring assertion could not tell
        // the fix from the defect.
        const announcedMatch = handle.stdout.match(/Open this URL in your browser:\s*(\S+)/);
        assert.ok(announcedMatch, "the launch announces a fleet URL");
        const announced = new URL(announcedMatch[1]);
        assert.equal(announced.pathname, "/fleet", `the URL names the ADR-002 fleet path (got: ${announcedMatch[1]})`);
        assert.equal(announced.searchParams.get("mode"), null, "…and mints no legacy `mode` selector");
        assert.equal(announced.searchParams.get("scope"), "global", "the URL carries scope=global by default");
      } finally {
        if (handle) await handle.stop();
        await cleanup(localOnlyDir, home);
      }
    },
  },

  {
    name: "mesh-ui-global-scope/00 `aof mesh ui --local` starts the current-workspace filtered view, passing projectDir and printing Project:",
    async run() {
      const repo = await makeLocalRepo();
      let handle;
      try {
        // The ready-regex waits for the Project: line too (not just the URL line)
        // — all four announce lines are synchronous console.log calls in immediate
        // succession, but under a loaded aggregated test run they can arrive across
        // two stdout chunks; waiting for BOTH avoids a read-before-arrival flake.
        handle = await launchFleet(repo, ["mesh", "ui", "--local", "--port", "0"], {}, {
          readyRe: /Open this URL in your browser:\s*\S+[\s\S]*Project:\s*\S+/,
        });
        // m45 / story 04 (ADR-002) — same parsed read as the global row above: the path
        // is the fleet's, and `scope` is a real parameter on it, never a glued substring.
        const localMatch = handle.stdout.match(/Open this URL in your browser:\s*(\S+)/);
        assert.ok(localMatch, "the launch announces a fleet URL");
        const localAnnounced = new URL(localMatch[1]);
        assert.equal(localAnnounced.pathname, "/fleet", `the URL names the ADR-002 fleet path (got: ${localMatch[1]})`);
        assert.equal(localAnnounced.searchParams.get("scope"), "local", "the URL carries scope=local under --local");
        // path.resolve (not a literal string compare) — under a loaded aggregated
        // run Windows can answer a path with different separators/short-name
        // normalization for the SAME directory; comparing resolved paths keeps the
        // assertion about IDENTITY (same directory), not incidental formatting.
        const projectLine = handle.stdout.match(/Project:\s*(.+)/);
        assert.ok(projectLine, "prints a Project: line naming the current directory");
        assert.equal(path.resolve(projectLine[1].trim()), path.resolve(repo), "the Project: line names the current directory");
      } finally {
        if (handle) await handle.stop();
        await cleanup(repo);
      }
    },
  },

  {
    name: "mesh-ui-global-scope/00 `--local` preserves the friendly ui-build-missing refusal (exit 1, no stack trace) — via the in-process serve face with a repoRoot that carries no build",
    async run() {
      // The real aof checkout's ui/dist always exists in this dev tree (the CLI
      // spawn face can't remove it), so — mirroring mesh-ui-cli-face.test.mjs's own
      // documented NOTE on this exact limitation — the build-missing contract is
      // driven in-process here, through the SAME code path the mesh:ui launch
      // body's catch block reaches (error.code === "ui-build-missing" →
      // console.error + exit 1, never a stack trace), proving `--local`
      // (scope:"local") hits the identical mapping as the default global scope
      // (no scope-conditional bypass).
      const repo = await makeLocalRepo();
      const noBuildRoot = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-nobuild-"));
      try {
        await assert.rejects(
          serveMeshUi({ projectDir: repo, port: 0, repoRoot: noBuildRoot, scope: "local" }),
          (error) => {
            assert.equal(error.code, "ui-build-missing");
            assert.ok(/The fleet UI build is missing/.test(error.message));
            // the mesh:ui launch body's catch prints error.message ONLY, never
            // error.stack — the operator-facing text itself carries no stack frame.
            assert.ok(!/at\s+\S+:\d+:\d+/.test(error.message), "the operator-facing message carries no stack-trace frame");
            return true;
          },
        );
      } finally {
        await cleanup(repo, noBuildRoot);
      }
    },
  },

  {
    name: "mesh-ui-global-scope/00 an unrecognized mesh UI flag is rejected before serving (exit 1, serveMeshUi never called)",
    async run() {
      const repo = await makeLocalRepo();
      try {
        const r = spawnCliSync(process.execPath, [cliPath, "mesh", "ui", "--workspace", "alpha"], {
          cwd: repo,
          encoding: "utf8",
          env: { ...process.env, NODE_NO_WARNINGS: "1" },
        });
        assert.equal(r.status, 1, `exits 1 on an unknown flag (stderr: ${r.stderr})`);
        // m42 wave (d) leg d1 (wave-3 tail) — the documented contract change that
        // came with mesh:ui joining the route table: the refusal is the generic
        // face's spec-parse vocabulary (`Unknown flag "--x" for mesh:ui` + usage),
        // replacing the retired MESH_UI_FLAGS guard's `Unknown option "--x".`.
        assert.match(r.stderr, /^Unknown flag "--workspace" for mesh:ui\./, "stderr explains the unknown flag by name in the face's vocabulary");
        assert.ok(!/is running locally\./.test(r.stdout), "serveMeshUi is never reached — no fleet server announce");
      } finally {
        await cleanup(repo);
      }
    },
  },

  // ═══ task 01 — mesh UI API scope switch ══════════════════════════════════════

  {
    name: "mesh-ui-global-scope/01 global mode answers the global projection query (two workspaces, work items, and nodes)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-home-"));
      const root = await makeRepoRootWithDist();
      const cwd = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-cwd-"));
      let server;
      try {
        const { alphaId } = await buildGlobalFixture(home);
        ({ server } = await serveMeshUi({
          projectDir: cwd,
          port: 0,
          repoRoot: root,
          scope: "global",
          globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
        }));
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.scope, "global");
        assert.equal(body.workspaces.length, 2, "both workspaces surface");
        assert.equal(body.items.length, 2, "one milestone item per workspace (this fixture's own item count)");
        assert.equal(body.nodes.length, 2, "both nodes surface");
        assert.ok(body.workspaces.some((w) => w.workspaceId === alphaId));
      } finally {
        if (server) await closeServer(server);
        await cleanup(root, cwd);
      }
    },
  },

  {
    name: "mesh-ui-global-scope/01 --local filters WORK ITEMS to the current workspace; the NODE roster stays machine-wide (34/story 06)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-local-home-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { alphaId, alphaRoot } = await buildGlobalFixture(home);
        ({ server } = await serveMeshUi({
          projectDir: alphaRoot,
          port: 0,
          repoRoot: root,
          scope: "local",
          globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
        }));
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.scope, "local");
        assert.equal(body.currentWorkspace, path.resolve(alphaRoot));
        assert.ok(body.items.length > 0 && body.items.every((i) => i.workspaceId === alphaId), "WORK ITEMS are filtered to the current (alpha) workspace");
        assert.ok(body.nodes.some((n) => n.nodeId === "node-a") && body.nodes.some((n) => n.nodeId === "node-b"), "the NODE roster stays machine-wide under --local (both nodes surface)");
      } finally {
        if (server) await closeServer(server);
        await cleanup(root, home);
      }
    },
  },

  {
    name: "mesh-ui-global-scope/01 a local filter requested through ?scope=local narrows the global projection to the current workspace (deep-link)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-home-"));
      const root = await makeRepoRootWithDist();
      let server;
      try {
        const { alphaId, alphaRoot } = await buildGlobalFixture(home);
        ({ server } = await serveMeshUi({
          projectDir: alphaRoot,
          port: 0,
          repoRoot: root,
          scope: "global",
          globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
        }));
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status?scope=local`);
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.equal(body.scope, "local");
        assert.ok(body.workspaces.every((w) => w.workspaceId === alphaId), "no workspace outside the filter surfaces");
        assert.ok(body.items.every((item) => item.workspaceId === alphaId), "no work item from beta leaks through");
      } finally {
        if (server) await closeServer(server);
        await cleanup(root);
      }
    },
  },

  {
    name: "mesh-ui-global-scope/01 an unsupported ?scope= value is a clean 400 invalid-scope, with no query or workspace command invoked",
    async run() {
      const root = await makeRepoRootWithDist();
      const cwd = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-cwd2-"));
      let server;
      try {
        // A deliberately-unusable global store AND a cwd with no .aof at all — if
        // either the global query or loadWorkspace were reached, this would throw
        // instead of a clean 400.
        ({ server } = await serveMeshUi({
          projectDir: cwd,
          port: 0,
          repoRoot: root,
          scope: "global",
          globalStoreOptions: { sqlite: false },
        }));
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status?scope=workspace`);
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.code, "invalid-scope");
      } finally {
        if (server) await closeServer(server);
        await cleanup(root, cwd);
      }
    },
  },

  // ═══ task 03 — empty/error/health states: the 503 body carries `path` ═══════

  {
    name: "mesh-ui-global-scope/03 the global-store-unavailable 503 body carries { code, path } (review fix P0.5 — the HTTP-altitude contract task 03 scenario 2 asserts)",
    async run() {
      const root = await makeRepoRootWithDist();
      const cwd = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-503-"));
      let server;
      try {
        // sqlite:false forces openGlobalWorkProjectionStore to throw (no supported
        // runtime available) — global-mesh-query.mjs's openGlobalStoreOrCodedError
        // wraps ANY open-time failure into { code:"global-store-unavailable",
        // status:503, path: <the global mesh database path> }.
        ({ server } = await serveMeshUi({
          projectDir: cwd,
          port: 0,
          repoRoot: root,
          scope: "global",
          globalStoreOptions: { sqlite: false },
        }));
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`);
        assert.equal(response.status, 503, "an unavailable global store surfaces a 503, not a 500/crash");
        const body = await response.json();
        assert.equal(body.code, "global-store-unavailable");
        assert.ok(typeof body.path === "string" && body.path.length > 0, "the 503 body carries the global mesh database path (not dropped by sendApiError)");
        assert.ok(body.path.includes("mesh"), "the path names the global mesh store location");
      } finally {
        if (server) await closeServer(server);
        await cleanup(root, cwd);
      }
    },
  },

  {
    name: "mesh-ui-global-scope/01 existing namespace/method isolation is unchanged under the new scope switch (POST 405, /api/work 404)",
    async run() {
      const root = await makeRepoRootWithDist();
      const cwd = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-global-scope-cwd3-"));
      let server;
      try {
        ({ server } = await serveMeshUi({
          projectDir: cwd,
          port: 0,
          repoRoot: root,
          scope: "global",
          globalStoreOptions: { sqlite: false },
        }));
        const address = server.address();
        const postResponse = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`, { method: "POST" });
        assert.equal(postResponse.status, 405);
        assert.equal(postResponse.headers.get("allow"), "GET, HEAD");

        const workResponse = await fetch(`http://127.0.0.1:${address.port}/api/work/items`);
        assert.equal(workResponse.status, 404);
        assert.equal((await workResponse.json()).code, "not-found");
      } finally {
        if (server) await closeServer(server);
        await cleanup(root, cwd);
      }
    },
  },
];
