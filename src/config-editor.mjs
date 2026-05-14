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
const VALID_GLOBAL_UI_KINDS = new Set(["skill", "agent", "rule", "workflow"]);
const ASSOCIATED_FILE_KINDS = new Set(["skill", "command"]);
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
      workflows: [],
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
    workflows: config.workflows ?? [],
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
  const hasBodyPath = shouldWritePrimaryBody(resource);
  const resourcePath = assetBodyPath(resource);
  const metadata = resourceMetadata(resource, resourcePath);

  if (hasBodyPath) {
    metadata.path = resourcePath;
    await writeText(path.join(paths.workspaceDir, resourcePath), ensureTrailingNewline(resource.body));
  }

  const associatedFiles = hasBodyPath ? await writeAssociatedFiles(paths.workspaceDir, resource, resourcePath) : [];
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
    ...(Object.hasOwn(input, "workflows") ? { workflows: input.workflows } : existing.workflows ? { workflows: existing.workflows } : {}),
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
  diagnostics.push(...validateSimpleArgumentInputs(resource));
  diagnostics.push(...validateWorkflowArgumentInputs(resource));

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
    $schema: existing.$schema ?? "https://aof.local/schemas/aof.schema.json",
    name: existing.name ?? defaultConfigName(projectDir, scope),
    resources: overrides.resources ?? existing.resources ?? [],
    ...(overrides.workflows !== undefined ? { workflows: overrides.workflows } : existing.workflows ? { workflows: existing.workflows } : {}),
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
  if (!ASSOCIATED_FILE_KINDS.has(resource.kind)) return [];

  const bodyPath = path.join(workspaceDir, resourcePath);
  const assetDir = path.dirname(bodyPath);
  const result = [];
  for (const file of resource.files) {
    const relativePath = normalizeAssociatedFilePath(file.path);
    const filePath = path.resolve(assetDir, "files", relativePath);
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
  if (!ASSOCIATED_FILE_KINDS.has(resource.kind)) {
    diagnostics.push(diagnostic("error", "files", "Associated files are supported for skill and command resources only.", true, "unsupported-associated-files"));
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
    const flatPath = normalizeAssociatedFilePath(normalizedPath);
    if (path.isAbsolute(file.path)) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path must be relative to the asset directory.", true, "associated-file-escape"));
      continue;
    }
    if (pathEscapesByTraversal(normalizedPath)) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path must stay inside the asset directory.", true, "associated-file-escape"));
      continue;
    }
    if (!isFlatAssociatedFilePath(normalizedPath)) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path must be a filename, not a nested path.", true, "invalid-associated-file"));
      continue;
    }
    const resolved = path.resolve(assetDir, "files", flatPath);
    const relative = path.relative(assetDir, resolved);
    if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path must stay inside the asset directory.", true, "associated-file-escape"));
      continue;
    }
    if (flatPath === bodyFile) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Associated file path cannot target the primary body file.", true, "associated-file-body"));
    }
  }
  return diagnostics;
}

function validateSimpleArgumentInputs(resource) {
  const diagnostics = [];
  if (resource.workflow) return diagnostics;
  for (const field of ["arguments", "args", "argumentHint", "argument-hint"]) {
    if (Object.hasOwn(resource, field)) {
      diagnostics.push(diagnostic("error", field, "Simple assets do not support arguments. Use workflow-backed assets for argument handling.", true, "simple-asset-arguments"));
    }
  }

  const texts = [
    ["body", resource.body],
    ["prompt", resource.prompt],
    ["instructions", resource.instructions],
    ...Object.entries(resource.overrides ?? {}).map(([runtime, override]) => [
      `overrides.${runtime}`,
      override?.body ?? override?.prompt ?? override?.instructions
    ])
  ];
  for (const [pathName, text] of texts) {
    if (!hasArgumentMarker(text)) continue;
    diagnostics.push(diagnostic("error", pathName, "Simple asset content appears to depend on arguments. Use workflow-backed assets for argument handling.", true, "simple-asset-arguments"));
  }
  return diagnostics;
}

