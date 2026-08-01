// src/mesh-repo-marker.mjs — the `mesh.repo` config subtree: the clone-URL SHAPE
// rule and the per-repo PUBLISHED MARKER that is written against it.
//
// Extracted (m42 wave (d) leg d1) to break the one confirmed import cycle in the
// tree: `mesh-worker-execution.mjs` imported `writeRepoPublishedMarker` UP from
// `commands/mesh-repo.mjs`, which imported `isWellFormedCloneUrl` back DOWN from
// `mesh-worker-execution.mjs`. Both facts are about the same config subtree and
// neither belongs to a command, so they live here and both former sides import
// downward. No behaviour change — the functions moved verbatim.
import { execFile } from "node:child_process";
import { readJson, writeText } from "./fs.mjs";

export function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

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


// defaultGitRemoteExec(args, { cwd }) — mirrors mesh-worker-execution.mjs's clone-exec
// idiom: argv-form via execFile, NEVER a shell string. Resolves to the trimmed stdout,
// or `null` on ANY failure (no git installed, not a repo, no such remote) — the caller
// treats `null` as "nothing to auto-detect", never a thrown fault. `@executable` tests
// inject a fake that returns a scripted URL (or `null`) — no real git process, no real
// repo.
function defaultGitRemoteExec(args, { cwd } = {}) {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: 5000, windowsHide: true }, (error, stdout) => {
      resolve(error ? null : String(stdout ?? "").trim());
    });
  });
}

// stripUrlUserinfo(url) — a personal `origin` remote commonly carries the operator's
// OWN identity embedded as `scheme://user[:pass]@host/...` (e.g. a GitHub CLI-authored
// remote). `git clone` uses `cloneUrl` VERBATIM (mesh-worker-execution.mjs's clone-exec
// call), so a leftover personal username would fight the askpass shim's ADR-010
// prompt-aware answer (`x-access-token` on the Username prompt) — git skips that
// prompt entirely when the URL already carries a username, silently substituting the
// wrong one. Stripped for the `scheme://...` form ONLY. The scp-style shorthand
// (`git@host:owner/repo`) is left untouched — that `git` user is the SSH service
// account convention, not a personal credential, and isWellFormedCloneUrl's own
// shorthand branch has no separate host/userinfo to split apart.
function stripUrlUserinfo(url) {
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(url)) return url;
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

// detectCloneUrlFromGitRemote(projectRoot, gitRemoteExec) — `git remote get-url
// origin` in the repo's own directory, validated through the SAME `isWellFormedCloneUrl`
// gate every other cloneUrl source is held to (never a bespoke second validator), with
// any personal userinfo stripped before it is ever persisted.
async function detectCloneUrlFromGitRemote(projectRoot, gitRemoteExec) {
  if (!projectRoot) return null;
  let stdout;
  try {
    stdout = await gitRemoteExec(["remote", "get-url", "origin"], { cwd: projectRoot });
  } catch {
    return null;
  }
  if (!isWellFormedCloneUrl(stdout)) return null;
  return stripUrlUserinfo(stdout.trim());
}

// Read-merge-write the local per-repo published marker. Only mesh.repo is set; every
// other key — mesh.nodeId/salt/relay, the non-mesh top level — survives byte-equivalent
// (the mesh-join.mjs writeGlobalMeshConfig precedent, aimed at the LOCAL config path).
// Returns { configPath, cloneUrl } — `cloneUrl` is the value now on disk (pre-existing
// or freshly detected), or `null` if neither was available.
export async function writeRepoPublishedMarker({
  configPath,
  workspaceId,
  now,
  projectRoot = null,
  gitRemoteExec = defaultGitRemoteExec,
}) {
  let onDisk = {};
  try {
    onDisk = await readJson(configPath);
  } catch {
    onDisk = {};
  }
  if (!isPlainObject(onDisk)) onDisk = {};

  const existingMesh = isPlainObject(onDisk.mesh) ? onDisk.mesh : {};
  const existingRepo = isPlainObject(existingMesh.repo) ? existingMesh.repo : {};

  // Check first — an already-configured cloneUrl is never replaced by a git-remote
  // guess, however different the two might be.
  let cloneUrl = isWellFormedCloneUrl(existingRepo.cloneUrl) ? existingRepo.cloneUrl.trim() : null;
  if (cloneUrl == null) {
    cloneUrl = await detectCloneUrlFromGitRemote(projectRoot, gitRemoteExec);
  }

  onDisk.mesh = {
    ...existingMesh,
    repo: {
      ...existingRepo,
      ...(cloneUrl != null ? { cloneUrl } : {}),
      published: true,
      publishedAt: now,
      workspaceId,
    },
  };
  await writeText(configPath, `${JSON.stringify(onDisk, null, 2)}\n`);
  return { configPath, cloneUrl };
}
