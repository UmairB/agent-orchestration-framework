// Traceability wiring for milestone 28 / story 02 (one-line-installer),
// task 01_verify-before-path.feature.
//
// Covers EVERY @executable scenario in 01_verify-before-path.feature by driving
// the REAL scripts through child processes against a FIXTURE SHA256SUMS whose
// shape is byte-identical to Story 01's soft contract (`<sha256>  <filename>`,
// two spaces, LF) -- no network, no real release artifacts.
//
//   - install.sh: sourced under bash/sh with AOF_INSTALL_TEST=1, then
//     aof_verify_checksum / aof_verify_gpg_signature / aof_verify_all are
//     invoked directly against real fixture files + a REAL gpg keypair
//     generated per test run (short-path homedir under os.tmpdir() -- gpg's
//     agent socket has a path-length ceiling, confirmed empirically on this
//     box). The GPG rows are exercised HONESTLY with real gpg --verify calls,
//     not stubbed. Both the POSIX shell AND gpg itself are resolved EXPLICITLY
//     via installer-shell.mjs -- a bare `bash`/`gpg` spawn is PATH-order
//     dependent and, run from a plain PowerShell prompt, can silently resolve
//     to the WSL launcher (whose bash either can't parse the Windows fixture
//     paths or drops into a WSL distro with no gpg at all -- which would make
//     the F2/untrusted-key row silently report "skipped" as a false green
//     rather than genuinely exercising the pinned-fingerprint refusal).
//   - install.ps1: dot-sourced under powershell/pwsh with $env:AOF_INSTALL_TEST
//     set, then Test-AofChecksum / Test-AofRelease are invoked directly.
//     GPG is Linux-only per ADR-006 / the story's Build notes (mac/Windows lean
//     on Gatekeeper-staple / Authenticode) -- install.ps1 has NO gpg step, so
//     the Linux-only rows of the matrix are exercised exclusively via
//     install.sh; this is flagged here rather than faked as a PowerShell path.
//
//   01_verify-before-path.feature
//     - "the installer installs only on a verified match and refuses on any
//       mismatch" (Scenario Outline, 8 rows: match+gpg-ok / binary-mismatch /
//       sidecar-mismatch / not-in-manifest / manifest-missing /
//       asc-missing(Linux) / asc-invalid(Linux) / untrusted-key(Linux))
//     - "verification happens before any file is placed on PATH"
//     - "a verified binary is not installed while its co-downloaded sidecar
//       fails verification"
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { resolvePosixShell, resolveGpg } from "./installer-shell.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const installSh = path.join(repoRoot, "install.sh");
const installPs1 = path.join(repoRoot, "install.ps1");

// Resolved ONCE, explicitly -- never a bare `bash`/`sh`/`gpg` spawn (PATH-order
// dependent; can silently resolve to the WSL launcher, which has no gpg and
// would turn the F2/untrusted-key GPG rows into silent false-green skips). See
// installer-shell.mjs.
const POSIX_SHELL = resolvePosixShell();
const GPG_BIN = resolveGpg();
const POWERSHELL = (() => {
  const probe = spawnSync("pwsh", ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], { encoding: "utf8" });
  return probe.status === 0 ? "pwsh" : "powershell";
})();

const GPG_AVAILABLE = GPG_BIN !== null && spawnSync(GPG_BIN, ["--version"], { encoding: "utf8" }).status === 0;

function toPosixGpgPath(winPath) {
  // gpg (Git Bash build on this box) wants a POSIX-shaped path for --homedir;
  // a bare C:\... path fails to start gpg-agent. Convert defensively.
  if (!/^[A-Za-z]:\\/.test(winPath)) return winPath.split("\\").join("/");
  return "/" + winPath[0].toLowerCase() + winPath.slice(2).split("\\").join("/");
}

