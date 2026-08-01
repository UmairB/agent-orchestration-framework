// packages:install — execute declared package installers (m42 wave (d) leg
// d1). Class-A migration of cli.mjs's inline `packagesInstallCommand` +
// `frameworkInstallCommand` + `installFromLockCommand` — the wave-1 tail's
// second big flow. run() executes the plan and returns a mode-discriminated
// outcome; the render reproduces the retired handlers' console.log lines
// byte-for-byte and in the same order (boundary disclosure → attempts →
// retries). Two deliberate normalisations, both previously unasserted: the
// terminal "Framework install/replay failed for …" summary now ends the stdout
// document instead of riding a thrown error to stderr (the transcript would
// otherwise be lost — commands return data, faces print), and the failure exit
// rides cli.exit. Pure refusals (unknown package, missing intent, missing
// lock) still THROW before any side effect, exactly as before.
import path from "node:path";
import { loadConfig, loadProjectConfig } from "../dsl.mjs";
import { findProjectConfig, workspacePaths } from "../workspace.mjs";
import {
  executeFrameworkInstallPlan,
  frameworkPlanFromLock,
  gsdPackageFromConfig,
  planFrameworkInstall,
} from "../frameworks.mjs";
import { mergeFrameworkInstallAttempts, readLock, writeLock } from "../lock.mjs";
import { RUNTIME_FLAGS, hasRuntimeOptions, parseRuntimes } from "../spine/flags.mjs";

