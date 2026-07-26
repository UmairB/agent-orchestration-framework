// src/mesh-worker-execution.mjs — the worker's ACCEPTED-DIRECTIVE handler (milestone
// 35 / story 02, ADR-004; tasks 00-03). This is the handler `client.onDirective(...)`
// registers (worker-stream-client.mjs, story 01): given a PARSED `{ kind:"directive",
// to, assignmentId, itemRef, workspaceId, at }` frame, it
//   (0) on a repo MISS, clones the repo into a SCOPED checkout and registers the
//       workspace so the guard then passes — a PREFIX, not a rewrite (milestone 38 /
//       story 01, ADR-005 — tasks 00-03 below);
//   (1) re-checks the worker actually HAS the repo for workspaceId — BEFORE any
//       worktree (task 01, SECURITY F3 acd-unpublished-repo-directive-refused);
//   (2) materializes a dedicated `git worktree add` under the ONE seam
//       `meshWorktreePath` (task 00, fitness #8 / SEC F4 acd-worktree-path-scoped);
//   (3) mints a node-partitioned run through the EXISTING run-store, drives the ref
//       to a terminal state via a BOUNDED headless runtime (an INJECTED spawn seam),
//       and completes the run (task 02, fitness #12 acd-assignment-run-store-mesh-blind);
//   (4) cleans up the worktree on `done`, retains it on `failed` (task 03, ADR-004).
// Streams `accepted -> running -> done|failed` up the channel via the SAME
// `sendAssignmentStatus` the worker-stream-client already exposes (ADR-002).
//
// MILESTONE 38 / STORY 01 (worker-repo-checkout, ADR-005/006) — clone-on-miss. On
// `!hasRepo` the handler no longer refuses outright: it resolves the clone SOURCE from
// `config.mesh.repo.cloneUrl` (raw optional-chain, task 00), clones into the ONE scoped
// `meshCheckoutPath(workspaceId)` seam under `<meshRoot>/checkouts/<workspaceId>/`
// (task 01), then writes BOTH repo-availability facts (`writeRepoPublishedMarker` +
// the narrow `global_node_workspaces` upsert) and RE-CHECKS `workerHasRepo` (task 02)
// before falling through to the UNCHANGED addWorktree->run flow below (ADR-006 — no
// second worktree call site). The credential (GIT_ASKPASS token, RESEARCH.md §1's
// recommended default) rides a per-invocation `env` on the CLONE exec ONLY — never
// `process.env`, so the later spawnRuntime agent child (full ambient-env inheritance)
// can never read it (task 03, SECURITY T1/T2/T3, F1/F2).
//
// MEMORY NEAR-MISS honored (recalled at build start via `aof work memory recall`; no
// milestone-35-specific near-miss existed in memory, so the general R2(m20) lesson —
// "a frozen+classified state-carrying key must name its producer" — is the one
// carried forward here): already closed structurally by assignment-record.mjs's
// ASSIGNMENT_STATE_PRODUCERS; this module never invents a second assignment-state
// authority — the worker is the sole SOURCE of accepted/running/done/failed
// (ADR-001), streamed purely over sendAssignmentStatus (ADR-002); control's write-
// through into the store is Story 01's ingest path, not this module's job.
//
// THE INJECTED RUNTIME-SPAWN SEAM (mirroring the transport/ticker injection idiom,
// STORY.md build notes) — `spawnRuntime(brief) => Promise<{ outcome: "done"|"failed",
// failureReason? }>`. THE CRITICAL INVARIANT (STORY.md "Windows child-cwd-at-cleanup —
// handled by SEQUENCING, not detection"): spawnRuntime's returned promise resolves
// ONLY after the child process has FULLY EXITED — never merely "stdout drained but the
// child is still alive". This is what makes task 03's cleanup-after-terminal safe on
// Windows: cleanup (git worktree remove) never races a still-running child whose cwd
// points inside the worktree, because terminal status (-> cleanup) is only ever
// observed strictly after spawnRuntime's promise settles, which the contract pins to
// full exit. Production default: DRIVER-PLUGGABLE, defaulting to `claude -p
// --output-format json` (RESEARCH.md §2/§3 measured; `stop_reason`/`terminal_reason`
// map to done/failed) spawned with cwd = the worktree path; `codex exec --json -o
// <file> --sandbox workspace-write --ask-for-approval never` is the documented
// fallback. The brief carries { itemRef, worktreeCwd, task } for ONE non-interactive
// turn — a BOUNDED proxy for the build half (STORY.md's documented-default scope
// call), NOT aof:continue's multi-agent depth. `@executable` coverage ALWAYS injects a
// scripted spawnRuntime (no real binary) — the real driver is exercised only by the
// task-05 @manual soak.
//
// MILESTONE 38 / STORY 07 (durable-worker-pushback, ADR-015, tasks 00-02) — the
// worker's output SURVIVES: a REAL branch (`meshWorkerBranchName`, mesh-worktree.mjs),
// not a detached HEAD (task 00); on `done`, `git push origin <branch>` runs BEFORE the
// worktree force-remove, reusing the SAME `buildAskpassShim` one-shot the clone uses
// (ADR-009's PULL, pointed at a push instead) — the worktree is retained, never
// force-removed, until the push succeeds; a FAILED push surfaces a loud coded
// `push-failed` and RETAINS the worktree for inspection/retry, never a silent clean
// `done` over unpushed commits (task 01, `pushWorktreeBranch` below). The WRITE
// credential is resolved through an INJECTED `requestWriteCredential(...)` seam
// (mirroring `requestCloneCredential`'s per-invocation-only discipline, SECURITY T4 —
// no static credential option exists here either); a caller supplying none makes no
// resolution attempt (an unauthenticated push, exactly the clone path's own
// no-resolver default). The MINT itself — a SEPARATE, single-repo, `contents:write`
// (+`pull_requests:write` only for auto-PR) token, NEVER a widened clone credential —
// is `createGithubAppPushMintProvider` (mesh-clone-credential-provider.mjs, task 02,
// SECURITY T15/T9). Production wiring of `requestWriteCredential` onto a real
// control<->worker frame-pair IS built (mirroring ADR-009's clone-credential-request):
// mesh-launcher.mjs supplies `requestWriteCredential` as a LITERAL production key
// (F12-guarded by acd-clone-credential-pull-not-pushed) via worker-stream-client.mjs's
// own DISTINCT `write-credential-request`/`write-credential` frame pair, which the
// control node answers through `applyWriteCredentialRequestFrame` under the SAME
// holder gates as the clone pull (T6 connection-bound node, F15 frame-workspace match,
// F16 active-assignment). What remains for task 03's `@manual` soak is the real
// two-machine GitHub push over that wire, not the wiring itself.
//
// MILESTONE 38 / STORY 05 (terminal-driven-worker-execution, ADR-013, tasks 00-03) —
// `claude -p` is GONE from the worker driver path: the worker now runs interactive
// `claude` in a node-pty PTY resolved through the EXISTING `terminal-providers` seam
// (task 00), driven by the assignment directive's WHOLE command string typed into
// that ONE long-lived session's PTY stdin as a single `pty.write` (task 01, never a
// `-p` prompt argv). An explicit `NEEDS_INPUT_SENTINEL` observed in the session's own
// PTY output yields a THIRD outcome, `needs-input` — distinct from, and never
// re-mapped to, `done` — which RETAINS its worktree exactly as `failed` already does
// (task 02, closing the RESEARCH §4.3 gap where a question-ended turn read as
// `done`). The session's `session_id` (discarded before this story) is threaded onto
// every `sendAssignmentStatus` call so a human can `claude --resume` it (task 03); a
// run that never resolves one degrades to null, never a crash.
//
// ADR-013 AMENDMENT (F-38.05, 2026-07-19) — BOTH of task 02/03's original mechanisms
// shipped their CONSUMER half with NO PRODUCER (a fitness function armed against the
// as-built, producerless shape had locked that gap in green). Corrected here:
// `session_id` is now resolved by a TRANSCRIPT-DIR WATCH (`defaultWatchTranscriptSessionId`
// below, reusing `claudeProjectsDir` from `work-observe.mjs`) — a real `claude`
// process, given `cwd = worktreeCwd`, writes its OWN transcript to
// `<claudeProjectsDir>/<session_id>.jsonl` with zero model cooperation required; the
// FIRST NEW `*.jsonl` basename to appear after spawn names the session, never a
// phantom PTY marker nothing emitted. `NEEDS_INPUT` now has a real producer too: a
// worker-scoped `--append-system-prompt NEEDS_INPUT_INSTRUCTION` on the interactive
// launch (`resolveInteractiveDriverLaunch` below) — never a human-session `/ws/terminal`
// concern, since that path never calls this launch resolver. See
// `driveInteractiveClaudeSession`/`resolveInteractiveDriverLaunch` below — armed by
// fitness `acd-worker-driver-no-headless-print`.
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile, readFile, rename, readdir, stat } from "node:fs/promises";
import os from "node:os";
import { randomUUID } from "node:crypto";
import { findWork, loadWorkspace } from "./work.mjs";
// milestone 38 / story 05 (ADR-013 AMENDMENT, F-38.05) — `claudeProjectsDir` is the
// EXISTING slug/projects-dir seam (work-observe.mjs, milestone observability): reused
// VERBATIM (never re-implemented) so the session_id transcript-dir watch below
// resolves EXACTLY the directory a real interactive `claude` session (cwd =
// worktreeCwd) writes its own transcript into.
import { claudeProjectsDir } from "./work-observe.mjs";
import { startRun, completeRun } from "./run-store.mjs";
import { addWorktree, reuseWorktreeOnBranch, removeWorktree, meshWorktreesRoot, meshWorktreePath, meshWorkerBranchName } from "./mesh-worktree.mjs";
import { globalMeshPaths } from "./workspace.mjs";
import { openGlobalWorkProjectionStore } from "./global-work-store.mjs";
import { resolveWorkspaceId } from "./workspace-identity.mjs";
import { writeRepoPublishedMarker } from "./commands/mesh-repo.mjs";
// m42 wave (b) / item 4 — the clone-time identity pin writes through the ONE atomic
// write seam (temp+rename, failure reclaims its temp).
import { writeText } from "./fs.mjs";
import { resolveWorkspaceCloneUrl as defaultResolveWorkspaceCloneUrl } from "./mesh-presence.mjs";
// milestone 38 / story 05 (ADR-013) — the interactive-`claude`-PTY driver reuses the
// EXISTING terminal infrastructure verbatim: `resolveProvider` is the SAME seam
// `/ws/terminal` resolves its own launch through (terminal-providers.mjs), and
// `createTerminalSpawn(loadNodePty)` is the SAME node-pty factory `terminal-ws.mjs`
// spawns through (its own SEA-vs-dev loader branch) — never a second, hand-rolled
// spawn path or a re-implemented provider table.
import { resolveProvider } from "./terminal-providers.mjs";
import { createTerminalSpawn, loadNodePty } from "./terminal-ws.mjs";
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

// ── the LIVE worktree registry (VERIFICATION, 2026-07-25) ────────────────────
//
// A worker streams its LAUNCH workspace's work-state up the fabric on a ticker, but an
// assignment's real work happens in a per-assignment WORKTREE — so everything an agent
// produces was invisible to the control node until the run finished, committed and pushed,
// and the board read a scaffolded milestone as "0 stories" over a fully broken-down one.
// Reading the pushed BRANCH is not an answer: it cannot show work in flight, and it makes
// committing a precondition for visibility.
//
// This registry is how the worker streams its OWN worktree instead: the driver records the
// worktree the moment it materializes one and clears it the moment the run settles, and the
// launcher's stream ticker reads the registry each tick and streams those items up the
// connection it already holds. Module-level because the driver and the ticker are separate
// call paths in the SAME worker process; entries are ephemeral (never persisted) and are
// removed on every settle path, so a finished run stops streaming immediately.
const activeWorktrees = new Map();

export function registerActiveWorktree(assignmentId, entry) {
  if (typeof assignmentId !== "string" || assignmentId.length === 0) return;
  activeWorktrees.set(assignmentId, { assignmentId, ...entry });
}

export function clearActiveWorktree(assignmentId) {
  activeWorktrees.delete(assignmentId);
}

// listActiveWorktrees() — the launcher's read: every worktree currently being worked in.
export function listActiveWorktrees() {
  return [...activeWorktrees.values()];
}

// listStrandedWorktreeAssignments(options) — m42 wave (b) / TECH_DEBT item 7 leg 2:
// the DURABLE startup view the in-memory registry above cannot give. Worktree
// DIRECTORIES persist across a daemon restart at
// <checkoutsRoot>/<workspaceId>/.aof/mesh/worktrees/<assignmentId>/ — and at startup
// every one of them belongs to a run whose PTY child no longer exists (this process
// just started). The launcher reports each as failed/daemon-restarted; the control's
// terminal-guard (a terminal row never regresses) makes the broadcast safe for
// retained-after-failure and already-withdrawn worktrees. Absent roots scan to [].
export async function listStrandedWorktreeAssignments(options = {}) {
  const out = [];
  const root = meshCheckoutsRoot(options.globalWorkStoreOptions ?? {});
  let workspaces = [];
  try {
    workspaces = await readdir(root, { withFileTypes: true });
  } catch {
    return out; // no checkouts yet — a fresh worker has nothing stranded
  }
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    const worktreesDir = path.join(root, workspace.name, ".aof", "mesh", "worktrees");
    let entries = [];
    try {
      entries = await readdir(worktreesDir, { withFileTypes: true });
    } catch {
      continue; // this checkout has no worktrees dir — nothing stranded here
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      out.push({
        assignmentId: entry.name,
        workspaceId: workspace.name,
        worktreePath: path.join(worktreesDir, entry.name),
      });
    }
  }
  return out;
}

// resolveWorkspaceWorkDir(projectRoot, workDir, worktreePath) — the SAME work.mjs
// resolution the primary checkout uses, re-rooted at the worktree: workDir is always
// `projectRoot` joined with the configured (default "./wiki/work") relative segment,
// so re-joining that SAME relative segment onto the worktree path resolves the item
// inside the worktree's OWN checkout (never the worker's primary working copy).
function worktreeWorkDir(projectRoot, workDir, worktreePath) {
  const relative = path.relative(projectRoot, workDir);
  return path.join(worktreePath, relative);
}

// resolveRefInWorktree(projectRoot, workDir, worktreePath, itemRef) — the T3b / F4b
// ref-scoping seam: resolution is ENUMERATE-then-filter (findWork, work.mjs:39/395),
// exactly as the primary checkout resolves — NEVER a `path.join(worktreePath,
// itemRef)` built from directive text. A traversal ref (`../../etc`, an absolute
// path, a `..`-laden ref) matches nothing under ITEM_RE and yields no item; no path is
// ever constructed from it. Returns the resolved item row (with `.dir` INSIDE the
// worktree) or null.
export async function resolveRefInWorktree(projectRoot, workDir, worktreePath, itemRef) {
  const rootedWorkDir = worktreeWorkDir(projectRoot, workDir, worktreePath);
  const matches = await findWork(rootedWorkDir, itemRef);
  return matches.find((row) => row.ref === itemRef) ?? matches[0] ?? null;
}

// -------------------------------------------------- the repo-availability guard ----

// localMeshRepoPublished(ws, workspaceId) — the LOCAL half of the join: the
// `mesh.repo.published` marker (`commands/mesh-repo.mjs:33-50` writes it;
// `ws.config.mesh.repo.published` is the SAME on-disk marker `loadWorkspace` already
// hydrates), AND that this marker was written for THIS workspaceId.
function localMeshRepoPublished(ws, workspaceId) {
  const repo = ws?.config?.mesh?.repo;
  if (!isPlainObject(repo)) return false;
  if (repo.published !== true) return false;
  // The marker records the workspaceId it was published for — a published marker for
  // a DIFFERENT workspaceId is not "this workspace's repo is available".
  if (typeof repo.workspaceId === "string" && repo.workspaceId.length > 0) {
    return repo.workspaceId === workspaceId;
  }
  // A pre-workspaceId marker (published:true, no workspaceId key) is tolerated as a
  // proceed — absence-is-benign for an additive key, never a stricter regression.
  return true;
}

