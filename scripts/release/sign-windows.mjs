#!/usr/bin/env node
// milestone 28 / story 01 (ADR-005) — Windows Authenticode signing.
//
// CA/B June-2023 rule: the OV/EV code-signing private key MUST live on
// FIPS-140-2 L2 / CC EAL4+ hardware — an HSM/cloud signing service, never an
// exportable file .pfx (RESEARCH §4). This script therefore shells out to
// AzureSignTool (Azure Key Vault / Azure Trusted Signing) rather than the
// classic `signtool sign /f cert.pfx` path — there IS no file cert to
// reference. Secrets are CI-held (secret NAMES only, no material here):
//   AOF_AZURE_SIGN_KEY_VAULT_URL, AOF_AZURE_SIGN_CERT_NAME,
//   AOF_AZURE_SIGN_TENANT_ID, AOF_AZURE_SIGN_CLIENT_ID, AOF_AZURE_SIGN_CLIENT_SECRET
// (or the Azure Trusted Signing equivalents — the CI workflow wires whichever
// service is provisioned; this script only forwards env-sourced values as
// CLI flags, it never inlines a secret literal).
//
//   node scripts/release/sign-windows.mjs --file <path/to/aof-windows-x64.exe> --timestamp-url <rfc3161-url>
//
// /fd SHA256 /tr <rfc3161> /td SHA256 — RFC-3161 timestamping so the
// signature survives cert expiry (RESEARCH §4).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

const DEFAULT_TIMESTAMP_URL = "http://timestamp.digicert.com";

function parseArgs(argv) {
  const options = { timestampUrl: DEFAULT_TIMESTAMP_URL };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--file" && argv[i + 1]) {
      options.file = path.resolve(argv[i + 1]);
      i += 1;
    } else if (argv[i] === "--timestamp-url" && argv[i + 1]) {
      options.timestampUrl = argv[i + 1];
      i += 1;
    }
  }
  if (!options.file) {
    throw new Error("sign-windows.mjs requires --file <path/to/artifact.exe>");
  }
  return options;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `sign-windows.mjs: required secret-sourced env var ${name} is not set. ` +
      `Windows signing needs an HSM/cloud signing service (CA/B June-2023 rule — no file .pfx).`
    );
  }
  return value;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!existsSync(options.file)) {
    throw new Error(`artifact not found: ${options.file}`);
  }

  // AzureSignTool against Azure Key Vault / Azure Trusted Signing — an
  // HSM/cloud service, satisfying the CA/B rule. Secret NAMES only.
  const keyVaultUrl = requireEnv("AOF_AZURE_SIGN_KEY_VAULT_URL");
  const certName = requireEnv("AOF_AZURE_SIGN_CERT_NAME");
  const tenantId = requireEnv("AOF_AZURE_SIGN_TENANT_ID");
  const clientId = requireEnv("AOF_AZURE_SIGN_CLIENT_ID");
  const clientSecret = requireEnv("AOF_AZURE_SIGN_CLIENT_SECRET");

  // craft-review F13(c) — DELIBERATE CHOICE, not an oversight: -kvs (the
  // Key Vault client secret) is passed as a process argument, which is
  // technically visible to other processes on the SAME machine via the OS
  // process list (`ps`/Task Manager) for the argument's lifetime. This is
  // acceptable here because: (1) GitHub Actions hosted runners are
  // single-job, EPHEMERAL VMs — destroyed after this job finishes, with no
  // other tenant/process able to observe this runner's process list; (2)
  // AzureSignTool has no alternative secret-input channel (no stdin/env-var
  // form for -kvs); (3) the value is still `requireEnv`-sourced from a
  // GitHub secret (never a literal) and never logged (see the masked
  // console.log below). On a SHARED/persistent/self-hosted runner this
  // trade-off would need revisiting (e.g. a wrapper that reads the secret
  // from a short-lived file); flagged explicitly rather than silently
  // assumed safe.
  const args = [
    "sign",
    "-kvu", keyVaultUrl,
    "-kvc", certName,
    "-kvt", tenantId,
    "-kvi", clientId,
    "-kvs", clientSecret,
    "-fd", "sha256",
    "-tr", options.timestampUrl,
    "-td", "sha256",
    options.file,
  ];

  // Never log the secret-bearing args verbatim.
  console.log(`AzureSignTool sign -kvu *** -kvc *** -kvt *** -kvi *** -kvs *** -fd sha256 -tr ${options.timestampUrl} -td sha256 ${options.file}`);
  execFileSync("AzureSignTool", args, { stdio: "inherit" });
  console.log(`\nWindows Authenticode signature applied: ${options.file}`);
}

main();
