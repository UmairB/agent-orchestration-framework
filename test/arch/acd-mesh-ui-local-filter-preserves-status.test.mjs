// Fitness: acd-mesh-ui-local-filter (milestone 34 / story 06; ARCHITECTURE ADR-006 as
// amended — mesh state is machine-wide GLOBAL, so `--local` is NOT a different data
// source, it is the SAME global view with the WORK ITEMS filtered to the current repo's
// workspace id; the NODE roster stays machine-wide either way).
//
// Structural half: mesh-ui-serve.mjs's status route reaches its data ONLY via
// queryGlobalMeshStatus (the ONE global source) and passes a workspaceId for local
// scope — it does NOT read the status via invoke("mesh:status") anymore. Behavioural
// half: a server STARTED with scope:"local" filters WORK ITEMS to the current workspace,
// while the NODE roster stays the full machine-wide set.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveMeshUi, meshUiDist } from "../../src/mesh-ui-serve.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../../src/global-node-registry.mjs";
import { publishNodeRecord } from "../../src/mesh-store.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MESH_UI_SERVE = path.join(repoRoot, "src", "mesh-ui-serve.mjs");
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

async function writeDist(dir) {
  await mkdir(path.join(dir, "assets"), { recursive: true });
  await writeFile(path.join(dir, "index.html"), "<!doctype html><html><head><script type=\"module\" src=\"/assets/i.js\"></script></head><body><div id=\"root\"></div></body></html>\n", "utf8");
  await writeFile(path.join(dir, "assets", "i.js"), "export const x = 1;\n", "utf8");
  return dir;
}

async function makeWorkspace(root, name, mesh, stories) {
  const milestoneDir = path.join(root, "wiki", "work", "34_milestone_x");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(path.join(milestoneDir, "SPEC.md"), "---\ntype: milestone\nnumber: 34\nslug: x\nstatus: in-progress\ntitle: X\n---\n", "utf8");
  for (const s of stories) {
    const d = path.join(milestoneDir, "stories", `${s}_story_s`);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "STORY.md"), `---\ntype: story\nnumber: ${s}\nslug: s\nparent: 34\nstatus: not-started\ntitle: S${s}\n---\n`, "utf8");
  }
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh })}\n`, "utf8");
  return loadWorkspace(root, undefined, { env: { AOF_GLOBAL_HOME: process.env.AOF_GLOBAL_HOME } });
}

export const archTests = [
  {
    name: "arch/34 ADR-006: mesh-ui-serve.mjs's status route reads via queryGlobalMeshStatus (the ONE global source) with a workspaceId for local — never invoke(\"mesh:status\")",
    async run() {
      const source = stripComments(await import("node:fs/promises").then((fs) => fs.readFile(MESH_UI_SERVE, "utf8")));
      const routeStart = source.indexOf('pathname === "/api/mesh/status"');
      assert.ok(routeStart >= 0, "the status route exists");
      const routeEnd = source.indexOf("/api/mesh/issue", routeStart);
      const route = source.slice(routeStart, routeEnd > routeStart ? routeEnd : undefined);
      assert.ok(/queryGlobalMeshStatus\s*\(/.test(route), "the status read goes through queryGlobalMeshStatus");
      assert.ok(/workspaceId\s*[:=]/.test(route), "local scope passes a workspaceId filter");
      assert.ok(!/invoke\s*\(\s*["']mesh:status["']/.test(route), "the status route no longer reads via invoke(\"mesh:status\") — there is ONE global source");
    },
  },
  {
    name: "arch/34 ADR-006 (behavioural): a scope:\"local\" server filters WORK ITEMS to the current workspace, while the NODE roster stays machine-wide",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-local-home-"));
      const prevHome = process.env.AOF_GLOBAL_HOME;
      process.env.AOF_GLOBAL_HOME = home;
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-ui-local-root-"));
      await writeDist(meshUiDist(root));
      let server;
      try {
        const alpha = await makeWorkspace(path.join(root, "alpha"), "alpha", { enabled: true, nodeId: "node-a" }, ["00", "01"]);
        const beta = await makeWorkspace(path.join(root, "beta"), "beta", { enabled: true, nodeId: "node-b" }, ["00"]);
        await publishNodeRecord(alpha, "node-a", { nodeId: "node-a", host: "a", os: "win32", runtimes: [], aofVersion: "1", publishedAt: "2026-07-05T10:00:00.000Z" });
        await publishNodeRecord(beta, "node-b", { nodeId: "node-b", host: "b", os: "darwin", runtimes: [], aofVersion: "1", publishedAt: "2026-07-05T10:00:00.000Z" });

        const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
        try {
          await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-05T10:00:00.000Z" });
          await store.publishWorkspaceSnapshot(beta, { now: "2026-07-05T10:00:00.000Z" });
          await publishGlobalRegistryDescriptorsToStore(store, alpha, { now: "2026-07-05T10:00:00.000Z" });
          await publishGlobalRegistryDescriptorsToStore(store, beta, { now: "2026-07-05T10:00:00.000Z" });
        } finally {
          store.close();
        }

        ({ server } = await serveMeshUi({ projectDir: path.join(root, "alpha"), port: 0, repoRoot: root, scope: "local" }));
        const address = server.address();
        const body = await (await fetch(`http://127.0.0.1:${address.port}/api/mesh/status`)).json();

        assert.equal(body.scope, "local");
        const alphaId = workspaceIdFor(path.resolve(root, "alpha"));
        assert.ok(body.items.length > 0, "the local view has work items");
        assert.ok(body.items.every((i) => i.workspaceId === alphaId), "WORK ITEMS are filtered to the current (alpha) workspace only");
        assert.ok(body.nodes.some((n) => n.nodeId === "node-a") && body.nodes.some((n) => n.nodeId === "node-b"), "the NODE roster stays machine-wide (both nodes surface even under --local)");
      } finally {
        if (server) await new Promise((resolve) => server.close(resolve));
        if (prevHome === undefined) delete process.env.AOF_GLOBAL_HOME;
        else process.env.AOF_GLOBAL_HOME = prevHome;
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    },
  },
];