// localNodeWorkspaceMembership(nodeId, workspaceId, options) — the WORKER's OWN local
// `global_node_workspaces` fact: the worker's machine-wide global store (the SAME
// `AOF_GLOBAL_HOME` its own launcher already publishes into on every local mutation,
// `global-work-publisher.mjs`'s `publishGlobalRegistryDescriptorsToStore`) is queried
// LOCALLY — no network call, no control-node roundtrip. `options.openStore` is the
// INJECTED store opener (default `openGlobalWorkProjectionStore`); a missing/
// unreachable local store degrades to `false` (never a thrown fault out of the guard).
async function localNodeWorkspaceMembership(nodeId, workspaceId, options = {}) {
  const openStore = options.openStore ?? openGlobalWorkProjectionStore;
  const storeOptions = options.globalWorkStoreOptions ?? {};
  let store;
  try {
    store = await openStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
  } catch {
    return false;
  }
  try {
    const row = store.db.prepare("SELECT 1 FROM global_node_workspaces WHERE node_id = ? AND workspace_id = ?").get(nodeId, workspaceId);
    return Boolean(row);
  } catch {
    return false;
  } finally {
    store.close?.();
  }
}

// workerHasRepo(ws, workspaceId, nodeId, options) — task 01's worker-side guard
// (defensive re-check; the control-side gate is Story 00's `resolveTarget`). THE JOIN
// (STORY.md build notes: "use the LOCAL marker joined with the node-workspace
// mapping") — availability is TRUE only when BOTH facts hold: the local
// `mesh.repo.published` marker for this workspaceId, AND this node's OWN local
// `global_node_workspaces` membership row for (nodeId, workspaceId) — either fact
// missing is a coded miss (the decision-table join, task 01 Examples). Unlike the
// control-side gate (which has no filesystem access to a remote worker's config and
// must proxy via `global_node_workspaces` + `workspaces.last_published_at`, STATE.md
// Feedback), the WORKER-side check reads its OWN local marker AND its OWN local
// registry table directly — both genuine per-node facts, not a workspace-level proxy.
export async function workerHasRepo(ws, workspaceId, nodeId, options = {}) {
  if (!localMeshRepoPublished(ws, workspaceId)) return false;
  return localNodeWorkspaceMembership(nodeId, workspaceId, options);
}

// ============================================================================
// MILESTONE 38 / STORY 01 — worker-repo-checkout (ADR-005/006, tasks 00-03)
// ============================================================================

// -------------------------------------------------- task 00: clone SOURCE ----

// isWellFormedCloneUrl(value) — a git-URL-SHAPE validator (NOT `new URL()` alone —
// it rejects scp-style `git@host:path`, ADR-005/task 00). Accepts `scheme://host/...`
// forms (https, ssh, git, …) with a non-empty host (and, for `file:`, a non-empty
// path beyond the leading slash — `file:///` has none), and the scp-style
// `user@host:path` shorthand. Rejects "", whitespace-only, non-strings, and anything
// that parses to no host/no path.
export function isWellFormedCloneUrl(value) {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return false;
    }
    if (parsed.protocol === "file:") {
      // file:///<nothing> — no real path beyond the root slash.
      return parsed.pathname.length > 1;
    }
    return parsed.hostname.length > 0;
  }
  // scp-style shorthand: user@host:path (git@git.example.com:acme/secret.git).
  if (/^[\w.-]+@[\w.-]+:.+/.test(trimmed)) return true;
  return false;
}

// resolveCloneUrl(ws) — THE RAW OPTIONAL-CHAIN read (ADR-005, the m22 story-01
// lesson): reads config.mesh.repo.cloneUrl directly, NEVER round-tripping through the
// config-editor whitelist (which would drop an unknown sibling mesh key on rewrite).
// Returns the well-formed URL string, or null for absent/blank/malformed/wrong-type —
// the caller treats null as "stay the loud coded assignment-repo-unavailable failed".
export function resolveCloneUrl(ws) {
  const cloneUrl = ws?.config?.mesh?.repo?.cloneUrl;
  return isWellFormedCloneUrl(cloneUrl) ? cloneUrl.trim() : null;
}

// -------------------------------------------- milestone 38 / story 02 (ADR-010) ----

// parseRepoFromCloneUrl(cloneUrl, config) — LAYERS ON `isWellFormedCloneUrl`'s OWN
// acceptance surface (RESEARCH §3.5's measured parser): extracts `{ host, owner,
// repo, apiBaseUrl }` from a well-formed clone URL — https/ssh scheme-form AND
// scp-style `git@host:owner/repo(.git)`. `.git` suffix / trailing slash / query /
// hash are stripped from the repo segment (never from `owner`, never a case-fold on
// the path — only the HOST is lower-cased, matching `new URL()`'s own normalization
// and RESEARCH's measured table). A `< 2`-path-segment URL (or anything
// `isWellFormedCloneUrl` itself rejects) parses to `null` — the caller THROWS, never
// guesses.
//
// The host -> API-base RULE (RESEARCH §3.5's "the REAL gap", not a parsing edge
// case): `github.com` -> `https://api.github.com`; anything else -> the GHES
// convention `https://<host>/api/v3` (using `url.host`, INCLUDING the port, per the
// measured edge case — a GHES instance's API can sit behind a non-default port),
// UNLESS `config.mesh.repo.credential.githubApp.apiBaseUrl` (raw optional-chain) is
// configured, which wins outright (an operator's explicit override for an API host/
// port that diverges from the git-clone host).
export function parseRepoFromCloneUrl(cloneUrl, config = null) {
  if (!isWellFormedCloneUrl(cloneUrl)) return null;
  const trimmed = cloneUrl.trim();

  let hostname; // never includes a port — used ONLY for the github.com check
  let hostForApiBase; // includes a port when present — used to build a GHES API base
  let pathSegments;

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
    let parsed;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    hostname = parsed.hostname.toLowerCase();
    // Craft R1 (defensive) — the URL's port is preserved into `hostForApiBase` ONLY
    // for an http(s)-scheme clone URL (the legitimate GHES-behind-a-non-default-port
    // case, e.g. `https://ghe.example.com:8443/...`). For any OTHER scheme (ssh, git,
    // ...) the port is the SSH/clone port, never the forge's REST API port — the mint
    // always talks HTTPS, so that port must NEVER leak into apiBaseUrl (a
    // `ssh://host:22/...` clone URL must resolve to `https://host/api/v3`, not
    // `https://host:22/api/v3`).
    hostForApiBase = parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.host.toLowerCase() : hostname;
    pathSegments = parsed.pathname.split("/").filter(Boolean);
  } else {
    // scp-style shorthand: user@host:path (git@git.example.com:acme/secret.git).
    const match = /^[\w.-]+@([\w.-]+):(.+)$/.exec(trimmed);
    if (!match) return null;
    hostname = match[1].toLowerCase();
    hostForApiBase = hostname;
    pathSegments = match[2].split("?")[0].split("#")[0].split("/").filter(Boolean);
  }

  if (pathSegments.length < 2) return null;
  const owner = pathSegments[0];
  const repo = pathSegments[1].replace(/\.git$/i, "");
  if (owner.length === 0 || repo.length === 0) return null;

  const configuredApiBase = config?.mesh?.repo?.credential?.githubApp?.apiBaseUrl;
  let apiBaseUrl;
  if (typeof configuredApiBase === "string" && configuredApiBase.length > 0) {
    apiBaseUrl = configuredApiBase;
  } else if (hostname === "github.com") {
    apiBaseUrl = "https://api.github.com";
  } else {
    apiBaseUrl = `https://${hostForApiBase}/api/v3`;
  }

  return { host: hostname, owner, repo, apiBaseUrl };
}

// ------------------------------------------------ task 01: clone TARGET seam ----

// meshCheckoutsRoot(options) / meshCheckoutPath(workspaceId, options) — THE ONE SEAM
// (fitness F1 acd-worker-clone-target-scoped) a clone target is EVER built from.
// Mirrors mesh-worktree.mjs's meshWorktreesRoot/meshWorktreePath shape almost
// verbatim, but rooted at the GLOBAL mesh home (globalMeshPaths(...).meshRoot,
// honoring AOF_GLOBAL_HOME) rather than the repo's own .aof/ — a checkout is a
// machine-wide fact (like identity/presence), never per-repo. Composed from
// `workspaceId` ONLY (a store-canonical id, never directive/ref text) — a traversal
// id constructs no escaping path (isUnderMeshCheckoutsRoot below is the same
// prefix-child check mesh-worktree.mjs keeps for its own root).
export function meshCheckoutsRoot(options = {}) {
  return path.join(globalMeshPaths(options).meshRoot, "checkouts");
}

export function meshCheckoutPath(workspaceId, options = {}) {
  return path.join(meshCheckoutsRoot(options), String(workspaceId));
}

export function isUnderMeshCheckoutsRoot(candidatePath, options = {}) {
  const root = path.resolve(meshCheckoutsRoot(options)) + path.sep;
  const normalized = path.resolve(candidatePath) + path.sep;
  return normalized.startsWith(root);
}

// ----------------------------------------- task 03: credential env + askpass ----

// resolveCloneExec(options) — the INJECTED clone-exec seam (mirroring mesh-worktree.
// mjs's options.exec idiom): (args, { cwd, env? }) => Promise<{ stdout, stderr,
// status }>. Argv-form via execFile, NEVER a shell string. Default is a real `git`
// spawn; @executable tests inject a FAKE that records argv + env + returns a scripted
// status — no real forge, no real credential, no network.
function defaultCloneExec(args, { cwd, env, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
    });
  });
}

function resolveCloneExec(options) {
  return typeof options?.cloneExec === "function" ? options.cloneExec : defaultCloneExec;
}

// buildAskpassShim(scriptsRoot, token) — the GIT_ASKPASS one-shot plumbing (RESEARCH
// §1.1/A4 measured: GIT_ASKPASS leaves NO trace in .git/config, cleanest of the four
// surveyed mechanisms). GIT_ASKPASS names ONE executable, not "command + args" — on
// Windows a `node <script>` pointer does not work directly, so this writes a
// generated one-shot `.cmd` shim (POSIX: a shell script) that internally execs a tiny
// node helper. The token itself is embedded ONLY in this one-shot, scoped-directory
// file — never process.env, never argv of the clone itself — and the whole shim
// directory is removed in a `finally` by the caller. NEVER os.tmpdir() (F1) — the
// shim lives under the SAME scoped checkouts root, in a dedicated `.askpass/` sibling
// never itself treated as a checkout target.
//
// MILESTONE 38 / STORY 02 (ADR-010 decision 4) — PROMPT-AWARE. RESEARCH §3.4 measured
// that git passes the ASKPASS program a distinguishing prompt string as argv (`
// "Username for '...'"` vs `"Password for '...'"`) — the shim now FORWARDS that argv
// (`%*` / `"$@"`) to the helper, which answers the literal, public, non-secret
// constant `x-access-token` on a Username prompt, and the real token on every OTHER
// prompt (Password, or none — the legacy no-argv invocation some hermetic tests still
// use, which stays the token-emitting default). This is GitHub's DOCUMENTED App
// installation-token form (`x-access-token:<TOKEN>@`), not the previously-shipped
// same-value-for-both-prompts shim that rested on undocumented, App-token-unconfirmed
// leniency. The token is STILL never the username, still never process.env/argv of
// the clone itself, still removed with the whole one-shot directory in the caller's
// `finally` (story-01 F2 stays green — the token's own handling is unchanged on every
// axis F2 pins; only WHICH prompt gets the token, vs the public `x-access-token`
// constant, is new).
const ASKPASS_USERNAME_CONSTANT = "x-access-token";

export async function buildAskpassShim(scriptsRoot, token) {
  const dir = path.join(scriptsRoot, ".askpass", randomUUID());
  await mkdir(dir, { recursive: true });
  const isWindows = process.platform === "win32";
  const helperPath = path.join(dir, "askpass.mjs");
  const shimPath = path.join(dir, isWindows ? "askpass.cmd" : "askpass.sh");
  // The token is written into a file that lives ONLY inside this one-shot, scoped
  // directory — read once by the helper, then the whole directory is removed.
  const tokenPath = path.join(dir, "token");
  await writeFile(
    helperPath,
    [
      "import { readFileSync } from 'node:fs';",
      "const tokenPath = process.argv[2];",
      "const prompt = process.argv.slice(3).join(' ');",
      `process.stdout.write(/^Username/i.test(prompt) ? ${JSON.stringify(ASKPASS_USERNAME_CONSTANT)} : readFileSync(tokenPath, 'utf8'));`,
      "",
    ].join("\n"),
    "utf8",
  );
  await writeFile(tokenPath, token, "utf8");
  if (isWindows) {
    await writeFile(shimPath, `@echo off\r\nnode "${helperPath}" "${tokenPath}" %*\r\n`, "utf8");
  } else {
    await writeFile(shimPath, `#!/bin/sh\nexec node "${helperPath}" "${tokenPath}" "$@"\n`, "utf8");
    await import("node:fs/promises").then((fsp) => fsp.chmod(shimPath, 0o700));
  }
  return { shimPath, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

// redactCredentialFromText(text, credential) — the redaction discipline (SECURITY T3
// / acd-global-node-descriptors-redact-secrets) applied to a clone failure's surfaced
// text: any occurrence of the literal credential value is replaced, never forwarded
// raw into a log/error/status frame.
function redactCredentialFromText(text, credential) {
  if (typeof text !== "string" || typeof credential !== "string" || credential.length === 0) return text;
  return text.split(credential).join("[redacted]");
}

// --------------------------------------- milestone 38 / story 07 (ADR-015, task 01) ----

// defaultPushExec(args, { cwd, env }) — the INJECTED push-exec seam, mirroring
// resolveCloneExec/defaultCloneExec's OWN shape verbatim (argv-form execFile, never a
// shell string; a per-invocation `env`, never process.env). Default is a real `git`
// spawn; `@executable` tests inject a FAKE that records argv/env/cwd + a scripted
// status (no real forge, no real credential, no network) OR — for task 01, which is
// explicitly RESOLVED to run over a REAL local bare repo as `origin` — exercise the
// real spawn against a disposable fixture (the DEFAULT — `pushExec` absent — IS the
// real spawn).
function defaultPushExec(args, { cwd, env, timeoutMs = 5 * 60 * 1000 } = {}) {
  return new Promise((resolve, reject) => {
    execFile("git", args, { cwd, env, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error && (error.code === "ENOENT" || error.killed || error.signal)) {
        reject(error);
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? ""), status: error ? (typeof error.code === "number" ? error.code : 1) : 0 });
    });
  });
}

function resolvePushExec(options) {
  return typeof options?.pushExec === "function" ? options.pushExec : defaultPushExec;
}

// pushWorktreeBranch(projectRoot, worktreePath, branch, options) — `git push origin
// <branch>` FROM INSIDE the worktree, reusing `buildAskpassShim` verbatim (ADR-015
// decision 2/invariant 4) — the SAME `GIT_ASKPASS` one-shot the clone path uses
// (ADR-009's PULL), pointed at a push instead: the write credential (if any) rides a
// per-invocation env for THIS exec call ONLY — never process.env — the ambient
// `credential.helper` is reset (`-c credential.helper=`, SECURITY T7, mirroring the
// clone path) and `GIT_TERMINAL_PROMPT=0` so a missing/refused credential fails LOUDLY
// rather than hanging on a prompt or being silently rescued by the machine's own
// keychain. A non-zero exit or a spawn fault THROWS a coded `push-failed` error
// (credential-redacted, never forwarded raw) — the caller (handleDirective below)
// NEVER force-removes the worktree over a failed push; the askpass one-shot directory
// is always removed in a `finally`, so no token outlives this ONE call regardless of
// outcome. The shim's own scratch directory lives under `meshWorktreesRoot(projectRoot)`
// — a `.askpass/` sibling inside the repo's OWN `.aof/mesh/` (already git-ignored),
// never a bare `os.tmpdir()` (mirroring the clone path's F1 discipline at its own,
// global-mesh-home-rooted, scope).
export async function pushWorktreeBranch(projectRoot, worktreePath, branch, options = {}) {
  const exec = resolvePushExec(options);
  const credential = typeof options.credential === "string" && options.credential.length > 0 ? options.credential : null;
  let askpass = null;
  try {
    const pushEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" };
    if (credential != null) {
      askpass = await buildAskpassShim(meshWorktreesRoot(projectRoot), credential);
      pushEnv.GIT_ASKPASS = askpass.shimPath;
    }
    const result = await exec(["-c", "credential.helper=", "push", "origin", branch], { cwd: worktreePath, env: pushEnv });
    if (result.status !== 0) {
      const message = redactCredentialFromText(`git push failed for branch "${branch}": ${result.stderr || result.stdout}`, credential);
      const error = new Error(message);
      error.code = "push-failed";
      throw error;
    }
  } catch (error) {
    error.message = redactCredentialFromText(String(error?.message ?? error), credential);
    error.code = error.code ?? "push-failed";
    throw error;
  } finally {
    await askpass?.cleanup?.();
  }
}

