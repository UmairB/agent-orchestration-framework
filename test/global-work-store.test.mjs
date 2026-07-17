import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openGlobalWorkProjectionStore, queryGlobalWorkProjection, recordWorkspaceProjectionError, workspaceIdFor } from "../src/global-work-store.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";

function frontmatter(fields) {
  return [
    "---",
    ...Object.entries(fields).map(([key, value]) => `${key}: ${typeof value === "string" && value.includes(" ") ? JSON.stringify(value) : value}`),
    "---",
    "",
  ].join("\n");
}

async function makeWorkspace(root, { stories = ["00", "01"], malformed = false } = {}) {
  const workDir = path.join(root, "wiki", "work");
  const milestoneDir = path.join(workDir, "34_milestone_global-mesh");
  await mkdir(milestoneDir, { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    frontmatter({ type: "milestone", number: "34", slug: "global-mesh", status: "in-progress", title: "Global Mesh" }),
    "utf8",
  );
  for (const story of stories) {
    const storyDir = path.join(milestoneDir, "stories", `${story}_story_story-${story}`);
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      path.join(storyDir, "STORY.md"),
      frontmatter({ type: "story", number: story, slug: `story-${story}`, parent: "34", status: "not-started", title: `Story ${story}` }),
      "utf8",
    );
  }
  if (malformed) {
    const storyDir = path.join(milestoneDir, "stories", "99_story_broken");
    await mkdir(storyDir, { recursive: true });
    await writeFile(path.join(storyDir, "STORY.md"), "# Broken\n\nNo frontmatter.\n", "utf8");
  }
  return {
    config: { name: path.basename(root), work: { dir: "./wiki/work" } },
    projectRoot: root,
    workDir,
  };
}

