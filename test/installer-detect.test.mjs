// Traceability wiring for milestone 28 / story 02 (one-line-installer),
// task 00_os-arch-detect-and-download.feature.
//
// Covers EVERY @executable scenario in 00_os-arch-detect-and-download.feature by
// driving the REAL scripts through child processes:
//   - install.sh: sourced under bash/sh with AOF_INSTALL_TEST=1 (a guard that
//     defines every function but runs no network/main), then aof_detect(os, arch)
//     is invoked directly and its stdout/exit code asserted. On Windows the POSIX
//     shell is resolved EXPLICITLY via installer-shell.mjs (git --exec-path ->
//     Git root -> bin/bash.exe, WSL-launcher-excluding) rather than a bare `bash`
//     spawn -- a bare spawn is PATH-order-dependent and can silently resolve to
//     the WSL launcher (C:\Windows\System32\bash.exe) when run from a plain
//     PowerShell prompt, which either can't parse a Windows path or drops into a
//     WSL distro with none of this repo's fixtures. See installer-shell.mjs for
//     the full rationale.
//   - install.ps1: dot-sourced under powershell/pwsh with $env:AOF_INSTALL_TEST set,
//     then Resolve-AofAsset is invoked directly with fixed
//     -ProcessorArchitecture/-Is64BitOperatingSystem inputs (no real environment
//     read), asserting the returned Asset/Sidecar or the thrown "unsupported
//     platform" error.
//
// One test object per @executable scenario (the two Scenario Outlines fold their
// rows into one entry each, iterating the table exactly as authored). The @manual
// co-download scenario is NOT exercised here (it needs the real release host).
//
//   00_os-arch-detect-and-download.feature
//     - "OS/arch detection maps to the matching release asset and node-pty sidecar"
//       (Scenario Outline, 8 rows incl. Darwin aarch64 alias, amd64 alias, Windows AMD64/ARM64)
//     - "a 32-bit PowerShell host on a 64-bit Windows OS resolves the 64-bit asset (WOW64)"
//     - "an unsupported OS/arch fails loudly rather than downloading a wrong asset"
//       (Scenario Outline, 6 rows incl. an unparseable uname string)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePosixShell } from "./installer-shell.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installSh = path.join(repoRoot, "install.sh");
const installPs1 = path.join(repoRoot, "install.ps1");

// Resolved ONCE, explicitly -- never a bare `bash`/`sh` spawn (PATH-order
// dependent; can silently resolve to the WSL launcher). Throws loudly if no
// real Git Bash is found on Windows (installer-shell.mjs).
const POSIX_SHELL = resolvePosixShell();
const POWERSHELL = (() => {
  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
  return probe.status === 0 ? "pwsh" : "powershell";
})();

// runShDetect(os, arch) -> { stdout, status }
// Sources install.sh under AOF_INSTALL_TEST=1 (defines functions only) then
// calls aof_detect directly, `set +e` so a non-zero return doesn't kill the
// harness shell before we can capture it.
function runShDetect(uname_os, uname_arch) {
  const script = `
    AOF_INSTALL_TEST=1
    export AOF_INSTALL_TEST
    . "${toPosixPath(installSh)}"
    set +e
    aof_detect "$1" "$2"
    echo "EXIT:$?"
  `;
  const result = spawnSync(POSIX_SHELL.bash, ["-c", script, "_", uname_os, uname_arch], { encoding: "utf8" });
  return parseShOutput(result);
}

function runShUnameParse(rawUname) {
  // Shadow `uname` (called by aof_uname_pair as `uname -sm`) to echo the
  // fixture's raw, unparseable string regardless of args.
  const script = `
    AOF_INSTALL_TEST=1
    export AOF_INSTALL_TEST
    . "${toPosixPath(installSh)}"
    set +e
    uname() { printf '%s' "$1"; }
    aof_uname_pair "$@"
    echo "EXIT:$?"
  `;
  const result = spawnSync(POSIX_SHELL.bash, ["-c", script, "_", rawUname], { encoding: "utf8" });
  return parseShOutput(result);
}

