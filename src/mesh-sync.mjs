// src/mesh-sync.mjs — the git-sync engine (milestone 22 / story 02 / ADR-004): a
// PAYLOAD-AGNOSTIC git transport that MOVES records over git on a tunable cadence,
// plus the background-loop runner (a thin timer over the one-shot transport). The
// mesh's ONLY transport — there is no relay/daemon channel (that is milestone 23).
//
// THE LOAD-BEARING INVARIANT (ADR-004): git stays the single SYSTEM OF RECORD. The
// engine MOVES records — it stages/commits/pulls/pushes FILES under the partition
// root — it NEVER interprets, parses-then-rewrites, or re-authors record CONTENT,
// and it NEVER imports the node-record schema (node-identity.mjs). A record type it
// has never seen (presence in m23, runs in m26, or any opaque .bin) syncs with ZERO
// engine change, byte-for-byte. The transport is payload-agnostic: it moves bytes,
// not JSON-it-can-parse.
//
// ADD-ONLY MERGE SAFETY rests on story 00's partition convention (ADR-002): every
// record file is owned by exactly one node id at exactly one path, so two nodes
// never write the same path — concurrent peer publishes merge add-only (a
// fast-forward / union of disjoint files), never a three-way content merge.
//
// THE TRANSPORT IS A ONE-SHOT UNIT (syncMesh / the mesh:sync command); the BACKGROUND
// LOOP (startSyncLoop) is a thin TIMER over it that holds NO git logic of its own —
// the board-server-is-a-thin-face split (08/ADR-001). The loop is given an injectable
// runSync + ticker so it is unit-testable with no wall-clock wait.
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { meshDir } from "./mesh-store.mjs";

// The documented default cadence (ADR-004) — taken under --autonomous, within A1's
// 10–30s band; reversible by a config edit. A missing/malformed cadenceSeconds falls
// back to this without crashing.
export const DEFAULT_CADENCE_SECONDS = 15;

// ----------------------------------------------------------- git plumbing ----

