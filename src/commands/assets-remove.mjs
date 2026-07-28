// assets:remove — remove a declared source asset + its source folder (m42
// wave (d) leg d1). Class-A migration of cli.mjs's inline `assetsRemoveCommand`;
// byte-identical output. Generated runtime outputs stay untouched by contract —
// that is assets:clean's job.
import path from "node:path";
import { access, rm } from "node:fs/promises";
import { readJson, writeText } from "../fs.mjs";
import { globalWorkspacePaths, workspacePaths } from "../workspace.mjs";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const assetsRemoveCommand = {
  id: "assets:remove",
  input: {
    type: "object",
    properties: {
      kind: { type: "string" },
      id: { type: "string" },
      target: { type: "string" },
      global: { type: "boolean" },
      dryRun: { type: "boolean" },
      force: { type: "boolean" },
    },
    required: ["kind", "id"],
    additionalProperties: false,
  },

  async run(input) {
    const { kind, id } = input;
    if (!kind || !id) {
      throw new Error("Usage: aof assets remove [--global] <kind> <id> [--dry-run] [--force]");
    }

    const paths = input.global ? globalWorkspacePaths() : workspacePaths(path.resolve(input.target ?? process.cwd()));
    if (!(await exists(paths.configPath))) {
      throw new Error(`Config not found at ${paths.configPath}.`);
    }

    const raw = await readJson(paths.configPath);
    const resources = Array.isArray(raw.resources) ? raw.resources : [];
    const index = resources.findIndex((resource) => resource.kind === kind && resource.id === id);
    if (index < 0) {
      throw new Error(`Resource not found: ${kind}:${id}`);
    }

    const resource = resources[index];
    const sourcePath = resource.path ? path.resolve(path.dirname(paths.configPath), resource.path) : null;
    const assetDir = sourcePath ? path.dirname(sourcePath) : null;
    const config = {
      ...raw,
      resources: resources.filter((_resource, resourceIndex) => resourceIndex !== index),
    };

    if (input.dryRun) {
      return { dryRun: true, assetDir, configPath: paths.configPath };
    }

    if (assetDir) await rm(assetDir, { recursive: true, force: true });
    await writeText(paths.configPath, `${JSON.stringify(config, null, 2)}\n`);
    return { dryRun: false, assetDir, configPath: paths.configPath };
  },

  cli: {
    route: ["assets", "remove"],
    spec: {
      usage: "aof assets remove [--global] <kind> <id> [--dry-run] [--force]",
      workspace: false,
      flags: {
        global: { type: "boolean", description: "remove from the global config instead of the project" },
        target: { type: "string", description: "project directory (defaults to cwd)" },
        dryRun: { type: "boolean", description: "preview the removal without changing anything" },
        force: { type: "boolean", description: "accepted for compatibility" },
      },
    },

    argv: (positionals, options) => ({
      kind: positionals[0],
      id: positionals[1],
      target: options.target,
      global: options.global === true ? true : undefined,
      dryRun: options.dryRun === true ? true : undefined,
      force: options.force === true ? true : undefined,
    }),

    render(result) {
      const lines = [];
      if (result.dryRun) {
        if (result.assetDir) lines.push(`delete: ${result.assetDir}`);
        lines.push(`write: ${result.configPath}`);
        lines.push("dry-run: no source assets or config files were changed");
        return lines.join("\n");
      }
      if (result.assetDir) lines.push(`Deleted ${result.assetDir}`);
      lines.push(`Updated ${result.configPath}`);
      lines.push("Generated runtime outputs were not removed. Run `aof assets clean` to remove lock-owned generated files.");
      return lines.join("\n");
    },

    json: (result) => result,
  },
};
