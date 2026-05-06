import path from "node:path";
import { readFile } from "node:fs/promises";
import { readJson, normalizeId } from "./fs.mjs";
import { supportedResourceKinds, supportedRuntimes } from "./model.mjs";

const VALID_KINDS = new Set(supportedResourceKinds());
const VALID_RUNTIMES = new Set(supportedRuntimes());

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
  return {
    name: config.name ?? "assistant-project",
    resources,
    packages: config.packages ?? []
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
