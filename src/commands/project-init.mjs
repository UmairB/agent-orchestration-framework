// project:init — the top-level `aof init`: scaffold an empty project .aof
// workspace for the selected coding assistants (m42 wave (d) leg d1; formerly
// cli.mjs's inline initCommand + guideAfterInit + writeInstallLock, the last
// interactive face on parseOptions). Class A onto the route table, riding the
// one-word route (the migrate:folder precedent).
//
// The INTERACTIVE half (selecting runtimes when no runtime flag was given)
// lives in the async cli.argv adapter (the assets:add precedent): prompting is
// a face concern, run() stays headless. The guards (existing config / legacy
// config) stay decisions in run() — they refuse with the retired messages,
// now coded; note the runtime prompt therefore fires BEFORE the guard on an
// interactive re-init (the retired face refused first).
//
// NOTE (d4): init still writes the lock wholesale (writeInstallLock) — the
// writeLock read-merge adoption is the d4 item, deliberately untouched here.
import path from "node:path";
import { existsSync } from "node:fs";
import { writeText } from "../fs.mjs";
import { writeWorkspaceConfig } from "../workspace-writer.mjs";
import { selectRuntimes } from "../prompt.mjs";
import { isLegacyConfigOnlyProject, legacyConfigPath, workspacePaths } from "../workspace.mjs";
import { RUNTIME_FLAGS, hasRuntimeOptions, parseRuntimes } from "../spine/flags.mjs";
import { commandError } from "../command-error.mjs";

// The retired writeInstallLock, verbatim: init seeds an empty items lock for
// the selected runtimes (catalog remains null — the catalog era is over).
async function writeInstallLock(targetDir, runtimes) {
  const lockPath = workspacePaths(targetDir).lockPath;
  const lock = {
    version: 1,
    generatedAt: new Date().toISOString(),
    catalog: null,
    runtimes,
    items: [],
  };
  await writeText(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

export const projectInitCommand = {
  id: "project:init",
  input: {
    type: "object",
    properties: {
      targetDir: { type: "string" },
      runtimes: { type: "array", items: { type: "string" } },
      force: { type: "boolean" },
      dryRun: { type: "boolean" },
    },
    required: ["targetDir", "runtimes"],
    additionalProperties: false,
  },

  async run(input) {
    const targetDir = input.targetDir;
    const paths = workspacePaths(targetDir);

    if (!input.force && existsSync(paths.configPath)) {
      throw commandError(`Config already exists at ${paths.configPath}. Re-run with --force to replace it.`, "config-exists", 400);
    }
    if (!input.force && await isLegacyConfigOnlyProject(targetDir)) {
      throw commandError(`Legacy config already exists at ${legacyConfigPath(targetDir)}. Run aof project migrate to create .aof/ explicitly.`, "legacy-config", 400);
    }

    if (input.dryRun) {
      return { dryRun: true, configPath: paths.configPath, lockPath: paths.lockPath, runtimes: input.runtimes };
    }

    await writeWorkspaceConfig(targetDir, {
      name: path.basename(targetDir),
      resources: [],
      globalRefs: [],
      packages: [],
      $schema: "https://aof.local/schemas/aof.schema.json",
      runtimes: input.runtimes,
    });
    await writeInstallLock(targetDir, input.runtimes);
    return { dryRun: false, configPath: paths.configPath, lockPath: paths.lockPath, runtimes: input.runtimes };
  },

  cli: {
    route: ["init"],
    spec: {
      usage: "aof init [dir] [--claude] [--codex] [--runtime claude,codex] [--force] [--dry-run] [--json]",
      workspace: false,
      flags: {
        ...RUNTIME_FLAGS,
        target: { type: "string", description: "project directory (default: cwd; a bare positional dir also works)" },
        force: { type: "boolean", description: "replace an existing config" },
        dryRun: { type: "boolean", description: "report what would be written without writing" },
        // The catalog-era spellings, declared ONLY so their refusal stays the
        // helpful retired message rather than a bare unknown-flag error.
        items: { type: "string", description: "removed — catalog-backed init items are not available" },
        defaults: { type: "boolean", description: "removed — catalog-backed init items are not available" },
        select: { type: "boolean", description: "removed — catalog-backed init items are not available" },
      },
    },

    // ASYNC by design: with no runtime flag the runtimes complete interactively
    // (the AOF_TEST_RUNTIMES_INPUT seam or the TTY checkbox), never inside run().
    async argv(positionals, options) {
      if (options.items || options.defaults || options.select) {
        throw commandError(
          "Catalog-backed init items are not available yet. Use `aof assets add ...` for project assets or `aof assets add --global ...` for reusable global assets.",
          "invalid-input",
          400,
        );
      }
      const targetDir = path.resolve(options.target ?? positionals[0] ?? process.cwd());
      const input = {
        targetDir,
        ...(options.force ? { force: true } : {}),
        ...(options.dryRun ? { dryRun: true } : {}),
      };
      if (hasRuntimeOptions(options)) return { ...input, runtimes: parseRuntimes(options) };
      // The retired guard-before-prompt order: when run() is going to refuse
      // anyway (config already present and no --force), don't open the
      // interactive picker — pass empty runtimes and let run()'s AUTHORITATIVE
      // guard throw. This peek is a face-side convenience only; the decision
      // stays in run(), which every other face reaches headlessly.
      if (!options.force && (existsSync(workspacePaths(targetDir).configPath) || await isLegacyConfigOnlyProject(targetDir))) {
        return { ...input, runtimes: [] };
      }
      return { ...input, runtimes: await selectRuntimes() };
    },

    render(result) {
      if (result.dryRun) {
        return [`write: ${result.configPath}`, `write: ${result.lockPath}`, "dry-run: no files written"].join("\n");
      }
      return [
        `Created ${result.configPath}`,
        "Next steps:",
        "- Add project assets with `aof assets add skill`.",
        "- Add reusable global assets with `aof assets add --global skill`.",
        "- Add managed packages with `aof packages add gsd`.",
        "- Validate this project with `aof project validate`.",
        "- Render outputs with `aof assets apply --dry-run` then `aof assets apply`.",
        "- Edit assets in the setup UI with `aof assets ui`.",
      ].join("\n");
    },

    json: (result) => result,
  },
};
