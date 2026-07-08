// milestone 34 / story 06 (ADR-010) — `aof mesh repo publish` core: the explicit
// per-repo publish verb writes a local published marker AND lands a snapshot in the
// machine-wide global store, opting a repo in without any prior `mesh join`/global
// enable. Hermetic via AOF_GLOBAL_HOME.
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readJson } from "../src/fs.mjs";
import { loadWorkspace } from "../src/work.mjs";
import { publishRepoToMesh } from "../src/commands/mesh-repo.mjs";
import { queryGlobalMeshStatus } from "../src/global-mesh-query.mjs";
import { workspaceIdFor } from "../src/global-work-store.mjs";

async function makeRepo(root, name, mesh) {
  const milestoneDir = path.join(root, "wiki", "work", "40_milestone_demo");
  await mkdir(path.join(milestoneDir, "stories", "00_story_a"), { recursive: true });
  await writeFile(
    path.join(milestoneDir, "SPEC.md"),
    "---\ntype: milestone\nnumber: 40\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
    "utf8",
  );
  await writeFile(
    path.join(milestoneDir, "stories", "00_story_a", "STORY.md"),
    "---\ntype: story\nnumber: 00\nslug: a\nparent: 40\nstatus: not-started\ntitle: A\n---\n",
    "utf8",
  );
  await mkdir(path.join(root, ".aof"), { recursive: true });
  const config = { name, work: { dir: "./wiki/work" }, ...(mesh ? { mesh } : {}) };
  await writeFile(path.join(root, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export const meshRepoPublishTests = [
  {
    name: "mesh repo publish: writes the local published marker AND lands a snapshot in the global store (opts in without a prior enable)",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-repo-pub-home-"));
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-repo-pub-root-"));
      const env = { AOF_GLOBAL_HOME: home };
      try {
        // Deliberately NOT mesh-enabled — the explicit publish is the opt-in.
        await makeRepo(root, "demo", { fabric: "tailscale" });
        const ws = await loadWorkspace(root, undefined, { env });
        const now = "2026-07-08T10:00:00.000Z";

        const result = await publishRepoToMesh(ws, { now, globalWorkStoreOptions: { env } });

        assert.equal(result.published, true, "the snapshot published");
        assert.equal(result.warning, null, "no propagation warning");
        const workspaceId = workspaceIdFor(root);
        assert.equal(result.workspaceId, workspaceId);

        // (1) the local marker is written; every other key survives.
        const onDisk = await readJson(path.join(root, ".aof", "aof.config.json"));
        assert.equal(onDisk.mesh.repo.published, true, "mesh.repo.published marker written");
        assert.equal(onDisk.mesh.repo.publishedAt, now, "publishedAt recorded");
        assert.equal(onDisk.mesh.repo.workspaceId, workspaceId, "workspaceId recorded");
        assert.equal(onDisk.mesh.fabric, "tailscale", "existing mesh keys preserved");
        assert.equal(onDisk.name, "demo", "non-mesh keys preserved");

        // (2) the global store now carries this workspace + its work items.
        const status = await queryGlobalMeshStatus({ env });
        assert.ok(status.workspaces.some((w) => w.workspaceId === workspaceId), "workspace present in the global projection");
        assert.ok(status.items.length > 0, "work items published to the global store");
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh repo publish: idempotent re-publish refreshes publishedAt and the marker merge preserves committed mesh keys",
    async run() {
      const home = await mkdtemp(path.join(os.tmpdir(), "aof-repo-pub2-home-"));
      const root = await mkdtemp(path.join(os.tmpdir(), "aof-repo-pub2-root-"));
      const env = { AOF_GLOBAL_HOME: home };
      try {
        await makeRepo(root, "demo2", { nodeId: "keepme", relay: { controlNode: "ctl" } });

        const ws1 = await loadWorkspace(root, undefined, { env });
        await publishRepoToMesh(ws1, { now: "2026-07-08T10:00:00.000Z", globalWorkStoreOptions: { env } });

        const ws2 = await loadWorkspace(root, undefined, { env });
        const second = await publishRepoToMesh(ws2, { now: "2026-07-08T11:00:00.000Z", globalWorkStoreOptions: { env } });
        assert.equal(second.published, true, "the re-publish still lands cleanly");

        const onDisk = await readJson(path.join(root, ".aof", "aof.config.json"));
        assert.equal(onDisk.mesh.repo.published, true);
        assert.equal(onDisk.mesh.repo.publishedAt, "2026-07-08T11:00:00.000Z", "publishedAt refreshed on re-publish");
        assert.equal(onDisk.mesh.nodeId, "keepme", "committed nodeId preserved through the marker write");
        assert.equal(onDisk.mesh.relay.controlNode, "ctl", "relay subtree preserved through the marker write");
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(home, { recursive: true, force: true });
      }
    },
  },
];
