// Shared fixture builder for the milestone 35 / story 00 assign/withdraw/repo-gate
// test suites — a hermetic AOF_GLOBAL_HOME v3 store + a resolvable work item + a
// seeded node registry (the m34 global-store/global-node-registry test convention).
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../../src/global-work-store.mjs";
import { loadWorkspace } from "../../src/work.mjs";

export async function withMeshAssignFixture(fn, { seedItems = ["00"] } = {}) {
  // realpath the root: macOS's os.tmpdir() is a symlink (/var → /private/var),
  // and a SPAWNED CLI's process.cwd() is the REAL path — a raw mkdtemp root
  // would make the fixture's path-derived workspaceId disagree with the id the
  // spawned CLI derives, so cross-process scenarios could never match rows.
  const tmp = await realpath(await mkdtemp(path.join(os.tmpdir(), "aof-mesh-assign-")));
  const home = path.join(tmp, "home");
  const root = path.join(tmp, "repo");
  try {
    const workDir = path.join(root, "wiki", "work");
    const milestoneDir = path.join(workDir, "35_milestone_demo");
    await mkdir(milestoneDir, { recursive: true });
    await writeFile(
      path.join(milestoneDir, "SPEC.md"),
      "---\ntype: milestone\nnumber: 35\nslug: demo\nstatus: in-progress\ntitle: Demo\n---\n",
      "utf8",
    );
    for (const story of seedItems) {
      const storyDir = path.join(milestoneDir, "stories", `${story}_story_story-${story}`);
      await mkdir(storyDir, { recursive: true });
      await writeFile(
        path.join(storyDir, "STORY.md"),
        `---\ntype: story\nnumber: ${story}\nslug: story-${story}\nparent: 35\nstatus: not-started\ntitle: Story ${story}\n---\n`,
        "utf8",
      );
    }
    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeFile(
      path.join(root, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" }, mesh: { nodeId: "control-a" } }, null, 2)}\n`,
      "utf8",
    );

    const env = { AOF_GLOBAL_HOME: home };
    const workspace = await loadWorkspace(root, undefined, { env });
    const workspaceId = workspace.config?.mesh?.workspaceId ?? workspaceIdFor(root);

    const ctx = { globalWorkStoreOptions: { env } };
    return await fn({ tmp, home, root, workspace, workspaceId, env, ctx });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// seedTargetNode(ctx, { nodeId, workspaceId, published }) — seeds the exact two store
// facts the repo-availability gate reads: a `global_nodes` row (the node is "known")
// and, when `member`, a `global_node_workspaces` link; when `published`, the
// workspace's `workspaces.last_published_at` is stamped (the durable echo of
// `mesh.repo.published`). Direct SQL seeding — the fixture shape the story's build
// notes call for ("fixturable by seeding rows/config directly").
export async function seedTargetNode({ home }, { nodeId, workspaceId, member = true, published = true, projectRoot, workDir }) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    store.db.prepare(`
      INSERT OR REPLACE INTO global_nodes (node_id, role, control_node, host, os, runtimes_json, skills_json, aof_version, published_at, last_seen_at, fabric_address, fabric_online, record_source, descriptor_path)
      VALUES (?, 'worker', 0, ?, 'win32', '[]', '[]', '1.0.0', '2026-07-08T09:00:00.000Z', '2026-07-08T09:00:00.000Z', NULL, NULL, 'node-record', ?)
    `).run(nodeId, nodeId, `descriptor-${nodeId}.json`);

    if (member) {
      store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(nodeId, workspaceId);
    }

    store.db.prepare(`
      INSERT INTO workspaces (workspace_id, project_root, work_dir, name, last_published_at)
      VALUES (?, ?, ?, 'demo', ?)
      ON CONFLICT(workspace_id) DO UPDATE SET last_published_at = excluded.last_published_at
    `).run(workspaceId, projectRoot ?? "", workDir ?? "", published ? "2026-07-08T09:30:00.000Z" : null);
  } finally {
    store.close();
  }
}

// seedAssignment(ctx, record-ish) — direct-insert an assignment row for a "Given a
// prior assignment in state X" background, bypassing assignWork so tests can construct
// an arbitrary prior state without walking the verb.
export async function seedAssignment({ home }, { assignmentId, itemRef, workspaceId, targetNodeId, issuer, state, runId = null, assignedAt, updatedAt, reclaimedAt = null }) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    store.db.prepare(`
      INSERT INTO global_assignments (assignment_id, item_ref, workspace_id, target_node_id, issuer, state, run_id, assigned_at, updated_at, reclaimed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(assignmentId, itemRef, workspaceId, targetNodeId, issuer, state, runId, assignedAt, updatedAt ?? assignedAt, reclaimedAt);
  } finally {
    store.close();
  }
}

export async function readAssignmentRows({ home }, workspaceId, itemRef) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    return store.db.prepare("SELECT * FROM global_assignments WHERE workspace_id = ? AND item_ref = ? ORDER BY assigned_at").all(workspaceId, itemRef);
  } finally {
    store.close();
  }
}
