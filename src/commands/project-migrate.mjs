// project:migrate — the LEGACY config-format migration (root aof.config.json →
// .aof/aof.config.json) registered into the command core (m42 wave (d) leg d1).
// Class-A migration of cli.mjs's inline `projectMigrateCommand` (renamed from
// `migrateCommand` when story 29 reclaimed the top-level verb). Byte-identical
// output. NOTE (recorded in the wave-(d) plan): this write bypasses writeLock's
// read-merge — that defect is d4's writeLock cascade port, NOT smuggled into
// this mechanical registration.
import path from "node:path";
import { access } from "node:fs/promises";
import { loadConfig } from "../dsl.mjs";
import { readJson, writeText } from "../fs.mjs";
import { workspacePaths, legacyConfigPath } from "../workspace.mjs";
import { writeWorkspaceConfig } from "../workspace-writer.mjs";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const projectMigrateCommand = {
  id: "project:migrate",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
    },
    additionalProperties: false,
  },

  async run(input) {
    const targetDir = path.resolve(input.target ?? process.cwd());
    const paths = workspacePaths(targetDir);
    const sourcePath = legacyConfigPath(targetDir);

    if (!(await exists(sourcePath))) {
      throw new Error(`No legacy config found at ${sourcePath}.`);
    }

    if (!input.force && (await exists(paths.configPath))) {
      throw new Error(`AOF workspace config already exists at ${paths.configPath}. Re-run with --force to replace it.`);
    }

    const legacyConfig = await readJson(sourcePath);
    const resolved = await loadConfig(sourcePath);
    if (input.dryRun) {
      return { dryRun: true, configPath: paths.configPath, lockPath: paths.lockPath };
    }

    await writeWorkspaceConfig(targetDir, {
      ...resolved,
      $schema: "https://aof.local/schemas/aof.schema.json",
      name: legacyConfig.name ?? resolved.name,
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
        runtimes: resource.runtimes,
      })),
    }, null, 2)}\n`);

    return { dryRun: false, configPath: paths.configPath, lockPath: paths.lockPath };
  },

  cli: {
    route: ["project", "migrate"],
    spec: {
      usage: "aof project migrate [dir] [--target <dir>] [--dry-run] [--force] [--json]",
      workspace: false,
      flags: {
        target: { type: "string", description: "project directory (defaults to positional or cwd)" },
        dryRun: { type: "boolean", description: "preview the writes without changing anything" },
        force: { type: "boolean", description: "replace an existing workspace config" },
      },
    },

    // The retired handler accepted the directory as `--target` OR the first
    // positional (`aof project migrate [dir]`).
    argv: (positionals, options) => ({
      target: options.target ?? positionals[0],
      dryRun: options.dryRun === true ? true : undefined,
      force: options.force === true ? true : undefined,
    }),

    render(result) {
      if (result.dryRun) {
        return [`write: ${result.configPath}`, `write: ${result.lockPath}`].join("\n");
      }
      return [
        `Created ${result.configPath}`,
        `${result.configPath} is now authoritative; root aof.config.json is legacy and was left untouched.`,
      ].join("\n");
    },

    json: (result) => result,
  },
};
