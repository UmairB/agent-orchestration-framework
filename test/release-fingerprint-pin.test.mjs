// Traceability wiring for milestone 28 / story 01 (signing-notarization) —
// craft-review F3 (HIGH): install.sh's pinned GPG fingerprint was previously
// unverifiable against the actual CI signing key — a one-byte drift means
// every Linux install refuses forever (install.sh's Build note F2
// untrusted/unpinned-key refusal). This drives the REAL
// scripts/release/assert-fingerprint-pin.mjs over REAL gpg keypairs (no
// stubs) against three crafted install.sh fixtures:
//   - a MATCH: install.sh's embedded key + AOF_RELEASE_GPG_FINGERPRINT agree
//     with EACH OTHER and with the CI-imported key -> passes cleanly.
//   - a SELF-INCONSISTENT install.sh: the embedded key's own fingerprint
//     disagrees with the AOF_RELEASE_GPG_FINGERPRINT variable (install.sh's
//     ACTUAL runtime trust gate) -> a distinct, clearly-labelled failure.
//   - a CI-KEY MISMATCH: install.sh is internally consistent, but pins a
//     DIFFERENT key than the one actually imported into the CI keyring (the
//     literal F3 lockout scenario) -> a distinct, clearly-labelled failure.
//
// Reuses the shared WSL-launcher-excluding gpg resolver (test/installer-shell.mjs)
// so this test is not subject to the same PATH-order gpg-resolution trap the
// coordinator already hardened the installer tests against.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolveGpg, toGitBashPosixPath } from "./installer-shell.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(repoRoot, "scripts", "release", "assert-fingerprint-pin.mjs");
const realInstallSh = path.join(repoRoot, "install.sh");

const GPG_BIN = resolveGpg();
const GPG_AVAILABLE = GPG_BIN !== null && spawnSync(GPG_BIN, ["--version"], { encoding: "utf8" }).status === 0;

function makeGpgKey(label) {
  const homedir = mkdtempSync(path.join(os.tmpdir(), "aof-fpr-gpg-"));
  const posixHome = toGitBashPosixPath(homedir);
  const gen = spawnSync(
    GPG_BIN,
    ["--homedir", posixHome, "--batch", "--passphrase", "", "--quick-generate-key", `${label} <${label}@example.com>`, "default", "default", "never"],
    { encoding: "utf8" }
  );
  assert.equal(gen.status, 0, `gpg key generation for ${label} succeeds (stderr: ${gen.stderr})`);
  const list = spawnSync(GPG_BIN, ["--homedir", posixHome, "--list-secret-keys", "--with-colons"], { encoding: "utf8" });
  const fprLine = list.stdout.split("\n").find((l) => l.startsWith("fpr:"));
  const fingerprint = fprLine.split(":")[9];
  const pubkey = spawnSync(GPG_BIN, ["--homedir", posixHome, "--export", "--armor", fingerprint], { encoding: "utf8" }).stdout.trim();
  return { homedir, posixHome, fingerprint, pubkey };
}

// buildFixtureInstallSh(dir, { embeddedKeyPubkey, trustGateFingerprint }) ->
// a copy of the REAL install.sh with its placeholder embedded key block and
// AOF_RELEASE_GPG_FINGERPRINT literal swapped for the given test values —
// mirrors the ACTUAL two pin sites in the real file (never hand-rolled).
function buildFixtureInstallSh(dir, { embeddedKeyPubkey, trustGateFingerprint }) {
  const source = readFileSync(realInstallSh, "utf8");
  let out = source.replace(
    /-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/,
    embeddedKeyPubkey
  );
  out = out.replace(
    /AOF_RELEASE_GPG_FINGERPRINT="\$\{AOF_RELEASE_GPG_FINGERPRINT:-[0-9A-Fa-f]+\}"/,
    `AOF_RELEASE_GPG_FINGERPRINT="\${AOF_RELEASE_GPG_FINGERPRINT:-${trustGateFingerprint}}"`
  );
  const fixturePath = path.join(dir, "install.sh");
  writeFileSync(fixturePath, out, "utf8");
  return fixturePath;
}