// Spawn `git` via spawnSync (the import-recovery precedent) — NEVER a shell string
// (the no-shell-string discipline the namespace's arch-tests enforce; a shell would
// word-split paths on Windows). Returns { status, stdout, stderr } with the spawn
// error folded into a non-zero status so callers branch on one shape.
function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.error) {
    return { status: 1, stdout: "", stderr: String(result.error.message ?? result.error) };
  }
  return {
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

// Find the repo root the transport runs git in: walk up from workspace.workDir until
// a .git is found, falling back to workspace.projectRoot. Returns the dir, or null
// when no git repo contains the workspace (the no-repo degraded path).
function repoRootFor(workspace) {
  const start = workspace.workDir ?? workspace.projectRoot;
  let dir = start ? path.resolve(start) : null;
  while (dir) {
    if (existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // Fall back to projectRoot even without a .git — but only when it is a real repo;
  // the caller treats a null/non-repo root as the degraded no-op.
  const projectRoot = workspace.projectRoot ? path.resolve(workspace.projectRoot) : null;
  if (projectRoot && existsSync(path.join(projectRoot, ".git"))) return projectRoot;
  return null;
}

// Whether the repo has any configured remote (a precondition for push/pull). A repo
// with no remote can still commit locally; we just skip the network half.
function hasRemote(repoRoot) {
  const result = git(repoRoot, ["remote"]);
  return result.status === 0 && result.stdout.trim().length > 0;
}

// The repo's current HEAD sha (or null when there is no commit yet / not a repo).
function headSha(repoRoot) {
  const result = git(repoRoot, ["rev-parse", "HEAD"]);
  return result.status === 0 ? result.stdout.trim() : null;
}

// ------------------------------------------------------- the transport ----

// syncMesh(workspace) — the ONE-SHOT transport (the mesh:sync command is thin over
// this). It is PAYLOAD-AGNOSTIC: it stages ONLY paths under the partition root
// (`git add -- <meshDir>`), so a tick never sweeps unrelated working-tree changes,
// and it moves files as bytes — it NEVER reads, parses, or rewrites record content.
//
//   1. Resolve the repo root (the git repo containing the workspace). No repo / no
//      remote ⇒ a clean, structured DEGRADED no-op (HEAD unmoved, tree untouched).
//   2. `git add -- <meshDir>` — stage ONLY the partition root.
//   3. IF there are staged mesh changes → ONE `git commit` (batching: one commit per
//      tick that has staged changes, not one per record), then `git pull` (merge
//      peers' add-only), then `git push`.
//   4. IF there are NO staged mesh changes → a clean no-op: NO empty commit, HEAD
//      unmoved, working tree byte-unchanged (but still `git pull` to read peers'
//      records — reading-back is half the transport, and a fast-forward pull adds
//      peer files without touching this node's own).
//
// Returns the stable sync-result envelope (the --json shape):
//   { committed: bool, pushed: string[], pulled: string[], noop: bool, reason?: string }
// `pushed`/`pulled` are the mesh-relative record paths this tick committed/received.
//
// HONEST FAILURE (ADR-004's load-bearing invariant — git stays the system of record,
// the engine HONESTLY moves records): a NON-zero git pull/push status is NOT swallowed.
// When the network half fails, the transport must NOT report success — it returns a
// FAILURE envelope { synced:false, reason:"push-failed"|"pull-failed", committed,
// pushed:[], pulled, noop:false } so it never claims to have moved records it did not
// move. (`pushed` is left EMPTY on a failed push — the records did not reach the
// remote; the local commit object still exists, but the transport did not move them.)
// The command FACE turns that failure envelope into one { ok:false, error, code } and
// a non-zero exit. The no-git-repo degraded no-op is NOT a failure (nothing to push).
export async function syncMesh(workspace, { } = {}) {
  const root = meshDir(workspace);
  const repoRoot = repoRootFor(workspace);

  // No git repo contains the workspace — a clean, structured degraded no-op (so the
  // command stays exit-0 + parseable even in a non-repo fixture; the realistic
  // no-remote case the bijection fixture exercises).
  if (!repoRoot) {
    return { committed: false, pushed: [], pulled: [], noop: true, reason: "no-git-repo" };
  }

  // Stage ONLY the partition root. `--` ends option parsing so a path that looks like
  // a flag is still treated as a path; the root may not exist yet (no records
  // published) — git add of an absent path is benign, so we tolerate a non-zero here.
  git(repoRoot, ["add", "--", root]);

  // The staged mesh changes = `git diff --cached --name-only -- <root>`: the files
  // staged under the partition root, as repo-relative paths. We never read their
  // CONTENT (payload-agnostic) — only their NAMES, to report what moved + decide
  // whether there is anything to commit.
  const stagedOut = git(repoRoot, ["diff", "--cached", "--name-only", "--", root]).stdout;
  const stagedPaths = stagedOut.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const remotePresent = hasRemote(repoRoot);
  const beforeHead = headSha(repoRoot);
  let committed = false;
  const pushed = [];

  if (stagedPaths.length > 0) {
    // ONE commit for the whole tick (batching). gpgsign off + an identity are the
    // repo's own config (the fixtures set them); we do not configure them here.
    // The commit carries a `-- <root>` PATHSPEC so it commits ONLY paths under the
    // partition root regardless of what else is in the index: startSyncLoop runs on a
    // 15s background timer concurrent with operator git activity, so an unrelated
    // pre-staged change must NEVER be folded into the mesh commit (a pathspec commit
    // commits matching paths only).
    const commit = git(repoRoot, ["commit", "-q", "-m", "mesh: sync node records", "--", root]);
    if (commit.status === 0) {
      committed = true;
      for (const p of stagedPaths) pushed.push(p);
    }
  }

  // The pull half — read back peers' records. Add-only by ADR-002's partitioning, so
  // a fast-forward / disjoint-file merge, never a three-way content merge. We capture
  // the names of files the pull brought in (the peer records pulled). The pull STATUS
  // is read: a non-zero pull is an honest failure (the read-back half did not happen),
  // surfaced — not swallowed.
  const pulled = [];
  if (remotePresent) {
    const beforePull = headSha(repoRoot);
    const pull = git(repoRoot, ["pull", "--no-edit", "-q"]);
    if (pull.status !== 0) {
      // The pull FAILED. We did not read back peers' records — do NOT report success.
      // (`pushed` is emptied: a failed sync must not claim it moved records.)
      return { committed, pushed: [], pulled: [], noop: false, synced: false, reason: "pull-failed" };
    }
    const afterPull = headSha(repoRoot);
    if (beforePull && afterPull && beforePull !== afterPull) {
      // The mesh-relative files the pull changed (names only — never content).
      const diff = git(repoRoot, ["diff", "--name-only", `${beforePull}..${afterPull}`, "--", root]).stdout;
      for (const p of diff.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
        pulled.push(p);
      }
    }

    // Push the local commit (if any). With nothing committed there is nothing new to
    // push — push is harmless but skipped to keep the no-op clean. The push STATUS is
    // READ: a rejected/failed push must NOT return a success-shaped envelope (ADR-004's
    // invariant — the transport never LIES about moving records). On a non-zero push we
    // return a failure envelope with EMPTY pushed (the records did not reach the remote).
    if (committed) {
      const push = git(repoRoot, ["push", "-q"]);
      if (push.status !== 0) {
        return { committed, pushed: [], pulled, noop: false, synced: false, reason: "push-failed" };
      }
    }
  }

  const afterHead = headSha(repoRoot);
  // A no-op tick: nothing committed AND HEAD did not move (no peer records pulled).
  const noop = !committed && beforeHead === afterHead && pulled.length === 0;

  return { committed, pushed, pulled, noop };
}

// ----------------------------------------------------- the cadence reader ----

// Resolve the loop's tick interval (seconds) from a config value. A VALID positive
// INTEGER is used verbatim; ANY malformed value falls back to DEFAULT_CADENCE_SECONDS
// without crashing. Malformed = absent/null/undefined, any non-number type (incl. the
// numeric-looking STRING "30" — no silent string→number coercion — and a boolean),
// 0, negative, and a non-integer float (15.5). NaN/Infinity are caught by the
// finite+integer checks. This is the ONE place the cadence policy lives.
export function resolveCadenceSeconds(value) {
  if (typeof value !== "number") return DEFAULT_CADENCE_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_CADENCE_SECONDS;
  if (!Number.isInteger(value)) return DEFAULT_CADENCE_SECONDS;
  if (value <= 0) return DEFAULT_CADENCE_SECONDS;
  return value;
}

// Read the cadence from a workspace's config (workspace.config.mesh.sync.cadenceSeconds)
// through resolveCadenceSeconds. Tolerant of a missing config/mesh/sync subtree.
export function cadenceFromConfig(workspace) {
  const raw = workspace?.config?.mesh?.sync?.cadenceSeconds;
  return resolveCadenceSeconds(raw);
}

// ------------------------------------------------- the background-loop face ----

// startSyncLoop — the THIN background-loop runner: a timer that invokes the one-shot
// transport once per tick and holds NO git logic of its own (it never spawns git; it
// only calls runSync). The cadence is READ AT START and STABLE for the run — a mid-run
// config edit does not retune a running loop (the interval is captured here, once).
//
//   runSync        — the one-shot transport to invoke each tick (in production, a
//                    closure over invoke("mesh:sync") or syncMesh(workspace)).
//   cadenceSeconds — the already-resolved tick interval (seconds), captured ONCE.
//   ticker         — an INJECTABLE clock: { start(intervalSeconds, onTick) -> handle,
//                    stop(handle) }. Tests pass a manual ticker so no wall-clock waits;
//                    production passes a real setInterval-backed ticker (intervalTicker).
//
// Returns a handle with { intervalSeconds, stop() } so a caller can read the fixed
// interval and tear the loop down.
export function startSyncLoop({ runSync, cadenceSeconds, ticker } = {}) {
  // The interval is read at start and FIXED for the run (cadence read-at-start).
  const intervalSeconds = cadenceSeconds;
  const onTick = () => runSync();
  const handle = ticker.start(intervalSeconds, onTick);
  return {
    intervalSeconds,
    stop() {
      ticker.stop(handle);
    },
  };
}

// A real setInterval-backed ticker (production). Tests inject a manual ticker instead,
// so the loop never wall-clock-waits in CI.
export function intervalTicker() {
  return {
    start(intervalSeconds, onTick) {
      return setInterval(onTick, intervalSeconds * 1000);
    },
    stop(handle) {
      clearInterval(handle);
    },
  };
}
