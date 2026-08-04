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
// `addWorktree` checks out ON a branch when the caller passes `options.branch`
// (mesh-worker-execution.mjs does, on every dispatch), contrasting the STILL-DEFAULT
// `--detach` form every other caller keeps unchanged.
//
// M42 (the brittleness cure, 2026-07-31) — ONE DERIVABLE BRANCH PER ITEM.
// `meshItemBranchName(itemRef)` computes `aof/mesh/<itemRef>` — derivable from the
// ref alone, so NO consumer has to remember a lookup to find where an item's work
// lives. The m38 convention (`aof/mesh/<itemRef>-<assignmentId>`, a distinct branch
// per assignment) is RETIRED: it made the `global_item_branches` side table the only
// memory of where work went, and every consumer that forgot to consult it dispatched
// from the wrong base (the 2026-07-27 measured defect). The side table survives as a
// CACHE that wins when present — it carries the old suffixed names for pre-cure
// items and the pre-rename names for reindexed items (a renumber does not rename the
// origin branch) — and the derivation is the always-available default beneath it.
import path from "node:path";
import { execFile } from "node:child_process";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

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

// meshItemBranchName(itemRef) — THE derivable branch (m42 brittleness cure):
// `aof/mesh/<itemRef>`, itemRef sanitized to a git-ref-safe slug. ONE branch per
// item, derivable from the ref alone — a consumer that never consults the
// `global_item_branches` cache still lands on the item's own line (converging,
// never a divergent per-assignment fork). The sanitizing keeps task 00's hostile-
// input invariant: always a `git check-ref-format`-valid ref, prefixed `aof/mesh/`.
// The m38 two-arg form (`meshWorkerBranchName`, distinct per assignmentId) is
// RETIRED — its collision-freedom was the disease's carrier: distinct branches per
// assignment are exactly what only a side table could remember.
export function meshItemBranchName(itemRef) {
  const itemSlug = sanitizeRefSlug(itemRef, "item");
  return `${MESH_BRANCH_PREFIX}${itemSlug}`;
}

// headCommit(projectRoot, options) — the checkout's current HEAD hash, or null when
// the path is not a usable git repo. The CONTROL side stamps this onto every
// directive it dispatches (the m42 base-commit pin): the assignment is made
// against a KNOWN state of the stream, and the worker builds from exactly that
// commit instead of whatever its own clone's stale HEAD happens to be.
export async function headCommit(projectRoot, options = {}) {
  const exec = resolveExec(options);
  try {
    const result = await exec(["rev-parse", "HEAD"], { cwd: projectRoot });
    const hash = result.stdout.trim();
    return result.status === 0 && /^[0-9a-f]{7,64}$/i.test(hash) ? hash : null;
  } catch (error) {
    // Not-a-repo / no-git degrades to "no pin" (the caller sends no commit and
    // the worker keeps its HEAD fallback) — reported, never silent (m42 item 3).
    reportDegrade("mesh-worktree", error);
    return null;
  }
}

// ensureCommitAvailable(projectRoot, commit, options) — is the dispatched base
// commit present in this checkout, fetching origin once on a miss (the worker's
// clone is never otherwise refreshed, so the control's newest commit routinely
// is not here yet)? False after the fetch means the commit genuinely cannot be
// built from (an unpushed control checkout, a typo'd hash) — the caller fails
// LOUDLY instead of silently building from a stale base, which is the wrong-base
// disease this pin exists to kill.
export async function ensureCommitAvailable(projectRoot, commit, options = {}) {
  const exec = resolveExec(options);
  const present = async () => {
    try {
      return (await exec(["cat-file", "-e", `${commit}^{commit}`], { cwd: projectRoot })).status === 0;
    } catch (error) {
      reportDegrade("mesh-worktree", error);
      return false;
    }
  };
  if (await present()) return true;
  try {
    await exec(["fetch", "origin"], { cwd: projectRoot });
  } catch (error) {
    // An unreachable origin leaves the local answer to decide — the caller's
    // coded refusal is the loud half; the fetch fault itself is still reported.
    reportDegrade("mesh-worktree", error);
  }
  return await present();
}

