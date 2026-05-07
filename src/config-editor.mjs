import path from "node:path";
import { access, readFile, rm } from "node:fs/promises";
import { validateConfig } from "./config-inspect.mjs";
import { loadConfig } from "./dsl.mjs";
import { normalizeId, readJson, writeText } from "./fs.mjs";
import {
  CAPABILITIES,
  CAPABILITY_STATUS,
  RESOURCE_KINDS,
  RUNTIMES,
  defaultBodyFile,
  supportedResourceKinds,
  supportedRuntimes
} from "./model.mjs";
import { findProjectConfig, workspacePaths } from "./workspace.mjs";

const VALID_KINDS = new Set(supportedResourceKinds());
const VALID_RUNTIMES = new Set(supportedRuntimes());
const OVERRIDE_FIELDS = ["name", "description", "body", "prompt", "instructions", "model", "tools", "paths"];

export function capabilitiesPayload() {
  return {
    runtimes: RUNTIMES,
    resourceKinds: RESOURCE_KINDS,
    capabilityStatus: CAPABILITY_STATUS,
    capabilities: CAPABILITIES
  };
}

export async function loadEditableConfig(projectDir = process.cwd(), options = {}) {
  const paths = workspacePaths(projectDir);
  const configPath = await findProjectConfig(projectDir, options.config);
  const exists = await fileExists(configPath);

  if (!exists) {
    return {
      configPath: paths.configPath,
      workspaceConfigExists: false,
      name: path.basename(path.resolve(projectDir)),
      resources: [],
      packages: [],
      diagnostics: [],
      capabilities: capabilitiesPayload(),
      nextCommands: nextCommands([])
    };
  }

  const diagnostics = await validateConfig(projectDir, options);
  const config = diagnostics.some((item) => item.severity === "error")
    ? await readRawConfig(configPath)
    : await loadConfig(configPath);

  return {
    configPath,
    workspaceConfigExists: configPath === paths.configPath,
    name: config.name ?? path.basename(path.resolve(projectDir)),
    resources: (config.resources ?? []).map((resource) => editableResource(resource)),
    packages: config.packages ?? [],
    diagnostics,
    capabilities: capabilitiesPayload(),
    nextCommands: nextCommands(config.packages ?? [])
  };
}

export async function saveEditableResource(projectDir = process.cwd(), input = {}, options = {}) {
  const resource = normalizeEditableResource(input);
  const diagnostics = validateEditableResource(resource);
  const blocking = diagnostics.filter((item) => item.blocking);
  if (blocking.length > 0) {
    return { ok: false, diagnostics };
  }

  const paths = workspacePaths(projectDir);
  const configPath = await findProjectConfig(projectDir, options.config);
  const existing = await readExistingConfig(projectDir, configPath);
  const resourcePath = assetBodyPath(resource);
  const metadata = resourceMetadata(resource, resourcePath);
  const bodyPath = path.join(paths.workspaceDir, resourcePath);

  await writeText(bodyPath, ensureTrailingNewline(resource.body));

  const overrides = await writeEnabledOverrides(paths.workspaceDir, resource, resourcePath);
  if (Object.keys(overrides).length > 0) {
    metadata.overrides = overrides;
  }

  const resources = [...(existing.resources ?? [])];
  const index = resources.findIndex((item) => item.kind === resource.kind && normalizeId(item.id) === resource.id);
  if (index >= 0) {
    resources[index] = metadata;
  } else {
    resources.push(metadata);
  }

  const config = {
    $schema: existing.$schema ?? "../schemas/aof.schema.json",
    name: existing.name ?? path.basename(path.resolve(projectDir)),
    resources,
    packages: existing.packages ?? [],
    ...(existing.items ? { items: existing.items } : {}),
    ...(existing.runtimes ? { runtimes: existing.runtimes } : {})
  };

  await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    ok: true,
    diagnostics,
    resource: editableResource({ ...metadata, body: resource.body, overrides: resource.overrides }),
    configPath: paths.configPath
  };
}

export function validateEditableResource(input = {}) {
  const diagnostics = [];
  let resource;

  try {
    resource = normalizeEditableResource(input);
  } catch (error) {
    diagnostics.push(diagnostic("error", "resource", error.message, true));
    return diagnostics;
  }

  if (!VALID_KINDS.has(resource.kind)) {
    diagnostics.push(diagnostic("error", "kind", `Unsupported resource kind "${resource.kind}".`, true));
  }

  if (!Array.isArray(resource.runtimes) || resource.runtimes.length === 0) {
    diagnostics.push(diagnostic("error", "runtimes", "Select at least one runtime.", true));
  } else {
    for (const runtime of resource.runtimes) {
      if (!VALID_RUNTIMES.has(runtime)) {
        diagnostics.push(diagnostic("error", "runtimes", `Unsupported runtime "${runtime}".`, true));
      }
    }
  }

  for (const runtime of Object.keys(resource.overrides ?? {})) {
    if (!VALID_RUNTIMES.has(runtime)) {
      diagnostics.push(diagnostic("error", `overrides.${runtime}`, `Unsupported override runtime "${runtime}".`, true));
    }
  }

  for (const item of capabilityDiagnostics(resource)) {
    diagnostics.push(item);
  }

  return diagnostics;
}

export function capabilityDiagnostics(resource) {
  const diagnostics = [];
  for (const runtime of resource.runtimes ?? []) {
    const status = CAPABILITIES[resource.kind]?.[runtime];
    if (status) {
      diagnostics.push(capabilityDiagnostic(resource.kind, runtime, status));
    }

    if (resource.kind === "rule" && Array.isArray(resource.paths) && resource.paths.length > 0) {
      diagnostics.push(capabilityDiagnostic("pathScopedRule", runtime, CAPABILITIES.pathScopedRule?.[runtime]));
    }
  }
  return diagnostics.filter(Boolean);
}