// commitWorktreeChanges(worktreePath, options) — story 07 COMPLETION (VERIFICATION
// F-38.06i, live two-machine soak 2026-07-25). The autonomous agent produces its diff
// in the worktree but does NOT commit it — the agent is commit-agnostic (it runs the
// SAME whether local or on a worker; committing-to-sync-home is the mesh's concern,
// not the agent's). So story 07's `pushWorktreeBranch` had nothing to carry: it pushed
// the branch at its base commit and the worker's work stayed stranded, UNCOMMITTED, in
// the worktree — the exact live-soak finding (a full refine, 7 stories + ADRs + ~180KB
// of docs, that never left the Mac). This commits that diff, right before the push.
//
//   `git add -A`  — stages every change (honouring .gitignore, so a per-worktree
//                   node_modules / build output — RESEARCH §4 — is never committed).
//   `git reset -- .aof` — but NEVER commit aof's OWN config/state (`.aof/aof.config.json`
//                   carries worker-local mesh settings; the milestone deliverables live
//                   under wiki/work/ + the source tree, never under .aof/). Best-effort.
//   `git commit`  — under a mesh identity (`-c user.*`, so a worker whose git identity
//                   is unset still commits), `--no-verify` because this is a HEADLESS
//                   autonomous commit on an ARBITRARY target repo whose commit hooks may
//                   need a dev environment this worktree lacks; the diff is reviewed on
//                   the pushed branch, never merged unseen.
//
// A CLEAN worktree (the agent committed already, or produced nothing) is a NO-OP →
// { committed: false }, so a produce-nothing run is never a spurious empty commit and
// the push still carries any commits the agent DID make. A non-zero git exit THROWS a
// coded `commit-failed` — the caller (handleDirective) treats it exactly like a failed
// push: loud coded `failed`, worktree RETAINED for inspection, never a silent clean
// `done` over an uncommitted diff. Uses the SAME injected push-exec seam so a test
// scripts commit + push through ONE fake git.
export async function commitWorktreeChanges(worktreePath, { message, node, pushExec } = {}) {
  const exec = resolvePushExec({ pushExec });
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" };
  const fail = (result, verb) => {
    const error = new Error(`git ${verb} failed in worktree "${worktreePath}": ${result.stderr || result.stdout}`);
    error.code = "commit-failed";
    return error;
  };

  const add = await exec(["add", "-A"], { cwd: worktreePath, env });
  if (add.status !== 0) throw fail(add, "add");
  // Never sync aof's own config/state home — best-effort, its own outcome is not fatal.
  await exec(["reset", "-q", "--", ".aof"], { cwd: worktreePath, env });

  const staged = await exec(["diff", "--cached", "--name-only"], { cwd: worktreePath, env });
  if (!String(staged.stdout ?? "").trim()) return { committed: false };

  const name = `aof-mesh${typeof node === "string" && node.length > 0 ? ` (${node})` : ""}`;
  const commit = await exec(
    ["-c", `user.name=${name}`, "-c", "user.email=aof-mesh@users.noreply.github.com", "commit", "--no-verify", "-m", message],
    { cwd: worktreePath, env },
  );
  if (commit.status !== 0) throw fail(commit, "commit");
  return { committed: true };
}

// ------------------------------------------- task 01/02/03: the clone orchestration ----

// writeNodeWorkspaceMembership(nodeId, workspaceId, options) — the WORKER's OWN
// NARROW single-row upsert. ⚠ The only EXISTING writer of global_node_workspaces
// (global-node-registry.mjs's publishGlobalRegistryDescriptorsToStore) DELETEs every
// row for a workspace_id first (a fabric-sync flow) — calling it here would wipe
// OTHER nodes' membership rows for a shared workspace. This is a deliberately
// separate, minimal INSERT OR REPLACE keyed on the table's own (node_id,
// workspace_id) PRIMARY KEY — NO DELETE, ever.
async function writeNodeWorkspaceMembership(nodeId, workspaceId, options = {}) {
  const openStore = options.openStore ?? openGlobalWorkProjectionStore;
  const storeOptions = options.globalWorkStoreOptions ?? {};
  const store = await openStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
  try {
    store.db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)").run(nodeId, workspaceId);
  } finally {
    store.close?.();
  }
}

// overlayRepoPublishedMarker(ws, { workspaceId, now }) — writeRepoPublishedMarker
// (reused verbatim) writes the marker to DISK only; it never mutates the caller's
// in-memory workspace.config. Without this overlay, the handler's immediate
// workerHasRepo re-check (right after a successful clone, same tick, same in-memory
// `ws`) would read the STALE pre-clone config and see `published` still absent —
// the guard would never actually pass post-clone. Mirrors commands/mesh-repo.mjs's
// own withRepoMarker overlay idiom (never mutates the argument).
function overlayRepoPublishedMarker(ws, { workspaceId, now }) {
  const mesh = isPlainObject(ws.config?.mesh) ? ws.config.mesh : {};
  const repo = isPlainObject(mesh.repo) ? mesh.repo : {};
  return {
    ...ws,
    config: {
      ...ws.config,
      mesh: { ...mesh, repo: { ...repo, published: true, publishedAt: now, workspaceId } },
    },
  };
}

// cloneRepoForWorkspace(ws, { workspaceId, nodeId, assignmentId, cloneUrl, now, options }) —
// the clone-on-miss PREFIX (ADR-005): clones `cloneUrl` into the ONE scoped
// meshCheckoutPath(workspaceId) seam, argv-form/shell-less, credential (if any) on a
// per-invocation env for THIS exec call ONLY — never process.env. On success, writes
// BOTH repo-availability facts (writeRepoPublishedMarker verbatim + the narrow
// global_node_workspaces upsert) so a subsequent workerHasRepo re-check passes. On
// failure, writes NEITHER fact (no half-state) and throws a coded, credential-
// redacted error — the caller streams the loud coded `failed`.
//
// MILESTONE 38 / STORY 01 task 05 (ADR-009, finding F12) — the credential is PULLED,
// per-clone, from `options.requestCloneCredential({ assignmentId, workspaceId,
// cloneUrl }) => Promise<string|null>`, called HERE, on the clone-miss path only,
// BEFORE any exec call — so a resolution failure (refused / timed out / a
// blank-or-absent reply) is thrown before `checkoutPath` is ever touched by git: no
// partial checkout is left behind. There is NO static credential option — a static
// string is per-HANDLER (one per worker process) and therefore structurally cannot
// be per-clone (SECURITY T4); the async resolver is the ONLY way a credential ever
// enters this function, with no precedence branch and no escape hatch. A caller
// supplying no resolver at all makes no resolution attempt — no request is ever
// sent — exactly today's public-repo behaviour.
export async function cloneRepoForWorkspace(ws, { workspaceId, nodeId, assignmentId, cloneUrl, now, options = {} }) {
  const exec = resolveCloneExec(options);
  const checkoutPath = meshCheckoutPath(workspaceId, options.globalWorkStoreOptions ?? {});

  // TASK 01 / SECURITY T5(b) — a traversal/`..`-laden/absolute workspaceId must
  // construct NO escaping path. path.join alone collapses `..` segments (a plain
  // path.join(root, "../etc") DOES escape the root) — so the constructed path is
  // re-verified against the scoped root BEFORE any mkdir/clone: an id that resolves
  // outside <meshRoot>/checkouts/ is REJECTED here (no clone, no directory created),
  // never silently written outside the dedicated root.
  if (!isUnderMeshCheckoutsRoot(checkoutPath, options.globalWorkStoreOptions ?? {})) {
    const error = new Error(`workspaceId "${workspaceId}" resolves to a checkout path outside the dedicated checkouts root — refused, cloning nothing.`);
    error.code = "assignment-repo-unavailable";
    throw error;
  }

  await mkdir(meshCheckoutsRoot(options.globalWorkStoreOptions ?? {}), { recursive: true });

  // ADR-009 — resolve the credential BEFORE any exec call (see doc comment above).
  // The ONLY entry point: an async per-clone resolver. No static option exists.
  let credential = null;
  if (typeof options.requestCloneCredential === "function") {
    try {
      const resolved = await options.requestCloneCredential({ assignmentId, workspaceId, cloneUrl });
      credential = typeof resolved === "string" && resolved.length > 0 ? resolved : null;
    } catch (error) {
      // The resolver's own thrown error never carries a raw credential value (it
      // reports refusal/timeout/malformed-reply CODES only) — nothing to redact here,
      // but the coded assignment-repo-unavailable shape is applied uniformly so the
      // caller's existing failure handling needs no special case for this path.
      const wrapped = new Error(`clone credential request failed for workspace "${workspaceId}": ${String(error?.message ?? error)}`);
      wrapped.code = "assignment-repo-unavailable";
      throw wrapped;
    }
  }
  let askpass = null;
  try {
    // The credential env is a DISTINCT object passed to ONLY this exec call — it is
    // NEVER assigned onto process.env / merged via Object.assign (SECURITY T2). git
    // still needs PATH/SystemRoot to run at all, so the scoped env spreads
    // ...process.env and adds ONLY the GIT_ASKPASS pointer (when a credential exists).
    //
    // SECURITY T7 / finding F14 (High) — GIT_ASKPASS alone is NOT authoritative: git
    // consults a configured `credential.helper` FIRST, and only falls back to askpass
    // when no helper supplies a credential. MEASURED (stock Git-for-Windows: system
    // helper `manager` + global `wincred`): with a helper configured, the helper WINS
    // and GIT_ASKPASS is never even invoked — so (1) the relay-minted, short-lived,
    // scoped token is silently BYPASSED in favour of the operator's broad ambient
    // keychain PAT, and the clone still SUCCEEDS, so nobody notices T4 evaporated;
    // and (2) on a successful clone git runs the helper's `approve` -> `store`,
    // persisting a credential into the OS keychain — the durable secret store this
    // milestone explicitly refused (T1/R2). Every scoped clone therefore ALWAYS —
    // credentialled or not — resets the helper chain (`-c credential.helper=`, an
    // empty value clears the list, MEASURED to make GIT_ASKPASS authoritative and to
    // suppress the store-on-success) and disables the interactive fallback
    // (`GIT_TERMINAL_PROMPT=0`, so a missing/rejected credential FAILS LOUDLY rather
    // than hanging on a prompt or being silently rescued by an ambient helper). This
    // applies on the PUBLIC / no-credential path too: a private repo whose relay
    // token never arrived must fail loudly, never succeed via the machine's own
    // keychain.
    // Craft R2 (locale-robust shim) — git LOCALIZES its askpass prompt text (gettext);
    // the generated helper's `/^Username/i` match (buildAskpassShim above) only
    // recognises the ENGLISH prompt. Pinning LC_ALL/LANG to the POSIX "C" locale on
    // this per-invocation env (never process.env) makes git emit the English prompt
    // regardless of the host machine's own locale, so the match stays reliable.
    const cloneEnv = { ...process.env, GIT_TERMINAL_PROMPT: "0", LC_ALL: "C", LANG: "C" };
    if (typeof credential === "string" && credential.length > 0) {
      askpass = await buildAskpassShim(meshCheckoutsRoot(options.globalWorkStoreOptions ?? {}), credential);
      cloneEnv.GIT_ASKPASS = askpass.shimPath;
    }

    const result = await exec(["-c", "credential.helper=", "clone", cloneUrl, checkoutPath], { env: cloneEnv });
    if (result.status !== 0) {
      const message = redactCredentialFromText(`git clone failed for workspace "${workspaceId}": ${result.stderr || result.stdout}`, credential);
      const error = new Error(message);
      error.code = "assignment-repo-unavailable";
      throw error;
    }
  } catch (error) {
    if (error?.code !== "assignment-repo-unavailable") {
      error.message = redactCredentialFromText(String(error?.message ?? error), credential);
      error.code = error.code ?? "assignment-repo-unavailable";
    }
    throw error;
  } finally {
    await askpass?.cleanup?.();
  }

  // Success — write BOTH facts (ADR-005: the join workerHasRepo reads). A fault
  // writing either fact leaves NO half-registered state readable as available (the
  // re-check below would still fail the join), matching the "neither fact on
  // failure" invariant task 02 pins.
  await writeRepoPublishedMarker({ configPath: ws.configPath, workspaceId, now });
  await writeNodeWorkspaceMembership(nodeId, workspaceId, options);
  // m42 wave (b) / item 4 — CLONE-TIME IDENTITY PIN. The checkout's identity used
  // to be re-derived from ITS OWN path on this machine (a different id per machine
  // for the same repo — the class that refused the worker's launch-workspace frames
  // and spammed workspace-workdir-unresolvable every 5s, forever). The id the
  // assignment arrived under IS the fleet's canonical id for this repo; pin it into
  // the checkout's own config so resolveWorkspaceId answers it on every machine.
  await pinWorkspaceIdInCheckout(checkoutPath, workspaceId);

  return checkoutPath;
}

// pinWorkspaceIdInCheckout(checkoutPath, workspaceId) — m42 wave (b) / item 4: write
// `mesh.workspaceId` into the scoped checkout's `.aof/aof.config.json`, merging with
// whatever the repo committed (an absent/torn config pins into a fresh `{ mesh }` —
// the pin is the fact that matters). Atomic via writeText; a fault propagates (a
// checkout whose identity could not be pinned would silently regress to the
// per-machine derivation — the exact bug this exists to end).
export async function pinWorkspaceIdInCheckout(checkoutPath, workspaceId) {
  const configPath = path.join(checkoutPath, ".aof", "aof.config.json");
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    config = {}; // absent or unparseable committed config — pin into a fresh one
  }
  const mesh = config?.mesh != null && typeof config.mesh === "object" && !Array.isArray(config.mesh) ? config.mesh : {};
  const next = { ...config, mesh: { ...mesh, workspaceId } };
  await writeText(configPath, `${JSON.stringify(next, null, 2)}\n`);
}

// ------------------------------------------------------- the headless driver ----

// buildDriverCommand(driver, brief) — RETIRED for `claude` (milestone 38 / story 05,
// ADR-013): the interactive PTY path below (resolveInteractiveDriverLaunch /
// driveInteractiveClaudeSession) replaces the old `claude -p <prompt>
// --output-format json` one-shot entirely — `defaultSpawnRuntime` below never calls
// this function for the `claude` driver any more. `codex` keeps its OWN pre-existing
// headless-print form UNCHANGED (ADR-013 is scoped to `claude`; codex was never the
// §4.3 problem — it never had a subscription-billing / human-in-the-loop story to
// begin with, and no task in this story touches it). Any OTHER driver name resolves
// to `null` — a caller must route it through the interactive path or fail closed,
// never silently fall back to a headless print form for `claude`.
export function buildDriverCommand(driver, brief) {
  const prompt = `Drive work item ${brief.itemRef} to a terminal state (done or failed) in this worktree. ${brief.task ?? ""}`.trim();
  if (driver === "codex") {
    return {
      bin: "codex",
      args: ["exec", "--json", "-o", "last-message.txt", "--sandbox", "workspace-write", "--ask-for-approval", "never", prompt],
    };
  }
  return null;
}

