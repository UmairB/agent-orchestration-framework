import path from "node:path";
import { access, readFile } from "node:fs/promises";
import { loadConfig } from "./dsl.mjs";
import { readLock } from "./lock.mjs";
import { createRenderPlan, planApplyActions } from "./render-plan.mjs";
import { collectAdapterWarnings } from "./adapter-warnings.mjs";
import { normalizePackage } from "./packages.mjs";
import {
  supportedHookEvents,
  supportedHookTypes,
  supportedMcpTransports,
  supportedProjectDocTargets,
  supportedResourceKinds,
  supportedRuntimes,
  supportedTrustModes
} from "./model.mjs";
import { findProjectConfig, legacyConfigPath, workspacePaths } from "./workspace.mjs";
import { globalWorkspacePaths } from "./workspace.mjs";

const VALID_KINDS = new Set(supportedResourceKinds());
const VALID_RUNTIMES = new Set(supportedRuntimes());
const VALID_MCP_TRANSPORTS = new Set(supportedMcpTransports());
const VALID_HOOK_EVENTS = new Set(supportedHookEvents());
const VALID_HOOK_TYPES = new Set(supportedHookTypes());
const VALID_DOC_TARGETS = new Set(supportedProjectDocTargets());
const VALID_TRUST_MODES = new Set(supportedTrustModes());

export async function inspectConfig(projectDir = process.cwd(), options = {}) {
  const paths = workspacePaths(projectDir);
  const legacyPath = legacyConfigPath(projectDir);
  const configPath = await findProjectConfig(projectDir, options.config);
  const legacyExists = await exists(legacyPath);
  const workspaceConfigExists = await exists(paths.configPath);
  const diagnostics = await validateConfig(projectDir, options);
  let config = null;
  let adapterWarnings = [];

  if (!diagnostics.some((item) => item.severity === "error")) {
    config = await loadConfig(configPath);
    adapterWarnings = collectAdapterWarnings(config, {
      targetDir: projectDir,
      runtimes: options.runtimes ?? supportedRuntimes(),
      global: Boolean(options.global)
    });
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
    mcpServers: config?.mcpServers?.map((server) => ({ id: server.id, transport: server.transport, runtimes: server.runtimes })) ?? [],
    hooks: config?.hooks?.map((hook) => ({ id: hook.id, event: hook.event, type: hook.type, runtimes: hook.runtimes })) ?? [],
    projectDocs: config?.projectDocs?.map((doc) => ({ id: doc.id, targets: doc.targets, runtimes: doc.runtimes })) ?? [],
    settings: config?.settings ?? {},
    diagnostics,
    adapterWarnings
  };
}

export async function inspectGlobalConfig(options = {}) {
  const paths = globalWorkspacePaths(options);
  const configExists = await exists(paths.configPath);
  const diagnostics = await validateGlobalConfig(options);
  let config = null;

  if (configExists && !diagnostics.some((item) => item.severity === "error")) {
    config = await loadConfig(paths.configPath);
  }

  return {
    configPath: paths.configPath,
    workspaceConfigExists: configExists,
    name: config?.name ?? null,
    resources: config?.resources?.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      name: resource.name,
      description: resource.description,
      path: resource.path,
      runtimes: resource.runtimes
    })) ?? [],
    diagnostics
  };
}

export async function adapterWarningsForConfig(projectDir = process.cwd(), options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  const diagnostics = await validateConfig(projectDir, options);
  if (diagnostics.some((item) => item.severity === "error")) return [];
  return collectAdapterWarnings(await loadConfig(configPath), {
    targetDir: projectDir,
    runtimes: options.runtimes ?? supportedRuntimes(),
    global: Boolean(options.global)
  });
}

export async function validateConfig(projectDir = process.cwd(), options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  return validateConfigFile(configPath);
}

export async function validateGlobalConfig(options = {}) {
  const paths = globalWorkspacePaths(options);
  if (!await exists(paths.configPath)) return [];
  return validateConfigFile(paths.configPath);
}