function runAssertScript(homedir, installShPath) {
  const result = spawnSync(
    process.execPath,
    [scriptPath, "--homedir", homedir, "--install-sh", installShPath],
    {
      encoding: "utf8",
      // Pass the SAME resolved gpg binary this test's own keypair operations
      // use — bare `gpg` inside the spawned assert-fingerprint-pin.mjs
      // process is just as parent-shell-dependent as it is here (a
      // PowerShell/cmd parent may not resolve gpg on PATH at all).
      env: { ...process.env, AOF_GPG_BIN: GPG_BIN },
    }
  );
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

export const releaseFingerprintPinTests = [
  {
    name: "release-fingerprint-pin/00 a self-consistent install.sh matching the CI signing key passes cleanly",
    run: async () => {
      if (!GPG_AVAILABLE) {
        console.warn("release-fingerprint-pin: gpg not available on this box — the match row was skipped (flagged, not faked)");
        return;
      }
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-fpr-test-"));
      const key = makeGpgKey("aof-fpr-match");
      try {
        const fixturePath = buildFixtureInstallSh(dir, { embeddedKeyPubkey: key.pubkey, trustGateFingerprint: key.fingerprint });
        const result = runAssertScript(key.homedir, fixturePath);
        assert.equal(result.status, 0, `the assert script exits 0 on a real match (stderr: ${result.stderr})`);
        assert.match(result.stdout, /OK — install\.sh's pinned fingerprint matches the CI signing key/, "the success message names the match explicitly");
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(key.homedir, { recursive: true, force: true });
      }
    },
  },

  {
    name: "release-fingerprint-pin/01 a SELF-INCONSISTENT install.sh (embedded key's own fingerprint disagrees with the AOF_RELEASE_GPG_FINGERPRINT trust-gate variable) fails with a distinct, clearly-labelled error",
    run: async () => {
      if (!GPG_AVAILABLE) {
        console.warn("release-fingerprint-pin: gpg not available on this box — the self-inconsistency row was skipped (flagged, not faked)");
        return;
      }
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-fpr-test-"));
      const key = makeGpgKey("aof-fpr-selfinconsistent");
      const ciKey = makeGpgKey("aof-fpr-selfinconsistent-ci");
      try {
        // The embedded key is `key`, but the pinned trust-gate variable
        // claims a DIFFERENT (ciKey's) fingerprint — self-inconsistent.
        const fixturePath = buildFixtureInstallSh(dir, { embeddedKeyPubkey: key.pubkey, trustGateFingerprint: ciKey.fingerprint });
        const result = runAssertScript(ciKey.homedir, fixturePath);
        assert.notEqual(result.status, 0, "the assert script fails on a self-inconsistent install.sh");
        assert.match(result.stderr, /SELF-INCONSISTENT/, "the failure is reported as SELF-INCONSISTENT, distinct from a plain CI-key mismatch");
        assert.match(result.stderr, new RegExp(key.fingerprint), "the embedded key's own (real) fingerprint is named in the error");
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(key.homedir, { recursive: true, force: true });
        rmSync(ciKey.homedir, { recursive: true, force: true });
      }
    },
  },

  {
    name: "release-fingerprint-pin/02 a self-consistent install.sh that pins a DIFFERENT key than the CI signing key fails with FINGERPRINT MISMATCH (the literal F3 lockout scenario)",
    run: async () => {
      if (!GPG_AVAILABLE) {
        console.warn("release-fingerprint-pin: gpg not available on this box — the CI-key-mismatch row was skipped (flagged, not faked)");
        return;
      }
      const dir = mkdtempSync(path.join(os.tmpdir(), "aof-fpr-test-"));
      const installShKey = makeGpgKey("aof-fpr-installsh-key");
      const ciKey = makeGpgKey("aof-fpr-different-ci-key");
      try {
        // install.sh is internally consistent (embedded key + variable agree
        // with EACH OTHER) but the CI keyring holds a DIFFERENT key entirely.
        const fixturePath = buildFixtureInstallSh(dir, { embeddedKeyPubkey: installShKey.pubkey, trustGateFingerprint: installShKey.fingerprint });
        const result = runAssertScript(ciKey.homedir, fixturePath);
        assert.notEqual(result.status, 0, "the assert script fails when install.sh's (self-consistent) pin does not match the CI key");
        assert.match(result.stdout + result.stderr, /FINGERPRINT MISMATCH/, "the failure is reported as FINGERPRINT MISMATCH, the F3 lockout scenario");
        assert.doesNotMatch(result.stderr, /SELF-INCONSISTENT/, "this is NOT reported as a self-inconsistency (install.sh's own pin is internally fine)");
      } finally {
        rmSync(dir, { recursive: true, force: true });
        rmSync(installShKey.homedir, { recursive: true, force: true });
        rmSync(ciKey.homedir, { recursive: true, force: true });
      }
    },
  },

  {
    name: "release-fingerprint-pin/03 the real, checked-in install.sh is self-consistent today (its placeholder embedded key and pinned fingerprint variable agree with each other)",
    run: async () => {
      if (!GPG_AVAILABLE) {
        console.warn("release-fingerprint-pin: gpg not available on this box — the real-install.sh self-consistency row was skipped (flagged, not faked)");
        return;
      }
      // A throwaway, UNRELATED CI keyring — this only exercises the
      // self-consistency half (it must NOT report SELF-INCONSISTENT); it is
      // expected to still report FINGERPRINT MISMATCH against this unrelated
      // key, since the real production key is not provisioned on this dev box.
      const unrelatedKey = makeGpgKey("aof-fpr-unrelated-ci");
      try {
        const result = runAssertScript(unrelatedKey.homedir, realInstallSh);
        assert.doesNotMatch(result.stderr, /SELF-INCONSISTENT/, "the real, checked-in install.sh's embedded key and AOF_RELEASE_GPG_FINGERPRINT variable are NOT self-inconsistent");
      } finally {
        rmSync(unrelatedKey.homedir, { recursive: true, force: true });
      }
    },
  },
];
