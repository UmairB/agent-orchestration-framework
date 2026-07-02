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
// story 30 — the per-role model-map validator derives its valid-key set (the 8
// frozen ACD roles) from the bundle descriptor rather than a 4th hardcoded copy,
// and reads the override map through the shared accessor so validate + render
// never diverge on the config path.
import { readDescriptor, agentModelMap, AGENT_MODEL_MAP_PATH } from "./work-bundle.mjs";
// milestone 12 (ADR-003) — the store-first managed-tool resolver + the frozen
// tool descriptors the three new doctor checks consult (SUPERSEDING the 09
// graphify-binary check in place with the store-aware managed-tool check).
import { resolveManagedBinary, toolDescriptors } from "./tool-store.mjs";
import { delimiter } from "node:path";
import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";

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
  validateWork(raw.work, diagnostics);

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

  // milestone 12 / ADR-003 — the 09 `graphify-binary` check is SUPERSEDED IN
  // PLACE by three store-aware checks (it resolved PATH-only; these resolve
  // store-first via the ADR-001 resolver). The `aof project doctor` CLI face is
  // unchanged — it renders checks[] + --json (cli.mjs:1476); these ride it.
  //   managed-tool   — one per managed tool: store-first resolution → ok(version)/
  //                    ok("not managed")/ok("version unknown")/warning(guidance).
  //   provider-prereq — uv on PATH (any uv-lane tool) → ok; absent → warning.
  //   tool-platform  — the descriptor's platform matrix supports this platform →
  //                    ok; unsupported → warning. Advisory, NEVER an error.
  for (const check of managedToolChecks(options)) checks.push(check);
  checks.push(providerPrereqCheck(options));
  for (const check of toolPlatformChecks(options)) checks.push(check);

  // milestone 17 / ADR-004 — the Notion auth-reachability advisory, a SIBLING of
  // the m12 managed-tool / tool-platform checks (NOT in work:doctor, the work-stream
  // lane, 15/ADR-001). It rides ONLY when the project opts into Notion (the config
  // block is present); an unconfigured project is healthy and emits no Notion check.
  // ALWAYS advisory — ok / warning, never an error, never throws.
  let notionConfigRoot = null;
  if (options.notionAuthState == null) {
    try {
      const cfg = await loadProjectConfig(inspection.configPath, options);
      notionConfigRoot = cfg;
    } catch {
      notionConfigRoot = null;
    }
  }
  const notionAuth = notionAuthCheck(notionConfigRoot, options);
  if (notionAuth) checks.push(notionAuth);

  return {
    ...inspection,
    checks,
    suggestions: suggestionsFor(inspection, checks)
  };
}

