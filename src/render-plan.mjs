import path from "node:path";
import { rm } from "node:fs/promises";
import { writeText } from "./fs.mjs";
import { hashContent, hashFileIfExists, LOCK_VERSION } from "./lock.mjs";
import { renderConfigOutputs } from "./adapters.mjs";
import { resolvedPackageEntry } from "./packages.mjs";

export async function createRenderPlan(config, options = {}) {
  const outputs = renderConfigOutputs(config, options);
  return groupDesiredOutputs(outputs);
}

export async function planApplyActions(desiredOutputs, previousLock, options = {}) {
  const priorEntries = new Map(lockFiles(previousLock).map((entry) => [normalizePath(entry.path), entry]));
  const desiredEntries = new Map(desiredOutputs.map((output) => [normalizePath(output.path), output]));
  const actions = [];

  for (const output of desiredOutputs) {
    const key = normalizePath(output.path);
    const prior = priorEntries.get(key);
    const currentHash = await hashFileIfExists(output.absolutePath);

    if (!currentHash) {
      actions.push(action("create", output, "file does not exist"));
      continue;
    }

    if (currentHash === output.hash) {
      actions.push(action("skip", output, "content already matches desired output"));
      continue;
    }

    if (prior && currentHash !== prior.hash && !options.force) {
      actions.push(action("drift-warning", output, "previously generated file was modified; use --force to overwrite"));
      continue;
    }

    if (prior && currentHash !== prior.hash && options.force) {
      actions.push(action("update", output, "drifted generated file will be overwritten because --force was provided"));
      continue;
    }

    actions.push(action("update", output, prior ? "generated content changed" : "existing file will be overwritten"));
  }

  for (const prior of priorEntries.values()) {
    const priorPath = normalizePath(prior.path);
    if (desiredEntries.has(priorPath)) continue;

    const absolutePath = path.resolve(options.targetDir ?? process.cwd(), prior.path);
    const currentHash = await hashFileIfExists(absolutePath);
    const staleOutput = {
      absolutePath,
      path: prior.path,
      runtime: prior.runtime,
      resource: prior.resource ?? null,
      hash: prior.hash
    };

    if (!currentHash) {
      actions.push(action("skip", staleOutput, "previously generated file is already absent"));
      continue;
    }

    if (currentHash === prior.hash) {
      actions.push(action("delete", staleOutput, "previously generated file is no longer desired"));
      continue;
    }

    actions.push(action("drift-warning", staleOutput, "stale generated file was modified; not deleting"));
  }

  return actions;
}

export async function executeApplyActions(actions) {
  const results = [];
  for (const item of actions) {
    if (item.action === "create" || item.action === "update") {
      results.push(await writeText(item.absolutePath, item.content));
      continue;
    }
    if (item.action === "delete") {
      await rm(item.absolutePath, { force: true });
      results.push({ path: item.absolutePath, action: "delete" });
      continue;
    }
    results.push({ path: item.absolutePath, action: item.action });
  }
  return results;
}

export function createLockManifest({ actions, desiredOutputs, previousLock, config, runtimes, global = false, generatedAt = new Date().toISOString() }) {
  const blocked = new Set(actions.filter((item) => item.action === "drift-warning").map((item) => normalizePath(item.path)));
  const priorByPath = new Map(lockFiles(previousLock).map((entry) => [normalizePath(entry.path), entry]));
  const preservedDrift = [...blocked]
    .map((filePath) => priorByPath.get(filePath))
    .filter(Boolean);

  return {
    version: LOCK_VERSION,
    generatedAt,
    runtimes,
    files: [
      ...desiredOutputs
        .filter((output) => !blocked.has(normalizePath(output.path)))
        .map((output) => ({
          path: output.path,
          runtime: output.runtime,
          resource: output.resource,
          hash: output.hash,
          generatedAt
        })),
      ...preservedDrift
    ],
    packages: packageIntent(config.packages ?? [], { runtimes, global }),
    frameworks: frameworkIntent(config.packages ?? [], { runtimes, global }),
    frameworkInstallAttempts: Array.isArray(previousLock?.frameworkInstallAttempts) ? previousLock.frameworkInstallAttempts : []
  };
}

