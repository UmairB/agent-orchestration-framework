// `aof mesh repo publish` — the explicit "publish THIS repo into the mesh" verb
// (milestone 34 / story 06, ADR-010). Until this landed, a repo only appeared in the
// machine-wide global store as a SIDE EFFECT of a work-mutating command (run
// start/complete, feedback) or the launcher's converge tick — there was no operator
// verb to say "make this repo visible in the mesh now". This module is that verb's
// core, kept out of cli.mjs so it is unit-testable without spawning the CLI.
//
// It does two things, in order:
//   (1) writes a per-repo PUBLISHED MARKER into the LOCAL .aof/aof.config.json
//       (`mesh.repo = { published, publishedAt, workspaceId, cloneUrl? }`) via a
//       read-merge-write that preserves every other key — the durable record that this
//       repo is a mesh repo (and, via ADR-010's gate extension in
//       global-work-publisher.mjs, the signal that its FUTURE work mutations auto-
//       propagate). The marker is written to the LOCAL on-disk config, never the
//       global-merged in-memory view, so the global mesh subtree (enabled/relay/
//       credential) is not copied down into the repo.
//   (2) publishes a snapshot NOW through the ONE publisher seam
//       (global-work-publisher.mjs's publishGlobalWorkSnapshot — the acd-global-
//       publisher-single-seam boundary), with the marker applied in-memory so the
//       propagation gate treats this repo as mesh-enabled for the immediate publish.
//
// Milestone 38 addition (`2026-07-16`, at the operator's direction — "check if it
// exists first, then add it if it doesn't", rejecting a separate `set-clone-url`
// verb as needless ceremony): if `mesh.repo.cloneUrl` is NOT already configured, this
// verb derives it from the repo's own `git remote get-url origin` and folds it into
// the SAME marker write — no manual JSON edit, no second command. An ALREADY-configured
// `cloneUrl` is never overwritten (git remote is only ever a fallback, never a source
// of truth once a value is committed). Detection failure (not a git repo, no `origin`
// remote, a malformed URL) is silent and non-fatal — the publish still succeeds with no
// `cloneUrl`, exactly today's behaviour when nobody configures one; a later clone-miss
// still fails loud and coded (`assignment-repo-unavailable`), per ADR-005.
import { execFile } from "node:child_process";
import { readJson, writeText } from "../fs.mjs";
import { publishGlobalWorkSnapshot } from "../global-work-publisher.mjs";
import { resolveWorkspaceId } from "../workspace-identity.mjs";
import { isWellFormedCloneUrl } from "../mesh-worker-execution.mjs";

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
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

// Overlay the published marker onto a loaded workspace's IN-MEMORY config so the
// immediate publishGlobalWorkSnapshot sees mesh.repo.published === true (the ADR-010
// gate arm) without a second loadWorkspace. Never mutates the argument.
function withRepoMarker(ws, { workspaceId, now, cloneUrl }) {
  const mesh = isPlainObject(ws.config?.mesh) ? ws.config.mesh : {};
  const repo = isPlainObject(mesh.repo) ? mesh.repo : {};
  return {
    ...ws,
    config: {
      ...ws.config,
      mesh: {
        ...mesh,
        repo: {
          ...repo,
          ...(cloneUrl != null ? { cloneUrl } : {}),
          published: true,
          publishedAt: now,
          workspaceId,
        },
      },
    },
  };
}

// publishRepoToMesh(ws, ctx) — write the marker, then publish a snapshot now. `ctx`
// carries the publisher options (globalWorkStoreOptions for a hermetic AOF_GLOBAL_HOME
// in tests, now for a fixed clock, gitRemoteExec to inject a fake git-remote reader);
// production passes {} and the store resolves to ~/.aof/mesh. Returns a structured
// result for the CLI render/--json face.
export async function publishRepoToMesh(ws, ctx = {}) {
  const now = ctx.now ?? new Date().toISOString();
  const projectRoot = ws.projectRoot;
  const workspaceId = resolveWorkspaceId(ws);
  const configPath = ws.configPath;

  const { cloneUrl } = await writeRepoPublishedMarker({
    configPath,
    workspaceId,
    now,
    projectRoot,
    gitRemoteExec: ctx.gitRemoteExec,
  });

  const propagation = await publishGlobalWorkSnapshot(withRepoMarker(ws, { workspaceId, now, cloneUrl }), ctx);

  return {
    published: propagation.published === true,
    workspaceId,
    projectRoot,
    configPath,
    publishedAt: now,
    cloneUrl,
    warning: propagation.warning ?? null,
  };
}