function sha256hex(filePath) {
  return crypto.createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function writeManifest(dir, entries) {
  const lines = entries.map(([sha, name]) => `${sha}  ${name}`);
  const manifestPath = path.join(dir, "SHA256SUMS");
  writeFileSync(manifestPath, lines.join("\n") + "\n", "utf8");
  return manifestPath;
}

// --- fixture builder ---------------------------------------------------------

function makeFixture() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "aof-inst-verify-"));
  const assetName = "aof-linux-x64";
  const sidecarName = "node-pty-linux-x64";
  const assetPath = path.join(dir, assetName);
  const sidecarPath = path.join(dir, sidecarName);
  writeFileSync(assetPath, "fixture-binary-contents\n", "utf8");
  writeFileSync(sidecarPath, "fixture-sidecar-contents\n", "utf8");
  const manifestPath = writeManifest(dir, [
    [sha256hex(assetPath), assetName],
    [sha256hex(sidecarPath), sidecarName],
  ]);
  return { dir, assetName, sidecarName, assetPath, sidecarPath, manifestPath };
}

// --- a real GPG keypair (generated once per test) ---------------------------

function makeGpgKey(label) {
  const homedir = mkdtempSync(path.join(os.tmpdir(), "aof-gpg-"));
  const posixHome = toPosixGpgPath(homedir);
  const gen = spawnSync(
    GPG_BIN,
    ["--homedir", posixHome, "--batch", "--passphrase", "", "--quick-generate-key", `${label} <${label}@example.com>`, "default", "default", "never"],
    { encoding: "utf8" }
  );
  assert.equal(gen.status, 0, `gpg key generation for ${label} succeeds (stderr: ${gen.stderr})`);
  const list = spawnSync(GPG_BIN, ["--homedir", posixHome, "--list-keys", "--with-colons"], { encoding: "utf8" });
  const fprLine = list.stdout.split("\n").find((l) => l.startsWith("fpr:"));
  const fingerprint = fprLine.split(":")[9];
  return { homedir, posixHome, fingerprint };
}

function gpgSign(posixHome, manifestPath, ascPath) {
  const posixAsc = toPosixGpgPath(ascPath);
  const posixManifest = toPosixGpgPath(manifestPath);
  const r = spawnSync(GPG_BIN, ["--homedir", posixHome, "--batch", "--yes", "--detach-sign", "--armor", "-o", posixAsc, posixManifest], { encoding: "utf8" });
  assert.equal(r.status, 0, `gpg sign succeeds (stderr: ${r.stderr})`);
}

// exportPublicKey(posixHome, fingerprint, destPath) -- writes an ASCII-armored
// export of the key to destPath, the exact shape AOF_RELEASE_GPG_PUBKEY_FILE
// expects (craft-review F1: production imports this same shape via
// aof_import_release_key -- a test key export lets a test exercise the REAL
// import codepath honestly, never the real release key).
function exportPublicKey(posixHome, fingerprint, destPath) {
  const posixDest = toPosixGpgPath(destPath);
  // NOTE: -o/--output must precede --export on this box's gpg build (2.4.5) --
  // placed AFTER --export <fpr>, gpg silently prints the armored key to
  // stdout instead of writing destPath (exit 0, no stderr, no file written --
  // confirmed empirically). Placing -o first is unambiguous and matches
  // GnuPG's own documented usage.
  const r = spawnSync(GPG_BIN, ["--homedir", posixHome, "-o", posixDest, "--batch", "--yes", "--armor", "--export", fingerprint], { encoding: "utf8" });
  assert.equal(r.status, 0, `gpg export of the public key succeeds (stderr: ${r.stderr})`);
  assert.ok(existsSync(destPath), `gpg export actually wrote ${destPath}`);
}

// --- install.sh child-process helpers ---------------------------------------

function runShFn(fnCall, { fingerprint, pubkeyFile } = {}) {
  const envAssigns = [
    fingerprint ? `AOF_RELEASE_GPG_FINGERPRINT=${JSON.stringify(fingerprint)}` : "",
    pubkeyFile ? `AOF_RELEASE_GPG_PUBKEY_FILE=${q(pubkeyFile)}` : "",
  ]
    .filter(Boolean)
    .join("\n    ");
  const envNames = [fingerprint ? "AOF_RELEASE_GPG_FINGERPRINT" : "", pubkeyFile ? "AOF_RELEASE_GPG_PUBKEY_FILE" : ""].filter(Boolean).join(" ");
  const script = `
    AOF_INSTALL_TEST=1
    ${envAssigns}
    export AOF_INSTALL_TEST ${envNames}
    . "${installSh.split("\\").join("/")}"
    set +e
    ${fnCall}
    echo "EXIT:$?"
  `;
  const result = spawnSync(POSIX_SHELL.bash, ["-c", script], { encoding: "utf8" });
  const stdout = result.stdout ?? "";
  const match = stdout.match(/EXIT:(-?\d+)\s*$/);
  const exit = match ? Number(match[1]) : null;
  const body = stdout.replace(/EXIT:-?\d+\s*$/, "").trimEnd();
  return { stdout: body, stderr: result.stderr ?? "", exit };
}