export function assetBodyPath(resource) {
  const id = normalizeId(resource.id);
  const kind = RESOURCE_KINDS[resource.kind];
  if (!kind) throw new Error(`Invalid resource kind "${resource.kind}".`);
  return path.join("assets", kind.plural, id, defaultBodyFile(resource.kind)).replaceAll(path.sep, "/");
}

async function readExistingConfig(projectDir, configPath) {
  if (await fileExists(configPath)) {
    return readJson(configPath);
  }

  return {
    $schema: "../schemas/aof.schema.json",
    name: path.basename(path.resolve(projectDir)),
    resources: [],
    packages: []
  };
}

async function readRawConfig(configPath) {
  try {
    return JSON.parse(await readFile(configPath, "utf8"));
  } catch {
    return { resources: [], packages: [] };
  }
}

function normalizeEditableResource(input) {
  const kind = input.kind;
  const id = normalizeId(input.id);
  const runtimes = normalizeRuntimes(input.runtimes);
  return {
    ...input,
    id,
    kind,
    runtimes,
    body: input.body ?? input.prompt ?? input.instructions ?? "",
    overrides: normalizeOverrides(input.overrides ?? {})
  };
}

function normalizeRuntimes(runtimes) {
  if (!runtimes) return ["claude", "codex"];
  if (!Array.isArray(runtimes)) return [];
  return [...new Set(runtimes)];
}

function normalizeOverrides(overrides) {
  const normalized = {};
  for (const [runtime, value] of Object.entries(overrides)) {
    if (!value) continue;
    if (typeof value === "string") {
      normalized[runtime] = { enabled: true, path: value };
      continue;
    }
    normalized[runtime] = { ...value, enabled: Boolean(value.enabled) };
  }
  return normalized;
}

function editableResource(resource) {
  return {
    id: resource.id,
    kind: resource.kind,
    name: resource.name ?? resource.id,
    description: resource.description ?? "",
    body: resource.body ?? resource.prompt ?? resource.instructions ?? "",
    runtimes: resource.runtimes ?? ["claude", "codex"],
    ...(resource.path ? { path: resource.path } : {}),
    ...(resource.model ? { model: resource.model } : {}),
    ...(resource.tools ? { tools: resource.tools } : {}),
    ...(resource.paths ? { paths: resource.paths } : {}),
    overrides: editableOverrides(resource.overrides ?? {})
  };
}

function editableOverrides(overrides) {
  const result = {};
  for (const runtime of supportedRuntimes()) {
    const override = overrides[runtime];
    result[runtime] = override
      ? { enabled: true, ...override }
      : { enabled: false };
  }
  return result;
}

function resourceMetadata(resource, resourcePath) {
  const metadata = {
    kind: resource.kind,
    id: resource.id,
    path: resourcePath,
    runtimes: resource.runtimes
  };

  for (const field of ["name", "description", "model", "tools", "paths"]) {
    if (hasValue(resource[field])) metadata[field] = resource[field];
  }

  return metadata;
}

async function writeEnabledOverrides(workspaceDir, resource, resourcePath) {
  const result = {};
  const overrideDir = path.join(workspaceDir, path.dirname(resourcePath), "overrides");

  for (const runtime of supportedRuntimes()) {
    const override = resource.overrides?.[runtime];
    const overridePath = path.join(overrideDir, `${runtime}.json`);
    const payload = overridePayload(override);

    if (!payload) {
      await rm(overridePath, { force: true });
      continue;
    }

    const relativePath = path.relative(workspaceDir, overridePath).replaceAll(path.sep, "/");
    await writeText(overridePath, `${JSON.stringify(payload, null, 2)}\n`);
    result[runtime] = relativePath;
  }

  return result;
}

function overridePayload(override) {
  if (!override?.enabled) return null;

  const payload = {};
  for (const field of OVERRIDE_FIELDS) {
    if (hasValue(override[field])) payload[field] = override[field];
  }

  return Object.keys(payload).length > 0 ? payload : null;
}

function capabilityDiagnostic(capability, runtime, status) {
  if (!status) return null;
  const pathName = `capabilities.${capability}.${runtime}`;
  if (status === CAPABILITY_STATUS.unsupportedFail) {
    return diagnostic("error", pathName, `${capability} is not supported for ${runtime}.`, true, status);
  }
  if (status === CAPABILITY_STATUS.mapped) {
    return diagnostic("warning", pathName, `${capability} is supported for ${runtime} through mapped output.`, false, status);
  }
  if (status === CAPABILITY_STATUS.unsupportedWarning || status === CAPABILITY_STATUS.future) {
    return diagnostic("warning", pathName, `${capability} is ${status} for ${runtime}.`, false, status);
  }
  return diagnostic("info", pathName, `${capability} is native for ${runtime}.`, false, status);
}

function diagnostic(severity, pathName, message, blocking = severity === "error", code = severity) {
  return { severity, path: pathName, message, blocking, code };
}

function nextCommands(packages) {
  const commands = ["aof apply --dry-run"];
  if ((packages ?? []).some((pkg) => pkg.id === "gsd")) {
    commands.push("aof install gsd --dry-run");
  }
  return commands;
}

function ensureTrailingNewline(value) {
  const text = String(value ?? "");
  return text.endsWith("\n") ? text : `${text}\n`;
}

function hasValue(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim() !== "";
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
