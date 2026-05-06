import path from "node:path";
import { access } from "node:fs/promises";
import { loadConfig } from "./dsl.mjs";
import { applyConfig, supportedRuntimes } from "./adapters.mjs";
import { installFramework, installFrameworkItems, knownFrameworks } from "./frameworks.mjs";
import { readJson, writeText } from "./fs.mjs";
import { RESOURCE_KINDS, defaultBodyFile } from "./model.mjs";
import { defaultDbPath } from "./paths.mjs";
import { selectItems, selectRuntimes } from "./prompt.mjs";
import { findProjectConfig, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";

const DEFAULT_CONFIG = `{
  "$schema": "./schemas/aof.schema.json",
  "name": "assistant-project",
  "resources": [
    {
      "kind": "skill",
      "id": "project-context",
      "name": "project-context",
      "description": "Shared project context for assistant coding sessions.",
      "body": "Read the repository before changing code. Prefer existing project patterns, keep edits scoped, and verify behavior with the narrowest meaningful checks."
    },
    {
      "kind": "command",
      "id": "prime",
      "description": "Prime the assistant with repository context.",
      "prompt": "Inspect the repository structure, identify the stack, summarize the main modules, and call out anything risky before making changes."
    },
    {
      "kind": "agent",
      "id": "code-reviewer",
      "name": "code-reviewer",
      "description": "Reviews changes for bugs, regressions, and missing verification.",
      "instructions": "Review the diff from a senior engineering perspective. Lead with concrete findings using file and line references, then summarize residual risk."
    }
  ],
  "packages": [
    {
      "id": "gsd",
      "source": "npm:get-shit-done-cc@latest",
      "runtimes": ["claude", "codex"]
    }
  ]
}
`;

export async function run(argv) {
  const [command, ...rest] = argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    console.log(helpText());
    return;
  }

  if (command === "init") {
    await initCommand(rest);
    return;
  }

  if (command === "apply") {
    await applyCommand(rest);
    return;
  }

  if (command === "migrate") {
    await migrateCommand(rest);
    return;
  }

  if (command === "install") {
    await installCommand(rest);
    return;
  }

  if (command === "catalog") {
    await catalogCommand(rest);
    return;
  }

  throw new Error(`Unknown command "${command}".\n\n${helpText()}`);
}

async function initCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const paths = workspacePaths(targetDir);

  if (!options.force && await exists(paths.configPath)) {
    throw new Error(`Config already exists at ${paths.configPath}. Re-run with --force to replace it.`);
  }

  if (!options.force && await isLegacyConfigOnlyProject(targetDir)) {
    throw new Error(`Legacy config already exists at ${legacyConfigPath(targetDir)}. Run aof migrate to create .aof/ explicitly.`);
  }

  const { itemsToConfig, openCatalog } = await import("./catalog.mjs");
  const catalog = await openCatalog({ db: options.db });
  try {
    catalog.seedBuiltins();
    const items = await resolveProjectInitItems(catalog, options);
    const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : await selectRuntimes();
    const config = itemsToConfig(items);
    if (options.dryRun) {
      console.log(`write: ${paths.configPath}`);
    } else {
      await writeWorkspaceConfig(targetDir, {
        ...config,
        $schema: "../schemas/aof.schema.json",
        name: path.basename(targetDir),
        items: items.map((item) => item.id),
        runtimes
      });
      console.log(`Created ${paths.configPath}`);
    }

    const writes = await applyConfig(config, {
      targetDir,
      runtimes,
      global: Boolean(options.global),
      dryRun: Boolean(options.dryRun)
    });
    const frameworkCommands = installFrameworkItems(items.filter((item) => item.kind === "framework"), {
      runtimes,
      global: Boolean(options.global),
      dryRun: Boolean(options.dryRun)
    });

    if (!options.dryRun) {
      await writeInstallLock(targetDir, items, runtimes, catalog.path);
    }

    for (const write of writes) {
      console.log(`${write.action}: ${write.path}`);
    }
    for (const command of frameworkCommands) {
      console.log(command);
    }
  } finally {
    catalog.close();
  }
}