// ----------------------------------------------------------- notion-auth ------
// notionAuthCheck(rawConfig, options) → the Notion auth-reachability advisory
// (17/ADR-004). It is added as a SIBLING to the m12 managed-tool / tool-platform
// checks the Notion descriptor rides (those surface present-and-versioned + platform
// for free once NOTION_DESCRIPTOR is registered). This check maps the AUTH state to
// severity, honestly:
//   - token set AND a reachability probe succeeds → ok (auth reachable);
//   - token env var unset/empty                   → warning (set-the-token guidance);
//   - token set but the probe fails               → warning (Notion unreachable, retry).
// It is ALWAYS advisory — never an error, never throws (a project may be mid-setup).
// Returns null when the project does NOT opt into Notion (no config block) — an
// unconfigured project emits no Notion check at all.
//
// SEAMS (hermetic @executable rows): `options.notionAuthState` short-circuits to a
// state string ("reachable"|"unset"|"unreachable") so the severity matrix is driven
// without a live token; otherwise `options.notionTokenEnv` (the env), and
// `options.notionReachable` (an injectable probe; default: a no-op that treats a
// set token as NOT independently probed → ok, since the live probe is @manual)
// drive the verdict. `options.env` supplies the env vars (default process.env).
export function notionAuthCheck(rawConfig, options = {}) {
  const notionConfig = rawConfig?.work?.integrations?.notion;
  // An explicit notionAuthState forces the row (the hermetic matrix) even without a
  // config block — so the @executable severity rows run without a fixture config.
  if (notionConfig == null && options.notionAuthState == null) return null;

  let state;
  try {
    state = options.notionAuthState ?? resolveNotionAuthState(notionConfig, options);
  } catch (error) {
    // The advisory must NEVER crash the doctor — degrade to a warning.
    return {
      id: "notion-auth",
      severity: "warning",
      message: "Notion auth reachability could not be determined — verify the token env var and try again.",
      details: { error: error?.message ?? String(error) },
    };
  }

  if (state === "reachable") {
    return {
      id: "notion-auth",
      severity: "ok",
      message: "Notion auth is reachable (the token is set and the probe succeeded).",
      details: { state: "reachable" },
    };
  }
  if (state === "unset") {
    const tokenEnv = (typeof notionConfig?.tokenEnv === "string" && notionConfig.tokenEnv) || "NOTION_API_TOKEN";
    return {
      id: "notion-auth",
      severity: "warning",
      message: `Notion auth: set the ${tokenEnv} environment variable to the integration token to reach Notion.`,
      details: { state: "unset", tokenEnv },
    };
  }
  // "unreachable" — token set but the probe failed.
  return {
    id: "notion-auth",
    severity: "warning",
    message: "Notion auth: the token is set but Notion is unreachable — check the token / network and retry.",
    details: { state: "unreachable" },
  };
}

// resolveNotionAuthState(notionConfig, options) → "reachable" | "unset" | "unreachable".
// Reads the token from the named env var; an unset/empty token is "unset"; a set
// token is then run through the injectable reachability probe (default: assume
// reachable — the LIVE probe is @manual, no token on the dev host). NEVER throws to
// the caller's matrix here — the caller wraps it.
function resolveNotionAuthState(notionConfig, options = {}) {
  const env = options.env ?? process.env;
  const tokenEnv = (typeof notionConfig?.tokenEnv === "string" && notionConfig.tokenEnv) || "NOTION_API_TOKEN";
  const raw = env?.[tokenEnv];
  const token = typeof raw === "string" ? raw : "";
  if (token.length === 0) return "unset";
  // Token present — probe reachability. The probe is injectable (the @manual live
  // `ntn api` round-trip is the real probe); absent ⇒ assume reachable (the token is
  // set; we do not fabricate an unreachable verdict without evidence).
  const probe = options.notionReachable;
  if (typeof probe === "function") {
    return probe({ token, tokenEnv, env }) ? "reachable" : "unreachable";
  }
  return "reachable";
}

// ---------------------------------------------------------- managed-tool ------
// managedToolChecks(options) → one `managed-tool` check per managed tool (ADR-003,
// SUPERSEDES the 09 graphify-binary check). Each resolves STORE-FIRST via the
// ADR-001 resolver (resolveManagedBinary), then maps the resolution state to an
// HONEST severity. The four states (the full ADR-003 matrix):
//   - found, source "store", version present → ok, message names the resolved
//     version (and that it came from the store);
//   - found, source "store", version null    → ok, "present, version unknown"
//     (RESEARCH §A4 — never fabricate a dotted version we did not observe);
//   - found, source "path"                    → ok, "present on PATH, not managed";
//   - not found                               → warning, the `aof project
//     provision <tool>` guidance (NOT error — a project may not use the tool).
// It NEVER throws: a resolver failure (or any error) degrades to a warning, so
// `aof project doctor` does not crash because a tool is absent or the resolver
// explodes. `options.resolveManagedBinary` + `options.managedTools` are injectable
// seams (defaults: the real resolver + toolDescriptors()) so every state is
// CI-assertable with the resolver stubbed. Story 03 consumes this same builder.
// A check carries `details.tool` so a caller can find a specific tool's check via
// `id === "managed-tool" && details.tool === "<name>"`.
export function managedToolChecks(options = {}) {
  const resolve = options.resolveManagedBinary ?? resolveManagedBinary;
  const descriptors = options.managedTools ?? toolDescriptors();
  return descriptors.map((descriptor) => managedToolCheckFor(descriptor, resolve, options));
}