// ============================================================================
// MILESTONE 38 / STORY 05 — terminal-driven-worker-execution (ADR-013, tasks 00-03)
// ============================================================================
//
// `claude -p` is GONE from the worker driver path (RESEARCH §4.3 MEASURED: it cannot
// pause to ask a human — a question-ended turn reports `terminal_reason: "completed"`,
// indistinguishable from real completion; the Agent SDK path that COULD ask forces
// off-subscription per-token billing). The worker now runs interactive `claude` in a
// node-pty PTY, resolved through the EXISTING `terminal-providers` seam
// (`resolveProvider("claude")` — the SAME empty-args interactive launch
// `terminal-ws.mjs`'s `/ws/terminal` route uses, terminal-providers.mjs:23) and
// spawned via the SAME node-pty factory (`createTerminalSpawn(loadNodePty)`,
// terminal-ws.mjs) — never a hand-rolled second spawn path. cwd = the worktree
// (task 00).
//
// THE WHOLE DIRECTIVE COMMAND STRING (`/aof:refine <ref> --autonomous`,
// `/aof:continue`, `/aof:verify <ref>`) is typed into that ONE session's PTY stdin as
// a SINGLE newline-terminated `pty.write` — never baked into the spawn argv as a `-p`
// prompt (task 01). ONE long-lived interactive session per assignment:
// driveInteractiveClaudeSession spawns exactly once and resolves exactly once, for
// the assignment's whole run — never re-spawned to deliver a second command line.
//
// TERMINAL-STATE DETECTION reads the PTY's OWN output stream (there is no `-p` JSON
// result to parse). An explicit NEEDS_INPUT_SENTINEL (task 02) observed in the
// accumulated output resolves a THIRD outcome, `needs-input` — distinct from, and
// NEVER re-mapped to, `done` (closing the exact §4.3 gap where a question-ended
// `completed` turn read as `done`). Absent that sentinel, the outcome is read off the
// PTY's own process exit: a clean (0) exit is `done`, anything else is `failed`.
//
// SESSION_ID capture — ADR-013 AMENDMENT (F-38.05, 2026-07-19). The ORIGINAL task-03
// design asked the driven session to print a documented `AOF_SESSION_ID:` marker line
// onto its own PTY output — but nothing ever instructed a real `claude` to emit it, so
// `session_id` was ALWAYS null in production (a consumer with no producer). CORRECTED:
// a TRANSCRIPT-DIR WATCH requiring ZERO model cooperation. A real interactive `claude`
// process, spawned with `cwd = worktreeCwd`, writes its OWN transcript to
// `<claudeProjectsDir({ cwd: worktreeCwd })>/<session_id>.jsonl` (measured live at the
// F-38.05 verify pass) — Claude Code itself is the producer, not the model. The worker
// snapshots that directory's existing `*.jsonl` basenames BEFORE the session can write
// one (the directory may not yet exist — treated as an empty snapshot, never a throw),
// then watches for the FIRST NEW `*.jsonl` basename to appear; that basename, minus its
// extension, NAMES the session (`defaultWatchTranscriptSessionId` below). The watch is
// abort-aware (a caller aborts it once this invocation's own outcome is known — see
// `driveInteractiveClaudeSession`'s `finish` below) and bounded by a max wait, so a
// transcript that never appears degrades to a null sessionId, never a crash, never an
// unbounded loop (task 03's Examples, unchanged).
//
// NEEDS_INPUT producer — ADR-013 AMENDMENT (F-38.05). The original task-02 design typed
// only `brief.command` into the PTY, with no instruction that would make a real
// `claude` ever emit the sentinel — the SAME producerless gap. CORRECTED: a
// worker-scoped `--append-system-prompt NEEDS_INPUT_INSTRUCTION` on the interactive
// launch (`resolveInteractiveDriverLaunch` below) instructs an autonomous, human-absent
// session to emit the sentinel on a genuine judgment call rather than guess. This is
// worker-only by construction — the human `/ws/terminal` route (terminal-ws.mjs) calls
// `resolveProvider` directly and never calls `resolveInteractiveDriverLaunch`, so it can
// never false-fire on a human session. `containsNeedsInputSentinel`'s DETECTION below
// is UNCHANGED — this amendment adds the missing PRODUCER, not a new detector.
export const NEEDS_INPUT_SENTINEL = "NEEDS_INPUT";

// NEEDS_INPUT_INSTRUCTION — the producer text (ADR-013 amendment, option C). Embeds
// NEEDS_INPUT_SENTINEL via a template interpolation so the producer and
// `containsNeedsInputSentinel`'s detector always share the ONE literal. NOTE: this
// template's body must contain no `//` and no `/*` sequence — the
// `acd-worker-driver-no-headless-print` fitness function strips JS comments out of the
// whole source file before scanning it, and either sequence inside this string would
// be stripped right along with real comments, corrupting both the instruction and (for
// an unbalanced `/*`) everything textually after it.
export const NEEDS_INPUT_INSTRUCTION = `You are running autonomously on a worker machine with no human present to answer
questions in real time. If you reach a genuine judgment call you cannot safely
resolve on your own — one where guessing risks doing the wrong thing and a human would
need to weigh in — do not guess and do not stall silently. Instead, print the exact
line ${NEEDS_INPUT_SENTINEL} on its own line, with nothing else on that line, then
stop. Only use this for a real, blocking judgment call; keep working through every
task you can complete confidently without it.`;

// defaultWatchTranscriptSessionId({ cwd, env, signal, maxWaitMs }) => Promise<string|null>
// — the REAL production transcript-dir watch (ADR-013 amendment). Registers its
// `signal`-abort listener SYNCHRONOUSLY, before any async fs call ever runs, so a
// caller that aborts immediately after kicking this off (the common case: the driven
// session already exited before any transcript ever appeared) is guaranteed to resolve
// promptly — never stalls out to `maxWaitMs` waiting on a poll tick that was already
// moot. NEVER throws (every fs fault degrades to "nothing new this tick", never a
// rejection) and NEVER loops forever (bounded by `maxWaitMs`, in addition to the
// abort-signal short-circuit). `maxWaitMs` is an OPTIONAL override (default the
// production constant below) — it exists purely so a hermetic, real-fs test can prove
// the deadline-degrade path fast, without waiting out the real 10-minute production
// bound; production callers never pass it.
const WATCH_TRANSCRIPT_POLL_MS = 200;
const WATCH_TRANSCRIPT_MAX_WAIT_MS = 10 * 60 * 1000;

export async function defaultWatchTranscriptSessionId({ cwd, env, signal, maxWaitMs = WATCH_TRANSCRIPT_MAX_WAIT_MS } = {}) {
  const dir = claudeProjectsDir({ cwd, env });
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    // `existing` stays null until the FIRST readdir tick completes (successfully or
    // not) — that tick's result (or an empty set, on a not-yet-existing directory) IS
    // the "before the session writes one" snapshot; only a `*.jsonl` basename seen on
    // a LATER tick that was absent from this snapshot counts as "new".
    let existing = null;

    const onAbort = () => finish(null);
    function finish(value) {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      try { signal?.removeEventListener?.("abort", onAbort); } catch (error) { /* non-EventTarget signal double */
      reportDegrade("mesh-worker-execution", error); }
      resolve(value);
    }

    // Registered BEFORE any await/async fs call below — an abort fired the instant
    // after this function is called (e.g. a session that exits before the first poll
    // tick even runs) is never missed.
    if (signal?.aborted) {
      finish(null);
      return;
    }
    try { signal?.addEventListener?.("abort", onAbort); } catch (error) { /* non-EventTarget signal */
      reportDegrade("mesh-worker-execution", error); }

    const deadline = Date.now() + maxWaitMs;

    const poll = () => {
      if (settled) return;
      readdir(dir)
        .then((names) => names.filter((name) => name.endsWith(".jsonl")))
        .catch(() => [] /* dir absent or unreadable — nothing new this tick, never a throw */)
        .then((jsonlNames) => {
          if (settled) return;
          if (existing == null) {
            existing = new Set(jsonlNames);
          } else {
            const fresh = jsonlNames.find((name) => !existing.has(name));
            if (fresh != null) {
              finish(fresh.slice(0, -".jsonl".length));
              return;
            }
          }
          if (Date.now() > deadline) {
            finish(null);
            return;
          }
          timer = setTimeout(poll, WATCH_TRANSCRIPT_POLL_MS);
        });
    };
    poll();
  });
}

// review fix (m38/05, confirmed defect #1): the ORIGINAL `buffer.includes(...)` was
// an UNANCHORED substring match — a clean run whose output merely NARRATES the word
// "NEEDS_INPUT" inside a longer line (or a longer token like "NEEDS_INPUTS") false-
// fired, killing a healthy live PTY (:841-844) and mis-reporting a needs-input
// outcome for what was actually a `done` run. The sentinel is now matched ONLY as a
// COMPLETE line — the accumulated buffer's own terminated lines (everything except
// the LAST element of the `\n` split, which is the still-in-flight, not-yet-
// terminated partial line) trimmed and compared for EQUALITY against
// NEEDS_INPUT_SENTINEL — mirroring the sentinel's own documented "one line" shape.
// A sentinel split across two onData chunks (e.g. "NEEDS_I" + "NPUT\n") is still
// detected exactly once, the moment the newline actually completes the line;
// "NEEDS_INPUTS" (or "...says NEEDS_INPUT to the user...") never matches, since
// neither trims down to an exact "NEEDS_INPUT" line.
function containsNeedsInputSentinel(buffer) {
  const lines = buffer.split("\n");
  for (let i = 0; i < lines.length - 1; i += 1) {
    if (lines[i].trim() === NEEDS_INPUT_SENTINEL) return true;
  }
  return false;
}

// TASK COMPLETION, DETECTED FROM THE TRANSCRIPT (VERIFICATION F-38.06h, live soak
// 2026-07-25). An interactive `claude` session NEVER exits after finishing a slash
// command — it returns to its idle prompt and stays alive — so `term.onExit` (the
// driver's only `done` signal) never fires, and a completed directive reads `running`
// FOREVER (measured live: a refine that finished at 14:00 was still `running` at 14:50,
// its session parked). claude Code itself records the turn's end in the SAME transcript
// the session-id watch already reads, with ZERO model cooperation: once the directive
// is done, the last assistant record carries `message.stop_reason: "end_turn"`. This
// watch settles the outcome from THAT clean signal — `done`, or `needs-input` when the
// finished turn carries the sentinel (the same producer the PTY-scan path relies on,
// read here off the clean transcript instead of the escape-laden full-screen PTY
// stream, where line-delimited scanning is unreliable). Injected exactly like the
// session-id watch (`options.watchTranscriptCompletion`, default below), so every test
// omits it or injects a double and no test run reads a real transcript.
const COMPLETION_POLL_MS = 1500;

// COMPLETION_IDLE_MS — VERIFICATION (premature-done, live soak 2026-07-25). `end_turn`
// means "the MODEL finished speaking", NOT "the WORK is finished". This watch originally
// settled after the outcome was seen on two consecutive stable-mtime ticks — ~3 SECONDS of
// transcript silence — which is far below the quiet period a real autonomous run produces.
// MEASURED: a `/aof:continue 18` whose agent had just said "Waiting for 3 background agents
// to finish" ended its turn, went quiet while those agents worked, and was declared `done`
// at 14.7 min — the PTY killed and a PARTIAL diff committed and pushed mid-flight.
//
// A finished turn that is merely WAITING resumes the moment its background work reports
// back, so the transcript moves again. The distinguishing signal is therefore the LENGTH of
// the silence, and it must be far longer than a background build's quiet stretch. A settled
// outcome must now hold with an UNCHANGED transcript mtime for this whole window before the
// session is called finished. This trades a few minutes of latency on a genuinely-complete
// run for never truncating a live one — the correct direction (a premature `done` destroys
// work and reports success; a late `done` only costs time). Injectable, so a test drives it
// on a controllable clock rather than a wall-clock wait.
export const COMPLETION_IDLE_MS = 5 * 60 * 1000;

// readTranscriptTerminalOutcome(file) => { outcome } | null — the transcript's SETTLED
// outcome, or null while the session is still working. Scans the jsonl from the end for
// the last assistant record: `stop_reason: "end_turn"` means the turn is DONE (the
// autonomous session has nothing left and is waiting) — `needs-input` if that turn's
// own text carries the sentinel, else `done`. Any other stop_reason (`tool_use`, or a
// not-yet-terminated streaming turn) is "still working" -> null. NEVER throws (an
// absent or half-written file is simply "nothing settled yet").
async function readTranscriptTerminalOutcome(file) {
  let text;
  try {
    text = await readFile(file, "utf8");
  } catch {
    return null;
  }
  const lines = text.split("\n");
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    const line = lines[i].trim();
    if (line.length === 0) continue;
    let record;
    try {
      record = JSON.parse(line);
    } catch {
      continue;
    }
    const message = record?.message;
    if (record?.type === "assistant" && message && typeof message === "object") {
      const stop = message.stop_reason;
      if (stop == null) return null;
      if (stop !== "end_turn") return null;
      let body = "";
      const content = message.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block?.type === "text" && typeof block.text === "string") body += `${block.text}\n`;
        }
      } else if (typeof content === "string") {
        body = content;
      }
      const needsInput = body.split("\n").some((l) => l.trim() === NEEDS_INPUT_SENTINEL);
      return { outcome: needsInput ? "needs-input" : "done" };
    }
  }
  return null;
}

// defaultWatchTranscriptCompletion({ cwd, env, sessionId, signal, pollMs, idleMs, now }) =>
// Promise<{ outcome }|null> — polls the session's transcript for the settled outcome
// above and fires ONLY once that outcome has held with an UNCHANGED transcript mtime for
// the WHOLE `idleMs` window (COMPLETION_IDLE_MS — see its note: a turn that merely ended
// while waiting on background work resumes and moves the file again, so the length of the
// silence is the signal; the pre-fix ~3s confirmation truncated a live run mid-flight).
// Resolves null on abort (the driver's finish() aborts it via the SAME watchController the
// session-id watch uses, the moment any outcome is known first) — never throws.
export async function defaultWatchTranscriptCompletion({
  cwd, env, sessionId, signal,
  pollMs = COMPLETION_POLL_MS,
  idleMs = COMPLETION_IDLE_MS,
  now = () => Date.now(),
} = {}) {
  if (typeof sessionId !== "string" || sessionId.length === 0) return null;
  const file = path.join(claudeProjectsDir({ cwd, env }), `${sessionId}.jsonl`);
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    let lastMtimeMs = -1;
    // The instant the transcript's mtime last CHANGED — the start of the current quiet
    // stretch. A settled outcome only counts once this stretch reaches `idleMs`.
    let stableSince = null;
    // NOT named `finish` — the driver's own `finish()` is the anchor
    // acd-terminal-view-live-observable's inv.8 detector pins by the FIRST
    // `const finish =` in this file; a second one here would shadow it.
    const settleWatch = (value) => {
      if (settled) return;
      settled = true;
      if (timer != null) clearTimeout(timer);
      try { signal?.removeEventListener?.("abort", onAbort); } catch (error) { /* no signal */
      reportDegrade("mesh-worker-execution", error); }
      resolve(value);
    };
    const onAbort = () => settleWatch(null);
    if (signal?.aborted) { resolve(null); return; }
    try { signal?.addEventListener?.("abort", onAbort, { once: true }); } catch (error) { /* no signal */
      reportDegrade("mesh-worker-execution", error); }

    const tick = async () => {
      if (settled) return;
      let mtimeMs = -1;
      try {
        mtimeMs = (await stat(file)).mtimeMs;
      } catch {
        mtimeMs = -1;
      }
      const outcome = await readTranscriptTerminalOutcome(file);
      // ANY movement in the transcript restarts the quiet stretch — the session is alive
      // (a background agent reported back, a new turn began, a tool ran).
      if (mtimeMs !== lastMtimeMs) {
        lastMtimeMs = mtimeMs;
        stableSince = now();
      }
      // Fire only once a settled outcome has held across a FULLY QUIET `idleMs` window —
      // proof the session is finished, not merely between turns or waiting on background
      // work (the premature-done defect this window exists to close).
      if (outcome != null && mtimeMs >= 0 && stableSince != null && now() - stableSince >= idleMs) {
        settleWatch(outcome);
        return;
      }
      if (!settled) timer = setTimeout(tick, pollMs);
    };
    timer = setTimeout(tick, pollMs);
  });
}

