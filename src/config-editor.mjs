import path from "node:path";
import { access, readFile, rm } from "node:fs/promises";
import { validateConfig, validateGlobalConfig } from "./config-inspect.mjs";
import { collectAdapterWarnings } from "./adapter-warnings.mjs";
import { loadConfig, loadProjectConfig } from "./dsl.mjs";
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
import { findProjectConfig, globalWorkspacePaths, workspacePaths } from "./workspace.mjs";

const VALID_KINDS = new Set(supportedResourceKinds());
const VALID_GLOBAL_UI_KINDS = new Set(["skill", "agent", "rule"]);
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
  const context = await editorContext(projectDir, options);
  const { scope, paths, configPath } = context;
  const exists = await fileExists(configPath);

  if (!exists) {
    return {
      scope,
      configPath: paths.configPath,
      workspaceConfigExists: false,
      name: defaultConfigName(projectDir, scope),
      resources: [],
      referencedResources: [],
      globalRefs: [],
      packages: [],
      mcpServers: [],
      hooks: [],
      projectDocs: [],
      settings: {},
      diagnostics: [],
      adapterWarnings: [],
      capabilities: capabilitiesPayload(),
      nextCommands: nextCommands([])
    };
  }

  const diagnostics = await validateForScope(projectDir, { ...options, config: configPath, scope });
  const config = diagnostics.some((item) => item.severity === "error")
    ? await readRawConfig(configPath)
    : await loadConfig(configPath);
  const adapterWarnings = scope === "project" && !diagnostics.some((item) => item.severity === "error")
    ? collectAdapterWarnings(await loadProjectConfig(configPath, options))
    : [];
  const referencedResources = scope === "project" && !diagnostics.some((item) => item.severity === "error")
    ? await referencedEditableResources(configPath, options)
    : [];
  const projectRefs = await readProjectGlobalRefs(projectDir, options);

  return {
    scope,
    configPath,
    workspaceConfigExists: configPath === paths.configPath,
    name: config.name ?? defaultConfigName(projectDir, scope),
    resources: await Promise.all((config.resources ?? []).map((resource) => editableResource(resource, {
      source: scope,
      baseDir: path.dirname(configPath),
      referencedByProject: scope === "global" && hasGlobalRef(projectRefs, resource)
    }))),
    referencedResources,
    globalRefs: config.globalRefs ?? [],
    packages: config.packages ?? [],
    mcpServers: config.mcpServers ?? [],
    hooks: config.hooks ?? [],
    projectDocs: config.projectDocs ?? [],
    settings: config.settings ?? {},
    diagnostics,
    adapterWarnings,
    capabilities: capabilitiesPayload(),
    nextCommands: nextCommands(config.packages ?? [])
  };
}

export async function saveEditableResource(projectDir = process.cwd(), input = {}, options = {}) {
  const scope = normalizeScope(options.scope ?? input.scope ?? "project");
  const resource = normalizeEditableResource(input);
  const diagnostics = validateEditableResource(resource, { scope });
  const blocking = diagnostics.filter((item) => item.blocking);
  if (blocking.length > 0) {
    return { ok: false, diagnostics };
  }

  const context = await editorContext(projectDir, { ...options, scope });
  const { paths, configPath } = context;
  const existing = await readExistingConfig(configPath, defaultConfigName(projectDir, scope));
  const resourcePath = assetBodyPath(resource);
  const metadata = resourceMetadata(resource, resourcePath);
  const bodyPath = path.join(paths.workspaceDir, resourcePath);

  await writeText(bodyPath, ensureTrailingNewline(resource.body));

  const associatedFiles = await writeAssociatedFiles(paths.workspaceDir, resource, resourcePath);
  if (associatedFiles.length > 0) {
    metadata.files = associatedFiles;
  }

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

  const config = baseConfig(existing, projectDir, scope, { resources });

  await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    ok: true,
    diagnostics,
    resource: await editableResource({ ...metadata, body: resource.body, overrides: resource.overrides }, {
      source: scope,
      baseDir: paths.workspaceDir
    }),
    configPath: paths.configPath,
    config: await loadEditableConfig(projectDir, { ...options, scope, config: scope === "project" ? paths.configPath : undefined })
  };
}

