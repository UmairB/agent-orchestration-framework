import path from "node:path";
import { writeText } from "./fs.mjs";
import { hashContent } from "./lock.mjs";
import { hasUnsupportedCommonHookFields } from "./adapter-warnings.mjs";
import { createAssetReferenceIndex, expandAssetReferences } from "./asset-references.mjs";
import { RUNTIMES, mergeRuntimeOverride } from "./model.mjs";
import {
  claudeMcpJson,
  claudeSettingsJson,
  codexConfigToml,
  projectDocContent,
  codexHooksJson,
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
  const workflowIndex = workflowIndexFor(config.workflows ?? []);
  const assetReferenceIndex = createAssetReferenceIndex(config.resources ?? [], config.workflows ?? []);

  for (const runtime of requestedRuntimes) {
    const adapter = RUNTIMES[runtime];
    if (!adapter) {
      throw new Error(`Unsupported runtime "${runtime}". Expected one of: ${supportedRuntimes().join(", ")}.`);
    }

    const root = options.global ? adapter.globalRoot : path.join(targetDir, adapter.localRoot);
    for (const workflow of config.workflows ?? []) {
      if (!workflow.runtimes.includes(runtime)) continue;
      outputs.push(renderedWorkflow(targetDir, root, runtime, workflow, assetReferenceIndex));
    }
    for (const resource of config.resources) {
      if (!resource.runtimes.includes(runtime)) continue;
      assertRenderableResource(runtime, resource);
      outputs.push(...renderedResourceOutputs(targetDir, root, runtime, adapter, mergeRuntimeOverride(resource, runtime), workflowIndex, assetReferenceIndex));
    }
    for (const resource of packageResourcesForRuntime(config.packages ?? [], runtime)) {
      assertRenderableResource(runtime, resource);
      outputs.push(...renderedResourceOutputs(targetDir, root, runtime, adapter, mergeRuntimeOverride(resource, runtime), workflowIndex, assetReferenceIndex));
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

  if (codexMcpServers.length > 0 || hasRuntimeSettings(config.settings, "codex")) {
    outputs.push(renderedRuntimeConfig(
      targetDir,
      path.join(".codex", "config.toml"),
      "codex",
      "settings",
      "codex-config",
      codexConfigToml({ mcpServers: codexMcpServers, settings: config.settings })
    ));
  }

  if (codexHooks.length > 0) {
    outputs.push(renderedRuntimeConfig(
      targetDir,
      path.join(".codex", "hooks.json"),
      "codex",
      "hooks",
      "codex-hooks",
      codexHooksJson(codexHooks)
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

function renderedWorkflow(targetDir, root, runtime, workflow, assetReferenceIndex = createAssetReferenceIndex()) {
  const relativePath = workflowOutputPath(workflow.id);
  const filePath = path.join(root, relativePath);
  const content = renderWorkflow(runtime, workflow, assetReferenceIndex);
  const projectRelative = path.relative(targetDir, filePath);
  return {
    absolutePath: filePath,
    path: projectRelative.startsWith("..") ? filePath : projectRelative,
    runtime,
    resource: workflowMetadata(workflow),
    source: workflow,
    body: workflow.body ?? "",
    content,
    hash: hashContent(content)
  };
}

function hasRuntimeSettings(settings, runtime) {
  const runtimeSettings = settings?.[runtime];
  return Boolean(runtimeSettings && typeof runtimeSettings === "object" && !Array.isArray(runtimeSettings) && Object.keys(runtimeSettings).length > 0);
}

function renderedResource(targetDir, root, runtime, adapter, resource, workflowIndex = new Map(), assetReferenceIndex = createAssetReferenceIndex()) {
  const relativePath = resourcePath(runtime, resource);
  const filePath = path.join(root, relativePath);
  const content = renderResource(runtime, adapter, resource, workflowIndex, assetReferenceIndex);
  const projectRelative = path.relative(targetDir, filePath);
  return {
    absolutePath: filePath,
    path: projectRelative.startsWith("..") ? filePath : projectRelative,
    runtime,
    resource: resourceMetadata(resource),
    source: resource,
    body: contentFor(resource, null, workflowIndex),
    content,
    hash: hashContent(content)
  };
}

function renderedResourceOutputs(targetDir, root, runtime, adapter, resource, workflowIndex = new Map(), assetReferenceIndex = createAssetReferenceIndex()) {
  const main = renderedResource(targetDir, root, runtime, adapter, resource, workflowIndex, assetReferenceIndex);
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
  return path.dirname(mainPath);
}

function assertRenderableResource(runtime, resource) {
  if (runtime === "codex" && resource.kind === "command") {
    throw new Error("Command assets are not supported for Codex. Target Claude commands or create a Codex skill explicitly.");
  }
}

function workflowIndexFor(workflows) {
  return new Map((workflows ?? []).map((workflow) => [workflow.id, workflow]));
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
  return normalized.startsWith("files/") ? normalized.slice("files/".length) : normalized;
}

function expandFilePlaceholders(content, resource, runtime) {
  if (!supportsAssociatedFiles(resource.kind) || typeof content !== "string" || !/\{\{\s*files\./.test(content)) return content;
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
    const outputPath = associatedFileOutputPath(resource, sourcePath).replaceAll("\\", "/");
    const runtimePath = resource.kind === "command"
      ? `${root}/commands/${outputPath}`
      : `${root}/skills/${resource.id}/${outputPath}`;
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

function workflowMetadata(workflow) {
  const metadata = { id: workflow.id, kind: "workflow" };
  if (workflow._aofSource?.scope) {
    metadata.scope = workflow._aofSource.scope;
    if (workflow._aofSource.scope === "global") {
      metadata.global = {
        id: workflow._aofSource.id ?? workflow.id,
        kind: "workflow",
        configPath: workflow._aofSource.configPath
      };
    }
  }
  return metadata;
}

function workflowOutputPath(id) {
  return path.join("aof", "workflows", `${id}.md`);
}

function workflowRuntimePath(runtime, id) {
  const root = RUNTIMES[runtime]?.localRoot ?? `.${runtime}`;
  return path.join(root, workflowOutputPath(id)).replaceAll("\\", "/");
}

function resourcePath(runtime, resource) {
  if (resource.kind === "skill") return path.join("skills", resource.id, "SKILL.md");
  if (resource.kind === "command" && resource.commandNamespace) {
    return path.join("commands", resource.commandNamespace, `${resource.id}.md`);
  }
  if (resource.kind === "command") return path.join("commands", `${resource.id}.md`);
  if (resource.kind === "agent") return path.join("agents", `${resource.id}.md`);
  if (resource.kind === "rule" && runtime === "claude") return path.join("rules", `${resource.id}.md`);
  if (resource.kind === "rule" && runtime === "codex") return codexRulePath(resource);
  throw new Error(`Cannot render resource kind "${resource.kind}".`);
}

function renderResource(runtime, adapter, resource, workflowIndex = new Map(), assetReferenceIndex = createAssetReferenceIndex()) {
  if (resource.kind === "skill") {
    if (runtime === "codex") {
      return renderCodexMarkdownResource([
        `name: ${resource.name ?? resource.id}`,
        `description: ${resource.description ?? ""}`
      ], contentFor(resource, runtime, workflowIndex, assetReferenceIndex));
    }

    // `disable-model-invocation: true` makes Claude Code NOT auto-trigger the
    // skill — it runs only when the user invokes `/<name>` explicitly. Emitted
    // when the resource carries the flag. For the codex-* delegation skills this is
    // driven by the `work.agents.delegation` toggle (applyDelegationToResources):
    // OFF (default) keeps the flag (skills won't auto-fire); ON drops it (skills
    // become auto-invocable). So the toggle literally turns the skills on and off.
    const frontmatter = [
      "---",
      "aof-generated: true",
      `name: ${resource.name ?? resource.id}`,
      `description: ${resource.description ?? ""}`
    ];
    if (resource.disableModelInvocation === true) {
      frontmatter.push("disable-model-invocation: true");
    }
    frontmatter.push(`aof-runtime: ${runtime}`, "---");
    return [
      ...frontmatter,
      "",
      contentFor(resource, runtime, workflowIndex, assetReferenceIndex).trim(),
      ""
    ].join("\n");
  }

  if (resource.kind === "command") {
    const invocationName = resource.commandNamespace
      ? `${resource.commandNamespace}:${resource.id}`
      : resource.id;
    return [
      "---",
      "aof-generated: true",
      `description: ${resource.description ?? ""}`,
      `aof-invocation: ${adapter.commandPrefix}${invocationName}`,
      `aof-runtime: ${runtime}`,
      "---",
      "",
      contentFor(resource, runtime, workflowIndex, assetReferenceIndex).trim(),
      ""
    ].join("\n");
  }

  if (resource.kind === "rule") {
    return renderRule(runtime, resource, workflowIndex, assetReferenceIndex);
  }

  if (runtime === "codex") {
    return renderCodexMarkdownResource([
      `name: ${resource.name ?? resource.id}`,
      `description: ${resource.description ?? ""}`
    ], contentFor(resource, runtime, workflowIndex, assetReferenceIndex));
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
    contentFor(resource, runtime, workflowIndex, assetReferenceIndex).trim(),
    ""
  ].filter(Boolean).join("\n");
}

function renderCodexMarkdownResource(frontmatterLines, body) {
  return [
    "---",
    ...frontmatterLines,
    "---",
    "",
    "<!-- aof-generated: true; aof-runtime: codex -->",
    "",
    body.trim(),
    ""
  ].join("\n");
}

function renderWorkflow(runtime, workflow, assetReferenceIndex = createAssetReferenceIndex()) {
  const body = expandAssetReferences(workflow.body?.trim() ?? "", runtime, assetReferenceIndex);
  return [
    "<!-- Generated by AOF. Do not edit directly; update .aof/ instead. -->",
    "",
    body,
    ""
  ].join("\n");
}

function renderRule(runtime, resource, workflowIndex = new Map(), assetReferenceIndex = createAssetReferenceIndex()) {
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
      contentFor(resource, runtime, workflowIndex, assetReferenceIndex).trim(),
      ""
    ].filter((line) => line !== null).join("\n");
  }

  const lines = ["---", "aof-generated: true"];
  if (resource.name) lines.push(`name: ${resource.name}`);
  if (resource.description) lines.push(`description: ${resource.description}`);
  if (Array.isArray(resource.paths) && resource.paths.length > 0) {
    lines.push(`paths: ${resource.paths.join(", ")}`);
  }
  lines.push(`aof-runtime: ${runtime}`, "---", "", contentFor(resource, runtime, workflowIndex, assetReferenceIndex).trim(), "");
  return lines.join("\n");
}

function contentFor(resource, runtime = null, workflowIndex = new Map(), assetReferenceIndex = createAssetReferenceIndex()) {
  const content = resource.body ?? resource.prompt ?? resource.instructions ?? "";
  if (runtime && resource.workflow && !hasExplicitContent(resource)) {
    const workflow = workflowIndex.get(resource.workflow);
    if (!workflow) {
      throw new Error(`Resource ${resource.kind}:${resource.id} references missing workflow "${resource.workflow}".`);
    }
    return defaultWorkflowWrapperBody(resource, runtime, workflow);
  }
  if (!runtime) return content;
  return expandAssetReferences(expandFilePlaceholders(content, resource, runtime), runtime, assetReferenceIndex);
}

function hasExplicitContent(resource) {
  return Boolean(resource._aofHasExplicitBody || resource.body || resource.prompt || resource.instructions);
}

function defaultWorkflowWrapperBody(resource, runtime, workflow) {
  const workflowPath = workflowRuntimePath(runtime, workflow.id);
  const lines = [
    `Follow the shared AOF workflow at \`${workflowPath}\`.`,
    "",
    "Use that workflow file as the source of truth for this asset's procedure."
  ];
  const argumentHint = resource.argumentHint ?? workflow.argumentHint;
  const args = mergedWorkflowArguments(workflow, resource);
  if (argumentHint || args.length > 0) {
    lines.push("", "## Arguments");
    if (argumentHint) {
      lines.push("", `Argument hint: \`${argumentHint}\``);
    }
    if (args.length > 0) {
      lines.push("");
      for (const argument of args) {
        const required = argument.required ? " (required)" : "";
        const description = argument.description ? `: ${argument.description}` : "";
        const hint = argument.hint ? ` Hint: ${argument.hint}` : "";
        lines.push(`- \`${argument.name}\`${required}${description}${hint}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function mergedWorkflowArguments(workflow, resource) {
  const overrides = resource.argumentOverrides ?? {};
  const resourceArguments = Array.isArray(resource.arguments) && resource.arguments.length > 0
    ? resource.arguments
    : workflow.arguments;
  return (resourceArguments ?? []).map((argument) => ({
    ...argument,
    ...(overrides[argument.name] ?? {})
  }));
}

function codexRulePath(resource) {
  if (Array.isArray(resource.paths) && resource.paths.length === 1 && !/[*?[\]{}]/.test(resource.paths[0])) {
    return path.join(resource.paths[0], "AGENTS.md");
  }

  return "AGENTS.md";
}
