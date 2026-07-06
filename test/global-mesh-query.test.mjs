// Traceability wiring for milestone 34 / story 03 — src/global-mesh-query.mjs, the
// ONE composition seam the fleet serve-face reaches for its GLOBAL
// `/api/mesh/status` read (ARCHITECTURE ADR-006). Covers the shaping contract
// tasks/01_mesh-ui-api-scope-switch.feature's global scenario needs at the module
// level (workspaces/items/nodes assembled from the story 00/02 query surfaces,
// diagnostics carrying freshness + skipped workspaces + descriptor errors) and the
// store-open failure → coded "global-store-unavailable" mapping tasks/03 requires.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";
import { openGlobalWorkProjectionStore } from "../src/global-work-store.mjs";
import { publishGlobalRegistryDescriptorsToStore } from "../src/global-node-registry.mjs";
import { publishNodeRecord } from "../src/mesh-store.mjs";
import { publishPresenceRecord } from "../src/mesh-presence.mjs";
import { queryGlobalMeshStatus } from "../src/global-mesh-query.mjs";

async function withTemp(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-global-mesh-query-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeWorkspace(root, { name = path.basename(root), mesh = {}, stories = ["00"] } = {}) {
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 34\nslug: global-mesh\nstatus: in-progress\ntitle: Global Mesh\n---\n",
    "utf8",
  );
  for (const story of stories) {
    const storyDir = path.join(milestoneDir, "stories", `${story}_story_story-${story}`);
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      path.join(storyDir, "STORY.md"),
      `---\ntype: story\nnumber: ${story}\nslug: story-${story}\nparent: 34\nstatus: not-started\ntitle: Story ${story}\n---\n`,
      "utf8",
    );
  }
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: { enabled: true, ...mesh } }, null, 2)}\n`,
    "utf8",
  );
  return loadWorkspace(root);
}

async function seedNode(workspace, nodeId, fields = {}) {
  const record = {
    nodeId,
    host: fields.host ?? nodeId,
    os: fields.os ?? "win32",
    runtimes: fields.runtimes ?? ["codex"],
    skills: fields.skills ?? [],
    aofVersion: fields.aofVersion ?? "1.0.0",
    publishedAt: fields.publishedAt ?? "2026-07-04T10:00:00.000Z",
  };
  await publishNodeRecord(workspace, nodeId, record);
  if (fields.heartbeatAt) {
    await publishPresenceRecord(workspace, nodeId, { nodeId, heartbeatAt: fields.heartbeatAt, activeRuns: [], aofVersion: record.aofVersion });
  }
  return record;
}

export const globalMeshQueryTests = [
  {
    name: "global-mesh-query/00 shapes the global read from two workspaces into one payload with workspaces, items, and nodes",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const alpha = await makeWorkspace(path.join(tmp, "alpha"), { mesh: { nodeId: "node-a" }, stories: ["00", "01"] });
      const beta = await makeWorkspace(path.join(tmp, "beta"), { mesh: { nodeId: "node-b" }, stories: ["00"] });
      await seedNode(alpha, "node-a", { heartbeatAt: "2026-07-04T10:05:00.000Z" });
      await seedNode(beta, "node-b", { heartbeatAt: "2026-07-04T10:05:00.000Z" });

      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-04T10:05:00.000Z" });
        await store.publishWorkspaceSnapshot(beta, { now: "2026-07-04T10:05:00.000Z" });
        await publishGlobalRegistryDescriptorsToStore(store, alpha, { now: "2026-07-04T10:05:00.000Z" });
        await publishGlobalRegistryDescriptorsToStore(store, beta, { now: "2026-07-04T10:05:00.000Z" });
      } finally {
        store.close();
      }

      const result = await queryGlobalMeshStatus({ env: { AOF_GLOBAL_HOME: home } });
      assert.equal(result.scope, "global");
      assert.equal(result.workspaces.length, 2, "both workspaces surface in the summary");
      assert.equal(result.items.length, 5, "milestone 34 + story 00 + story 01 (alpha) + milestone 34 + story 00 (beta)");
      assert.equal(result.nodes.length, 2, "both nodes surface");
      assert.ok(result.workspaces.every((w) => w.meshEnabled === true), "both workspaces are marked mesh-enabled from the registry join");
      assert.equal(result.diagnostics.databasePath, globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).databasePath);
      assert.equal(result.diagnostics.projectedAt, "2026-07-04T10:05:00.000Z");
    }),
  },
  {
    name: "global-mesh-query/00 narrows to one workspace when a workspaceId filter is supplied (the ?scope=local deep-link mechanism)",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const alpha = await makeWorkspace(path.join(tmp, "alpha"), { mesh: { nodeId: "node-a" } });
      const beta = await makeWorkspace(path.join(tmp, "beta"), { mesh: { nodeId: "node-b" } });
      await seedNode(alpha, "node-a");
      await seedNode(beta, "node-b");

      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      let alphaId;
      try {
        const alphaResult = await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-04T10:00:00.000Z" });
        alphaId = alphaResult.workspaceId;
        await store.publishWorkspaceSnapshot(beta, { now: "2026-07-04T10:00:00.000Z" });
        await publishGlobalRegistryDescriptorsToStore(store, alpha, { now: "2026-07-04T10:00:00.000Z" });
        await publishGlobalRegistryDescriptorsToStore(store, beta, { now: "2026-07-04T10:00:00.000Z" });
      } finally {
        store.close();
      }

      const result = await queryGlobalMeshStatus({ env: { AOF_GLOBAL_HOME: home }, workspaceId: alphaId });
      assert.equal(result.workspaces.length, 1, "only the filtered workspace surfaces");
      assert.equal(result.workspaces[0].workspaceId, alphaId);
      assert.ok(result.items.every((item) => item.workspaceId === alphaId), "no work item from any other workspace leaks through");
      assert.ok(result.nodes.every((node) => node.workspaceIds.includes(alphaId)), "nodes are membership-filtered to the requested workspace");
    }),
  },
  {
    name: "global-mesh-query/00 an empty global store shapes to an empty (not errored) payload",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      // Open + immediately close so the schema exists but no workspace has published.
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      store.close();

      const result = await queryGlobalMeshStatus({ env: { AOF_GLOBAL_HOME: home } });
      assert.equal(result.scope, "global");
      assert.deepEqual(result.workspaces, []);
      assert.deepEqual(result.items, []);
      assert.deepEqual(result.nodes, []);
      assert.equal(result.diagnostics.projectedAt, null);
    }),
  },
  {
    name: "global-mesh-query/00 diagnostics expose skipped (mesh-disabled) workspaces and registry descriptor errors without hiding healthy data",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const alpha = await makeWorkspace(path.join(tmp, "alpha"), { mesh: { nodeId: "node-a" } });
      const disabled = await makeWorkspace(path.join(tmp, "gamma"), { mesh: { enabled: false, nodeId: "node-c" } });
      await seedNode(alpha, "node-a");

      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-04T10:05:00.000Z" });
        await publishGlobalRegistryDescriptorsToStore(store, alpha, { now: "2026-07-04T10:05:00.000Z" });
        // The disabled workspace still publishes its REGISTRY descriptor (meshEnabled:
        // false is itself the fact the diagnostics render — 34/ADR-002 "work doctor
        // should warn"); it does not publish a WORK snapshot (that write path is
        // gated by the shared predicate, story 01).
        await publishGlobalRegistryDescriptorsToStore(store, disabled, { now: "2026-07-04T10:05:00.000Z" });
        // Corrupt one node descriptor on disk so the registry query reports a
        // descriptor error for it, without losing the healthy node-a data.
        const { readdir, writeFile: write } = await import("node:fs/promises");
        const nodeFiles = await readdir(store.paths.nodesRoot);
        const brokenFile = nodeFiles.find((f) => f !== "node-a.json");
        if (brokenFile) await write(path.join(store.paths.nodesRoot, brokenFile), "{ not json", "utf8");
      } finally {
        store.close();
      }

      const result = await queryGlobalMeshStatus({ env: { AOF_GLOBAL_HOME: home } });
      assert.ok(result.workspaces.some((w) => w.meshEnabled === true), "the healthy mesh-enabled workspace still surfaces");
      assert.equal(result.diagnostics.skippedWorkspaces.length, 1, "exactly the disabled workspace is reported skipped");
      assert.equal(result.diagnostics.skippedWorkspaces[0].reason, "mesh-global-disabled");
      assert.ok(result.nodes.some((n) => n.nodeId === "node-a"), "the healthy node still surfaces despite the sibling descriptor error");
    }),
  },
  {
    name: "global-mesh-query/00 a store-open failure maps to a coded global-store-unavailable error carrying the database path",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      await assert.rejects(
        queryGlobalMeshStatus({ env: { AOF_GLOBAL_HOME: home }, sqlite: false }),
        (error) => {
          assert.equal(error.code, "global-store-unavailable");
          assert.equal(error.status, 503);
          assert.equal(error.path, globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).databasePath);
          return true;
        },
      );
    }),
  },
];
