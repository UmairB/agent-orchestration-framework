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
// control<->worker frame-pair (mirroring ADR-009's clone-credential-request) is NOT
// built by this story's four tasks (none of tasks 00-02's `@executable` scenarios name
// a wire frame; the ADR's own codebase-graph grounding pins the branch+push blast
// radius to mesh-worktree.mjs + this file) — flagged in STATE.md Feedback as the gap
// task 03's `@manual` soak needs closed before it can run for real.
import path from "node:path";
import { execFile } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { findWork, loadWorkspace } from "./work.mjs";
import { startRun, completeRun } from "./run-store.mjs";
import { addWorktree, removeWorktree, meshWorktreesRoot, meshWorkerBranchName } from "./mesh-worktree.mjs";
import { globalMeshPaths } from "./workspace.mjs";
import { openGlobalWorkProjectionStore } from "./global-work-store.mjs";
import { writeRepoPublishedMarker } from "./commands/mesh-repo.mjs";
import { resolveWorkspaceCloneUrl as defaultResolveWorkspaceCloneUrl } from "./mesh-presence.mjs";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
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

  return checkoutPath;
}

// ------------------------------------------------------- the headless driver ----

// The documented default driver (RESEARCH.md §2/§3, STORY.md build notes): `claude -p
// --output-format json`, spawned with cwd = the worktree path, for ONE non-interactive
// turn. DRIVER-PLUGGABLE — `options.driver` names an alternate ("codex") the caller
// resolves via buildDriverCommand.
export function buildDriverCommand(driver, brief) {
  const prompt = `Drive work item ${brief.itemRef} to a terminal state (done or failed) in this worktree. ${brief.task ?? ""}`.trim();
  if (driver === "codex") {
    return {
      bin: "codex",
      args: ["exec", "--json", "-o", "last-message.txt", "--sandbox", "workspace-write", "--ask-for-approval", "never", prompt],
    };
  }
  return { bin: "claude", args: ["-p", prompt, "--output-format", "json"] };
}

// defaultSpawnRuntime(brief, options) — the PRODUCTION runtime-spawn default: a real
// child process, cwd = brief.worktreeCwd. THE INVARIANT: the returned promise
// resolves ONLY once the child has FULLY EXITED (execFile's callback fires on
// process exit, never merely on stdout drain) — the sequencing task 03's
// cleanup-after-terminal safety depends on. Never exercised by @executable coverage
// (every test injects a scripted spawnRuntime); real only at the task-05 @manual soak.
export function defaultSpawnRuntime(brief, options = {}) {
  const driver = options.driver ?? "claude";
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
//                                      either. THERE IS NO PRODUCTION WIRING YET (flag,
//                                      STATE.md Feedback) — none of tasks 00-02's
//                                      `@executable` scenarios name a control<->worker
//                                      wire frame for this resolver, so mesh-launcher.mjs
//                                      does not yet supply one; a caller that passes
//                                      none makes no resolution attempt (an
//                                      unauthenticated push, exactly the clone path's
//                                      own no-resolver default).
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
    onCleanup = () => {},
    openStore,
    globalWorkStoreOptions,
    requestCloneCredential,
    cloneExec,
    pushExec,
    requestWriteCredential,
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

    let worktreePath;
    let runRecord;
    let item;
    // story 07 task 00 (ADR-015) — the REAL branch this assignment's worktree is
    // checked out on, computed BEFORE addWorktree so both the checkout call and the
    // eventual push (below) name the SAME branch. Distinct per assignmentId by
    // construction (meshWorkerBranchName embeds it), so two assignments for the same
    // itemRef never collide.
    const branch = meshWorkerBranchName(itemRef, assignmentId);
    try {
      // task 00 — materialize the dedicated worktree at the ONE seam, ON the REAL
      // branch above (ADR-015: HEAD lands on `branch`, never detached — CONTRAST the
      // pre-story-07 `--detach` form). "HEAD" is the target commitish — the assignment
      // always targets the current tip of the branch the control node dispatched from
      // (no ref negotiation this milestone; a future story could carry an explicit
      // commit).
      const commitish = directive.commit ?? "HEAD";
      worktreePath = await addWorktree(ws.projectRoot, assignmentId, commitish, { exec, branch });

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

      // Drive the ref to a terminal state via the BOUNDED headless runtime (the
      // INJECTED spawn seam). THE INVARIANT: spawnRuntime resolves only after the
      // child has fully exited — cleanup below never races a live child whose cwd is
      // inside the worktree.
      const outcome = await spawnRuntime(
        { itemRef, worktreeCwd: worktreePath, task: item?.title ?? itemRef },
        { driver },
      );

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
          let writeCredential = null;
          if (typeof requestWriteCredential === "function") {
            const resolved = await requestWriteCredential({ assignmentId, workspaceId, branch });
            writeCredential = typeof resolved === "string" && resolved.length > 0 ? resolved : null;
          }
          await pushWorktreeBranch(ws.projectRoot, worktreePath, branch, { credential: writeCredential, pushExec });
          await sendAssignmentStatus?.(assignmentId, "done", { runId: runRecord.runId });
          await removeWorktree(ws.projectRoot, assignmentId, { exec, force: true });
          onCleanup(assignmentId, "done", worktreePath);
        } catch (pushError) {
          const code = pushError?.code ?? "push-failed";
          logAssignmentFailure(assignmentId, code, `push of branch "${branch}" failed for assignment ${assignmentId}: ${String(pushError?.message ?? pushError)}`);
          await sendAssignmentStatus?.(assignmentId, "failed", { runId: runRecord.runId, code });
          onCleanup(assignmentId, "failed", worktreePath);
        }
      } else {
        await sendAssignmentStatus?.(assignmentId, completed.state, { runId: runRecord.runId });
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