export async function addProjectGlobalRef(projectDir = process.cwd(), ref = {}, options = {}) {
  return updateProjectGlobalRef(projectDir, ref, { ...options, action: "add" });
}

export async function removeProjectGlobalRef(projectDir = process.cwd(), ref = {}, options = {}) {
  return updateProjectGlobalRef(projectDir, ref, { ...options, action: "remove" });
}

async function updateProjectGlobalRef(projectDir, input, options) {
  const ref = normalizeGlobalRefInput(input);
  const paths = workspacePaths(projectDir);
  const configPath = await findProjectConfig(projectDir, options.config);
  const existing = await readExistingConfig(configPath, defaultConfigName(projectDir, "project"));
  const currentRefs = Array.isArray(existing.globalRefs) ? existing.globalRefs : [];
  const exists = currentRefs.some((item) => item.kind === ref.kind && normalizeId(item.id) === ref.id);
  const globalRefs = options.action === "remove"
    ? currentRefs.filter((item) => !(item.kind === ref.kind && normalizeId(item.id) === ref.id))
    : exists
      ? currentRefs
      : [...currentRefs, ref];
  const config = baseConfig(existing, projectDir, "project", { globalRefs });
  const validationPath = path.join(paths.workspaceDir, "aof.config.validate.json");

  await writeText(validationPath, `${JSON.stringify(config, null, 2)}\n`);
  const diagnostics = await validateConfig(projectDir, { ...options, config: validationPath });
  await rm(validationPath, { force: true });
  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, diagnostics };
  }

  await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return {
    ok: true,
    diagnostics,
    globalRefs,
    config: await loadEditableConfig(projectDir, { ...options, scope: "project", config: paths.configPath })
  };
}

export async function saveEditableSections(projectDir = process.cwd(), input = {}, options = {}) {
  const scope = normalizeScope(options.scope ?? "project");
  if (scope !== "project") {
    return {
      ok: false,
      diagnostics: [diagnostic("error", "scope", "Expanded sections can only be edited in project scope.", true, "invalid-scope")]
    };
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {
      ok: false,
      diagnostics: [diagnostic("error", "sections", "Expanded section payload must be an object.", true)]
    };
  }

  const paths = workspacePaths(projectDir);
  const configPath = await findProjectConfig(projectDir, options.config);
  const existing = await readExistingConfig(configPath, defaultConfigName(projectDir, "project"));
  const config = {
    ...baseConfig(existing, projectDir, "project"),
    ...(Object.hasOwn(input, "mcpServers") ? { mcpServers: input.mcpServers } : existing.mcpServers ? { mcpServers: existing.mcpServers } : {}),
    ...(Object.hasOwn(input, "hooks") ? { hooks: input.hooks } : existing.hooks ? { hooks: existing.hooks } : {}),
    ...(Object.hasOwn(input, "projectDocs") ? { projectDocs: input.projectDocs } : existing.projectDocs ? { projectDocs: existing.projectDocs } : {}),
    ...(Object.hasOwn(input, "settings") ? { settings: input.settings } : existing.settings ? { settings: existing.settings } : {})
  };

  const validationPath = path.join(paths.workspaceDir, "aof.config.validate.json");
  await writeText(validationPath, `${JSON.stringify(config, null, 2)}\n`);
  const diagnostics = await validateConfig(projectDir, { ...options, config: validationPath });
  await rm(validationPath, { force: true });
  if (diagnostics.some((item) => item.severity === "error")) {
    return { ok: false, diagnostics };
  }

  await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
  return {
    ok: true,
    diagnostics,
    config: await loadEditableConfig(projectDir, { ...options, scope: "project", config: paths.configPath })
  };
}