export function summarizeLockManifest(manifest) {
  return {
    files: manifest.files.length,
    packages: Array.isArray(manifest.packages) ? manifest.packages.length : 0,
    frameworks: manifest.frameworks.length,
    runtimes: manifest.runtimes
  };
}

function groupDesiredOutputs(outputs) {
  const groups = new Map();
  for (const output of outputs) {
    const key = normalizePath(output.path);
    const group = groups.get(key) ?? [];
    group.push(output);
    groups.set(key, group);
  }

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];
    if (group.every((output) => output.runtime === "codex" && output.resource.kind === "rule" && path.basename(output.path) === "AGENTS.md")) {
      return mergeCodexAgents(group);
    }
    throw new Error(`Generated output conflict at ${group[0].path}: ${group.map(describeOutput).join(", ")}`);
  });
}

function mergeCodexAgents(group) {
  const sorted = [...group].sort((a, b) => a.resource.id.localeCompare(b.resource.id));
  const first = sorted[0];
  const content = [
    "# AOF Generated Guidance",
    "",
    "<!-- Generated by AOF. Do not edit directly; update .aof/ instead. -->",
    "",
    ...sorted.flatMap((output) => [
      `## ${output.source.name ?? output.source.id}`,
      "",
      output.source.description ? `> ${output.source.description}` : null,
      Array.isArray(output.source.paths) && output.source.paths.length > 0 ? `Applies to: ${output.source.paths.join(", ")}` : null,
      "",
      output.body.trim(),
      ""
    ].filter((line) => line !== null))
  ].join("\n");

  return {
    ...first,
    content,
    hash: hashContent(content),
    resource: {
      id: sorted.map((output) => output.resource.id).join("+"),
      kind: "rule"
    },
    sources: sorted.map((output) => output.resource)
  };
}

function describeOutput(output) {
  const resource = output.resource ?? {};
  if (resource.package) {
    return `package:${resource.package.namespace}/${resource.package.id}:${resource.kind}:${resource.originalId ?? resource.id}`;
  }
  if (resource.kind) {
    return `local:${resource.kind}:${resource.id}`;
  }
  return `runtime:${output.runtime}:${output.path}`;
}

function action(name, output, reason) {
  return {
    action: name,
    path: output.path,
    absolutePath: output.absolutePath,
    runtime: output.runtime,
    resource: output.resource,
    reason,
    content: output.content,
    hash: output.hash
  };
}

function lockFiles(lock) {
  if (!lock || !Array.isArray(lock.files)) return [];
  return lock.files;
}

function normalizePath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

function frameworkIntent(packages, options) {
  const selectedRuntimes = new Set(options.runtimes ?? []);
  return packages.map((pkg) => {
    const runtimes = (pkg.runtimes ?? options.runtimes ?? []).filter((runtime) => selectedRuntimes.size === 0 || selectedRuntimes.has(runtime));
    return {
      id: pkg.id,
      namespace: pkg.namespace,
      source: pkg.source,
      sourceDescriptor: pkg.sourceDescriptor,
      runtimes,
      scope: options.global ? "global" : "local",
      intent: "managed"
    };
  });
}

function packageIntent(packages, options) {
  const selectedRuntimes = new Set(options.runtimes ?? []);
  return packages.map((pkg) => {
    const runtimes = (pkg.runtimes ?? options.runtimes ?? []).filter((runtime) => selectedRuntimes.size === 0 || selectedRuntimes.has(runtime));
    return {
      ...resolvedPackageEntry(pkg),
      runtimes,
      scope: options.global ? "global" : "local",
      intent: "managed"
    };
  });
}
