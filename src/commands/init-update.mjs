// work:init / work:update — render the ACD bundle into a repo, and re-render it
// drift-checked against the install manifest (m42 wave (d) leg d1, wave-3 tail;
// formerly cli.mjs's CLI-only workInitCommand / workUpdateCommand). Both ride
// the pure-outcome write-verb idiom: run() executes and returns the core's
// outcome (guarded / notInitialized / applied / dry-run), the render reproduces
// the retired transcript in order, cli.exit gates the refusals.
//
// Documented normalisation with the migration (the packages:install precedent):
// the guarded / not-initialised refusal message now ENDS THE STDOUT DOCUMENT
// (render) instead of printing to stderr — the exit still gates 1 both faces,
// and the --json refusal document keeps its exact retired shape
// ({ guarded|notInitialized, manifest, message }).
import path from "node:path";
import { initWork } from "../work-init.mjs";
// m43 / ADR-002 — the co-authored settings merge reports on the SAME envelope the
// plan does, so a refusal (`claude-settings-unparseable`) or a restored drift is
// visible on both faces rather than only in a log line.
import { formatClaudeSettingsOutcome } from "../claude-settings.mjs";
import { updateWork } from "../work-update.mjs";
import { formatFriendlyApplyAction, relativeDisplayPath } from "../render-plan.mjs";
import { RUNTIME_FLAGS, hasRuntimeOptions, parseRuntimes } from "../spine/flags.mjs";

// The retired reportNotInstallable, as render LINES (the collector form of the
// confine-console.log discipline): group by runtime, one line per group.
function notInstallableLines(notInstallable = []) {
  if (notInstallable.length === 0) return [];
  const byRuntime = new Map();
  for (const item of notInstallable) {
    const list = byRuntime.get(item.runtime) ?? [];
    list.push(item);
    byRuntime.set(item.runtime, list);
  }
  const lines = [];
  for (const [runtime, items] of byRuntime) {
    const kinds = [...new Set(items.map((item) => item.kind))].join(", ");
    lines.push(`Not installable on ${runtime} (${kinds}): ${items.map((item) => item.id).join(", ")} — unsupported by the capability matrix; not written.`);
  }
  return lines;
}

function actionLines(result) {
  return result.actions.map((item) => `  ${formatFriendlyApplyAction(item, { dryRun: result.dryRun, targetDir: result.targetDir })}`);
}

function jsonActions(result) {
  return result.actions.map((item) => ({ action: item.action, path: relativeDisplayPath(item.path, result.targetDir) }));
}

