// Traceability wiring for milestone 28 / story 02 (one-line-installer),
// task 02_place-on-path-and-run.feature.
//
// 02_place-on-path-and-run.feature is entirely @uat (the real end-to-end
// one-liner on a real OS is a human check, ARCHITECTURE §verification-strategy).
// This file covers the DEVELOPER-OWNED @executable supporting logic the story's
// Build notes and QA feasibility flags call for underneath that @uat surface:
//
//   - placement is idempotent (a re-install replaces the binary + sidecar IN
//     PLACE, never duplicating them or leaving a stale prior-version sidecar
//     beside the new one) -- the mechanical half of "re-running the one-liner
//     upgrades in place" (02_place-on-path-and-run.feature Scenario: re-running
//     the one-liner upgrades in place ...).
//   - PATH persistence is idempotent (no duplicate PATH entry on re-install) for
//     BOTH scripts -- install.sh (a shell-profile append, the deno_install
//     pattern) and install.ps1 (the HKCU\Environment registry API directly --
//     F7 craft-review: NOT setx, which truncates values over 1024 chars, and
//     NOT [Environment]::[Get|Set]EnvironmentVariable either, which silently
//     expands %VAR%-style tokens and flips REG_EXPAND_SZ -> REG_SZ).
//   - the loud-fail tool-availability probe (sha256sum/gpg absent => refuse,
//     never silently skip verification -- Build notes, "probe sha256sum/gpg
//     availability and fail LOUDLY if absent").
//
// The REAL end-to-end "fresh shell finds aof" / cross-OS KR4 checks are @uat,
// run by a human at aof:verify -- not exercised here.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync, renameSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePosixShell, toGitBashPosixPath } from "./installer-shell.mjs";
import { packSidecarArchive } from "../scripts/release/stage-release-assets.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installSh = path.join(repoRoot, "install.sh");
const installPs1 = path.join(repoRoot, "install.ps1");

// Resolved ONCE, explicitly -- never a bare `bash`/`sh` spawn (PATH-order
// dependent; can silently resolve to the WSL launcher from a plain PowerShell
// prompt). See installer-shell.mjs.
const POSIX_SHELL = resolvePosixShell();
const POWERSHELL = (() => {
  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
  return probe.status === 0 ? "pwsh" : "powershell";
})();

function q(p) {
  return JSON.stringify(p.split("\\").join("/"));
}

// qtar: the form to splice into any script that reaches `tar` (create OR
// extract) -- GNU tar misparses a "C:/..." argument as remote-archive syntax
// regardless of slash direction (see installer-shell.mjs's
// toGitBashPosixPath for the full rationale); this converts to the true
// "/c/..." POSIX form tar accepts, matching how install.sh's own
// aof_extract_sidecar is exercised in these tests.
function qtar(p) {
  return JSON.stringify(toGitBashPosixPath(p));
}

function runSh(script) {
  const result = spawnSync(POSIX_SHELL.bash, ["-c", script], { encoding: "utf8" });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status };
}

// --- sidecar archive fixtures (PO pin, 2026-07-03, STATE.md "sidecar shape
// gap") --------------------------------------------------------------------
//
// The pinned sidecar release asset is an ARCHIVE whose root entries reproduce
// EXACTLY the layout scripts/build-sea.mjs emits beside the exe:
// node-pty-sidecar/** (the raw prebuild, echoing build-sea's copy of
// ptyPrebuildDir()) + node_modules/node-pty/** (the whole installed package,
// echoing build-sea's copy of node_modules/node-pty -- the piece
// createRequire(process.execPath)("node-pty") actually resolves against).
//
// buildSeaOutFixture builds a small REAL two-directory tree with that exact
// shape (a couple of nested files each, not real .node binaries); packing it
// into an archive is delegated to the REAL story-01 packSidecarArchive
// (imported above from scripts/release/stage-release-assets.mjs) rather than
// a hand-rolled tar/Compress-Archive invocation -- this makes these tests
// true cross-story integration tests (story 01's real packer feeding story
// 02's real extractor) and kills the drift class entirely: if story 01
// changes the archive shape again, these tests exercise the CURRENT real
// shape automatically, they cannot silently go stale the way the previous
// hand-rolled zip builder did (it replicated an OLD Compress-Archive
// invocation that packSidecarArchive itself had already moved on from).

function buildSeaOutFixture(baseDir, ptyPlatformArch) {
  const seaOut = path.join(baseDir, "seaOut");
  const sidecarSrc = path.join(seaOut, "node-pty-sidecar", "prebuilds", ptyPlatformArch);
  const moduleSrc = path.join(seaOut, "node_modules", "node-pty", "lib");
  mkdirSync(sidecarSrc, { recursive: true });
  mkdirSync(moduleSrc, { recursive: true });
  writeFileSync(path.join(sidecarSrc, "pty.node"), "fixture-pty-node-bytes", "utf8");
  writeFileSync(path.join(seaOut, "node_modules", "node-pty", "package.json"), JSON.stringify({ name: "node-pty", version: "1.1.0" }), "utf8");
  writeFileSync(path.join(moduleSrc, "index.js"), "module.exports = {};", "utf8");
  return seaOut;
}

// buildRealSidecarArchive(seaOut, destPath, { isWindows }) -- a thin wrapper
// over the REAL packSidecarArchive so call sites read the same as before,
// with an assertion that packing actually produced the archive file.
function buildRealSidecarArchive(seaOut, destPath, { isWindows }) {
  packSidecarArchive(seaOut, destPath, { isWindows });
  assert.ok(existsSync(destPath), `packSidecarArchive produces the archive at ${destPath}`);
}

