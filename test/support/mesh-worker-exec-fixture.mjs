// Shared fixture builder for milestone 35 / story 02 (isolated worker execution) —
// a REAL git repo (git init + commit, the makeGitFixtureRepo idiom
// test/import-command-core.test.mjs already established) with a resolvable work
// item, `.aof/aof.config.json` carrying `mesh.repo.published` + a nodeId, and a
// hermetic v3 global store (AOF_GLOBAL_HOME) so the worker-side repo guard, the real
// `git worktree add`/`remove`, and the run-store all exercise against one disposable
// temp tree. Mirrors test/support/mesh-assign-fixture.mjs's shape for the store half.
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSyncHardened } from "./cli-spawn.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../../src/global-work-store.mjs";
import { readJson, writeText } from "../../src/fs.mjs";

function git(cwd, args) {
  return spawnSyncHardened("git", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

// withMeshWorkerExecFixture(fn, { milestoneNumber, storySlug }) — builds a real git
// repo with ONE resolvable story item under a milestone, commits it, and hands the
// caller { root, home, workspace, workspaceId, itemRef, env, ctx, headSha }.
// Cleanup removes the whole temp tree (repo + global home) unconditionally.
export async function withMeshWorkerExecFixture(fn, { milestoneNumber = "35", storySlug = "demo", storyNumber = "00" } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-worker-exec-"));
  const home = path.join(tmp, "home");
  const root = path.join(tmp, "repo");
  try {
    const workDir = path.join(root, "wiki", "work");
    const milestoneDir = path.join(workDir, `${milestoneNumber}_milestone_${storySlug}`);
    const storyDir = path.join(milestoneDir, "stories", `${storyNumber}_story_${storySlug}-${storyNumber}`);
    await mkdir(storyDir, { recursive: true });
    await writeFile(
      path.join(milestoneDir, "SPEC.md"),
      `---\ntype: milestone\nnumber: ${milestoneNumber}\nslug: ${storySlug}\nstatus: in-progress\ntitle: Demo\n---\n`,
      "utf8",
    );
    await writeFile(
      path.join(storyDir, "STORY.md"),
      `---\ntype: story\nnumber: ${storyNumber}\nslug: ${storySlug}-${storyNumber}\nparent: ${milestoneNumber}\nstatus: not-started\ntitle: Demo story\n---\n`,
      "utf8",
    );
    const itemRef = `${milestoneNumber}/${storyNumber}`;

    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeFile(
      path.join(root, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" }, mesh: { nodeId: "worker-a" } }, null, 2)}\n`,
      "utf8",
    );
    await writeFile(path.join(root, ".gitignore"), ".aof/\n", "utf8");

    git(root, ["init", "-q"]);
    git(root, ["config", "user.email", "fixture@aof.local"]);
    git(root, ["config", "user.name", "aof fixture"]);
    git(root, ["config", "commit.gpgsign", "false"]);
    git(root, ["add", "-A"]);
    git(root, ["commit", "-q", "-m", "fixture-story"]);
    const headSha = git(root, ["rev-parse", "HEAD"]).stdout.trim();

    const env = { AOF_GLOBAL_HOME: home };
    const workspace = await loadWorkspace(root, undefined, { env });
    const workspaceId = workspace.config?.mesh?.workspaceId ?? workspaceIdFor(root);
    const ctx = { globalWorkStoreOptions: { env } };

    return await fn({ tmp, home, root, workDir, workspace, workspaceId, itemRef, env, ctx, headSha, git: (args) => git(root, args) });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// markRepoPublished(root, { workspaceId }) — writes the LOCAL mesh.repo.published
// marker directly (mirroring commands/mesh-repo.mjs's own on-disk shape) so a test
// can construct the worker-side "has the repo" fact without spawning `aof mesh repo
// publish`. Read-merge-write so the config's other keys (mesh.nodeId, work.dir) stay
// intact.
export async function markRepoPublished(root, { workspaceId, publishedAt = "2026-07-09T09:00:00.000Z" } = {}) {
  const configPath = path.join(root, ".aof", "aof.config.json");
  const onDisk = await readJson(configPath);
  onDisk.mesh = { ...onDisk.mesh, repo: { published: true, publishedAt, workspaceId } };
  await writeText(configPath, `${JSON.stringify(onDisk, null, 2)}\n`);
}

// seedNodeWorkspaceMembership({ home }, { nodeId, workspaceId }) — the control-side
// `global_node_workspaces` fact (unused by the worker-side guard, which reads its
// OWN local marker directly — kept here for tests that also exercise the control-
// side gate/registry alongside the worker fixture).
export async function seedNodeWorkspaceMembership({ home }, { nodeId, workspaceId }) {
  const store = await openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
  try {
    store.db.prepare(`
      INSERT OR REPLACE INTO global_nodes (node_id, role, control_node, host, os, runtimes_json, skills_json, aof_version, published_at, last_seen_at, fabric_address, fabric_online, record_source, descriptor_path)
      VALUES (?, 'worker', 0, ?, 'win32', '[]', '[]', '1.0.0', '2026-07-09T09:00:00.000Z', '2026-07-09T09:00:00.000Z', NULL, NULL, 'node-record', ?)
    `).run(nodeId, nodeId, `descriptor-${nodeId}.json`);
    store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(nodeId, workspaceId);
  } finally {
    store.close();
  }
}

// createStatusRecorder() — the INJECTED status emitter mirroring worker-stream-
// client's sendAssignmentStatus signature: records every call as
// { assignmentId, state, options } in order, so tests assert the emitted sequence
// without a real transport.
export function createStatusRecorder() {
  const frames = [];
  return {
    frames,
    async sendAssignmentStatus(assignmentId, state, options = {}) {
      frames.push({ assignmentId, state, ...options });
      return { sent: true };
    },
  };
}

// scriptedSpawnRuntime(outcome, { failureReason }) — the INJECTED runtime-spawn seam
// double: resolves the given terminal outcome. Mirrors the real spawnRuntime
// contract's shape (never resolving before "the child has exited" — this fake has no
// child at all, so it resolves synchronously-after-a-microtask, which is what a
// real fully-exited child would look like from the caller's perspective).
export function scriptedSpawnRuntime(outcome, { failureReason = null } = {}) {
  return async () => ({ outcome, failureReason: outcome === "failed" ? failureReason ?? "agent_error" : null });
}