async function applyCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const config = await loadConfig(configPath);
  const writes = await applyConfig(config, {
    targetDir,
    runtimes: parseRuntimes(options),
    global: Boolean(options.global),
    dryRun: Boolean(options.dryRun)
  });

  for (const write of writes) {
    console.log(`${write.action}: ${write.path}`);
  }
}

async function migrateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? options._[0] ?? process.cwd());
  const paths = workspacePaths(targetDir);
  const sourcePath = legacyConfigPath(targetDir);

  if (!await exists(sourcePath)) {
    throw new Error(`No legacy config found at ${sourcePath}.`);
  }

  if (!options.force && await exists(paths.configPath)) {
    throw new Error(`AOF workspace config already exists at ${paths.configPath}. Re-run with --force to replace it.`);
  }

  const legacyConfig = await readJson(sourcePath);
  const resolved = await loadConfig(sourcePath);
  if (options.dryRun) {
    console.log(`write: ${paths.configPath}`);
    console.log(`write: ${paths.lockPath}`);
    return;
  }

  await writeWorkspaceConfig(targetDir, {
    ...resolved,
    $schema: "../schemas/aof.schema.json",
    name: legacyConfig.name ?? resolved.name
  });
  await writeText(paths.lockPath, `${JSON.stringify({
    version: 1,
    migratedAt: new Date().toISOString(),
    source: "aof.config.json",
    runtimes: [...new Set(resolved.resources.flatMap((resource) => resource.runtimes))],
    items: resolved.resources.map((resource) => ({
      id: resource.id,
      kind: resource.kind,
      source: "legacy",
      runtimes: resource.runtimes
    }))
  }, null, 2)}\n`);

  console.log(`Created ${paths.configPath}`);
  console.log(`${paths.configPath} is now authoritative; root aof.config.json is legacy and was left untouched.`);
}

async function installCommand(args) {
  const options = parseOptions(args);
  const framework = options._[0];

  if (framework && !framework.startsWith("--")) {
    const commands = installFramework(framework, {
      runtimes: parseRuntimes(options),
      global: Boolean(options.global),
      dryRun: Boolean(options.dryRun)
    });

    for (const command of commands) {
      console.log(command);
    }
    return;
  }

  const { openCatalog } = await import("./catalog.mjs");
  const { serveSetupUi } = await import("./setup-ui.mjs");
  const catalog = await openCatalog({ db: options.db });
  try {
    catalog.seedBuiltins();
    console.log(`AOF catalog ready at ${catalog.path}`);
    if (options.noServe || options.dryRun) {
      console.log("Setup UI not started.");
      return;
    }
    const { url } = await serveSetupUi(catalog, { port: options.port });
    console.log(`AOF setup UI: ${url}`);
    await new Promise(() => {});
  } finally {
    if (options.noServe || options.dryRun) catalog.close();
  }
}

async function catalogCommand(args) {
  const [subcommand, ...rest] = args;
  const options = parseOptions(rest);

  if (subcommand === "path") {
    console.log(defaultDbPath({ db: options.db }));
    return;
  }

  const { openCatalog } = await import("./catalog.mjs");
  const catalog = await openCatalog({ db: options.db });
  try {
    if (!subcommand || subcommand === "init") {
      catalog.seedBuiltins();
      console.log(`Initialized catalog at ${catalog.path}`);
      return;
    }

    if (subcommand === "list") {
      for (const item of catalog.listItems()) {
        const marker = item.defaultEnabled ? "*" : " ";
        console.log(`[${marker}] ${item.id}\t${item.kind}\t${item.runtimes.join(",")}\t${item.description}`);
      }
      return;
    }

    throw new Error(`Unknown catalog command "${subcommand}".`);
  } finally {
    catalog.close();
  }
}

