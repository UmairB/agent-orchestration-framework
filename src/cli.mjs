import path from "node:path";
import { access } from "node:fs/promises";
import { loadConfig, loadProjectConfig } from "./dsl.mjs";
import { applyConfig, supportedRuntimes } from "./adapters.mjs";
import { executeFrameworkInstallPlan, frameworkPlanFromLock, gsdPackageFromConfig, installFramework, installFrameworkItems, knownFrameworks, planFrameworkInstall } from "./frameworks.mjs";
import { mergeFrameworkInstallAttempts, readLock, writeLock } from "./lock.mjs";
import { createLockManifest, createRenderPlan, executeApplyActions, planApplyActions, summarizeLockManifest } from "./render-plan.mjs";
import { readJson, writeText } from "./fs.mjs";
import { writeWorkspaceConfig } from "./workspace-writer.mjs";
import { defaultDbPath } from "./paths.mjs";
import { confirmAction, selectItems, selectRuntimes } from "./prompt.mjs";
import { findProjectConfig, globalWorkspacePaths, isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "./workspace.mjs";
import { collectAdapterWarnings } from "./adapter-warnings.mjs";
import { adapterWarningsForConfig, doctorConfig, inspectConfig, inspectGlobalConfig, validateConfig, validateGlobalConfig } from "./config-inspect.mjs";

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
      "namespace": "gsd",
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

  if (command === "add") {
    await addCommand(rest);
    return;
  }

  if (command === "apply") {
    await applyCommand(rest);
    return;
  }

  if (command === "sync") {
    await syncCommand(rest);
    return;
  }

  if (command === "clean") {
    await cleanCommand(rest);
    return;
  }

  if (command === "migrate") {
    await migrateCommand(rest);
    return;
  }

  if (command === "validate") {
    await validateCommand(rest);
    return;
  }

  if (command === "doctor") {
    await doctorCommand(rest);
    return;
  }

  if (command === "install") {
    await installCommand(rest);
    return;
  }

  if (command === "global") {
    await globalCommand(rest);
    return;
  }

  if (command === "catalog") {
    await catalogCommand(rest);
    return;
  }

  if (command === "config") {
    await configCommand(rest);
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

async function addCommand(args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!kind || !id) {
    throw new Error("Usage: aof add <kind> <id> [--runtime claude,codex] [--description text] [--force]");
  }

  const targetDir = path.resolve(options.target ?? process.cwd());
  const { scaffoldResource } = await import("./scaffold.mjs");
  const result = await scaffoldResource(targetDir, {
    kind,
    id,
    name: options.name,
    description: options.description,
    runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : supportedRuntimes(),
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun)
  });

  if (result.dryRun) {
    console.log(`write: ${result.assetPath}`);
    console.log(`write: ${result.configPath}`);
    return;
  }

  console.log(`Created ${result.assetPath}`);
  console.log(`Updated ${result.configPath}`);
}

async function globalCommand(args) {
  const [subcommand, ...rest] = args;

  if (subcommand === "add") {
    await globalAddCommand(rest);
    return;
  }

  if (subcommand === "list") {
    await globalListCommand(rest);
    return;
  }

  if (subcommand === "show") {
    await globalShowCommand(rest);
    return;
  }

  if (subcommand === "validate") {
    await globalValidateCommand(rest);
    return;
  }

  throw new Error(`Unknown global command "${subcommand ?? ""}". Usage: aof global add|list|show|validate`);
}

async function globalAddCommand(args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!kind || !id) {
    throw new Error("Usage: aof global add <kind> <id> [--runtime claude,codex] [--description text] [--force]");
  }

  const { scaffoldGlobalResource } = await import("./scaffold.mjs");
  const result = await scaffoldGlobalResource({
    kind,
    id,
    name: options.name,
    description: options.description,
    runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : supportedRuntimes(),
    force: Boolean(options.force),
    dryRun: Boolean(options.dryRun)
  });

  if (result.dryRun) {
    console.log(`write: ${result.assetPath}`);
    console.log(`write: ${result.configPath}`);
    return;
  }

  console.log(`Created ${result.assetPath}`);
  console.log(`Updated ${result.configPath}`);
}

