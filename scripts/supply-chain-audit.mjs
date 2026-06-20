import { existsSync, readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repoRoot, "package-lock.json");
const nodeModulesPath = path.join(repoRoot, "node_modules");

const allowedInstallScripts = new Set([
  "esbuild",
  "fsevents",
  // node-pty@1.1.0 (ADR-003): its install script is `node scripts/prebuild.js ||
  // node-gyp rebuild`, where prebuild.js only does fs.existsSync(prebuilds/<plat>)
  // + process.exit(0) — it does NOT download or compile when the bundled
  // win32-x64 N-API prebuilt is present (RESEARCH §2, verified from the tarball).
  "node-pty"
]);

const knownBadVersions = new Map([
  ["axios", new Set(["1.14.1", "0.30.4"])],
  ["plain-crypto-js", new Set(["4.2.1"])],
  ["node-ipc", new Set(["9.1.6", "9.2.3"])],
  ["chalk", new Set(["5.6.1"])],
  ["debug", new Set(["4.4.2"])],
  ["ansi-styles", new Set(["6.2.2"])],
  ["supports-color", new Set(["10.2.1"])],
  ["strip-ansi", new Set(["7.1.1"])],
  ["ansi-regex", new Set(["6.2.1"])],
  ["wrap-ansi", new Set(["9.0.1"])],
  ["color-convert", new Set(["3.1.1"])],
  ["color-name", new Set(["2.0.1"])],
  ["is-arrayish", new Set(["0.3.3"])],
  ["slice-ansi", new Set(["7.1.1"])],
  ["error-ex", new Set(["1.3.3"])],
  ["simple-swizzle", new Set(["0.2.3"])],
  ["supports-hyperlinks", new Set(["4.1.1"])],
  ["chalk-template", new Set(["1.1.1"])],
  ["backslash", new Set(["0.2.1"])],
  ["color-string", new Set(["2.1.1"])],
  ["has-ansi", new Set(["6.0.1"])],
  ["proto-tinker-wc", new Set(["0.1.87"])]
]);
const knownBadNxVersions = new Set([
  "20.9.0",
  "20.10.0",
  "20.11.0",
  "20.12.0",
  "21.5.0",
  "21.6.0",
  "21.7.0",
  "21.8.0"
]);

const blockedPackageFamilies = [
  "@tanstack/",
  "@mistralai/",
  "@uipath/",
  "@opensearch-project/",
  "guardrails-ai",
  "node-ipc"
];

const suspiciousPayloadFiles = new Set([
  "router_init.js",
  "router_runtime.js",
  "execution.js",
  "telemetry.js",
  "bundle.js",
  "bun_environment.js"
]);

const diagnostics = [];

if (!existsSync(lockPath)) {
  diagnostics.push(error("LOCKFILE_MISSING", "package-lock.json", "package-lock.json is required for dependency safety checks."));
} else {
  const lock = JSON.parse(readFileSync(lockPath, "utf8"));
  const packages = lock.packages && typeof lock.packages === "object" ? lock.packages : {};
  for (const [entryPath, entry] of Object.entries(packages)) {
    if (!entryPath || !entry || typeof entry !== "object") continue;
    const name = packageNameFromLockEntry(entryPath, entry);
    if (!name) continue;

    const version = String(entry.version ?? "");
    if (isKnownCompromisedVersion(name, version)) {
      diagnostics.push(error("KNOWN_COMPROMISED_VERSION", entryPath, `${name}@${version} is on the known compromised package/version blocklist.`));
    }

    if (blockedPackageFamilies.some((blocked) => name === blocked || name.startsWith(blocked))) {
      diagnostics.push(error("BLOCKED_PACKAGE_FAMILY", entryPath, `${name} matches a currently blocked high-risk supply-chain family.`));
    }

    if (entry.hasInstallScript && !allowedInstallScripts.has(name)) {
      diagnostics.push(error("UNAPPROVED_INSTALL_SCRIPT", entryPath, `${name}@${version} has an install lifecycle script and is not allowlisted.`));
    }

    if (entry.resolved && !entry.link && !String(entry.resolved).startsWith("https://registry.npmjs.org/")) {
      diagnostics.push(warning("NON_NPM_REGISTRY_SOURCE", entryPath, `${name}@${version} resolves outside registry.npmjs.org: ${entry.resolved}`));
    }
  }
}

if (existsSync(nodeModulesPath)) {
  for (const filePath of await findSuspiciousPayloads(nodeModulesPath)) {
    diagnostics.push(error("SUSPICIOUS_PAYLOAD_FILE", path.relative(repoRoot, filePath).replaceAll("\\", "/"), "Known npm malware payload filename found in node_modules."));
  }
}

const workflowPath = path.join(repoRoot, ".github", "workflows");
if (existsSync(workflowPath)) {
  for (const filePath of await findWorkflowFiles(workflowPath)) {
    const body = readFileSync(filePath, "utf8");
    if (/\bpull_request_target\b/.test(body)) {
      diagnostics.push(error("UNSAFE_PULL_REQUEST_TARGET_WORKFLOW", path.relative(repoRoot, filePath).replaceAll("\\", "/"), "pull_request_target workflows must be reviewed before they can access repository secrets or publish tokens."));
    }
  }
}

const errors = diagnostics.filter((item) => item.severity === "error");
for (const item of diagnostics) {
  console.log(`${item.severity}: ${item.code} ${item.path} ${item.message}`);
}

if (errors.length > 0) {
  console.error(`supply-chain audit failed: ${errors.length} error(s)`);
  process.exitCode = 1;
} else {
  console.log(`supply-chain audit passed: ${diagnostics.length} warning(s)`);
}

function packageNameFromLockEntry(entryPath, entry) {
  if (entry.name) return entry.name;
  const normalized = entryPath.replaceAll("\\", "/");
  const marker = "node_modules/";
  const index = normalized.lastIndexOf(marker);
  if (index === -1) return null;
  const suffix = normalized.slice(index + marker.length);
  if (!suffix) return null;
  if (suffix.startsWith("@")) {
    const parts = suffix.split("/");
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : suffix;
  }
  return suffix.split("/")[0];
}

function isKnownCompromisedVersion(name, version) {
  const knownBad = knownBadVersions.get(name);
  if (knownBad?.has(version)) return true;
  if ((name === "nx" || name.startsWith("@nx/")) && knownBadNxVersions.has(version)) return true;
  return false;
}

async function findSuspiciousPayloads(root) {
  const found = [];
  await walk(root, found);
  return found;
}

async function findWorkflowFiles(root) {
  const found = [];
  await walkWorkflows(root, found);
  return found;
}

async function walk(dir, found) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(fullPath, found);
    } else if (entry.isFile() && suspiciousPayloadFiles.has(entry.name)) {
      found.push(fullPath);
    }
  }
}

async function walkWorkflows(dir, found) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkWorkflows(fullPath, found);
    } else if (entry.isFile() && /\.(ya?ml)$/i.test(entry.name)) {
      found.push(fullPath);
    }
  }
}

function error(code, pathName, message) {
  return { severity: "error", code, path: pathName, message };
}

function warning(code, pathName, message) {
  return { severity: "warning", code, path: pathName, message };
}