function toPosixPath(p) {
  // Git Bash accepts native Windows paths in quotes; keep as-is (works cross-platform).
  return p.replace(/\\/g, "/");
}

function parseShOutput(result) {
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  const match = stdout.match(/EXIT:(-?\d+)\s*$/);
  const exit = match ? Number(match[1]) : null;
  const body = stdout.replace(/EXIT:-?\d+\s*$/, "").trimEnd();
  return { stdout: body, stderr, exit, spawnStatus: result.status };
}

// runPs1Resolve(procArch, is64) -> { asset, sidecar, error }
function runPs1Resolve(procArch, is64BitOperatingSystem) {
  const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
try {
  $r = Resolve-AofAsset -ProcessorArchitecture '${procArch}' -Is64BitOperatingSystem $${is64BitOperatingSystem ? "true" : "false"}
  Write-Output ("ASSET:" + $r.Asset)
  Write-Output ("SIDECAR:" + $r.Sidecar)
} catch {
  Write-Output ("ERROR:" + $_.Exception.Message)
}
`;
  const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  const stdout = result.stdout ?? "";
  const assetMatch = stdout.match(/ASSET:(\S+)/);
  const sidecarMatch = stdout.match(/SIDECAR:(\S+)/);
  const errorMatch = stdout.match(/ERROR:(.+)/);
  return {
    asset: assetMatch ? assetMatch[1] : null,
    sidecar: sidecarMatch ? sidecarMatch[1] : null,
    error: errorMatch ? errorMatch[1].trim() : null,
    raw: stdout,
    stderr: result.stderr,
    status: result.status,
  };
}

// The detect→asset-name mapping matrix, byte-identical to the feature's Examples
// table (install.sh side: uname -sm strings).
const SH_DETECT_ROWS = [
  { detected: "Darwin arm64", os: "Darwin", arch: "arm64", asset: "aof-macos-arm64", sidecar: "node-pty-darwin-arm64" },
  { detected: "Darwin aarch64", os: "Darwin", arch: "aarch64", asset: "aof-macos-arm64", sidecar: "node-pty-darwin-arm64" },
  { detected: "Darwin x86_64", os: "Darwin", arch: "x86_64", asset: "aof-macos-x64", sidecar: "node-pty-darwin-x64" },
  { detected: "Linux x86_64", os: "Linux", arch: "x86_64", asset: "aof-linux-x64", sidecar: "node-pty-linux-x64" },
  { detected: "Linux amd64", os: "Linux", arch: "amd64", asset: "aof-linux-x64", sidecar: "node-pty-linux-x64" },
  { detected: "Linux aarch64", os: "Linux", arch: "aarch64", asset: "aof-linux-arm64", sidecar: "node-pty-linux-arm64" },
];

// The Windows rows of the same table are exercised through install.ps1's
// Resolve-AofAsset (install.sh has no Windows leg; ADR-006 splits POSIX/PowerShell
// detection by script).
const PS1_DETECT_ROWS = [
  { detected: "Windows AMD64", procArch: "AMD64", is64: true, asset: "aof-windows-x64.exe", sidecar: "node-pty-win32-x64" },
  { detected: "Windows ARM64", procArch: "ARM64", is64: true, asset: "aof-windows-arm64.exe", sidecar: "node-pty-win32-arm64" },
];

const UNSUPPORTED_SH_ROWS = [
  { detected: "Linux i686", os: "Linux", arch: "i686" },
  { detected: "Linux armv7l", os: "Linux", arch: "armv7l" },
  { detected: "FreeBSD amd64", os: "FreeBSD", arch: "amd64" },
  { detected: "Linux ppc64le", os: "Linux", arch: "ppc64le" },
];

export const installerDetectTests = [
  // ══════ Scenario Outline: OS/arch detection maps to the matching release asset and node-pty sidecar ══════
  {
    name: "installer-detect/00 install.sh detect→asset mapping (Darwin/Linux rows incl. arch aliases)",
    async run() {
      for (const row of SH_DETECT_ROWS) {
        const { stdout, exit } = runShDetect(row.os, row.arch);
        assert.equal(exit, 0, `${row.detected}: aof_detect exits 0 (stderr: ${stdout})`);
        assert.equal(stdout, `${row.asset} ${row.sidecar}`, `${row.detected} resolves to ${row.asset} + ${row.sidecar}`);
      }
    },
  },
  {
    name: "installer-detect/00 install.ps1 detect→asset mapping (Windows AMD64/ARM64 rows)",
    async run() {
      for (const row of PS1_DETECT_ROWS) {
        const { asset, sidecar, error } = runPs1Resolve(row.procArch, row.is64);
        assert.equal(error, null, `${row.detected}: no error (got: ${error})`);
        assert.equal(asset, row.asset, `${row.detected} resolves to asset ${row.asset}`);
        assert.equal(sidecar, row.sidecar, `${row.detected} resolves to sidecar ${row.sidecar}`);
      }
    },
  },

  // ══════ Scenario: a 32-bit PowerShell host on a 64-bit Windows OS resolves the 64-bit asset (WOW64) ══════
  {
    name: "installer-detect/00 install.ps1 WOW64: x86 host process on a 64-bit OS trusts Is64BitOperatingSystem, not the host arch",
    async run() {
      const { asset, sidecar, error } = runPs1Resolve("x86", true);
      assert.equal(error, null, `WOW64 row: no error (got: ${error})`);
      assert.equal(asset, "aof-windows-x64.exe", "WOW64 resolves to the 64-bit asset, trusting Is64BitOperatingSystem");
      assert.equal(sidecar, "node-pty-win32-x64", "WOW64 resolves the matching 64-bit sidecar");
    },
  },

  // ══════ Scenario Outline: an unsupported OS/arch fails loudly rather than downloading a wrong asset ══════
  {
    name: "installer-detect/00 install.sh unsupported OS/arch combos fail loudly and select nothing",
    async run() {
      for (const row of UNSUPPORTED_SH_ROWS) {
        const { stdout, stderr, exit } = runShDetect(row.os, row.arch);
        assert.notEqual(exit, 0, `${row.detected}: aof_detect exits non-zero`);
        assert.equal(stdout, "", `${row.detected}: no asset name is printed to stdout`);
        assert.match(stderr, /unsupported platform/i, `${row.detected}: a clear "unsupported platform" error is emitted`);
        assert.ok(stderr.includes(row.os) || stderr.includes(row.arch), `${row.detected}: the error names the detected OS/arch`);
      }
    },
  },
  {
    name: "installer-detect/00 install.sh Windows x86 (32-bit, no build) fails loudly via install.ps1's own guard",
    async run() {
      // Windows x86 (a true 32-bit OS, Is64BitOperatingSystem=false) is the
      // PowerShell-side unsupported row — install.sh never runs on Windows, so
      // this row is exercised through Resolve-AofAsset, matching the feature's
      // intent (no build is shipped for a 32-bit Windows OS).
      const { asset, sidecar, error } = runPs1Resolve("x86", false);
      assert.equal(asset, null, "Windows x86 (32-bit OS): no asset is resolved");
      assert.equal(sidecar, null, "Windows x86 (32-bit OS): no sidecar is resolved");
      assert.match(error ?? "", /unsupported platform/i, "Windows x86 (32-bit OS): a clear unsupported-platform error is thrown");
    },
  },
  {
    name: "installer-detect/00 install.sh an unparseable uname string fails loudly and downloads nothing",
    async run() {
      const { stdout, stderr, exit } = runShUnameParse("garbage-with-no-fields");
      assert.notEqual(exit, 0, "an unparseable uname output exits non-zero");
      assert.equal(stdout, "", "no asset name is printed");
      assert.match(stderr, /could not parse uname|unsupported platform/i, "a clear error is emitted for the unparseable uname string");
    },
  },
];