// localBranchExists(projectRoot, branch, options) — does the checkout already hold
// this branch? The m42 one-branch-per-item cure needs it at dispatch time: a
// re-refine of an item whose derived branch exists must take the REUSE door (`-b`
// would refuse), so the item's line continues instead of forking. Same injected
// exec seam as every other git call here.
export async function localBranchExists(projectRoot, branch, options = {}) {
  const exec = resolveExec(options);
  const result = await exec(["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: projectRoot });
  return result.status === 0;
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
// caller (mesh-worker-execution.mjs) computes the branch via `meshItemBranchName`
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

// reuseWorktreeOnBranch(projectRoot, assignmentId, baseBranch, options) — VERIFICATION
// (continue-on-existing-branch, 2026-07-25). Materialize this assignment's worktree
// checked out ON an EXISTING mesh branch `baseBranch` (the item's active branch, carried
// on the directive), so a continue/verify runs on the refine's own branch and its commits
// accumulate there — never a fresh branch off main. The worktree PATH is still
// assignmentId-keyed (meshWorktreePath — the SECURITY F4 invariant is untouched: the path
// is never composed from the branch/ref text); only the checked-out branch is reused.
//
// A git branch can be checked out in at most ONE worktree, so this first RELEASES any
// worktree still holding `baseBranch` (the refine's own, if it survived) and prunes stale
// metadata, then adds THIS assignment's worktree on the branch:
//   - `git fetch origin <baseBranch>` (best-effort — brings the latest pushed tip; a
//     local-only branch or an unreachable origin is not fatal, the local branch stands);
//   - `git worktree prune` + remove any worktree whose checked-out branch IS baseBranch;
//   - if the branch resolves locally → `git worktree add <path> <baseBranch>`; else (a
//     re-cloned checkout that has it only on origin) → `git worktree add -b <baseBranch>
//     <path> origin/<baseBranch>` (a local branch tracking the pushed one).
// Returns the materialized path. A non-zero `worktree add` is a thrown coded fault (the
// caller decides how to surface it — the never-swallow discipline addWorktree keeps).
export async function reuseWorktreeOnBranch(projectRoot, assignmentId, baseBranch, options = {}) {
  const exec = resolveExec(options);
  const worktreePath = meshWorktreePath(projectRoot, assignmentId);
  // The exec seam may be sync (a test double) or async (production `git` spawn), so every
  // best-effort step is `await exec(...)` inside a try/catch — never `.catch()` on the
  // return (which a sync double does not carry). A best-effort step's fault is swallowed.
  const tryExec = async (args) => {
    try { return await exec(args, { cwd: projectRoot }); } catch { return { status: 1, stdout: "", stderr: "" }; }
  };

  // Best-effort refresh of the branch from origin — a fault here (local-only branch,
  // origin unreachable) never blocks the reuse; the local branch, if present, is used.
  await tryExec(["fetch", "origin", baseBranch]);

  // Release any worktree still holding the branch (the refine's), then prune stale admin
  // metadata so a later add at this path is never blocked (RESEARCH §4's prunable note).
  const refName = `refs/heads/${baseBranch}`;
  let holders = [];
  try {
    holders = (await listWorktrees(projectRoot, { exec })).filter((entry) => entry.branch === refName);
  } catch {
    holders = [];
  }
  for (const holder of holders) {
    await tryExec(["worktree", "remove", "--force", holder.path]);
  }
  await tryExec(["worktree", "prune"]);

  const hasLocal = (await tryExec(["rev-parse", "--verify", "--quiet", refName])).status === 0;
  const args = hasLocal
    ? ["worktree", "add", worktreePath, baseBranch]
    : ["worktree", "add", "-b", baseBranch, worktreePath, `origin/${baseBranch}`];
  const result = await exec(args, { cwd: projectRoot });
  if (result.status !== 0) {
    throw gitError(`git worktree add (reuse branch "${baseBranch}") failed for assignment "${assignmentId}": ${result.stderr || result.stdout}`, "worktree-reuse-failed", { assignmentId, worktreePath, baseBranch, stderr: result.stderr });
  }
  return worktreePath;
}

// advanceBranchToBase(worktreePath, commit, options) — M43 / STORY 05 (ADR-008): GATE-TIME
// PROPAGATION. The m42 base-commit pin already carries a control-side edit to a worker, but
// only through the CREATE door — "the reuse doors ignore it by design: an existing line
// continues from where it is" (mesh-worker-execution.mjs). So a CONTINUING item, which by
// definition takes the reuse door, never saw an edit the operator made at a gate. This
// brings the item branch UP TO the directive's pinned base, in the materialized worktree,
// after `reuseWorktreeOnBranch` and BEFORE the agent starts.
//
// It lives HERE, not at the dispatch call site, for two independent reasons (ADR-010 R5.2):
// this module already owns every git verb and imports 0 mesh modules (so the 3,174-line
// worker-execution god-file gains a CALL SITE, not a block — TECH_DEBT item 10); and the
// dispatch path ALWAYS materializes a fresh worktree, so the dirty-tree refusal is only
// exercisable against a directly-callable function. An untestable safety rule is not one.
//
// THE MECHANISM — fast-forward-if-possible, a REAL MERGE otherwise. SPEC/STATE's word
// "fast-forward" needs an honest reading: the item branch was cut from an earlier control
// HEAD and carries the WORKER's commits while the control's new HEAD carries the gate edit,
// so in git's terms the two are DIVERGED, not "behind". A strict `--ff-only` rule would
// deliver the propagation only in the rare case where the worker committed nothing.
//   - the pinned base is already an ancestor  → NO-OP, `already-current`;
//   - the branch is strictly behind           → `merge --ff-only`, `fast-forwarded`
//                                               (nothing created, nothing lost);
//   - the two lines diverged                  → a REAL merge of the pinned base INTO the
//                                               item branch, `merged` — every worker commit
//                                               preserved by construction, the gate edit
//                                               arrives, and the history stays honest.
//
// FORBIDDEN ABSOLUTELY on this path, with NO `--force` escape hatch (a flag that permits
// history loss will eventually be passed): `rebase`, `push --force`/`--force-with-lease`,
// `reset --hard`, `checkout -B`, `branch -f`, any `update-ref` against `refs/heads/*`. Every
// one of them can discard a worker commit. The absence is guarded by the fitness function
// `acd-gate-propagation-never-discards`, which arms as an outright ban the moment a `merge`
// verb appears in this module.
//
// TWO PRECONDITIONS, each a LOUD CODED REFUSAL that leaves the tree exactly as it was:
//   - `assignment-gate-propagation-dirty-worktree` — never check out or merge over
//     uncommitted work; the operator's unstaged bytes are the one thing git cannot recover.
//   - `assignment-gate-propagation-conflict` — a conflicting merge is `git merge --abort`ed
//     and refused. Handing an agent a half-merged tree is strictly WORSE than not
//     propagating: it would begin a phase on a state no human authored.
// Both are RETURNED (never thrown) as `{ outcome: "refused", code }`, so the caller settles
// the assignment `failed` with the code exactly as `assignment-base-commit-unavailable`
// already does. A git fault that is NOT one of those two is a thrown coded error — this
// module's never-swallow-a-real-git-failure discipline.
//
// ORDERING NOTE (a decision, not an accident): the already-an-ancestor no-op is decided
// BEFORE the dirty-tree check, because that case runs no git verb at all — refusing a
// dispatch that was never going to touch the tree would turn today's working continue into
// a coded failure for no safety gain. Every path that ACTS (`--ff-only` and the merge alike,
// both of which update tracked files) is behind the clean-tree guard.
//
// Returns `{ outcome, code, branch, base, tip }` — `base` is the resolved pinned commit and
// `tip` the branch tip the agent will actually start from (unchanged on both refusals), the
// pair the caller reports on the `worker-worktree-base` log channel so "which base did this
// phase run on" stays one `aof mesh logs --node` read.
export async function advanceBranchToBase(worktreePath, commit, options = {}) {
  const exec = resolveExec(options);
  const run = (args) => exec(args, { cwd: worktreePath });
  const text = (result) => String(result?.stdout ?? "").trim();
  // Best-effort only — a step whose own failure must never mask the outcome it is
  // classifying (the abort below), mirroring reuseWorktreeOnBranch's tryExec.
  const tryRun = async (args) => {
    try { return await run(args); } catch { return { status: 1, stdout: "", stderr: "" }; }
  };

  // HEAD is on the item branch at the reuse door (ADR-015: never detached) — read it for
  // the report rather than re-deriving it, so the line names the branch git actually holds.
  const branch = text(await tryRun(["symbolic-ref", "--quiet", "--short", "HEAD"])) || null;

  const resolved = await run(["rev-parse", "--verify", "--quiet", `${commit}^{commit}`]);
  const base = text(resolved);
  if (resolved.status !== 0 || base.length === 0) {
    // The caller has already run ensureCommitAvailable, so a miss here is a genuine fault
    // (a mid-dispatch prune, a corrupt object db) and never the routine unpushed-control
    // case that `assignment-base-commit-unavailable` names.
    throw gitError(`the pinned base commit "${commit}" does not resolve in the worktree at ${worktreePath}`, "gate-propagation-base-unresolved", { worktreePath, commit, branch });
  }
  const tipBefore = text(await run(["rev-parse", "HEAD"]));
  const settle = (outcome, code, tip) => ({ outcome, code, branch, base, tip });

  // (1) The pinned base is already on the branch — nothing to do, and nothing touched.
  if ((await run(["merge-base", "--is-ancestor", base, "HEAD"])).status === 0) {
    return settle("already-current", null, tipBefore);
  }

  // (2) The clean-tree precondition, checked BEFORE anything is touched. `--ff-only` is as
  // capable of writing over an uncommitted change as a merge is, so the guard covers both.
  if (text(await run(["status", "--porcelain"])).length > 0) {
    return settle("refused", "assignment-gate-propagation-dirty-worktree", tipBefore);
  }

  // (3) Strictly behind — take the cheap door: nothing is created, nothing is lost.
  if ((await run(["merge-base", "--is-ancestor", "HEAD", base])).status === 0) {
    const forward = await run(["merge", "--ff-only", base]);
    if (forward.status !== 0) {
      throw gitError(`git merge --ff-only ${base} failed in worktree "${worktreePath}": ${forward.stderr || forward.stdout}`, "gate-propagation-failed", { worktreePath, commit: base, branch });
    }
    return settle("fast-forwarded", null, text(await run(["rev-parse", "HEAD"])));
  }

  // (4) Diverged — the COMMON case: a real merge of the pinned base INTO the item branch.
  // Under a mesh identity (`-c user.*`, the commitWorktreeChanges idiom) so a worker whose
  // git identity is unset can still create the merge commit.
  const name = `aof-mesh${typeof options.node === "string" && options.node.length > 0 ? ` (${options.node})` : ""}`;
  const message = typeof options.message === "string" && options.message.length > 0
    ? options.message
    : `aof(mesh): advance ${branch ?? "the item branch"} to the dispatched base ${base}\n\nGate-time propagation (m43 ADR-008): the control's pinned base is merged INTO the item branch so an edit made at a gate reaches this phase. Every worker commit is preserved — this path never rebases, force-updates or resets.`;
  const merged = await run(["-c", `user.name=${name}`, "-c", "user.email=aof-mesh@users.noreply.github.com", "merge", "--no-ff", "--no-edit", "-m", message, base]);
  if (merged.status !== 0) {
    // Classify BEFORE aborting — an unmerged index (or a MERGE_HEAD) is what makes this a
    // conflict rather than some other git fault.
    const conflicted =
      (await tryRun(["rev-parse", "-q", "--verify", "MERGE_HEAD"])).status === 0 ||
      /^(U.|.U|AA|DD)/m.test(String((await tryRun(["status", "--porcelain"]))?.stdout ?? ""));
    await tryRun(["merge", "--abort"]);
    if (!conflicted) {
      throw gitError(`git merge ${base} failed in worktree "${worktreePath}": ${merged.stderr || merged.stdout}`, "gate-propagation-failed", { worktreePath, commit: base, branch });
    }
    return settle("refused", "assignment-gate-propagation-conflict", text(await run(["rev-parse", "HEAD"])));
  }
  return settle("merged", null, text(await run(["rev-parse", "HEAD"])));
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
