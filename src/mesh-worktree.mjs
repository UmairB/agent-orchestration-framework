// src/mesh-worktree.mjs — the ONE mesh-worktrees path seam + the real `git worktree`
// mechanics (milestone 35 / story 02, ADR-004, task 00/03).
//
// THE ONE SEAM (fitness #8 acd-assignment-worktree-path-scoped / SECURITY F4
// acd-worktree-path-scoped): every worktree materialization joins
// `meshWorktreePath(projectRoot, assignmentId)` — a prefix-child of
// `<repo>/.aof/mesh/worktrees/` — never `os.tmpdir()`, never a hand-built path. The
// location is INSIDE the repo's own `.aof/` (already git-ignored, already the home of
// `.aof/mesh/` state, ADR-004) so worktrees never pollute the working tree and are
// removed with the repo.
//
// THE INJECTED EXEC SEAM (mirroring mesh-fabric.mjs's `(bin, args) => Promise<{
// stdout, status }>` idiom, the git-argv shell-less precedent — NEVER a shell string;
// narrowed here to ONE bin since this module only ever spawns `git`):
// `options.exec(args, { cwd }) => Promise<{ stdout, stderr, status }>`. Production
// spawns real `git` via node:child_process execFile; tests inject a fake that scripts
// stdout/status without a real binary OR (for tasks 00/03, which are explicitly
// RESOLVED to run over a REAL git worktree in a temp fixture repo, RESEARCH.md §4/§5)
// exercise the real spawn against a disposable fixture repo (the DEFAULT — `exec`
// absent — IS the real spawn).
//
// RETENTION (task 03, ADR-004): `done` → `git worktree remove` (dir + admin metadata
// gone, path reusable — RESEARCH.md §4 measured; NEVER a bare `rm`, which leaves stale
// `.git/worktrees/<name>` prunable metadata that blocks re-add). `failed` → RETAIN for
// inspection, bounded by a DOCUMENTED retention ceiling (a constant, not scattered) —
// `sweepRetainedWorktrees` removes anything past it.
import path from "node:path";
import { execFile } from "node:child_process";

// The documented retention ceiling for a RETAINED (failed) worktree, in milliseconds
// (ADR-004 "bounded by an explicit retention default … a documented constant, not
// scattered"). 24h: long enough for an operator to inspect a failure before the next
// sweep prunes it, short enough that disk does not grow unbounded across many failed
// assignments.
export const DEFAULT_WORKTREE_RETENTION_MS = 24 * 60 * 60 * 1000;

// meshWorktreesRoot(projectRoot) — the ONE root every worktree lives under.
export function meshWorktreesRoot(projectRoot) {
  return path.join(projectRoot, ".aof", "mesh", "worktrees");
}

// meshWorktreePath(projectRoot, assignmentId) — THE ONE SEAM (fitness #8 / F4). Keyed
// by assignmentId (not itemRef) — a stable, collision-free path even across
// reassignments (ADR-004). Never called with anything but a real assignmentId; never
// composed with directive/ref text (T3b — the ref resolves INSIDE the checkout via the
// enumerate-then-filter resolver, never a path.join(root, ref)).
export function meshWorktreePath(projectRoot, assignmentId) {
  return path.join(meshWorktreesRoot(projectRoot), String(assignmentId));
}

// isUnderMeshWorktreesRoot(projectRoot, candidatePath) — the structural/behavioural
// "prefix-child of the dedicated root" check tests + the reclaim/cleanup paths reuse,
// so "scoped" has one definition.
export function isUnderMeshWorktreesRoot(projectRoot, candidatePath) {
  const root = path.resolve(meshWorktreesRoot(projectRoot)) + path.sep;
  const normalized = path.resolve(candidatePath) + path.sep;
  return normalized.startsWith(root);
}

// ------------------------------------------------- the injected exec seam ----

function settleExecFile(error, stdout, stderr, resolve, reject) {
  if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
    reject(error);
    return;
  }
  resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
}

// The ONE literal `git` spawn call-form in this module (the mesh-fabric.mjs precedent)
// — execFile's argv form only, never a shell string.
function defaultGitExec(args, { cwd, timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) =>
      settleExecFile(error, stdout, stderr, resolve, reject)
    );
  });
}

function resolveExec(options) {
  return typeof options?.exec === "function" ? options.exec : defaultGitExec;
}

