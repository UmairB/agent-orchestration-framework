import path from "node:path";
import { writeText } from "./fs.mjs";
import { hashContent } from "./lock.mjs";
import { hasUnsupportedCommonHookFields } from "./adapter-warnings.mjs";
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
      outputs.push(...renderedResourceOutputs(targetDir, root, runtime, adapter, mergeRuntimeOverride(resource, runtime)));
    }
    for (const resource of packageResourcesForRuntime(config.packages ?? [], runtime)) {
      outputs.push(...renderedResourceOutputs(targetDir, root, runtime, adapter, mergeRuntimeOverride(resource, runtime)));
    }
  }

  outputs.push(...renderRuntimeConfigOutputs(targetDir, requestedRuntimes, config, { global: options.global }));
  outputs.push(...renderRuntimeGitignoreOutputs(targetDir, requestedRuntimes, outputs, { global: options.global }));
  return outputs;
}

function renderRuntimeGitignoreOutputs(targetDir, requestedRuntimes, outputs, options = {}) {
  if (options.global) return [];
  const gitignoreContent = "*\n!.gitignore\n";
  return requestedRuntimes.flatMap((runtime) => {
    const adapter = RUNTIMES[runtime];
    if (!adapter?.localRoot) return [];
    const localRoot = adapter.localRoot.replaceAll("\\", "/");
    const hasRuntimeFolderOutput = outputs.some((output) => String(output.path).replaceAll("\\", "/").startsWith(`${localRoot}/`));
    if (!hasRuntimeFolderOutput) return [];
    return [renderedRuntimeConfig(
      targetDir,
      path.join(adapter.localRoot, ".gitignore"),
      runtime,
      "gitignore",
      `${runtime}-runtime-gitignore`,
      gitignoreContent
    )];
  });
}

function renderRuntimeConfigOutputs(targetDir, requestedRuntimes, config, options = {}) {
  if (options.global) return [];

  const outputs = [];
  const runtimes = new Set(requestedRuntimes);
  const claudeMcpServers = (config.mcpServers ?? []).filter((server) => runtimes.has("claude") && server.runtimes.includes("claude"));
  const codexMcpServers = (config.mcpServers ?? []).filter((server) => runtimes.has("codex") && server.runtimes.includes("codex"));
  const renderableHooks = (config.hooks ?? []).filter((hook) => !hasUnsupportedCommonHookFields(hook));
  const claudeHooks = renderableHooks.filter((hook) => runtimes.has("claude") && hook.runtimes.includes("claude"));
  const codexHooks = renderableHooks.filter((hook) => runtimes.has("codex") && hook.runtimes.includes("codex"));

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
    resource: resourceMetadata(resource),
    source: resource,
    body: contentFor(resource),
    content,
    hash: hashContent(content)
  };
}

function renderedResourceOutputs(targetDir, root, runtime, adapter, resource) {
  const main = renderedResource(targetDir, root, runtime, adapter, resource);
  if (!supportsAssociatedFiles(resource.kind) || !Array.isArray(resource.associatedFiles) || resource.associatedFiles.length === 0) {
    return [main];
  }

  const assetDir = associatedFileOutputDir(main.absolutePath, resource);
  return [
    main,
    ...resource.associatedFiles.map((file) => renderedAssociatedFile(targetDir, assetDir, runtime, resource, file))
  ];
}

function supportsAssociatedFiles(kind) {
  return kind === "skill" || kind === "command";
}

function associatedFileOutputDir(mainPath, resource) {
  if (resource.kind === "skill") return path.dirname(mainPath);
  return path.join(path.dirname(path.dirname(mainPath)), "scripts", resource.id);
}

function renderedAssociatedFile(targetDir, assetDir, runtime, resource, file) {
  const outputPath = associatedFileOutputPath(resource, file.path);
  const filePath = path.join(assetDir, outputPath);
  if (!isInside(assetDir, filePath)) {
    throw new Error(`Associated file output escapes ${resource.kind} asset directory: ${file.path}`);
  }
  const projectRelative = path.relative(targetDir, filePath);
  const content = file.content;
  return {
    absolutePath: filePath,
    path: projectRelative.startsWith("..") ? filePath : projectRelative,
    runtime,
    resource: {
      ...resourceMetadata(resource),
      artifact: "associated-file",
      file: outputPath,
      sourceFile: file.path
    },
    source: resource,
    body: content,
    content,
    hash: hashContent(content)
  };
}

