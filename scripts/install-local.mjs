#!/usr/bin/env node
// scripts/install-local.mjs — install the CURRENT working tree into the per-user
// install dir ($HOME/.aof/bin), so the `aof` on your PATH (and, optionally, the
// desktop app) run the code you just changed.
//
// TECH_DEBT item 1 — the DEFAULT install is now a PAYLOAD install: the real
// src/ tree + runtime node_modules + asset sidecars are copied beside the exe
// and the SEA launcher (scripts/sea-entry.mjs) loads the CLI from disk. A
// source change deploys as a file copy + daemon restart — the 88 MB SEA rebuild
// happens ONLY when the launcher binary itself must change (--sea; automatic
// when no exe is installed yet) or when the Rust desktop app changes (--desktop).
//
//   node scripts/install-local.mjs [--sea] [--desktop] [--wsl [distro]] [--skip-ui] [--dry-run] [--install-dir <dir>]
//
//   (default)       payload install: sync src/, node_modules (prod closure),
//                   bundle/, ui/dist, package.json + write BUILD_ID.json
//   --sea           ALSO rebuild the SEA launcher exe and place it (release
//                   artefact / bootstrap change; implied when the exe is absent)
//   --desktop       also cargo-build the Tauri desktop app and place
//                   aof-mesh-desktop.exe (Windows only — the app targets WebView2)
//   --wsl [distro]  ALSO sync this working tree into the WSL worker node's own clone
//                   (Windows only; default distro, override with a name). See the
//                   WSL target block below for why the distro needs a separate tree.
//   --wsl-dir       the distro-side repo dir (default ~/aof)
//   --skip-ui       reuse the existing ui/dist (skip the `ui:build` step)
//   --dry-run       print the plan; build/copy nothing
//   --install-dir   override the target dir (else AOF_GLOBAL_HOME/bin, else ~/.aof/bin)
//
// Running-exe safe: an existing binary is RENAMED to a timestamped .bak before
// the fresh one is copied (Windows lets you rename a running .exe, just not
// overwrite it). Old .bak binaries are PRUNED, keeping the newest KEEP_BAKS —
// measured 2026-07-26: 15 stale 88 MB backups (~1.3 GB) that nothing reclaimed.
//
// NOTE: node_modules/node-pty's .node can be LOCKED while a daemon runs. A
// locked entry is SKIPPED WITH A WARNING (the existing copy is kept) — stop the
// daemon and re-run if you need node-pty itself updated.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, copyFileSync, cpSync, rmSync, readdirSync, unlinkSync, writeFileSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { generateAssetManifest } from "./sea-asset-manifest.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEEP_BAKS = 3;

function parseArgs(argv) {
  const o = { sea: false, desktop: false, wsl: false, wslDistro: null, wslDir: null, skipUi: false, dryRun: false, installDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--sea") o.sea = true;
    else if (a === "--desktop") o.desktop = true;
    else if (a === "--wsl") {
      o.wsl = true;
      // An OPTIONAL distro name may follow (`--wsl Ubuntu-22.04`). A following token
      // that starts with "--" is the NEXT flag, not the distro — so a bare `--wsl`
      // targets the default distro without swallowing anything.
      const next = argv[i + 1];
      if (next != null && !next.startsWith("--")) o.wslDistro = argv[++i];
    }
    else if (a === "--wsl-dir") o.wslDir = argv[++i];
    else if (a === "--skip-ui") o.skipUi = true;
    else if (a === "--dry-run") o.dryRun = true;
    else if (a === "--install-dir") o.installDir = argv[++i];
    else { console.error(`Unknown argument: ${a}`); process.exit(1); }
  }
  return o;
}

// Mirrors mesh-desktop.mjs's resolveDesktopInstallDir so the SEA and the desktop
// app always land in the SAME per-user dir (the m28/ADR-006 join point).
function resolveInstallDir(o) {
  if (o.installDir) return path.resolve(o.installDir);
  if (process.env.AOF_GLOBAL_HOME) return path.join(path.resolve(process.env.AOF_GLOBAL_HOME), "bin");
  return path.join(os.homedir(), ".aof", "bin");
}

