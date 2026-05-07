import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { loadConfig } from "./dsl.mjs";
import { readLock } from "./lock.mjs";
import { createRenderPlan, planApplyActions } from "./render-plan.mjs";
import { supportedResourceKinds, supportedRuntimes } from "./model.mjs";
import { findProjectConfig, legacyConfigPath, workspacePaths } from "./workspace.mjs";

const VALID_KINDS = new Set(supportedResourceKinds());
const VALID_RUNTIMES = new Set(supportedRuntimes());
const VALID_PACKAGES = new Set(["gsd"]);

export async function inspectConfig(projectDir = process.cwd(), options = {}) {
  const paths = workspacePaths(projectDir);
  const legacyPath = legacyConfigPath(projectDir);
  const configPath = await findProjectConfig(projectDir, options.config);
  const legacyExists = await exists(legacyPath);
  const workspaceConfigExists = await exists(paths.configPath);
  const diagnostics = await validateConfig(projectDir, options);
  let config = null;

  if (!diagnostics.some((item) => item.severity === "error")) {
    config = await loadConfig(configPath);
  }

  return {
    configPath,
    workspaceConfigExists,
    legacyConfigPath: legacyPath,
    legacyConfigExists: legacyExists,
    legacyConfigIsStale: workspaceConfigExists && legacyExists,
    name: config?.name ?? null,
    resources: config?.resources?.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      runtimes: resource.runtimes
    })) ?? [],
    packages: config?.packages ?? [],
    diagnostics
  };
}

export async function validateConfig(projectDir = process.cwd(), options = {}) {
  const diagnostics = [];
  const configPath = await findProjectConfig(projectDir, options.config);
  let raw;

  try {
    raw = await readJsonWithDiagnostic(configPath);
  } catch (error) {
    diagnostics.push(diagnostic("error", "config", `Cannot read config: ${error.message}`, error.code ?? "unreadable-config"));
    return diagnostics;
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push(diagnostic("error", "config", "AOF config must be a JSON object."));
    return diagnostics;
  }

  if (raw.resources !== undefined && !Array.isArray(raw.resources)) {
    diagnostics.push(diagnostic("error", "resources", "resources must be an array when provided."));
  }

  if (raw.packages !== undefined && !Array.isArray(raw.packages)) {
    diagnostics.push(diagnostic("error", "packages", "packages must be an array when provided."));
  }

  const baseDir = path.dirname(configPath);
  for (const [index, resource] of (Array.isArray(raw.resources) ? raw.resources : []).entries()) {
    await validateResource(resource, index, baseDir, diagnostics);
  }

  for (const [index, pkg] of (Array.isArray(raw.packages) ? raw.packages : []).entries()) {
    validatePackage(pkg, index, diagnostics);
  }

  return diagnostics;
}

export async function doctorConfig(projectDir = process.cwd(), options = {}) {
  const inspection = await inspectConfig(projectDir, options);
  const checks = [];

  checks.push({
    id: "config-valid",
    severity: inspection.diagnostics.some((item) => item.severity === "error") ? "error" : "ok",
    message: inspection.diagnostics.some((item) => item.severity === "error")
      ? "Config has validation errors."
      : "Config is valid."
  });

  if (inspection.legacyConfigIsStale) {
    checks.push({
      id: "legacy-config",
      severity: "warning",
      message: `Root ${path.basename(inspection.legacyConfigPath)} exists but ${path.relative(projectDir, inspection.configPath)} is authoritative.`
    });
  } else {
    checks.push({ id: "legacy-config", severity: "ok", message: "No stale root config detected." });
  }

  if (inspection.diagnostics.some((item) => item.code === "missing-file")) {
    checks.push({ id: "asset-files", severity: "error", message: "One or more file-backed assets are missing." });
  } else {
    checks.push({ id: "asset-files", severity: "ok", message: "File-backed assets are present." });
  }

  if (!inspection.diagnostics.some((item) => item.severity === "error")) {
    const config = await loadConfig(inspection.configPath);
    const paths = workspacePaths(projectDir);
    const desiredOutputs = await createRenderPlan(config, {
      targetDir: projectDir,
      runtimes: options.runtimes ?? supportedRuntimes(),
      global: Boolean(options.global)
    });
    const actions = await planApplyActions(desiredOutputs, await readLock(paths.lockPath), {
      targetDir: projectDir,
      force: Boolean(options.force)
    });
    const driftCount = actions.filter((item) => item.action === "drift-warning").length;
    checks.push({
      id: "generated-output-drift",
      severity: driftCount > 0 ? "warning" : "ok",
      message: driftCount > 0 ? `${driftCount} generated output file(s) have drifted.` : "No generated output drift detected.",
      details: summarizeActions(actions)
    });
  }

  const packageCount = inspection.packages.length;
  checks.push({
    id: "package-intent",
    severity: packageCount > 0 ? "info" : "ok",
    message: packageCount > 0 ? `${packageCount} managed package intent(s) declared.` : "No managed package intents declared.",
    details: inspection.packages
  });

  return {
    ...inspection,
    checks,
    suggestions: suggestionsFor(inspection, checks)
  };
}

