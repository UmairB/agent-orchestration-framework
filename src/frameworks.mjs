import { spawnSync } from "node:child_process";
import { packageInstallSpec } from "./packages.mjs";

const FRAMEWORKS = {
  gsd: {
    packageName: "get-shit-done-cc@latest",
    runtimes: {
      claude: "--claude",
      codex: "--codex"
    }
  }
};
const DEFAULT_RUNTIME_FLAGS = {
  claude: "--claude",
  codex: "--codex"
};

export function knownFrameworks() {
  return Object.keys(FRAMEWORKS);
}

export function installFramework(name, options = {}) {
  const plan = planFrameworkInstall(name, options);
  const commands = plan.map((item) => item.command);

  if (options.dryRun) {
    return commands;
  }

  const attempts = executeFrameworkInstallPlan(plan, options);
  const failed = attempts.find((attempt) => attempt.status === "failed");
  if (failed) {
    throw new Error(`Framework install failed: ${failed.command}`);
  }

  return commands;
}

export function planFrameworkInstall(name, options = {}) {
  const framework = FRAMEWORKS[name] ?? {
    packageName: options.packageName ?? name,
    runtimes: DEFAULT_RUNTIME_FLAGS
  };
  const packageName = installSpecFromOptions(options, framework);
  const packageSourceValue = packageSource(packageName, options);
  const namespace = options.package?.namespace ?? options.namespace ?? null;
  const scope = options.global ? "global" : "local";
  const scopeFlag = scope === "global" ? "--global" : "--local";
  const runtimes = options.runtimes ?? Object.keys(framework.runtimes);
  const priorAttempts = Array.isArray(options.previousLock?.frameworkInstallAttempts)
    ? options.previousLock.frameworkInstallAttempts
    : [];

  return runtimes.map((runtime) => {
    const runtimeFlag = framework.runtimes[runtime];
    if (!runtimeFlag) throw new Error(`Framework "${name}" does not support runtime "${runtime}".`);
    const argv = ["npx", packageName, runtimeFlag, scopeFlag];
    const command = argv.join(" ");
    const alreadySucceeded = priorAttempts.some((attempt) => (
      attempt.framework === name &&
      attempt.runtime === runtime &&
      attempt.scope === scope &&
      attempt.packageSource === packageSourceValue &&
      (attempt.namespace ?? null) === namespace &&
      attempt.status === "success"
    ));
    return {
      framework: name,
      namespace,
      runtime,
      scope,
      packageName,
      packageSource: packageSourceValue,
      sourceDescriptor: options.package?.sourceDescriptor ?? options.sourceDescriptor ?? null,
      dependencies: options.package?.dependencies ?? [],
      argv,
      command,
      skipped: Boolean(alreadySucceeded && !options.force),
      skipReason: alreadySucceeded && !options.force ? "successful matching install attempt exists in lock; use --force to rerun" : null
    };
  });
}

export function executeFrameworkInstallPlan(plan, options = {}) {
  const attempts = [];
  for (const item of plan) {
    if (item.skipped) {
      attempts.push(attemptFromPlan(item, "skipped", 0, options.generatedAt));
      continue;
    }

    const status = simulatedStatus(item.runtime);
    const result = status === null
      ? spawnSync(item.argv[0], item.argv.slice(1), { stdio: "inherit", shell: process.platform === "win32" })
      : { status };
    attempts.push(attemptFromPlan(item, result.status === 0 ? "success" : "failed", result.status ?? 1, options.generatedAt));
  }
  return attempts;
}

export function sourceToPackageName(source) {
  if (!source) return null;
  return String(source).startsWith("npm:") ? String(source).slice("npm:".length) : String(source);
}

export function gsdPackageFromConfig(config) {
  return (config?.packages ?? []).find((pkg) => pkg.id === "gsd") ?? null;
}

export function frameworkPlanFromLock(lock, options = {}) {
  const packages = Array.isArray(lock?.packages) && lock.packages.length > 0
    ? lock.packages
    : Array.isArray(lock?.frameworks) ? lock.frameworks : [];
  return packages.flatMap((pkg) => planFrameworkInstall(pkg.id, {
    package: pkg,
    source: pkg.source,
    sourceDescriptor: pkg.sourceDescriptor,
    namespace: pkg.namespace,
    runtimes: pkg.runtimes,
    global: pkg.scope === "global",
    force: true,
    previousLock: options.previousLock
  }));
}

function attemptFromPlan(item, status, exitStatus, generatedAt = new Date().toISOString()) {
  return {
    framework: item.framework,
    command: item.command,
    runtime: item.runtime,
    scope: item.scope,
    status,
    exitStatus,
    timestamp: generatedAt,
    namespace: item.namespace,
    packageSource: item.packageSource,
    sourceDescriptor: item.sourceDescriptor,
    skipped: status === "skipped"
  };
}

function packageSource(packageName, options) {
  return options.package?.source ?? options.source ?? `npm:${packageName}`;
}

function simulatedStatus(runtime) {
  const value = process.env.AOF_TEST_FRAMEWORK_INSTALL_STATUS;
  if (value === undefined) return null;
  const entries = Object.fromEntries(value.split(",").map((entry) => {
    const [key, status] = entry.split("=");
    return [key?.trim(), Number.parseInt(status, 10)];
  }));
  if (Object.hasOwn(entries, runtime)) {
    return Number.isFinite(entries[runtime]) ? entries[runtime] : 1;
  }
  if (Object.hasOwn(entries, "default")) {
    return Number.isFinite(entries.default) ? entries.default : 1;
  }
  return 0;
}

export function installFrameworkItems(items, options = {}) {
  const commands = [];
  for (const item of items) {
    commands.push(...installFramework(item.id, {
      package: item,
      runtimes: options.runtimes?.filter((runtime) => item.runtimes.includes(runtime)) ?? item.runtimes,
      global: options.global,
      dryRun: options.dryRun
    }));
  }

  return commands;
}

function installSpecFromOptions(options, framework) {
  if (options.package) return packageInstallSpec(options.package);
  if (options.sourceDescriptor) return packageInstallSpec({ source: options.source, sourceDescriptor: options.sourceDescriptor });
  return sourceToPackageName(options.source) ?? options.packageName ?? framework.packageName;
}