async function validateConfigFile(configPath) {
  const diagnostics = [];
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
  if (raw.mcpServers !== undefined && !Array.isArray(raw.mcpServers)) {
    diagnostics.push(diagnostic("error", "mcpServers", "mcpServers must be an array when provided."));
  }
  if (raw.hooks !== undefined && !Array.isArray(raw.hooks)) {
    diagnostics.push(diagnostic("error", "hooks", "hooks must be an array when provided."));
  }
  if (raw.projectDocs !== undefined && !Array.isArray(raw.projectDocs)) {
    diagnostics.push(diagnostic("error", "projectDocs", "projectDocs must be an array when provided."));
  }
  if (raw.settings !== undefined && (!raw.settings || typeof raw.settings !== "object" || Array.isArray(raw.settings))) {
    diagnostics.push(diagnostic("error", "settings", "settings must be an object when provided."));
  }

  const baseDir = path.dirname(configPath);
  for (const [index, resource] of (Array.isArray(raw.resources) ? raw.resources : []).entries()) {
    await validateResource(resource, index, baseDir, diagnostics);
  }

  for (const [index, pkg] of (Array.isArray(raw.packages) ? raw.packages : []).entries()) {
    validatePackage(pkg, index, diagnostics);
  }
  validateDuplicates(raw.resources, "resources", (item) => item && `${item.kind}:${item.id}`, diagnostics);
  await validateMcpServers(Array.isArray(raw.mcpServers) ? raw.mcpServers : [], baseDir, diagnostics);
  validateHooks(Array.isArray(raw.hooks) ? raw.hooks : [], diagnostics);
  await validateProjectDocs(Array.isArray(raw.projectDocs) ? raw.projectDocs : [], baseDir, diagnostics);
  validateSettings(raw.settings, diagnostics);

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

  checks.push({
    id: "adapter-degradation",
    severity: inspection.adapterWarnings.length > 0 ? "warning" : "ok",
    message: inspection.adapterWarnings.length > 0
      ? `${inspection.adapterWarnings.length} adapter warning(s) found.`
      : "No adapter degradation warnings detected.",
    details: summarizeWarnings(inspection.adapterWarnings)
  });

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

async function validateMcpServers(servers, baseDir, diagnostics) {
  validateDuplicates(servers, "mcpServers", (server) => server?.id, diagnostics);
  for (const [index, server] of servers.entries()) {
    const location = `mcpServers[${index}]`;
    if (!server || typeof server !== "object" || Array.isArray(server)) {
      diagnostics.push(diagnostic("error", location, "Each MCP server must be an object."));
      continue;
    }
    validateId(server.id, `${location}.id`, "MCP server id is required.", diagnostics);
    const transport = server.transport ?? (server.url ? "http" : "stdio");
    if (!VALID_MCP_TRANSPORTS.has(transport)) {
      diagnostics.push(diagnostic("error", `${location}.transport`, `Unsupported MCP transport "${transport}".`));
    }
    if (transport === "stdio" && (typeof server.command !== "string" || server.command.trim() === "")) {
      diagnostics.push(diagnostic("error", `${location}.command`, "stdio MCP servers require a command."));
    }
    if ((transport === "http" || transport === "sse") && (typeof server.url !== "string" || server.url.trim() === "")) {
      diagnostics.push(diagnostic("error", `${location}.url`, `${transport} MCP servers require a url.`));
    }
    if (server.args !== undefined && !Array.isArray(server.args)) {
      diagnostics.push(diagnostic("error", `${location}.args`, "MCP server args must be an array when provided."));
    }
    if (server.env !== undefined && (!server.env || typeof server.env !== "object" || Array.isArray(server.env))) {
      diagnostics.push(diagnostic("error", `${location}.env`, "MCP server env must be an object when provided."));
    }
    if (server.headers !== undefined && (!server.headers || typeof server.headers !== "object" || Array.isArray(server.headers))) {
      diagnostics.push(diagnostic("error", `${location}.headers`, "MCP server headers must be an object when provided."));
    }
    if (server.path) {
      await requireFile(path.resolve(baseDir, server.path), `${location}.path`, diagnostics);
    }
    validateRuntimes(server.runtimes, `${location}.runtimes`, diagnostics);
    validateRuntimeExtensionObjects(server, location, diagnostics);
  }
}

function validateHooks(hooks, diagnostics) {
  validateDuplicates(hooks, "hooks", (hook) => hook?.id, diagnostics);
  for (const [index, hook] of hooks.entries()) {
    const location = `hooks[${index}]`;
    if (!hook || typeof hook !== "object" || Array.isArray(hook)) {
      diagnostics.push(diagnostic("error", location, "Each hook must be an object."));
      continue;
    }
    validateId(hook.id, `${location}.id`, "Hook id is required.", diagnostics);
    if (!VALID_HOOK_EVENTS.has(hook.event)) {
      diagnostics.push(diagnostic("error", `${location}.event`, `Unsupported hook event "${hook.event}".`));
    }
    const type = hook.type ?? "command";
    if (!VALID_HOOK_TYPES.has(type)) {
      diagnostics.push(diagnostic("error", `${location}.type`, `Unsupported hook type "${type}".`));
    }
    if (type === "command" && (typeof hook.command !== "string" || hook.command.trim() === "")) {
      diagnostics.push(diagnostic("error", `${location}.command`, "Command hooks require a command."));
    }
    if (hook.matcher !== undefined && typeof hook.matcher !== "string") {
      diagnostics.push(diagnostic("error", `${location}.matcher`, "Hook matcher must be a string when provided."));
    }
    validateRuntimes(hook.runtimes, `${location}.runtimes`, diagnostics);
    validateRuntimeExtensionObjects(hook, location, diagnostics);
  }
}

async function validateProjectDocs(docs, baseDir, diagnostics) {
  validateDuplicates(docs, "projectDocs", (doc) => doc?.id, diagnostics);
  for (const [index, doc] of docs.entries()) {
    const location = `projectDocs[${index}]`;
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      diagnostics.push(diagnostic("error", location, "Each project doc must be an object."));
      continue;
    }
    validateId(doc.id, `${location}.id`, "Project doc id is required.", diagnostics);
    if (!doc.path && typeof doc.body !== "string") {
      diagnostics.push(diagnostic("error", location, "Project docs require either path or body."));
    }
    if (doc.path) {
      const docPath = path.resolve(baseDir, doc.path);
      if (!isInside(baseDir, docPath)) {
        diagnostics.push(diagnostic("error", `${location}.path`, "Project doc path must stay inside the .aof workspace."));
      } else {
        await requireFile(docPath, `${location}.path`, diagnostics);
      }
    }
    if (doc.targets !== undefined) {
      if (!Array.isArray(doc.targets) || doc.targets.length === 0) {
        diagnostics.push(diagnostic("error", `${location}.targets`, "Project doc targets must be a non-empty array when provided."));
      } else {
        for (const target of doc.targets) {
          if (!VALID_DOC_TARGETS.has(target)) {
            diagnostics.push(diagnostic("error", `${location}.targets`, `Unsupported project doc target "${target}".`));
          }
        }
      }
    }
    if (doc.includes !== undefined && !Array.isArray(doc.includes)) {
      diagnostics.push(diagnostic("error", `${location}.includes`, "Project doc includes must be an array when provided."));
    }
    validateRuntimes(doc.runtimes, `${location}.runtimes`, diagnostics);
    validateRuntimeExtensionObjects(doc, location, diagnostics);
  }
}

