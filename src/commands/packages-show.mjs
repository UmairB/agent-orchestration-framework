// packages:show — inspect one declared package intent + its install attempts
// (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `packagesShowCommand`; byte-identical output.
import path from "node:path";
import { loadProjectConfig } from "../dsl.mjs";
import { findProjectConfig, workspacePaths } from "../workspace.mjs";
import { readLock } from "../lock.mjs";
import { packageSummaries } from "../packages.mjs";

export const packagesShowCommand = {
  id: "packages:show",
  input: {
    type: "object",
    properties: {
      packageId: { type: "string" },
      target: { type: "string" },
      config: { type: "string" },
    },
    required: ["packageId"],
    additionalProperties: false,
  },

  async run(input) {
    if (!input.packageId) throw new Error("Usage: aof packages show <id> [--json]");
    const targetDir = path.resolve(input.target ?? process.cwd());
    const config = await loadProjectConfig(await findProjectConfig(targetDir, input.config));
    const paths = workspacePaths(targetDir);
    const lock = await readLock(paths.lockPath);
    const pkg = packageSummaries(config.packages ?? [], lock).find((item) => item.id === input.packageId);
    if (!pkg) throw new Error(`Package "${input.packageId}" is not configured. Run \`aof packages add gsd\` to declare GSD package intent.`);
    return pkg;
  },

  cli: {
    route: ["packages", "show"],
    spec: {
      usage: "aof packages show <id> [--target <dir>] [--json]",
      workspace: false,
      flags: {
        target: { type: "string", description: "project directory (defaults to cwd)" },
      },
    },

    argv: (positionals, options) => ({
      packageId: positionals[0],
      target: options.target,
      config: options.config,
    }),

    render(pkg) {
      const lines = [
        `package: ${pkg.id}`,
        `namespace: ${pkg.namespace}`,
        `source: ${pkg.source}`,
        `runtimes: ${pkg.runtimes.join(",")}`,
        `installAttempts: ${pkg.installAttempts.length}`,
      ];
      for (const attempt of pkg.installAttempts) {
        lines.push(`- ${attempt.runtime} status=${attempt.status} scope=${attempt.scope}`);
      }
      return lines.join("\n");
    },

    json: (pkg) => pkg,
  },
};
