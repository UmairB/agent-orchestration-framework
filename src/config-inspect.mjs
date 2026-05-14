import path from "node:path";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { loadConfig, loadProjectConfig } from "./dsl.mjs";
import {
  createAssetReferenceIndex,
  effectiveRuntimes,
  extractAssetReferencePlaceholders,
  extractInvalidAssetReferencePlaceholders,
  getAssetReference
} from "./asset-references.mjs";
import { normalizeId } from "./fs.mjs";
import { readLock } from "./lock.mjs";
import { createRenderPlan, planApplyActions } from "./render-plan.mjs";
import { collectAdapterWarnings } from "./adapter-warnings.mjs";
import { normalizePackage } from "./packages.mjs";
import {
  CAPABILITIES,
  CAPABILITY_STATUS,
  RUNTIMES,
  supportedGlobalRefKinds,
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
const VALID_GLOBAL_REF_KINDS = new Set(supportedGlobalRefKinds());
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
    config = await loadProjectConfig(configPath, options);
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
      runtimes: resource.runtimes,
      source: resource._aofSource?.scope ?? "local"
    })) ?? [],
    workflows: config?.workflows?.map((workflow) => ({
      id: workflow.id,
      runtimes: workflow.runtimes,
      source: workflow._aofSource?.scope ?? "local"
    })) ?? [],
    globalRefs: config?.globalRefs ?? [],
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
    workflows: config?.workflows?.map((workflow) => ({
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      path: workflow.path,
      runtimes: workflow.runtimes
    })) ?? [],
    diagnostics
  };
}

export async function adapterWarningsForConfig(projectDir = process.cwd(), options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  const diagnostics = await validateConfig(projectDir, options);
  if (diagnostics.some((item) => item.severity === "error")) return [];
  return collectAdapterWarnings(await loadProjectConfig(configPath, options), {
    targetDir: projectDir,
    runtimes: options.runtimes ?? supportedRuntimes(),
    global: Boolean(options.global)
  });
}

export async function validateConfig(projectDir = process.cwd(), options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  return validateConfigFile(configPath, { validateGlobalRefs: true, globalOptions: options });
}

export async function validateGlobalConfig(options = {}) {
  const paths = globalWorkspacePaths(options);
  if (!await exists(paths.configPath)) return [];
  return validateConfigFile(paths.configPath);
}

