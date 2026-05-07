import path from "node:path";
import { readFile } from "node:fs/promises";
import { readJson, normalizeId } from "./fs.mjs";
import {
  supportedHookEvents,
  supportedHookTypes,
  supportedMcpTransports,
  supportedProjectDocTargets,
  supportedResourceKinds,
  supportedRuntimes,
  supportedTrustModes
} from "./model.mjs";

const VALID_KINDS = new Set(supportedResourceKinds());
const VALID_RUNTIMES = new Set(supportedRuntimes());
const VALID_MCP_TRANSPORTS = new Set(supportedMcpTransports());
const VALID_HOOK_EVENTS = new Set(supportedHookEvents());
const VALID_HOOK_TYPES = new Set(supportedHookTypes());
const VALID_DOC_TARGETS = new Set(supportedProjectDocTargets());
const VALID_TRUST_MODES = new Set(supportedTrustModes());

export async function loadConfig(configPath) {
  const config = await readJson(configPath);
  const baseDir = path.dirname(configPath);
  return resolveConfig(config, baseDir);
}

export async function resolveConfig(config, baseDir = process.cwd()) {
  if (!config || typeof config !== "object") {
    throw new Error("AOF config must be a JSON object.");
  }

  const resources = await Promise.all((config.resources ?? []).map((resource) => resolveResource(resource, baseDir)));
  const projectDocs = await Promise.all((config.projectDocs ?? []).map((doc) => resolveProjectDoc(doc, baseDir)));
  return {
    name: config.name ?? "assistant-project",
    resources,
    packages: config.packages ?? [],
    mcpServers: (config.mcpServers ?? []).map(resolveMcpServer),
    hooks: (config.hooks ?? []).map(resolveHook),
    projectDocs,
    settings: resolveSettings(config.settings)
  };
}

async function resolveResource(resource, baseDir) {
  if (!resource || typeof resource !== "object") {
    throw new Error("Each resource must be an object.");
  }

  if (!VALID_KINDS.has(resource.kind)) {
    throw new Error(`Invalid resource kind "${resource.kind}". Expected skill, command, or agent.`);
  }

  const id = normalizeId(resource.id);
  const runtimes = normalizeRuntimes(resource.runtimes);
  const body = await resolveBody(resource, baseDir);
  const overrides = await resolveOverrides(resource, baseDir);

  return {
    ...resource,
    id,
    runtimes,
    body,
    overrides
  };
}

function normalizeRuntimes(runtimes) {
  if (!runtimes) {
    return ["claude", "codex"];
  }

  if (!Array.isArray(runtimes) || runtimes.length === 0) {
    throw new Error("Resource runtimes must be a non-empty array when provided.");
  }

  for (const runtime of runtimes) {
    if (!VALID_RUNTIMES.has(runtime)) {
      throw new Error(`Unsupported runtime "${runtime}". Expected claude or codex.`);
    }
  }

  return runtimes;
}

function resolveMcpServer(server) {
  if (!server || typeof server !== "object") {
    throw new Error("Each MCP server must be an object.");
  }

  const id = normalizeId(server.id);
  const transport = server.transport ?? (server.url ? "http" : "stdio");
  if (!VALID_MCP_TRANSPORTS.has(transport)) {
    throw new Error(`Unsupported MCP transport "${transport}". Expected ${supportedMcpTransports().join(", ")}.`);
  }

  return {
    ...server,
    id,
    transport,
    runtimes: normalizeRuntimes(server.runtimes)
  };
}

function resolveHook(hook) {
  if (!hook || typeof hook !== "object") {
    throw new Error("Each hook must be an object.");
  }

  const id = normalizeId(hook.id);
  const type = hook.type ?? "command";
  if (!VALID_HOOK_EVENTS.has(hook.event)) {
    throw new Error(`Unsupported hook event "${hook.event}". Expected ${supportedHookEvents().join(", ")}.`);
  }
  if (!VALID_HOOK_TYPES.has(type)) {
    throw new Error(`Unsupported hook type "${type}". Expected ${supportedHookTypes().join(", ")}.`);
  }

  return {
    ...hook,
    id,
    type,
    runtimes: normalizeRuntimes(hook.runtimes)
  };
}

async function resolveProjectDoc(doc, baseDir) {
  if (!doc || typeof doc !== "object") {
    throw new Error("Each project doc must be an object.");
  }

  const id = normalizeId(doc.id);
  const targets = normalizeProjectDocTargets(doc.targets);
  const body = await resolveBody(doc, baseDir);

  return {
    ...doc,
    id,
    targets,
    runtimes: normalizeRuntimes(doc.runtimes),
    body
  };
}

function normalizeProjectDocTargets(targets) {
  if (!targets) return ["AGENTS.md", "CLAUDE.md"];
  if (!Array.isArray(targets) || targets.length === 0) {
    throw new Error("Project doc targets must be a non-empty array when provided.");
  }
  for (const target of targets) {
    if (!VALID_DOC_TARGETS.has(target)) {
      throw new Error(`Unsupported project doc target "${target}". Expected ${supportedProjectDocTargets().join(", ")}.`);
    }
  }
  return [...new Set(targets)];
}

function resolveSettings(settings) {
  if (!settings) return {};
  if (typeof settings !== "object" || Array.isArray(settings)) {
    throw new Error("Settings must be an object.");
  }
  if (settings.trust !== undefined && !VALID_TRUST_MODES.has(settings.trust)) {
    throw new Error(`Unsupported trust mode "${settings.trust}". Expected ${supportedTrustModes().join(", ")}.`);
  }
  return { ...settings };
}

async function resolveBody(resource, baseDir) {
  if (resource.path) {
    return readFile(path.resolve(baseDir, resource.path), "utf8");
  }

  if (resource.body) return resource.body;
  if (resource.prompt) return resource.prompt;
  if (resource.instructions) return resource.instructions;
  return "";
}

async function resolveOverrides(resource, baseDir) {
  const overrides = {};
  const configured = resource.overrides ?? {};

  for (const runtime of VALID_RUNTIMES) {
    const configuredOverride = configured[runtime];
    if (typeof configuredOverride === "string") {
      overrides[runtime] = await readJson(path.resolve(baseDir, configuredOverride));
      continue;
    }

    if (configuredOverride && typeof configuredOverride === "object") {
      overrides[runtime] = configuredOverride;
      continue;
    }

    if (resource.path) {
      const overridePath = path.resolve(baseDir, path.dirname(resource.path), "overrides", `${runtime}.json`);
      try {
        overrides[runtime] = await readJson(overridePath);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }

  return overrides;
}
