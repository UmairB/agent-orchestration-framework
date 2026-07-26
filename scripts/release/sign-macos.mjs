#!/usr/bin/env node
// milestone 28 / story 01 (ADR-005) — macOS codesign -> notarize -> staple.
//
// LOAD-BEARING ORDERING (ADR-005, RESEARCH §4): postject injection (Story
// 00's build-sea.mjs) MUST run BEFORE this script — injecting the SEA blob
// breaks any existing signature, so the binary this script receives is the
// UNSIGNED, already-injected artifact. This script does NOT re-invoke
// build-sea.mjs; it only signs what it is given. The CI workflow's job
// ordering (build -> THIS script) is what makes that structurally obvious
// (see .github/workflows/release.yml's macos job: "build (inject)" step
// precedes "sign (codesign)").
//
// All three steps are mandatory for a downloadable binary (RESEARCH §4):
//   1. codesign --sign "Developer ID Application: ..." --options runtime --timestamp
//   2. xcrun notarytool submit --wait (App Store Connect API key)
//   3. xcrun stapler staple
//
// Secrets are CI-held (secret NAMES only, no material here):
//   AOF_MACOS_DEVELOPER_ID_IDENTITY   — "Developer ID Application: Name (TEAMID)"
//   AOF_MACOS_NOTARY_KEY_ID / AOF_MACOS_NOTARY_ISSUER_ID / AOF_MACOS_NOTARY_KEY_PATH
//     (an App Store Connect API key — provisioned onto the runner by the
//     workflow from a secret, never committed)
//
//   node scripts/release/sign-macos.mjs --file <path/to/aof-macos-arm64>
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file" && argv[i + 1]) {
      options.file = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  if (!options.file) {
    throw new Error("sign-macos.mjs requires --file <path/to/artifact>");
  }
  return options;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`sign-macos.mjs: required secret-sourced env var ${name} is not set.`);
  }
  return value;
}

function step(label, fn) {
  console.log(`\n=== ${label} ===`);
  fn();
  console.log(`--- done: ${label} ---`);
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.file)) {
    throw new Error(`artifact not found: ${options.file}. ` +
      `This script must run AFTER Story 00's postject injection (build-sea.mjs) — ` +
      `injection must precede codesign, never the reverse (ADR-005).`);
  }

  const identity = requireEnv("AOF_MACOS_DEVELOPER_ID_IDENTITY");
  const keyId = requireEnv("AOF_MACOS_NOTARY_KEY_ID");
  const issuerId = requireEnv("AOF_MACOS_NOTARY_ISSUER_ID");
  const keyPath = requireEnv("AOF_MACOS_NOTARY_KEY_PATH");

  // 1. codesign — hardened runtime + timestamp, mandatory for notarization.
  step("codesign --options runtime --timestamp (hardened runtime)", () => {
    execFileSync(
      "codesign",
      ["--sign", identity, "--options", "runtime", "--timestamp", "--force", options.file],
      { stdio: "inherit" }
    );
  });

  step("codesign --verify --deep --strict", () => {
    execFileSync("codesign", ["--verify", "--deep", "--strict", options.file], { stdio: "inherit" });
  });

  // 2. notarytool submit --wait — Apple's malware scan; blocks until a ticket
  // issues (or the submission is rejected).
  const zipPath = `${options.file}.zip`;
  step("ditto (zip for notarization submission)", () => {
    execFileSync("ditto", ["-c", "-k", "--keepParent", options.file, zipPath], { stdio: "inherit" });
  });

  step("xcrun notarytool submit --wait", () => {
    execFileSync(
      "xcrun",
      ["notarytool", "submit", zipPath, "--key", keyPath, "--key-id", keyId, "--issuer", issuerId, "--wait"],
      { stdio: "inherit" }
    );
  });

  // 3. stapler staple — attaches the ticket so it verifies OFFLINE (a
  // notarized-but-not-stapled binary fails offline, RESEARCH §4).
  step("xcrun stapler staple", () => {
    execFileSync("xcrun", ["stapler", "staple", options.file], { stdio: "inherit" });
  });

  step("xcrun stapler validate (confirm the ticket is stapled, verifiable offline)", () => {
    execFileSync("xcrun", ["stapler", "validate", options.file], { stdio: "inherit" });
  });

  console.log(`\nmacOS codesign + notarize + staple complete: ${options.file}`);
}

main();
