// assets:show — inspect one declared source asset (m42 wave (d) leg d1).
// Class-A migration of cli.mjs's inline `assetsShowCommand`; byte-identical
// output, flag vocabulary declared on the command.
import path from "node:path";
import { access } from "node:fs/promises";
import { readJson } from "../fs.mjs";
import { globalWorkspacePaths, workspacePaths } from "../workspace.mjs";
import { supportedRuntimes } from "../adapters.mjs";

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export const assetsShowCommand = {
  id: "assets:show",
  input: {
    type: "object",
    properties: {
      kind: { type: "string" },
      id: { type: "string" },
      target: { type: "string" },
      global: { type: "boolean" },
    },
    required: ["kind", "id"],
    additionalProperties: false,
  },

  async run(input) {
    const { kind, id } = input;
    if (!kind || !id) {
      throw new Error("Usage: aof assets show [--global] <kind> <id> [--json]");
    }

    const paths = input.global ? globalWorkspacePaths() : workspacePaths(path.resolve(input.target ?? process.cwd()));
    if (!(await exists(paths.configPath))) {
      const command = input.global ? "aof assets add --global <kind> <id>" : "aof assets add <kind> <id>";
      throw new Error(`Config not found at ${paths.configPath}. Run ${command} first.`);
    }

    const raw = await readJson(paths.configPath);
    const resource = (raw.resources ?? []).find((item) => item.kind === kind && item.id === id);
    if (!resource) {
      throw new Error(`Resource not found: ${kind}:${id}`);
    }

    const sourcePath = resource.path ? path.resolve(path.dirname(paths.configPath), resource.path) : null;
    const bodyExists = sourcePath ? await exists(sourcePath) : Boolean(resource.body || resource.prompt || resource.instructions);
    return {
      scope: input.global ? "global" : "project",
      configPath: paths.configPath,
      resource: { ...resource, sourcePath, bodyExists },
    };
  },

  cli: {
    route: ["assets", "show"],
    spec: {
      usage: "aof assets show [--global] <kind> <id> [--json]",
      workspace: false,
      flags: {
        global: { type: "boolean", description: "inspect the global config instead of the project" },
        target: { type: "string", description: "project directory (defaults to cwd)" },
      },
    },

    argv: (positionals, options) => ({
      kind: positionals[0],
      id: positionals[1],
      target: options.target,
      global: options.global === true ? true : undefined,
    }),

    render(result) {
      const { resource } = result;
      const lines = [`${result.scope}: ${result.configPath}`];
      lines.push(`resource: ${resource.kind}:${resource.id}`);
      if (resource.name) lines.push(`name: ${resource.name}`);
      if (resource.description) lines.push(`description: ${resource.description}`);
      lines.push(`runtimes: ${(resource.runtimes ?? supportedRuntimes()).join(",")}`);
      if (resource.sourcePath) lines.push(`path: ${resource.sourcePath}`);
      lines.push(`body: ${resource.bodyExists ? "present" : "missing"}`);
      return lines.join("\n");
    },

    // The retired handler's --json payload was { configPath, resource } — the
    // scope key is a render affordance, not part of the wire.
    json: (result) => ({ configPath: result.configPath, resource: result.resource }),
  },
};
