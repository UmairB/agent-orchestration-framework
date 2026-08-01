// planning:init — install the bought planner (pm-skills) and record pinned-sha
// provenance (m42 wave (d) leg d1; formerly cli.mjs's CLI-only
// planningInitCommand, a parseOptions face). Class A onto the route table.
//
// The core (src/planning-init.mjs) keeps every decision — plan, guards, sha
// gate, honesty gate, provenance write. The migration's one move is the
// collector idiom (the headroom precedent): the core's injectable `log`
// collects `notes`, so the render reproduces the retired transcript in order
// (boundary prints, dry-run preview, codex degrade + manual fallback) and the
// --json face stays the retired single document (notes never ride it — the
// retired face suppressed the log under --json).
//
// Documented normalisation with the migration (the packages:install /
// init-update precedent): the guarded / sha-rejected / install-failed refusal
// message now ENDS THE STDOUT DOCUMENT (render) instead of printing to stderr —
// cli.exit still gates 1 both faces, and the --json refusal document keeps its
// exact retired shape ({ guarded, shaRejected, installFailed, manifest, message }).
import path from "node:path";
import { initPlanning } from "../planning-init.mjs";
import { relativeDisplayPath } from "../render-plan.mjs";

function refused(result) {
  return Boolean(result.guarded || result.shaRejected || result.installFailed);
}

export const planningInitCommand = {
  id: "planning:init",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
      runtime: { type: "string" },
      scope: { type: "string" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
      withOptional: { type: "boolean" },
    },
    required: ["targetDir"],
    additionalProperties: false,
  },

  async run(input) {
    const notes = [];
    // Runtime/scope validation stays the core's (identical messages thrown from
    // initPlanning before any write — the retired face's pre-checks duplicated
    // them and are retired with it).
    const result = await initPlanning({
      targetDir: input.targetDir,
      runtime: input.runtime,
      scope: input.scope,
      dryRun: Boolean(input.dryRun),
      force: Boolean(input.force),
      withOptional: Boolean(input.withOptional),
      log: (line) => notes.push(line),
    });
    return { ...result, notes };
  },

  cli: {
    route: ["planning", "init"],
    spec: {
      usage: "aof planning init [dir] [--dry-run] [--with-optional] [--runtime claude|codex] [--scope user|project|local] [--force] [--json]",
      workspace: false,
      flags: {
        dryRun: { type: "boolean", description: "preview the runtime commands without running or writing anything" },
        force: { type: "boolean", description: "re-pin and re-install over an existing planning provenance section" },
        withOptional: { type: "boolean", description: "also install the optional pm-market-research plugin" },
        runtime: { type: "string", description: "target runtime (claude | codex; default claude)" },
        scope: { type: "string", description: "claude settings scope for the declarations (user | project | local; default project)" },
      },
    },

    argv: (positionals, options) => ({
      targetDir: path.resolve(positionals[0] ?? process.cwd()),
      ...(options.runtime !== undefined ? { runtime: options.runtime } : {}),
      ...(options.scope !== undefined ? { scope: options.scope } : {}),
      ...(options.dryRun ? { dryRun: true } : {}),
      ...(options.force ? { force: true } : {}),
      ...(options.withOptional ? { withOptional: true } : {}),
    }),

    render(result) {
      if (refused(result)) return [...result.notes, result.message].join("\n");
      if (result.dryRun) return result.notes.join("\n");
      const lines = [...result.notes, `Pinned the pm-skills marketplace at ${result.sha} for ${result.runtime}.`];
      if (result.runtime === "claude") {
        lines.push(`Installed ${result.manifest.plugins.length} planner plugin(s): ${result.manifest.plugins.map((entry) => entry.name).join(", ")}.`);
      } else {
        lines.push("Codex: marketplace registered; plugins NOT installed (see the manual fallback above).");
      }
      lines.push(`Manifest: ${relativeDisplayPath(result.manifestPath, result.targetDir)}`);
      return lines.join("\n");
    },

    json(result) {
      if (refused(result)) {
        return {
          guarded: Boolean(result.guarded),
          shaRejected: Boolean(result.shaRejected),
          installFailed: Boolean(result.installFailed),
          manifest: relativeDisplayPath(result.manifestPath, result.targetDir),
          message: result.message,
        };
      }
      return {
        targetDir: path.relative(process.cwd(), result.targetDir) || ".",
        runtime: result.runtime,
        dryRun: result.dryRun,
        sha: result.sha,
        plan: result.planCommands,
        codex: result.codex,
        manualFallback: result.manualFallback,
        manifest: result.manifestWritten ? relativeDisplayPath(result.manifestPath, result.targetDir) : null,
        plugins: result.manifest?.plugins ?? null,
      };
    },

    exit: (result) => (refused(result) ? 1 : 0),
  },
};