function validateSettings(settings, diagnostics) {
  if (settings === undefined || !settings || typeof settings !== "object" || Array.isArray(settings)) return;
  if (settings.model !== undefined && typeof settings.model !== "string") {
    diagnostics.push(diagnostic("error", "settings.model", "settings.model must be a string when provided."));
  }
  if (settings.trust !== undefined && !VALID_TRUST_MODES.has(settings.trust)) {
    diagnostics.push(diagnostic("error", "settings.trust", `Unsupported trust mode "${settings.trust}".`));
  }
  if (settings.autoCompact !== undefined && typeof settings.autoCompact !== "boolean") {
    diagnostics.push(diagnostic("error", "settings.autoCompact", "settings.autoCompact must be a boolean when provided."));
  }
  validateRuntimeExtensionObjects(settings, "settings", diagnostics);
}

function validatePackage(pkg, index, diagnostics) {
  const location = `packages[${index}]`;
  if (!pkg || typeof pkg !== "object" || Array.isArray(pkg)) {
    diagnostics.push(diagnostic("error", location, "Each package must be an object."));
    return;
  }

  validateId(pkg.id, `${location}.id`, "Package id is required.", diagnostics);

  if (typeof pkg.namespace !== "string" || pkg.namespace.trim() === "") {
    diagnostics.push(diagnostic("error", `${location}.namespace`, "Package namespace is required."));
  }

  try {
    normalizePackage(pkg, index);
  } catch (error) {
    const message = error.message;
    const pathMatch = message.match(/^(packages\[\d+\](?:\.[A-Za-z0-9_]+)?)/);
    diagnostics.push(diagnostic("error", pathMatch?.[1] ?? location, message));
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

function validateId(id, location, message, diagnostics) {
  if (typeof id !== "string" || id.trim() === "") {
    diagnostics.push(diagnostic("error", location, message));
  }
}

function validateDuplicates(items, collectionName, keyFor, diagnostics) {
  const seen = new Map();
  for (const [index, item] of (items ?? []).entries()) {
    const key = keyFor(item);
    if (!key || String(key).includes("undefined")) continue;
    const normalized = String(key).toLowerCase();
    if (seen.has(normalized)) {
      diagnostics.push(diagnostic("error", `${collectionName}[${index}].id`, `Duplicate ${collectionName} id also used at ${collectionName}[${seen.get(normalized)}].`));
      continue;
    }
    seen.set(normalized, index);
  }
}

function validateRuntimeExtensionObjects(item, location, diagnostics) {
  for (const runtime of VALID_RUNTIMES) {
    const value = item?.[runtime];
    if (value !== undefined && (!value || typeof value !== "object" || Array.isArray(value))) {
      diagnostics.push(diagnostic("error", `${location}.${runtime}`, `${runtime} extension must be an object when provided.`));
    }
  }
}

function isInside(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
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
  if (inspection.adapterWarnings.length > 0) {
    suggestions.push("Review adapter warnings or rerun with --strict in CI to fail on portability degradation.");
  }
  return suggestions;
}

function summarizeWarnings(warnings) {
  return warnings.reduce((summary, item) => {
    summary[item.code] = (summary[item.code] ?? 0) + 1;
    return summary;
  }, {});
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