function managedToolCheckFor(descriptor, resolve, options) {
  const tool = descriptor.name;
  let resolved;
  try {
    resolved = resolve({
      name: descriptor.name,
      version: descriptor.version,
      binary: descriptor.binaries?.[0],
      env: options.env,
      platform: options.platform,
    });
  } catch (error) {
    // The resolver is contracted never to throw on a miss, but the doctor check
    // must NEVER crash regardless — degrade to a warning with the guidance.
    return {
      id: "managed-tool",
      severity: "warning",
      message: `Run \`aof project provision ${tool}\` to install ${tool} into the managed tool store.`,
      details: { tool, found: false, error: error?.message ?? String(error) },
    };
  }

  if (!resolved || !resolved.found) {
    return {
      id: "managed-tool",
      severity: "warning",
      message: resolved?.hint ?? `Run \`aof project provision ${tool}\` to install ${tool} into the managed tool store.`,
      details: { tool, found: false },
    };
  }

  // Present on PATH only (a store miss fell back to PATH) — ok, but flagged as
  // the operator's own binary, NOT an aof-managed install.
  if (resolved.source === "path") {
    const versionSuffix = resolved.version ? ` (version ${resolved.version})` : "";
    return {
      id: "managed-tool",
      severity: "ok",
      message: `${tool} is present on PATH, not managed${versionSuffix}.`,
      details: { tool, found: true, source: "path", version: resolved.version ?? null, path: resolved.path },
    };
  }

  // Present from the store but the version probe failed — ok, version unknown.
  // We never fabricate a dotted version we did not observe (RESEARCH §A4).
  if (resolved.version == null) {
    return {
      id: "managed-tool",
      severity: "ok",
      message: `${tool} is present, version unknown.`,
      details: { tool, found: true, source: resolved.source ?? "store", version: null, path: resolved.path },
    };
  }

  // Present from the store with a probed version — ok, naming the resolved
  // version and that it is the managed store copy.
  return {
    id: "managed-tool",
    severity: "ok",
    message: `${tool} is present from the store (version ${resolved.version}).`,
    details: { tool, found: true, source: resolved.source ?? "store", version: resolved.version, path: resolved.path },
  };
}

// --------------------------------------------------------- provider-prereq ----
// providerPrereqCheck(options) → the lane prerequisite (`uv` on PATH for any
// uv-lane tool) is present (ADR-003). present → ok (confirms uv is available);
// absent → warning carrying the install-uv guidance. NEVER an error — a project
// may not use the uv lane at all. `options.uvPresent` (a boolean) short-circuits
// the probe when provided; otherwise an injectable `options.which` probe is used
// (default: a PATH probe for "uv"). NEVER throws. Story 03 consumes this builder.
export function providerPrereqCheck(options = {}) {
  let present;
  try {
    if (typeof options.uvPresent === "boolean") {
      present = options.uvPresent;
    } else {
      const which = options.which ?? defaultUvWhich;
      present = Boolean(which("uv"));
    }
  } catch (error) {
    // A probe failure must NEVER crash the doctor — treat it as a warning.
    return {
      id: "provider-prereq",
      severity: "warning",
      message: "Install uv (the uv-lane provider): see https://docs.astral.sh/uv/getting-started/installation/.",
      details: { provider: "uv", present: false, error: error?.message ?? String(error) },
    };
  }

  if (present) {
    return {
      id: "provider-prereq",
      severity: "ok",
      message: "uv is available (the uv-lane provider prerequisite).",
      details: { provider: "uv", present: true },
    };
  }

  return {
    id: "provider-prereq",
    severity: "warning",
    message: "Install uv (the uv-lane provider): see https://docs.astral.sh/uv/getting-started/installation/.",
    details: { provider: "uv", present: false },
  };
}