export const installerPlaceTests = [
  // ══════ re-install idempotence: install.sh EXTRACTS the sidecar archive, replaces the tree in place ══════
  // PO pin (2026-07-03): the sidecar is an ARCHIVE (tar.gz on POSIX), extracted
  // into the install dir -- never copied as an opaque file -- so
  // createRequire(process.execPath)("node-pty") (ADR-002) finds a real
  // node_modules/node-pty/ tree beside the binary.
  {
    name: "installer-place/02 install.sh EXTRACTS the sidecar archive to reproduce build-sea.mjs's layout (node-pty-sidecar/ + node_modules/node-pty/)",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-extract-"));
      const installDir = path.join(base, "installdir");
      try {
        const seaOut = buildSeaOutFixture(base, "linux-x64");
        writeFileSync(path.join(base, "aof-linux-x64"), "binary-v1", "utf8");
        const archivePath = path.join(base, "node-pty-linux-x64");
        buildRealSidecarArchive(seaOut, archivePath, { isWindows: false });

        const script = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_install_files ${qtar(base)} aof-linux-x64 node-pty-linux-x64 ${qtar(installDir)}
        `;
        const r = runSh(script);
        assert.equal(r.status, 0, `install (extract) succeeds (stderr: ${r.stderr})`);

        assert.equal(readFileSync(path.join(installDir, "aof"), "utf8"), "binary-v1", "the binary is placed");
        assert.ok(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-x64", "pty.node")),
          "node-pty-sidecar/prebuilds/<platform-arch>/pty.node is extracted (echoes build-sea.mjs's raw prebuild copy)"
        );
        assert.ok(
          existsSync(path.join(installDir, "node_modules", "node-pty", "package.json")),
          "node_modules/node-pty/package.json is extracted (the piece createRequire actually resolves against)"
        );
        assert.ok(
          existsSync(path.join(installDir, "node_modules", "node-pty", "lib", "index.js")),
          "node_modules/node-pty/lib/index.js is extracted"
        );
        assert.equal(
          existsSync(path.join(installDir, "node-pty-linux-x64")),
          false,
          "the archive itself is NOT left in the install dir as a bare file -- only its extracted tree is (a copied-but-unextracted archive would silently degrade the terminal dock)"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },
  {
    name: "installer-place/02 install.sh re-install replaces the extracted sidecar tree in place, no stale prior-version file remains",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-reinstall-"));
      const installDir = path.join(base, "installdir");
      try {
        const seaOutV1 = buildSeaOutFixture(path.join(base, "v1"), "linux-x64");
        writeFileSync(path.join(base, "aof-linux-x64"), "binary-v1", "utf8");
        buildRealSidecarArchive(seaOutV1, path.join(base, "node-pty-linux-x64"), { isWindows: false });

        runSh(`
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_install_files ${qtar(base)} aof-linux-x64 node-pty-linux-x64 ${qtar(installDir)}
        `);
        assert.ok(existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-x64", "pty.node")), "the v1 tree is extracted");

        // Simulate the exact same install being re-run (upgrade in place):
        // new bytes for both the binary and the sidecar archive contents.
        writeFileSync(path.join(base, "aof-linux-x64"), "binary-v2", "utf8");
        rmSync(path.join(base, "v1"), { recursive: true, force: true });
        rmSync(path.join(base, "node-pty-linux-x64"), { force: true });
        const seaOutV2 = buildSeaOutFixture(path.join(base, "v2"), "linux-x64");
        writeFileSync(path.join(seaOutV2, "node-pty-sidecar", "prebuilds", "linux-x64", "pty.node"), "fixture-pty-node-bytes-v2", "utf8");
        buildRealSidecarArchive(seaOutV2, path.join(base, "node-pty-linux-x64"), { isWindows: false });

        const r2 = runSh(`
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_install_files ${qtar(base)} aof-linux-x64 node-pty-linux-x64 ${qtar(installDir)}
        `);
        assert.equal(r2.status, 0, `re-install (re-extract) succeeds (stderr: ${r2.stderr})`);

        assert.equal(readFileSync(path.join(installDir, "aof"), "utf8"), "binary-v2", "the binary is replaced in place (new bytes)");
        assert.equal(
          readFileSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-x64", "pty.node"), "utf8"),
          "fixture-pty-node-bytes-v2",
          "the extracted sidecar tree is replaced in place (new bytes), not layered on top of the old one"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },
  {
    name: "installer-place/02 install.sh re-install with a DIFFERENT sidecar arch removes the stale prior extracted tree",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-arch-swap-"));
      const installDir = path.join(base, "installdir");
      try {
        const seaOutArm = buildSeaOutFixture(path.join(base, "arm"), "linux-arm64");
        writeFileSync(path.join(base, "aof-linux-arm64"), "binary-v1", "utf8");
        buildRealSidecarArchive(seaOutArm, path.join(base, "node-pty-linux-arm64"), { isWindows: false });
        runSh(`
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_install_files ${qtar(base)} aof-linux-arm64 node-pty-linux-arm64 ${qtar(installDir)}
        `);
        assert.ok(existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-arm64", "pty.node")), "the arm64 tree is extracted");

        // A hypothetical re-run on a machine now reporting a different arch
        // must not leave the old arch's extracted prebuild dir behind.
        const seaOutX64 = buildSeaOutFixture(path.join(base, "x64"), "linux-x64");
        writeFileSync(path.join(base, "aof-linux-x64"), "binary-v2", "utf8");
        buildRealSidecarArchive(seaOutX64, path.join(base, "node-pty-linux-x64"), { isWindows: false });
        const r2 = runSh(`
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_install_files ${qtar(base)} aof-linux-x64 node-pty-linux-x64 ${qtar(installDir)}
        `);
        assert.equal(r2.status, 0, `re-install with a differently-named sidecar succeeds (stderr: ${r2.stderr})`);

        assert.equal(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-arm64")),
          false,
          "the stale prior-arch extracted prebuild dir (linux-arm64) is removed"
        );
        assert.ok(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-x64", "pty.node")),
          "the new arch's extracted tree (linux-x64) is present"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },

  // ══════ F5 (craft-review): a failed sidecar extraction must leave ANY PRIOR
  // install fully intact -- never a half-install. aof_install_files now
  // stages the binary + extracted sidecar tree in a temp dir FIRST; only a
  // FULLY successful staging destroys the prior install and moves the new one
  // into place. A wrong-shaped archive (the same shape aof_extract_sidecar's
  // own loud-fail guard already catches) must abort staging before ANYTHING
  // under install_dir is touched, so the prior binary + prior sidecar tree
  // remain exactly as they were. ══════
  {
    name: "installer-place/02 F5: install.sh aof_install_files leaves a PRIOR install fully intact when the new sidecar archive fails to extract",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-f5-half-install-"));
      const installDir = path.join(base, "installdir");
      try {
        // First, a GOOD install (the "prior install" this test must prove is preserved).
        const seaOutV1 = buildSeaOutFixture(path.join(base, "v1"), "linux-x64");
        writeFileSync(path.join(base, "aof-linux-x64"), "binary-v1-prior", "utf8");
        buildRealSidecarArchive(seaOutV1, path.join(base, "node-pty-linux-x64"), { isWindows: false });
        const r1 = runSh(`
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_install_files ${qtar(base)} aof-linux-x64 node-pty-linux-x64 ${qtar(installDir)}
        `);
        assert.equal(r1.status, 0, `the prior (good) install succeeds (stderr: ${r1.stderr})`);
        assert.equal(readFileSync(path.join(installDir, "aof"), "utf8"), "binary-v1-prior", "sanity: the prior binary is in place");
        assert.ok(existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-x64", "pty.node")), "sanity: the prior sidecar tree is in place");

        // Now attempt an "upgrade" whose new sidecar archive is WRONG-SHAPED
        // (mirrors aof_extract_sidecar's own bad-shape fixture technique).
        writeFileSync(path.join(base, "aof-linux-x64"), "binary-v2-would-be-broken", "utf8");
        const flatSrc = path.join(base, "flat-src", "some-other-dir");
        mkdirSync(flatSrc, { recursive: true });
        writeFileSync(path.join(flatSrc, "f.txt"), "x", "utf8");
        const badArchivePath = path.join(base, "node-pty-linux-x64");
        rmSync(badArchivePath, { force: true });
        const packScript = `tar -czf ${qtar(badArchivePath)} -C ${qtar(path.join(base, "flat-src"))} some-other-dir`;
        const packResult = runSh(packScript);
        assert.equal(packResult.status, 0, `fixture bad-shape tar packs (stderr: ${packResult.stderr})`);

        const r2 = runSh(`
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          set +e
          aof_install_files ${qtar(base)} aof-linux-x64 node-pty-linux-x64 ${qtar(installDir)}
          echo "EXIT:$?"
        `);
        assert.match(r2.stdout, /EXIT:[1-9]/, "aof_install_files refuses (non-zero exit) when the new sidecar archive is wrong-shaped");

        // THE LOAD-BEARING ASSERTIONS: the PRIOR install is untouched --
        // neither the prior binary nor the prior sidecar tree was disturbed
        // by the failed upgrade attempt.
        assert.equal(readFileSync(path.join(installDir, "aof"), "utf8"), "binary-v1-prior", "the PRIOR binary remains in place (never overwritten by the failed upgrade)");
        assert.ok(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "linux-x64", "pty.node")),
          "the PRIOR sidecar tree remains in place (never destroyed by the failed upgrade)"
        );
        assert.equal(
          existsSync(path.join(installDir, "some-other-dir")),
          false,
          "nothing from the wrong-shaped archive leaked into the install dir"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },

  // ══════ re-install idempotence: install.ps1 EXTRACTS the zip sidecar and re-nests its flat root entries ══════
  // PO pin (2026-07-03): the sidecar is a ZIP archive on Windows legs, packed
  // via Compress-Archive's `\*` glob -- its root entries are FLAT
  // (prebuilds/**, node-pty/**), so Expand-AofSidecar must re-nest them under
  // node-pty-sidecar\ and node_modules\ to reproduce build-sea.mjs's real
  // layout (confirmed against a REAL Compress-Archive invocation, the same
  // packing scripts/release/stage-release-assets.mjs uses).
  {
    name: "installer-place/02 install.ps1 EXTRACTS the zip sidecar (real packSidecarArchive, nested root entries) into build-sea.mjs's layout",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-ps1-extract-"));
      const installDir = path.join(base, "installdir");
      try {
        const seaOut = buildSeaOutFixture(base, "win32-x64");
        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-v1", "utf8");
        const archivePath = path.join(base, "node-pty-win32-x64");
        buildRealSidecarArchive(seaOut, archivePath, { isWindows: true });

        const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
Write-Output "DONE"
`;
        const r = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
        assert.match(r.stdout ?? "", /DONE/, `install (extract) succeeds (stderr: ${r.stderr})`);

        assert.equal(readFileSync(path.join(installDir, "aof.exe"), "utf8"), "binary-v1", "the binary is placed");
        assert.ok(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-x64", "pty.node")),
          "node-pty-sidecar\\prebuilds\\<platform-arch>\\pty.node is extracted (echoes build-sea.mjs's raw prebuild copy)"
        );
        assert.ok(
          existsSync(path.join(installDir, "node_modules", "node-pty", "package.json")),
          "node_modules\\node-pty\\package.json is extracted (the piece createRequire actually resolves against)"
        );
        assert.ok(
          existsSync(path.join(installDir, "node_modules", "node-pty", "lib", "index.js")),
          "node_modules\\node-pty\\lib\\index.js is extracted"
        );
        assert.equal(
          existsSync(path.join(installDir, "node-pty-win32-x64")),
          false,
          "the archive itself is NOT left in the install dir as a bare file -- only its extracted tree is"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },
  {
    // Coordinator-directed fix (2026-07-03): the real packSidecarArchive
    // NESTS both root entries under a temp staging dir before
    // Compress-Archive, so the zip's root entries are node-pty-sidecar/** +
    // node_modules/node-pty/** -- the SAME shape as tar, no re-nesting
    // needed. An EARLIER revision of Expand-AofSidecar wrongly assumed a
    // FLAT Compress-Archive shape (prebuilds/**, node-pty/**) that no longer
    // exists; against the real nested archive both of ITS conditionals
    // silently found nothing and skipped, installing NO sidecar at all with
    // no error -- the exact silent-degrade the PO pin exists to prevent.
    // This row proves the CURRENT Expand-AofSidecar finds the real nested
    // roots directly (no re-nest step), and the row below proves it refuses
    // loudly if a FUTURE archive shape drifts away from that again.
    name: "installer-place/02 install.ps1 Expand-AofSidecar loud-fails (never silently installs nothing) when the archive's root entries do not match the expected shape",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-ps1-badshape-"));
      const installDir = path.join(base, "installdir");
      try {
        // A deliberately WRONG-SHAPED zip: flat root entries, mimicking the
        // stale Compress-Archive invocation this fix retired, or any future
        // packer drift.
        const flatSrcDir = path.join(base, "flat-src");
        mkdirSync(path.join(flatSrcDir, "prebuilds", "win32-x64"), { recursive: true });
        writeFileSync(path.join(flatSrcDir, "prebuilds", "win32-x64", "pty.node"), "x", "utf8");
        const badArchive = path.join(base, "node-pty-win32-x64");
        const zipScript = `Compress-Archive -Path '${flatSrcDir}\\*' -DestinationPath '${badArchive}.zip' -Force`;
        const packResult = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", zipScript], { encoding: "utf8" });
        assert.equal(packResult.status, 0, `fixture bad-shape zip packs (stderr: ${packResult.stderr})`);
        renameSync(`${badArchive}.zip`, badArchive);

        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-v1", "utf8");

        const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
try {
  Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
  Write-Output "UNEXPECTED-SUCCESS"
} catch {
  Write-Output ("EXPECTED-THROW:" + $_.Exception.Message)
}
`;
        const r = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
        assert.match(r.stdout ?? "", /EXPECTED-THROW:/, `Expand-AofSidecar throws on a shape mismatch rather than silently installing nothing (got: ${r.stdout})`);
        assert.match(r.stdout ?? "", /root entries do not match the expected shape/i, "the thrown error names the shape mismatch");
        assert.doesNotMatch(r.stdout ?? "", /UNEXPECTED-SUCCESS/, "the install never reports success against a wrong-shaped archive");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },

  // ══════ F5 (craft-review): a failed sidecar extraction must leave ANY PRIOR
  // install fully intact -- never a half-install. Install-AofFiles now stages
  // the binary + extracted sidecar tree in a temp dir FIRST; only a FULLY
  // successful staging clears the prior install and moves the new one into
  // place. A wrong-shaped archive (Expand-AofSidecar's own loud-fail guard)
  // must abort staging before ANYTHING under InstallDir is touched. ══════
  {
    name: "installer-place/02 F5: install.ps1 Install-AofFiles leaves a PRIOR install fully intact when the new sidecar archive fails to extract",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-ps1-f5-half-install-"));
      const installDir = path.join(base, "installdir");
      try {
        // First, a GOOD install (the "prior install" this test must prove is preserved).
        const seaOutV1 = buildSeaOutFixture(path.join(base, "v1"), "win32-x64");
        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-v1-prior", "utf8");
        buildRealSidecarArchive(seaOutV1, path.join(base, "node-pty-win32-x64"), { isWindows: true });
        const script1 = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
Write-Output "DONE"
`;
        const r1 = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script1], { encoding: "utf8" });
        assert.match(r1.stdout ?? "", /DONE/, `the prior (good) install succeeds (stderr: ${r1.stderr})`);
        assert.equal(readFileSync(path.join(installDir, "aof.exe"), "utf8"), "binary-v1-prior", "sanity: the prior binary is in place");
        assert.ok(existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-x64", "pty.node")), "sanity: the prior sidecar tree is in place");

        // Now attempt an "upgrade" whose new sidecar archive is WRONG-SHAPED.
        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-v2-would-be-broken", "utf8");
        const flatSrcDir = path.join(base, "flat-src-f5");
        mkdirSync(path.join(flatSrcDir, "prebuilds", "win32-x64"), { recursive: true });
        writeFileSync(path.join(flatSrcDir, "prebuilds", "win32-x64", "pty.node"), "x", "utf8");
        const badArchive = path.join(base, "node-pty-win32-x64");
        rmSync(badArchive, { force: true });
        const zipScript = `Compress-Archive -Path '${flatSrcDir}\\*' -DestinationPath '${badArchive}.zip' -Force`;
        const packResult = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", zipScript], { encoding: "utf8" });
        assert.equal(packResult.status, 0, `fixture bad-shape zip packs (stderr: ${packResult.stderr})`);
        renameSync(`${badArchive}.zip`, badArchive);

        const script2 = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
try {
  Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
  Write-Output "UNEXPECTED-SUCCESS"
} catch {
  Write-Output ("EXPECTED-THROW:" + $_.Exception.Message)
}
`;
        const r2 = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script2], { encoding: "utf8" });
        assert.match(r2.stdout ?? "", /EXPECTED-THROW:/, `Install-AofFiles throws on the shape mismatch rather than silently installing a broken tree (got: ${r2.stdout})`);
        assert.doesNotMatch(r2.stdout ?? "", /UNEXPECTED-SUCCESS/, "the upgrade never reports success against a wrong-shaped archive");

        // THE LOAD-BEARING ASSERTIONS: the PRIOR install is untouched --
        // neither the prior binary nor the prior sidecar tree was disturbed
        // by the failed upgrade attempt.
        assert.equal(readFileSync(path.join(installDir, "aof.exe"), "utf8"), "binary-v1-prior", "the PRIOR binary remains in place (never overwritten by the failed upgrade)");
        assert.ok(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-x64", "pty.node")),
          "the PRIOR sidecar tree remains in place (never destroyed by the failed upgrade)"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },

  // ══════ F6 (craft-review): install.ps1's stale-tree removal uses
  // -ErrorAction SilentlyContinue -- a LOCKED file (e.g. a live terminal
  // session holding node-pty's pty.node open) makes Remove-Item fail
  // SILENTLY, and Move-Item would then nest the new tree INSIDE the stale one
  // (Move-Item's "move into an existing directory" semantics) and still
  // report success. Install-AofFiles must now verify the removal actually
  // took and throw a LOUD error naming the fix (close aof terminal sessions
  // and retry) rather than silently corrupting the layout. Exercised by
  // holding a real exclusive (FileShare.None) file lock open on a file INSIDE
  // the stale node-pty-sidecar tree for the DURATION of the Install-AofFiles
  // call -- a genuine, not simulated, "Remove-Item cannot delete this" case. ══════
  {
    name: "installer-place/02 F6: install.ps1 Install-AofFiles throws loudly (never silently nests) when the prior install's sidecar tree cannot be removed (locked file)",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-ps1-f6-locked-"));
      const installDir = path.join(base, "installdir");
      try {
        // A "new" install to attempt (contents do not matter -- the lock on
        // the PRIOR tree is what must block this).
        const seaOutNew = buildSeaOutFixture(path.join(base, "new"), "win32-x64");
        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-new", "utf8");
        buildRealSidecarArchive(seaOutNew, path.join(base, "node-pty-win32-x64"), { isWindows: true });

        // Pre-create the destination's stale sidecar tree with a file we will
        // hold an exclusive lock on for the duration of the install attempt.
        const staleSidecarDir = path.join(installDir, "node-pty-sidecar");
        mkdirSync(staleSidecarDir, { recursive: true });
        const lockedFile = path.join(staleSidecarDir, "pty.node");
        writeFileSync(lockedFile, "stale-locked-bytes", "utf8");
        writeFileSync(path.join(installDir, "aof.exe"), "binary-prior", "utf8");

        // One PowerShell process: opens an exclusive (FileShare.None) lock on
        // the stale file, THEN (while still holding it) calls
        // Install-AofFiles, so Remove-Item genuinely cannot delete the
        // directory -- a real lock, not a stub.
        const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
$lockedFile = '${lockedFile.replace(/'/g, "''")}'
$stream = [System.IO.File]::Open($lockedFile, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::None)
try {
  try {
    Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
    Write-Output "UNEXPECTED-SUCCESS"
  } catch {
    Write-Output ("EXPECTED-THROW:" + $_.Exception.Message)
  }
} finally {
  $stream.Close()
}
`;
        const r = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
        assert.match(r.stdout ?? "", /EXPECTED-THROW:/, `Install-AofFiles throws loudly when the stale tree cannot be removed (got: ${r.stdout}, stderr: ${r.stderr})`);
        assert.match(r.stdout ?? "", /close all aof terminal sessions/i, "the thrown error tells the user to close aof terminal sessions and retry");
        assert.doesNotMatch(r.stdout ?? "", /UNEXPECTED-SUCCESS/, "the install never silently reports success when the prior tree could not be removed");

        // Confirm no silent nesting occurred: the stale file (still locked
        // during the assertion window on Windows, but readable) is exactly
        // where it was -- not buried under an unexpected nested copy.
        assert.equal(readFileSync(lockedFile, "utf8"), "stale-locked-bytes", "the stale locked file is untouched (no silent partial removal)");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },

  {
    name: "installer-place/02 install.ps1 re-install replaces the extracted sidecar tree in place, no stale prior-version file remains",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-ps1-reinstall-"));
      const installDir = path.join(base, "installdir");
      try {
        const seaOutV1 = buildSeaOutFixture(path.join(base, "v1"), "win32-x64");
        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-v1", "utf8");
        buildRealSidecarArchive(seaOutV1, path.join(base, "node-pty-win32-x64"), { isWindows: true });

        const script1 = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
`;
        spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script1], { encoding: "utf8" });
        assert.ok(existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-x64", "pty.node")), "the v1 tree is extracted");

        // Simulate a re-run with new bytes for both the binary and the
        // sidecar archive contents (an in-place upgrade).
        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-v2", "utf8");
        rmSync(path.join(base, "v1"), { recursive: true, force: true });
        rmSync(path.join(base, "node-pty-win32-x64"), { force: true });
        const seaOutV2 = buildSeaOutFixture(path.join(base, "v2"), "win32-x64");
        writeFileSync(path.join(seaOutV2, "node-pty-sidecar", "prebuilds", "win32-x64", "pty.node"), "fixture-pty-node-bytes-v2", "utf8");
        buildRealSidecarArchive(seaOutV2, path.join(base, "node-pty-win32-x64"), { isWindows: true });

        const script2 = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
Write-Output "DONE"
`;
        const r2 = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script2], { encoding: "utf8" });
        assert.match(r2.stdout ?? "", /DONE/, `re-install (re-extract) succeeds (stderr: ${r2.stderr})`);

        assert.equal(readFileSync(path.join(installDir, "aof.exe"), "utf8"), "binary-v2", "the binary is replaced in place (new bytes)");
        assert.equal(
          readFileSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-x64", "pty.node"), "utf8"),
          "fixture-pty-node-bytes-v2",
          "the extracted sidecar tree is replaced in place (new bytes), not layered on top of the old one"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },
  {
    name: "installer-place/02 install.ps1 re-install with a DIFFERENT sidecar arch removes the stale prior extracted tree",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-ps1-arch-swap-"));
      const installDir = path.join(base, "installdir");
      try {
        const seaOutArm = buildSeaOutFixture(path.join(base, "arm"), "win32-arm64");
        writeFileSync(path.join(base, "aof-windows-arm64.exe"), "binary-v1", "utf8");
        buildRealSidecarArchive(seaOutArm, path.join(base, "node-pty-win32-arm64"), { isWindows: true });
        const script1 = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-arm64.exe' -Sidecar 'node-pty-win32-arm64' -InstallDir '${installDir.replace(/'/g, "''")}'
`;
        spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script1], { encoding: "utf8" });
        assert.ok(existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-arm64", "pty.node")), "the arm64 tree is extracted");

        const seaOutX64 = buildSeaOutFixture(path.join(base, "x64"), "win32-x64");
        writeFileSync(path.join(base, "aof-windows-x64.exe"), "binary-v2", "utf8");
        buildRealSidecarArchive(seaOutX64, path.join(base, "node-pty-win32-x64"), { isWindows: true });
        const script2 = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
Install-AofFiles -WorkDir '${base.replace(/'/g, "''")}' -Asset 'aof-windows-x64.exe' -Sidecar 'node-pty-win32-x64' -InstallDir '${installDir.replace(/'/g, "''")}'
Write-Output "DONE"
`;
        const r2 = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script2], { encoding: "utf8" });
        assert.match(r2.stdout ?? "", /DONE/, `re-install with a differently-named sidecar succeeds (stderr: ${r2.stderr})`);

        assert.equal(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-arm64")),
          false,
          "the stale prior-arch extracted prebuild dir (win32-arm64) is removed"
        );
        assert.ok(
          existsSync(path.join(installDir, "node-pty-sidecar", "prebuilds", "win32-x64", "pty.node")),
          "the new arch's extracted tree (win32-x64) is present"
        );
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },

  // ══════ PATH persistence idempotence: install.sh (shell profile append) ══════
  {
    name: "installer-place/02 install.sh PATH persistence: re-install does not duplicate the profile export line",
    async run() {
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-place-profile-"));
      const profile = path.join(dir, "fake-profile");
      const installDir = path.join(dir, "install-bin");
      try {
        const script = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_persist_path ${q(installDir)} ${q(profile)}
          aof_persist_path ${q(installDir)} ${q(profile)}
          aof_persist_path ${q(installDir)} ${q(profile)}
        `;
        const r = runSh(script);
        assert.equal(r.status, 0, `three successive persist calls succeed (stderr: ${r.stderr})`);
        const contents = readFileSync(profile, "utf8");
        const occurrences = contents.split(installDir.split("\\").join("/")).length - 1;
        assert.equal(occurrences, 1, "the install dir appears exactly once in the profile after three runs (no duplicate PATH entry accrues)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ F10 (craft-review): fish is NOT bash-syntax-compatible --
  // `export PATH="$install_dir:$PATH"` is not valid fish syntax at all (a
  // config.fish carrying it would error on every fish shell start). For a
  // fish profile (config.fish), aof_persist_path must emit `fish_add_path
  // <install_dir>` instead (fish's own idempotent-by-design PATH primitive). ══════
  {
    name: "installer-place/02 F10: install.sh aof_persist_path emits `fish_add_path` (never a bash export line) for a fish profile",
    async run() {
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-place-fish-"));
      const profile = path.join(dir, "config.fish");
      const installDir = path.join(dir, "install-bin");
      try {
        const script = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_persist_path ${q(installDir)} ${q(profile)}
        `;
        const r = runSh(script);
        assert.equal(r.status, 0, `persist against a config.fish profile succeeds (stderr: ${r.stderr})`);
        const contents = readFileSync(profile, "utf8");
        assert.match(contents, /fish_add_path/, "the fish profile is persisted via fish_add_path");
        assert.doesNotMatch(contents, /export PATH=/, "the fish profile never receives a bash-syntax `export PATH=` line (invalid fish syntax)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "installer-place/02 F10: install.sh aof_persist_path re-install with a fish profile is idempotent (no duplicate fish_add_path line)",
    async run() {
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-place-fish-idem-"));
      const profile = path.join(dir, "config.fish");
      const installDir = path.join(dir, "install-bin");
      try {
        const script = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_persist_path ${q(installDir)} ${q(profile)}
          aof_persist_path ${q(installDir)} ${q(profile)}
          aof_persist_path ${q(installDir)} ${q(profile)}
        `;
        const r = runSh(script);
        assert.equal(r.status, 0, `three successive fish persist calls succeed (stderr: ${r.stderr})`);
        const contents = readFileSync(profile, "utf8");
        const occurrences = contents.split("fish_add_path").length - 1;
        assert.equal(occurrences, 1, "fish_add_path appears exactly once in config.fish after three runs (no duplicate accrues)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ F10: the marker-based idempotence must REPLACE a stale persisted
  // line when AOF_INSTALL_DIR changed between installs, never silently skip
  // (a bare "marker already present" early-return left a user's profile
  // permanently pointing at an OLD/relocated install dir forever). ══════
  {
    name: "installer-place/02 F10: install.sh aof_persist_path REPLACES a stale persisted line when install_dir changed between installs",
    async run() {
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-place-stale-dir-"));
      const profile = path.join(dir, "fake-profile");
      const oldInstallDir = path.join(dir, "old-install-bin");
      const newInstallDir = path.join(dir, "new-install-bin");
      try {
        const script1 = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_persist_path ${q(oldInstallDir)} ${q(profile)}
        `;
        const r1 = runSh(script1);
        assert.equal(r1.status, 0, `the first persist (old install dir) succeeds (stderr: ${r1.stderr})`);
        const contentsAfterFirst = readFileSync(profile, "utf8");
        assert.match(contentsAfterFirst, new RegExp(oldInstallDir.split("\\").join("/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "sanity: the OLD install dir is persisted first");

        // A re-install with a DIFFERENT AOF_INSTALL_DIR (e.g. a relocated
        // $HOME or a changed override) -- the marker is already present, but
        // the persisted line itself is now STALE.
        const script2 = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          aof_persist_path ${q(newInstallDir)} ${q(profile)}
        `;
        const r2 = runSh(script2);
        assert.equal(r2.status, 0, `the second persist (new install dir) succeeds (stderr: ${r2.stderr})`);
        const contentsAfterSecond = readFileSync(profile, "utf8");
        const newDirPosix = newInstallDir.split("\\").join("/");
        const oldDirPosix = oldInstallDir.split("\\").join("/");
        assert.ok(contentsAfterSecond.includes(newDirPosix), `the profile now persists the NEW install dir (got: ${contentsAfterSecond})`);
        assert.ok(!contentsAfterSecond.includes(oldDirPosix), `the STALE old install dir line is replaced, not left alongside the new one (got: ${contentsAfterSecond})`);
        const markerOccurrences = contentsAfterSecond.split("# aof install (added by install.sh)").length - 1;
        assert.equal(markerOccurrences, 1, "the marker itself is not duplicated either -- exactly one aof install block remains");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ PATH persistence idempotence: install.ps1 (SetEnvironmentVariable('Path', ..., 'User')) ══════
  // PO decision: SetEnvironmentVariable, NOT setx (setx truncates PATH values
  // over 1024 chars). This test stubs Get/Set-AofUserPath so it exercises the
  // REAL idempotence decision logic without mutating this machine's actual
  // registry-backed user PATH.
  {
    name: "installer-place/02 install.ps1 PATH persistence: re-install does not duplicate the PATH entry (stubbed User-scope get/set)",
    async run() {
      const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
$script:fakeUserPath = 'C:\\Windows;C:\\Windows\\System32'
function Get-AofUserPath { return $script:fakeUserPath }
function Set-AofUserPath { param([string]$Value) $script:fakeUserPath = $Value }
Add-AofToUserPath -InstallDir 'C:\\Users\\fixture\\.aof\\bin'
Add-AofToUserPath -InstallDir 'C:\\Users\\fixture\\.aof\\bin'
Add-AofToUserPath -InstallDir 'C:\\Users\\fixture\\.aof\\bin'
Write-Output ("PATH:" + $script:fakeUserPath)
`;
      const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
      const line = (result.stdout ?? "").split("\n").find((l) => l.startsWith("PATH:")) ?? "";
      const value = line.replace("PATH:", "").trim();
      const occurrences = value.split("C:\\Users\\fixture\\.aof\\bin").length - 1;
      assert.equal(result.status, 0, `three successive Add-AofToUserPath calls succeed (stderr: ${result.stderr})`);
      assert.equal(occurrences, 1, `the install dir appears exactly once in the User PATH after three runs (got: ${value})`);
    },
  },
  {
    // F7 (craft-review): [Environment]::[Get|Set]EnvironmentVariable always
    // round-trips through an EXPANDED value and always writes back REG_SZ --
    // permanently expanding any %VAR%-style token a user's existing PATH
    // already carried and silently flipping REG_EXPAND_SZ -> REG_SZ. Fixed to
    // read/write the HKCU\Environment registry value directly:
    // RegistryKey.GetValue(..., DoNotExpandEnvironmentNames) and
    // RegistryKey.SetValue(..., ExpandString).
    name: "installer-place/02 install.ps1 F7: persists PATH via the HKCU\\Environment registry API (DoNotExpandEnvironmentNames / ExpandString), never setx, never [Environment]::[Get|Set]EnvironmentVariable",
    async run() {
      const source = readFileSync(installPs1, "utf8");
      assert.match(source, /DoNotExpandEnvironmentNames/, "Get-AofUserPath reads the raw (unexpanded) registry value via RegistryValueOptions.DoNotExpandEnvironmentNames");
      assert.match(source, /RegistryValueKind\]::ExpandString/, "Set-AofUserPath writes the value back as REG_EXPAND_SZ via RegistryValueKind.ExpandString");
      assert.match(source, /\[Microsoft\.Win32\.Registry\]::CurrentUser\.OpenSubKey\(\s*"Environment"/, "install.ps1 opens HKCU\\Environment directly via the registry API");
      // Strip comment lines (which legitimately mention "NOT setx" /
      // "NOT [Environment]::SetEnvironmentVariable" as the documented
      // rationale) before asserting no EXECUTABLE call to either.
      const codeOnly = source
        .split("\n")
        .filter((line) => !line.trim().startsWith("#"))
        .join("\n");
      assert.doesNotMatch(codeOnly, /\bsetx\b/i, "install.ps1 never shells out to setx (setx truncates PATH values over 1024 chars) outside of comments");
      assert.doesNotMatch(codeOnly, /\[Environment\]::(Get|Set)EnvironmentVariable\(\s*"Path"/, "install.ps1 never reads/writes PATH via [Environment]::[Get|Set]EnvironmentVariable outside of comments (it silently expands %VAR% tokens and flips REG_EXPAND_SZ -> REG_SZ)");
    },
  },
  {
    // F7 mechanics proof: the EXACT registry API calls install.ps1's
    // Get-AofUserPath/Set-AofUserPath use (GetValue with
    // DoNotExpandEnvironmentNames / SetValue with ExpandString) genuinely
    // preserve a %VAR%-style token and the REG_EXPAND_SZ value type across a
    // round-trip -- proving the technique itself is correct, exercised
    // against a THROWAWAY HKCU test subkey (Software\AofInstallerTestF7,
    // deleted in `finally`), never HKCU\Environment (the wired functions
    // never touch the real registry -- the injectable seam in
    // Add-AofToUserPath's own test above proves THAT).
    name: "installer-place/02 F7: the registry API technique (DoNotExpandEnvironmentNames / ExpandString) genuinely preserves a %VAR% token and REG_EXPAND_SZ type across a round-trip",
    async run() {
      const testKeyPath = "Software\\AofInstallerTestF7_" + Date.now();
      const script = `
$hk = [Microsoft.Win32.Registry]::CurrentUser
try {
  $writeKey = $hk.CreateSubKey('${testKeyPath}', $true)
  $writeKey.SetValue("Path", '%AOF_F7_TESTVAR%\\bin;C:\\other', [Microsoft.Win32.RegistryValueKind]::ExpandString)
  $writeKey.Close()

  $readKey = $hk.OpenSubKey('${testKeyPath}')
  $raw = $readKey.GetValue("Path", $null, [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $kind = $readKey.GetValueKind("Path")
  $readKey.Close()
  Write-Output ("RAW:" + $raw)
  Write-Output ("KIND:" + $kind)
} finally {
  $hk.DeleteSubKeyTree('${testKeyPath}', $false)
}
`;
      const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
      const stdout = result.stdout ?? "";
      assert.match(stdout, /RAW:%AOF_F7_TESTVAR%\\bin;C:\\other/, `the %VAR%-style token round-trips LITERALLY, never expanded (got: ${stdout}, stderr: ${result.stderr})`);
      assert.match(stdout, /KIND:ExpandString/, "the value is stored/read back as REG_EXPAND_SZ (ExpandString), never silently flipped to REG_SZ");
    },
  },

  // ══════ F11 (craft-review): install.ps1:29 used to set a bare, unguarded
  // $ErrorActionPreference = "Stop" at TOP LEVEL -- under `irm | iex` this
  // script's top-level statements run IN THE CALLER'S OWN SESSION, so that
  // assignment PERMANENTLY changed the user's interactive shell's
  // error-handling preference even after the installer finished. Fixed:
  // Invoke-AofInstall now saves the CALLER's $ErrorActionPreference and
  // restores it in `finally`, regardless of success or failure. Exercised by
  // dot-sourcing the script (defines functions only, per AOF_INSTALL_TEST),
  // setting a distinctive SENTINEL preference, then invoking Invoke-AofInstall
  // with Get-AofDetectedPlatform stubbed to force an EARLY THROW (an
  // unsupported platform) -- proving restoration happens even on the FAILURE
  // path, not just the happy path. ══════
  {
    name: "installer-place/00 F11: install.ps1 Invoke-AofInstall saves/restores the CALLER's $ErrorActionPreference, even when the install throws",
    async run() {
      const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
$ErrorActionPreference = 'SilentlyContinue'
$sentinelBefore = $ErrorActionPreference
function Get-AofDetectedPlatform { return @{ ProcessorArchitecture = 'BOGUS-ARCH'; Is64BitOperatingSystem = $true } }
try {
  Invoke-AofInstall
  Write-Output "UNEXPECTED-SUCCESS"
} catch {
  Write-Output ("EXPECTED-THROW:" + $_.Exception.Message)
}
Write-Output ("EAP-AFTER:" + $ErrorActionPreference)
Write-Output ("EAP-MATCHES-SENTINEL:" + ($ErrorActionPreference -eq $sentinelBefore))
`;
      const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
      const stdout = result.stdout ?? "";
      assert.match(stdout, /EXPECTED-THROW:/, `Invoke-AofInstall throws on the unsupported-platform row (got: ${stdout}, stderr: ${result.stderr})`);
      assert.doesNotMatch(stdout, /UNEXPECTED-SUCCESS/, "the install never reports success against an unsupported platform");
      assert.match(stdout, /EAP-MATCHES-SENTINEL:True/, `the caller's original $ErrorActionPreference (SilentlyContinue) is restored after the FAILED install (got: ${stdout})`);
    },
  },
  {
    name: "installer-place/00 F11: install.ps1 does not leave a bare, unguarded top-level $ErrorActionPreference assignment (it would leak into the caller's `irm | iex` session)",
    async run() {
      const source = readFileSync(installPs1, "utf8");
      const lines = source.split("\n");
      // Find any top-level (column-0, not indented inside a function body)
      // `$ErrorActionPreference = ...` assignment OUTSIDE Invoke-AofInstall's
      // own save/restore pair -- a regression would reintroduce a bare
      // assignment that runs unconditionally when the file is dot-sourced.
      const bareTopLevelAssignment = lines.find((line) => /^\$ErrorActionPreference\s*=/.test(line));
      assert.equal(bareTopLevelAssignment, undefined, `install.ps1 has no bare, column-0 $ErrorActionPreference assignment outside a function (found: ${bareTopLevelAssignment})`);
      assert.match(source, /\$previousErrorActionPreference\s*=\s*\$ErrorActionPreference/, "Invoke-AofInstall saves the caller's $ErrorActionPreference before setting its own");
      assert.match(source, /\$ErrorActionPreference\s*=\s*\$previousErrorActionPreference/, "Invoke-AofInstall restores the saved $ErrorActionPreference (in its finally block)");
    },
  },

  // ══════ F11: force TLS 1.2 before any download, for Windows PowerShell 5.1
  // compat (older Windows versions can default SecurityProtocol to a set that
  // excludes TLS 1.2, making Invoke-WebRequest against an HTTPS-only host
  // fail with an opaque connection error rather than a clear TLS message). ══════
  {
    name: "installer-place/00 F11: install.ps1 forces Tls12 via [Net.ServicePointManager]::SecurityProtocol before downloading (Windows PowerShell 5.1 compat)",
    async run() {
      const source = readFileSync(installPs1, "utf8");
      assert.match(source, /\[Net\.ServicePointManager\]::SecurityProtocol/, "install.ps1 references [Net.ServicePointManager]::SecurityProtocol");
      assert.match(source, /\[Net\.SecurityProtocolType\]::Tls12/, "install.ps1 forces Tls12 via [Net.SecurityProtocolType]::Tls12");
      // The forcing must happen inside Invoke-AofInstall, BEFORE the first
      // download call (Get-AofRelease) -- not merely mentioned anywhere.
      const invokeIndex = source.indexOf("function Invoke-AofInstall");
      const tls12Index = source.indexOf("Tls12", invokeIndex);
      const firstDownloadIndex = source.indexOf("Get-AofRelease -Asset", invokeIndex);
      assert.ok(invokeIndex !== -1 && tls12Index !== -1 && firstDownloadIndex !== -1, "all three anchors are found in install.ps1");
      assert.ok(tls12Index < firstDownloadIndex, "Tls12 is forced BEFORE the first download call inside Invoke-AofInstall");
    },
  },
  {
    // Genuine mechanics proof (not just a source-grep): the SecurityProtocol
    // bitwise-OR technique install.ps1 uses actually adds Tls12 to whatever
    // the process's default was, and restores the prior value afterward --
    // exercised against the REAL [Net.ServicePointManager] (this is a
    // process-wide, in-memory .NET setting, not a registry/network mutation,
    // so it is safe to exercise directly).
    name: "installer-place/00 F11: the Tls12-forcing technique genuinely adds Tls12 to SecurityProtocol and Invoke-AofInstall restores the prior value afterward",
    async run() {
      const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls11
$before = [Net.ServicePointManager]::SecurityProtocol
function Get-AofDetectedPlatform { return @{ ProcessorArchitecture = 'BOGUS-ARCH'; Is64BitOperatingSystem = $true } }
try { Invoke-AofInstall } catch { }
$after = [Net.ServicePointManager]::SecurityProtocol
Write-Output ("BEFORE:" + $before)
Write-Output ("AFTER:" + $after)
`;
      const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
      const stdout = result.stdout ?? "";
      const beforeLine = stdout.split("\n").find((l) => l.startsWith("BEFORE:")) ?? "";
      const afterLine = stdout.split("\n").find((l) => l.startsWith("AFTER:")) ?? "";
      assert.doesNotMatch(beforeLine, /Tls12/, `sanity: the sentinel SecurityProtocol (Tls11 only) was set before the call and does NOT already include Tls12 (got: ${stdout}, stderr: ${result.stderr})`);
      assert.equal(afterLine.trim(), beforeLine.trim().replace("BEFORE:", "AFTER:"), `SecurityProtocol is restored to its exact prior value (Tls11, not Tls12-forced) after Invoke-AofInstall returns/throws (got: ${stdout})`);
    },
  },

  // ══════ loud-fail: probe sha256sum/gpg availability, never silently skip verification ══════
  {
    name: "installer-place/01 install.sh loud-fails when a required verification tool is unavailable (never silently skips)",
    async run() {
      const script = `
        AOF_INSTALL_TEST=1
        export AOF_INSTALL_TEST
        . "${installSh.split("\\").join("/")}"
        set +e
        PATH="/nonexistent-empty-dir" aof_require_tool sha256sum
        echo "EXIT:$?"
      `;
      const r = runSh(script);
      assert.match(r.stdout, /EXIT:[1-9]/, "aof_require_tool exits non-zero when the tool is not on PATH");
      assert.match(r.stderr, /required tool 'sha256sum' is not available/i, "the failure is a LOUD, named error, not a silent skip");
    },
  },

  // ══════ F2 (craft-review): stock macOS ships NO sha256sum(1) -- install.sh
  // must fall back to `shasum -a 256` (same first-field output shape) when
  // sha256sum is absent, and loud-fail only when NEITHER exists. Exercised
  // via the PATH-restriction technique already used above: a scoped PATH
  // pointing at a throwaway stub executable named exactly `sha256sum` or
  // `shasum`, so each branch is proven independently of what this actual box
  // happens to have installed. ══════
  {
    name: "installer-place/01 F2: aof_require_sha256_tool + aof_sha256 use sha256sum when it is on PATH",
    async run() {
      const stubDir = mkdtempSync(path.join(os.tmpdir(), "aof-sha256sum-stub-"));
      try {
        const stubPath = path.join(stubDir, "sha256sum");
        writeFileSync(stubPath, '#!/bin/sh\nprintf "stub-sha256sum-hash  %s\\n" "$1"\n', "utf8");
        runSh(`chmod +x ${qtar(stubPath)}`);

        const script = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          set +e
          PATH=${qtar(stubDir)} aof_require_sha256_tool
          echo "PROBE_EXIT:$?"
          PATH=${qtar(stubDir)} aof_sha256 /some/fixture/path
        `;
        const r = runSh(script);
        assert.match(r.stdout, /PROBE_EXIT:0/, "aof_require_sha256_tool succeeds when only sha256sum is on PATH");
        assert.match(r.stdout, /stub-sha256sum-hash/, "aof_sha256 dispatches to sha256sum when it is available");
      } finally {
        rmSync(stubDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "installer-place/01 F2: aof_require_sha256_tool + aof_sha256 FALL BACK to `shasum -a 256` when sha256sum is absent (stock macOS)",
    async run() {
      const stubDir = mkdtempSync(path.join(os.tmpdir(), "aof-shasum-stub-"));
      try {
        const stubPath = path.join(stubDir, "shasum");
        // Mirrors the real `shasum -a 256 <path>` invocation: $1=-a $2=256 $3=<path>.
        writeFileSync(stubPath, '#!/bin/sh\nprintf "stub-shasum-hash  %s\\n" "$3"\n', "utf8");
        runSh(`chmod +x ${qtar(stubPath)}`);

        const script = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          set +e
          PATH=${qtar(stubDir)} aof_require_sha256_tool
          echo "PROBE_EXIT:$?"
          PATH=${qtar(stubDir)} aof_sha256 /some/fixture/path
        `;
        const r = runSh(script);
        assert.match(r.stdout, /PROBE_EXIT:0/, "aof_require_sha256_tool succeeds when only shasum is on PATH (no sha256sum, the stock-macOS case)");
        assert.match(r.stdout, /stub-shasum-hash  \/some\/fixture\/path/, "aof_sha256 falls back to `shasum -a 256` and its first-field output is parseable the same way");
      } finally {
        rmSync(stubDir, { recursive: true, force: true });
      }
    },
  },
  {
    name: "installer-place/01 F2: aof_require_sha256_tool loud-fails only when NEITHER sha256sum nor shasum is available",
    async run() {
      const script = `
        AOF_INSTALL_TEST=1
        export AOF_INSTALL_TEST
        . "${installSh.split("\\").join("/")}"
        set +e
        PATH="/nonexistent-empty-dir" aof_require_sha256_tool
        echo "EXIT:$?"
      `;
      const r = runSh(script);
      assert.match(r.stdout, /EXIT:[1-9]/, "aof_require_sha256_tool exits non-zero when neither tool is on PATH");
      assert.match(r.stderr, /neither 'sha256sum' nor 'shasum' is available/i, "the failure names BOTH tools it probed for, not a silent skip");
    },
  },
  {
    name: "installer-place/01 install.sh loud-fails when gpg is unavailable on the Linux verify path (never silently skips)",
    async run() {
      const script = `
        AOF_INSTALL_TEST=1
        export AOF_INSTALL_TEST
        . "${installSh.split("\\").join("/")}"
        set +e
        PATH="/nonexistent-empty-dir" aof_require_tool gpg
        echo "EXIT:$?"
      `;
      const r = runSh(script);
      assert.match(r.stdout, /EXIT:[1-9]/, "aof_require_tool exits non-zero when gpg is not on PATH");
      assert.match(r.stderr, /required tool 'gpg' is not available/i, "the failure is a LOUD, named error, not a silent skip");
    },
  },
  {
    name: "installer-place/02 install.sh loud-fails when tar is unavailable for sidecar extraction (never silently skips)",
    async run() {
      const script = `
        AOF_INSTALL_TEST=1
        export AOF_INSTALL_TEST
        . "${installSh.split("\\").join("/")}"
        set +e
        PATH="/nonexistent-empty-dir" aof_extract_sidecar "/does/not/matter" "/does/not/matter/either"
        echo "EXIT:$?"
      `;
      const r = runSh(script);
      assert.match(r.stdout, /EXIT:[1-9]/, "aof_extract_sidecar exits non-zero when tar is not on PATH");
      assert.match(r.stderr, /required tool 'tar' is not available/i, "the failure is a LOUD, named error, not a silent skip (a copied-but-unextracted archive would otherwise pass as a false-green install)");
    },
  },
  {
    // Symmetric to install.ps1's Expand-AofSidecar shape guard: proves
    // aof_extract_sidecar refuses a wrong-shaped archive LOUDLY (naming what
    // it found) rather than silently extracting a partial/empty tree.
    name: "installer-place/02 install.sh aof_extract_sidecar loud-fails (never silently extracts a partial tree) when the archive's root entries do not match the expected shape",
    async run() {
      const base = mkdtempSync(path.join(os.tmpdir(), "aof-place-sh-badshape-"));
      const installDir = path.join(base, "installdir");
      try {
        mkdirSync(installDir, { recursive: true });
        // A deliberately WRONG-SHAPED tar.gz: a single unrelated top-level dir.
        const flatSrc = path.join(base, "flat-src", "some-other-dir");
        mkdirSync(flatSrc, { recursive: true });
        writeFileSync(path.join(flatSrc, "f.txt"), "x", "utf8");
        const badArchive = path.join(base, "node-pty-linux-x64");
        const packScript = `tar -czf ${qtar(badArchive)} -C ${qtar(path.join(base, "flat-src"))} some-other-dir`;
        const packResult = runSh(packScript);
        assert.equal(packResult.status, 0, `fixture bad-shape tar packs (stderr: ${packResult.stderr})`);

        const script = `
          AOF_INSTALL_TEST=1
          export AOF_INSTALL_TEST
          . "${installSh.split("\\").join("/")}"
          set +e
          aof_extract_sidecar ${qtar(badArchive)} ${qtar(installDir)}
          echo "EXIT:$?"
        `;
        const r = runSh(script);
        assert.match(r.stdout, /EXIT:[1-9]/, "aof_extract_sidecar exits non-zero on a shape mismatch, never a silent partial extraction");
        assert.match(r.stderr, /root entries do not match the expected shape/i, "the refusal names the shape mismatch");
        assert.equal(existsSync(path.join(installDir, "some-other-dir")), false, "nothing from the wrong-shaped archive is extracted into the install dir");
      } finally {
        rmSync(base, { recursive: true, force: true });
      }
    },
  },

  // ══════ F4 (craft-review): a failed asset download names the EXACT asset/URL
  // that failed and notes it may not be published for this platform yet
  // (Windows arm64 is detected per the asset-name contract but has no
  // guaranteed published leg). Also: the doc comment above Resolve-AofAsset
  // must NOT document a non-existent -Arm64Emulated parameter. ══════
  {
    name: "installer-place/00 F4: install.ps1 Get-AofRelease names the exact failed asset/URL and flags it may not be published yet",
    async run() {
      const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
$env:AOF_INSTALL_HOST = 'https://get.aof.dev'
$env:AOF_INSTALL_VERSION = 'v9.9.9'
function Invoke-AofDownload { param([string]$Url, [string]$Dest) throw "404 Not Found" }
try {
  Get-AofRelease -Asset 'aof-windows-arm64.exe' -Sidecar 'node-pty-win32-arm64' -WorkDir '${os.tmpdir().replace(/\\/g, "\\\\")}'
  Write-Output "UNEXPECTED-SUCCESS"
} catch {
  Write-Output ("ERROR:" + $_.Exception.Message)
}
`;
      const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
      const stdout = result.stdout ?? "";
      assert.match(stdout, /ERROR:/, `Get-AofRelease throws on a download failure (got: ${stdout}, stderr: ${result.stderr})`);
      assert.match(stdout, /aof-windows-arm64\.exe/, "the error names the EXACT asset that failed to download");
      assert.match(stdout, /https:\/\/get\.aof\.dev\/releases\/v9\.9\.9\/aof-windows-arm64\.exe/, "the error names the exact URL that was attempted");
      assert.match(stdout, /may not be published for this platform yet/i, "the error notes the asset may simply not be published for this platform yet, not just a generic network failure");
    },
  },
  {
    name: "installer-place/00 F4: install.ps1's doc comment above Resolve-AofAsset does not document a non-existent -Arm64Emulated parameter",
    async run() {
      const source = readFileSync(installPs1, "utf8");
      assert.doesNotMatch(source, /Arm64Emulated/, "install.ps1 never mentions -Arm64Emulated (removed -- Resolve-AofAsset never had this parameter)");
    },
  },

  // ══════ asset-name soft contract: byte-exact pinned names appear in both scripts ══════
  {
    name: "installer-place/00 the pinned asset-name soft contract appears byte-exact in both installer scripts",
    async run() {
      const shSource = readFileSync(installSh, "utf8");
      const ps1Source = readFileSync(installPs1, "utf8");
      const posixNames = ["aof-macos-arm64", "aof-macos-x64", "aof-linux-x64", "aof-linux-arm64"];
      const windowsNames = ["aof-windows-x64.exe", "aof-windows-arm64.exe"];
      for (const name of posixNames) {
        assert.ok(shSource.includes(name), `install.sh references the pinned asset name ${name} byte-exact`);
      }
      for (const name of windowsNames) {
        assert.ok(ps1Source.includes(name), `install.ps1 references the pinned asset name ${name} byte-exact`);
      }
    },
  },

  // ══════ test-harness self-check: the explicit shell/gpg resolver never picks a WSL launcher, and loud-fails when nothing is found ══════
  // Coordinator-directed fix: a bare `bash`/`sh`/`gpg` spawn is PATH-order
  // dependent -- from a plain PowerShell prompt on this box, `bash` can
  // resolve to the WSL launcher (C:\Windows\System32\bash.exe), which either
  // fails to parse the Windows fixture path or drops into a WSL distro with
  // no gpg, silently turning real refusal rows into false-green skips.
  // installer-shell.mjs resolves explicitly instead. These rows exercise its
  // OWN decision logic via dependency injection (a fabricated { existsSync,
  // execFileSync, env } io bundle) -- never mutating this real machine's PATH,
  // filesystem, or registry -- so the genuine "nothing found" loud-fail branch
  // is honestly provable even though a real Git-for-Windows install always
  // exists on every box these tests actually run on.
  {
    name: "installer-place/harness resolvePosixShell rejects a WSL-launcher bash.exe on PATH and finds the real Git Bash instead",
    async run() {
      if (process.platform !== "win32") {
        console.warn("installer-place: WSL-launcher-rejection row is Windows-only -- skipped on this platform (flagged, not faked)");
        return;
      }
      const { resolvePosixShell } = await import("./installer-shell.mjs");
      // A fabricated io bundle: `git --exec-path` fails (git "not installed"),
      // %ProgramFiles% points nowhere useful, and PATH lists the WSL launcher
      // location BEFORE the real Git Bash location -- reproducing the
      // coordinator's exact failure shape (WSL wins a naive PATH-order pick).
      const fakeGitRoot = "C:\\FakeGit";
      const io = {
        env: {
          Path: "C:\\Windows\\System32;C:\\Users\\fixture\\AppData\\Local\\Microsoft\\WindowsApps;" + fakeGitRoot + "\\bin",
          ProgramFiles: "C:\\NoGitHere",
        },
        execFileSync() {
          throw new Error("git: command not found (fixture: git is not installed)");
        },
        existsSync(candidate) {
          const normalized = candidate.toLowerCase();
          // The WSL launcher DOES exist on this fixture PATH (as it does on a
          // real WSL-enabled box) -- if the resolver ever accepted it, this
          // test would catch that regression.
          if (normalized === "c:\\windows\\system32\\bash.exe") return true;
          if (normalized === (fakeGitRoot + "\\bin\\bash.exe").toLowerCase()) return true;
          if (normalized === (fakeGitRoot + "\\bin\\sh.exe").toLowerCase()) return true;
          return false;
        },
      };

      const resolved = resolvePosixShell(io);
      assert.equal(resolved.bash, fakeGitRoot + "\\bin\\bash.exe", "the WSL launcher on PATH is rejected; the real Git Bash location is chosen");
      assert.doesNotMatch(resolved.bash.toLowerCase(), /\\windows\\system32\\|\\windowsapps\\/, "the resolved bash is never a WSL-launcher path");
    },
  },
  {
    name: "installer-place/harness resolvePosixShell loud-fails with ONE clear message when no Git Bash exists anywhere (never a silent skip)",
    async run() {
      if (process.platform !== "win32") {
        console.warn("installer-place: loud-fail-on-total-absence row is Windows-only -- skipped on this platform (flagged, not faked)");
        return;
      }
      const { resolvePosixShell } = await import("./installer-shell.mjs");
      const io = {
        env: { Path: "C:\\Windows\\System32", ProgramFiles: "C:\\NoGitHere" },
        execFileSync() {
          throw new Error("git: command not found (fixture: git is not installed)");
        },
        existsSync() {
          return false; // nothing exists anywhere in this fixture view
        },
      };

      assert.throws(
        () => resolvePosixShell(io),
        /could not locate a real Git-for-Windows bash\.exe/i,
        "resolvePosixShell throws ONE clear, loud error rather than silently returning a WSL launcher or undefined"
      );
    },
  },
  {
    name: "installer-place/harness resolveGpg rejects a WSL-launcher gpg.exe and never accepts a WindowsApps shim",
    async run() {
      if (process.platform !== "win32") {
        console.warn("installer-place: resolveGpg WSL-rejection row is Windows-only -- skipped on this platform (flagged, not faked)");
        return;
      }
      const { resolveGpg } = await import("./installer-shell.mjs");
      const fakeGitRoot = "C:\\FakeGit";
      const io = {
        env: {
          Path: "C:\\Users\\fixture\\AppData\\Local\\Microsoft\\WindowsApps;" + fakeGitRoot + "\\usr\\bin",
          ProgramFiles: "C:\\NoGitHere",
        },
        execFileSync() {
          throw new Error("git: command not found (fixture: git is not installed)");
        },
        existsSync(candidate) {
          const normalized = candidate.toLowerCase();
          if (normalized === "c:\\users\\fixture\\appdata\\local\\microsoft\\windowsapps\\gpg.exe") return true;
          if (normalized === (fakeGitRoot + "\\usr\\bin\\gpg.exe").toLowerCase()) return true;
          return false;
        },
      };

      const resolved = resolveGpg(io);
      assert.equal(resolved, fakeGitRoot + "\\usr\\bin\\gpg.exe", "the WindowsApps gpg shim is rejected; the real Git Bash gpg is chosen");
    },
  },
];