function run(label, cmd, args) {
  console.log(`\n=== ${label} ===\n$ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: repoRoot, stdio: "inherit" });
}

// Filename-safe local timestamp for the .bak suffix (e.g. 20260724T110455).
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}T${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// Rename an existing target to <name>.bak.<ts> (never delete — a running .exe can
// be renamed but not overwritten on Windows), then place the fresh build.
function backupThenPlace(builtPath, targetPath) {
  if (existsSync(targetPath)) {
    const bak = `${targetPath}.bak.${stamp()}`;
    renameSync(targetPath, bak);
    console.log(`  backed up ${path.basename(targetPath)} -> ${path.basename(bak)}`);
  }
  copyFileSync(builtPath, targetPath);
  console.log(`  placed ${path.basename(targetPath)}`);
}

// Prune <exeName>.bak.<ts> files beyond the newest KEEP_BAKS (TECH_DEBT item 1's
// disk-cost leg). The timestamped suffix sorts lexicographically = chronologically.
// A .bak still held by a RUNNING process cannot be unlinked on Windows — skipped
// with a warning, reclaimed on a later install once that process exits.
function pruneBaks(installDir, exeName) {
  const prefix = `${exeName}.bak.`;
  const baks = readdirSync(installDir).filter((f) => f.startsWith(prefix)).sort();
  const stale = baks.slice(0, Math.max(0, baks.length - KEEP_BAKS));
  for (const f of stale) {
    try {
      unlinkSync(path.join(installDir, f));
      console.log(`  pruned ${f}`);
    } catch (error) {
      console.log(`  (kept ${f} — ${error.code ?? "locked"}; likely still executing, reclaimed next install)`);
    }
  }
}

// The build id: <git short sha>[+dirty].<timestamp> — written to BUILD_ID.json
// beside the exe so build-info.mjs / --version / daemon startup lines can say
// which install a process runs (TECH_DEBT item 1's "the build is honest").
function computeBuildId() {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim().length > 0;
    return `${sha}${dirty ? "+dirty" : ""}.${stamp()}`;
  } catch (error) {
    console.log(`  (git unavailable for the build id — ${error.message.split("\n")[0]}; stamping timestamp only)`);
    return `unversioned.${stamp()}`;
  }
}

// The production dependency closure (package names -> node_modules paths) via
// npm's own resolver — the payload's src/ imports bare specifiers (ws,
// @inquirer/prompts, node-pty) that must resolve beside the exe. Falls back to
// the full node_modules tree if npm ls fails (correct, just bigger).
function prodDependencyDirs() {
  try {
    // --workspaces=false: the ROOT project's prod closure only — without it npm
    // includes the ui workspace's (hoisted) dependency tree, ballooning the
    // payload by ~200 MB of build-time-only frontend packages (measured 2026-07-26).
    // shell:true on Windows — npm is npm.cmd, and Node refuses a shell-less
    // .cmd spawn (the CVE-2024-27980 guard). Fixed-string args only, no
    // interpolation, so the shell adds no injection surface here.
    const out = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable", "--workspaces=false"], {
      cwd: repoRoot,
      encoding: "utf8",
      shell: process.platform === "win32",
      // npm ls exits non-zero on peer warnings while still printing the tree —
      // tolerate that by reading stdout regardless.
      stdio: ["ignore", "pipe", "ignore"],
    });
    const dirs = out.split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(`node_modules${path.sep}`))
      .filter((line) => !line.includes(`${path.sep}ui${path.sep}`));
    if (dirs.length === 0) throw new Error("npm ls returned no dependency paths");
    return { mode: "closure", dirs: [...new Set(dirs)] };
  } catch {
    return { mode: "full-tree", dirs: [path.join(repoRoot, "node_modules")] };
  }
}

// Copy one node_modules entry with lock tolerance: a running daemon holds
// node-pty's .node open — that entry is kept as-is with a warning, never a
// silent failure and never a fatal one.
function copyModuleDir(srcDir, destDir) {
  try {
    rmSync(destDir, { recursive: true, force: true });
    mkdirSync(path.dirname(destDir), { recursive: true });
    cpSync(srcDir, destDir, { recursive: true });
    return true;
  } catch (error) {
    if (/EBUSY|EPERM|locked|being used/i.test(String(error.message))) {
      console.log(`  (kept existing ${path.relative(repoRoot, srcDir)} — locked by a running process)`);
      return false;
    }
    throw error;
  }
}

// --- the payload install (the default, restart-not-rebuild path) -------------
function installPayload(installDir) {
  console.log(`\n=== payload install into ${installDir} ===`);
  mkdirSync(installDir, { recursive: true });

  // 1. src/ — the program itself, replaced wholesale so deleted source files
  // never linger as stale payload modules. Import holds no file locks after
  // load, so this is safe under a running daemon (it keeps its in-memory graph
  // until restart — which is the point: restart picks this up).
  const srcDest = path.join(installDir, "src");
  rmSync(srcDest, { recursive: true, force: true });
  cpSync(path.join(repoRoot, "src"), srcDest, { recursive: true });
  console.log("  synced src/");

  // 2. the asset sidecars, same layout the SEA build ships (asset-base.mjs's
  // packaged branch resolves these beside the exe in payload mode too).
  const manifest = generateAssetManifest(repoRoot);
  const bundleDest = path.join(installDir, "bundle");
  rmSync(bundleDest, { recursive: true, force: true });
  for (const rel of manifest.bundle) {
    const dest = path.join(bundleDest, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(repoRoot, "src", "bundle", rel), dest);
  }
  console.log(`  synced bundle/ (${manifest.bundle.length} files)`);
  const uiDest = path.join(installDir, "ui", "dist");
  rmSync(uiDest, { recursive: true, force: true });
  for (const rel of manifest.ui) {
    const dest = path.join(uiDest, rel);
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(path.join(repoRoot, "ui", "dist", rel), dest);
  }
  console.log(`  synced ui/dist (${manifest.ui.length} files)`);

  // 3. node_modules — the prod closure, entry-by-entry with lock tolerance.
  // Stale entries from a prior (over-inclusive) install are removed first, so
  // the payload's dependency set is exactly the current closure — a locked
  // entry (node-pty under a running daemon) is kept with a warning, as below.
  const nmDest = path.join(installDir, "node_modules");
  if (existsSync(nmDest)) {
    for (const entry of readdirSync(nmDest)) {
      try {
        rmSync(path.join(nmDest, entry), { recursive: true, force: true });
      } catch (error) {
        console.log(`  (kept node_modules/${entry} — ${error.code ?? "locked"} by a running process)`);
      }
    }
  }
  const deps = prodDependencyDirs();
  if (deps.mode === "full-tree") {
    console.log("  (npm ls unavailable — copying the full node_modules tree)");
    copyModuleDir(deps.dirs[0], path.join(installDir, "node_modules"));
    console.log("  synced node_modules/ (full tree)");
  } else {
    const nmRoot = path.join(repoRoot, "node_modules");
    let copied = 0;
    for (const dir of deps.dirs) {
      const rel = path.relative(nmRoot, dir);
      if (rel.startsWith("..")) continue;
      if (copyModuleDir(dir, path.join(installDir, "node_modules", rel))) copied += 1;
    }
    console.log(`  synced node_modules/ (${copied}/${deps.dirs.length} prod-closure entries)`);
  }

  // 4. the trimmed manifest + the build stamp.
  const pkg = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  writeFileSync(path.join(installDir, "package.json"), JSON.stringify({ version: pkg.version }, null, 2), "utf8");
  const buildId = computeBuildId();
  writeFileSync(
    path.join(installDir, "BUILD_ID.json"),
    JSON.stringify({ buildId, installedAt: new Date().toISOString(), sourceRepo: repoRoot }, null, 2),
    "utf8",
  );
  console.log(`  stamped BUILD_ID.json (${buildId})`);
  return buildId;
}

// --------------------------------------------------- the WSL worker target ----
// A WSL2 distro is a FULL mesh node (own kernel, own IP, own filesystem, own aof
// identity), which makes it the cheapest possible second machine for testing the mesh.
// It cannot, however, run the Windows payload, and it cannot share this repo's tree:
//
//   - node-pty ships prebuilds for darwin-{arm64,x64} and win32-{arm64,x64} ONLY. There
//     is no linux-x64 prebuild, so the distro must COMPILE it (node-gyp) against its own
//     Node — this repo's node_modules holds a win32 binary the distro cannot load.
//   - Node resolves symlinks BEFORE looking for node_modules, so symlinking the distro's
//     src/ at this repo's src/ would make `import "ws"` resolve from THIS tree's
//     node_modules (win32) and fail. A copy is what keeps resolution on the native tree.
//
// So the distro keeps its OWN clone (npm-linked, `origin` = this repo), and this target
// pushes the WORKING tree into it — uncommitted work included, which is the whole point
// of a local test node and the one thing the Mac worker's `git pull` flow cannot do.
const WSL_DEFAULT_DIR = "~/source/aof";

// The deploy stamp: the sha256 of the package-lock.json that the distro's node_modules
// was last installed from. A src-only sync is fast and almost always right — but a
// DEPENDENCY change needs a native reinstall + node-pty rebuild, and silently skipping
// that leaves a stale native binary that fails at daemon start, far from the cause.
const WSL_DEPLOY_STAMP = ".aof-wsl-deploy";

// toWslPath("C:\\Source\\umair\\aof") → "/mnt/c/Source/umair/aof". Done HERE rather than
// by shelling out to `wslpath` because wsl.exe RE-SERIALISES its argument vector into a
// single command line — a multi-line script (or anything quote-heavy) passed as one argv
// element does not survive it. So the distro side is a real FILE (scripts/deploy-wsl.sh)
// invoked with three short, well-behaved arguments.
function toWslPath(winPath) {
  const m = /^([A-Za-z]):[\\/](.*)$/.exec(winPath);
  if (!m) return winPath.replace(/\\/g, "/");
  return `/mnt/${m[1].toLowerCase()}/${m[2].replace(/\\/g, "/")}`;
}

// Deploy this working tree into the WSL distro. Throws on failure so main()'s catch
// reports it like any other install fault.
function deployWsl(o) {
  const distro = o.wslDistro;
  const wslDir = o.wslDir ?? WSL_DEFAULT_DIR;
  const repoWsl = toWslPath(repoRoot);
  console.log(`\n=== sync the WSL worker node (${distro ?? "default distro"}:${wslDir}) ===`);
  const args = [];
  if (distro) args.push("-d", distro);
  args.push("--", "bash", `${repoWsl}/scripts/deploy-wsl.sh`, repoWsl, wslDir, WSL_DEPLOY_STAMP);
  execFileSync("wsl.exe", args, { stdio: "inherit" });
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const isWin = process.platform === "win32";
  const exeName = isWin ? "aof.exe" : "aof";
  const distSea = path.join(repoRoot, "dist-sea");
  const installDir = resolveInstallDir(o);
  const exeInstalled = existsSync(path.join(installDir, exeName));
  // No exe yet -> the launcher must be built once regardless (the payload needs
  // its bootstrap to be loaded by SOMETHING).
  const buildSea = o.sea || !exeInstalled;

  console.log("install-local");
  console.log(`  repo               : ${repoRoot}`);
  console.log(`  install dir        : ${installDir}`);
  console.log(`  ui:build           : ${o.skipUi ? "SKIP (reuse ui/dist)" : "yes"}`);
  console.log(`  payload            : yes (the default deploy — restart, not rebuild)`);
  console.log(`  SEA launcher exe   : ${buildSea ? (exeInstalled ? "yes (--sea)" : "yes (no exe installed yet)") : "no (unchanged; pass --sea to rebuild)"}`);
  console.log(`  desktop app        : ${o.desktop ? "yes" : "no"}`);
  console.log(`  WSL worker node    : ${o.wsl ? `yes (${o.wslDistro ?? "default distro"}:${o.wslDir ?? WSL_DEFAULT_DIR})` : "no"}`);
  console.log(`  dry-run            : ${o.dryRun}`);

  if (o.desktop && !isWin) {
    console.error("\n--desktop is Windows-only (the app targets WebView2 / aof-mesh-desktop.exe). Omit it on this OS.");
    process.exit(1);
  }
  if (o.wsl && !isWin) {
    console.error("\n--wsl is Windows-only (it drives wsl.exe against a local distro). Omit it on this OS.");
    process.exit(1);
  }

  if (o.dryRun) {
    console.log("\n[dry-run] would:");
    let n = 1;
    if (!o.skipUi) console.log(`  ${n++}. node scripts/ui-build.mjs`);
    console.log(`  ${n++}. payload install: sync src/, bundle/, ui/dist, node_modules (prod closure), package.json + BUILD_ID.json into ${installDir}`);
    if (buildSea) console.log(`  ${n++}. node scripts/build-sea.mjs -> dist-sea/, then rename ${exeName} -> ${exeName}.bak.<ts> + place the fresh ${exeName} (+ node-pty-sidecar)`);
    if (o.desktop) console.log(`  ${n++}. cargo build --release + place aof-mesh-desktop.exe`);
    if (o.wsl) console.log(`  ${n++}. sync src/ + package.json into ${o.wslDistro ?? "the default distro"}:${o.wslDir ?? WSL_DEFAULT_DIR}, reinstalling natively only if package-lock.json changed`);
    console.log(`  ${n}. prune ${exeName}.bak.* / aof-mesh-desktop.exe.bak.* beyond the newest ${KEEP_BAKS}`);
    return;
  }

  // --- 1. web UI (served from the installed ui/dist sidecar) ---
  if (o.skipUi) console.log("\n=== skipping ui:build (--skip-ui) ===");
  else run("build the web UI (ui/dist)", process.execPath, [path.join("scripts", "ui-build.mjs")]);

  // --- 2. the payload (always — this IS the deploy) ---
  installPayload(installDir);

  // --- 3. the SEA launcher exe (only when it must change) ---
  if (buildSea) {
    run("build the SEA launcher (dist-sea/)", process.execPath, [path.join("scripts", "build-sea.mjs")]);
    const builtExe = path.join(distSea, exeName);
    if (!existsSync(builtExe)) throw new Error(`build-sea did not produce ${builtExe}`);
    console.log(`\n=== install the launcher into ${installDir} ===`);
    backupThenPlace(builtExe, path.join(installDir, exeName));
    // The node-pty prebuild sidecar rides the SEA build (reference-OS artefact).
    const ptySidecar = path.join(distSea, "node-pty-sidecar");
    if (existsSync(ptySidecar)) {
      cpSync(ptySidecar, path.join(installDir, "node-pty-sidecar"), { recursive: true, force: true });
      console.log("  synced node-pty-sidecar/");
    }
  }

  // --- 4. desktop app (optional, Windows) ---
  if (o.desktop) {
    const manifest = path.join("app", "desktop", "crates", "app", "Cargo.toml");
    const targetDir = path.join(repoRoot, "app", "desktop", "crates", "app", "target");
    run("cargo build the desktop app (release)", "cargo",
      ["build", "--release", "--manifest-path", manifest, "--target-dir", targetDir]);
    const desktopBuilt = path.join(targetDir, "release", "mesh-desktop-app.exe");
    if (!existsSync(desktopBuilt)) throw new Error(`desktop build did not produce ${desktopBuilt}`);
    backupThenPlace(desktopBuilt, path.join(installDir, "aof-mesh-desktop.exe"));
  }

  // --- 4b. the WSL worker node (a SEPARATE machine that happens to share this box) ---
  if (o.wsl) deployWsl(o);

  // --- 5. reclaim stale .bak binaries (keep the newest KEEP_BAKS) ---
  console.log(`\n=== prune .bak binaries (keep ${KEEP_BAKS}) ===`);
  pruneBaks(installDir, exeName);
  pruneBaks(installDir, "aof-mesh-desktop.exe");

  console.log(`\nInstalled to ${installDir}`);
  console.log("Restart any running daemons (mesh serve --serve / mesh ui) and the desktop app to pick up the new payload.");
  console.log("(`aof --version` on the new build reports the runtime mode + build stamp.)");
}

try {
  main();
} catch (e) {
  console.error(`\ninstall-local failed: ${e.message}`);
  if (/EBUSY|EPERM|resource busy|being used|locked/i.test(String(e.message))) {
    console.error("A target file is locked — stop the running mesh daemon / desktop app, then re-run.");
  }
  process.exitCode = 1;
}
