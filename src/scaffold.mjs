import path from "node:path";
import { access } from "node:fs/promises";
import { readJson, writeText, normalizeId } from "./fs.mjs";
import { defaultBodyFile, supportedResourceKinds, supportedRuntimes, RESOURCE_KINDS } from "./model.mjs";
import { globalWorkspacePaths, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";

const VALID_KINDS = new Set(supportedResourceKinds());
const VALID_GLOBAL_KINDS = new Set(["skill", "agent", "rule"]);
const VALID_RUNTIMES = new Set(supportedRuntimes());

export async function scaffoldResource(projectDir = process.cwd(), input = {}) {
  const targetDir = path.resolve(projectDir);
  const paths = workspacePaths(targetDir);
  return scaffoldResourceInWorkspace(paths, input, {
    workspaceName: path.basename(targetDir),
    schema: "../schemas/aof.schema.json",
    beforeRead: async () => {
      if (await isLegacyConfigOnlyProject(targetDir)) {
        throw new Error(`Legacy config exists at ${legacyConfigPath(targetDir)}. Run aof migrate before adding .aof assets.`);
      }
    }
  });
}

export async function scaffoldGlobalResource(input = {}, options = {}) {
  const paths = globalWorkspacePaths(options);
  if (!VALID_GLOBAL_KINDS.has(input.kind)) {
    throw new Error(`Invalid global resource kind "${input.kind}". Expected skill, agent, rule.`);
  }
  return scaffoldResourceInWorkspace(paths, input, {
    workspaceName: "aof-global",
    schema: "https://aof.local/schemas/aof.schema.json"
  });
}

async function scaffoldResourceInWorkspace(paths, input, options = {}) {
  const kind = input.kind;
  const id = normalizeId(input.id);
  const runtimes = normalizeRuntimes(input.runtimes);
  const force = Boolean(input.force);

  if (!VALID_KINDS.has(kind)) {
    throw new Error(`Invalid resource kind "${kind}". Expected ${supportedResourceKinds().join(", ")}.`);
  }

  if (options.beforeRead) await options.beforeRead();

  const existing = await readExistingConfig(paths.configPath, options.workspaceName ?? path.basename(paths.workspaceDir), options.schema);
  const resourcePath = assetPath(kind, id);
  const absoluteAssetPath = path.join(paths.workspaceDir, resourcePath);
  const existingIndex = (existing.resources ?? []).findIndex((resource) => resource.kind === kind && normalizeId(resource.id) === id);
  const assetExists = await exists(absoluteAssetPath);

  if (existingIndex >= 0 && !force) {
    throw new Error(`Resource already exists in config: ${kind}:${id}. Re-run with --force to replace it.`);
  }

  if (assetExists && !force) {
    throw new Error(`Asset file already exists: ${absoluteAssetPath}. Re-run with --force to replace it.`);
  }

  const resource = {
    kind,
    id,
    path: resourcePath,
    runtimes
  };
  if (input.name) resource.name = input.name;
  if (input.description) resource.description = input.description;

  const resources = [...(existing.resources ?? [])];
  if (existingIndex >= 0) {
    resources[existingIndex] = resource;
  } else {
    resources.push(resource);
  }

  const config = {
    ...existing,
    $schema: existing.$schema ?? options.schema ?? "../schemas/aof.schema.json",
    name: existing.name ?? options.workspaceName ?? path.basename(paths.workspaceDir),
    resources,
    packages: existing.packages ?? []
  };

  if (input.dryRun) {
    return {
      dryRun: true,
      configPath: paths.configPath,
      assetPath: absoluteAssetPath,
      resource
    };
  }

  await writeText(absoluteAssetPath, skeletonFor(kind, { id, name: input.name, description: input.description }));
  await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);

  return {
    dryRun: false,
    configPath: paths.configPath,
    assetPath: absoluteAssetPath,
    resource
  };
}

function normalizeRuntimes(runtimes) {
  if (!runtimes || runtimes.length === 0) return supportedRuntimes();
  const normalized = [...new Set(runtimes)];
  for (const runtime of normalized) {
    if (!VALID_RUNTIMES.has(runtime)) {
      throw new Error(`Unsupported runtime "${runtime}". Expected ${supportedRuntimes().join(", ")}.`);
    }
  }
  return normalized;
}

function assetPath(kind, id) {
  const definition = RESOURCE_KINDS[kind];
  return path.join("assets", definition.plural, id, defaultBodyFile(kind)).replaceAll(path.sep, "/");
}

async function readExistingConfig(configPath, workspaceName, schema = "../schemas/aof.schema.json") {
  if (await exists(configPath)) return readJson(configPath);
  return {
    $schema: schema,
    name: workspaceName,
    resources: [],
    packages: []
  };
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function skeletonFor(kind, input) {
  const title = input.name ?? input.id;
  const description = input.description ? `\n\n${input.description}` : "";
  const bodies = {
    skill: `# ${title}${description}\n\n## Workflow\n\nDescribe the reusable workflow this skill should guide.\n`,
    command: `# ${title}${description}\n\nDescribe the command prompt this assistant command should run.\n`,
    agent: `# ${title}${description}\n\nDescribe this agent's role, scope, and review criteria.\n`,
    rule: `# ${title}${description}\n\n- Add project guidance here.\n`
  };
  return bodies[kind];
}
