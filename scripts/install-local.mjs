#!/usr/bin/env node
// scripts/install-local.mjs — build the CURRENT working tree and install it into
// the per-user install dir ($HOME/.aof/bin), so the `aof` on your PATH (and,
// optionally, the desktop app) run the code you just changed.
//
// This is the LOCAL-BUILD twin of install.ps1 / install.sh: those fetch a SIGNED
// RELEASE asset from the network; this one builds from source on the reference OS
// and places the SAME runtime file-set into the same dir. Reference-OS only — it
// builds for the OS it runs on, exactly like build-sea.mjs (no cross-compile), so
// run it once on each machine (Windows control node, macOS worker).
//
//   node scripts/install-local.mjs [--desktop] [--skip-ui] [--dry-run] [--install-dir <dir>]
//
//   --desktop       also cargo-build the Tauri desktop app and place
//                   aof-mesh-desktop.exe (Windows only — the app targets WebView2)
//   --skip-ui       reuse the existing ui/dist (skip the `ui:build` step)
//   --dry-run       print the plan; build/copy nothing
//   --install-dir   override the target dir (else AOF_GLOBAL_HOME/bin, else ~/.aof/bin)
//
// Running-exe safe: the existing binary is RENAMED to a timestamped .bak before
// the fresh one is copied (Windows lets you rename a running .exe, just not
// overwrite it) — the same discipline the *.pre-*.bak files already in
// ~/.aof/bin follow. It never DELETES the prior binary.
//
// NOTE: the SEA sidecar's node-pty .node can be LOCKED if a daemon is running the
// INSTALLED binary (not from source). If a copy fails with EBUSY/EPERM, stop the
// mesh daemon / desktop app and re-run — the message says so.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, renameSync, copyFileSync, cpSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs(argv) {
  const o = { desktop: false, skipUi: false, dryRun: false, installDir: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--desktop") o.desktop = true;
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
// be renamed but not overwritten on Windows), then return true if a backup was made.
function backupThenPlace(builtPath, targetPath) {
  if (existsSync(targetPath)) {
    const bak = `${targetPath}.bak.${stamp()}`;
    renameSync(targetPath, bak);
    console.log(`  backed up ${path.basename(targetPath)} -> ${path.basename(bak)}`);
  }
  copyFileSync(builtPath, targetPath);
  console.log(`  placed ${path.basename(targetPath)}`);
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const isWin = process.platform === "win32";
  const exeName = isWin ? "aof.exe" : "aof";
  const distSea = path.join(repoRoot, "dist-sea");
  const installDir = resolveInstallDir(o);

  // The runtime payload copied from dist-sea into the install dir. The build
  // INTERMEDIATES (aof-bundle.cjs, meta.json, sea-config.json, sea-prep.blob) are
  // deliberately NOT installed — only what the binary reads at runtime.
  const payloadDirs = ["bundle", "ui", "node-pty-sidecar", "node_modules"];
  const payloadFiles = ["package.json"];

  console.log("install-local");
  console.log(`  repo               : ${repoRoot}`);
  console.log(`  install dir        : ${installDir}`);
  console.log(`  ui:build           : ${o.skipUi ? "SKIP (reuse ui/dist)" : "yes"}`);
  console.log(`  desktop app        : ${o.desktop ? "yes" : "no"}`);
  console.log(`  dry-run            : ${o.dryRun}`);

  if (o.desktop && !isWin) {
    console.error("\n--desktop is Windows-only (the app targets WebView2 / aof-mesh-desktop.exe). Omit it on this OS.");
    process.exit(1);
  }

  if (o.dryRun) {
    console.log("\n[dry-run] would:");
    if (!o.skipUi) console.log("  1. node scripts/ui-build.mjs");
    console.log(`  ${o.skipUi ? "1" : "2"}. node scripts/build-sea.mjs  -> dist-sea/`);
    console.log(`  ${o.skipUi ? "2" : "3"}. rename ${installDir}/${exeName} -> ${exeName}.bak.<ts>, then copy the fresh ${exeName}`);
    console.log(`     + sync [${[...payloadDirs, ...payloadFiles].join(", ")}] into ${installDir}`);
    if (o.desktop) {
      console.log("  4. cargo build --release --manifest-path app/desktop/crates/app/Cargo.toml");
      console.log(`     + place mesh-desktop-app.exe -> ${path.join(installDir, "aof-mesh-desktop.exe")}`);
    }
    return;
  }

  // --- 1. web UI (the SEA bundles ui/dist as a sidecar) ---
  if (o.skipUi) console.log("\n=== skipping ui:build (--skip-ui) ===");
  else run("build the web UI (ui/dist)", process.execPath, [path.join("scripts", "ui-build.mjs")]);

  // --- 2. the SEA (dist-sea/) ---
  run("build the SEA (dist-sea/)", process.execPath, [path.join("scripts", "build-sea.mjs")]);
  const builtExe = path.join(distSea, exeName);
  if (!existsSync(builtExe)) throw new Error(`build-sea did not produce ${builtExe}`);

  // --- 3. install into the per-user dir ---
  console.log(`\n=== install into ${installDir} ===`);
  mkdirSync(installDir, { recursive: true });
  backupThenPlace(builtExe, path.join(installDir, exeName));
  for (const d of payloadDirs) {
    const src = path.join(distSea, d);
    if (!existsSync(src)) { console.log(`  (skip ${d}/ — absent from dist-sea)`); continue; }
    cpSync(src, path.join(installDir, d), { recursive: true, force: true });
    console.log(`  synced ${d}/`);
  }
  for (const f of payloadFiles) {
    const src = path.join(distSea, f);
    if (existsSync(src)) { copyFileSync(src, path.join(installDir, f)); console.log(`  placed ${f}`); }
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

  console.log(`\nInstalled to ${installDir}`);
  console.log("Restart any running daemons (mesh serve --serve / mesh ui) and the desktop app to pick up the new build.");
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
