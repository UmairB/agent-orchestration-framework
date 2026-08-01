// assets:apply — render source assets into runtime outputs + write the lock
// (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `assetsApplyCommand` — the wave-1 tail's first big flow. run() returns a
// mode-discriminated outcome (validation-failed / dry-run / strict-failed /
// applied); the render reproduces the retired handler's console.log lines
// byte-for-byte and in the same order (side effects now complete before the
// document prints — the write-verb idiom every migrated mutator follows). The
// --install/--global refusals stay THROWN so their guidance reaches stderr
// unchanged; strict/validation failures ride the cli.exit adapter.
import path from "node:path";
import { readJson } from "../fs.mjs";
import { supportedRuntimes } from "../adapters.mjs";
import { loadProjectConfig } from "../dsl.mjs";
import { findProjectConfig, workspacePaths } from "../workspace.mjs";
import { validateConfig } from "../config-inspect.mjs";
import { collectAdapterWarnings } from "../adapter-warnings.mjs";
import { readLock, writeLock } from "../lock.mjs";
import {
  createLockManifest,
  createRenderPlan,
  executeApplyActions,
  formatApplyAction,
  formatFriendlyApplyAction,
  planApplyActions,
  relativeDisplayPath,
  successMarker,
  summarizeLockManifest,
} from "../render-plan.mjs";
import { RUNTIME_FLAGS, hasRuntimeOptions, parseRuntimes } from "../spine/flags.mjs";
import { adapterWarningLines, renderValidationReport } from "./validate-shared.mjs";

// Runtime resolution for apply (moved from cli.mjs with the migration): flags
// win; else the config's own runtimes list; else every supported runtime.
async function runtimesForApply(configPath, input) {
  if (hasRuntimeOptions(input)) return parseRuntimes(input);
  const raw = await readJson(configPath);
  if (Array.isArray(raw.runtimes) && raw.runtimes.length > 0) {
    return [...new Set(raw.runtimes)];
  }
  return supportedRuntimes();
}