async function validateResource(resource, index, baseDir, diagnostics) {
  const location = `resources[${index}]`;
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) {
    diagnostics.push(diagnostic("error", location, "Each resource must be an object."));
    return;
  }

  if (!VALID_KINDS.has(resource.kind)) {
    diagnostics.push(diagnostic("error", `${location}.kind`, `Unsupported resource kind "${resource.kind}".`));
  }

  if (typeof resource.id !== "string" || resource.id.trim() === "") {
    diagnostics.push(diagnostic("error", `${location}.id`, "Resource id is required."));
  }

  validateRuntimes(resource.runtimes, `${location}.runtimes`, diagnostics);

  if (resource.path) {
    await requireFile(path.resolve(baseDir, resource.path), `${location}.path`, diagnostics);
  }

  const overrides = resource.overrides ?? {};
  if (overrides && typeof overrides !== "object") {
    diagnostics.push(diagnostic("error", `${location}.overrides`, "overrides must be an object."));
    return;
  }

  for (const [runtime, override] of Object.entries(overrides)) {
    if (!VALID_RUNTIMES.has(runtime)) {
      diagnostics.push(diagnostic("error", `${location}.overrides.${runtime}`, `Unsupported override runtime "${runtime}".`));
      continue;
    }

    const resolvedOverride = typeof override === "string"
      ? await readOverride(path.resolve(baseDir, override), `${location}.overrides.${runtime}`, diagnostics)
      : override;

    if (resolvedOverride && typeof resolvedOverride === "object") {
      if (Object.hasOwn(resolvedOverride, "id") && resolvedOverride.id !== resource.id) {
        diagnostics.push(diagnostic("error", `${location}.overrides.${runtime}.id`, "Runtime override cannot change resource id."));
      }
      if (Object.hasOwn(resolvedOverride, "kind") && resolvedOverride.kind !== resource.kind) {
        diagnostics.push(diagnostic("error", `${location}.overrides.${runtime}.kind`, "Runtime override cannot change resource kind."));
      }
    }
  }
}

function validatePackage(pkg, index, diagnostics) {
  const location = `packages[${index}]`;
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    diagnostics.push(diagnostic("error", location, "Each package must be an object."));
    return;
  }

  if (!VALID_PACKAGES.has(pkg.id)) {
    diagnostics.push(diagnostic("error", `${location}.id`, `Unsupported package id "${pkg.id}".`));
  }

  if (typeof pkg.source !== "string" || !pkg.source.startsWith("npm:")) {
    diagnostics.push(diagnostic("error", `${location}.source`, "Package source must be an npm: source."));
  }

  validateRuntimes(pkg.runtimes, `${location}.runtimes`, diagnostics);
}

function validateRuntimes(runtimes, location, diagnostics) {
  if (runtimes === undefined) return;
  if (!Array.isArray(runtimes) || runtimes.length === 0) {
    diagnostics.push(diagnostic("error", location, "runtimes must be a non-empty array when provided."));
    return;
  }
  for (const runtime of runtimes) {
    if (!VALID_RUNTIMES.has(runtime)) {
      diagnostics.push(diagnostic("error", location, `Unsupported runtime "${runtime}".`));
    }
  }
}

async function readOverride(filePath, location, diagnostics) {
  try {
    return await readJsonWithDiagnostic(filePath);
  } catch (error) {
    diagnostics.push(diagnostic("error", location, `Cannot read override: ${error.message}`, error.code ?? "unreadable-override"));
    return null;
  }
}

async function requireFile(filePath, location, diagnostics) {
  try {
    await access(filePath);
  } catch {
    diagnostics.push(diagnostic("error", location, `Missing file: ${filePath}`, "missing-file"));
  }
}

function diagnostic(severity, pathName, message, code = severity) {
  return { severity, path: pathName, message, code };
}

function summarizeActions(actions) {
  return actions.reduce((summary, item) => {
    summary[item.action] = (summary[item.action] ?? 0) + 1;
    return summary;
  }, {});
}

function suggestionsFor(inspection, checks) {
  const suggestions = [];
  if (inspection.diagnostics.some((item) => item.severity === "error")) {
    suggestions.push("Fix config validation errors, then run aof config validate.");
  } else {
    suggestions.push("Run aof apply --dry-run to preview runtime file changes.");
  }
  if (inspection.packages.some((pkg) => pkg.id === "gsd")) {
    suggestions.push("Run aof install gsd --dry-run to preview GSD setup commands.");
  }
  if (checks.some((check) => check.id === "generated-output-drift" && check.severity === "warning")) {
    suggestions.push("Review drift warnings or rerun aof apply --force when overwriting generated output is intended.");
  }
  return suggestions;
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonWithDiagnostic(filePath) {
  let text;
  try {
    text = await readFile(filePath, "utf8");
  } catch (error) {
    error.code = error.code === "ENOENT" ? "missing-file" : "unreadable-file";
    throw error;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const wrapped = new Error(`Invalid JSON in ${filePath}: ${error.message}`);
    wrapped.code = "malformed-json";
    throw wrapped;
  }
}