// The default `uv` PATH probe: prefer the platform locator (`where`/`which`),
// fall back to scanning PATH dirs. Returns a path string when found, else null —
// NEVER throws (a missing locator / empty PATH degrades to null).
function defaultUvWhich(binary, platform = process.platform, pathValue = process.env.PATH ?? "") {
  const locator = platform === "win32" ? "where" : "which";
  try {
    const probe = spawnSync(locator, [binary], { encoding: "utf8" });
    if (probe.status === 0 && typeof probe.stdout === "string") {
      const first = probe.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
      if (first) return first;
    }
  } catch {
    // locator absent — fall through to the manual PATH scan.
  }
  const exeNames = platform === "win32" ? [`${binary}.exe`, `${binary}.cmd`, `${binary}.bat`, binary] : [binary];
  for (const dir of (pathValue ?? "").split(delimiter).filter(Boolean)) {
    for (const exe of exeNames) {
      const candidate = path.join(dir, exe);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // missing candidate — keep scanning.
      }
    }
  }
  return null;
}

// ---------------------------------------------------------- tool-platform -----
// toolPlatformCheckFor(descriptor, platform) → whether a tool's descriptor
// platform matrix supports `platform` (ADR-003). An ABSENT matrix, or an entry
// with supported:true (EVEN when it carries prereqs/note), is ok; supported:false
// is a warning naming the prereq (e.g. "needs Rust") or "unsupported on this
// platform". It is ALWAYS advisory — NEVER an error, NEVER throws. Story 03's test
// calls this single-tool helper directly (e.g. headroom on linux/darwin/win32).
export function toolPlatformCheckFor(descriptor, platform = process.platform) {
  const tool = descriptor?.name;
  const matrix = descriptor?.platforms;
  // No matrix → supported everywhere (ADR-002: absent ⇒ supported).
  if (!matrix || matrix[platform] == null) {
    return {
      id: "tool-platform",
      severity: "ok",
      message: `${tool} is supported on ${platform}.`,
      details: { tool, platform, supported: true },
    };
  }

  const entry = matrix[platform];
  // supported:true (even with prereqs/note) → ok. A note is surfaced but it does
  // not downgrade the severity.
  if (entry.supported !== false) {
    const suffix = entry.note ? ` (${entry.note})` : "";
    return {
      id: "tool-platform",
      severity: "ok",
      message: `${tool} is supported on ${platform}${suffix}.`,
      details: { tool, platform, supported: true },
    };
  }

  // supported:false → warning naming the prereq or "unsupported on this platform".
  const prereqs = Array.isArray(entry.prereqs) && entry.prereqs.length ? entry.prereqs.join(", ") : null;
  const reason = prereqs
    ? `needs ${prereqs}`
    : entry.note || "unsupported on this platform";
  return {
    id: "tool-platform",
    severity: "warning",
    message: `${tool} on ${platform}: ${reason}.`,
    details: { tool, platform, supported: false },
  };
}

// toolPlatformChecks(options) → one `tool-platform` check per managed tool, over
// `toolPlatformCheckFor(descriptor, options.platform ?? process.platform)` (ADR-003).
// Tools with no matrix emit ok (supported everywhere). NEVER throws.
export function toolPlatformChecks(options = {}) {
  const descriptors = options.managedTools ?? toolDescriptors();
  const platform = options.platform ?? process.platform;
  return descriptors.map((descriptor) => toolPlatformCheckFor(descriptor, platform));
}

