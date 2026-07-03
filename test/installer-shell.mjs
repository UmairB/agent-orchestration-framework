// Shared shell/tool resolution for the milestone 28 / story 02 installer test
// files (installer-detect / installer-verify / installer-place).
//
// PORTABILITY FIX (coordinator directive, 2026-07-03): a bare `bash`/`sh` spawn
// is PATH-order-dependent. From a plain PowerShell prompt on this box, `bash`
// can resolve to the WSL launcher at C:\Windows\System32\bash.exe (or the
// Microsoft Store WSL shim under ...\WindowsApps\bash.exe) instead of Git
// Bash's real POSIX bash.exe -- the WSL launcher either fails to translate the
// Windows path (`No such file or directory`) or drops straight into a WSL
// distro shell with none of our fixture tooling (gpg absent -> GPG rows
// silently "pass" as skips). `sh` frequently does not resolve on PATH at all
// on a stock Windows box. Resolving explicitly, once, here removes the
// PATH-order dependency for every installer test file.
//
// Resolution order (Windows):
//   1. `git --exec-path` -> walk up to the Git installation root (the exec
//      path is typically <root>/mingw64/libexec/git-core) -> try
//      <root>/bin/bash.exe then <root>/usr/bin/bash.exe.
//   2. The conventional install location: %ProgramFiles%\Git\bin\bash.exe
//      (falling back to ...\Git\usr\bin\bash.exe).
//   3. Scan PATH for a `bash.exe` candidate, REJECTING any match under
//      \Windows\System32 or \...\WindowsApps\ (the WSL launchers) -- so even
//      an unconventional Git-for-Windows install location is found without
//      ever accepting a WSL shim.
// `sh`/`gpg` resolve the same way, relative to the SAME discovered Git root
// (Git Bash ships all three under usr/bin).
//
// On non-Windows, plain `bash`/`gpg` are already correct (no WSL-launcher
// ambiguity) -- resolution is a no-op passthrough.
//
// LOUD FAIL, never a silent skip: if no usable Git Bash is found on Windows,
// resolvePosixShell()/resolveGpg() throw with one clear message. A test file
// that cannot even resolve a shell fails LOUDLY (this mirrors the installer
// scripts' own "probe sha256sum/gpg availability and fail loudly" philosophy)
// rather than quietly reporting a false green.

import { existsSync as realExistsSync } from "node:fs";
import path from "node:path";
import { execFileSync as realExecFileSync } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";