export const workInitCommand = {
  id: "work:init",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
      runtimes: { type: "array", items: { type: "string" } },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
      withHeadroom: { type: "boolean" },
    },
    required: ["targetDir", "runtimes"],
    additionalProperties: false,
  },

  async run(input) {
    const result = await initWork({
      targetDir: input.targetDir,
      runtimes: input.runtimes,
      dryRun: Boolean(input.dryRun),
      force: Boolean(input.force),
      withHeadroom: Boolean(input.withHeadroom),
    });
    return { ...result, targetDir: input.targetDir };
  },

  cli: {
    route: ["work", "init"],
    spec: {
      usage: "aof work init [dir] [--dry-run] [--runtime claude,codex] [--force] [--with-headroom] [--json]",
      workspace: false,
      flags: {
        ...RUNTIME_FLAGS,
        dryRun: { type: "boolean", description: "report what would be written without writing" },
        force: { type: "boolean", description: "overwrite a guarded prior install" },
        withHeadroom: { type: "boolean", description: "also enable the headroom plugin block" },
      },
    },

    argv: (positionals, options) => ({
      targetDir: path.resolve(positionals[0] ?? process.cwd()),
      // The retired face's default: claude unless runtime flags narrow the run
      // (work init never prompts — the top-level `aof init` is the interactive
      // spelling).
      runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : ["claude"],
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.force ? { force: true } : {}),
      ...(options.withHeadroom ? { withHeadroom: true } : {}),
    }),

    render(result) {
      if (result.guarded) return result.message;
      const lines = [];
      if (result.dryRun) lines.push("dry-run: the following files would be written (nothing written):");
      lines.push(...actionLines(result));
      lines.push(...notInstallableLines(result.notInstallable));
      if (!result.dryRun) {
        const { created, updated, skipped } = result.summary;
        const drift = result.summary["drift-warning"];
        const settingsLine = formatClaudeSettingsOutcome(result.claudeSettings, { targetDir: result.targetDir });
        if (settingsLine != null) lines.push(settingsLine);
        lines.push(`Initialised ACD: ${created} created, ${updated} updated, ${skipped} kept, ${drift} drift-warning.`);
        lines.push(`Manifest: ${relativeDisplayPath(result.manifestPath, result.targetDir)}`);
      }
      return lines.join("\n");
    },

    json(result) {
      if (result.guarded) {
        return { guarded: true, manifest: relativeDisplayPath(result.manifestPath, result.targetDir), message: result.message };
      }
      return {
        targetDir: path.relative(process.cwd(), result.targetDir) || ".",
        runtimes: result.runtimes,
        dryRun: result.dryRun,
        summary: result.summary,
        manifest: result.manifestWritten ? relativeDisplayPath(result.manifestPath, result.targetDir) : null,
        actions: jsonActions(result),
        notInstallable: result.notInstallable,
        claudeSettings: result.claudeSettings ?? null,
      };
    },

    exit: (result) => (result.guarded ? 1 : 0),
  },
};

export const workUpdateCommand = {
  id: "work:update",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
    },
    required: ["targetDir"],
    additionalProperties: false,
  },

  async run(input) {
    const result = await updateWork({
      targetDir: input.targetDir,
      dryRun: Boolean(input.dryRun),
      force: Boolean(input.force),
    });
    return { ...result, targetDir: input.targetDir };
  },

  cli: {
    route: ["work", "update"],
    spec: {
      usage: "aof work update [dir] [--dry-run] [--force] [--json]",
      workspace: false,
      flags: {
        dryRun: { type: "boolean", description: "report what would change without writing" },
        force: { type: "boolean", description: "re-render even without drift" },
      },
    },

    argv: (positionals, options) => ({
      targetDir: path.resolve(positionals[0] ?? process.cwd()),
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.force ? { force: true } : {}),
    }),

    render(result) {
      if (result.notInitialized) return result.message;
      const lines = [];
      if (result.dryRun) lines.push("dry-run: the following changes would be applied (nothing written):");
      lines.push(...actionLines(result));
      lines.push(...notInstallableLines(result.notInstallable));
      if (!result.dryRun) {
        const { created, updated, skipped, deleted } = result.summary;
        const drift = result.summary["drift-warning"];
        const settingsLine = formatClaudeSettingsOutcome(result.claudeSettings, { targetDir: result.targetDir });
        if (settingsLine != null) lines.push(settingsLine);
        lines.push(`Updated ACD: ${created} created, ${updated} updated, ${skipped} up-to-date, ${deleted} deleted, ${drift} drift-warning.`);
        lines.push(`Manifest: ${relativeDisplayPath(result.manifestPath, result.targetDir)}`);
      }
      return lines.join("\n");
    },

    json(result) {
      if (result.notInitialized) {
        return { notInitialized: true, manifest: relativeDisplayPath(result.manifestPath, result.targetDir), message: result.message };
      }
      return {
        targetDir: path.relative(process.cwd(), result.targetDir) || ".",
        runtimes: result.runtimes,
        dryRun: result.dryRun,
        summary: result.summary,
        manifest: result.manifestWritten ? relativeDisplayPath(result.manifestPath, result.targetDir) : null,
        actions: jsonActions(result),
        notInstallable: result.notInstallable,
        claudeSettings: result.claudeSettings ?? null,
      };
    },

    exit: (result) => (result.notInitialized ? 1 : 0),
  },
};