// defaultPtySpawn — the REAL production PTY factory: EXACTLY the seam
// terminal-ws.mjs's own `/ws/terminal` route spawns through (createTerminalSpawn +
// loadNodePty), imported rather than re-implemented, so a real run resolves node-pty
// through the ONE existing loader (the SEA-vs-dev branch terminal-ws.mjs already
// owns) — never a second, drifting spawn path. node-pty itself is loaded lazily
// INSIDE loadNodePty (never at this module's own top-level import), so importing
// mesh-worker-execution.mjs never requires the native addon either.
const defaultPtySpawn = createTerminalSpawn(loadNodePty);

// milestone 38 / story 05 fix (live two-machine soak 2026-07-25, VERIFICATION F27) —
// how long to wait after spawning the interactive claude session before typing the
// directive command into its PTY, so the write lands AFTER claude's TUI is READY. A
// t=0 write raced claude's startup: the keystrokes were LOST and claude sat idle at an
// empty prompt forever, never starting a session (no transcript -> no sessionId ->
// nothing for the story-06 terminal view to bind to). The driver itself defaults to 0
// (immediate next-tick write) so the test suites stay fast; mesh-launcher wires THIS
// value for the real run (the F12 "production supplies the real seam" discipline).
export const INTERACTIVE_COMMAND_READY_DELAY_MS = 5000;

// resolveInteractiveDriverLaunch(driver, options) — task 00's seam: resolves the
// interactive launch EXCLUSIVELY through terminal-providers.mjs's `resolveProvider`
// (`buildArgs()` — the empty-args interactive form; `buildEnv()`), never a hand-built
// argv. Returns null (never throws) on an unknown provider id or an unresolvable
// binary — the caller turns that into a coded `failed` outcome, the SAME
// honest-degrade discipline terminal-ws.mjs's own provider gate keeps.
//
// ADR-013 AMENDMENT (F-38.05, option C) — the interactive launch APPENDS a
// worker-scoped `--append-system-prompt NEEDS_INPUT_INSTRUCTION`: this is the
// NEEDS_INPUT sentinel's real producer. Worker-only by construction — the human
// `/ws/terminal` route (terminal-ws.mjs) calls `resolveProvider` directly and never
// calls this function, so a human session's system prompt is never touched.
export function resolveInteractiveDriverLaunch(driver, options = {}) {
  const providerId = typeof driver === "string" && driver.length > 0 ? driver : "claude";
  const provider = resolveProvider(providerId, options.which);
  if (!provider) return null;
  const env = options.env ?? process.env;
  const bin = provider.resolveBinaryPath(env);
  if (bin === null) return null;
  // milestone 38 / story 05 fix (live two-machine soak 2026-07-25, VERIFICATION F24) —
  // run the worker session in `--permission-mode auto`, NOT bypassPermissions: a genuine
  // tool-permission pause STILL surfaces as NEEDS_INPUT for a human to answer remotely
  // (the terminal-stream + notify loop this milestone exists to enable), but the mode
  // never blocks on the routine approvals a headless run must clear. This is DISTINCT
  // from the one-time folder-TRUST dialog (cleared pre-spawn by ensureWorktreeTrusted
  // below) — trust fires BEFORE the system prompt is read, so no in-session mode can
  // catch it.
  const args = [...provider.buildArgs(), "--permission-mode", "auto", "--append-system-prompt", NEEDS_INPUT_INSTRUCTION];
  const sessionEnv = provider.buildEnv(options.terminalSessionId ?? randomUUID(), env);
  return { bin, args, env: sessionEnv, providerId };
}

// ensureWorktreeTrusted — the claude folder-TRUST pre-write. The implementation moved
// to claude-trust.mjs (2026-07-26) so the board's own local terminal spawn can share it
// without importing this module (which already imports terminal-ws.mjs — that would be
// a cycle). Re-exported here so every existing importer is untouched.
export { ensureWorktreeTrusted } from "./claude-trust.mjs";

// driveInteractiveClaudeSession(brief, options) — the ADR-013 driver: ONE long-lived
// interactive session for `brief`'s whole run. `brief` carries { itemRef,
// worktreeCwd, task, command } — `command` is the directive's WHOLE command string
// (task 01, typed as ONE `pty.write`); `worktreeCwd` is the PTY's cwd.
// `options.ptySpawn` is the INJECTED spawn seam (default `defaultPtySpawn`, the REAL
// node-pty factory above); `options.which` is the INJECTED provider-binary-
// resolution seam (default real PATH lookup, the SAME terminal-providers.mjs
// default); `options.watchTranscriptSessionId` is the INJECTED transcript-dir-watch
// seam (ADR-013 amendment; default `defaultWatchTranscriptSessionId` above);
// `options.onSessionIdCaptured(sessionId)` is the OPTIONAL live-report hook (ADR-013
// AMENDMENT 2026-07-23, invariant 7 — called at most ONCE, the moment the watch
// first resolves a real id, i.e. MID-RUN; absent by default);
// `options.onSessionEnd(sessionId)` is the OPTIONAL END-OF-STREAM hook (ADR-014
// AMENDMENT 2026-07-23, invariant 8 — called ONCE from the single `finish()` settle
// point, for ALL THREE outcomes, after the session id is resolved; absent by
// default, and DISTINCT from `onOutputChunk` by construction). Resolves
// `{ outcome: "done"|"failed"|"needs-input", sessionId, failureReason? }` — NEVER
// throws (an unresolvable provider/binary or a spawn fault is a coded `failed`
// outcome, matching the OLD defaultSpawnRuntime's own never-throw contract).
export async function driveInteractiveClaudeSession(brief, options = {}) {
  const ptySpawn = options.ptySpawn ?? defaultPtySpawn;
  const watchTranscriptSessionId = options.watchTranscriptSessionId ?? defaultWatchTranscriptSessionId;
  const launch = resolveInteractiveDriverLaunch(options.driver, options);
  if (launch == null) {
    return { outcome: "failed", failureReason: "agent_error", sessionId: null };
  }

  // Pre-trust the worktree so claude's one-time folder-TRUST dialog never blocks this
  // autonomous run (VERIFICATION F24). Worker-only by construction — this driver is the
  // worker path; the human /ws/terminal route never calls it. An INJECTED seam (the
  // launcher wires the real ensureWorktreeTrusted; every test omits it, so no test run
  // ever touches a real ~/.claude.json). Best-effort — never throws out of the driver.
  if (typeof options.trustWorktree === "function") {
    try {
      await options.trustWorktree(brief.worktreeCwd);
    } catch (error) {
      // leave claude's own (blocking) dialog in place — the pre-fix behavior.
      reportDegrade("mesh-worker-execution", error); }
  }

  let term;
  try {
    term = await ptySpawn(launch.bin, launch.args, {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd: brief.worktreeCwd,
      env: launch.env,
    });
  } catch {
    return { outcome: "failed", failureReason: "agent_error", sessionId: null };
  }

  // ADR-013 AMENDMENT — the transcript-dir watch is kicked off ALONGSIDE the spawned
  // session (never awaited here: the watch and the driven session run concurrently).
  // `watchController` lets `finish` below stop the watch the moment THIS invocation's
  // own outcome is known — a session that exits (or hits the sentinel) before any
  // transcript ever appears must not leave the watch polling past the point anyone
  // still cares. `watchPromise` NEVER rejects (the seam's own never-throw contract,
  // re-guarded here too) — it resolves the watch's own `string|null` result and, on a
  // non-null resolution, also updates `capturedSessionId` so the story-06
  // `onOutputChunk(chunk, capturedSessionId)` bridge below carries the id on any
  // LATER chunk (mirroring the pre-amendment mid-stream-capture behaviour, now sourced
  // from the watch instead of a PTY marker).
  //
  // ADR-013 AMENDMENT (2026-07-23, structural invariant 7 — BLOCKER F-38.06d): that
  // SAME resolution is also the moment the id must be REPORTED, while the run is
  // still live. `options.onSessionIdCaptured(sessionId)` is the OPTIONAL, ADDITIVE
  // seam the caller (createMeshWorkerExecutionHandler) hangs a live `running` frame on.
  // Called AT MOST ONCE — the watch chain's `.then` runs exactly once by construction,
  // and only for a genuinely non-empty resolution, so a run whose transcript never
  // appears reports NOTHING (it degrades to a null sessionId exactly as before, never
  // a bogus frame, never a crash). Absent by default: every pre-invariant-7 caller is
  // byte-identical.
  const watchController = new AbortController();
  let capturedSessionId = null;
  // The seam CALL ITSELF is guarded, not just its returned promise — an injected test
  // double (or a future producer) that throws SYNCHRONOUSLY rather than returning a
  // rejected promise must never crash this function; `Promise.resolve(...)` alone
  // cannot help against a throw that happens before a promise even exists.
  let watchCallResult;
  try {
    watchCallResult = watchTranscriptSessionId({ cwd: brief.worktreeCwd, env: launch.env ?? process.env, signal: watchController.signal });
  } catch {
    watchCallResult = null;
  }
  const watchPromise = Promise.resolve(watchCallResult)
    .then(async (resolved) => {
      if (typeof resolved === "string" && resolved.length > 0) {
        capturedSessionId = resolved;
        // The LIVE report (invariant 7). AWAITED inside the watch chain — `finish`
        // below awaits that same chain, so the mid-run frame is fully sent BEFORE
        // this invocation resolves and its caller sends any terminal frame; the two
        // can never land out of order (a `running` frame applied AFTER `done` would
        // resurrect a finished assignment). A reporting fault is swallowed: a broken
        // up-channel must never crash or stall the driven session itself.
        try {
          await options.onSessionIdCaptured?.(resolved);
        } catch (error) {
          /* a report fault is never the run's problem */
      reportDegrade("mesh-worker-execution", error); }
      }
      return resolved ?? null;
    })
    .catch(() => null);

  return new Promise((resolve) => {
    let settled = false;
    let buffer = "";
    let dataSub = null;
    let exitSub = null;
    // F27 — the timer for the READINESS-DELAYED directive-command write (below).
    let commandWriteTimer = null;
    // m42 wave (b) / TECH_DEBT item 7 — the PTY LIVENESS PROBE (below).
    let livenessTimer = null;

    const cleanupSubs = () => {
      try { dataSub?.dispose?.(); } catch (error) { /* already-exited guard (win32) */
      reportDegrade("mesh-worker-execution", error); }
      try { exitSub?.dispose?.(); } catch (error) { /* already-exited guard (win32) */
      reportDegrade("mesh-worker-execution", error); }
      // never let a queued command write land in an already-exited/settled PTY.
      if (commandWriteTimer != null) { clearTimeout(commandWriteTimer); commandWriteTimer = null; }
      if (livenessTimer != null) { clearInterval(livenessTimer); livenessTimer = null; }
    };

    // finish(result) — settles this invocation EXACTLY once. Aborts the transcript
    // watch (it has nothing left to serve once the outcome is known) and threads the
    // AWAITED, null-degraded session id onto the resolved object: `capturedSessionId`
    // if the watch already resolved one, otherwise whatever the (now-aborting) watch
    // promise itself settles to — deterministic, never race-dependent on which of
    // "the session ended" vs "the watch found a transcript" happened to win first.
    //
    // The watch chain is awaited UNCONDITIONALLY (invariant 7, F-38.06d): it now also
    // carries the live `options.onSessionId` report, so settling it here is what
    // ORDERS the mid-run `running` frame strictly before the caller's terminal frame.
    // When the watch already resolved an id this is an already-settled promise (one
    // microtask), so the pre-invariant-7 timing is otherwise unchanged.
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanupSubs();
      watchController.abort();
      (async () => {
        let watched = null;
        try {
          watched = await watchPromise;
        } catch {
          watched = null;
        }
        const endedSessionId = capturedSessionId ?? watched;
        // milestone 38 / story 06 / task 04 (ADR-014 AMENDMENT 2026-07-23,
        // structural invariant 8; BLOCKER F-38.06e) — THE END OF THE STREAM,
        // PRODUCED. `cleanupSubs()` above just disposed `dataSub`, i.e.
        // `onOutputChunk` will never be called again for this session: that IS the
        // definition of "this stream has ended", and this is the ONE place it is
        // true for ALL THREE outcomes — `done`/`failed` (via term.onExit) AND
        // `needs-input` (via the sentinel branch below, which term.kill()s the PTY
        // first, because a human resumes with a FRESH `claude --resume` on a NEW
        // session; that stream really is over even though the assignment stays
        // `running`). Emitted AFTER the session id is resolved, so the end frame
        // always has the SAME (nodeId, sessionId) tuple to route on that the bytes
        // had (a null-session end would simply be dropped by the mirror, inv.4).
        //
        // A hook DISTINCT from `onOutputChunk` (never a sentinel smuggled through
        // the byte hook — a control message inside terminal bytes is forgeable by
        // the PTY's own output, SECURITY T14), and BEST-EFFORT fire-and-forget: a
        // reporting fault is swallowed and never delays or fails this settle.
        try {
          const ended = options.onSessionEnd?.(endedSessionId);
          if (ended && typeof ended.catch === "function") {
            ended.catch((error) => {
              // a lost end frame is a stale live view, never a correctness fault.
      reportDegrade("mesh-worker-execution", error); });
          }
        } catch (error) {
          // a synchronous end-report fault is never the run's problem either.
      reportDegrade("mesh-worker-execution", error); }
        resolve({ ...result, sessionId: endedSessionId });
      })();
    };

    dataSub = term.onData?.((chunk) => {
      buffer += String(chunk);
      // milestone 38 / story 06 (ADR-014) — the cross-machine terminal BRIDGE's
      // ONLY hook into this driver: an OPTIONAL, ADDITIVE `options.onOutputChunk`
      // called with EXACTLY the raw chunk `term.onData` itself just emitted, plus
      // whatever sessionId has been captured so far (possibly still null on an
      // early chunk — ADR-014 invariant 4: an unresolvable frame is dropped
      // downstream, never delivered to the wrong card). This is the SAME "the
      // signal is sourced ONLY from term.onData" discipline SECURITY T14 pins —
      // no credential env, no askpass file, no mint reply is ever read here.
      // Absent by default (every pre-story-06 caller stays byte-identical).
      try {
        options.onOutputChunk?.(chunk, capturedSessionId);
      } catch (error) {
        // a bridge fault must never crash/backpressure the driven session itself.
      reportDegrade("mesh-worker-execution", error); }
      // task 02 — the NEEDS_INPUT sentinel yields the THIRD outcome BEFORE any exit
      // is ever observed: a "turn end" is not a process exit, so this driver must
      // detect it from the OUTPUT stream, never wait on onExit for it. Once detected,
      // THIS invocation's job is done — kill the PTY (a human resumes via a FRESH
      // `claude --resume <session_id>` later; RESEARCH §4.3 measured that resume
      // attaches a NEW process to the SAME persisted conversation, never reattaches
      // to a still-running one) and resolve `needs-input`, never `done`.
      if (containsNeedsInputSentinel(buffer)) {
        try { term.kill(); } catch (error) { /* already-exited guard (win32) */
      reportDegrade("mesh-worker-execution", error); }
        finish({ outcome: "needs-input" });
      }
    }) ?? null;

    exitSub = term.onExit?.(({ exitCode }) => {
      finish(exitCode === 0 ? { outcome: "done" } : { outcome: "failed", failureReason: "agent_error" });
    }) ?? null;

    // m42 wave (b) / TECH_DEBT item 7 — THE PTY LIVENESS PROBE. Measured live
    // (run 39ec5149, 2026-07-26): the agent process VANISHED ~11 minutes into a run
    // with no onExit ever delivered, so the run — and its assignment — sat `running`
    // for 25+ minutes while the fleet mirrored the silence of a dead process. onExit
    // is an event from the PTY layer; a child that is killed out-of-band (or whose
    // exit event is lost) delivers nothing. The probe asks the OS directly: every
    // intervalMs, signal-0 the child pid; a dead pid settles the run as
    // `failed/agent_died` through the SAME idempotent finish() every other outcome
    // uses (if onExit fires first, finish's settled-guard makes the probe a no-op).
    // Guarded on a real numeric pid so every injected test fake without one keeps
    // byte-identical behaviour; interval injectable for tests.
    const livenessIntervalMs = options.livenessIntervalMs ?? 15_000;
    if (typeof term.pid === "number" && Number.isFinite(term.pid) && livenessIntervalMs > 0) {
      livenessTimer = setInterval(() => {
        try {
          process.kill(term.pid, 0);
        } catch {
          finish({ outcome: "failed", failureReason: "agent_died" });
        }
      }, livenessIntervalMs);
      // NOT unref'd: an unref'd probe lets the process exit before its first tick
      // when nothing else holds the loop; cleanupSubs clears it on every settle,
      // so a settled run never leaks the interval.
    }

    // milestone 38 (VERIFICATION F-38.06h, live soak 2026-07-25) — COMPLETION FROM THE
    // TRANSCRIPT. An interactive `claude` never exits when a directive finishes, so
    // `exitSub` above would leave the run `running` forever (measured). The instant the
    // session id is known, watch that session's transcript for its settled turn and
    // settle THIS invocation on it — `done`, or `needs-input` when the finished turn
    // carries the sentinel. `term.kill()` ends the parked session (a human resumes with
    // a FRESH `claude --resume` on a new process, never by reattaching — the same
    // discipline the sentinel branch keeps). Whichever of onExit / PTY-sentinel /
    // transcript-completion fires FIRST wins; `finish` is idempotent and its
    // `watchController.abort()` stops this watch. Absent-by-default seam: the launcher
    // uses the real watch, tests omit or inject it (no real transcript is ever read).
    const watchTranscriptCompletion = options.watchTranscriptCompletion ?? defaultWatchTranscriptCompletion;
    watchPromise
      .then((sid) => {
        if (settled || typeof sid !== "string" || sid.length === 0) return;
        return Promise.resolve(
          watchTranscriptCompletion({ cwd: brief.worktreeCwd, env: launch.env ?? process.env, sessionId: sid, signal: watchController.signal }),
        ).then((result) => {
          if (settled || result == null) return;
          try { term.kill(); } catch (error) { /* already-exited guard (win32) */
      reportDegrade("mesh-worker-execution", error); }
          finish({ outcome: result.outcome });
        });
      })
      .catch((error) => {
        // a completion-watch fault never settles the run — onExit / the sentinel still can.
      reportDegrade("mesh-worker-execution", error); });

    // task 01 / F27 — the directive's WHOLE command string, typed as ONE newline-
    // terminated pty.write into THIS ONE session (never a `-p` prompt argv), but only
    // AFTER claude's interactive TUI is ready to receive it. Writing at t=0 (pre-fix)
    // raced claude's startup: the keystrokes were LOST and claude sat idle at an empty
    // prompt forever — never starting a session, so no transcript, no sessionId, and
    // nothing for the story-06 terminal view to bind to (VERIFICATION F27; corroborated
    // by a soak probe whose 5s-delayed write DID start a session). The delay is INJECTED
    // (options.commandDelayMs) — production (mesh-launcher) supplies a real value; every
    // test defaults to 0 (an immediate next-tick write that preserves the pre-fix timing
    // the driver suites assert against). Cleared on finish (cleanupSubs) so a command is
    // never typed into an already-exited PTY.
    const command = typeof brief.command === "string" ? brief.command : null;
    if (command != null && command.length > 0) {
      commandWriteTimer = setTimeout(() => {
        try {
          // F27b (live soak 2026-07-25) — SUBMIT with carriage-return `\r`, the byte a
          // real Enter keypress sends in a terminal, NOT line-feed `\n`. Measured at the
          // soak (PTY capture): claude's TUI enters the command text fine but a trailing
          // `\n` never submits it — the command sat unsubmitted in the input box and the
          // run went idle. `\r` is the Enter key; `\n` (Ctrl+J) is not.
          term.write(`${command}\r`);
        } catch (error) {
          // an already-exited PTY write races nothing observable here — onExit above
          // still resolves the outcome for a process that died before the write landed.
      reportDegrade("mesh-worker-execution", error); }
      }, options.commandDelayMs ?? 0);
    }
  });
}