// A path counts as a WSL launcher (never acceptable) if it sits under either
// of these Windows-owned directories, regardless of casing.
function isWslLauncherPath(candidate) {
  const normalized = candidate.toLowerCase().replace(/\//g, "\\");
  return normalized.includes("\\windows\\system32\\") || normalized.includes("\\windowsapps\\");
}

// The resolution strategies below take `io` (an { existsSync, execFileSync,
// env } bundle) as an explicit parameter, defaulting to the REAL node:fs /
// node:child_process / process.env. This lets a test exercise the pure
// resolution logic -- including the genuine "nothing found anywhere" loud-fail
// branch -- against a fully fabricated filesystem/env view, without touching
// this machine's real Git install (which, on every box this ships to, DOES
// exist, so the true absence path can only be proven honestly via injection).

function tryGitRootFromExecPath(io) {
  try {
    const execPath = io.execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim();
    if (!execPath) return null;
    // execPath is typically <gitRoot>/mingw64/libexec/git-core (or
    // /libexec/git-core on some layouts) -- walk up until we hit a directory
    // that actually holds bin/ or usr/bin/, capped so we never walk past the
    // drive root on a malformed path.
    let dir = execPath;
    for (let i = 0; i < 6; i++) {
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
      if (io.existsSync(path.join(dir, "bin", "bash.exe")) || io.existsSync(path.join(dir, "usr", "bin", "bash.exe"))) {
        return dir;
      }
    }
  } catch {
    // git not on PATH, or --exec-path unsupported -- fall through to the
    // next resolution strategy.
  }
  return null;
}

function tryConventionalGitRoot(io) {
  const programFilesCandidates = [io.env.ProgramFiles, io.env["ProgramFiles(x86)"], "C:\\Program Files", "C:\\Program Files (x86)"].filter(Boolean);
  for (const base of programFilesCandidates) {
    const root = path.join(base, "Git");
    if (io.existsSync(path.join(root, "bin", "bash.exe")) || io.existsSync(path.join(root, "usr", "bin", "bash.exe"))) {
      return root;
    }
  }
  return null;
}

function tryPathScan(io, exeName) {
  const entries = (io.env.PATH ?? io.env.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of entries) {
    const candidate = path.join(dir, exeName);
    if (isWslLauncherPath(candidate)) continue; // never accept a WSL launcher
    if (io.existsSync(candidate)) {
      // Confirm this is a real Git-for-Windows root (has usr/bin/gpg.exe or
      // a mingw64 tree) rather than some unrelated bash.exe -- best-effort;
      // accept it regardless since we've already excluded the WSL paths.
      return path.dirname(candidate);
    }
  }
  return null;
}

// resolveGitRoot(io) — the PURE resolution decision (given an io bundle),
// exported for direct unit-testing of the loud-fail branch.
export function resolveGitRoot(io) {
  return tryGitRootFromExecPath(io) ?? tryConventionalGitRoot(io) ?? (() => {
    const scanned = tryPathScan(io, "bash.exe");
    if (!scanned) return null;
    // scanned is the directory bash.exe lives in (either <root>\bin or
    // <root>\usr\bin) -- normalize to the Git root itself.
    const base = path.basename(scanned).toLowerCase();
    if (base === "bin") {
      const parent = path.dirname(scanned);
      return path.basename(parent).toLowerCase() === "usr" ? path.dirname(parent) : parent;
    }
    return scanned;
  })();
}

function exeUnder(io, root, exeName) {
  const binPath = path.join(root, "bin", exeName);
  if (io.existsSync(binPath)) return binPath;
  const usrBinPath = path.join(root, "usr", "bin", exeName);
  if (io.existsSync(usrBinPath)) return usrBinPath;
  return null;
}

const REAL_IO = { existsSync: realExistsSync, execFileSync: realExecFileSync, env: process.env };

let cachedGitRoot;
let cachedGitRootAttempted = false;

function getGitRoot(io) {
  if (io !== REAL_IO) {
    // An injected io bundle (tests) always resolves fresh -- no cross-test
    // cache pollution.
    return resolveGitRoot(io);
  }
  if (!cachedGitRootAttempted) {
    cachedGitRootAttempted = true;
    cachedGitRoot = resolveGitRoot(io);
  }
  return cachedGitRoot;
}

// resolvePosixShell(io?) -> { bash: <path>, sh: <path> }
// Throws ONE clear, loud error if no usable Git Bash can be found on
// Windows -- never a silent fallback to a WSL launcher, never a quiet skip.
// `io` is test-only injection (defaults to the real fs/child_process/env).
export function resolvePosixShell(io = REAL_IO) {
  if (!IS_WINDOWS) {
    return { bash: "bash", sh: "sh" };
  }
  const root = getGitRoot(io);
  if (!root) {
    throw new Error(
      "installer tests: could not locate a real Git-for-Windows bash.exe (checked `git --exec-path`, " +
        "%ProgramFiles%\\Git, and a WSL-launcher-excluding PATH scan). A bare `bash`/`sh` spawn on this box can " +
        "silently resolve to the WSL launcher (C:\\Windows\\System32\\bash.exe) instead -- refusing to fall back " +
        "to that. Install Git for Windows (which ships its own POSIX bash/sh/gpg under usr\\bin) to run these tests."
    );
  }
  const bash = exeUnder(io, root, "bash.exe");
  const sh = exeUnder(io, root, "sh.exe") ?? bash; // Git Bash's sh.exe is a copy of bash in POSIX mode
  if (!bash) {
    throw new Error(`installer tests: located a Git root at ${root} but no bash.exe under bin\\ or usr\\bin\\ -- refusing to guess.`);
  }
  return { bash, sh };
}

// resolveGpg(io?) -> path to a real gpg.exe (Git Bash ships one under usr/bin),
// or null if genuinely absent (mac/Linux CI images without gpg -- the
// installer's own probe/loud-fail rows cover that case; this resolver's job
// is only to avoid the WSL-shim trap, not to require gpg exist everywhere).
export function resolveGpg(io = REAL_IO) {
  if (!IS_WINDOWS) {
    return "gpg";
  }
  const root = getGitRoot(io);
  if (root) {
    const gpg = exeUnder(io, root, "gpg.exe");
    if (gpg) return gpg;
  }
  // Fall back to a WSL-launcher-excluding PATH scan for a standalone GPG4Win
  // install (Git Bash's own gpg is preferred when both exist).
  const entries = (io.env.PATH ?? io.env.Path ?? "").split(path.delimiter).filter(Boolean);
  for (const dir of entries) {
    const candidate = path.join(dir, "gpg.exe");
    if (isWslLauncherPath(candidate)) continue;
    if (io.existsSync(candidate)) return candidate;
  }
  return null;
}

// A shell-quoted form safe to splice into a script string passed to `-c`,
// for the resolved shell/gpg executable paths themselves (they may contain
// spaces, e.g. "C:\Program Files\Git\bin\bash.exe" used as an argv[0] is fine
// since spawnSync takes it as a discrete argument -- but the PATH we hand to
// `aof_require_tool`'s probe/refuse tests must NOT accidentally make gpg
// resolvable when the test wants it absent, so callers pass an explicit empty
// PATH override for the absence rows rather than relying on this module).
export function toPosixPath(windowsPath) {
  return windowsPath.replace(/\\/g, "/");
}

// toGitBashPosixPath: the TRUE POSIX form Git Bash's own coreutils expect
// (`/c/Users/...`), not just forward-slashed drive-letter form (`C:/Users/...`).
// LOAD-BEARING for `tar`: GNU tar treats any argument containing a bare
// "<letter>:" as remote-archive syntax ("user@host:path") REGARDLESS of slash
// direction -- `tar -czf "C:/foo/archive.tgz" ...` fails with "Cannot connect
// to C: resolve failed" even though `cp`/`rm`/most other Git Bash coreutils
// tolerate the "C:/..." form fine. Real production usage of install.sh never
// hits this (workdir/install_dir are always POSIX-native: `mktemp -d`,
// `$HOME/.aof/bin`) -- this conversion exists for tests, which build fixture
// paths via node:path (Windows-style) and must hand tar a path it accepts.
export function toGitBashPosixPath(windowsPath) {
  const forwardSlashed = windowsPath.replace(/\\/g, "/");
  const driveMatch = forwardSlashed.match(/^([A-Za-z]):\/(.*)$/);
  if (!driveMatch) return forwardSlashed;
  return `/${driveMatch[1].toLowerCase()}/${driveMatch[2]}`;
}
