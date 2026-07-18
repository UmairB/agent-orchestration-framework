// test/support/mesh-worker-push-fixture.mjs — shared fixture builder for milestone 38
// / story 07 (durable-worker-pushback, ADR-015) task 00/01 traceability modules. Wraps
// `withMeshWorkerExecFixture` (story-01's real-git-fixture-repo pattern, unchanged) and
// ADDS a REAL LOCAL BARE repo as the push `origin` — no real GitHub, no network (the
// milestone's own ADR-008 discipline: the real producer's SHAPE, never a mocked git).
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSyncHardened } from "./cli-spawn.mjs";
import { withMeshWorkerExecFixture } from "./mesh-worker-exec-fixture.mjs";

// git(cwd, args) — deliberately NEVER `shell: true` (unlike the wrapped
// mesh-worker-exec-fixture.mjs's own helper, which gets away with it only because
// every argv element it ever passes is a single, space-free token): `shell: true` on
// Windows re-tokenizes each argv element on whitespace before handing it to cmd.exe,
// silently corrupting ANY spaced value (a commit message, a path containing a space)
// into bogus extra arguments — MEASURED here (a spaced temp-dir path broke `git init`
// outright). `git.exe` resolves off PATH via plain spawnSync on Windows with no shell
// wrapper needed at all, so dropping `shell` sidesteps the landmine entirely.
function git(cwd, args) {
  return spawnSyncHardened("git", args, { cwd, encoding: "utf8" });
}

// withMeshWorkerPushFixture(fn, opts) — everything withMeshWorkerExecFixture already
// hands the caller, PLUS a REAL bare repo at `<tmp>/origin.git` wired as the fixture
// repo's `origin` remote (`fx.bareOrigin`, `fx.git(...)` unchanged). Cleanup is the
// SAME whole-tmp-tree removal the wrapped fixture already performs.
export async function withMeshWorkerPushFixture(fn, opts = {}) {
  return withMeshWorkerExecFixture(async (fx) => {
    const bareOrigin = path.join(fx.tmp, "origin.git");
    const bareInit = git(fx.tmp, ["init", "--bare", "-q", bareOrigin]);
    if (bareInit.status !== 0) {
      throw new Error(`fixture: git init --bare failed: ${bareInit.stderr || bareInit.stdout}`);
    }
    const remoteAdd = git(fx.root, ["remote", "add", "origin", bareOrigin]);
    if (remoteAdd.status !== 0) {
      throw new Error(`fixture: git remote add origin failed: ${remoteAdd.stderr || remoteAdd.stdout}`);
    }
    return fn({ ...fx, bareOrigin });
  }, opts);
}

// createRecordingGitExec(calls, { worktreePath }) — the SHARED injected exec seam
// (both `mesh-worktree.mjs`'s `options.exec` AND `mesh-worker-execution.mjs`'s
// `options.pushExec` share the SAME `(args, { cwd, env }) => Promise<{ stdout, stderr,
// status }>` contract) — a REAL `git` spawn WRAPPED with a call-order recorder, never a
// mocked git (task 01's OBSERVABLE-call-order requirement over the real bare origin).
// Each recorded entry carries `{ args, cwd, kind }`; a `push` entry additionally
// captures `worktreeExistedAtCallTime` — the snapshot the "retained until push
// succeeds" assertion needs, taken at the INSTANT the push argv is seen, before the
// real spawn runs.
export function createRecordingGitExec(calls, { worktreePath } = {}) {
  return (args, options = {}) => {
    const isWorktree = args[0] === "worktree";
    const kind = isWorktree ? `worktree-${args[1]}` : args.includes("push") ? "push" : args.join(" ");
    const entry = { args: [...args], cwd: options.cwd, kind };
    if (kind === "push" && worktreePath) {
      entry.worktreeExistedAtCallTime = existsSync(worktreePath);
    }
    calls.push(entry);
    return new Promise((resolve, reject) => {
      execFile("git", args, { cwd: options.cwd, env: options.env, windowsHide: true, timeout: 30000 }, (error, stdout, stderr) => {
        if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
          reject(error);
          return;
        }
        const result = { stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 };
        entry.status = result.status;
        entry.stderr = result.stderr;
        resolve(result);
      });
    });
  };
}

// makeOriginBranchDivergent(fx, branch) — engineers a REAL non-fast-forward push
// fault: pushes `branch` to `fx.bareOrigin` from a SEPARATE throwaway clone, at a
// commit UNRELATED to the fixture root's own HEAD lineage — so when the worker's OWN
// worktree (branched from the root's HEAD) later tries `git push origin <branch>`, the
// origin's tip is not an ancestor of the worker's tip and git genuinely refuses it.
export async function makeOriginBranchDivergent(fx, branch) {
  const scratch = path.join(fx.tmp, "divergent-scratch");
  await mkdir(scratch, { recursive: true });
  git(scratch, ["init", "-q"]);
  git(scratch, ["config", "user.email", "fixture@aof.local"]);
  git(scratch, ["config", "user.name", "aof fixture"]);
  git(scratch, ["config", "commit.gpgsign", "false"]);
  await writeFile(path.join(scratch, "divergent.txt"), "unrelated history\n", "utf8");
  git(scratch, ["add", "-A"]);
  // A SINGLE-token commit message (no spaces/apostrophes) — `shell: true` on Windows
  // (this file's own `git()` helper, mirroring every other fixture in this suite)
  // word-splits a multi-word argv element instead of preserving it as one arg, which
  // silently corrupts a spaced commit message into bogus pathspecs.
  git(scratch, ["commit", "-q", "-m", "divergent-fixture-commit"]);
  const pushResult = git(scratch, ["push", "-q", fx.bareOrigin, `HEAD:refs/heads/${branch}`]);
  if (pushResult.status !== 0) {
    throw new Error(`fixture: seeding a divergent origin branch failed: ${pushResult.stderr || pushResult.stdout}`);
  }
}

// breakOriginUnreachable(fx) — repoints the fixture repo's `origin` remote at a path
// that genuinely does not exist, so a subsequent `git push origin ...` fails with a
// REAL "repository not found"/unreachable fault — never a mocked network error.
export function breakOriginUnreachable(fx) {
  const result = git(fx.root, ["remote", "set-url", "origin", path.join(fx.tmp, "does-not-exist.git")]);
  if (result.status !== 0) {
    throw new Error(`fixture: repointing origin to an unreachable path failed: ${result.stderr || result.stdout}`);
  }
}

// installPreReceiveRefusal(fx) — a REAL git `pre-receive` hook on the bare origin that
// unconditionally refuses every push — the hermetic, local analog of "refused for
// missing write auth" (a real server-side receive-time refusal, not a client-side
// network fault). Git for Windows ships its own POSIX shell, so a shebang hook script
// runs there exactly as it would on POSIX; the executable bit is set defensively for
// POSIX hosts (a no-op, harmlessly ignored on Windows/NTFS).
export async function installPreReceiveRefusal(fx) {
  const hooksDir = path.join(fx.bareOrigin, "hooks");
  await mkdir(hooksDir, { recursive: true });
  const hookPath = path.join(hooksDir, "pre-receive");
  await writeFile(hookPath, "#!/bin/sh\necho \"refusing: missing write auth (test double)\" 1>&2\nexit 1\n", "utf8");
  await chmod(hookPath, 0o755).catch(() => {});
}