async function globalListCommand(args) {
  const options = parseOptions(args);
  const inspection = await inspectGlobalConfig();
  if (options.json) {
    printJson(inspection);
    return;
  }

  console.log(`global: ${inspection.configPath}`);
  if (inspection.resources.length === 0) {
    console.log("resources: 0");
    return;
  }
  console.log(`resources: ${inspection.resources.length}`);
  for (const resource of inspection.resources) {
    console.log(`- ${resource.kind}:${resource.id} runtimes=${resource.runtimes.join(",")}`);
  }
}

async function globalShowCommand(args) {
  const options = parseOptions(args);
  const [kind, id] = options._;
  if (!kind || !id) {
    throw new Error("Usage: aof global show <kind> <id> [--json]");
  }

  const paths = globalWorkspacePaths();
  if (!await exists(paths.configPath)) {
    throw new Error(`Global config not found at ${paths.configPath}. Run aof global add <kind> <id> first.`);
  }

  const raw = await readJson(paths.configPath);
  const resource = (raw.resources ?? []).find((item) => item.kind === kind && item.id === id);
  if (!resource) {
    throw new Error(`Global resource not found: ${kind}:${id}`);
  }

  const sourcePath = resource.path ? path.resolve(path.dirname(paths.configPath), resource.path) : null;
  const bodyExists = sourcePath ? await exists(sourcePath) : Boolean(resource.body || resource.prompt || resource.instructions);
  const payload = {
    configPath: paths.configPath,
    resource: {
      ...resource,
      sourcePath,
      bodyExists
    }
  };

  if (options.json) {
    printJson(payload);
    return;
  }

  console.log(`global: ${paths.configPath}`);
  console.log(`resource: ${resource.kind}:${resource.id}`);
  if (resource.name) console.log(`name: ${resource.name}`);
  if (resource.description) console.log(`description: ${resource.description}`);
  console.log(`runtimes: ${(resource.runtimes ?? supportedRuntimes()).join(",")}`);
  if (sourcePath) console.log(`path: ${sourcePath}`);
  console.log(`body: ${bodyExists ? "present" : "missing"}`);
}

async function globalValidateCommand(args) {
  const options = parseOptions(args);
  const diagnostics = await validateGlobalConfig();
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      diagnostics
    });
  } else if (!failed) {
    console.log("valid: global config passed validation");
    if (warnings.length > 0) console.log(`warnings: ${warnings.length}`);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warnings.length} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
  }

  if (failed) process.exitCode = 1;
}

async function applyCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const configPath = await findProjectConfig(targetDir, options.config);
  const paths = workspacePaths(targetDir);
  const config = await loadProjectConfig(configPath);
  const runtimes = parseRuntimes(options);
  const adapterWarnings = collectAdapterWarnings(config, {
    targetDir,
    runtimes,
    global: Boolean(options.global)
  });
  const desiredOutputs = await createRenderPlan(config, {
    targetDir,
    runtimes,
    global: Boolean(options.global)
  });
  const previousLock = await readLock(paths.lockPath);
  const actions = await planApplyActions(desiredOutputs, previousLock, {
    targetDir,
    force: Boolean(options.force)
  });

  const manifest = createLockManifest({
    actions,
    desiredOutputs,
    previousLock,
    config,
    runtimes,
    global: Boolean(options.global)
  });

  if (options.dryRun) {
    const summary = summarizeLockManifest(manifest);
    if (options.json) {
      printJson({ dryRun: true, strict: Boolean(options.strict), adapterWarnings, actions, lockPreview: summary });
      if (options.strict && adapterWarnings.length > 0) process.exitCode = 1;
      return;
    }
    printAdapterWarnings(adapterWarnings);
    if (strictAdapterWarningsFailed(options, adapterWarnings)) return;
    for (const item of actions) {
      console.log(formatApplyAction(item));
    }
    console.log(`lock-preview: ${summary.files} file(s), ${summary.frameworks} framework intent(s)`);
    return;
  }

  printAdapterWarnings(adapterWarnings);
  if (strictAdapterWarningsFailed(options, adapterWarnings)) return;
  for (const item of actions) {
    console.log(formatApplyAction(item));
  }

  await executeApplyActions(actions);
  await writeLock(paths.lockPath, manifest);
  console.log(`lock: ${paths.lockPath}`);
}

