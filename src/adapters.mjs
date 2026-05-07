import path from "node:path";
import { writeText } from "./fs.mjs";
import { hashContent } from "./lock.mjs";
import { RUNTIMES, mergeRuntimeOverride } from "./model.mjs";
import {
  claudeMcpJson,
  claudeSettingsJson,
  codexConfigToml,
  projectDocContent,
  projectDocOutputPath,
  targetForProjectDocRuntime
} from "./runtime-config.mjs";

export function supportedRuntimes() {
  return Object.keys(RUNTIMES);
}

export async function applyConfig(config, options = {}) {
  const outputs = renderConfigOutputs(config, options);
  const writes = [];

  for (const output of outputs) {
    writes.push(await writeText(output.absolutePath, output.content, { dryRun: options.dryRun }));
  }

  return writes;
}

export function renderConfigOutputs(config, options = {}) {
  const targetDir = path.resolve(options.targetDir ?? process.cwd());
  const requestedRuntimes = options.runtimes ?? supportedRuntimes();
  const outputs = [];

  for (const runtime of requestedRuntimes) {
    const adapter = RUNTIMES[runtime];
    if (!adapter) {
      throw new Error(`Unsupported runtime "${runtime}". Expected one of: ${supportedRuntimes().join(", ")}.`);
    }

    const root = options.global ? adapter.globalRoot : path.join(targetDir, adapter.localRoot);
    for (const resource of config.resources) {
      if (!resource.runtimes.includes(runtime)) continue;
      outputs.push(renderedResource(targetDir, root, runtime, adapter, mergeRuntimeOverride(resource, runtime)));
    }
  }

  outputs.push(...renderRuntimeConfigOutputs(targetDir, requestedRuntimes, config, { global: options.global }));
  return outputs;
}

function renderRuntimeConfigOutputs(targetDir, requestedRuntimes, config, options = {}) {
  if (options.global) return [];

  const outputs = [];
  const runtimes = new Set(requestedRuntimes);
  const claudeMcpServers = (config.mcpServers ?? []).filter((server) => runtimes.has("claude") && server.runtimes.includes("claude"));
  const codexMcpServers = (config.mcpServers ?? []).filter((server) => runtimes.has("codex") && server.runtimes.includes("codex"));
  const claudeHooks = (config.hooks ?? []).filter((hook) => runtimes.has("claude") && hook.runtimes.includes("claude"));
  const codexHooks = (config.hooks ?? []).filter((hook) => runtimes.has("codex") && hook.runtimes.includes("codex"));

  if (claudeMcpServers.length > 0) {
    outputs.push(renderedRuntimeConfig(targetDir, ".mcp.json", "claude", "mcp", "mcpServers", claudeMcpJson(claudeMcpServers)));
  }

  if (claudeHooks.length > 0 || hasRuntimeSettings(config.settings, "claude")) {
    outputs.push(renderedRuntimeConfig(
      targetDir,
      path.join(".claude", "settings.json"),
      "claude",
      "settings",
      "claude-settings",
      claudeSettingsJson({ hooks: claudeHooks, settings: config.settings })
    ));
  }

  if (codexMcpServers.length > 0 || codexHooks.length > 0 || hasRuntimeSettings(config.settings, "codex")) {
    outputs.push(renderedRuntimeConfig(
      targetDir,
      path.join(".codex", "config.toml"),
      "codex",
      "settings",
      "codex-config",
      codexConfigToml({ mcpServers: codexMcpServers, hooks: codexHooks, settings: config.settings })
    ));
  }

  outputs.push(...renderProjectDocs(targetDir, requestedRuntimes, config.projectDocs ?? []));
  return outputs;
}

function renderProjectDocs(targetDir, requestedRuntimes, docs) {
  const outputs = [];
  for (const runtime of requestedRuntimes) {
    const target = targetForProjectDocRuntime(runtime);
    if (!target) continue;

    const matchingDocs = docs.filter((doc) => doc.runtimes.includes(runtime) && doc.targets.includes(target));
    if (matchingDocs.length === 0) continue;

    outputs.push(renderedRuntimeConfig(
      targetDir,
      path.relative(targetDir, projectDocOutputPath(targetDir, target)),
      runtime,
      "project-doc",
      target,
      projectDocContent(target, matchingDocs),
      matchingDocs
    ));
  }
  return outputs;
}

function renderedRuntimeConfig(targetDir, relativePath, runtime, kind, id, content, source = null) {
  const filePath = path.join(targetDir, relativePath);
  return {
    absolutePath: filePath,
    path: relativePath,
    runtime,
    resource: { id, kind },
    source,
    body: content,
    content,
    hash: hashContent(content)
  };
}

function hasRuntimeSettings(settings, runtime) {
  const runtimeSettings = settings?.[runtime];
  return Boolean(runtimeSettings && typeof runtimeSettings === "object" && !Array.isArray(runtimeSettings) && Object.keys(runtimeSettings).length > 0);
}

function renderedResource(targetDir, root, runtime, adapter, resource) {
  const relativePath = resourcePath(runtime, resource);
  const filePath = path.join(root, relativePath);
  const content = renderResource(runtime, adapter, resource);
  const projectRelative = path.relative(targetDir, filePath);
  return {
    absolutePath: filePath,
    path: projectRelative.startsWith("..") ? filePath : projectRelative,
    runtime,
    resource: { id: resource.id, kind: resource.kind },
    source: resource,
    body: contentFor(resource),
    content,
    hash: hashContent(content)
  };
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
      "aof-generated: true",
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
      "aof-generated: true",
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
    "aof-generated: true",
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
      "# AOF Generated Guidance",
      "",
      "<!-- Generated by AOF. Do not edit directly; update .aof/ instead. -->",
      "",
      `# ${resource.name ?? resource.id}`,
      "",
      resource.description ? `> ${resource.description}` : null,
      Array.isArray(resource.paths) && resource.paths.length > 0 ? `Applies to: ${resource.paths.join(", ")}` : null,
      "",
      contentFor(resource).trim(),
      ""
    ].filter((line) => line !== null).join("\n");
  }

  const lines = ["---", "aof-generated: true"];
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