function associatedFileOutputPath(resource, filePath) {
  const normalized = String(filePath).replaceAll("\\", "/");
  if (resource.kind === "command" && normalized.startsWith("files/")) {
    return normalized.slice("files/".length);
  }
  return normalized;
}

function expandFilePlaceholders(content, resource, runtime) {
  if (!supportsAssociatedFiles(resource.kind) || typeof content !== "string" || !content.includes("{{files.")) return content;
  const replacements = filePlaceholderReplacements(resource, runtime);
  return content.replace(/\{\{\s*files\.([^}]+?)\s*\}\}/g, (match, rawPath) => {
    const key = placeholderFilePath(rawPath);
    if (!replacements.has(key)) {
      throw new Error(`Unknown associated file placeholder for ${resource.kind}:${resource.id}: ${match}`);
    }
    return replacements.get(key);
  });
}

function filePlaceholderReplacements(resource, runtime) {
  const adapter = RUNTIMES[runtime];
  const root = adapter?.localRoot?.replaceAll("\\", "/");
  const replacements = new Map();
  if (!root || !Array.isArray(resource.associatedFiles)) return replacements;

  for (const file of resource.associatedFiles) {
    const sourcePath = String(file.path).replaceAll("\\", "/");
    const placeholderPath = sourcePath.startsWith("files/") ? sourcePath.slice("files/".length) : sourcePath;
    const runtimePath = resource.kind === "command"
      ? `${root}/scripts/${resource.id}/${associatedFileOutputPath(resource, sourcePath).replaceAll("\\", "/")}`
      : `${root}/skills/${resource.id}/${sourcePath}`;
    replacements.set(placeholderPath, runtimePath);
  }
  return replacements;
}

function placeholderFilePath(rawPath) {
  const normalized = String(rawPath).trim().replaceAll("\\", "/");
  if (normalized.includes("/")) {
    throw new Error(`Associated file placeholder must name one file, not a nested path: {{files.${normalized}}}`);
  }
  return normalized;
}

function isInside(root, filePath) {
  const relative = path.relative(root, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function packageResourcesForRuntime(packages, runtime) {
  return packages.flatMap((pkg) => (pkg.resources ?? [])
    .filter((resource) => resource.runtimes.includes(runtime))
    .map((resource) => ({
      ...resource,
      originalId: resource.originalId ?? resource.id,
      id: `${pkg.namespace}-${resource.id}`,
      _aofPackage: {
        id: pkg.id,
        namespace: pkg.namespace
      }
    })));
}

function resourceMetadata(resource) {
  const metadata = { id: resource.id, kind: resource.kind };
  if (resource._aofSource?.scope) {
    metadata.scope = resource._aofSource.scope;
    if (resource._aofSource.scope === "global") {
      metadata.global = {
        id: resource._aofSource.id ?? resource.id,
        kind: resource._aofSource.kind ?? resource.kind,
        configPath: resource._aofSource.configPath
      };
    }
  }
  if (resource._aofPackage) {
    metadata.package = resource._aofPackage;
    metadata.originalId = resource.originalId;
  }
  return metadata;
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
      contentFor(resource, runtime).trim(),
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
      contentFor(resource, runtime).trim(),
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
    contentFor(resource, runtime).trim(),
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
      contentFor(resource, runtime).trim(),
      ""
    ].filter((line) => line !== null).join("\n");
  }

  const lines = ["---", "aof-generated: true"];
  if (resource.name) lines.push(`name: ${resource.name}`);
  if (resource.description) lines.push(`description: ${resource.description}`);
  if (Array.isArray(resource.paths) && resource.paths.length > 0) {
    lines.push(`paths: ${resource.paths.join(", ")}`);
  }
  lines.push(`aof-runtime: ${runtime}`, "---", "", contentFor(resource, runtime).trim(), "");
  return lines.join("\n");
}

function contentFor(resource, runtime = null) {
  const content = resource.body ?? resource.prompt ?? resource.instructions ?? "";
  return runtime ? expandFilePlaceholders(content, resource, runtime) : content;
}

function codexRulePath(resource) {
  if (Array.isArray(resource.paths) && resource.paths.length === 1 && !/[*?[\]{}]/.test(resource.paths[0])) {
    return path.join(resource.paths[0], "AGENTS.md");
  }

  return "AGENTS.md";
}
