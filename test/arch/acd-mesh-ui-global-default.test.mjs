// Fitness function: acd-mesh-ui-global-default (milestone 34 / story 03;
// ARCHITECTURE ADR-006 — "aof mesh ui reads the global projection by default").
//
// "`aof mesh ui` and `/api/mesh/status` default to the global projection query
//  surface and do NOT invoke the workspace-local `mesh:status` command for the
//  default global read."
//
// Structural half: src/cli.mjs's meshUiCommand computes scope "global" unless
// --local is present, and passes it straight to serveMeshUi (no silent
// re-defaulting to "local" anywhere in between). Behavioural half: a server
// STARTED with the default (no scope override) answers the machine-wide
// queryGlobalMeshStatus read, and invoke("mesh:status") is never reached for it —
// proven by pointing the "local" data source at a workspace that would THROW if
// loadWorkspace/invoke("mesh:status") were ever called (an absent workspace dir),
// while the global read still succeeds against a real global store fixture.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { openGlobalWorkProjectionStore } from "../../src/global-work-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI_PATH = path.join(repoRoot, "src", "cli.mjs");

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(
    path.join(dir, "index.html"),
    "<!doctype html><html><head><script type=\"module\" src=\"/assets/index-abc123.js\"></script></head><body><div id=\"root\"></div></body></html>\n",
    "utf8",
  );
  await writeFile(path.join(dir, "assets", "index-abc123.js"), "export const x = 1;\n", "utf8");
  return dir;
}

async function makeRepoRootWithDist() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-acd-mesh-ui-global-default-root-"));
  await writeDist(meshUiDist(root));
  return root;
}

async function makeWorkspace(root, nodeId) {
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 34\nslug: global-mesh\nstatus: in-progress\ntitle: Global Mesh\n---\n",
    "utf8",
  );
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name: path.basename(root), work: { dir: "./wiki/work" }, mesh: { enabled: true, nodeId } }, null, 2)}\n`,
    "utf8",
  );
  return loadWorkspace(root);
}

export const archTests = [
  {
    name: "arch/34 ADR-006: meshUiCommand defaults scope to \"global\" (no --local) and only flips to \"local\" under --local",
    async run() {
      const source = stripComments(await readFile(CLI_PATH, "utf8"));
      const start = source.indexOf("async function meshUiCommand");
      assert.ok(start >= 0, "meshUiCommand is defined in cli.mjs");
      const body = source.slice(start, start + 2000);
      assert.ok(
        /const\s+scope\s*=\s*options\.local\s*\?\s*["']local["']\s*:\s*["']global["']/.test(body),
        "meshUiCommand computes scope as \"global\" unless --local is set",
      );
      assert.ok(
        /serveMeshUi\s*\(\s*\{[^}]*scope[^}]*\}\s*\)/.test(body),
        "meshUiCommand passes the computed scope straight through to serveMeshUi",
      );
    },
  },
  {
    name: "arch/34 ADR-006: serveMeshUi's default GET /api/mesh/status reads the global projection, never invoke(\"mesh:status\")",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-acd-mesh-ui-global-default-home-"));
      const root = await makeRepoRootWithDist();
      // A cwd that is NOT a loadable workspace at all — if the default route ever
      // reached loadWorkspace/invoke("mesh:status") for the DEFAULT scope, this
      // request would throw (no .aof/aof.config.json here) instead of answering 200.
      const noWorkspaceCwd = await mkdtemp(path.join(os.tmpdir(), "aof-acd-mesh-ui-global-default-cwd-"));
      const alphaSrc = await mkdtemp(path.join(os.tmpdir(), "aof-acd-mesh-ui-global-default-alpha-"));
      let server;
      try {
        const alpha = await makeWorkspace(alphaSrc, "node-a");
        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-05T00:00:00.000Z" });
        } finally {
          store.close();
        }

        ({ server } = await serveMeshUi({
          projectDir: noWorkspaceCwd,
          port: 0,
          repoRoot: root,
          // no `scope` supplied — the DEFAULT under test.
          globalStoreOptions: { env: { AOF_GLOBAL_HOME: home } },
        }));
        const address = server.address();
        const response = await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`);
        assert.equal(response.status, 200, "the default global read answers 200 even though the cwd is not a loadable workspace");
        const body = await response.json();
        assert.equal(body.scope, "global", "the default response is labelled scope:\"global\"");
        assert.ok(!("boards" in body), "the payload is the global shape (workspaces/items/nodes), not the mesh:status boards aggregate");
        assert.ok(Array.isArray(body.workspaces) && body.workspaces.length >= 1, "the global projection carries the published workspace");
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        await rm(home, { recursive: true, force: true });
        await rm(root, { recursive: true, force: true });
        await rm(noWorkspaceCwd, { recursive: true, force: true });
        await rm(alphaSrc, { recursive: true, force: true });
      }
    },
  },
];