export const assetsApplyCommand = {
  id: "assets:apply",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      config: { type: "string" },
      claude: { type: "boolean" },
      codex: { type: "boolean" },
      runtime: { type: "string" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
      strict: { type: "boolean" },
      verbose: { type: "boolean" },
      install: { type: "boolean" },
      global: { type: "boolean" },
    },
    additionalProperties: false,
  },

  async run(input) {
    if (input.install === true) {
      throw new Error("aof assets apply does not run package installers. Use `aof packages install ...` for package execution.");
    }
    if (input.global === true) {
      throw new Error("aof assets apply does not support global runtime output. Reference global source assets with `aof assets use --global ...`, then run `aof assets apply`.");
    }

    const targetDir = path.resolve(input.target ?? process.cwd());
    const configPath = await findProjectConfig(targetDir, input.config);
    const paths = workspacePaths(targetDir);
    const runtimes = await runtimesForApply(configPath, input);
    const strict = input.strict === true;

    const validationDiagnostics = await validateConfig(targetDir, { config: input.config });
    const validationErrors = validationDiagnostics.filter((item) => item.severity === "error");
    if (validationErrors.length > 0) {
      const validationWarnings = validationDiagnostics.filter((item) => item.severity === "warning");
      return {
        mode: "validation-failed",
        report: {
          valid: false,
          strict,
          errors: validationErrors.length,
          warnings: validationWarnings.length,
          diagnostics: validationDiagnostics,
        },
      };
    }

    const config = await loadProjectConfig(configPath);
    const adapterWarnings = collectAdapterWarnings(config, {
      targetDir,
      runtimes,
      global: Boolean(input.global),
    });
    const desiredOutputs = await createRenderPlan(config, {
      targetDir,
      runtimes,
      global: Boolean(input.global),
    });
    const previousLock = await readLock(paths.lockPath);
    const actions = await planApplyActions(desiredOutputs, previousLock, {
      targetDir,
      force: Boolean(input.force),
    });
    const manifest = createLockManifest({
      actions,
      desiredOutputs,
      previousLock,
      config,
      runtimes,
      global: Boolean(input.global),
    });

    const strictFailed = strict && adapterWarnings.length > 0;
    const lockDisplay = relativeDisplayPath(paths.lockPath, targetDir);
    const base = { strict, adapterWarnings, actions, lockDisplay, targetDir, verbose: input.verbose === true };

    if (input.dryRun) {
      return { mode: "dry-run", ...base, strictFailed, lockPreview: summarizeLockManifest(manifest) };
    }
    if (strictFailed) {
      // Strict warnings block the apply BEFORE any write — the pre-migration
      // contract (adapter-policy.feature pins that no file or lock appears).
      return { mode: "strict-failed", ...base };
    }

    await executeApplyActions(actions);
    await writeLock(paths.lockPath, manifest);
    return { mode: "applied", ...base };
  },

  cli: {
    route: ["assets", "apply"],
    spec: {
      usage: "aof assets apply [--config aof.config.json] [--target dir] [--claude] [--codex] [--dry-run] [--force] [--strict]",
      workspace: false,
      flags: {
        ...RUNTIME_FLAGS,
        target: { type: "string", description: "project directory (defaults to cwd)" },
        dryRun: { type: "boolean", description: "preview actions without writing files or lock state" },
        force: { type: "boolean", description: "overwrite drift-modified outputs" },
        strict: { type: "boolean", description: "treat adapter warnings as failures" },
        verbose: { type: "boolean", description: "print full action detail lines" },
        // Parsed only to refuse with the historical guidance (a bare
        // unknown-flag error would lose the `aof packages install` redirect).
        install: { type: "boolean", description: "not supported — use `aof packages install`" },
        global: { type: "boolean", description: "not supported — use `aof assets use --global`" },
      },
    },

    argv: (positionals, options) => ({
      target: options.target,
      config: options.config,
      claude: options.claude === true ? true : undefined,
      codex: options.codex === true ? true : undefined,
      runtime: options.runtime,
      dryRun: options.dryRun === true ? true : undefined,
      force: options.force === true ? true : undefined,
      strict: options.strict === true ? true : undefined,
      verbose: options.verbose === true ? true : undefined,
      install: options.install === true ? true : undefined,
      global: options.global === true ? true : undefined,
    }),

    render(result) {
      if (result.mode === "validation-failed") {
        return renderValidationReport(result.report, "config passed validation");
      }

      if (result.mode === "dry-run") {
        const lines = ["dry-run: no files or lock state were written", ...adapterWarningLines(result.adapterWarnings)];
        if (result.strictFailed) {
          lines.push(`strict: ${result.adapterWarnings.length} adapter warning(s) treated as failure`);
          return lines.join("\n");
        }
        if (result.actions.length > 0) lines.push("Planned asset changes");
        for (const item of result.actions) {
          lines.push(result.verbose ? formatApplyAction(item) : formatFriendlyApplyAction(item, { dryRun: true }));
        }
        const summary = result.lockPreview;
        lines.push(`Would update ${result.lockDisplay} (${summary.files} file${summary.files === 1 ? "" : "s"}, ${summary.frameworks} framework intent${summary.frameworks === 1 ? "" : "s"})`);
        return lines.join("\n");
      }

      if (result.mode === "strict-failed") {
        return [
          ...adapterWarningLines(result.adapterWarnings),
          `strict: ${result.adapterWarnings.length} adapter warning(s) treated as failure`,
        ].join("\n");
      }

      const lines = [...adapterWarningLines(result.adapterWarnings)];
      if (result.actions.length > 0) lines.push("Applied assets");
      for (const item of result.actions) {
        lines.push(result.verbose ? formatApplyAction(item) : formatFriendlyApplyAction(item, { targetDir: result.targetDir }));
      }
      lines.push(`${successMarker()} Updated ${result.lockDisplay}`);
      return lines.join("\n");
    },

    json(result) {
      if (result.mode === "validation-failed") return result.report;
      if (result.mode === "dry-run") {
        return {
          dryRun: true,
          strict: result.strict,
          adapterWarnings: result.adapterWarnings,
          actions: result.actions,
          lockPreview: result.lockPreview,
        };
      }
      if (result.mode === "strict-failed") {
        return { applied: false, strict: true, adapterWarnings: result.adapterWarnings };
      }
      return {
        applied: true,
        strict: result.strict,
        adapterWarnings: result.adapterWarnings,
        actions: result.actions,
        lock: result.lockDisplay,
      };
    },

    exit: (result) => (result.mode === "validation-failed" || result.mode === "strict-failed" || result.strictFailed === true ? 1 : 0),
  },
};