async function validateConfigFile(configPath, options = {}) {
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
  if (raw.workflows !== undefined && !Array.isArray(raw.workflows)) {
    diagnostics.push(diagnostic("error", "workflows", "workflows must be an array when provided."));
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
  if (raw.globalRefs !== undefined && !Array.isArray(raw.globalRefs)) {
    diagnostics.push(diagnostic("error", "globalRefs", "globalRefs must be an array when provided."));
  }
  if (raw.settings !== undefined && (!raw.settings || typeof raw.settings !== "object" || Array.isArray(raw.settings))) {
    diagnostics.push(diagnostic("error", "settings", "settings must be an object when provided."));
  }

  const baseDir = path.dirname(configPath);
  const localWorkflows = Array.isArray(raw.workflows) ? raw.workflows : [];
  for (const [index, workflow] of localWorkflows.entries()) {
    await validateWorkflow(workflow, index, baseDir, diagnostics);
  }

  const globalRefs = validateGlobalRefs(raw, diagnostics);
  const referencedResources = [];
  const referencedWorkflows = [];
  if (options.validateGlobalRefs) {
    await validateReferencedGlobals(raw, globalRefs, diagnostics, options.globalOptions ?? {}, referencedWorkflows, referencedResources);
  }

  const workflowIndex = workflowIndexFor(localWorkflows, referencedWorkflows);
  const localResources = Array.isArray(raw.resources) ? raw.resources : [];
  for (const [index, resource] of localResources.entries()) {
    await validateResource(resource, index, baseDir, diagnostics, null, workflowIndex);
  }
  await validateAssetReferencePlaceholders([
    ...localResources.map((resource, index) => ({ type: "resource", item: resource, baseDir, location: `resources[${index}]` })),
    ...localWorkflows.map((workflow, index) => ({ type: "workflow", item: workflow, baseDir, location: `workflows[${index}]` })),
    ...referencedResources.map((entry) => ({ type: "resource", item: entry.item, baseDir: entry.baseDir, location: entry.location })),
    ...referencedWorkflows.map((workflow) => ({
      type: "workflow",
      item: workflow,
      baseDir: workflow._aofSource?.baseDir ?? baseDir,
      location: workflow._aofSource?.location ?? "globalRefs.workflow"
    }))
  ], createAssetReferenceIndex([...localResources, ...referencedResources.map((entry) => entry.item)], [...localWorkflows, ...referencedWorkflows]), diagnostics);

  for (const [index, pkg] of (Array.isArray(raw.packages) ? raw.packages : []).entries()) {
    validatePackage(pkg, index, diagnostics);
  }
  validateDuplicates(raw.resources, "resources", (item) => item && `${item.kind}:${item.id}`, diagnostics);
  validateDuplicates(raw.workflows, "workflows", (item) => item?.id, diagnostics);
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
    const config = await loadProjectConfig(inspection.configPath, options);
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

function validateGlobalRefs(raw, diagnostics) {
  if (!Array.isArray(raw.globalRefs)) return [];
  const refs = [];
  for (const [index, ref] of raw.globalRefs.entries()) {
    const location = `globalRefs[${index}]`;
    if (!ref || typeof ref !== "object" || Array.isArray(ref)) {
      diagnostics.push(diagnostic("error", location, "Each global reference must be an object."));
      continue;
    }
    if (!VALID_GLOBAL_REF_KINDS.has(ref.kind)) {
      diagnostics.push(diagnostic("error", `${location}.kind`, `Unsupported global reference kind "${ref.kind}".`));
      continue;
    }
    if (typeof ref.id !== "string" || ref.id.trim() === "") {
      diagnostics.push(diagnostic("error", `${location}.id`, "Global reference id is required."));
      continue;
    }
    let id;
    try {
      id = normalizeId(ref.id);
    } catch (error) {
      diagnostics.push(diagnostic("error", `${location}.id`, error.message));
      continue;
    }
    refs.push({ index, kind: ref.kind, id });
  }

  validateDuplicates(refs, "globalRefs", (ref) => `${ref.kind}:${ref.id}`, diagnostics, (ref) => ref.index);
  validateLocalGlobalConflicts(raw, refs, diagnostics);
  return refs;
}

async function validateReferencedGlobals(raw, refs, diagnostics, options = {}, referencedWorkflows = [], referencedResources = []) {
  if (refs.length === 0) return;
  const paths = globalWorkspacePaths(options);
  let globalRaw;
  try {
    globalRaw = await readJsonWithDiagnostic(paths.configPath);
  } catch (error) {
    diagnostics.push(diagnostic("error", "globalRefs", `Cannot read global config: ${error.message}`, error.code ?? "unreadable-global-config"));
    return;
  }

  if (!globalRaw || typeof globalRaw !== "object" || Array.isArray(globalRaw)) {
    diagnostics.push(diagnostic("error", "globalRefs", "Global AOF config must be a JSON object.", "invalid-global-config"));
    return;
  }

  const globalResources = Array.isArray(globalRaw.resources) ? globalRaw.resources : [];
  const globalWorkflows = Array.isArray(globalRaw.workflows) ? globalRaw.workflows : [];
  const globalBaseDir = path.dirname(paths.configPath);
  for (const ref of refs.filter((item) => item.kind === "workflow")) {
    const workflow = globalWorkflows.find((item) => typeof item?.id === "string" && normalizeId(item.id) === ref.id);
    if (!workflow) {
      diagnostics.push(diagnostic("error", `globalRefs[${ref.index}]`, `Missing global workflow: ${ref.id}`, "missing-global-workflow"));
      continue;
    }
    await validateWorkflow(workflow, ref.index, globalBaseDir, diagnostics, `globalRefs[${ref.index}].workflow`);
    referencedWorkflows.push({
      ...workflow,
      id: ref.id,
      _aofSource: {
        scope: "global",
        id: ref.id,
        kind: "workflow",
        baseDir: globalBaseDir,
        location: `globalRefs[${ref.index}].workflow`
      }
    });
  }

  const referencedWorkflowIndex = workflowIndexFor([], referencedWorkflows);
  for (const ref of refs.filter((item) => item.kind !== "workflow")) {
    const resource = globalResources.find((item) => item?.kind === ref.kind && typeof item.id === "string" && normalizeId(item.id) === ref.id);
    if (!resource) {
      diagnostics.push(diagnostic("error", `globalRefs[${ref.index}]`, `Missing global resource: ${ref.kind}:${ref.id}`, "missing-global-resource"));
      continue;
    }
    await validateResource(resource, ref.index, globalBaseDir, diagnostics, `globalRefs[${ref.index}].resource`, referencedWorkflowIndex);
    referencedResources.push({
      item: { ...resource, id: ref.id, kind: ref.kind, _aofSource: { scope: "global", id: ref.id, kind: ref.kind, baseDir: globalBaseDir } },
      baseDir: globalBaseDir,
      location: `globalRefs[${ref.index}].resource`
    });
  }
}

function validateLocalGlobalConflicts(raw, refs, diagnostics) {
  if (refs.length === 0) return;
  const localResourceKeys = new Set((Array.isArray(raw.resources) ? raw.resources : []).flatMap((resource) => {
    if (!resource?.kind || typeof resource.id !== "string") return [];
    try {
      return [`${resource.kind}:${normalizeId(resource.id)}`];
    } catch {
      return [];
    }
  }));
  const localWorkflowKeys = new Set((Array.isArray(raw.workflows) ? raw.workflows : []).flatMap((workflow) => {
    if (typeof workflow?.id !== "string") return [];
    try {
      return [`workflow:${normalizeId(workflow.id)}`];
    } catch {
      return [];
    }
  }));
  for (const ref of refs) {
    const key = `${ref.kind}:${ref.id}`;
    if (localResourceKeys.has(key) || localWorkflowKeys.has(key)) {
      diagnostics.push(diagnostic("error", `globalRefs[${ref.index}]`, `Global reference conflicts with local resource ${key}.`, "local-global-conflict"));
    }
  }
}

async function validateResource(resource, index, baseDir, diagnostics, locationOverride = null, workflowIndex = new Map()) {
  const location = locationOverride ?? `resources[${index}]`;
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
  validateResourceCapabilities(resource, location, diagnostics);

  if (resource.path) {
    await requireFile(path.resolve(baseDir, resource.path), `${location}.path`, diagnostics);
  }

  await validateWorkflowBackedResource(resource, location, diagnostics, workflowIndex);
  await validateSimpleAssetArguments(resource, baseDir, location, diagnostics);
  await validateAssociatedFiles(resource, baseDir, location, diagnostics);
  await validateAssociatedFileReferences(resource, baseDir, location, diagnostics);

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

function validateResourceCapabilities(resource, location, diagnostics) {
  if (!VALID_KINDS.has(resource.kind)) return;
  const runtimes = Array.isArray(resource.runtimes) && resource.runtimes.length > 0
    ? resource.runtimes
    : supportedRuntimes();

  for (const runtime of runtimes) {
    if (!VALID_RUNTIMES.has(runtime)) continue;
    const status = CAPABILITIES[resource.kind]?.[runtime];
    if (status !== CAPABILITY_STATUS.unsupportedFail) continue;
    diagnostics.push(diagnostic(
      "error",
      `${location}.runtimes`,
      unsupportedCapabilityMessage(resource.kind, runtime),
      "unsupported-runtime-capability"
    ));
  }
}

async function validateWorkflow(workflow, index, baseDir, diagnostics, locationOverride = null) {
  const location = locationOverride ?? `workflows[${index}]`;
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) {
    diagnostics.push(diagnostic("error", location, "Each workflow must be an object.", "invalid-workflow"));
    return;
  }

  validateId(workflow.id, `${location}.id`, "Workflow id is required.", diagnostics);
  validateRuntimes(workflow.runtimes, `${location}.runtimes`, diagnostics);

  if (workflow.path) {
    const workflowPath = path.resolve(baseDir, workflow.path);
    if (!isInside(baseDir, workflowPath)) {
      diagnostics.push(diagnostic("error", `${location}.path`, "Workflow path must stay inside the .aof workspace.", "workflow-file-escape"));
    } else {
      await requireFile(workflowPath, `${location}.path`, diagnostics, "missing-workflow-file");
    }
  } else if (typeof workflow.body !== "string") {
    diagnostics.push(diagnostic("error", location, "Workflow requires either path or body.", "missing-workflow-body"));
  }

  if (workflow.argumentHint !== undefined && typeof workflow.argumentHint !== "string") {
    diagnostics.push(diagnostic("error", `${location}.argumentHint`, "Workflow argumentHint must be a string when provided.", "invalid-workflow-argument"));
  }

  validateArguments(workflow.arguments, `${location}.arguments`, diagnostics);
}

function validateArguments(args, location, diagnostics) {
  if (args === undefined) return;
  if (!Array.isArray(args)) {
    diagnostics.push(diagnostic("error", location, "arguments must be an array when provided.", "invalid-workflow-argument"));
    return;
  }

  const seen = new Set();
  for (const [index, arg] of args.entries()) {
    const argLocation = `${location}[${index}]`;
    if (!arg || typeof arg !== "object" || Array.isArray(arg)) {
      diagnostics.push(diagnostic("error", argLocation, "Each argument must be an object.", "invalid-workflow-argument"));
      continue;
    }
    if (typeof arg.name !== "string" || arg.name.trim() === "") {
      diagnostics.push(diagnostic("error", `${argLocation}.name`, "Argument name is required.", "invalid-workflow-argument"));
      continue;
    }
    let name;
    try {
      name = normalizeId(arg.name);
    } catch (error) {
      diagnostics.push(diagnostic("error", `${argLocation}.name`, error.message, "invalid-workflow-argument"));
      continue;
    }
    if (seen.has(name)) {
      diagnostics.push(diagnostic("error", `${argLocation}.name`, `Duplicate argument name "${name}".`, "duplicate-workflow-argument"));
    }
    seen.add(name);
    if (arg.description !== undefined && typeof arg.description !== "string") {
      diagnostics.push(diagnostic("error", `${argLocation}.description`, "Argument description must be a string when provided.", "invalid-workflow-argument"));
    }
    if (arg.required !== undefined && typeof arg.required !== "boolean") {
      diagnostics.push(diagnostic("error", `${argLocation}.required`, "Argument required must be a boolean when provided.", "invalid-workflow-argument"));
    }
  }
}

function workflowIndexFor(localWorkflows, referencedWorkflows) {
  const result = new Map();
  for (const workflow of [...localWorkflows, ...referencedWorkflows]) {
    if (typeof workflow?.id !== "string") continue;
    try {
      result.set(normalizeId(workflow.id), {
        ...workflow,
        id: normalizeId(workflow.id),
        runtimes: Array.isArray(workflow.runtimes) && workflow.runtimes.length > 0 ? workflow.runtimes : supportedRuntimes()
      });
    } catch {
      // Invalid ids are reported by validateWorkflow.
    }
  }
  return result;
}

function workflowArgumentNames(workflow) {
  const result = new Set();
  for (const arg of workflow?.arguments ?? []) {
    if (typeof arg?.name !== "string") continue;
    try {
      result.add(normalizeId(arg.name));
    } catch {
      // Invalid argument names are reported by validateArguments.
    }
  }
  return result;
}

function validateWorkflowBackedResource(resource, location, diagnostics, workflowIndex) {
  if (!resource || typeof resource !== "object" || Array.isArray(resource)) return;

  if (resource.workflow === undefined) {
    if (resource.argumentOverrides !== undefined) {
      diagnostics.push(diagnostic("error", `${location}.argumentOverrides`, "argumentOverrides require a workflow-backed asset.", "invalid-workflow-argument"));
    }
    return;
  }

  if (typeof resource.workflow !== "string" || resource.workflow.trim() === "") {
    diagnostics.push(diagnostic("error", `${location}.workflow`, "workflow must reference a workflow id.", "missing-workflow"));
    return;
  }

  let workflowId;
  try {
    workflowId = normalizeId(resource.workflow);
  } catch (error) {
    diagnostics.push(diagnostic("error", `${location}.workflow`, error.message, "missing-workflow"));
    return;
  }

  const workflow = workflowIndex.get(workflowId);
  if (!workflow) {
    diagnostics.push(diagnostic("error", `${location}.workflow`, `Missing workflow: ${workflowId}`, "missing-workflow"));
    return;
  }

  const workflowRuntimes = new Set(effectiveRuntimes(workflow));
  for (const runtime of effectiveRuntimes(resource)) {
    if (!VALID_RUNTIMES.has(runtime)) continue;
    if (!workflowRuntimes.has(runtime)) {
      diagnostics.push(diagnostic(
        "error",
        `${location}.workflow`,
        `Workflow "${workflowId}" does not target runtime "${runtime}".`,
        "workflow-runtime-mismatch"
      ));
    }
  }

  validateWrapperArgumentMetadata(resource, workflow, location, diagnostics);
}

function validateWrapperArgumentMetadata(resource, workflow, location, diagnostics) {
  if (resource.argumentHint !== undefined && typeof resource.argumentHint !== "string") {
    diagnostics.push(diagnostic("error", `${location}.argumentHint`, "argumentHint must be a string when provided.", "invalid-workflow-argument"));
  }
  validateArguments(resource.arguments, `${location}.arguments`, diagnostics);

  if (resource.argumentOverrides === undefined) return;
  if (!resource.argumentOverrides || typeof resource.argumentOverrides !== "object" || Array.isArray(resource.argumentOverrides)) {
    diagnostics.push(diagnostic("error", `${location}.argumentOverrides`, "argumentOverrides must be an object when provided.", "invalid-workflow-argument"));
    return;
  }

  const declared = workflowArgumentNames(workflow);
  for (const [name, override] of Object.entries(resource.argumentOverrides)) {
    const overrideLocation = `${location}.argumentOverrides.${name}`;
    let normalizedName;
    try {
      normalizedName = normalizeId(name);
    } catch (error) {
      diagnostics.push(diagnostic("error", overrideLocation, error.message, "invalid-workflow-argument"));
      continue;
    }
    if (!declared.has(normalizedName)) {
      diagnostics.push(diagnostic(
        "error",
        overrideLocation,
        `Argument override references undeclared workflow argument "${normalizedName}".`,
        "invalid-workflow-argument"
      ));
    }
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      diagnostics.push(diagnostic("error", overrideLocation, "Argument override must be an object.", "invalid-workflow-argument"));
      continue;
    }
    if (override.description !== undefined && typeof override.description !== "string") {
      diagnostics.push(diagnostic("error", `${overrideLocation}.description`, "Argument override description must be a string when provided.", "invalid-workflow-argument"));
    }
    if (override.required !== undefined && typeof override.required !== "boolean") {
      diagnostics.push(diagnostic("error", `${overrideLocation}.required`, "Argument override required must be a boolean when provided.", "invalid-workflow-argument"));
    }
    if (override.hint !== undefined && typeof override.hint !== "string") {
      diagnostics.push(diagnostic("error", `${overrideLocation}.hint`, "Argument override hint must be a string when provided.", "invalid-workflow-argument"));
    }
  }
}

function unsupportedCapabilityMessage(kind, runtime) {
  if (kind === "command" && runtime === "codex") {
    return "Command assets are not supported for Codex. Target Claude commands with runtimes [\"claude\"], or create a Codex skill explicitly.";
  }
  return `${kind} assets are not supported for ${runtime}.`;
}

async function validateSimpleAssetArguments(resource, baseDir, location, diagnostics) {
  if (!VALID_KINDS.has(resource.kind)) return;
  if (resource.workflow !== undefined) return;

  for (const field of ["arguments", "args", "argumentHint", "argument-hint"]) {
    if (Object.hasOwn(resource, field)) {
      diagnostics.push(diagnostic(
        "error",
        `${location}.${field}`,
        "Simple assets do not support arguments. Use workflow-backed assets for argument handling.",
        "simple-asset-arguments"
      ));
    }
  }

  for (const { pathName, text } of await resourceReferenceTexts(resource, baseDir, location)) {
    if (!hasArgumentMarker(text)) continue;
    diagnostics.push(diagnostic(
      "error",
      pathName,
      "Simple asset content appears to depend on arguments. Use workflow-backed assets for argument handling.",
      "simple-asset-arguments"
    ));
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

function validateDuplicates(items, collectionName, keyFor, diagnostics, indexFor = (_item, index) => index) {
  const seen = new Map();
  for (const [index, item] of (items ?? []).entries()) {
    const key = keyFor(item);
    if (!key || String(key).includes("undefined")) continue;
    const normalized = String(key).toLowerCase();
    if (seen.has(normalized)) {
      const currentIndex = indexFor(item, index);
      const seenIndex = seen.get(normalized);
      diagnostics.push(diagnostic("error", `${collectionName}[${currentIndex}].id`, `Duplicate ${collectionName} id also used at ${collectionName}[${seenIndex}].`));
      continue;
    }
    seen.set(normalized, indexFor(item, index));
  }
}

async function validateAssociatedFiles(resource, baseDir, location, diagnostics) {
  if (resource.files === undefined) return;
  if (!Array.isArray(resource.files)) {
    diagnostics.push(diagnostic("error", `${location}.files`, "files must be an array when provided."));
    return;
  }
  if (!supportsAssociatedFiles(resource.kind)) {
    diagnostics.push(diagnostic("error", `${location}.files`, "Associated files are supported for skill and command resources only.", "unsupported-associated-files"));
    return;
  }
  if (!resource.path) {
    diagnostics.push(diagnostic("error", `${location}.files`, "Associated files require a file-backed resource path.", "associated-files-require-path"));
    return;
  }

  const bodyPath = path.resolve(baseDir, resource.path);
  const assetDir = path.dirname(bodyPath);
  const bodyFileName = path.basename(bodyPath);

  for (const [fileIndex, entry] of resource.files.entries()) {
    const entryLocation = `${location}.files[${fileIndex}]`;
    if (typeof entry !== "string" || entry.trim() === "") {
      diagnostics.push(diagnostic("error", entryLocation, "Associated file path must be a non-empty string.", "invalid-associated-file"));
      continue;
    }
    if (path.isAbsolute(entry)) {
      diagnostics.push(diagnostic("error", entryLocation, "Associated file path must be relative to the asset directory.", "associated-file-escape"));
      continue;
    }

    if (pathEscapesByTraversal(entry)) {
      diagnostics.push(diagnostic("error", entryLocation, "Associated file path must stay inside the asset directory.", "associated-file-escape"));
      continue;
    }

    const normalizedEntry = normalizeAssociatedFileName(entry);
    if (!isFlatAssociatedFilePath(entry)) {
      diagnostics.push(diagnostic("error", entryLocation, "Associated file path must be a filename, not a nested path.", "invalid-associated-file"));
      continue;
    }

    const resolved = path.resolve(assetDir, "files", normalizedEntry);
    if (!isInside(assetDir, resolved)) {
      diagnostics.push(diagnostic("error", entryLocation, "Associated file path must stay inside the asset directory.", "associated-file-escape"));
      continue;
    }
    if (normalizedEntry === bodyFileName) {
      diagnostics.push(diagnostic("error", entryLocation, "Associated file path cannot target the primary body file.", "associated-file-body"));
      continue;
    }

    try {
      const stat = await lstat(resolved);
      if (stat.isSymbolicLink()) {
        const real = await realpath(resolved);
        if (!isInside(assetDir, real)) {
          diagnostics.push(diagnostic("error", entryLocation, "Associated file symlink must stay inside the asset directory.", "associated-file-escape"));
          continue;
        }
        diagnostics.push(diagnostic("error", entryLocation, "Associated file symlinks are not supported.", "associated-file-symlink"));
        continue;
      }
      if (!stat.isFile()) {
        diagnostics.push(diagnostic("error", entryLocation, "Associated file path must point to a regular file.", "associated-file-not-file"));
      }
    } catch (error) {
      if (error.code === "ENOENT") {
        diagnostics.push(diagnostic("error", entryLocation, `Missing associated file: ${resolved}`, "missing-associated-file"));
      } else {
        diagnostics.push(diagnostic("error", entryLocation, `Cannot read associated file: ${error.message}`, error.code ?? "unreadable-associated-file"));
      }
    }
  }
}

async function validateAssociatedFileReferences(resource, baseDir, location, diagnostics) {
  if (!supportsAssociatedFiles(resource.kind)) return;

  let id;
  try {
    id = normalizeId(resource.id);
  } catch {
    return;
  }

  const allowed = generatedAssociatedReferencePaths({ ...resource, id });
  const declared = declaredAssociatedFilePlaceholders(resource);

  for (const { pathName, text } of await resourceReferenceTexts(resource, baseDir, location)) {
    for (const placeholder of extractFilePlaceholders(text)) {
      if (!isFlatAssociatedFilePath(placeholder)) {
        diagnostics.push(diagnostic(
          "error",
          pathName,
          `Associated file placeholder must name one file, not a nested path: {{files.${placeholder}}}`,
          "invalid-associated-file-reference"
        ));
        continue;
      }
      if (!declared.has(placeholder)) {
        diagnostics.push(diagnostic(
          "error",
          pathName,
          `Referenced associated file placeholder is not declared for ${resource.kind}:${id}: {{files.${placeholder}}}`,
          "invalid-associated-file-reference"
        ));
      }
    }

    for (const reference of extractRuntimePathReferences(text)) {
      if (!isRelevantAssociatedReference(resource.kind, id, reference)) continue;
      if (allowed.has(reference)) continue;
      diagnostics.push(diagnostic(
        "error",
        pathName,
        `Referenced generated support file is not declared for ${resource.kind}:${id}: ${reference}`,
        "invalid-associated-file-reference"
      ));
    }
  }
}

async function validateAssetReferencePlaceholders(entries, referenceIndex, diagnostics) {
  for (const entry of entries) {
    const texts = entry.type === "workflow"
      ? await workflowReferenceTexts(entry.item, entry.baseDir, entry.location)
      : await resourceReferenceTexts(entry.item, entry.baseDir, entry.location);

    for (const { pathName, text, runtimes } of texts) {
      for (const invalid of extractInvalidAssetReferencePlaceholders(text)) {
        diagnostics.push(diagnostic("error", pathName, invalid.message, invalid.code));
      }

      for (const reference of extractAssetReferencePlaceholders(text)) {
        const target = getAssetReference(referenceIndex, reference);
        if (!target) {
          diagnostics.push(diagnostic("error", pathName, `Missing asset reference: ${reference.raw}`, "missing-asset-reference"));
          continue;
        }

        const targetRuntimes = new Set(target.runtimes);
        for (const runtime of runtimes ?? supportedRuntimes()) {
          if (!VALID_RUNTIMES.has(runtime) || targetRuntimes.has(runtime)) continue;
          diagnostics.push(diagnostic(
            "error",
            pathName,
            `Asset reference ${reference.raw} does not target runtime "${runtime}".`,
            "asset-reference-runtime-mismatch"
          ));
        }
      }
    }
  }
}

function declaredAssociatedFilePlaceholders(resource) {
  const result = new Set();
  for (const filePath of Array.isArray(resource.files) ? resource.files : []) {
    if (typeof filePath !== "string") continue;
    const normalized = normalizeAssociatedFileName(filePath);
    result.add(normalized);
  }
  return result;
}

function generatedAssociatedReferencePaths(resource) {
  const result = new Set();
  const runtimes = Array.isArray(resource.runtimes) && resource.runtimes.length > 0 ? resource.runtimes : supportedRuntimes();
  for (const runtime of runtimes) {
    const adapter = RUNTIMES[runtime];
    if (!adapter?.localRoot) continue;
    const root = normalizePath(adapter.localRoot);
    if (resource.kind === "skill") {
      result.add(`${root}/skills/${resource.id}/SKILL.md`);
      for (const filePath of resource.files ?? []) {
        result.add(`${root}/skills/${resource.id}/${normalizeAssociatedFileName(filePath)}`);
      }
    }
    if (resource.kind === "command") {
      result.add(`${root}/commands/${resource.id}.md`);
      for (const filePath of resource.files ?? []) {
        result.add(`${root}/commands/${commandAssociatedOutputPath(filePath)}`);
      }
    }
  }
  return result;
}

function commandAssociatedOutputPath(filePath) {
  return normalizeAssociatedFileName(filePath);
}

async function resourceReferenceTexts(resource, baseDir, location) {
  const result = [];
  const resourceRuntimes = effectiveRuntimes(resource);
  const inlineText = resource.body ?? resource.prompt ?? resource.instructions;
  if (typeof inlineText === "string") {
    result.push({
      pathName: `${location}.${resource.body !== undefined ? "body" : resource.prompt !== undefined ? "prompt" : "instructions"}`,
      text: inlineText,
      runtimes: resourceRuntimes
    });
  }
  if (resource.path) {
    try {
      result.push({ pathName: `${location}.path`, text: await readFile(path.resolve(baseDir, resource.path), "utf8"), runtimes: resourceRuntimes });
    } catch {
      // Missing/unreadable primary files are reported by requireFile.
    }
  }

  for (const [runtime, override] of Object.entries(resource.overrides ?? {})) {
    let value = override;
    if (typeof override === "string") {
      try {
        value = JSON.parse(await readFile(path.resolve(baseDir, override), "utf8"));
      } catch {
        continue;
      }
    }
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const overrideText = value.body ?? value.prompt ?? value.instructions;
    if (typeof overrideText === "string") {
      result.push({ pathName: `${location}.overrides.${runtime}`, text: overrideText, runtimes: [runtime] });
    }
  }

  return result;
}

async function workflowReferenceTexts(workflow, baseDir, location) {
  const result = [];
  const runtimes = effectiveRuntimes(workflow);
  if (typeof workflow.body === "string") {
    result.push({ pathName: `${location}.body`, text: workflow.body, runtimes });
  }
  if (workflow.path) {
    try {
      result.push({ pathName: `${location}.path`, text: await readFile(path.resolve(baseDir, workflow.path), "utf8"), runtimes });
    } catch {
      // Missing/unreadable workflow files are reported by requireFile.
    }
  }
  return result;
}

function extractRuntimePathReferences(text) {
  const references = new Set();
  const pattern = /(?:^|[\s`"'(])((?:\.claude|\.codex)[\\/][^\s`"')\]}>,;]+)/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    references.add(normalizePath(match[1]).replace(/[.:]+$/, ""));
  }
  return references;
}

function extractFilePlaceholders(text) {
  const references = new Set();
  const pattern = /\{\{\s*files\.([^}]+?)\s*\}\}/g;
  for (const match of String(text ?? "").matchAll(pattern)) {
    references.add(normalizePath(match[1].trim()));
  }
  return references;
}

function hasArgumentMarker(text) {
  const value = String(text ?? "");
  return value.includes("$ARGUMENTS")
    || value.includes("{{GSD_ARGS}}")
    || /\bargument-hint\b/.test(value)
    || /\{\{\s*args(?:\.|\s*\})/.test(value);
}

function normalizeAssociatedFileName(filePath) {
  const normalized = normalizePath(filePath);
  return normalized.startsWith("files/") ? normalized.slice("files/".length) : normalized;
}

function isFlatAssociatedFilePath(filePath) {
  if (typeof filePath !== "string") return false;
  const normalized = normalizeAssociatedFileName(filePath);
  return normalized !== "" && !normalized.includes("/");
}

function pathEscapesByTraversal(filePath) {
  const normalized = normalizePath(filePath);
  return normalized === ".." || normalized.startsWith("../") || normalized.includes("/../");
}

function isRelevantAssociatedReference(kind, id, reference) {
  for (const runtime of supportedRuntimes()) {
    const adapter = RUNTIMES[runtime];
    if (!adapter?.localRoot) continue;
    const root = normalizePath(adapter.localRoot);
    if (kind === "skill" && reference.startsWith(`${root}/skills/${id}/`)) return true;
    if (kind === "command" && reference.startsWith(`${root}/commands/`)) return true;
  }
  return false;
}

function supportsAssociatedFiles(kind) {
  return kind === "skill" || kind === "command";
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

function normalizePath(filePath) {
  return String(filePath).replaceAll("\\", "/");
}

async function readOverride(filePath, location, diagnostics) {
  try {
    return await readJsonWithDiagnostic(filePath);
  } catch (error) {
    diagnostics.push(diagnostic("error", location, `Cannot read override: ${error.message}`, error.code ?? "unreadable-override"));
    return null;
  }
}

async function requireFile(filePath, location, diagnostics, code = "missing-file") {
  try {
    await access(filePath);
  } catch {
    diagnostics.push(diagnostic("error", location, `Missing file: ${filePath}`, code));
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
    suggestions.push("Fix config validation errors, then run aof project validate.");
  } else {
    suggestions.push("Run aof assets apply --dry-run to preview runtime file changes.");
  }
  if (inspection.packages.some((pkg) => pkg.id === "gsd")) {
    suggestions.push("Run aof packages install gsd --dry-run to preview GSD setup commands.");
  }
  if (checks.some((check) => check.id === "generated-output-drift" && check.severity === "warning")) {
    suggestions.push("Review drift warnings or rerun aof assets apply --force when overwriting generated output is intended.");
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