// defaultSpawnRuntime(brief, options) — the PRODUCTION runtime-spawn default.
// `codex` keeps its UNCHANGED headless one-shot child-process form (a real child,
// cwd = brief.worktreeCwd; the returned promise resolves only once that child has
// FULLY EXITED — execFile's callback fires on process exit, never merely on stdout
// drain, the invariant task 03/milestone-35 cleanup-after-terminal safety depends
// on). Every OTHER driver (`claude`, the default) routes through
// driveInteractiveClaudeSession above — the ADR-013 interactive PTY path, which
// resolves under the SAME "child fully exited or a detected NEEDS_INPUT sentinel
// before any cleanup runs" discipline. Never exercised against a REAL binary by
// `@executable` coverage (every test injects a scripted `spawnRuntime`, or — for
// tasks 00-03's OWN driver-level coverage — a scripted `ptySpawn`/`which`); real
// only at the task-04 @manual soak.
export function defaultSpawnRuntime(brief, options = {}) {
  const driver = options.driver ?? "claude";
  if (driver === "codex") {
    const { bin, args } = buildDriverCommand(driver, brief);
    return new Promise((resolve) => {
      execFile(bin, args, { cwd: brief.worktreeCwd, windowsHide: true, timeout: options.timeoutMs ?? 10 * 60 * 1000 }, (error, stdout) => {
        // A non-zero exit or a spawn fault is a `failed` outcome (never an unhandled
        // rejection out of this seam) — the caller completes the run accordingly.
        if (error) {
          resolve({ outcome: "failed", failureReason: "agent_error" });
          return;
        }
        try {
          const parsed = JSON.parse(String(stdout ?? ""));
          const terminal = parsed.terminal_reason ?? parsed.stop_reason ?? null;
          const ok = terminal === "completed" || terminal === "end_turn";
          resolve(ok ? { outcome: "done" } : { outcome: "failed", failureReason: "agent_error" });
        } catch {
          resolve({ outcome: "failed", failureReason: "agent_error" });
        }
      });
    });
  }
  return driveInteractiveClaudeSession(brief, options);
}

// ------------------------------------------------------- the orchestration ----

function assignmentError(code, message, extra = {}) {
  const error = new Error(message);
  error.code = code;
  Object.assign(error, extra);
  return error;
}

// logAssignmentFailure(assignmentId, code, detail) — review fix (live soak,
// 2026-07-17): EVERY failed-exit in handleDirective below streamed a coded
// `failed` status up the wire but printed NOTHING to this worker's OWN log — the
// worst case was assignmentError(...) actually constructing an Error carrying the
// real message and then discarding it via `void`, the message existing for one
// tick and then genuinely gone. Found live: an assignment failed on the very
// first real cross-machine dispatch ever attempted, and neither the control
// node's assignment row (state alone, no reason) nor the worker's own terminal
// (nothing at all) could say why.
function logAssignmentFailure(assignmentId, code, detail) {
  console.error(`[mesh-worker] assignment ${assignmentId} failed (${code}): ${detail}`);
}

