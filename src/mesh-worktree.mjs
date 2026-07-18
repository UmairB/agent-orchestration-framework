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
//
// MILESTONE 38 / STORY 07 (ADR-015, task 00) — a REAL branch, not always detached.
// `meshWorkerBranchName(itemRef, assignmentId)` below computes the DOCUMENTED DEFAULT
// `aof/mesh/<itemRef>-<assignmentId>` convention (itemRef sanitized to a
// `git check-ref-format`-valid slug); `addWorktree` checks out ON that branch when the
// caller passes `options.branch` (mesh-worker-execution.mjs does, on every dispatch),
// contrasting the STILL-DEFAULT `--detach` form every other caller keeps unchanged.
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

// ------------------------------------------ milestone 38 / story 07 (ADR-015) ----

// MESH_BRANCH_PREFIX — the DOCUMENTED DEFAULT branch namespace every worker-pushed
// branch lives under (ADR-015 decision 1). Fixed, safe, never user-controlled — the
// full branch name always starts with these literal (ASCII-letter-leading) segments,
// so the "cannot begin with a hyphen/slash" git-ref rule is satisfied by construction
// regardless of what the sanitized slug beneath it looks like.
const MESH_BRANCH_PREFIX = "aof/mesh/";

// sanitizeRefSlug(value, fallback) — collapses an arbitrary (possibly ref-HOSTILE)
// string into a slug that is always safe to embed as the LAST path-component of a
// git ref (git-check-ref-format's rules, https://git-scm.com/docs/git-check-ref-format):
// no control chars/space/~/^/:/?/*/[/\, no "@{", no ".." run anywhere, no leading or
// trailing ".", no trailing ".lock". A single whitelist pass (keep only
// [A-Za-z0-9._-], replace everything else — INCLUDING "/" — with "-") both strips
// every forbidden character in one step AND collapses a slash into the "valid
// path-component or collapsed" shape the task allows, never leaving a stray empty
// path segment. Returns `fallback` (itself assumed already-safe) if sanitizing would
// otherwise yield an empty string (e.g. a value that is entirely forbidden chars).
function sanitizeRefSlug(value, fallback) {
  let slug = String(value ?? "").replace(/[^A-Za-z0-9._-]/g, "-");
  // No TWO-OR-MORE consecutive dots anywhere in a ref (forbidden regardless of
  // position) — collapsed to a single "-" in one pass (a single global replace of
  // every 2+-dot run cannot leave a residual ".." behind, since the replaced chars
  // are never dots).
  slug = slug.replace(/\.{2,}/g, "-");
  // A ref component cannot begin with "." nor end with "." or the sequence ".lock".
  slug = slug.replace(/^\.+/, "").replace(/\.lock$/i, "-lock").replace(/\.+$/, "");
  // Cosmetic tidy-up only (not required for validity): collapse runs of "-" the
  // substitutions above may have produced, and drop stray leading/trailing "-".
  slug = slug.replace(/-{2,}/g, "-").replace(/^-+/, "").replace(/-+$/, "");
  return slug.length > 0 ? slug : fallback;
}

// meshWorkerBranchName(itemRef, assignmentId) — the ADR-015 DOCUMENTED DEFAULT branch
// convention `aof/mesh/<itemRef>-<assignmentId>`, itemRef sanitized to a git-ref-safe
// slug, keyed by assignmentId for collision-freedom (mirroring meshWorktreePath's OWN
// assignmentId key immediately above). Both halves are sanitized — a ref-hostile
// assignmentId (task 00's Examples row 12) must sanitize too, never only the itemRef
// half. The exact sanitized text is an implementation mechanic (Three Amigos); the
// INVARIANT every caller relies on is "a `git check-ref-format`-valid ref, prefixed
// `aof/mesh/`, distinct per assignmentId" — task 00's own Scenario Outline is the
// litmus, not a pinned literal mapping (except the one DOCUMENTED example, an
// already-clean itemRef, which passes through byte-identical).
export function meshWorkerBranchName(itemRef, assignmentId) {
  const itemSlug = sanitizeRefSlug(itemRef, "item");
  const assignmentSlug = sanitizeRefSlug(assignmentId, "asg");
  return `${MESH_BRANCH_PREFIX}${itemSlug}-${assignmentSlug}`;
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
// --detach <path> <commitish>` at the ONE seam path BY DEFAULT (detached-at-commit,
// RESEARCH.md §4/§5: no branch-name contention between concurrent assignments) —
// UNLESS `options.branch` names a real branch (milestone 38 / story 07, ADR-015
// decision 1), in which case the worktree is checked out ON that branch (`git
// worktree add -b <branch> <path> <commitish>`), HEAD on it, never detached. The
// caller (mesh-worker-execution.mjs) computes the branch via `meshWorkerBranchName`
// above and passes it here — this function stays agnostic of itemRef/assignmentId
// naming, only "was a branch requested". Every EXISTING detached call site (no
// `options.branch`) is byte-unchanged. Returns the materialized path. A non-zero exit
// is a thrown, coded fault (the caller/orchestrator decides how to surface it — this
// module never swallows a real git failure).
export async function addWorktree(projectRoot, assignmentId, commitish, options = {}) {
  const exec = resolveExec(options);
  const worktreePath = meshWorktreePath(projectRoot, assignmentId);
  const args = options.branch
    ? ["worktree", "add", "-b", options.branch, worktreePath, commitish]
    : ["worktree", "add", "--detach", worktreePath, commitish];
  const result = await exec(args, { cwd: projectRoot });
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