async function syncCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const { createSyncPlan, executeSyncPlan } = await import("./sync.mjs");
  const plan = await createSyncPlan(targetDir, {
    ...options,
    runtimes: parseRuntimes(options)
  });

  if (options.dryRun) {
    if (options.json) {
      printJson({
        dryRun: true,
        strict: Boolean(options.strict),
        adapterWarnings: plan.adapterWarnings,
        actions: plan.actions,
        frameworkPlan: plan.frameworkPlan,
        lockPreview: plan.lockSummary
      });
      if (options.strict && plan.adapterWarnings.length > 0) process.exitCode = 1;
      return;
    }
    console.log("dry-run: no files, lock, or package installers will run");
  }

  printAdapterWarnings(plan.adapterWarnings);
  if (strictAdapterWarningsFailed(options, plan.adapterWarnings)) return;

  for (const item of plan.actions) {
    console.log(formatApplyAction(item));
  }
  for (const item of plan.frameworkPlan) {
    console.log(item.skipped ? `installer-skip: ${item.command} reason=${item.skipReason}` : `installer: ${item.command}`);
  }

  const summary = plan.lockSummary;
  console.log(`lock-preview: ${summary.files} file(s), ${summary.frameworks} framework intent(s)`);

  if (options.dryRun) return;

  if (plan.frameworkPlan.length > 0 && !options.install) {
    console.log("network: disabled; use --install to run package installers");
  }

  if (options.install) {
    for (const item of plan.frameworkPlan) {
      if (item.skipped) {
        console.log(`skip: ${item.runtime} ${item.skipReason}`);
        continue;
      }
      console.log(`network-boundary: running ${item.command}`);
      console.log(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
      console.log("warning: this command may access the network and execute npm package code");
    }
  }

  const result = await executeSyncPlan(plan, { install: Boolean(options.install) });
  console.log(`lock: ${plan.lockPath}`);
  for (const attempt of result.attempts) {
    console.log(`attempt: ${attempt.runtime} status=${attempt.status} exit=${attempt.exitStatus}`);
  }
  const failed = result.attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) {
    for (const attempt of failed) console.log(`retry: ${attempt.command}`);
    throw new Error(`Framework install failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
  }
}

async function cleanCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const { createCleanPlan, executeCleanPlan } = await import("./clean.mjs");
  const plan = await createCleanPlan(targetDir);

  if (!plan.lock) {
    console.log(`clean: no lock file found at ${plan.lockPath}`);
    return;
  }

  if (options.dryRun) {
    console.log("dry-run: no generated files or lock entries will be removed");
  }

  if (plan.actions.length === 0) {
    console.log("clean: no generated file entries in lock");
  }

  for (const item of plan.actions) {
    console.log(formatApplyAction(item));
  }
  console.log(`lock-preview: remove ${plan.removedCount} file entr${plan.removedCount === 1 ? "y" : "ies"}`);

  if (options.dryRun) return;

  await executeCleanPlan(plan);
  console.log(`lock: ${plan.lockPath}`);
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

  if (options.fromLock) {
    await installFromLockCommand(options);
    return;
  }

  if (options.interactive && !framework) {
    await interactiveInstallCommand(options);
    return;
  }

  if (framework && !framework.startsWith("--")) {
    await frameworkInstallCommand(framework, options);
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

async function configCommand(args) {
  const [subcommand = "show", ...rest] = args;
  const options = parseOptions(rest);
  const targetDir = path.resolve(options.target ?? process.cwd());

  if (subcommand === "show") {
    const inspection = await inspectConfig(targetDir, options);
    if (options.json) {
      printJson(inspection);
      return;
    }
    console.log(`config: ${inspection.configPath}`);
    console.log(`name: ${inspection.name ?? "(unresolved)"}`);
    console.log(`resources: ${inspection.resources.length}`);
    for (const resource of inspection.resources) {
      console.log(`- ${resource.kind}:${resource.id} source=${resource.source ?? "local"} runtimes=${resource.runtimes.join(",")}`);
    }
    console.log(`globalRefs: ${inspection.globalRefs.length}`);
    for (const ref of inspection.globalRefs) {
      console.log(`- global:${ref.kind}:${ref.id}`);
    }
    console.log(`packages: ${inspection.packages.length}`);
    for (const pkg of inspection.packages) {
      console.log(`- ${pkg.id} source=${pkg.source} runtimes=${(pkg.runtimes ?? []).join(",")}`);
    }
    if (inspection.legacyConfigIsStale) console.log(`warning: root aof.config.json is legacy; ${inspection.configPath} is authoritative`);
    return;
  }

  if (subcommand === "validate") {
    await validateCommand(rest);
    return;
  }

  if (subcommand === "doctor") {
    await doctorCommand(rest);
    return;
  }

  throw new Error(`Unknown config command "${subcommand}".`);
}

async function validateCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const diagnostics = await validateConfig(targetDir, options);
  const adapterWarnings = await adapterWarningsForConfig(targetDir, {
    ...options,
    runtimes: parseRuntimes(options)
  });
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const warningCount = warnings.length + adapterWarnings.length;
  const failed = errors.length > 0 || (options.strict && warningCount > 0);

  if (options.json) {
    printJson({
      valid: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warningCount,
      diagnostics,
      adapterWarnings
    });
  } else if (!failed) {
    console.log("valid: config passed validation");
    if (warningCount > 0) console.log(`warnings: ${warningCount}`);
    printAdapterWarnings(adapterWarnings);
  } else {
    const reason = errors.length > 0 ? `${errors.length} error(s)` : `${warningCount} warning(s) under --strict`;
    console.log(`invalid: ${reason}`);
    for (const item of diagnostics) console.log(`${item.severity}: ${item.path} ${item.message}`);
    printAdapterWarnings(adapterWarnings);
  }

  if (failed) process.exitCode = 1;
}

async function doctorCommand(args) {
  const options = parseOptions(args);
  const targetDir = path.resolve(options.target ?? process.cwd());
  const report = await doctorConfig(targetDir, {
    ...options,
    runtimes: parseRuntimes(options)
  });
  const errors = report.checks.filter((item) => item.severity === "error");
  const warnings = report.checks.filter((item) => item.severity === "warning");
  const failed = errors.length > 0 || (options.strict && warnings.length > 0);

  if (options.json) {
    printJson({
      healthy: !failed,
      strict: Boolean(options.strict),
      errors: errors.length,
      warnings: warnings.length,
      ...report
    });
  } else {
    console.log(`doctor: ${failed ? "issues found" : "healthy"}`);
    for (const check of report.checks) {
      console.log(`${check.severity}: ${check.id} - ${check.message}`);
    }
    printAdapterWarnings(report.adapterWarnings);
    for (const suggestion of report.suggestions) {
      console.log(`next: ${suggestion}`);
    }
  }

  if (failed) process.exitCode = 1;
}

async function frameworkInstallCommand(framework, options) {
  const targetDir = path.resolve(options.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  let config = null;
  try {
    config = await loadConfig(await findProjectConfig(targetDir, options.config));
  } catch (error) {
    if (options.config) throw error;
  }
  const pkg = framework === "gsd" ? gsdPackageFromConfig(config) : null;
  const previousLock = await readLock(paths.lockPath);
  const source = options.package ?? options.source ?? pkg?.source;
  const packageOptions = pkg && source === pkg.source ? pkg : null;
  const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : (pkg?.runtimes ?? parseRuntimes(options));
  const plan = planFrameworkInstall(framework, {
    package: packageOptions,
    source,
    namespace: pkg?.namespace,
    runtimes,
    global: Boolean(options.global),
    force: Boolean(options.force),
    previousLock
  });

  if (options.dryRun) {
    if (options.json) {
      printJson({ dryRun: true, network: false, commands: plan });
      return;
    }
    console.log("dry-run: no network or installer commands will run");
    for (const item of plan) console.log(item.skipped ? `skip: ${item.command} reason=${item.skipReason}` : item.command);
    return;
  }

  for (const item of plan) {
    if (item.skipped) {
      console.log(`skip: ${item.runtime} ${item.skipReason}`);
      continue;
    }
    console.log(`network-boundary: running ${item.command}`);
    console.log(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
    console.log("warning: this command may access the network and execute npm package code");
  }

  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  for (const attempt of attempts) {
    console.log(`attempt: ${attempt.runtime} status=${attempt.status} exit=${attempt.exitStatus}`);
  }
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) {
    for (const attempt of failed) console.log(`retry: ${attempt.command}`);
    throw new Error(`Framework install failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
  }
}