// One framework's install pass (the retired frameworkInstallCommand, minus the
// printing): plan → (dry-run stops here) → execute → merge attempts into the
// lock. The failed list is data — the render and exit adapter interpret it.
async function runFrameworkInstall(framework, input) {
  const targetDir = path.resolve(input.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  let config = null;
  try {
    config = await loadConfig(await findProjectConfig(targetDir, input.config));
  } catch (error) {
    if (input.config) throw error;
  }
  const pkg = framework === "gsd" ? gsdPackageFromConfig(config) : null;
  const previousLock = await readLock(paths.lockPath);
  const source = input.package ?? input.source ?? pkg?.source;
  const packageOptions = pkg && source === pkg.source ? pkg : null;
  const runtimes = hasRuntimeOptions(input) ? parseRuntimes(input) : (pkg?.runtimes ?? parseRuntimes(input));
  const plan = planFrameworkInstall(framework, {
    package: packageOptions,
    source,
    namespace: pkg?.namespace,
    runtimes,
    global: Boolean(input.global),
    force: Boolean(input.force),
    previousLock,
  });

  if (input.dryRun) return { framework, plan };

  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  return { framework, plan, attempts, failed: attempts.filter((attempt) => attempt.status === "failed") };
}

// The lock-replay pass (the retired installFromLockCommand, minus the printing).
async function runFromLock(input) {
  const targetDir = path.resolve(input.target ?? process.cwd());
  const paths = workspacePaths(targetDir);
  const previousLock = await readLock(paths.lockPath);
  if (!previousLock) throw new Error(`No lock file found at ${paths.lockPath}.`);
  const plan = frameworkPlanFromLock(previousLock, { previousLock });
  if (plan.length === 0) throw new Error("No framework intent found in lock state.");

  if (input.dryRun) return { mode: "dry-run", fromLock: true, batches: [{ plan }], failed: [] };

  const attempts = executeFrameworkInstallPlan(plan);
  await writeLock(paths.lockPath, mergeFrameworkInstallAttempts(previousLock, attempts));
  const failed = attempts.filter((attempt) => attempt.status === "failed");
  return { mode: "installed", fromLock: true, batches: [{ plan, attempts, failed }], failed };
}

export const packagesInstallCommand = {
  id: "packages:install",
  input: {
    type: "object",
    properties: {
      id: { type: "string" },
      fromLock: { type: "boolean" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
      global: { type: "boolean" },
      target: { type: "string" },
      config: { type: "string" },
      source: { type: "string" },
      package: { type: "string" },
      claude: { type: "boolean" },
      codex: { type: "boolean" },
      runtime: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input) {
    if (input.fromLock === true) return await runFromLock(input);

    if (input.id) {
      if (input.id !== "gsd") {
        throw new Error(`Package "${input.id}" does not have installer support yet. Phase 20 supports GSD installer execution only.`);
      }
      const targetDir = path.resolve(input.target ?? process.cwd());
      const config = await loadProjectConfig(await findProjectConfig(targetDir, input.config));
      if (!gsdPackageFromConfig(config) && !input.source && !input.package) {
        throw new Error("GSD package intent is not configured. Run `aof packages add gsd` first.");
      }
      const batch = await runFrameworkInstall(input.id, input);
      return {
        mode: input.dryRun ? "dry-run" : "installed",
        fromLock: false,
        batches: [batch],
        failed: batch.failed ?? [],
      };
    }

    const targetDir = path.resolve(input.target ?? process.cwd());
    const config = await loadProjectConfig(await findProjectConfig(targetDir, input.config));
    const installable = (config.packages ?? []).filter((pkg) => pkg.id === "gsd");
    if (installable.length === 0) {
      throw new Error("No installable packages are configured. Run `aof packages add gsd` first.");
    }
    const batches = [];
    const failed = [];
    for (const pkg of installable) {
      const batch = await runFrameworkInstall(pkg.id, input);
      batches.push(batch);
      if (batch.failed?.length > 0) {
        // The pre-migration loop threw at the first failed framework, never
        // reaching the rest — preserved as an early stop.
        failed.push(...batch.failed);
        break;
      }
    }
    return { mode: input.dryRun ? "dry-run" : "installed", fromLock: false, batches, failed };
  },

  cli: {
    route: ["packages", "install"],
    spec: {
      usage: "aof packages install [gsd] [--from-lock] [--claude] [--codex] [--global] [--dry-run] [--force] [--json]",
      workspace: false,
      flags: {
        ...RUNTIME_FLAGS,
        fromLock: { type: "boolean", description: "replay framework install intent from the lock" },
        dryRun: { type: "boolean", description: "preview installer commands without network or execution" },
        force: { type: "boolean", description: "re-run installers already recorded as successful" },
        global: { type: "boolean", description: "install with global scope" },
        target: { type: "string", description: "project directory (defaults to cwd)" },
        source: { type: "string", description: "override the configured package source" },
        package: { type: "string", description: "explicit package source (wins over --source)" },
      },
    },

    argv: (positionals, options) => ({
      id: positionals[0],
      fromLock: options.fromLock === true ? true : undefined,
      dryRun: options.dryRun === true ? true : undefined,
      force: options.force === true ? true : undefined,
      global: options.global === true ? true : undefined,
      target: options.target,
      config: options.config,
      source: options.source,
      package: options.package,
      claude: options.claude === true ? true : undefined,
      codex: options.codex === true ? true : undefined,
      runtime: options.runtime,
    }),

    render(result) {
      const lines = [];
      if (result.mode === "dry-run") {
        for (const batch of result.batches) {
          lines.push("dry-run: no network or installer commands will run");
          for (const item of batch.plan) {
            if (result.fromLock) {
              lines.push(item.command);
            } else {
              lines.push(item.skipped ? `skip: ${item.command} reason=${item.skipReason}` : item.command);
            }
          }
        }
        return lines.join("\n");
      }

      for (const batch of result.batches) {
        for (const item of batch.plan) {
          if (result.fromLock) {
            lines.push(`network-boundary: replaying ${item.command}`);
            lines.push(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
            lines.push("warning: this command may access the network and execute npm package code");
            continue;
          }
          if (item.skipped) {
            lines.push(`skip: ${item.runtime} ${item.skipReason}`);
            continue;
          }
          lines.push(`network-boundary: running ${item.command}`);
          lines.push(`package: ${item.packageSource} runtime=${item.runtime} scope=${item.scope}`);
          lines.push("warning: this command may access the network and execute npm package code");
        }
        if (!result.fromLock) {
          for (const attempt of batch.attempts ?? []) {
            lines.push(`attempt: ${attempt.runtime} status=${attempt.status} exit=${attempt.exitStatus}`);
          }
          for (const attempt of batch.failed ?? []) {
            lines.push(`retry: ${attempt.command}`);
          }
        }
      }
      if (result.failed.length > 0) {
        const verb = result.fromLock ? "replay" : "install";
        lines.push(`Framework ${verb} failed for ${result.failed.map((attempt) => attempt.runtime).join(", ")}.`);
      }
      return lines.join("\n");
    },

    json(result) {
      if (result.mode === "dry-run") {
        if (result.fromLock) {
          return { dryRun: true, fromLock: true, network: false, commands: result.batches[0].plan };
        }
        if (result.batches.length === 1) {
          return { dryRun: true, network: false, commands: result.batches[0].plan };
        }
        return {
          dryRun: true,
          network: false,
          batches: result.batches.map((batch) => ({ framework: batch.framework, commands: batch.plan })),
        };
      }
      return {
        installed: result.failed.length === 0,
        fromLock: result.fromLock,
        attempts: result.batches.flatMap((batch) => batch.attempts ?? []),
        failed: result.failed.map((attempt) => ({ runtime: attempt.runtime, command: attempt.command })),
      };
    },

    exit: (result) => (result.failed.length > 0 ? 1 : 0),
  },
};
