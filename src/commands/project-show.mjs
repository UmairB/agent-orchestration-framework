// project:show — the PROJECT-family inspection verb registered into the command
// core (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `projectShowCommand`: a registry Command dispatched by the route table
// through the ONE generic face. It joins project:provision under the project:*
// prefix. Behaviour and output are byte-identical to the inline handler it
// replaces (the run is a thin seam over config-inspect.mjs's inspectConfig).
import path from "node:path";
import { inspectConfig } from "../config-inspect.mjs";

export const projectShowCommand = {
  id: "project:show",
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
    return await inspectConfig(targetDir, { config: input.config });
  },

  cli: {
    route: ["project", "show"],
    spec: {
      usage: "aof project show [--target <dir>] [--json]",
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
      const lines = [`config: ${result.configPath}`];
      lines.push(`name: ${result.name ?? "(unresolved)"}`);
      lines.push(`resources: ${result.resources.length}`);
      for (const resource of result.resources) {
        lines.push(`- ${resource.kind}:${resource.id} source=${resource.source ?? "local"} runtimes=${resource.runtimes.join(",")}`);
      }
      lines.push(`globalRefs: ${result.globalRefs.length}`);
      for (const ref of result.globalRefs) {
        lines.push(`- global:${ref.kind}:${ref.id}`);
      }
      lines.push(`packages: ${result.packages.length}`);
      for (const pkg of result.packages) {
        lines.push(`- ${pkg.id} source=${pkg.source} runtimes=${(pkg.runtimes ?? []).join(",")}`);
      }
      if (result.legacyConfigIsStale) {
        lines.push(`warning: root aof.config.json is legacy; ${result.configPath} is authoritative`);
      }
      return lines.join("\n");
    },

    json: (result) => result,
  },
};
