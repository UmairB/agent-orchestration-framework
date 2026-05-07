import { loadConfig } from "./dsl.mjs";
import { executeFrameworkInstallPlan, planFrameworkInstall } from "./frameworks.mjs";
import { mergeFrameworkInstallAttempts, readLock, writeLock } from "./lock.mjs";
import { createLockManifest, createRenderPlan, executeApplyActions, planApplyActions, summarizeLockManifest } from "./render-plan.mjs";
import { findProjectConfig, workspacePaths } from "./workspace.mjs";

export async function createSyncPlan(projectDir = process.cwd(), options = {}) {
  const configPath = await findProjectConfig(projectDir, options.config);
  const paths = workspacePaths(projectDir);
  const config = await loadConfig(configPath);
  const previousLock = await readLock(paths.lockPath);
  const runtimes = options.runtimes;
  const desiredOutputs = await createRenderPlan(config, {
    targetDir: projectDir,
    runtimes,
    global: Boolean(options.global)
  });
  const actions = await planApplyActions(desiredOutputs, previousLock, {
    targetDir: projectDir,
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
  const frameworkPlan = (config.packages ?? []).flatMap((pkg) => planFrameworkInstall(pkg.id, {
    source: pkg.source,
    runtimes: (pkg.runtimes ?? runtimes).filter((runtime) => runtimes.includes(runtime)),
    global: Boolean(options.global),
    previousLock,
    force: Boolean(options.force)
  }));

  return {
    configPath,
    lockPath: paths.lockPath,
    config,
    previousLock,
    desiredOutputs,
    actions,
    manifest,
    lockSummary: summarizeLockManifest(manifest),
    frameworkPlan
  };
}

export async function executeSyncPlan(plan, options = {}) {
  await executeApplyActions(plan.actions);
  await writeLock(plan.lockPath, plan.manifest);

  if (!options.install || plan.frameworkPlan.length === 0) {
    return { attempts: [], lock: plan.manifest };
  }

  const attempts = executeFrameworkInstallPlan(plan.frameworkPlan);
  const lock = mergeFrameworkInstallAttempts(plan.manifest, attempts);
  await writeLock(plan.lockPath, lock);
  return { attempts, lock };
}