export function validateEditableResource(input = {}, options = {}) {
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
  if (options.scope === "global" && !VALID_GLOBAL_UI_KINDS.has(resource.kind)) {
    diagnostics.push(diagnostic("error", "kind", `Global setup UI supports skill, agent, and rule resources.`, true, "unsupported-global-kind"));
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

  diagnostics.push(...validateAssociatedFileInputs(resource, options));

  for (const item of capabilityDiagnostics(resource)) {
    diagnostics.push(item);
  }

  return diagnostics;
}

function normalizeScope(scope) {
  if (scope === "project" || scope === "global") return scope;
  throw httpLikeError(`Invalid setup UI config scope "${scope}".`, "invalid-scope");
}

async function editorContext(projectDir, options = {}) {
  const scope = normalizeScope(options.scope ?? "project");
  if (scope === "global") {
    const paths = globalWorkspacePaths(options);
    return { scope, paths, configPath: paths.configPath };
  }

  const paths = workspacePaths(projectDir);
  const configPath = await findProjectConfig(projectDir, options.config);
  return { scope, paths, configPath };
}

async function validateForScope(projectDir, options = {}) {
  return options.scope === "global"
    ? validateGlobalConfig(options)
    : validateConfig(projectDir, options);
}

async function referencedEditableResources(configPath, options = {}) {
  try {
    const projectConfig = await loadProjectConfig(configPath, options);
    return Promise.all(projectConfig.resources
      .filter((resource) => resource._aofSource?.scope === "global")
      .map((resource) => editableResource(resource, {
        source: "global",
        readOnly: true,
        referenced: true,
        baseDir: resource._aofSource?.workspaceDir ?? path.dirname(resource._aofSource?.configPath ?? configPath)
      })));
  } catch {
    return [];
  }
}

async function readProjectGlobalRefs(projectDir, options = {}) {
  try {
    const configPath = await findProjectConfig(projectDir, options.config);
    if (!await fileExists(configPath)) return [];
    const config = await readJson(configPath);
    return Array.isArray(config.globalRefs) ? config.globalRefs : [];
  } catch {
    return [];
  }
}

function hasGlobalRef(refs, resource) {
  return refs.some((ref) => ref.kind === resource.kind && ref.id === resource.id);
}

function defaultConfigName(projectDir, scope) {
  return scope === "global" ? "global-assets" : path.basename(path.resolve(projectDir));
}

function baseConfig(existing, projectDir, scope, overrides = {}) {
  return {
    $schema: existing.$schema ?? "../schemas/aof.schema.json",
    name: existing.name ?? defaultConfigName(projectDir, scope),
    resources: overrides.resources ?? existing.resources ?? [],
    packages: existing.packages ?? [],
    ...(overrides.globalRefs !== undefined ? { globalRefs: overrides.globalRefs } : existing.globalRefs ? { globalRefs: existing.globalRefs } : {}),
    ...(existing.mcpServers ? { mcpServers: existing.mcpServers } : {}),
    ...(existing.hooks ? { hooks: existing.hooks } : {}),
    ...(existing.projectDocs ? { projectDocs: existing.projectDocs } : {}),
    ...(existing.settings ? { settings: existing.settings } : {}),
    ...(existing.items ? { items: existing.items } : {}),
    ...(existing.runtimes ? { runtimes: existing.runtimes } : {})
  };
}

async function writeAssociatedFiles(workspaceDir, resource, resourcePath) {
  if (!Array.isArray(resource.files) || resource.files.length === 0) return [];
  if (resource.kind !== "skill") return [];

  const bodyPath = path.join(workspaceDir, resourcePath);
  const assetDir = path.dirname(bodyPath);
  const result = [];
  for (const file of resource.files) {
    const relativePath = file.path.replaceAll("\\", "/");
    const filePath = path.resolve(assetDir, relativePath);
    await writeText(filePath, ensureTrailingNewline(file.body ?? ""));
    result.push(relativePath);
  }
  return result;
}

function validateAssociatedFileInputs(resource, options = {}) {
  const diagnostics = [];
  if (resource.files === undefined) return diagnostics;
  if (!Array.isArray(resource.files)) {
    diagnostics.push(diagnostic("error", "files", "Associated files must be an array.", true, "invalid-associated-file"));
    return diagnostics;
  }
  if (resource.files.length === 0) return diagnostics;
  if (resource.kind !== "skill") {
    diagnostics.push(diagnostic("error", "files", "Associated files are supported for skill resources only.", true, "unsupported-associated-files"));
    return diagnostics;
  }
  if (options.scope !== "global") {
    diagnostics.push(diagnostic("error", "files", "Setup UI associated-file editing is supported for global skills only.", true, "unsupported-associated-files"));
    return diagnostics;
  }

  const resourcePath = assetBodyPath(resource);
  const assetDir = path.dirname(resourcePath);
  const bodyFile = path.basename(resourcePath);
  for (const [index, file] of resource.files.entries()) {
    const location = `files[${index}]`;
    if (!file || typeof file !== "object" || Array.isArray(file)) {
      diagnostics.push(diagnostic("error", location, "Associated file must be an object with path and body.", true, "invalid-associated-file"));
      continue;
    }
    if (typeof file.path !== "string" || file.path.trim() === "") {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path must be a non-empty string.", true, "invalid-associated-file"));
      continue;
    }
    if (typeof file.body !== "string") {
      diagnostics.push(diagnostic("error", `${location}.body`, "Associated file body must be text.", true, "invalid-associated-file"));
    }
    const normalizedPath = file.path.replaceAll("\\", "/");
    if (path.isAbsolute(file.path)) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path must be relative to the asset directory.", true, "associated-file-escape"));
      continue;
    }
    const resolved = path.resolve(assetDir, normalizedPath);
    const relative = path.relative(assetDir, resolved);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path must stay inside the asset directory.", true, "associated-file-escape"));
      continue;
    }
    if (path.relative(assetDir, resolved).replaceAll("\\", "/") === bodyFile) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path cannot target the primary body file.", true, "associated-file-body"));
    }
  }
  return diagnostics;
}

function normalizeGlobalRefInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw httpLikeError("Global reference must be an object.", "invalid-global-ref");
  }
  if (!VALID_GLOBAL_UI_KINDS.has(input.kind)) {
    throw httpLikeError(`Unsupported global reference kind "${input.kind}".`, "invalid-kind");
  }
  return {
    kind: input.kind,
    id: normalizeId(input.id)
  };
}

function httpLikeError(message, code) {
  const error = new Error(message);
  error.code = code;
  error.status = 400;
  return error;
}

async function readExistingConfig(configPath, defaultName) {
  if (await fileExists(configPath)) {
    return readJson(configPath);
  }

  return {
    $schema: "../schemas/aof.schema.json",
    name: defaultName,
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
    files: normalizeAssociatedFiles(input.files),
    overrides: normalizeOverrides(input.overrides ?? {})
  };
}

function normalizeAssociatedFiles(files) {
  if (files === undefined) return undefined;
  if (!Array.isArray(files)) return files;
  return files.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return file;
    return {
      path: typeof file.path === "string" ? file.path.trim().replaceAll("\\", "/") : file.path,
      body: file.body ?? ""
    };
  });
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

async function editableResource(resource, options = {}) {
  return {
    id: resource.id,
    kind: resource.kind,
    source: options.source ?? resource._aofSource?.scope ?? "project",
    readOnly: Boolean(options.readOnly),
    referenced: Boolean(options.referenced),
    referencedByProject: Boolean(options.referencedByProject),
    name: resource.name ?? resource.id,
    description: resource.description ?? "",
    body: resource.body ?? resource.prompt ?? resource.instructions ?? "",
    runtimes: resource.runtimes ?? ["claude", "codex"],
    ...(resource.path ? { path: resource.path } : {}),
    ...(resource.files ? { files: await editableAssociatedFiles(resource, options.baseDir) } : {}),
    ...(resource.model ? { model: resource.model } : {}),
    ...(resource.tools ? { tools: resource.tools } : {}),
    ...(resource.paths ? { paths: resource.paths } : {}),
    overrides: editableOverrides(resource.overrides ?? {})
  };
}

async function editableAssociatedFiles(resource, baseDir) {
  if (!Array.isArray(resource.files) || !resource.path || !baseDir) return [];
  const assetDir = path.dirname(path.resolve(baseDir, resource.path));
  return Promise.all(resource.files.map(async (filePath) => {
    const normalizedPath = String(filePath).replaceAll("\\", "/");
    const absolutePath = path.resolve(assetDir, normalizedPath);
    let body = "";
    try {
      body = await readFile(absolutePath, "utf8");
    } catch {
      body = "";
    }
    return {
      path: normalizedPath,
      body
    };
  }));
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
