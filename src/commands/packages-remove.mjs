// packages:remove — remove a declared package intent from the project config
// (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `packagesRemoveCommand`; byte-identical output. Runtime files and lock
// install attempts stay untouched by contract.
import path from "node:path";
import { readJson, writeText } from "../fs.mjs";
import { findProjectConfig } from "../workspace.mjs";

export const packagesRemoveCommand = {
  id: "packages:remove",
  input: {
    type: "object",
    properties: {
      packageId: { type: "string" },
      target: { type: "string" },
      config: { type: "string" },
      dryRun: { type: "boolean" },
    },
    required: ["packageId"],
    additionalProperties: false,
  },

  async run(input) {
    if (!input.packageId) throw new Error("Usage: aof packages remove <id> [--dry-run]");
    const targetDir = path.resolve(input.target ?? process.cwd());
    const configPath = await findProjectConfig(targetDir, input.config);
    const raw = await readJson(configPath);
    const packages = Array.isArray(raw.packages) ? raw.packages : [];
    if (!packages.some((item) => item?.id === input.packageId)) {
      throw new Error(`Package "${input.packageId}" is not configured.`);
    }
    const nextConfig = { ...raw, packages: packages.filter((item) => item?.id !== input.packageId) };

    if (input.dryRun) {
      return { dryRun: true, packageId: input.packageId, configPath };
    }

    await writeText(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
    return { dryRun: false, packageId: input.packageId, configPath };
  },

  cli: {
    route: ["packages", "remove"],
    spec: {
      usage: "aof packages remove <id> [--target <dir>] [--dry-run]",
      workspace: false,
      flags: {
        target: { type: "string", description: "project directory (defaults to cwd)" },
        dryRun: { type: "boolean", description: "preview the config change without writing" },
      },
    },

    argv: (positionals, options) => ({
      packageId: positionals[0],
      target: options.target,
      config: options.config,
      dryRun: options.dryRun === true ? true : undefined,
    }),

    render(result) {
      if (result.dryRun) {
        return [
          "dry-run: no config changes were written and no runtime files or lock attempts were removed",
          `remove-package: ${result.packageId}`,
          `write: ${result.configPath}`,
        ].join("\n");
      }
      return [
        `Updated ${result.configPath}`,
        `Removed package intent ${result.packageId}`,
        "Runtime files and lock install attempts were not removed.",
      ].join("\n");
    },

    json: (result) => result,
  },
};