// createMeshWorkerExecutionHandler(options) → handler(directive) — the function
// `client.onDirective(handler)` registers (worker-stream-client.mjs). Every
// collaborator is INJECTED (the transport/ticker injection idiom):
//   loadWs()                        — () => Promise<workspace>, default a real
//                                      loadWorkspace(process.cwd()); tests inject a
//                                      fixture workspace resolver.
//   nodeId                          — this worker's stable id (DATA passed to
//                                      startRun({ node }) — the run-store never learns
//                                      it is mesh).
//   sendAssignmentStatus(assignmentId, state, { runId }) — the worker-stream-client
//                                      up-channel emitter (ADR-002); tests inject a
//                                      recorder.
//   spawnRuntime(brief, opts)       — the runtime-spawn seam (default
//                                      defaultSpawnRuntime); tests ALWAYS inject a
//                                      scripted stub (no real binary).
//   now                             — () => string | string, the injected clock
//                                      threading every stamp (startRun/heartbeat/
//                                      completeRun all take it).
//   exec                            — the injected git exec (mesh-worktree.mjs's
//                                      seam) — passed through to addWorktree/
//                                      removeWorktree so a test's fake git never
//                                      needs a real binary either (task 02's
//                                      run-lifecycle scenarios only assert the
//                                      BRACKET, not worktree mechanics — tasks 00/03
//                                      exercise the real git).
//   onCleanup(assignmentId, outcome, worktreePath) — an observer hook (tests assert
//                                      cleanup/retention without re-deriving it).
//   openStore / globalWorkStoreOptions — passed through to workerHasRepo's local
//                                      global_node_workspaces read (tests point it at
//                                      a hermetic AOF_GLOBAL_HOME).
//   cloneExec(args, { cwd, env })   — milestone 38 story 01's INJECTED clone-exec
//                                      seam (default a real `git` spawn); tests inject
//                                      a FAKE that records argv + env and returns a
//                                      scripted status (no real forge/network).
//   requestCloneCredential(req)     — milestone 38 story 01 task 05, ADR-009 (the F12
//                                      fix): the PULLED clone-credential ASYNC
//                                      resolver — ({ assignmentId, workspaceId,
//                                      cloneUrl }) => Promise<string|null> — forwarded
//                                      to cloneRepoForWorkspace's OWN identically-named
//                                      option, which calls it ONLY on the clone-miss
//                                      path (per-clone by construction, SECURITY T4).
//                                      Production (mesh-launcher.mjs) supplies
//                                      `(request) => client.requestCloneCredential(request)`
//                                      as a LITERAL key at the createHandler({...}) call
//                                      site — the F12 guard: this collaborator is no
//                                      longer reachable ONLY through the
//                                      workerExecutionOptions test-injection spread.
//                                      THERE IS NO STATIC credential option — a static
//                                      string would be per-HANDLER (one per worker
//                                      process) and therefore structurally cannot be
//                                      per-clone; the type of this seam (an async
//                                      resolver, called fresh on every clone-miss) is
//                                      what enforces SECURITY T4, not a comment asking
//                                      politely. Absent for a public-repo clone (no
//                                      resolver call is even attempted).
//   pushExec(args, { cwd, env })    — milestone 38 story 07 task 01's INJECTED
//                                      push-exec seam (default a real `git` spawn,
//                                      defaultPushExec above); tests inject a FAKE that
//                                      records argv/env/order and returns a scripted
//                                      status, OR (task 01, RESOLVED to run over a REAL
//                                      local bare origin) let the default real spawn
//                                      run.
//   requestWriteCredential(req)     — story 07 task 01/02, ADR-015: the push-seam
//                                      write-credential ASYNC resolver — ({
//                                      assignmentId, workspaceId, branch }) =>
//                                      Promise<string|null> — called ONLY on a `done`
//                                      outcome, immediately before the push, mirroring
//                                      requestCloneCredential's OWN per-call-only
//                                      discipline (SECURITY T4 applied to the write
//                                      grant): no static credential option exists here
//                                      either. Production wiring EXISTS:
//                                      mesh-launcher.mjs supplies this resolver as a
//                                      LITERAL key — `requestWriteCredential: (request)
//                                      => client.requestWriteCredential(request)` —
//                                      over worker-stream-client.mjs's own DISTINCT
//                                      `write-credential-request`/`write-credential`
//                                      frame pair (F12-guarded). A caller that passes
//                                      none makes no resolution attempt (an
//                                      unauthenticated push, exactly the clone path's
//                                      own no-resolver default).
//   ptySpawn(bin, args, opts)       — milestone 38 story 05 (ADR-013): the INJECTED
//                                      node-pty spawn seam forwarded straight through
//                                      to spawnRuntime's OWN options (default absent,
//                                      so driveInteractiveClaudeSession falls to ITS
//                                      OWN default — the real
//                                      createTerminalSpawn(loadNodePty) factory,
//                                      EXACTLY the seam terminal-ws.mjs's `/ws/terminal`
//                                      spawns through). `@executable` coverage ALWAYS
//                                      injects a scripted ptySpawn (no real node-pty,
//                                      no real `claude`) — real only at the task-04
//                                      @manual soak.
//   which(bin, env)                 — story 05's INJECTED provider-binary-resolution
//                                      seam, forwarded straight through to
//                                      spawnRuntime's options (default absent, so
//                                      resolveInteractiveDriverLaunch falls to
//                                      terminal-providers.mjs's OWN real-PATH default).
//                                      `@executable` coverage injects a stubbed-
//                                      present/absent binary, mirroring
//                                      terminal-ws.mjs's OWN `which` injection idiom.
//
// Returns a handler `(directive) => Promise<void>` — never throws (a fault inside the
// handler streams a `failed` frame rather than crashing the worker's stream loop; the
// never-crash discipline every other mesh consumer keeps).
export function createMeshWorkerExecutionHandler(options = {}) {
  const {
    loadWs = () => loadWorkspace(process.cwd()),
    nodeId,
    sendAssignmentStatus,
    spawnRuntime = defaultSpawnRuntime,
    now = () => new Date().toISOString(),
    exec,
    driver,
    onCleanup: onCleanupObserver = () => {},
    openStore,
    globalWorkStoreOptions,
    requestCloneCredential,
    cloneExec,
    pushExec,
    requestWriteCredential,
    // milestone 38 / story 05 fix (VERIFICATION F24) — the pre-spawn worktree-trust
    // seam, forwarded VERBATIM into spawnRuntime's options object (below). Production
    // (mesh-launcher) wires the real ensureWorktreeTrusted as a LITERAL key; a test
    // omits it, so no test run ever touches a real ~/.claude.json.
    trustWorktree,
    // milestone 38 / story 05 fix (VERIFICATION F27) — the injected delay before the
    // directive command is typed into claude's PTY, forwarded into spawnRuntime's own
    // options object (below). Production (mesh-launcher) wires the real value; a test
    // omits it and gets an immediate next-tick write (the pre-fix timing).
    commandDelayMs,
    // milestone 38 / story 05 (ADR-013) — forwarded VERBATIM into spawnRuntime's own
    // options object (below) so a test can drive the REAL defaultSpawnRuntime /
    // driveInteractiveClaudeSession through this ONE handler entry point (the SAME
    // "test through the real production seam, only the leaf spawn/PATH-lookup is
    // faked" discipline every other collaborator here keeps).
    ptySpawn,
    which,
    // milestone 38 / story 05 (ADR-013 AMENDMENT, F-38.05) — the session_id
    // transcript-dir-watch seam, forwarded VERBATIM into spawnRuntime's own options
    // object (below) beside ptySpawn/which — the SAME single handler entry point a
    // test injects a fake watch through, no second injection surface.
    watchTranscriptSessionId,
    // milestone 38 (F-38.06h) — the transcript COMPLETION watch, forwarded the same
    // way: the driver defaults to the real poller, a test injects a double.
    watchTranscriptCompletion,
    // milestone 38 / story 06 (ADR-014, AMENDMENT 2026-07-19 — the HYBRID transport,
    // closing BLOCKER F-38.06) — the cross-machine terminal BRIDGE hook, forwarded
    // VERBATIM into spawnRuntime's own options object (below), exactly like
    // ptySpawn/which above: an OPTIONAL `(chunk, sessionId) => void` called for EVERY
    // PTY output chunk driveInteractiveClaudeSession observes (:1002-1017). Absent by
    // default — every pre-story-06 caller (every existing test, and a caller that
    // passes `workerExecution` options with no onOutputChunk) is byte-identical.
    //
    // AS-BUILT WIRING (the F-38.05/F-38.06 amendment resolved the open transport
    // question): mesh-launcher.mjs's worker branch NOW wires this as a LITERAL key at
    // the production createHandler call site to `client.sendTerminalFrame(sessionId,
    // String(chunk))` (mesh-launcher.mjs:846) — the CROSS-MACHINE leg rides the FABRIC
    // (worker-stream-client -> control-stream-server), the ONLY off-host-reachable
    // transport (serveRelay binds loopback only, so the worker CANNOT push straight to
    // the relay broker). control-stream-server branches the terminal-frame to its
    // onTerminalFrame sink and the CONTROL launcher fans it into a loopback relay for
    // the same-machine fleet-UI process. `createTerminalRelayPushTransport` is now
    // CONTROL-SIDE ONLY (the loopback push into that relay), never the worker's leg.
    onOutputChunk,
    // milestone 38 / story 06 / task 04 (BLOCKER F-38.06d; ADR-013 AMENDMENT
    // 2026-07-23, structural invariant 7) — the LIVE join-key report seam:
    // `(sessionId, { assignmentId, runId }) => void|Promise`, called ONCE, MID-RUN,
    // the moment the driver's transcript watch first resolves a session id.
    //
    // WHY IT EXISTS. The `running` frame that OPENS the run is sent BEFORE the driver
    // spawns and carries `{ runId }` only (correctly — no session exists yet), and
    // every OTHER session-carrying frame this handler sends is terminal
    // (`done`/`failed`; `needs-input` aside, which already reports mid-flight). So
    // `global_assignments.session_id` stayed NULL for the whole life of an ordinary
    // run: `projectAssignment` omitted the key, the fleet card resolved `no-session`,
    // and the join key landed only once the stream was dead.
    //
    // The DEFAULT is the report itself — a SECOND `running` frame (the shape the
    // amendment names) on this handler's OWN `sendAssignmentStatus` emitter, so the
    // T6 holder gate and the F17 connection-identity re-stamp both still apply, no
    // new frame kind exists, and the control node's absent-is-not-a-clear writer
    // takes it idempotently (`running` -> `running` re-stamps updatedAt and fills in
    // the session id; a later state-only frame can never erase it). Production
    // (mesh-launcher.mjs) ALSO supplies this as a LITERAL key at the createHandler
    // call site — deliberately equivalent to the default, and deliberately not only
    // the default: the F12/ADR-013-inv.7 discipline is that a producer must be wired
    // in the production call site's own text, never reachable ONLY through the
    // workerExecutionOptions test-injection spread.
    onSessionIdCaptured = (sessionId, { assignmentId, runId } = {}) => sendAssignmentStatus?.(assignmentId, "running", { runId, sessionId }),
    // milestone 38 / story 06 / task 04 (BLOCKER F-38.06e; ADR-014 AMENDMENT
    // 2026-07-23, structural invariant 8) — the END-OF-STREAM seam:
    // `(sessionId) => void|Promise`, forwarded VERBATIM into spawnRuntime's own
    // options object (below) beside `onOutputChunk`, whose SIBLING it is: the byte
    // hook says "more output", this one says "there will be no more".
    //
    // WHY IT EXISTS. The terminal-frame protocol had no end signal at all and the
    // fleet route unsubscribed only on the BROWSER's own close, so after a worker's
    // PTY exited an open terminal-view sat on `streaming`/`live:true`/`motion:
    // "pulse"` forever — DESIGN §Surface 3 V9's exact forbidden state ("a dead
    // stream must not masquerade as a live one"). The driver's `finish()` is the ONE
    // place that fact is known for all three outcomes.
    //
    // NO DEFAULT (unlike onSessionIdCaptured, whose default is a status frame this
    // handler can send itself): the end rides the TERMINAL-FRAME transport, not the
    // assignment-status one, so only the launcher — which holds the worker's stream
    // client — can wire it. Production (mesh-launcher.mjs) supplies it as a LITERAL
    // key at the createHandler({...}) call site, exactly like onOutputChunk (the F12
    // discipline: a producer reachable only through the workerExecutionOptions
    // test-injection spread is one revision from being inert in production).
    onSessionEnd,
    // resolveWorkspaceCloneUrl — INJECTED (the same idiom as every other
    // collaborator here), default the real mesh-presence.mjs seam. Reads the
    // WORKER's OWN local registry — kept as a last-resort, defense-in-depth check
    // (e.g. a shared-filesystem deployment), but CONFIRMED LIVE (2026-07-18) to
    // read nothing in the real cross-machine case: each node's SQLite file is
    // independently, only LOCALLY populated, so a worker that has never itself
    // published this workspace has no row to find here regardless.
    resolveWorkspaceCloneUrl = defaultResolveWorkspaceCloneUrl,
    // requestCloneUrl — review fix (ADR-010 Gap A extended, live soak 2026-07-18):
    // the PULL that actually closes the gap resolveWorkspaceCloneUrl above cannot
    // — asks the control node directly, over the SAME live stream the credential
    // PULL already uses (ADR-009's precedent), for the clone_url it has on record
    // for this workspace. INJECTED; production supplies client.requestCloneUrl
    // (mesh-launcher.mjs), a test may override it via workerExecutionOptions.
    requestCloneUrl,
  } = options;

  // VERIFICATION (live worktree streaming, 2026-07-25) — the ONE place a run's worktree
  // stops being live. Every settle path in the handler already calls `onCleanup`, so
  // wrapping it here releases the worktree from the streaming registry on done, failed,
  // needs-input AND every early refusal, with no per-call-site bookkeeping to forget.
  const onCleanup = (assignmentId, outcome, worktreePath) => {
    clearActiveWorktree(assignmentId);
    return onCleanupObserver(assignmentId, outcome, worktreePath);
  };

  const resolveNow = () => (typeof now === "function" ? now() : now);

  // milestone 35 / ADR-008 — the AUTHORITATIVE dispatch-once guard. The launcher's
  // in-memory "already dispatched" Set (mesh-launcher.mjs) is best-effort ONLY
  // (rebuilt empty on a control-node restart); THIS Set is what the system rests
  // on for correctness: an assignmentId is added the moment this handler starts
  // acting on it (BEFORE the repo guard, before "accepted" is even sent) and is
  // NEVER removed — a directive for an assignmentId already in this Set (in-flight
  // OR already-terminal on this worker) is ignored outright: no re-send of
  // "accepted", no second worktree/run, nothing re-executed. This is what makes a
  // post-restart re-dispatch (the control tick re-scanning a still-`assigned` row
  // whose worker already accepted it) SAFE.
  const seenAssignmentIds = new Set();

  return async function handleDirective(directive) {
    const assignmentId = directive?.assignmentId;
    const itemRef = directive?.itemRef;
    const workspaceId = directive?.workspaceId;
    // milestone 38 / story 05 (ADR-013 invariant 2) — the directive's WHOLE command
    // string, a first-class field on the wire frame (buildDirectiveFrame,
    // control-stream-server.mjs), read here and threaded down to spawnRuntime's
    // `brief.command` below — the ONLY place this handler ever reads it. A directive
    // carrying no command (or a blank one) degrades to null, never a crash — the
    // interactive session below is still spawned, simply with nothing typed into it.
    const directiveCommand = typeof directive?.command === "string" && directive.command.length > 0 ? directive.command : null;
    if (typeof assignmentId !== "string" || assignmentId.length === 0) return;
    if (seenAssignmentIds.has(assignmentId)) return; // duplicate directive — already held/acted on, ignore
    seenAssignmentIds.add(assignmentId);

    let ws;
    try {
      ws = await loadWs();
    } catch (error) {
      logAssignmentFailure(assignmentId, "workspace-load-failed", String(error?.message ?? error));
      await sendAssignmentStatus?.(assignmentId, "failed", {});
      return;
    }

    // task 01 — THE REPO GUARD, FIRST. Before ANY git worktree add: re-check this
    // worker actually holds the repo for workspaceId. A miss streams a structured
    // coded `failed` (never an opaque throw) and creates NO worktree — the guard
    // PRECEDES the `git worktree add` call site (fitness #7 / SEC F3).
    let hasRepo = await workerHasRepo(ws, workspaceId, nodeId, { openStore, globalWorkStoreOptions });

    // milestone 38 / story 01 — CLONE-ON-MISS (ADR-005), a PREFIX to the existing
    // guard, not a rewrite of it. On a miss, resolve the clone SOURCE from the
    // committed config.mesh.repo.cloneUrl (task 00); an unresolvable source keeps the
    // EXISTING loud coded `assignment-repo-unavailable` failed below (nothing
    // cloned). A resolvable source clones into the scoped meshCheckoutPath seam
    // (task 01), then registers BOTH repo-availability facts and RE-CHECKS
    // workerHasRepo (task 02) so the fall-through below is the UNCHANGED m35 flow.
    let resolvedCloneUrl = null;
    if (!hasRepo) {
      // Gap A extended (review fix, live soak 2026-07-17/18): resolveCloneUrl(ws)
      // only ever reads THIS worker's own launch-workspace config — for a
      // workspaceId that is NOT the launch workspace (precisely the clone-on-miss
      // case, by definition), that read is always null. Three tiers, in order:
      //   1. this worker's own local config (resolveCloneUrl) — fastest, no I/O.
      //   2. a live PULL to the control node (requestCloneUrl, ADR-009's precedent)
      //      — the tier that ACTUALLY closes the gap: confirmed live (2026-07-18)
      //      that a fresh worker's own registry copy has no row for a workspace it
      //      has never itself published, so tier 3 alone can never resolve this.
      //   3. this worker's own local registry (resolveWorkspaceCloneUrl) — kept as
      //      a last-resort for a deployment where it DOES happen to have relevant
      //      local knowledge; effectively a no-op in the common cross-machine case.
      // A PULL fault (refusal, timeout, no transport) is caught and falls through
      // to tier 3 rather than aborting the clone attempt outright — the SAME
      // "never let one collaborator's fault become a hard stop" discipline every
      // other optional resolver in this handler already keeps.
      let pulledCloneUrl = null;
      if (resolveCloneUrl(ws) == null && typeof requestCloneUrl === "function") {
        try {
          pulledCloneUrl = await requestCloneUrl({ assignmentId, workspaceId });
        } catch (error) {
          logAssignmentFailure(assignmentId, error?.code ?? "clone-url-request-failed", `clone-url PULL to control failed, falling through to local registry: ${String(error?.message ?? error)}`);
        }
      }
      resolvedCloneUrl = resolveCloneUrl(ws)
        ?? pulledCloneUrl
        ?? await resolveWorkspaceCloneUrl(workspaceId, { openStore, globalWorkStoreOptions });
      const cloneUrl = resolvedCloneUrl;
      if (cloneUrl != null) {
        try {
          const cloneNow = resolveNow();
          await cloneRepoForWorkspace(ws, {
            workspaceId,
            nodeId,
            assignmentId,
            cloneUrl,
            now: cloneNow,
            options: { cloneExec, requestCloneCredential, openStore, globalWorkStoreOptions },
          });
          // writeRepoPublishedMarker (inside cloneRepoForWorkspace) writes to DISK
          // only — overlay the SAME fact onto this handler's in-memory `ws` so the
          // immediate re-check below (same tick) sees it, not a stale pre-clone
          // config (mirrors commands/mesh-repo.mjs's own overlay idiom).
          ws = overlayRepoPublishedMarker(ws, { workspaceId, now: cloneNow });
          hasRepo = await workerHasRepo(ws, workspaceId, nodeId, { openStore, globalWorkStoreOptions });
        } catch (error) {
          const code = error?.code ?? "assignment-repo-unavailable";
          logAssignmentFailure(assignmentId, code, String(error?.message ?? error));
          await sendAssignmentStatus?.(assignmentId, "failed", { code });
          return;
        }
      }
    }

    if (!hasRepo) {
      logAssignmentFailure(assignmentId, "assignment-repo-unavailable", `workerHasRepo still false for workspace ${workspaceId} after clone-on-miss (cloneUrl ${resolvedCloneUrl != null ? `"${resolvedCloneUrl}" resolved but did not result in a usable repo` : "unresolved — neither this worker's own config.mesh.repo.cloneUrl nor the synced registry's clone_url is set for this workspace"})`);
      await sendAssignmentStatus?.(assignmentId, "failed", { code: "assignment-repo-unavailable" });
      return;
    }

    // accepted — the repo guard passed; the directive is genuinely being acted on.
    await sendAssignmentStatus?.(assignmentId, "accepted", {});

    // ── milestone 38 / story 01 fix — live two-machine soak 2026-07-24 (VERIFICATION
    // F23) ── The repo the worker RUNS is scoped by workspaceId, NOT by the daemon's
    // launch cwd. `ws` here is the LAUNCHER's OWN launch workspace (mesh-launcher.mjs
    // wires `loadWs = () => ws`); for a FOREIGN workspace (any workspaceId that is not
    // this launcher's own) the repo lives at the clone-on-miss seam
    // `meshCheckoutPath(workspaceId)` — never `ws.projectRoot`. Running the flow below
    // against `ws.projectRoot` either (a) fails "not a git repository" when the daemon
    // was launched outside a repo (the loud soak symptom), or (b) WORSE, adds a worktree
    // of the launcher's OWN repo and runs the WRONG work off a correct-looking
    // assignment. Repoint `ws` to the scoped checkout so every downstream seam
    // (addWorktree / resolveRefInWorktree / findWork / pushWorktreeBranch /
    // removeWorktree) operates on the ASSIGNED workspace's own tree. This covers BOTH
    // the cloned-this-run case AND a checkout already present from a prior run
    // (workerHasRepo can pass without cloning). The launcher's own-workspace assignment
    // is untouched: its projectRoot already IS its repo and it has no scoped clone.
    const ownWorkspaceId = resolveWorkspaceId(ws);
    if (workspaceId !== ownWorkspaceId) {
      const checkoutPath = meshCheckoutPath(workspaceId, globalWorkStoreOptions ?? {});
      try {
        ws = await loadWorkspace(checkoutPath, undefined, { env: globalWorkStoreOptions?.env });
      } catch (error) {
        logAssignmentFailure(assignmentId, "assignment-checkout-unresolved", `the scoped checkout for foreign workspace ${workspaceId} at ${checkoutPath} could not be loaded: ${String(error?.message ?? error)}`);
        await sendAssignmentStatus?.(assignmentId, "failed", { code: "assignment-checkout-unresolved" });
        return;
      }
    }

    let worktreePath;
    let runRecord;
    let item;
    // story 07 task 00 (ADR-015) — the REAL branch this assignment's worktree is
    // checked out on, computed BEFORE addWorktree so both the checkout call and the
    // eventual push (below) name the SAME branch.
    //
    // VERIFICATION (continue-on-existing-branch, 2026-07-25) — a continue/verify carries
    // `directive.baseBranch` (the item's EXISTING active branch, resolved control-side): it
    // runs ON that branch, so the work accumulates on ONE branch per item across refine →
    // continue → verify (no fresh branch off main — a fresh worktree from main lacks the
    // refine's contract). A refine (or an item with no prior push) has no baseBranch and
    // gets its own per-assignment branch, byte-identical to before. The worktree PATH stays
    // assignmentId-keyed either way (SECURITY F4 untouched).
    const baseBranch = typeof directive.baseBranch === "string" && directive.baseBranch.length > 0 ? directive.baseBranch : null;
    const branch = baseBranch ?? meshWorkerBranchName(itemRef, assignmentId);
    try {
      // task 00 — materialize the dedicated worktree at the ONE seam, ON the REAL
      // branch above (ADR-015: HEAD lands on `branch`, never detached). A reused base
      // branch is checked out via reuseWorktreeOnBranch (release any holder + prune, then
      // check out the existing branch); a fresh branch is `-b <branch>` off the commitish.
      const commitish = directive.commit ?? "HEAD";
      worktreePath = baseBranch != null
        ? await reuseWorktreeOnBranch(ws.projectRoot, assignmentId, baseBranch, { exec })
        : await addWorktree(ws.projectRoot, assignmentId, commitish, { exec, branch });

      // VERIFICATION (live worktree streaming, 2026-07-25) — from HERE the agent's output
      // lands in this worktree, so from here the worker streams it. Registered the moment
      // the worktree exists (not when the run ends) so the control node sees the work AS
      // IT IS PRODUCED — uncommitted, unpushed, no branch read required. Released on every
      // settle path by the onCleanup wrapper above.
      registerActiveWorktree(assignmentId, {
        worktreePath,
        workspaceId,
        itemRef,
        projectRoot: ws.projectRoot,
        workDir: worktreeWorkDir(ws.projectRoot, ws.workDir, worktreePath),
      });

      // T3b / F4b — the ref resolves INSIDE the worktree's OWN checkout via
      // enumerate-then-filter; a traversal ref yields no item there. This is the
      // SCOPING check the security fitness pins — it does NOT decide where the run
      // record lives (below).
      const worktreeItem = await resolveRefInWorktree(ws.projectRoot, ws.workDir, worktreePath, itemRef);
      if (worktreeItem == null) {
        // A structural miss (an unresolvable/traversal ref) is a `failed` terminal —
        // task 03's retain-on-failed rule applies here too: the worktree stays for
        // inspection (never removed), the same as every other failed outcome below.
        logAssignmentFailure(assignmentId, "assignment-ref-unresolved", `itemRef "${itemRef}" did not resolve inside the worktree at ${worktreePath}`);
        await sendAssignmentStatus?.(assignmentId, "failed", {});
        onCleanup(assignmentId, "failed", worktreePath);
        return;
      }

      // task 02 — mint a NODE-PARTITIONED run through the EXISTING run-store, against
      // the item resolved in the worker's PRIMARY checkout (ws.workDir) — the run
      // record (runs/<node>/<runId>.json) is aof's own durable bookkeeping, keyed by
      // item.dir; it must survive the worktree's own cleanup (task 03 force-removes a
      // `done` worktree) and stay discoverable via the ordinary run-status/reclaim
      // seams (task 04's reclaim scan resolves the SAME primary-checkout item). The
      // worktree above already proved the ref resolves inside its own scoped checkout
      // (T3b) — this second resolve is the SAME enumerate-then-filter resolver,
      // applied to the primary tree, never a second path-construction strategy.
      item = await findWork(ws.workDir, itemRef).then((matches) => matches.find((row) => row.ref === itemRef) ?? matches[0] ?? null);
      if (item == null) {
        logAssignmentFailure(assignmentId, "assignment-ref-unresolved", `itemRef "${itemRef}" did not resolve in the primary checkout at ${ws.workDir}`);
        await sendAssignmentStatus?.(assignmentId, "failed", {});
        onCleanup(assignmentId, "failed", worktreePath);
        return;
      }

      const nowIso = resolveNow();
      runRecord = await startRun(item, { now: nowIso, node: nodeId, brief: { assignmentId, itemRef } });

      // running — the worktree is materialized, the run is minted; the assignment's
      // runId is this run's id (the ADR-004 link the frame carries).
      await sendAssignmentStatus?.(assignmentId, "running", { runId: runRecord.runId });

      // Drive the ref to a terminal state via the driver (the INJECTED spawn seam) —
      // milestone 38 / story 05, ADR-013: the directive's WHOLE command string
      // (`brief.command`) is what the interactive session types into its own PTY
      // stdin (never a `-p` prompt argv). THE INVARIANT (unchanged from the old
      // headless driver): spawnRuntime resolves only after the session has reached a
      // terminal-FOR-THIS-INVOCATION state (fully exited, OR a detected NEEDS_INPUT
      // sentinel that this invocation deliberately ends on) — cleanup below never
      // races a live child whose cwd is inside the worktree.
      const outcome = await spawnRuntime(
        { itemRef, worktreeCwd: worktreePath, task: item?.title ?? itemRef, command: directiveCommand },
        {
          driver,
          ptySpawn,
          which,
          trustWorktree,
          commandDelayMs,
          onOutputChunk,
          watchTranscriptSessionId,
          watchTranscriptCompletion,
          // milestone 38 / story 06 / task 04 (BLOCKER F-38.06d; ADR-013 AMENDMENT
          // 2026-07-23, structural invariant 7) — REPORT THE JOIN KEY WHILE THE RUN
          // IS LIVE. The driver calls this the instant its transcript watch resolves
          // a session id — mid-run, ONCE, and only for a real id (a run whose
          // transcript never appears reports nothing and still degrades to null).
          // THIS is the only place the per-directive context the report needs
          // (`assignmentId`, and the runId minted just above) is in scope, so the
          // handler-level seam above is bound to it here.
          onSessionIdCaptured: (sessionId) => onSessionIdCaptured?.(sessionId, { assignmentId, runId: runRecord.runId }),
          // milestone 38 / story 06 / task 04 (BLOCKER F-38.06e; ADR-014 AMENDMENT
          // 2026-07-23, structural invariant 8) — forwarded VERBATIM (no per-
          // directive context is needed: the end frame routes on the (nodeId,
          // sessionId) tuple the bytes already rode, never on the assignment).
          onSessionEnd,
        },
      );
      // task 03 (ADR-013 amendment) — the session_id the driver resolved via its
      // transcript-dir watch (`defaultWatchTranscriptSessionId`, never a PTY-output
      // marker). A run whose transcript never appears (or whose watch was aborted
      // before one did) degrades to null here, never a crash.
      const sessionId = typeof outcome?.sessionId === "string" && outcome.sessionId.length > 0 ? outcome.sessionId : null;

      // task 02 (ADR-013 invariant 4) — a `needs-input` outcome branches out BEFORE
      // completeRun is ever called: run-store's OWN closed transition table (19/
      // ADR-001) legalizes only running->done/failed/cancelled — there is no
      // running->needs-input edge, and there should not be one: the underlying run
      // genuinely IS still running (paused pending a human), so forcing a run-store
      // transition here would misrepresent that. The worktree takes the SAME
      // retain branch `failed` already does (never `removeWorktree(..., {force:true})`
      // — that call site is reached ONLY from the `done` branch below). The
      // assignment-status frame stays within the ALREADY-legal "running" state (a
      // literal "needs-input" string is not in assignment-record.mjs's OWN closed
      // ASSIGNMENT_STATE_PRODUCERS enum — sending it as `state` would risk a
      // control-side assignment-state-invalid throw on a real deployment); the
      // sentinel instead rides the frame's OPTIONAL `code` key (mirroring the
      // failure-code pattern every other frame in this system already uses),
      // alongside the captured sessionId so a human can `claude --resume` it.
      if (outcome.outcome === "needs-input") {
        await sendAssignmentStatus?.(assignmentId, "running", { runId: runRecord.runId, sessionId, code: "needs-input" });
        onCleanup(assignmentId, "needs-input", worktreePath);
        return;
      }

      const completed = await completeRun(item, {
        runId: runRecord.runId,
        outcome: outcome.outcome,
        failureReason: outcome.failureReason ?? null,
        now: resolveNow(),
      });

      // task 03/07 — cleanup on done, retain on failed; on a `done` AGENT outcome,
      // story 07 (ADR-015) inserts a PUSH before that cleanup can ever run. `force:true`
      // on the (eventual) done-cleanup path: the headless runtime's own work inside the
      // worktree (build artifacts, dependency installs, any file it wrote —
      // RESEARCH.md §4's node_modules-per-worktree note) is untracked content
      // `git worktree remove` (no force) refuses to delete over (RESEARCH.md §4
      // measured: "contains modified or untracked files"). A cleanly-pushed `done`
      // worktree carries no content worth a human inspecting (that is exactly the
      // `failed`/retained-push-failure job — this run's OWN bookkeeping record lives in
      // the primary checkout's runs/<node>/, per the item resolved above, so it is
      // never lost to this removal), so force is the correct, documented default here
      // — never used on either retention path below.
      if (completed.state === "done") {
        // story 07 task 01 (ADR-015 decisions 2/3, invariants 3/4) — PUSH BEFORE the
        // worktree is EVER force-removed, reusing the ADR-009 askpass shim
        // (pushWorktreeBranch above). The worktree is NOT removed until the push
        // succeeds; a FAILED push (rejected / unreachable / auth-refused) RETAINS the
        // worktree and surfaces a LOUD coded `failed` — the agent's OWN run may have
        // completed `done`, but an unpushed diff means the ASSIGNMENT is not cleanly
        // done, so the "done" status frame is sent ONLY after the push itself succeeds.
        try {
          // story 07 COMPLETION (F-38.06i) — COMMIT the agent's diff BEFORE the push can
          // carry it home. Without this the push moves nothing (the branch sits at its
          // base commit) and the worker's work stays stranded in the worktree — the
          // live-soak finding. A coded `commit-failed` is caught below exactly like a
          // failed push (loud `failed`, worktree retained). A clean worktree is a no-op.
          const directiveLabel = typeof directiveCommand === "string" && directiveCommand.length > 0 ? directiveCommand : `run ${itemRef}`;
          await commitWorktreeChanges(worktreePath, {
            message: `aof(mesh): ${itemRef} — ${directiveLabel}\n\nAutonomous worker output (assignment ${assignmentId}, run ${runRecord.runId}, node ${nodeId}).`,
            node: nodeId,
            pushExec,
          });

          let writeCredential = null;
          if (typeof requestWriteCredential === "function") {
            const resolved = await requestWriteCredential({ assignmentId, workspaceId, branch });
            writeCredential = typeof resolved === "string" && resolved.length > 0 ? resolved : null;
          }
          await pushWorktreeBranch(ws.projectRoot, worktreePath, branch, { credential: writeCredential, pushExec });
          // VERIFICATION (continue-on-existing-branch, 2026-07-25) — report the ACTUAL
          // pushed branch on the done frame so control records this item's active branch
          // (the next continue/verify reuses it). For a reused base branch this IS that
          // branch; for a refine it is the fresh per-assignment branch.
          await sendAssignmentStatus?.(assignmentId, "done", { runId: runRecord.runId, sessionId, branch });
          await removeWorktree(ws.projectRoot, assignmentId, { exec, force: true });
          onCleanup(assignmentId, "done", worktreePath);
        } catch (pushError) {
          const code = pushError?.code ?? "push-failed";
          logAssignmentFailure(assignmentId, code, `push of branch "${branch}" failed for assignment ${assignmentId}: ${String(pushError?.message ?? pushError)}`);
          await sendAssignmentStatus?.(assignmentId, "failed", { runId: runRecord.runId, code, sessionId });
          onCleanup(assignmentId, "failed", worktreePath);
        }
      } else {
        await sendAssignmentStatus?.(assignmentId, completed.state, { runId: runRecord.runId, sessionId });
        onCleanup(assignmentId, "failed", worktreePath);
      }
    } catch (error) {
      // A genuine fault mid-execution (a worktree-add failure, a run-store fault, …)
      // still streams a loud `failed` — never an unhandled crash of the worker's
      // stream loop (the never-crash discipline every mesh consumer keeps; the
      // handler is invoked fire-and-forget from the transport's message listener,
      // worker-stream-client.mjs:133, so a rethrow here would surface only as an
      // unhandled rejection, never a caught fault — swallow it after the coded
      // status is streamed).
      await sendAssignmentStatus?.(assignmentId, "failed", { runId: runRecord?.runId });
      const constructed = assignmentError("assignment-execution-failed", String(error?.message ?? error));
      logAssignmentFailure(assignmentId, constructed.code, `${constructed.message}${error?.stack ? `\n${error.stack}` : ""}`);
    }
  };
}