function gitError(message, code, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

// -------------------------------------------------------- worktree verbs ----

// addWorktree(projectRoot, assignmentId, commitish, options) — `git worktree add
// --detach <path> <commitish>` at the ONE seam path. Detached-at-commit (RESEARCH.md
// §4/§5): no branch-name contention between concurrent assignments. Returns the
// materialized path. A non-zero exit is a thrown, coded fault (the caller/orchestrator
// decides how to surface it — this module never swallows a real git failure).
export async function addWorktree(projectRoot, assignmentId, commitish, options = {}) {
  const exec = resolveExec(options);
  const worktreePath = meshWorktreePath(projectRoot, assignmentId);
  const result = await exec(["worktree", "add", "--detach", worktreePath, commitish], { cwd: projectRoot });
  if (result.status !== 0) {
    throw gitError(`git worktree add failed for assignment "${assignmentId}": ${result.stderr || result.stdout}`, "worktree-add-failed", { assignmentId, worktreePath, stderr: result.stderr });
  }
  return worktreePath;
}

// removeWorktree(projectRoot, assignmentId, options) — `git worktree remove` (NEVER a
// bare rm — RESEARCH.md §4: a bare rm leaves `.git/worktrees/<name>` behind as
// prunable metadata that blocks a later `add` at the same path; `git worktree remove`
// clears BOTH the dir and the admin metadata). `options.force` passes `--force` (a
// worktree holding uncommitted/untracked changes needs it — RESEARCH.md §4).
export async function removeWorktree(projectRoot, assignmentId, options = {}) {
  const exec = resolveExec(options);
  const worktreePath = meshWorktreePath(projectRoot, assignmentId);
  const args = ["worktree", "remove", ...(options.force ? ["--force"] : []), worktreePath];
  const result = await exec(args, { cwd: projectRoot });
  if (result.status !== 0) {
    throw gitError(`git worktree remove failed for assignment "${assignmentId}": ${result.stderr || result.stdout}`, "worktree-remove-failed", { assignmentId, worktreePath, stderr: result.stderr });
  }
  return worktreePath;
}

// listWorktrees(projectRoot, options) — `git worktree list --porcelain`, parsed into
// [{ path, head, branch, detached, locked, prunable }]. Used by the retention sweep +
// the "no stale prunable metadata" assertion (task 03).
export async function listWorktrees(projectRoot, options = {}) {
  const exec = resolveExec(options);
  const result = await exec(["worktree", "list", "--porcelain"], { cwd: projectRoot });
  if (result.status !== 0) {
    throw gitError(`git worktree list failed: ${result.stderr || result.stdout}`, "worktree-list-failed", { stderr: result.stderr });
  }
  return parseWorktreeListPorcelain(result.stdout);
}

function parseWorktreeListPorcelain(stdout) {
  const entries = [];
  let current = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trimEnd();
    if (trimmed.startsWith("worktree ")) {
      if (current) entries.push(current);
      current = { path: trimmed.slice("worktree ".length), head: null, branch: null, detached: false, locked: false, prunable: false };
    } else if (current && trimmed.startsWith("HEAD ")) {
      current.head = trimmed.slice("HEAD ".length);
    } else if (current && trimmed.startsWith("branch ")) {
      current.branch = trimmed.slice("branch ".length);
    } else if (current && trimmed === "detached") {
      current.detached = true;
    } else if (current && (trimmed === "locked" || trimmed.startsWith("locked "))) {
      current.locked = true;
    } else if (current && (trimmed === "prunable" || trimmed.startsWith("prunable "))) {
      current.prunable = true;
    }
  }
  if (current) entries.push(current);
  return entries;
}

// sweepRetainedWorktrees(projectRoot, retainedAssignments, options) — the bounded
// RETENTION sweep (ADR-004/task 03): each `{ assignmentId, failedAt }` whose age
// (`now - failedAt`) exceeds the documented ceiling is removed via `git worktree
// remove` (never a bare rm); everything within the ceiling is left untouched. Returns
// `{ swept: [assignmentId…], kept: [assignmentId…] }`. `now`/`retentionMs` are
// INJECTED (the 22/R2 inject-the-clock discipline) — this function reads no wall clock
// by default only at the top-level default parameter, never internally re-read.
export async function sweepRetainedWorktrees(projectRoot, retainedAssignments, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const nowMs = Date.parse(now);
  const retentionMs = typeof options.retentionMs === "number" ? options.retentionMs : DEFAULT_WORKTREE_RETENTION_MS;
  const swept = [];
  const kept = [];
  for (const entry of retainedAssignments) {
    const ageMs = nowMs - Date.parse(entry.failedAt);
    if (ageMs > retentionMs) {
      await removeWorktree(projectRoot, entry.assignmentId, options);
      swept.push(entry.assignmentId);
    } else {
      kept.push(entry.assignmentId);
    }
  }
  return { swept, kept };
}