// NOTE (milestone 12 / ADR-003 supersession): the former `graphifyBinaryCheck`
// (09/ADR-004 Option B — PATH-only graphify resolution + a version-pin drift
// warning) is REMOVED here. It is SUPERSEDED IN PLACE by the store-first
// `managedToolChecks` above, which resolves graphify (and every managed tool)
// through the ADR-001 store-first resolver and emits the `managed-tool` check.
// The graphify retrofit's resolver-hint (src/graphify.mjs) is a SEPARATE story's
// concern (12/ADR-004) and is intentionally untouched here.

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

// --- work.agents per-role model map (story 30, tasks 02b + 03) ---------------
// The frozen ACD role set the override keys must belong to, DERIVED from the
// bundle descriptor's agent members (readDescriptor) — not a 4th hardcoded copy
// of the list. Matched case-sensitively and untrimmed: only an exact member id
// is a valid override key.
function acdRoleSet() {
  return new Set(
    readDescriptor().members
      .filter((member) => member.kind === "agent")
      .map((member) => member.id)
  );
}

// raw.work is otherwise unvalidated today; this hook validates only the net-new
// per-role model map (story 30). It stays permissive about the rest of `work`.
function validateWork(work, diagnostics) {
  if (work === undefined) return;
  if (!work || typeof work !== "object" || Array.isArray(work)) {
    diagnostics.push(diagnostic("error", "work", "work must be an object when provided."));
    return;
  }
  validateWorkAgents(work.agents, diagnostics);
}

function validateWorkAgents(agents, diagnostics) {
  if (agents === undefined) return;
  if (!agents || typeof agents !== "object" || Array.isArray(agents)) {
    diagnostics.push(diagnostic("error", "work.agents", "work.agents must be an object when provided."));
    return;
  }

  const rawMap = agents.models;
  if (rawMap === undefined) return;
  if (!rawMap || typeof rawMap !== "object" || Array.isArray(rawMap)) {
    diagnostics.push(diagnostic(
      "error",
      AGENT_MODEL_MAP_PATH,
      `${AGENT_MODEL_MAP_PATH} must be an object mapping an ACD role to a model when provided.`
    ));
    return;
  }

  const validRoles = acdRoleSet();
  for (const [key, value] of Object.entries(rawMap)) {
    const keyPath = `${AGENT_MODEL_MAP_PATH}.${key}`;
    // Key check: must be one of the 8 ACD roles, matched exactly (case-sensitive,
    // untrimmed) — a typo, wrong casing, missing prefix, or padded key is an error.
    if (!validRoles.has(key)) {
      diagnostics.push(diagnostic(
        "error",
        keyPath,
        `"${key}" is not an ACD role. A per-role model override key must be one of the 8 ACD roles: ${[...validRoles].sort().join(", ")}.`,
        "model-map-unknown-role"
      ));
    }
    // Value check: reject empty / whitespace-only / non-string; accept ANY
    // non-empty string (family alias OR pinned id, including an alias aof does
    // not use). Do NOT enumerate known aliases as an error.
    if (typeof value !== "string") {
      diagnostics.push(diagnostic(
        "error",
        keyPath,
        `The model override for "${key}" must be a non-empty string.`,
        "model-map-bad-value"
      ));
    } else if (value.trim() === "") {
      diagnostics.push(diagnostic(
        "error",
        keyPath,
        `The model override for "${key}" must not be empty or whitespace-only.`,
        "model-map-bad-value"
      ));
    }
  }

  // Solo-mode inert map (task 03): a per-role map cannot bind when the main
  // session plays every role. Conditional on BOTH mode=solo AND a non-empty map;
  // surfaced as a NON-BLOCKING notice ("info"), so the config stays valid.
  const hasMap = Object.keys(rawMap).length > 0;
  if (agents.mode === "solo" && hasMap) {
    diagnostics.push(diagnostic(
      "info",
      AGENT_MODEL_MAP_PATH,
      "Per-role model selection has no effect under work.agents.mode \"solo\": the main session plays every role inline, so no sub-agent is spawned to carry a per-role model. The map is ignored under solo mode.",
      "model-map-inert-under-solo"
    ));
  }
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