async function installFromLockCommand(options) {
  const targetDir = path.resolve(options.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  const previousLock = await readLock(paths.lockPath);
  if (!previousLock) throw new Error(`No lock file found at ${paths.lockPath}.`);
  const plan = frameworkPlanFromLock(previousLock, { previousLock });
  if (plan.length === 0) throw new Error("No framework intent found in lock state.");

  if (options.dryRun) {
    if (options.json) {
      printJson({ dryRun: true, fromLock: true, network: false, commands: plan });
      return;
    }
    console.log("dry-run: no network or installer commands will run");
    for (const item of plan) console.log(item.command);
    return;
  }

  for (const item of plan) {
    console.log(`network-boundary: replaying ${item.command}`);
    console.log(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
    console.log("warning: this command may access the network and execute npm package code");
  }
  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  if (failed.length > 0) throw new Error(`Framework replay failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
}

async function interactiveInstallCommand(options) {
  const targetDir = path.resolve(options.target ?? process.cwd());
  const { itemsToConfig, openCatalog } = await import("./catalog.mjs");
  const catalog = await openCatalog({ db: options.db });
  try {
    catalog.seedBuiltins();
    const selectedItems = await resolveInstallItems(catalog, { ...options, select: true });
    const runtimes = hasRuntimeOptions(options) ? parseRuntimes(options) : await selectRuntimes();
    const selectedConfig = {
      ...itemsToConfig(selectedItems),
      $schema: "../schemas/aof.schema.json",
      name: path.basename(targetDir),
      items: selectedItems.map((item) => item.id),
      runtimes
    };
    const existingInspection = await inspectConfig(targetDir).catch(() => null);
    const configExists = existingInspection?.workspaceConfigExists;
    const config = configExists ? mergeInteractiveConfig(await loadConfig(existingInspection.configPath), selectedConfig, runtimes) : selectedConfig;
    const frameworkItems = selectedItems.filter((item) => item.kind === "framework");
    const desiredOutputs = await createRenderPlan(await import("./dsl.mjs").then(({ resolveConfig }) => resolveConfig(config, targetDir)), {
      targetDir,
      runtimes,
      global: Boolean(options.global)
    });
    const previousLock = await readLock(workspacePaths(targetDir).lockPath);
    const renderActions = await planApplyActions(desiredOutputs, previousLock, { targetDir, force: Boolean(options.force) });
    const frameworkPlan = frameworkItems.flatMap((item) => planFrameworkInstall(item.id, {
      package: item,
      source: item.source,
      runtimes: runtimes.filter((runtime) => item.runtimes.includes(runtime)),
      global: Boolean(options.global),
      previousLock,
      force: Boolean(options.force)
    }));

    console.log(configExists ? "interactive: existing .aof config found; proposed changes follow" : "interactive: proposed .aof config follows");
    console.log(`resources: ${config.resources.length}`);
    console.log(`packages: ${config.packages.length}`);
    for (const action of renderActions) console.log(formatApplyAction(action));
    for (const item of frameworkPlan) console.log(`framework: ${item.command}`);

    if (await confirmAction("Write .aof config?", false)) {
      await writeWorkspaceConfig(targetDir, config);
      console.log(`config: ${workspacePaths(targetDir).configPath}`);
    } else {
      console.log("skip: .aof config not written");
    }

    if (await confirmAction("Write runtime files?", false)) {
      await executeApplyActions(renderActions);
      const manifest = createLockManifest({ actions: renderActions, desiredOutputs, previousLock, config, runtimes, global: Boolean(options.global) });
      await writeLock(workspacePaths(targetDir).lockPath, manifest);
      console.log(`lock: ${workspacePaths(targetDir).lockPath}`);
    } else {
      console.log("skip: runtime files not written");
    }

    if (frameworkPlan.length > 0 && await confirmAction("Run GSD installer commands?", false)) {
      const latestLock = await readLock(workspacePaths(targetDir).lockPath);
      const attempts = executeFrameworkInstallPlan(frameworkPlan);
      await writeLock(workspacePaths(targetDir).lockPath, mergeFrameworkInstallAttempts(latestLock, attempts));
      const failed = attempts.filter((attempt) => attempt.status === "failed");
      if (failed.length > 0) throw new Error(`Framework install failed for ${failed.map((attempt) => attempt.runtime).join(", ")}.`);
    } else if (frameworkPlan.length > 0) {
      console.log("skip: GSD installer not run");
    }
  } finally {
    catalog.close();
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

    if (["claude", "codex", "global", "local", "dryRun", "force", "select", "interactive", "noServe", "defaults", "json", "fromLock", "strict", "install"].includes(key)) {
      options[key] = true;
      continue;
    }

    options[key] = inlineValue ?? args[++index];
  }

  return options;
}

function mergeInteractiveConfig(existingConfig, selectedConfig, runtimes) {
  const resources = [...existingConfig.resources];
  for (const resource of selectedConfig.resources) {
    if (!resources.some((item) => item.kind === resource.kind && item.id === resource.id)) {
      resources.push({ ...resource, runtimes });
    }
  }

  const packages = [...(existingConfig.packages ?? [])];
  for (const pkg of selectedConfig.packages ?? []) {
    if (!packages.some((item) => item.id === pkg.id)) {
      packages.push({ ...pkg, runtimes: pkg.runtimes.filter((runtime) => runtimes.includes(runtime)) });
    }
  }

  return {
    $schema: "../schemas/aof.schema.json",
    name: existingConfig.name ?? selectedConfig.name,
    resources,
    packages,
    items: selectedConfig.items,
    runtimes
  };
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
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

function formatApplyAction(item) {
  const parts = [
    `${item.action}: ${item.path}`,
    item.runtime ? `runtime=${item.runtime}` : null,
    item.resource ? `source=${item.resource.kind}:${item.resource.id}` : null,
    item.reason ? `reason=${item.reason}` : null
  ].filter(Boolean);
  return parts.join(" ");
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
  aof init [dir] [--items id,id] [--defaults] [--claude] [--codex] [--force] [--db path]
  aof add <kind> <id> [--runtime claude,codex] [--description text] [--force]
  aof migrate [dir] [--force] [--dry-run]
  aof apply [--config aof.config.json] [--target dir] [--claude] [--codex] [--global] [--dry-run] [--force] [--strict]
  aof sync [--claude] [--codex] [--global] [--dry-run] [--force] [--strict] [--install]
  aof validate [--json] [--strict]
  aof doctor [--json] [--strict]
  aof clean [--dry-run] [--force]

Supporting commands:
  aof global add <kind> <id> [--runtime claude,codex] [--description text] [--force]
  aof global list|show|validate [--json]
  aof install [--no-serve] [--db path] [--port 4177]
  aof config show [--json]
  aof catalog init|list|path [--db path]
  aof install gsd [--claude] [--codex] [--global] [--dry-run] [--force] [--json]
  aof install --interactive
  aof install --from-lock [--dry-run]

Defaults:
  install initializes the AOF catalog at ${defaultDbPath()} and starts the setup UI.
  init selects catalog items and coding assistants for the current repository.
  install gsd runs: npx get-shit-done-cc@latest with the selected runtime flags.
  --strict promotes adapter warnings to command failures for CI.
`;
}

function printAdapterWarnings(warnings = []) {
  if (warnings.length === 0) return;
  console.log("adapter-warnings:");
  for (const warning of warnings) {
    const source = warning.kind && warning.id ? `${warning.kind}:${warning.id}` : warning.kind;
    const output = warning.generatedPath ? ` output=${warning.generatedPath}` : "";
    console.log(`- [${warning.code}] ${warning.path} runtime=${warning.runtime} source=${source}${output}`);
    console.log(`  reason: ${warning.reason}`);
    console.log(`  remediation: ${warning.remediation}`);
  }
}

function strictAdapterWarningsFailed(options, warnings = []) {
  if (!options.strict || warnings.length === 0) return false;
  console.log(`strict: ${warnings.length} adapter warning(s) treated as failure`);
  process.exitCode = 1;
  return true;
}