// createMeshRecoveryPushHandler(options) → handler(frame) — the function
// `client.onRecoveryPush(handler)` registers (worker-stream-client.mjs). VERIFICATION
// (control-driven recovery, live two-machine soak 2026-07-25). Story 07's push-home
// runs only on the ACTIVE assignment's own `done` seam; when a worker STALLS or an
// assignment is left terminal with its diff stranded in the worktree, there is no active
// flow to push it. This handler is that missing flow: control dispatches a `recovery-push`
// DOWN-frame (carrying a freshly minted one-shot write credential) and this commits +
// pushes the assignment's OWN worktree, exactly reusing the done-path's two exported
// seams (commitWorktreeChanges + pushWorktreeBranch), then replies with the result.
//
// It resolves the SAME projectRoot the assignment ran under — this worker's own
// workspace, or the scoped foreign checkout at meshCheckoutPath(workspaceId) — mirroring
// the driver's own repoint (:1806-1816), so the worktree/branch it acts on are byte-for-
// byte the ones the assignment created. Every collaborator is INJECTED (the same idiom
// as createMeshWorkerExecutionHandler):
//   loadWs, nodeId, exec, pushExec, globalWorkStoreOptions — as in the driver above.
//   sendRecoveryPushResult(assignmentId, { ok, code, branch }) — the worker-stream-client
//                                      UP-reply emitter; tests inject a recorder.
//
// Never throws (the never-crash discipline — a fault is reported as a `recovery-push-result`
// { ok:false, code }, never an unhandled rejection out of the transport message listener).
export function createMeshRecoveryPushHandler(options = {}) {
  const {
    loadWs = () => loadWorkspace(process.cwd()),
    nodeId,
    sendRecoveryPushResult,
    exec, // reserved for symmetry with the driver's worktree seam; the push uses pushExec
    pushExec,
    globalWorkStoreOptions,
  } = options;
  void exec;

  return async (frame) => {
    const assignmentId = typeof frame?.assignmentId === "string" && frame.assignmentId.length > 0 ? frame.assignmentId : null;
    const itemRef = typeof frame?.itemRef === "string" && frame.itemRef.length > 0 ? frame.itemRef : null;
    const workspaceId = typeof frame?.workspaceId === "string" && frame.workspaceId.length > 0 ? frame.workspaceId : null;
    const branch = typeof frame?.branch === "string" && frame.branch.length > 0
      ? frame.branch
      : (itemRef != null && assignmentId != null ? meshWorkerBranchName(itemRef, assignmentId) : null);
    const credential = typeof frame?.credential === "string" && frame.credential.length > 0 ? frame.credential : null;

    if (assignmentId == null || branch == null) {
      if (assignmentId != null) await sendRecoveryPushResult?.(assignmentId, { ok: false, code: "recovery-push-frame-invalid" });
      return;
    }

    try {
      // Repoint to the assignment's OWN checkout (own workspace vs scoped foreign clone),
      // the SAME resolution the driver performs before it ever touches a worktree.
      let ws = await loadWs();
      const ownWorkspaceId = resolveWorkspaceId(ws);
      if (workspaceId != null && workspaceId !== ownWorkspaceId) {
        const checkoutPath = meshCheckoutPath(workspaceId, globalWorkStoreOptions ?? {});
        ws = await loadWorkspace(checkoutPath, undefined, { env: globalWorkStoreOptions?.env });
      }
      const projectRoot = ws.projectRoot;
      const worktreePath = meshWorktreePath(projectRoot, assignmentId);

      // The worktree must still be on disk — a cleanly-`done` assignment force-removed
      // it, so there is nothing to recover (a clear coded result, never a crash).
      let worktreeExists = false;
      try { worktreeExists = (await stat(worktreePath)).isDirectory(); } catch { worktreeExists = false; }
      if (!worktreeExists) {
        await sendRecoveryPushResult?.(assignmentId, { ok: false, code: "recovery-worktree-missing", branch });
        return;
      }

      // COMMIT the stranded diff (a no-op if the agent/operator already committed), then
      // PUSH — the EXACT two seams the done-path uses, so recovery and the normal path
      // never drift. A commit-failed / push-failed throws a coded error, reported below.
      await commitWorktreeChanges(worktreePath, {
        message: `aof(mesh): ${itemRef ?? assignmentId} — recovery push\n\nControl-driven recovery of stranded worker output (assignment ${assignmentId}, node ${nodeId}).`,
        node: nodeId,
        pushExec,
      });
      await pushWorktreeBranch(projectRoot, worktreePath, branch, { credential, pushExec });
      await sendRecoveryPushResult?.(assignmentId, { ok: true, branch });
    } catch (error) {
      const code = error?.code ?? "recovery-push-failed";
      logAssignmentFailure(assignmentId, code, `recovery push of branch "${branch}" failed for assignment ${assignmentId}: ${String(error?.message ?? error)}`);
      await sendRecoveryPushResult?.(assignmentId, { ok: false, code, branch });
    }
  };
}
