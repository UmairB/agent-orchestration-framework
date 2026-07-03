#!/usr/bin/env node
// milestone 28 / story 01 (ADR-005/ADR-006, craft-review F3, HIGH) — asserts
// the GPG fingerprint install.sh trusts for SHA256SUMS.asc is EXACTLY the
// fingerprint of the CI-imported release signing key. Nothing previously
// tied install.sh's pinned fingerprint literal to the actual key the release
// workflow signs with — a one-byte drift between the two would make every
// Linux install refuse forever (a silent, permanent lockout), since
// install.sh's Build note F2 hard-refuses a valid signature by an unpinned
// key. Runs in the checksum-and-sign-manifest job, AFTER the signing key is
// imported and BEFORE the release is published — fails the whole release on
// mismatch rather than shipping an install.sh that can never verify.
//
//   node scripts/release/assert-fingerprint-pin.mjs --homedir <gpg-homedir> [--install-sh <path>]
//
// AOF_GPG_BIN (env, optional): overrides the gpg binary invoked (default
// "gpg" — unchanged CI behaviour). Bare `gpg` resolution is PARENT-SHELL-
// DEPENDENT on Windows (a PowerShell/cmd parent may not resolve gpg on PATH
// at all); a caller that already knows the right binary passes it here.
//
// THE ACTUAL RUNTIME TRUST GATE (confirmed by reading install.sh's own
// source, not assumed): install.sh's aof_verify_gpg_signature compares
// gpg --verify's VALIDSIG signer fingerprint against the
// $AOF_RELEASE_GPG_FINGERPRINT VARIABLE's value — always present regardless
// of pin form. Story 02 also embeds the release PUBLIC KEY block directly
// (craft F1) so a fresh --homedir has something to import + verify against,
// but the embedded key is NOT itself the trust decision — the variable is.
// This script therefore (a) ALWAYS extracts the AOF_RELEASE_GPG_FINGERPRINT
// variable's literal default (install.sh's real gate) and compares it
// against the CI-imported signing key, and (b) if an embedded key block is
// ALSO present, additionally cross-checks that the embedded key's OWN
// fingerprint agrees with the variable — catching a self-inconsistent
// install.sh (a key that verifies but whose signer the variable would then
// refuse) as a separate, clearly-labelled failure. The pin is extracted from
// install.sh ITSELF — never duplicated/hard-coded in this script — so the
// two files cannot silently drift out of coordination.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// AOF_GPG_BIN — an explicit override for the gpg binary to invoke. Bare
// `gpg` is PARENT-SHELL-DEPENDENT on Windows (from a PowerShell/cmd parent
// it may not resolve on PATH at all — `spawnSync gpg ENOENT` — while a Git
// Bash parent resolves Git's own usr/bin/gpg.exe); defaults to plain "gpg"
// so the real CI Linux runner (a native, unambiguous gpg) is UNCHANGED. A
// caller that already knows the right binary for its shell (e.g. this
// story's own test suite, via test/installer-shell.mjs's WSL-launcher-safe
// resolveGpg()) passes it through this env var rather than this production
// script importing test-only resolution logic.
const GPG_BIN = process.env.AOF_GPG_BIN || "gpg";

function toPosixGpgPath(p) {
  if (!/^[A-Za-z]:\\/.test(p)) return p;
  return "/" + p[0].toLowerCase() + p.slice(2).split("\\").join("/");
}

function normalizeFingerprint(fpr) {
  return fpr.replace(/[^0-9A-Fa-f]/g, "").toUpperCase();
}

function parseArgs(argv) {
  const options = { installSh: path.join(repoRoot, "install.sh") };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--homedir" && argv[i + 1]) {
      options.homedir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--install-sh" && argv[i + 1]) {
      options.installSh = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  if (!options.homedir) {
    throw new Error("assert-fingerprint-pin.mjs requires --homedir <gpg-homedir-with-the-imported-release-key>");
  }
  return options;
}

// ciKeyFingerprint(homedir) -> the normalized (uppercase, no spaces) 40-hex
// fingerprint of the (single) key imported into the given gpg homedir — the
// SAME key gpg-sign-manifest.mjs signs SHA256SUMS.asc with.
function ciKeyFingerprint(homedir) {
  const out = execFileSync(GPG_BIN, ["--homedir", toPosixGpgPath(homedir), "--list-secret-keys", "--with-colons"], { encoding: "utf8" });
  const fprLine = out.split("\n").find((l) => l.startsWith("fpr:"));
  if (!fprLine) {
    throw new Error(
      `assert-fingerprint-pin.mjs: no secret key fingerprint found in gpg homedir ${homedir} — ` +
      `expected the release signing key to already be imported (the workflow's "Import the release GPG private key" step must run first).`
    );
  }
  const fpr = fprLine.split(":")[9];
  if (!fpr) {
    throw new Error(`assert-fingerprint-pin.mjs: could not parse a fingerprint out of gpg --with-colons output: ${JSON.stringify(fprLine)}`);
  }
  return normalizeFingerprint(fpr);
}

