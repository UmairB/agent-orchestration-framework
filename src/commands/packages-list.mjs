// packages:list — the first PACKAGES-family verb registered into the command
// core (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `packagesListCommand`: a registry Command dispatched by the route table
// through the ONE generic face, flag vocabulary declared on itself. Behaviour
// and output are byte-identical to the inline handler it replaces.
//
// Same recorded caveat as assets:list — this family's config resolution
// (findProjectConfig/workspacePaths, not loadWorkspace) is carried over as-is;
// unification is its own migration-plan step, never smuggled in here.
import path from "node:path";
import { loadProjectConfig } from "../dsl.mjs";
import { findProjectConfig, workspacePaths } from "../workspace.mjs";
import { readLock } from "../lock.mjs";
import { packageSummaries } from "../packages.mjs";

export const packagesListCommand = {
  id: "packages:list",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      config: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input) {
    const targetDir = path.resolve(input.target ?? process.cwd());
    const config = await loadProjectConfig(await findProjectConfig(targetDir, input.config));
    const paths = workspacePaths(targetDir);
    const lock = await readLock(paths.lockPath);
    return { packages: packageSummaries(config.packages ?? [], lock) };
  },

  cli: {
    route: ["packages", "list"],
    spec: {
      usage: "aof packages list [--target <dir>] [--json]",
      workspace: false,
      flags: {
        target: { type: "string", description: "project directory (defaults to cwd)" },
      },
    },

    argv: (positionals, options) => ({
      target: options.target,
      config: options.config,
    }),

    // Byte-identical to the retired inline handler's console.log lines.
    render(result) {
      const lines = [`packages: ${result.packages.length}`];
      for (const pkg of result.packages) {
        const attempts = pkg.installAttempts.length;
        lines.push(`- ${pkg.id} namespace=${pkg.namespace} source=${pkg.source} runtimes=${pkg.runtimes.join(",")} attempts=${attempts}`);
      }
      return lines.join("\n");
    },

    json: (result) => result,
  },
};