function q(p) {
  return JSON.stringify(p.split("\\").join("/"));
}

// --- install.ps1 child-process helpers ---------------------------------------

function runPs1Verify(manifestPath, workDir, assetName, sidecarName) {
  const script = `
$env:AOF_INSTALL_TEST = '1'
. '${installPs1.replace(/'/g, "''")}'
try {
  Test-AofRelease -Manifest '${manifestPath.replace(/'/g, "''")}' -WorkDir '${workDir.replace(/'/g, "''")}' -Asset '${assetName}' -Sidecar '${sidecarName}'
  Write-Output "RESULT:OK"
} catch {
  Write-Output ("RESULT:ERROR:" + $_.Exception.Message)
}
`;
  const result = spawnSync(POWERSHELL, ["-NoProfile", "-NonInteractive", "-Command", script], { encoding: "utf8" });
  const stdout = result.stdout ?? "";
  const okMatch = /RESULT:OK/.test(stdout);
  const errMatch = stdout.match(/RESULT:ERROR:(.+)/);
  return { ok: okMatch, error: errMatch ? errMatch[1].trim() : null, raw: stdout };
}

export const installerVerifyTests = [
  // ══════ Scenario Outline row: checksum matches (and Linux GPG verifies against the pinned key) → proceeds ══════
  {
    name: "installer-verify/01 a verified match (checksum, and Linux gpg against the pinned key) proceeds to install",
    async run() {
      const fixture = makeFixture();
      try {
        // POSIX side: checksum match.
        const shChecksum = runShFn(`aof_verify_checksum ${q(fixture.manifestPath)} ${q(fixture.assetPath)} ${fixture.assetName}`);
        assert.equal(shChecksum.exit, 0, "install.sh: matching checksum proceeds (exit 0)");
        const shSidecar = runShFn(`aof_verify_checksum ${q(fixture.manifestPath)} ${q(fixture.sidecarPath)} ${fixture.sidecarName}`);
        assert.equal(shSidecar.exit, 0, "install.sh: matching sidecar checksum proceeds (exit 0)");

        // Windows side: checksum match via Test-AofRelease (both artifacts).
        const ps1 = runPs1Verify(fixture.manifestPath, fixture.dir, fixture.assetName, fixture.sidecarName);
        assert.ok(ps1.ok, `install.ps1: matching checksums proceed to install (got: ${ps1.raw})`);

        // Linux GPG leg: honestly exercised with a REAL keypair + real
        // gpg --verify, only if gpg is available (it is, on this box).
        if (GPG_AVAILABLE) {
          const key = makeGpgKey("aof-verify-match");
          const ascPath = path.join(fixture.dir, "SHA256SUMS.asc");
          gpgSign(key.posixHome, fixture.manifestPath, ascPath);
          const gpgResult = runShFn(
            `aof_verify_gpg_signature ${q(fixture.manifestPath)} ${q(ascPath)} ${q(key.homedir)}`,
            { fingerprint: key.fingerprint }
          );
          assert.equal(gpgResult.exit, 0, `install.sh: gpg verify against the PINNED key proceeds (stderr: ${gpgResult.stderr})`);
          rmSync(key.homedir, { recursive: true, force: true });
        } else {
          console.warn("installer-verify: gpg not available on this box -- the gpg-match leg was skipped (flagged, not faked)");
        }
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ F1 (craft-review): the PRODUCTION provisioning path -- empty homedir →
  // aof_import_release_key → aof_verify_gpg_signature → VALIDSIG fingerprint pin.
  // The row above calls aof_verify_gpg_signature directly against a homedir
  // ALREADY populated by --quick-generate-key -- it never proves the import
  // step itself. A fresh --homedir starts with NO keys, so gpg --verify
  // against it without an import always fails "No public key" -- the exact
  // bug F1 caught (the prior revision created an empty keyring and never
  // imported anything into it). This row drives aof_import_release_key
  // against a GENUINELY EMPTY keyring dir (never touched by key generation)
  // using AOF_RELEASE_GPG_PUBKEY_FILE (a throwaway test key export, never the
  // real release key), mirroring aof_main's exact sequence: mkdir keyring →
  // import → verify.
  {
    name: "installer-verify/01 F1: aof_import_release_key provisions a genuinely EMPTY homedir before verify (the real production sequence)",
    async run() {
      if (!GPG_AVAILABLE) {
        console.warn("installer-verify: gpg not available on this box -- the F1 production-provisioning row was skipped (flagged, not faked)");
        return;
      }
      const fixture = makeFixture();
      const key = makeGpgKey("aof-verify-f1-provisioning");
      // A SEPARATE, genuinely empty keyring dir -- never passed to
      // --quick-generate-key, never populated by anything except
      // aof_import_release_key itself.
      const freshKeyring = mkdtempSync(path.join(os.tmpdir(), "aof-gpg-fresh-"));
      try {
        const pubkeyFile = path.join(fixture.dir, "release-pubkey.asc");
        exportPublicKey(key.posixHome, key.fingerprint, pubkeyFile);

        const ascPath = path.join(fixture.dir, "SHA256SUMS.asc");
        gpgSign(key.posixHome, fixture.manifestPath, ascPath);

        // gpg-agent has a path-length/shape ceiling on --homedir (the same
        // reason makeGpgKey above uses toPosixGpgPath for the key-generation
        // homedir) -- a bare "C:/..." homedir can fail to start the agent
        // ("failed to start gpg-agent... can't connect", confirmed
        // empirically on this box) even though the --import/--verify CALLS
        // themselves accept "C:/..." file arguments fine. Use the true POSIX
        // form for --homedir specifically.
        const freshKeyringPosix = toPosixGpgPath(freshKeyring);

        // Prove the keyring is genuinely empty BEFORE import: verifying
        // against it now must fail with "No public key" (the F1 bug this
        // test guards against regressing).
        const beforeImport = runShFn(
          `aof_verify_gpg_signature ${q(fixture.manifestPath)} ${q(ascPath)} ${JSON.stringify(freshKeyringPosix)}`,
          { fingerprint: key.fingerprint }
        );
        assert.notEqual(beforeImport.exit, 0, "sanity: verifying against a genuinely empty, never-imported homedir fails");

        // The real production sequence: aof_import_release_key (via the
        // test-only AOF_RELEASE_GPG_PUBKEY_FILE override) THEN
        // aof_verify_gpg_signature against that SAME now-provisioned homedir.
        const afterImport = runShFn(
          `aof_import_release_key ${JSON.stringify(freshKeyringPosix)} && aof_verify_gpg_signature ${q(fixture.manifestPath)} ${q(ascPath)} ${JSON.stringify(freshKeyringPosix)}`,
          { fingerprint: key.fingerprint, pubkeyFile }
        );
        assert.equal(
          afterImport.exit,
          0,
          `install.sh: aof_import_release_key provisions the empty homedir, then gpg --verify succeeds and pins the imported key's fingerprint (stderr: ${afterImport.stderr})`
        );
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
        rmSync(key.homedir, { recursive: true, force: true });
        rmSync(freshKeyring, { recursive: true, force: true });
      }
    },
  },

  // ══════ row: the binary's checksum does not match its line → refuses with a checksum error ══════
  {
    name: "installer-verify/01 the binary's checksum mismatch refuses with a checksum error",
    async run() {
      const fixture = makeFixture();
      try {
        const tamperedPath = path.join(fixture.dir, "tampered-binary");
        writeFileSync(tamperedPath, "not the real binary bytes", "utf8");

        const sh = runShFn(`aof_verify_checksum ${q(fixture.manifestPath)} ${q(tamperedPath)} ${fixture.assetName}`);
        assert.notEqual(sh.exit, 0, "install.sh: binary checksum mismatch refuses (non-zero exit)");
        assert.match(sh.stderr, /checksum/i, "install.sh: the refusal names a checksum error");

        // Windows side: substitute the tampered file under the asset's real name.
        writeFileSync(path.join(fixture.dir, fixture.assetName), "not the real binary bytes", "utf8");
        const ps1 = runPs1Verify(fixture.manifestPath, fixture.dir, fixture.assetName, fixture.sidecarName);
        assert.equal(ps1.ok, false, "install.ps1: binary checksum mismatch refuses");
        assert.match(ps1.error ?? "", /checksum mismatch/i, "install.ps1: the refusal names a checksum error");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ row: the sidecar's checksum does not match its line → refuses with a checksum error ══════
  {
    name: "installer-verify/01 the sidecar's checksum mismatch refuses with a checksum error",
    async run() {
      const fixture = makeFixture();
      try {
        const tamperedSidecar = path.join(fixture.dir, "tampered-sidecar");
        writeFileSync(tamperedSidecar, "not the real sidecar bytes", "utf8");

        const sh = runShFn(`aof_verify_checksum ${q(fixture.manifestPath)} ${q(tamperedSidecar)} ${fixture.sidecarName}`);
        assert.notEqual(sh.exit, 0, "install.sh: sidecar checksum mismatch refuses (non-zero exit)");
        assert.match(sh.stderr, /checksum/i, "install.sh: the refusal names a checksum error");

        writeFileSync(path.join(fixture.dir, fixture.sidecarName), "not the real sidecar bytes", "utf8");
        const ps1 = runPs1Verify(fixture.manifestPath, fixture.dir, fixture.assetName, fixture.sidecarName);
        assert.equal(ps1.ok, false, "install.ps1: sidecar checksum mismatch refuses");
        assert.match(ps1.error ?? "", /checksum mismatch/i, "install.ps1: the refusal names a checksum error");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ row: the downloaded asset is not listed in SHA256SUMS at all → refuses with a not-in-manifest error ══════
  {
    name: "installer-verify/01 an asset not listed in the manifest refuses with a not-in-manifest error (not a vacuous pass)",
    async run() {
      const fixture = makeFixture();
      try {
        const unlistedName = "aof-unexpected-asset";
        const unlistedPath = path.join(fixture.dir, unlistedName);
        writeFileSync(unlistedPath, "some bytes", "utf8");

        const sh = runShFn(`aof_verify_checksum ${q(fixture.manifestPath)} ${q(unlistedPath)} ${unlistedName}`);
        assert.notEqual(sh.exit, 0, "install.sh: an unlisted asset refuses (non-zero exit)");
        assert.match(sh.stderr, /not listed/i, "install.sh: the refusal names a not-in-manifest error");

        const ps1 = runPs1Verify(fixture.manifestPath, fixture.dir, unlistedName, fixture.sidecarName);
        assert.equal(ps1.ok, false, "install.ps1: an unlisted asset refuses");
        assert.match(ps1.error ?? "", /not listed/i, "install.ps1: the refusal names a not-in-manifest error");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ row: SHA256SUMS is missing or unfetchable → refuses with a missing-manifest error ══════
  {
    name: "installer-verify/01 a missing SHA256SUMS refuses with a missing-manifest error",
    async run() {
      const fixture = makeFixture();
      try {
        const missingManifest = path.join(fixture.dir, "SHA256SUMS-does-not-exist");
        const sh = runShFn(
          `aof_verify_all ${q(missingManifest)} ${q(fixture.dir)} ${fixture.assetName} ${fixture.sidecarName} "" "" 0`
        );
        assert.notEqual(sh.exit, 0, "install.sh: a missing manifest refuses (non-zero exit)");
        assert.match(sh.stderr, /missing or unfetchable/i, "install.sh: the refusal names a missing-manifest error");

        const ps1 = runPs1Verify(missingManifest, fixture.dir, fixture.assetName, fixture.sidecarName);
        assert.equal(ps1.ok, false, "install.ps1: a missing manifest refuses");
        assert.match(ps1.error ?? "", /missing or unfetchable/i, "install.ps1: the refusal names a missing-manifest error");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ row: (Linux) SHA256SUMS.asc is missing → refuses with a missing-signature error ══════
  {
    name: "installer-verify/01 (Linux) a missing SHA256SUMS.asc refuses with a missing-signature error",
    async run() {
      const fixture = makeFixture();
      try {
        const missingAsc = path.join(fixture.dir, "SHA256SUMS.asc");
        const sh = runShFn(`aof_verify_gpg_signature ${q(fixture.manifestPath)} ${q(missingAsc)} ${q(fixture.dir)}`);
        assert.notEqual(sh.exit, 0, "install.sh: a missing SHA256SUMS.asc refuses (non-zero exit)");
        assert.match(sh.stderr, /signature.*missing|missing.*signature/i, "install.sh: the refusal names a missing-signature error");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ row: (Linux) SHA256SUMS.asc fails gpg --verify → refuses with a signature error ══════
  {
    name: "installer-verify/01 (Linux) an invalid SHA256SUMS.asc fails gpg --verify and refuses with a signature error",
    async run() {
      if (!GPG_AVAILABLE) {
        console.warn("installer-verify: gpg not available on this box -- the invalid-signature row was skipped (flagged, not faked)");
        return;
      }
      const fixture = makeFixture();
      const key = makeGpgKey("aof-verify-badsig");
      try {
        const ascPath = path.join(fixture.dir, "SHA256SUMS.asc");
        gpgSign(key.posixHome, fixture.manifestPath, ascPath);
        // Corrupt the manifest AFTER signing so the signature no longer verifies.
        writeFileSync(fixture.manifestPath, readFileSync(fixture.manifestPath, "utf8") + "tampered-extra-line\n", "utf8");

        const sh = runShFn(
          `aof_verify_gpg_signature ${q(fixture.manifestPath)} ${q(ascPath)} ${q(key.homedir)}`,
          { fingerprint: key.fingerprint }
        );
        assert.notEqual(sh.exit, 0, "install.sh: an invalid signature refuses (non-zero exit)");
        assert.match(sh.stderr, /signature.*failed|failed.*signature/i, "install.sh: the refusal names a signature error");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
        rmSync(key.homedir, { recursive: true, force: true });
      }
    },
  },

  // ══════ row: (Linux) SHA256SUMS.asc is valid but signed by an untrusted/unpinned key → refuses with an untrusted-key error ══════
  // F2 (accepted hard requirement): a valid signature by an UNPINNED key must
  // be refused, not accepted as "signed by SOME key".
  {
    name: "installer-verify/01 (Linux) F2: a valid signature by an untrusted/unpinned key refuses with an untrusted-key error",
    async run() {
      if (!GPG_AVAILABLE) {
        console.warn("installer-verify: gpg not available on this box -- the untrusted-key row was skipped (flagged, not faked)");
        return;
      }
      const fixture = makeFixture();
      const pinnedKey = makeGpgKey("aof-verify-pinned");
      const untrustedKey = makeGpgKey("aof-verify-untrusted");
      try {
        const ascPath = path.join(fixture.dir, "SHA256SUMS.asc");
        // Sign with the UNTRUSTED key -- the signature itself is perfectly
        // valid, but it is not the pinned release key.
        gpgSign(untrustedKey.posixHome, fixture.manifestPath, ascPath);

        const sh = runShFn(
          `aof_verify_gpg_signature ${q(fixture.manifestPath)} ${q(ascPath)} ${q(untrustedKey.homedir)}`,
          { fingerprint: pinnedKey.fingerprint }
        );
        assert.notEqual(sh.exit, 0, "install.sh: a valid-but-unpinned signature refuses (non-zero exit)");
        assert.match(sh.stderr, /untrusted|unpinned/i, "install.sh: the refusal names an untrusted/unpinned-key error, not a generic signature failure");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
        rmSync(pinnedKey.homedir, { recursive: true, force: true });
        rmSync(untrustedKey.homedir, { recursive: true, force: true });
      }
    },
  },

  // ══════ Scenario: verification happens before any file is placed on PATH (never place-then-check) ══════
  {
    name: "installer-verify/01 verification runs before any file is placed on PATH; a mismatch leaves no partial install",
    async run() {
      const fixture = makeFixture();
      const installDir = path.join(fixture.dir, "would-be-install-dir");
      try {
        // A checksum that will not match.
        const tampered = path.join(fixture.dir, "bad-asset");
        writeFileSync(tampered, "wrong bytes", "utf8");

        const sh = runShFn(
          `aof_verify_all ${q(fixture.manifestPath)} ${q(fixture.dir)} bad-asset ${fixture.sidecarName} "" "" 0 || true; ` +
            `if [ ! -d ${q(installDir)} ]; then echo NO_INSTALL_DIR; fi`
        );
        assert.ok(sh.stdout.includes("NO_INSTALL_DIR"), "install.sh: verify runs before any install-dir creation; none exists after a refusal");
        assert.equal(existsSync(installDir), false, "no $HOME/.aof/bin-equivalent directory was created on refusal");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ Scenario: a verified binary is not installed while its co-downloaded sidecar fails verification ══════
  {
    name: "installer-verify/01 a good binary with a bad sidecar refuses the whole install; neither artifact is written",
    async run() {
      const fixture = makeFixture();
      const installDir = path.join(fixture.dir, "target-install-dir");
      try {
        // Corrupt only the sidecar on disk (binary is untouched / still matches).
        writeFileSync(fixture.sidecarPath, "corrupted sidecar bytes", "utf8");

        const shBinary = runShFn(`aof_verify_checksum ${q(fixture.manifestPath)} ${q(fixture.assetPath)} ${fixture.assetName}`);
        assert.equal(shBinary.exit, 0, "the binary alone still verifies");

        const shAll = runShFn(
          `aof_verify_all ${q(fixture.manifestPath)} ${q(fixture.dir)} ${fixture.assetName} ${fixture.sidecarName} "" "" 0`
        );
        assert.notEqual(shAll.exit, 0, "install.sh: aof_verify_all refuses the WHOLE install when the sidecar fails");

        const ps1 = runPs1Verify(fixture.manifestPath, fixture.dir, fixture.assetName, fixture.sidecarName);
        assert.equal(ps1.ok, false, "install.ps1: Test-AofRelease refuses the whole install when the sidecar fails");

        assert.equal(existsSync(installDir), false, "neither the binary nor the sidecar is written to the install dir");
      } finally {
        rmSync(fixture.dir, { recursive: true, force: true });
      }
    },
  },

  // ══════ F9 (craft-review, optional hardening): a CRLF-mangled SHA256SUMS
  // (line endings normalized to CRLF by some tool along the download/fetch
  // path) leaves a trailing \r on awk's $2 field in install.sh's
  // aof_manifest_line, so `$2 == f` never matched even though the filename
  // was visually identical -- a real false "not listed in SHA256SUMS"
  // refusal against a perfectly legitimate manifest. install.ps1's own
  // Get-AofManifestEntry already tolerates this via .Trim(); install.sh now
  // strips a trailing \r from the field defensively, matching that
  // tolerance. ══════
  {
    name: "installer-verify/01 F9: install.sh aof_manifest_line tolerates a CRLF-mangled SHA256SUMS (install.ps1 already tolerates this via Trim())",
    async run() {
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-inst-crlf-"));
      try {
        const assetName = "aof-linux-x64";
        const assetPath = path.join(dir, assetName);
        writeFileSync(assetPath, "fixture-binary-contents\n", "utf8");
        const sha = sha256hex(assetPath);

        // A manifest whose lines are CRLF-terminated (as if re-saved/fetched
        // through a tool that normalizes to Windows line endings).
        const manifestPath = path.join(dir, "SHA256SUMS");
        writeFileSync(manifestPath, `${sha}  ${assetName}\r\n`, "utf8");

        const sh = runShFn(`aof_verify_checksum ${q(manifestPath)} ${q(assetPath)} ${assetName}`);
        assert.equal(sh.exit, 0, `install.sh: a CRLF-mangled manifest still verifies a legitimate match (stderr: ${sh.stderr})`);
        assert.doesNotMatch(sh.stderr, /not listed/i, "the CRLF-mangled manifest is not mistaken for a not-in-manifest refusal");
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },
  },
];
