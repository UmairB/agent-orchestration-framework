#!/usr/bin/env node
// milestone 28 / story 01 (ADR-001/ADR-002/ADR-006, task 00_ci-build-matrix.feature) —
// renames/stages Story 00's build-sea.mjs output into the PINNED release-asset
// + sidecar names Story 02's installer detects (byte-exact soft contract —
// see this story's STORY.md "Build notes" + install.sh/install.ps1 as-built):
//
//   binaries : aof-macos-arm64, aof-macos-x64, aof-linux-x64, aof-linux-arm64,
//              aof-windows-x64.exe, aof-windows-arm64.exe
//   sidecars : node-pty-darwin-arm64, node-pty-darwin-x64, node-pty-linux-x64,
//              node-pty-linux-arm64, node-pty-win32-x64, node-pty-win32-arm64
//
// PO PIN (2026-07-03, resolving the developer-flagged sidecar shape gap):
// Story 00's build-sea.mjs sidecar output is a DIRECTORY tree
// (<outDir>/node-pty-sidecar/** + <outDir>/node_modules/node-pty/**, the
// whole installed package plus companions) placed BESIDE the exe. The
// sidecar release asset is an ARCHIVE under the exact extensionless
// feature-pinned name (node-pty-<node-pty-platform>-<arch> — NO .tar.gz/.zip
// suffix) whose ROOT ENTRIES reproduce EXACTLY that same two-directory
// layout (node-pty-sidecar/** + node_modules/node-pty/**), so that Story
// 02's installer extracting the archive straight into the install dir next
// to the placed binary reproduces build-sea.mjs's own beside-the-exe shape —
// sufficient for createRequire(process.execPath)("node-pty") (ADR-002).
// Content is a gzip'd tar on darwin/linux legs, a zip on win32 legs (both
// built to reproduce the SAME root-entry set — verified by the
// archive-round-trip test, test/release-sidecar-archive-roundtrip.test.mjs).
// Story 02's installers unpack the verified archive into $HOME/.aof/bin
// AFTER verify, BEFORE PATH — the checksum in SHA256SUMS stays on the
// archive FILE itself, one line per archive (unchanged from before this pin).
//
//   node scripts/release/stage-release-assets.mjs --sea-out <dist-sea dir> --stage-dir <staging dir> --os <macos|linux|windows> --arch <arm64|x64>
import { existsSync, mkdirSync, copyFileSync, rmSync, cpSync, renameSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ASSET_NAMES = {
  "macos-arm64": "aof-macos-arm64",
  "macos-x64": "aof-macos-x64",
  "linux-x64": "aof-linux-x64",
  "linux-arm64": "aof-linux-arm64",
  "windows-x64": "aof-windows-x64.exe",
  "windows-arm64": "aof-windows-arm64.exe",
};

// Sidecar naming maps CI "os" (macos/linux/windows) to node-pty's own
// platform token (darwin/linux/win32) — install.sh/.ps1 pin `node-pty-<os>-<arch>`
// using node-pty's OWN platform naming (darwin/linux/win32), not the CI leg's
// "macos"/"windows" label. Confirmed against install.sh's aof_detect (Darwin ->
// node-pty-darwin-*, Linux -> node-pty-linux-*) and install.ps1's
// Resolve-AofAsset (win32-*).
export const NODE_PTY_PLATFORM = { macos: "darwin", linux: "linux", windows: "win32" };

// toPosixTarPath — GNU tar (the Git-Bash build) interprets a bare "C:\..."
// path as remote-shell host:path syntax ("Cannot connect to C: resolve
// failed"), not a drive letter — it needs a POSIX-shaped path for -C / the
// archive destination. bsdtar (Windows' own System32\tar.exe, libarchive-
// based) is the OPPOSITE: it takes native Windows paths directly and cannot
// open a "/c/..." path ("Failed to open '/c/Users/...'"). The real CI
// runners (macOS/Linux) are natively POSIX either way, so this conversion is
// a no-op there; only a Windows-drive-letter path is converted, everything
// else passes through unchanged.
function toPosixTarPath(p) {
  if (!/^[A-Za-z]:\\/.test(p)) return p;
  return "/" + p[0].toLowerCase() + p.slice(2).split("\\").join("/");
}

// detectTarFlavor() -> "gnu" | "bsd" | "posix" (detected ONCE, cached).
//
// Which `tar` binary a bare `tar` invocation resolves to is PARENT-SHELL-
// DEPENDENT on Windows: from a Git Bash parent, PATH typically favours
// Git's own usr/bin (GNU tar, needs "/c/..." POSIX paths); from a
// PowerShell/cmd parent, PATH can instead resolve the bundled
// C:\Windows\System32\tar.exe (bsdtar/libarchive, needs NATIVE "C:\..."
// paths — it cannot open a "/c/..." path at all). This is NOT a fixed
// per-OS fact — it is whatever `tar --version` reports on THIS invocation,
// so it is detected at runtime rather than assumed from process.platform.
// On real POSIX CI runners (macOS/Linux) this always resolves "posix" and
// toPosixTarPath's conversion is already a no-op there regardless.
let cachedTarFlavor;
function detectTarFlavor() {
  if (cachedTarFlavor) return cachedTarFlavor;
  if (process.platform !== "win32") {
    cachedTarFlavor = "posix";
    return cachedTarFlavor;
  }
  let versionOut = "";
  try {
    versionOut = execFileSync("tar", ["--version"], { encoding: "utf8" });
  } catch {
    // Some bsdtar builds don't support --version cleanly on every code path;
    // fall through to the byte-content check below on whatever was captured
    // (execFileSync throws only on a NON-ZERO exit, not on stdout content).
  }
  if (/bsdtar/i.test(versionOut)) {
    cachedTarFlavor = "bsd";
  } else if (/GNU tar/i.test(versionOut)) {
    cachedTarFlavor = "gnu";
  } else {
    // Unknown/unparseable output — default to GNU (the historically-assumed
    // shape on this repo's dev box) rather than silently guessing bsd, but
    // log loudly so a genuinely novel tar build is visible, not silently misrouted.
    console.warn(`stage-release-assets.mjs: could not identify the tar flavor from 'tar --version' output (${JSON.stringify(versionOut)}) — defaulting to GNU-tar path handling.`);
    cachedTarFlavor = "gnu";
  }
  return cachedTarFlavor;
}

// tarPath(p) -> the path SHAPE the DETECTED tar flavor on THIS invocation
// actually needs: POSIX-converted for GNU tar (Git Bash), native Windows for
// bsdtar (System32), unchanged on real POSIX runners. Exported so tests that
// drive a REAL tar against this script's output shape their paths through the
// SAME detection (the single-source-of-truth anti-drift principle).
export function tarPath(p) {
  return detectTarFlavor() === "bsd" ? p : toPosixTarPath(p);
}

// sidecarArchiveName(ciOs, arch) -> the exact extensionless pinned sidecar
// name, e.g. sidecarArchiveName("macos", "arm64") -> "node-pty-darwin-arm64".
export function sidecarArchiveName(ciOs, arch) {
  const ptyPlatform = NODE_PTY_PLATFORM[ciOs];
  if (!ptyPlatform) {
    throw new Error(`sidecarArchiveName: unmapped CI os '${ciOs}'. Known: ${Object.keys(NODE_PTY_PLATFORM).join(", ")}`);
  }
  return `node-pty-${ptyPlatform}-${arch}`;
}

// packSidecarArchive(seaOutDir, destArchivePath, { isWindows })
//
// Packs build-sea.mjs's sidecar directory tree (<seaOutDir>/node-pty-sidecar/**
// + <seaOutDir>/node_modules/node-pty/**) into ONE archive at destArchivePath
// (no extension implied by this function — the caller names the file) whose
// ROOT ENTRIES are exactly "node-pty-sidecar/**" and "node_modules/node-pty/**"
// — i.e. extracting the archive at a directory reproduces build-sea.mjs's
// own beside-the-exe layout byte-for-byte in shape.
//
//   isWindows: true  -> a zip (Compress-Archive), built via a STAGING
//                       directory so the two root entries land correctly
//                       (Compress-Archive's glob+dir-path combination does
//                       NOT reproduce a two-top-level-directory archive
//                       directly — confirmed empirically; a staging copy is
//                       the reliable route).
//   isWindows: false -> a gzip'd tar (`tar -czf`, POSIX — macOS + Linux both
//                       carry a real tar) using `-C seaOutDir member member`,
//                       which naturally produces the correct two root entries.
export function packSidecarArchive(seaOutDir, destArchivePath, { isWindows } = {}) {
  const sidecarSrcDir = path.join(seaOutDir, "node-pty-sidecar");
  const moduleSrcDir = path.join(seaOutDir, "node_modules", "node-pty");
  if (!existsSync(sidecarSrcDir)) {
    throw new Error(`node-pty sidecar tree not found at ${sidecarSrcDir} — run Story 00's scripts/build-sea.mjs first.`);
  }
  if (!existsSync(moduleSrcDir)) {
    throw new Error(`node-pty module tree not found at ${moduleSrcDir} — run Story 00's scripts/build-sea.mjs first.`);
  }

  if (isWindows) {
    // Stage both root entries under one directory FIRST so Compress-Archive
    // sees exactly "node-pty-sidecar/" and "node_modules/node-pty/" as its
    // two top-level members (a direct -Path 'dir\*','otherDir' invocation
    // does NOT reproduce this — it flattens dir's children to archive-root
    // and uses otherDir's OWN last path segment as its top-level name,
    // losing the node_modules/ parent — confirmed empirically at build).
    const stagingDir = mkdtempSync(path.join(os.tmpdir(), "aof-sidecar-zip-"));
    try {
      cpSync(sidecarSrcDir, path.join(stagingDir, "node-pty-sidecar"), { recursive: true });
      mkdirSync(path.join(stagingDir, "node_modules"), { recursive: true });
      cpSync(moduleSrcDir, path.join(stagingDir, "node_modules", "node-pty"), { recursive: true });

      if (existsSync(destArchivePath)) rmSync(destArchivePath);
      // Compress-Archive SILENTLY appends ".zip" to a DestinationPath that
      // lacks one (confirmed empirically at build — an extensionless
      // -DestinationPath 'foo' actually writes 'foo.zip', never 'foo') —
      // incompatible with the PO's extensionless-pinned-name requirement.
      // Build to an explicit .zip-suffixed temp path, then rename to the
      // exact pinned (extensionless) destination.
      const zipTempPath = `${destArchivePath}.zip`;
      if (existsSync(zipTempPath)) rmSync(zipTempPath);
      execFileSync(
        "powershell",
        [
          "-NoProfile", "-NonInteractive", "-Command",
          `Compress-Archive -Path '${path.join(stagingDir, "*")}' -DestinationPath '${zipTempPath}' -Force`,
        ],
        { stdio: "inherit" }
      );
      renameSync(zipTempPath, destArchivePath);
    } finally {
      rmSync(stagingDir, { recursive: true, force: true });
    }
  } else {
    // tar naturally reproduces the two-root-entry shape from -C + two member
    // names. Both the -C directory and the archive destination are shaped
    // for WHICHEVER tar flavor bare `tar` resolves to on THIS invocation
    // (GNU tar needs POSIX "/c/..." paths; bsdtar needs native "C:\..."
    // paths — see detectTarFlavor/tarPath above); the member path is always
    // forward-slash-joined regardless of host OS (both flavors accept that
    // as a relative archive-internal path).
    execFileSync(
      "tar",
      ["-czf", tarPath(destArchivePath), "-C", tarPath(seaOutDir), "node-pty-sidecar", "node_modules/node-pty"],
      { stdio: "inherit" }
    );
  }
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    if (["--sea-out", "--stage-dir", "--os", "--arch"].includes(flag) && argv[i + 1]) {
      const key = flag.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      options[key] = argv[i + 1];
      i += 1;
    }
  }
  for (const required of ["seaOut", "stageDir", "os", "arch"]) {
    if (!options[required]) {
      throw new Error(`stage-release-assets.mjs requires --sea-out, --stage-dir, --os, --arch (missing ${required})`);
    }
  }
  return options;
}

