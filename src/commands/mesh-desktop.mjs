// `aof mesh desktop install` / `aof mesh desktop run` — install and launch the
// Tauri desktop supervisor alongside the m28 `aof` SEA binary (milestone 36 /
// story 03, ADR-003). Registered Commands since m42 wave (d) leg d1's wave-3
// tail: mesh:desktop-install / mesh:desktop-run ride THREE-WORD routes through
// the registry-derived route table + the ONE generic face (the
// mesh:repo-publish precedent — ADR-003's original "doesn't fit the
// single-positional meshVerbCli shape" rationale died with meshVerbCli). The
// core placement/discovery/launch logic stays here, unit-testable without
// spawning the CLI.
//
// Two verbs:
//   install(options) — places the desktop app executable(s) + the WebView2
//     Evergreen Bootstrapper (a placed file, ADR-001) into the install dir
//     (`$HOME/.aof/bin`, ADR-003 decision 3 — the SAME per-user dir the m28
//     installer places `aof` into). Idempotent (a re-install replaces in place,
//     never duplicates). A staged-then-swap write so a failure never leaves a
//     partial placement (mirrors the m28 install.sh/.ps1 stage-first discipline).
//   run(options) — discovers the installed app in the install dir by absolute
//     co-located path (no PATH search — the 00<->03 trusted-spawn contract) and
//     launches it DETACHED (spawn(..., { detached:true, stdio:"ignore" }).unref()
//     — the aof house detached-spawn idiom for a long-lived supervised app,
//     mirroring src/mesh-fabric.mjs's injected-exec-closure idiom for tests). The
//     CLI returns immediately; it never waits on the child.
//
// Every failure is a caught, coded, ONE-sentence refusal — never a stack trace
// (mirrors mesh-ui-serve.mjs's ui-build-missing / EADDRINUSE idiom): the errors
// this module throws always carry a `.code` a caller can render/--json without
// ever needing the stack.
import { access, constants as fsConstants, copyFile, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { guardMeshPositionals } from "./mesh-face-shared.mjs";

// The desktop app's placed file names (Windows-first, ADR-001 §Tauri). Kept as
// named constants so install/run agree on exactly what "the installed app" means.
export const DESKTOP_APP_EXE = "aof-mesh-desktop.exe";
export const WEBVIEW2_BOOTSTRAPPER = "MicrosoftEdgeWebview2Setup.exe";

// resolveDesktopInstallDir(options) -> the per-user install dir the app + the
// WebView2 bootstrapper land in, CO-LOCATED with the m28 `aof` binary
// ($HOME/.aof/bin, ADR-003 decision 3 / m28/ADR-006's join point). Injectable
// (options.installDir, else AOF_DESKTOP_INSTALL_DIR, else derived from
// options.env/AOF_GLOBAL_HOME/homedir) so a test drives a FIXTURE dir, never the
// real machine — mirrors paths.mjs's defaultGlobalWorkspaceDir env-override idiom.
export function resolveDesktopInstallDir(options = {}) {
  if (typeof options.installDir === "string" && options.installDir.length > 0) {
    return path.resolve(options.installDir);
  }
  const env = options.env ?? process.env;
  if (typeof env.AOF_DESKTOP_INSTALL_DIR === "string" && env.AOF_DESKTOP_INSTALL_DIR.length > 0) {
    return path.resolve(env.AOF_DESKTOP_INSTALL_DIR);
  }
  const home = env.AOF_GLOBAL_HOME ? path.resolve(env.AOF_GLOBAL_HOME) : path.join(os.homedir(), ".aof");
  return path.join(home, "bin");
}

// A calm coded refusal — the ONLY error shape this module throws. `code` is what
// the CLI face renders under --json ({ ok:false, error, code }); `message` is the
// one-sentence, actionable text (never a stack trace).
function refuse(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

async function pathExists(target) {
  try {
    await access(target, fsConstants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function isWritableDir(dir) {
  try {
    await mkdir(dir, { recursive: true });
  } catch {
    return false;
  }
  try {
    await access(dir, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

// The fixture/production app-artifact source resolver — mirrors the story's
// "a fixture desktop-app artifact to place" Background: production has no built
// Tauri bundle to reach for yet (the Rust subtree lands in stories 00-02), so
// callers (tests today, the real packaging step later) always supply explicit
// source paths; a caller that omits them gets the coded "artifact is missing"
// refusal, never a silent no-op.
function requireArtifactSource(value, code, message) {
  if (typeof value !== "string" || value.length === 0) {
    throw refuse(code, message);
  }
  return value;
}

// installDesktopApp({ installDir, env, appArtifactPath, bootstrapperArtifactPath,
// isWritableDirFn }) -> { ok:true, installDir, appPath, bootstrapperPath } |
// throws a coded refusal.
//
// Stages the new app exe + bootstrapper into a TEMP sibling dir first, verifies
// the install dir is writable, then moves the staged files into place — so a
// mid-install failure (dir goes unwritable, an artifact vanishes) never leaves a
// half-placed app (mirrors the m28 install.sh/.ps1 "stage first, swap on success"
// discipline the F5 fix hardened). Idempotent: re-running replaces the app exe +
// bootstrapper IN PLACE (same file names — no duplicate, no stale prior copy).
//
// `isWritableDirFn` is an INJECTED seam (mirrors mesh-fabric.mjs's injected exec
// closure) — defaults to the real filesystem writability probe; a test injects a
// fault (a function that returns false) to exercise the unwritable-dir refusal
// deterministically and cross-platform (POSIX chmod bits don't reliably lock a
// directory against its own owner on every OS/filesystem, notably Windows).
export async function installDesktopApp(options = {}) {
  const installDir = resolveDesktopInstallDir(options);
  const checkWritable = typeof options.isWritableDirFn === "function" ? options.isWritableDirFn : isWritableDir;
  const appArtifactPath = requireArtifactSource(
    options.appArtifactPath,
    "app-artifact-missing",
    "The packaged desktop app artifact is missing. Re-build or re-download the release bundle and try again.",
  );
  const bootstrapperArtifactPath = requireArtifactSource(
    options.bootstrapperArtifactPath,
    "bootstrapper-artifact-missing",
    "The WebView2 bootstrapper artifact is missing from the release bundle. Re-download the release bundle and try again.",
  );

  if (!(await pathExists(appArtifactPath))) {
    throw refuse(
      "app-artifact-missing",
      "The packaged desktop app artifact is missing. Re-build or re-download the release bundle and try again.",
    );
  }
  if (!(await pathExists(bootstrapperArtifactPath))) {
    throw refuse(
      "bootstrapper-artifact-missing",
      "The WebView2 bootstrapper artifact is missing from the release bundle. Re-download the release bundle and try again.",
    );
  }

  // Verify writability BEFORE touching anything under installDir (verify-before-
  // place, the m28 verify-before-PATH precedent) — a pre-existing unwritable dir
  // never gets a partial write attempted against it.
  if (!(await checkWritable(installDir))) {
    throw refuse(
      "install-dir-not-writable",
      `${installDir} is not writable. Fix write access to that folder (check permissions/ownership) and try again.`,
    );
  }

  const stageParent = path.join(os.tmpdir(), "aof-mesh-desktop-install-");
  const stageDir = await mkdtemp(stageParent);
  try {
    const stagedAppPath = path.join(stageDir, DESKTOP_APP_EXE);
    const stagedBootstrapperPath = path.join(stageDir, WEBVIEW2_BOOTSTRAPPER);
    try {
      await copyFile(appArtifactPath, stagedAppPath);
      await copyFile(bootstrapperArtifactPath, stagedBootstrapperPath);
    } catch (error) {
      // A read/copy fault mid-stage (e.g. the dir went unwritable between the
      // pre-check and now) is the SAME calm refusal — never a raw stack trace,
      // and nothing has been placed under installDir yet at this point.
      throw refuse(
        "install-dir-not-writable",
        `${installDir} is not writable. Fix write access to that folder (check permissions/ownership) and try again.`,
      );
    }

    // Re-check writability immediately before the swap (the window a "becomes
    // unwritable MID-install" fault lands in — task 01's dedicated no-partial-
    // placement scenario). Everything up to here only touched the TEMP stage
    // dir; nothing under installDir has been written yet, so failing here still
    // leaves installDir holding exactly its prior contents.
    if (!(await checkWritable(installDir))) {
      throw refuse(
        "install-dir-not-writable",
        `${installDir} is not writable. Fix write access to that folder (check permissions/ownership) and try again.`,
      );
    }

    const appPath = path.join(installDir, DESKTOP_APP_EXE);
    const bootstrapperPath = path.join(installDir, WEBVIEW2_BOOTSTRAPPER);
    try {
      await moveInPlace(stagedAppPath, appPath);
      await moveInPlace(stagedBootstrapperPath, bootstrapperPath);
    } catch (error) {
      throw refuse(
        "install-dir-not-writable",
        `${installDir} is not writable. Fix write access to that folder (check permissions/ownership) and try again.`,
      );
    }

    return { ok: true, installDir, appPath, bootstrapperPath };
  } finally {
    await rm(stageDir, { recursive: true, force: true });
  }
}

// moveInPlace(source, target) — rename (same-volume fast path) with a copy+rm
// fallback across-volume/EXDEV, so "replace in place" works whether the OS temp
// dir shares a volume with the install dir or not (a real cross-drive condition
// on a machine with multiple drives — the staged file must still land).
async function moveInPlace(source, target) {
  try {
    await rename(source, target);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    await copyFile(source, target);
    await rm(source, { force: true });
  }
}

// discoverDesktopApp(options) -> the ABSOLUTE co-located app path if a runnable
// install is present, else throws a coded "not-installed"/"not-runnable" refusal.
// No PATH search — resolution is by absolute path inside the install dir only
// (ADR-004 §4's trusted co-located resolution, the thin 00<->03 contract this
// story's placement makes true).
export async function discoverDesktopApp(options = {}) {
  const installDir = resolveDesktopInstallDir(options);
  const appPath = path.join(installDir, DESKTOP_APP_EXE);

  let stats;
  try {
    stats = await stat(appPath);
  } catch {
    throw refuse(
      "desktop-not-installed",
      "The desktop app is not installed. Run `aof mesh desktop install` first.",
    );
  }

  if (!stats.isFile()) {
    throw refuse(
      "desktop-not-runnable",
      "The installed desktop app is not runnable (it may be corrupt). Re-run `aof mesh desktop install` to repair it.",
    );
  }

  // Windows has no execute permission bit on the file mode the way POSIX does;
  // a present regular .exe file under the install dir IS the runnable signal
  // there. On POSIX (dev-machine / CI), also require an execute bit — a present
  // but non-executable file is the "corrupt install" refusal, never a crash on
  // spawn.
  if (process.platform !== "win32") {
    const executable = (stats.mode & 0o111) !== 0;
    if (!executable) {
      throw refuse(
        "desktop-not-runnable",
        "The installed desktop app is not runnable (it may be corrupt). Re-run `aof mesh desktop install` to repair it.",
      );
    }
  }

  return appPath;
}

// launchDesktopApp(options) -> { ok:true, pid, appPath } — discovers the installed
// app then launches it DETACHED (the aof house detached-spawn idiom): stdio
// ignored, unref()'d, so the CLI process can exit/resolve without waiting on the
// long-lived app. `options.spawnFn` is the injected seam (mirrors
// mesh-fabric.mjs's injected exec closure) — defaults to the real
// child_process.spawn; a test injects a fixture-executable spawn to assert the
// SHAPE (detached, argv, resolved absolute path) without starting a real window.
export async function launchDesktopApp(options = {}) {
  const appPath = await discoverDesktopApp(options);
  const spawnFn = typeof options.spawnFn === "function" ? options.spawnFn : spawn;

  const child = spawnFn(appPath, [], {
    detached: true,
    stdio: "ignore",
    windowsHide: false,
  });
  // Swallow an async spawn-level fault on the detached child (e.g. the file was
  // removed between discovery and spawn) so it never becomes an unhandled
  // rejection/crash in the parent CLI process — the launch already returned by
  // the time this could fire.
  if (child && typeof child.on === "function") {
    child.on("error", () => {});
  }
  if (child && typeof child.unref === "function") child.unref();

  return { ok: true, pid: child?.pid ?? null, appPath };
}

// ─────────────────────────────────────────────────────────────────────────────
// The registered Commands: `aof mesh desktop install` / `aof mesh desktop run`
// (m42 wave (d) leg d1, wave-3 tail — formerly the CLI-only meshDesktopCommand
// nested face, retired with its local parser/envelope). NOT launcher verbs:
// install copies files and returns; run spawns the app DETACHED and returns —
// so both are plain class A three-word routes (the mesh:repo-publish
// precedent), and their --json probes stay hermetic in the bijection gate (no
// installed app in an isolated AOF_GLOBAL_HOME ⇒ a coded refusal, never a real
// launch). The no-verb/unknown-verb SHIM stays in cli.mjs's meshCommand (the
// repo-shim precedent — refusals a route cannot express). The retired face's
// ctx seams survive on run(input, ctx): env / spawnFn / artifact paths are
// injectable by the white-box tests through invoke(), with the input flags
// taking precedence exactly as the face's options did.
// ─────────────────────────────────────────────────────────────────────────────

export const meshDesktopInstallCommand = {
  id: "mesh:desktop-install",
  input: {
    type: "object",
    properties: {
      installDir: { type: "string" },
      appArtifact: { type: "string" },
      bootstrapperArtifact: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input, ctx = {}) {
    // A coded refusal from the core (app-artifact-missing / install-dir-not-
    // writable) THROWS — the face's one envelope applies (--json: { ok:false,
    // error, code }; bare: stderr + exit 1, never a stack for these classes).
    return await installDesktopApp({
      installDir: input.installDir ?? ctx.installDir,
      env: ctx.env,
      appArtifactPath: input.appArtifact ?? ctx.appArtifactPath,
      bootstrapperArtifactPath: input.bootstrapperArtifact ?? ctx.bootstrapperArtifactPath,
    });
  },

  cli: {
    route: ["mesh", "desktop", "install"],
    spec: {
      usage: "aof mesh desktop install [--app-artifact <path>] [--bootstrapper-artifact <path>] [--install-dir <dir>] [--json]",
      workspace: false,
      flags: {
        appArtifact: { type: "string", description: "path to the packaged desktop app artifact" },
        bootstrapperArtifact: { type: "string", description: "path to the WebView2 bootstrapper artifact" },
        installDir: { type: "string", description: "override the per-user install dir" },
      },
    },

    argv: (positionals, options) => {
      guardMeshPositionals("desktop install", positionals);
      return {
        ...(options.installDir !== undefined ? { installDir: options.installDir } : {}),
        ...(options.appArtifact !== undefined ? { appArtifact: options.appArtifact } : {}),
        ...(options.bootstrapperArtifact !== undefined ? { bootstrapperArtifact: options.bootstrapperArtifact } : {}),
      };
    },

    render: (result) => `Installed the desktop app into ${result.installDir}.`,

    json: (result) => ({ ok: true, ...result }),
  },
};

export const meshDesktopRunCommand = {
  id: "mesh:desktop-run",
  input: {
    type: "object",
    properties: {
      installDir: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input, ctx = {}) {
    // Discovery refusals (desktop-not-installed / desktop-not-runnable) THROW —
    // the face envelopes them; a successful launch is DETACHED and this run
    // returns immediately (never a long-lived body — not a launcher-seam verb).
    return await launchDesktopApp({
      installDir: input.installDir ?? ctx.installDir,
      env: ctx.env,
      spawnFn: ctx.spawnFn,
    });
  },

  cli: {
    route: ["mesh", "desktop", "run"],
    spec: {
      usage: "aof mesh desktop run [--install-dir <dir>] [--json]",
      workspace: false,
      flags: {
        installDir: { type: "string", description: "override the per-user install dir" },
      },
    },

    argv: (positionals, options) => {
      guardMeshPositionals("desktop run", positionals);
      return {
        ...(options.installDir !== undefined ? { installDir: options.installDir } : {}),
      };
    },

    render: (result) => `Launched the desktop app (${result.appPath}).`,

    json: (result) => ({ ok: true, ...result }),
  },
};
