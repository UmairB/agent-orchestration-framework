// The read-only source-access seam (milestone 13 / story 00 — the SPINE; ADR-002).
//
// Mirrors src/planning-init.mjs's `resolveInjectedSha` / `AOF_PLANNING_*`
// injection idiom so `@executable` tests run OFFLINE. A LOCAL `<repo>` (an
// existing directory path) is read IN PLACE with NO network (the `@executable`
// lane). A REMOTE `<repo>` (a URL) is reached READ-ONLY via the `git`-argv-spawn
// idiom (`git ls-remote`, no shell string) — the live leg, exercised only by the
// `@manual` rows. **Never construct any git write verb (commit/push/checkout/
// clone-into-source) against `<repo>`.** The source repo is NEVER mutated.
import { existsSync, statSync } from "node:fs";
import { spawnSync } from "node:child_process";

// True when `repo` looks like a remote URL (http(s)://, git://, ssh, scp-like
// `user@host:path`) rather than a local path. A local existing directory is read
// in place; anything URL-shaped takes the read-only fetch leg.
export function isRemoteSource(repo) {
  if (typeof repo !== "string" || repo.length === 0) return false;
  return /^(https?|git|ssh):\/\//i.test(repo) || /^[\w.-]+@[\w.-]+:/.test(repo);
}

// True when `repo` is an existing local directory — the offline `@executable`
// lane: read in place, no network, no spawn.
export function isLocalSource(repo) {
  try {
    return typeof repo === "string" && existsSync(repo) && statSync(repo).isDirectory();
  } catch {
    return false;
  }
}

// Injection-only resolution — the offline seam mirroring resolveInjectedSha. An
// explicit `options.sourceDir`, an `options.resolveSource` callback, or the
// AOF_IMPORT_SOURCE env var short-circuit any network and name the directory to
// read in place. Returns null when none is supplied, so the caller decides whether
// the live (remote) path may run (it must NOT on a --dry-run, like planning-init).
export function resolveInjectedSource(options = {}) {
  if (typeof options.sourceDir === "string" && options.sourceDir.length > 0) return options.sourceDir;
  if (typeof options.resolveSource === "function") return options.resolveSource();
  if (typeof process.env.AOF_IMPORT_SOURCE === "string" && process.env.AOF_IMPORT_SOURCE.length > 0) {
    return process.env.AOF_IMPORT_SOURCE;
  }
  return null;
}

// Resolve the read-only directory to recover from (ADR-002).
//   { repo, dryRun, resolveSource?, sourceDir? } → { sourceDir, remote, dryRun }
//
// Resolution order (offline-first, the @executable lane):
//   1. an INJECTED source (resolveInjectedSource) — the offline test seam;
//   2. a LOCAL existing directory `<repo>` — read in place, NO network;
//   3. a REMOTE URL — the read-only `git ls-remote` leg (the @manual lane), which
//      a --dry-run NEVER reaches (a dry-run spawns/networks nothing — ADR-002).
//
// FORBIDDEN: any git write verb against `<repo>`; any clone INTO `<repo>`; any
// shell-string spawn. The only external form is the read-only `git ls-remote`
// argv (mirroring planning-init's network boundary).
export function resolveImportSource({ repo, dryRun = false, resolveSource, sourceDir } = {}) {
  const injected = resolveInjectedSource({ resolveSource, sourceDir });
  if (injected !== null) {
    return { sourceDir: injected, remote: false, dryRun };
  }

  if (isLocalSource(repo)) {
    return { sourceDir: repo, remote: false, dryRun };
  }

  // Remote: the read-only fetch leg (the @manual lane). On a --dry-run we resolve
  // NOTHING over the network (ADR-002) — the preview reports the remote without
  // touching it. A real remote run probes read-only via `git ls-remote` (argv, no
  // shell string), proving reachability without ever writing back to the source.
  if (isRemoteSource(repo)) {
    if (dryRun) {
      return { sourceDir: null, remote: true, dryRun };
    }
    // NO shell: `repo` is USER-CONTROLLED, and `isRemoteSource` permits arbitrary
    // characters after `://` (and in the scp form). With `shell:true` on Windows
    // spawnSync would JOIN argv into a cmd.exe command line, so shell metacharacters
    // in `repo` (e.g. `https://x/" & calc & "`) would be INTERPRETED — a command-
    // injection vector. Omitting `shell` keeps argv un-joined, so a user-supplied
    // URL can never reach a shell. Mirrors recovery.mjs's shell-less `git log` spawn
    // (story 01 proved a shell-less `git` argv resolves on Windows in CI).
    const result = spawnSync("git", ["ls-remote", repo], { encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(`Could not reach the remote source "${repo}" via read-only git ls-remote.`);
    }
    // NOTE (story 01 seam): the read-only fetch of the remote's milestone tree
    // into a SCRATCH dir (never a clone-into-source) lands here. The spine proves
    // the read-only boundary (ls-remote); story 01 fills the scratch-fetch +
    // recovery over the fetched tree. Until then a remote real-run is @manual.
    return { sourceDir: null, remote: true, dryRun };
  }

  throw new Error(`Source repo "${repo ?? ""}" is neither an existing local directory nor a reachable remote URL.`);
}
