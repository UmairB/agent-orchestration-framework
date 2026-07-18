// test/support/mesh-worker-clone-fixture.mjs — shared fixture builder for milestone
// 38 / story 01 (worker-repo-checkout) task traceability modules. Mirrors
// mesh-worker-exec-fixture.mjs's shape but for the CLONE-ON-MISS lane: a REAL git
// repo (so addWorktree/run-store still exercise real fixtures once the guard passes)
// PLUS a hermetic AOF_GLOBAL_HOME, but the clone itself is ALWAYS driven through an
// INJECTED cloneExec fake — no real forge, no real credential, no network (the
// developer-amigo feasibility seat's verdict for tasks 00-03).
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSyncHardened } from "./cli-spawn.mjs";
import { loadWorkspace } from "../../src/work.mjs";
import { workspaceIdFor } from "../../src/global-work-store.mjs";

function git(cwd, args) {
  return spawnSyncHardened("git", args, { cwd, encoding: "utf8", shell: process.platform === "win32" });
}

// withMeshCloneFixture(fn, { cloneUrl }) — builds a real git repo with ONE resolvable
// story item, WITHOUT the mesh.repo.published marker (a genuine repo-miss), optionally
// carrying config.mesh.repo.cloneUrl. Hands the caller { root, home, workspace,
// workspaceId, itemRef, env, headSha }.
export async function withMeshCloneFixture(fn, { cloneUrl, milestoneNumber = "38", storySlug = "clonedemo", storyNumber = "00" } = {}) {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-clone-"));
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

    const mesh = { nodeId: "worker-a" };
    if (cloneUrl !== undefined) mesh.repo = { cloneUrl };

    await mkdir(path.join(root, ".aof"), { recursive: true });
    await writeFile(
      path.join(root, ".aof", "aof.config.json"),
      `${JSON.stringify({ name: "demo", work: { dir: "./wiki/work" }, mesh }, null, 2)}\n`,
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

    return await fn({ tmp, home, root, workDir, workspace, workspaceId, itemRef, env, headSha, git: (args) => git(root, args) });
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
}

// createStatusRecorder() — mirrors mesh-worker-exec-fixture.mjs's recorder exactly
// (kept local so this module has no cross-dependency on the m35 fixture).
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

// scriptedSpawnRuntime — mirrors mesh-worker-exec-fixture.mjs's scripted double.
export function scriptedSpawnRuntime(outcome, { failureReason = null } = {}) {
  return async () => ({ outcome, failureReason: outcome === "failed" ? failureReason ?? "agent_error" : null });
}

// scriptedPushExec — mirrors mesh-worker-exec-fixture.mjs's scripted push double
// (milestone 38 / story 07, ADR-015): a NO-OP push success double for this fixture
// family's pre-story-07 tests, which drive `done` outcomes to assert CLONE mechanics
// unrelated to the push step itself — without this, createMeshWorkerExecutionHandler
// falls through to a REAL `git push origin <branch>` (no `origin` remote configured
// in this fixture family), which fails loudly and RETAINS the worktree instead of
// completing `done`.
export function scriptedPushExec(status = 0) {
  return async () => ({ stdout: "", stderr: "", status });
}

// createRecordingCloneExec(script) — the INJECTED clone-exec double (mirrors
// mesh-worktree.mjs's options.exec fake idiom). `script` is either a fixed
// `{ status, stdout, stderr }` result, or a function `(args, opts) => result` for a
// per-call decision. Records every call's { args, cwd, env } so a test can assert
// argv-form / env-scoping without a real git binary.
export function createRecordingCloneExec(script = { status: 0, stdout: "", stderr: "" }) {
  const calls = [];
  return {
    calls,
    async exec(args, opts = {}) {
      calls.push({ args: [...args], cwd: opts.cwd, env: opts.env ? { ...opts.env } : undefined });
      const result = typeof script === "function" ? await script(args, opts) : script;
      return { status: 0, stdout: "", stderr: "", ...result };
    },
  };
}
