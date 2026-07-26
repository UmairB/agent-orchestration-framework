#!/usr/bin/env node
// milestone 28 / story 01 (ADR-005) — Linux GPG detached signature over
// SHA256SUMS. Runs on the Linux matrix leg with a CI-held GPG private key
// (secret NAME only — never key material in the repo).
//
//   node scripts/release/gpg-sign-manifest.mjs --manifest <path/to/SHA256SUMS> [--homedir <gpg-homedir>]
//
// Emits `<manifest>.asc` beside the manifest (armored detached signature —
// `SHA256SUMS` + `SHA256SUMS.asc`, the Node/HashiCorp shape, RESEARCH §4).
// The signing key itself is provisioned into the runner's gpg keyring by the
// CI workflow (import from the AOF_RELEASE_GPG_PRIVATE_KEY secret) BEFORE
// this script runs — this script only invokes `gpg --detach-sign --armor`,
// it never touches key material directly.
//
// WINDOWS/GIT-BASH GOTCHA (confirmed empirically on this dev box, the SAME
// lesson test/installer-verify.test.mjs already documents): a Git-Bash gpg
// build's agent socket wants POSIX-shaped paths for --homedir and its file
// arguments — a bare `C:\...` path makes gpg-agent fail to start ("No agent
// running"). The CI Linux runner's native gpg has no such requirement, but
// converting defensively here costs nothing there and makes this script
// correct on both. Only Windows-drive-letter paths are converted; POSIX
// paths pass through unchanged.
//
// AOF_GPG_BIN (env, optional): overrides the gpg binary invoked (default
// "gpg" — unchanged CI behaviour). Bare `gpg` resolution is PARENT-SHELL-
// DEPENDENT on Windows (a PowerShell/cmd parent may not resolve gpg on PATH
// at all — spawnSync ENOENT — while a Git Bash parent resolves Git's own
// usr/bin/gpg.exe); the SAME failure class scripts/release/
// assert-fingerprint-pin.mjs carries the identical override for.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const GPG_BIN = process.env.AOF_GPG_BIN || "gpg";

function toPosixGpgPath(p) {
  if (!/^[A-Za-z]:\\/.test(p)) return p;
  return "/" + p[0].toLowerCase() + p.slice(2).split("\\").join("/");
}

function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--manifest" && argv[i + 1]) {
      options.manifest = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--homedir" && argv[i + 1]) {
      options.homedir = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--signer" && argv[i + 1]) {
      options.signer = argv[i + 1];
      i += 1;
    }
  }
  if (!options.manifest) {
    throw new Error("gpg-sign-manifest.mjs requires --manifest <path/to/SHA256SUMS>");
  }
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.manifest)) {
    throw new Error(`manifest not found: ${options.manifest}`);
  }
  const ascPath = `${options.manifest}.asc`;
  const args = ["--batch", "--yes"];
  if (options.homedir) args.push("--homedir", toPosixGpgPath(options.homedir));
  if (options.signer) args.push("--local-user", options.signer);
  args.push("--detach-sign", "--armor", "-o", toPosixGpgPath(ascPath), toPosixGpgPath(options.manifest));

  console.log(`${GPG_BIN} ${args.join(" ")}`);
  execFileSync(GPG_BIN, args, { stdio: "inherit" });
  console.log(`\nGPG detached signature written: ${ascPath}`);
}

main();
