// Traceability wiring for milestone 28 / story 01 (signing-notarization),
// task 00_ci-build-matrix.feature — the PO pin (2026-07-03, STORY.md "Build
// notes" + STATE.md "Notes & decisions in flight") resolving the sidecar
// shape gap: the sidecar release asset is an ARCHIVE under the exact
// extensionless feature-pinned name (node-pty-<node-pty-platform>-<arch>)
// whose ROOT ENTRIES reproduce EXACTLY the directory layout
// scripts/build-sea.mjs emits beside the exe (node-pty-sidecar/** +
// node_modules/node-pty/**), so Story 02's installer can extract it straight
// into the install dir.
//
// This test drives the REAL scripts/release/stage-release-assets.mjs
// (packSidecarArchive) over a small FIXTURE sea-out layout, then extracts the
// produced archive with a REAL extractor (tar -xzf on darwin/linux content,
// Expand-Archive/unzip on win32 content) and asserts SET-EQUALITY of the file
// trees in BOTH directions — nothing in the source tree is missing from the
// extracted tree, and nothing extra appears.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync, statSync, existsSync, copyFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { packSidecarArchive, sidecarArchiveName, tarPath } from "../scripts/release/stage-release-assets.mjs";

const UNZIP_AVAILABLE = spawnSync("unzip", ["-v"], { encoding: "utf8" }).status === 0;
const TAR_AVAILABLE = spawnSync("tar", ["--version"], { encoding: "utf8" }).status === 0;
const POWERSHELL_AVAILABLE = spawnSync("powershell", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" }).status === 0;

// listFilesRecursive(dir) -> sorted POSIX-relative file list (files only,
// directories are implied by their files' paths — a set-equality over FILES
// is the load-bearing assertion; empty directories carry no runtime content).
function listFilesRecursive(dir) {
  const out = [];
  function recurse(current) {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      const st = statSync(full);
      if (st.isDirectory()) recurse(full);
      else if (st.isFile()) out.push(path.relative(dir, full).split(path.sep).join("/"));
    }
  }
  recurse(dir);
  return out.sort();
}

// makeFixtureSeaOut(dir) -> builds a SMALL fixture reproducing build-sea.mjs's
// beside-the-exe sidecar layout: <dir>/node-pty-sidecar/** (the direct
// prebuild files) + <dir>/node_modules/node-pty/** (the whole module tree
// incl. its OWN nested prebuilds/ dir) — mirrors scripts/build-sea.mjs's
// "copy the node-pty sidecar" step exactly in SHAPE (fixture content, real
// layout).
function makeFixtureSeaOut(dir) {
  const sidecarDir = path.join(dir, "node-pty-sidecar");
  mkdirSync(sidecarDir, { recursive: true });
  writeFileSync(path.join(sidecarDir, "pty.node"), "fixture-pty-node-bytes\n", "utf8");

  const moduleDir = path.join(dir, "node_modules", "node-pty");
  mkdirSync(path.join(moduleDir, "lib"), { recursive: true });
  mkdirSync(path.join(moduleDir, "prebuilds", "linux-x64"), { recursive: true });
  writeFileSync(path.join(moduleDir, "package.json"), JSON.stringify({ name: "node-pty", version: "1.1.0" }), "utf8");
  writeFileSync(path.join(moduleDir, "lib", "index.js"), "// fixture lib\nmodule.exports = {};\n", "utf8");
  writeFileSync(path.join(moduleDir, "prebuilds", "linux-x64", "pty.node"), "fixture-prebuild-bytes\n", "utf8");

  return { sidecarDir, moduleDir };
}

// Path shaping for the REAL tar this invocation resolves comes from the
// production script's own exported, flavor-detecting tarPath (GNU tar under a
// Git Bash parent needs "/c/..."; System32 bsdtar under a PowerShell parent
// needs native "C:\..."; a no-op on real POSIX runners) — the same
// single-source-of-truth principle as importing the real packSidecarArchive,
// so this helper can never drift from the packer's own tar handling.
function extractTarGz(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  execFileSync("tar", ["-xzf", tarPath(archivePath), "-C", tarPath(destDir)], { stdio: "inherit" });
}

