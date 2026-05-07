import { spawnSync } from "node:child_process";

const FRAMEWORKS = {
  gsd: {
    packageName: "get-shit-done-cc@latest",
    runtimes: {
      claude: "--claude",
      codex: "--codex"
    }
  }
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
  const framework = FRAMEWORKS[name];
  if (!framework) {
    throw new Error(`Unknown framework "${name}". Known frameworks: ${knownFrameworks().join(", ")}.`);
  }

  const packageName = sourceToPackageName(options.source) ?? options.packageName ?? framework.packageName;
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
      attempt.packageSource === packageSource(packageName, options.source) &&
      attempt.status === "success"
    ));
    return {
      framework: name,
      runtime,
      scope,
      packageName,
      packageSource: packageSource(packageName, options.source),
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
  const frameworks = Array.isArray(lock?.frameworks) ? lock.frameworks : [];
  return frameworks.flatMap((framework) => planFrameworkInstall(framework.id, {
    source: framework.source,
    runtimes: framework.runtimes,
    global: framework.scope === "global",
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
    packageSource: item.packageSource,
    skipped: status === "skipped"
  };
}

function packageSource(packageName, source) {
  return source ?? `npm:${packageName}`;
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
      runtimes: options.runtimes?.filter((runtime) => item.runtimes.includes(runtime)) ?? item.runtimes,
      global: options.global,
      dryRun: options.dryRun
    }));
  }

  return commands;
}