function validateWorkflowArgumentInputs(resource) {
  const diagnostics = [];
  if (!resource.workflow) return diagnostics;
  if (resource.arguments !== undefined && !Array.isArray(resource.arguments)) {
    diagnostics.push(diagnostic("error", "arguments", "Workflow-backed arguments must be an array.", true, "invalid-workflow-argument"));
  }
  for (const [index, argument] of (Array.isArray(resource.arguments) ? resource.arguments : []).entries()) {
    if (!argument || typeof argument !== "object" || Array.isArray(argument)) {
      diagnostics.push(diagnostic("error", `arguments.${index}`, "Each argument must be an object.", true, "invalid-workflow-argument"));
      continue;
    }
    if (typeof argument.name !== "string" || argument.name.trim() === "") {
      diagnostics.push(diagnostic("error", `arguments.${index}.name`, "Argument name is required.", true, "invalid-workflow-argument"));
    }
  }
  if (resource.argumentOverrides !== undefined && (!resource.argumentOverrides || typeof resource.argumentOverrides !== "object" || Array.isArray(resource.argumentOverrides))) {
    diagnostics.push(diagnostic("error", "argumentOverrides", "Argument overrides must be an object.", true, "invalid-workflow-argument"));
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
    $schema: "https://aof.local/schemas/aof.schema.json",
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
  const resource = {
    ...input,
    id,
    kind,
    runtimes,
    body: input.body ?? input.prompt ?? input.instructions ?? "",
    files: normalizeAssociatedFiles(input.files),
    overrides: normalizeOverrides(input.overrides ?? {})
  };
  const workflow = normalizeOptionalId(input.workflow);
  const argumentHint = normalizeOptionalString(input.argumentHint);
  const args = normalizeArguments(input.arguments);
  const argumentOverrides = normalizeArgumentOverrides(input.argumentOverrides);
  if (workflow !== undefined) resource.workflow = workflow;
  if (argumentHint !== undefined) resource.argumentHint = argumentHint;
  if (args !== undefined) resource.arguments = args;
  if (argumentOverrides !== undefined) resource.argumentOverrides = argumentOverrides;
  return resource;
}

function normalizeOptionalId(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeId(value);
}

function normalizeOptionalString(value) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

function normalizeArguments(args) {
  if (args === undefined) return undefined;
  if (!Array.isArray(args)) return args;
  return args.map((arg) => ({
    name: typeof arg?.name === "string" ? normalizeId(arg.name) : arg?.name,
    ...(arg?.description ? { description: String(arg.description) } : {}),
    ...(arg?.required !== undefined ? { required: Boolean(arg.required) } : {}),
    ...(arg?.hint ? { hint: String(arg.hint) } : {})
  }));
}

function normalizeArgumentOverrides(overrides) {
  if (overrides === undefined) return undefined;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) return overrides;
  const result = {};
  for (const [name, value] of Object.entries(overrides)) {
    result[normalizeId(name)] = {
      ...(value && typeof value === "object" && !Array.isArray(value) ? value : {})
    };
  }
  return result;
}

function normalizeAssociatedFiles(files) {
  if (files === undefined) return undefined;
  if (!Array.isArray(files)) return files;
  return files.map((file) => {
    if (!file || typeof file !== "object" || Array.isArray(file)) return file;
    const rawPath = typeof file.path === "string" && file.path.trim() !== ""
      ? file.path
      : file.name;
    return {
      path: normalizeAssociatedFilePath(rawPath),
      body: file.body ?? ""
    };
  });
}

function normalizeAssociatedFilePath(filePath) {
  if (typeof filePath !== "string") return filePath;
  const normalized = filePath.trim().replaceAll("\\", "/");
  return normalized.startsWith("files/") ? normalized.slice("files/".length) : normalized;
}

function isFlatAssociatedFilePath(filePath) {
  if (typeof filePath !== "string") return false;
  const normalized = filePath.trim().replaceAll("\\", "/");
  const flat = normalized.startsWith("files/") ? normalized.slice("files/".length) : normalized;
  return flat !== "" && !flat.includes("/");
}

function pathEscapesByTraversal(filePath) {
  const normalized = String(filePath ?? "").replaceAll("\\", "/");
  return normalized === ".." || normalized.startsWith("../") || normalized.includes("/../");
}

function hasArgumentMarker(text) {
  const value = String(text ?? "");
  return value.includes("$ARGUMENTS")
    || value.includes("{{GSD_ARGS}}")
    || /\bargument-hint\b/.test(value)
    || /\{\{\s*args(?:\.|\s*\})/.test(value);
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
    ...(resource.workflow ? { workflow: resource.workflow } : {}),
    ...(resource.argumentHint ? { argumentHint: resource.argumentHint } : {}),
    ...(resource.arguments ? { arguments: resource.arguments } : {}),
    ...(resource.argumentOverrides ? { argumentOverrides: resource.argumentOverrides } : {}),
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
    const normalizedPath = normalizeAssociatedFilePath(String(filePath).replaceAll("\\", "/"));
    const absolutePath = path.resolve(assetDir, "files", normalizedPath);
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
    runtimes: resource.runtimes
  };

  for (const field of ["name", "description", "model", "tools", "paths", "workflow", "argumentHint", "arguments", "argumentOverrides"]) {
    if (hasValue(resource[field])) metadata[field] = resource[field];
  }

  return metadata;
}

function shouldWritePrimaryBody(resource) {
  return !resource.workflow || hasValue(resource.body);
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
    const message = capability === "command" && runtime === "codex"
      ? "Command assets are not supported for Codex. Target Claude commands or create a Codex skill explicitly."
      : `${capability} is not supported for ${runtime}.`;
    return diagnostic("error", pathName, message, true, status);
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
  const commands = ["aof assets apply --dry-run"];
  if ((packages ?? []).some((pkg) => pkg.id === "gsd")) {
    commands.push("aof packages install gsd --dry-run");
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