function extractZip(archivePath, destDir) {
  mkdirSync(destDir, { recursive: true });
  // Prefer PowerShell's Expand-Archive — it is the REAL extractor Story 02's
  // install.ps1 uses on win32 legs, so this is representative of the actual
  // consumer, not just "an extractor". (Compress-Archive on this box also
  // writes backslash path separators into zip entries, which `unzip`
  // interprets as a WARNING but still surfaces as a non-zero exit code
  // despite extracting correctly — Expand-Archive has no such false-failure.)
  //
  // BUILD-TIME FINDING (confirmed empirically, not a test-harness quirk):
  // Expand-Archive determines the archive FORMAT from the source path's
  // EXTENSION, not its content — an extensionless path is rejected
  // ("is not a supported archive file format"). Since the PO pin is an
  // EXTENSIONLESS release-asset name, Story 02's install.ps1 (the real
  // consumer) will need the SAME copy-to-.zip-then-expand two-step this test
  // performs below — flagged in the developer report/STATE.md, not silently
  // hidden inside this test.
  if (POWERSHELL_AVAILABLE) {
    const zipShapedPath = `${archivePath}.zip`;
    copyFileSync(archivePath, zipShapedPath);
    try {
      execFileSync(
        "powershell",
        ["-NoProfile", "-NonInteractive", "-Command", `Expand-Archive -Path '${zipShapedPath}' -DestinationPath '${destDir}' -Force`],
        { stdio: "inherit" }
      );
    } finally {
      rmSync(zipShapedPath, { force: true });
    }
  } else if (UNZIP_AVAILABLE) {
    execFileSync("unzip", ["-o", archivePath, "-d", destDir], { stdio: "inherit" });
  } else {
    throw new Error("neither powershell nor unzip is available to extract the zip fixture");
  }
}

