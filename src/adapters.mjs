import path from "node:path";
import { writeText } from "./fs.mjs";
import { RUNTIMES, mergeRuntimeOverride } from "./model.mjs";

export function supportedRuntimes() {
  return Object.keys(RUNTIMES);
}

export async function applyConfig(config, options = {}) {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const requestedRuntimes = options.runtimes ?? supportedRuntimes();
  const writes = [];

  for (const runtime of requestedRuntimes) {
    const adapter = RUNTIMES[runtime];
    if (!adapter) {
      throw new Error(`Unsupported runtime "${runtime}". Expected one of: ${supportedRuntimes().join(", ")}.`);
    }

    const root = options.global ? adapter.globalRoot : path.join(targetDir, adapter.localRoot);
    for (const resource of config.resources) {
      if (!resource.runtimes.includes(runtime)) continue;
      writes.push(await writeRenderedResource(root, runtime, adapter, mergeRuntimeOverride(resource, runtime), options));
    }
  }

  return writes;
}

async function writeRenderedResource(root, runtime, adapter, resource, options) {
  const relativePath = resourcePath(runtime, resource);
  const filePath = path.join(root, relativePath);
  const content = renderResource(runtime, adapter, resource);
  return writeText(filePath, content, { dryRun: options.dryRun });
}

function resourcePath(runtime, resource) {
  if (resource.kind === "skill") return path.join("skills", resource.id, "SKILL.md");
  if (resource.kind === "command") return path.join("commands", `${resource.id}.md`);
  if (resource.kind === "agent") return path.join("agents", `${resource.id}.md`);
  if (resource.kind === "rule" && runtime === "claude") return path.join("rules", `${resource.id}.md`);
  if (resource.kind === "rule" && runtime === "codex") return codexRulePath(resource);
  throw new Error(`Cannot render resource kind "${resource.kind}".`);
}

function renderResource(runtime, adapter, resource) {
  if (resource.kind === "skill") {
    return [
      "---",
      `name: ${resource.name ?? resource.id}`,
      `description: ${resource.description ?? ""}`,
      `aof-runtime: ${runtime}`,
      "---",
      "",
      contentFor(resource).trim(),
      ""
    ].join("\n");
  }

  if (resource.kind === "command") {
    return [
      "---",
      `description: ${resource.description ?? ""}`,
      `aof-invocation: ${adapter.commandPrefix}${resource.id}`,
      `aof-runtime: ${runtime}`,
      "---",
      "",
      contentFor(resource).trim(),
      ""
    ].join("\n");
  }

  if (resource.kind === "rule") {
    return renderRule(runtime, resource);
  }

  return [
    "---",
    `name: ${resource.name ?? resource.id}`,
    `description: ${resource.description ?? ""}`,
    resource.model ? `model: ${resource.model}` : null,
    Array.isArray(resource.tools) ? `tools: ${resource.tools.join(", ")}` : null,
    `aof-runtime: ${runtime}`,
    "---",
    "",
    contentFor(resource).trim(),
    ""
  ].filter(Boolean).join("\n");
}

function renderRule(runtime, resource) {
  if (runtime === "codex") {
    return [
      `# ${resource.name ?? resource.id}`,
      "",
      resource.description ? `> ${resource.description}` : null,
      Array.isArray(resource.paths) && resource.paths.length > 0 ? `Applies to: ${resource.paths.join(", ")}` : null,
      "",
      contentFor(resource).trim(),
      ""
    ].filter((line) => line !== null).join("\n");
  }

  const lines = ["---"];
  if (resource.name) lines.push(`name: ${resource.name}`);
  if (resource.description) lines.push(`description: ${resource.description}`);
  if (Array.isArray(resource.paths) && resource.paths.length > 0) {
    lines.push(`paths: ${resource.paths.join(", ")}`);
  }
  lines.push(`aof-runtime: ${runtime}`, "---", "", contentFor(resource).trim(), "");
  return lines.join("\n");
}

function contentFor(resource) {
  return resource.body ?? resource.prompt ?? resource.instructions ?? "";
}

function codexRulePath(resource) {
  if (Array.isArray(resource.paths) && resource.paths.length === 1 && !/[*?[\]{}]/.test(resource.paths[0])) {
    return path.join(resource.paths[0], "AGENTS.md");
  }

  return "AGENTS.md";
}