async function resolveInstallItems(catalog, options) {
  const allItems = catalog.listItems();
  if (options.select || options.interactive) {
    return selectItems(allItems);
  }

  if (options.items) {
    const ids = String(options.items).split(",").map((id) => id.trim()).filter(Boolean);
    return catalog.getItems(ids);
  }

  return catalog.defaultItems();
}

async function resolveProjectInitItems(catalog, options) {
  if (options.items) {
    const ids = String(options.items).split(",").map((id) => id.trim()).filter(Boolean);
    return catalog.getItems(ids);
  }

  if (options.defaults) {
    return catalog.defaultItems();
  }

  return selectItems(catalog.listItems());
}

async function writeInstallLock(targetDir, items, runtimes, dbPath) {
  const lockPath = workspacePaths(targetDir).lockPath;
  const lock = {
    version: 1,
    generatedAt: new Date().toISOString(),
    catalog: dbPath,
    runtimes,
    items: items.map((item) => ({
      id: item.id,
      kind: item.kind,
      source: item.source,
      runtimes: item.runtimes
    }))
  };

  await writeText(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

async function writeWorkspaceConfig(targetDir, config) {
  const paths = workspacePaths(targetDir);
  const resources = [];

  for (const resource of config.resources ?? []) {
    const resourcePath = assetBodyPath(resource);
    const content = resource.body ?? resource.prompt ?? resource.instructions ?? "";
    await writeText(path.join(paths.workspaceDir, resourcePath), `${content.trim()}\n`);

    const metadata = { ...resource, path: resourcePath.replaceAll(path.sep, "/") };
    delete metadata.body;
    delete metadata.prompt;
    delete metadata.instructions;
    delete metadata.overrides;
    resources.push(metadata);
  }

  await writeText(paths.configPath, `${JSON.stringify({
    $schema: config.$schema ?? "../schemas/aof.schema.json",
    name: config.name ?? "assistant-project",
    resources,
    packages: config.packages ?? [],
    ...(config.items ? { items: config.items } : {}),
    ...(config.runtimes ? { runtimes: config.runtimes } : {})
  }, null, 2)}\n`);
}

function assetBodyPath(resource) {
  const kind = RESOURCE_KINDS[resource.kind];
  if (!kind) throw new Error(`Invalid resource kind "${resource.kind}".`);
  return path.join("assets", kind.plural, resource.id, defaultBodyFile(resource.kind));
}

function parseOptions(args) {
  const options = { _: [] };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) {
      options._.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

    if (["claude", "codex", "global", "local", "dryRun", "force", "select", "interactive", "noServe", "defaults"].includes(key)) {
      options[key] = true;
      continue;
    }

    options[key] = inlineValue ?? args[++index];
  }

  return options;
}

function parseRuntimes(options) {
  const selected = [];
  if (options.claude) selected.push("claude");
  if (options.codex) selected.push("codex");

  if (options.runtime) {
    selected.push(...String(options.runtime).split(",").map((runtime) => runtime.trim()).filter(Boolean));
  }

  if (selected.length === 0) return supportedRuntimes();
  return [...new Set(selected)];
}

function hasRuntimeOptions(options) {
  return Boolean(options.claude || options.codex || options.runtime);
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function helpText() {
  return `aof - Assistant Ops Framework

Usage:
  aof install [--no-serve] [--db path] [--port 4177]
  aof init [dir] [--items id,id] [--defaults] [--claude] [--codex] [--force] [--db path]
  aof migrate [dir] [--force] [--dry-run]
  aof apply [--config aof.config.json] [--target dir] [--claude] [--codex] [--global] [--dry-run]
  aof catalog init|list|path [--db path]
  aof install gsd [--claude] [--codex] [--global] [--dry-run]

Defaults:
  install initializes the AOF catalog at ${defaultDbPath()} and starts the setup UI.
  init selects catalog items and coding assistants for the current repository.
  install gsd runs: npx get-shit-done-cc@latest with the selected runtime flags.
`;
}