export const releaseSidecarArchiveRoundtripTests = [
  {
    name: "release-sidecar-archive-roundtrip/00 sidecarArchiveName() produces the exact extensionless PO-pinned names (node-pty's own platform tokens, no .tar.gz/.zip suffix)",
    run: async () => {
      assert.equal(sidecarArchiveName("macos", "arm64"), "node-pty-darwin-arm64");
      assert.equal(sidecarArchiveName("macos", "x64"), "node-pty-darwin-x64");
      assert.equal(sidecarArchiveName("linux", "x64"), "node-pty-linux-x64");
      assert.equal(sidecarArchiveName("linux", "arm64"), "node-pty-linux-arm64");
      assert.equal(sidecarArchiveName("windows", "x64"), "node-pty-win32-x64");
      assert.equal(sidecarArchiveName("windows", "arm64"), "node-pty-win32-arm64");
      // No name carries a file extension.
      for (const [ciOs, arch] of [["macos", "arm64"], ["linux", "x64"], ["windows", "x64"]]) {
        const name = sidecarArchiveName(ciOs, arch);
        assert.ok(!name.includes("."), `${name} carries no file extension`);
      }
    },
  },

  {
    name: "release-sidecar-archive-roundtrip/01 (darwin/linux content) tar.gz archive->extract round-trip: root entries reproduce build-sea.mjs's beside-the-exe layout, set-equality both directions",
    run: async () => {
      if (!TAR_AVAILABLE) {
        console.warn("release-sidecar-archive-roundtrip: tar not available on this box — the POSIX archive round-trip was skipped (flagged, not faked)");
        return;
      }
      const tmp = mkdtempSync(path.join(os.tmpdir(), "aof-sidecar-tar-rt-"));
      try {
        const seaOut = path.join(tmp, "sea-out");
        makeFixtureSeaOut(seaOut);
        const archivePath = path.join(tmp, "node-pty-linux-x64"); // extensionless, PO-pinned

        packSidecarArchive(seaOut, archivePath, { isWindows: false });
        assert.ok(existsSync(archivePath), "the archive file was created at the extensionless pinned path");

        const extractDir = path.join(tmp, "extracted");
        extractTarGz(archivePath, extractDir);

        // Root entries: node-pty-sidecar/ and node_modules/node-pty/ must
        // exist directly under the extraction root (reproducing build-sea.mjs's
        // beside-the-exe layout exactly).
        assert.ok(existsSync(path.join(extractDir, "node-pty-sidecar")), "extracted root has a node-pty-sidecar/ entry");
        assert.ok(existsSync(path.join(extractDir, "node_modules", "node-pty")), "extracted root has a node_modules/node-pty/ entry");

        const sourceFiles = listFilesRecursive(seaOut);
        const extractedFiles = listFilesRecursive(extractDir);
        assert.deepEqual(extractedFiles, sourceFiles, "extracted file tree is byte-identical in SHAPE (set + relative paths) to the original sea-out sidecar layout");

        // Explicit both-direction set-equality (not just deepEqual — spell it
        // out so a future refactor that reorders but not renames still fails loudly).
        const sourceSet = new Set(sourceFiles);
        const extractedSet = new Set(extractedFiles);
        const missingFromExtracted = sourceFiles.filter((f) => !extractedSet.has(f));
        const extraInExtracted = extractedFiles.filter((f) => !sourceSet.has(f));
        assert.deepEqual(missingFromExtracted, [], "no source file is missing after extraction");
        assert.deepEqual(extraInExtracted, [], "no extra file appears after extraction");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  },

  {
    name: "release-sidecar-archive-roundtrip/02 (win32 content) zip archive->extract round-trip: root entries reproduce build-sea.mjs's beside-the-exe layout, set-equality both directions",
    run: async () => {
      if (!(UNZIP_AVAILABLE || POWERSHELL_AVAILABLE) || !POWERSHELL_AVAILABLE) {
        // packSidecarArchive's isWindows branch itself shells out to
        // powershell (Compress-Archive) — without it, this leg cannot run at
        // all, not just the extraction side.
        console.warn("release-sidecar-archive-roundtrip: powershell not available on this box — the win32 zip round-trip was skipped (flagged, not faked)");
        return;
      }
      const tmp = mkdtempSync(path.join(os.tmpdir(), "aof-sidecar-zip-rt-"));
      try {
        const seaOut = path.join(tmp, "sea-out");
        makeFixtureSeaOut(seaOut);
        const archivePath = path.join(tmp, "node-pty-win32-x64"); // extensionless, PO-pinned

        packSidecarArchive(seaOut, archivePath, { isWindows: true });
        assert.ok(existsSync(archivePath), "the archive file was created at the extensionless pinned path");

        const extractDir = path.join(tmp, "extracted");
        extractZip(archivePath, extractDir);

        assert.ok(existsSync(path.join(extractDir, "node-pty-sidecar")), "extracted root has a node-pty-sidecar/ entry");
        assert.ok(existsSync(path.join(extractDir, "node_modules", "node-pty")), "extracted root has a node_modules/node-pty/ entry");

        const sourceFiles = listFilesRecursive(seaOut);
        const extractedFiles = listFilesRecursive(extractDir);
        assert.deepEqual(extractedFiles, sourceFiles, "extracted file tree is byte-identical in SHAPE (set + relative paths) to the original sea-out sidecar layout");

        const sourceSet = new Set(sourceFiles);
        const extractedSet = new Set(extractedFiles);
        const missingFromExtracted = sourceFiles.filter((f) => !extractedSet.has(f));
        const extraInExtracted = extractedFiles.filter((f) => !sourceSet.has(f));
        assert.deepEqual(missingFromExtracted, [], "no source file is missing after extraction");
        assert.deepEqual(extraInExtracted, [], "no extra file appears after extraction");
      } finally {
        rmSync(tmp, { recursive: true, force: true });
      }
    },
  },
];