async function withTemp(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-global-work-store-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export const globalWorkStoreTests = [
  {
    name: "global-work-store/00 global mesh paths derive from AOF_GLOBAL_HOME",
    run: async () => withTemp(async (home) => {
      const paths = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } });
      assert.equal(paths.meshRoot, path.join(home, "mesh"));
      assert.equal(paths.workRoot, path.join(home, "mesh", "work"));
      assert.equal(paths.nodesRoot, path.join(home, "mesh", "nodes"));
      assert.equal(paths.workspacesRoot, path.join(home, "mesh", "workspaces"));
      assert.equal(paths.databasePath, path.join(home, "mesh", "work", "projection.sqlite"));
    }),
  },
  {
    name: "global-work-store/01 opening the store creates schema and is idempotent",
    run: async () => withTemp(async (home) => {
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        assert.ok(existsSync(store.paths.databasePath), "projection database exists");
        // milestone 35 / story 00 (ADR-001) — schema v2 -> v3: the additive
        // global_assignments table (assignment-record.mjs owns its own dedicated
        // fixture suite; this is just the pinned-version/table-presence re-arm).
        // v3 -> v4 (ADR-010 Gap A extended, review fix live soak 2026-07-17):
        // global_workspace_descriptors.clone_url — mesh-assignment-record.test.mjs
        // owns the dedicated ALTER TABLE migration fixture; this is the SAME
        // pinned-version re-arm.
        assert.equal(store.schemaVersion, 4);
        const tables = store.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map((r) => r.name);
        assert.ok(tables.includes("aof_schema"));
        assert.ok(tables.includes("workspaces"));
        assert.ok(tables.includes("work_items"));
        assert.ok(tables.includes("projection_metadata"));
        assert.ok(tables.includes("projection_errors"));
        assert.ok(tables.includes("global_nodes"));
        assert.ok(tables.includes("global_workspace_descriptors"));
        assert.ok(tables.includes("global_node_workspaces"));
        assert.ok(tables.includes("global_assignments"));
      } finally {
        store.close();
      }

      const reopened = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        const versions = reopened.db.prepare("SELECT value FROM aof_schema WHERE key = 'version'").all();
        assert.equal(versions.length, 1);
        assert.equal(versions[0].value, 4);
      } finally {
        reopened.close();
      }
    }),
  },
  {
    name: "global-work-store/01 SQLite unavailable refuses without creating a partial database",
    run: async () => withTemp(async (home) => {
      const paths = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } });
      await assert.rejects(
        openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home }, sqlite: false }),
        (error) => error.code === "sqlite-unavailable",
      );
      assert.equal(existsSync(paths.databasePath), false);
    }),
  },
  {
    name: "global-work-store/01 future schema refuses without changing the version",
    run: async () => withTemp(async (home) => {
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      store.db.prepare("UPDATE aof_schema SET value = 99 WHERE key = 'version'").run();
      store.close();
      await assert.rejects(
        openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } }),
        (error) => error.code === "global-store-schema-unsupported" && error.schemaVersion === 99,
      );
      const bytes = await readFile(globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).databasePath);
      assert.ok(bytes.length > 0, "future database remains present");
    }),
  },
  {
    name: "global-work-store/02 publishing a workspace snapshot replaces stale rows and preserves other workspaces",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const alphaRoot = path.join(tmp, "alpha");
      const betaRoot = path.join(tmp, "beta");
      const alpha = await makeWorkspace(alphaRoot, { stories: ["00", "01"] });
      const beta = await makeWorkspace(betaRoot, { stories: ["00"] });
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-04T10:00:00.000Z" });
        await store.publishWorkspaceSnapshot(beta, { now: "2026-07-04T10:01:00.000Z" });
        assert.equal(queryGlobalWorkProjection(store).items.length, 5);

        await rm(path.join(alphaRoot, "wiki", "work", "34_milestone_global-mesh", "stories", "01_story_story-01"), { recursive: true, force: true });
        const changedAlpha = await makeWorkspace(alphaRoot, { stories: ["00"] });
        await store.publishWorkspaceSnapshot(changedAlpha, { now: "2026-07-04T10:02:00.000Z" });
        const global = queryGlobalWorkProjection(store);
        const alphaId = workspaceIdFor(alphaRoot);
        const betaId = workspaceIdFor(betaRoot);
        assert.deepEqual(global.items.filter((i) => i.workspaceId === alphaId).map((i) => i.ref), ["34", "34/00"]);
        assert.deepEqual(global.items.filter((i) => i.workspaceId === betaId).map((i) => i.ref), ["34", "34/00"]);
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-work-store/02 malformed work records become projection errors beside healthy rows",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const workspace = await makeWorkspace(path.join(tmp, "alpha"), { stories: [], malformed: true });
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        const result = await store.publishWorkspaceSnapshot(workspace, { now: "2026-07-04T10:00:00.000Z" });
        assert.equal(result.itemCount, 1);
        assert.equal(result.skipped, 1);
        const query = queryGlobalWorkProjection(store);
        assert.equal(query.items.length, 1);
        assert.equal(query.errors.length, 1);
        assert.match(query.errors[0].sourcePath, /broken\/STORY\.md$/);
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-work-store/02 projection write failures can be recorded beside the workspace row",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const workspace = await makeWorkspace(path.join(tmp, "alpha"), { stories: ["00"] });
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        const error = new Error("write failed");
        error.code = "projection-write-failed";
        recordWorkspaceProjectionError(store, workspace, error, { now: "2026-07-04T10:03:00.000Z" });
        const query = queryGlobalWorkProjection(store, { workspaceId: workspaceIdFor(workspace.projectRoot) });
        assert.equal(query.workspaces.length, 1);
        assert.equal(query.errors.length, 1);
        assert.equal(query.errors[0].code, "projection-write-failed");
        assert.equal(query.errors[0].message, "write failed");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-work-store/03 query can filter by workspace and returns fresh copies",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const alpha = await makeWorkspace(path.join(tmp, "alpha"), { stories: ["00"] });
      const beta = await makeWorkspace(path.join(tmp, "beta"), { stories: ["00"] });
      const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
      try {
        await store.publishWorkspaceSnapshot(alpha, { now: "2026-07-04T10:00:00.000Z" });
        await store.publishWorkspaceSnapshot(beta, { now: "2026-07-04T10:01:00.000Z" });
        const alphaId = workspaceIdFor(alpha.projectRoot);
        const scoped = queryGlobalWorkProjection(store, { workspaceId: alphaId });
        assert.equal(scoped.workspaces.length, 1);
        assert.equal(scoped.items.length, 2);
        scoped.items[0].ref = "mutated";
        const scopedAgain = queryGlobalWorkProjection(store, { workspaceId: alphaId });
        assert.deepEqual(scopedAgain.items.map((item) => item.ref), ["34", "34/00"]);
      } finally {
        store.close();
      }
    }),
  },
];