// installShTrustGateFingerprint(installShPath) -> the normalized fingerprint
// install.sh's RUNTIME trust gate actually compares against.
//
// install.sh's aof_verify_gpg_signature (confirmed by reading its source, not
// assumed) compares gpg --verify's VALIDSIG signer fingerprint against the
// $AOF_RELEASE_GPG_FINGERPRINT VARIABLE's value — NOT against "whatever key
// happens to be embedded/imported". The embedded PGP public key block (craft
// F1) only supplies gpg --verify something to check the signature against;
// the ACTUAL accept/refuse decision is the variable comparison. So the
// variable's literal default is the trust gate this assert must pin against,
// regardless of whether an embedded key block also exists in the file.
//
// If an embedded key block IS present, this ALSO cross-checks that the
// embedded key's OWN fingerprint agrees with the variable — catching a
// self-inconsistent install.sh (an embedded key that verifies successfully
// but whose signer fingerprint the variable would then refuse) as a
// separate, clearly-labelled failure, distinct from the CI-key mismatch this
// script's main() checks.
function installShTrustGateFingerprint(installShPath) {
  if (!existsSync(installShPath)) {
    throw new Error(`assert-fingerprint-pin.mjs: install.sh not found at ${installShPath}`);
  }
  const source = readFileSync(installShPath, "utf8");

  const varMatch = source.match(/AOF_RELEASE_GPG_FINGERPRINT\s*=\s*"\$\{AOF_RELEASE_GPG_FINGERPRINT:-([0-9A-Fa-f ]{20,})\}"/);
  if (!varMatch) {
    throw new Error(
      "assert-fingerprint-pin.mjs: could not find the AOF_RELEASE_GPG_FINGERPRINT variable's literal default in install.sh " +
      "— this is install.sh's actual runtime trust gate (aof_verify_gpg_signature compares the GPG-verified signer's " +
      "fingerprint against THIS variable, not against whatever key is embedded/imported)."
    );
  }
  const trustGateFpr = normalizeFingerprint(varMatch[1]);

  const armorMatch = source.match(/-----BEGIN PGP PUBLIC KEY BLOCK-----[\s\S]*?-----END PGP PUBLIC KEY BLOCK-----/);
  if (armorMatch) {
    const out = execFileSync(
      GPG_BIN,
      ["--with-colons", "--import-options", "show-only", "--import"],
      { input: armorMatch[0], encoding: "utf8" }
    );
    const fprLine = out.split("\n").find((l) => l.startsWith("fpr:"));
    if (!fprLine) {
      throw new Error("assert-fingerprint-pin.mjs: install.sh embeds a PGP public key block, but gpg could not derive a fingerprint from it.");
    }
    const embeddedKeyFpr = normalizeFingerprint(fprLine.split(":")[9]);
    if (embeddedKeyFpr !== trustGateFpr) {
      throw new Error(
        `SELF-INCONSISTENT install.sh — the embedded PGP public key's OWN fingerprint does not match the ` +
        `AOF_RELEASE_GPG_FINGERPRINT variable's pinned value (the actual runtime trust gate).\n` +
        `  Embedded key fingerprint:              ${embeddedKeyFpr}\n` +
        `  AOF_RELEASE_GPG_FINGERPRINT variable:  ${trustGateFpr}\n` +
        `gpg --verify would succeed against the embedded key, but aof_verify_gpg_signature's fingerprint-pin check ` +
        `would then REFUSE that same signature as untrusted — install.sh would refuse every install. Fix the two to agree.`
      );
    }
  }

  return trustGateFpr;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const ciFpr = ciKeyFingerprint(options.homedir);
  const pinnedFpr = installShTrustGateFingerprint(options.installSh);

  console.log(`CI-imported release signing key fingerprint: ${ciFpr}`);
  console.log(`install.sh pinned fingerprint:                ${pinnedFpr}`);

  if (ciFpr !== pinnedFpr) {
    throw new Error(
      `FINGERPRINT MISMATCH — install.sh's pinned GPG fingerprint does NOT match the CI signing key.\n` +
      `  CI-imported key:  ${ciFpr}\n` +
      `  install.sh pin:   ${pinnedFpr}\n` +
      `A drift here means every Linux install.sh run refuses the release's signature forever ` +
      `(Build note F2's untrusted/unpinned-key refusal). Update install.sh's pinned fingerprint ` +
      `to match the CI signing key before releasing.`
    );
  }

  console.log("\nOK — install.sh's pinned fingerprint matches the CI signing key.");
}

main();
