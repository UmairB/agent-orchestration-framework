// assets:list — the first ASSETS-family verb registered into the command core
// (m42 wave (d) leg d1; PRD-command-spine-effects-ledger). Class-A migration:
// this was the inline `assetsListCommand` handler in cli.mjs — now a registry
// Command dispatched by the route table through the ONE generic face, with its
// flag vocabulary declared on itself (retiring its share of parseOptions'
// boolean allow-list). Behaviour and output are byte-identical to the inline
// handler it replaces.
//
// NOTE (deliberate, recorded in the wave-(d) migration plan): the assets/
// packages family resolves config via inspectConfig/workspacePaths, NOT
// loadWorkspace — the PRD names that duplication a d1-scope cleanup, but
// unifying resolution is a behaviour change and lands as its own step, not
// smuggled into the mechanical registration. `spec.workspace: false` keeps the
// face from loading a workspace this command never used.
import path from "node:path";
import { inspectConfig, inspectGlobalConfig } from "../config-inspect.mjs";

export const assetsListCommand = {
  id: "assets:list",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      global: { type: "boolean" },
      config: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input) {
    const targetDir = path.resolve(input.target ?? process.cwd());
    const inspection = input.global
      ? await inspectGlobalConfig()
      : await inspectConfig(targetDir, { config: input.config });
    return {
      scope: input.global ? "global" : "project",
      configPath: inspection.configPath,
      resources: inspection.resources,
    };
  },

  cli: {
    route: ["assets", "list"],
    spec: {
      usage: "aof assets list [--global] [--target <dir>] [--json]",
      workspace: false,
      flags: {
        global: { type: "boolean", description: "inspect the global config instead of the project" },
        target: { type: "string", description: "project directory (defaults to cwd)" },
      },
    },

    argv: (positionals, options) => ({
      target: options.target,
      global: options.global === true ? true : undefined,
      config: options.config,
    }),

    // Byte-identical to the retired inline handler's console.log lines.
    render(result) {
      const lines = [`${result.scope}: ${result.configPath}`];
      lines.push(`resources: ${result.resources.length}`);
      for (const resource of result.resources) {
        lines.push(`- ${resource.kind}:${resource.id} runtimes=${resource.runtimes.join(",")}`);
      }
      return lines.join("\n");
    },

    json: (result) => result,
  },
};