function step(label, fn) {
  console.log(`\n=== ${label} ===`);
  const result = fn();
  console.log(`--- done: ${label} ---`);
  return result;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const legKey = `${options.os}-${options.arch}`;
  const assetName = ASSET_NAMES[legKey];
  if (!assetName) {
    throw new Error(`stage-release-assets.mjs: unmapped leg '${legKey}'. Known legs: ${Object.keys(ASSET_NAMES).join(", ")}`);
  }
  const sidecarName = sidecarArchiveName(options.os, options.arch);

  mkdirSync(options.stageDir, { recursive: true });

  // 1. the binary — build-sea.mjs names it "aof" (POSIX) / "aof.exe" (win32).
  step(`stage the binary as ${assetName} (the pinned asset name)`, () => {
    const exeName = options.os === "windows" ? "aof.exe" : "aof";
    const src = path.join(options.seaOut, exeName);
    if (!existsSync(src)) {
      throw new Error(`built binary not found at ${src} — run Story 00's scripts/build-sea.mjs first.`);
    }
    const dest = path.join(options.stageDir, assetName);
    copyFileSync(src, dest);
    console.log(`${src} -> ${dest}`);
  });

  // 2. the node-pty sidecar — pack build-sea.mjs's sidecar directory tree
  // into ONE archive whose root entries reproduce that tree exactly, named
  // exactly what install.sh/.ps1's post-verify unpack step expects (the PO
  // pin — extensionless, node-pty's own platform token).
  step(`pack the node-pty sidecar tree into the archive ${sidecarName} (root-entries-preserving, extensionless)`, () => {
    const destPath = path.join(options.stageDir, sidecarName);
    packSidecarArchive(options.seaOut, destPath, { isWindows: options.os === "windows" });
    console.log(`${path.join(options.seaOut, "node-pty-sidecar")} (+ node_modules/node-pty) -> ${destPath}`);
  });

  console.log(`\nStaged: ${path.join(options.stageDir, assetName)}, ${path.join(options.stageDir, sidecarName)}`);
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  main();
}
