// packages:add — declare GSD package intent in the project config (m42 wave (d)
// leg d1). Class-A migration of cli.mjs's inline `packagesAddCommand` (its
// packageIntentFromOptions/packageForConfig helpers folded in — runtime
// selection resolves in the argv adapter, the face's domain). Byte-identical
// output.
import path from "node:path";
import { readJson, writeText } from "../fs.mjs";
import { findProjectConfig } from "../workspace.mjs";
import { normalizePackage } from "../packages.mjs";
import { hasRuntimeOptions, parseRuntimes, RUNTIME_FLAGS } from "../spine/flags.mjs";
import { supportedRuntimes } from "../adapters.mjs";

export const packagesAddCommand = {
  id: "packages:add",
  input: {
    type: "object",
    properties: {
      packageId: { type: "string" },
      target: { type: "string" },
      config: { type: "string" },
      source: { type: "string" },
      package: { type: "string" },
      runtimes: { type: "array", items: { type: "string" } },
      dryRun: { type: "boolean" },
    },
    required: ["packageId"],
    additionalProperties: false,
  },

  async run(input) {
    if (input.packageId !== "gsd") {
      throw new Error("Usage: aof packages add gsd [--codex] [--claude] [--runtime list] [--source source] [--package npm-package] [--dry-run]");
    }

    const targetDir = path.resolve(input.target ?? process.cwd());
    const configPath = await findProjectConfig(targetDir, input.config);
    const raw = await readJson(configPath);
    const source = input.source ?? (input.package ? `npm:${input.package}` : "npm:get-shit-done-cc@latest");
    const runtimes = input.runtimes
      ?? (Array.isArray(raw.runtimes) && raw.runtimes.length > 0 ? [...new Set(raw.runtimes)] : supportedRuntimes());
    const pkg = normalizePackage({ id: "gsd", namespace: "gsd", source, runtimes }, 0);
    const packages = [
      ...(Array.isArray(raw.packages) ? raw.packages.filter((item) => item?.id !== "gsd") : []),
      { id: pkg.id, namespace: pkg.namespace, source: pkg.source, runtimes: pkg.runtimes },
    ];
    const nextConfig = { ...raw, packages };

    if (input.dryRun) {
      return { dryRun: true, configPath, source: pkg.source, runtimes: pkg.runtimes };
    }

    await writeText(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`);
    return { dryRun: false, configPath, source: pkg.source, runtimes: pkg.runtimes };
  },

  cli: {
    route: ["packages", "add"],
    spec: {
      usage: "aof packages add gsd [--codex] [--claude] [--runtime list] [--source source] [--package npm-package] [--dry-run]",
      workspace: false,
      flags: {
        target: { type: "string", description: "project directory (defaults to cwd)" },
        source: { type: "string", description: "explicit package source (npm:/git:/file:)" },
        package: { type: "string", description: "npm package shorthand (npm:<name>)" },
        dryRun: { type: "boolean", description: "preview the config change without writing" },
        ...RUNTIME_FLAGS,
      },
    },

    argv: (positionals, options) => ({
      packageId: positionals[0],
      target: options.target,
      config: options.config,
      source: options.source,
      package: options.package,
      runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : undefined,
      dryRun: options.dryRun === true ? true : undefined,
    }),

    render(result) {
      if (result.dryRun) {
        return [
          "dry-run: no config changes were written and no installer code ran",
          `write: ${result.configPath}`,
          `package: gsd source=${result.source} runtimes=${result.runtimes.join(",")}`,
        ].join("\n");
      }
      return [
        `Updated ${result.configPath}`,
        `package: gsd source=${result.source} runtimes=${result.runtimes.join(",")}`,
        "Next: run `aof packages install gsd --dry-run` to preview installer commands.",
      ].join("\n");
    },

    json: (result) => result,
  },
};
