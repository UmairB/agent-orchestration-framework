// assets:use / assets:unuse — add/remove a project's reference to a GLOBAL
// source asset (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `assetsUseCommand`/`assetsUnuseCommand`/`assetsGlobalRefCommand` — the
// mesh-identity precedent: two registered commands over ONE shared runner in
// one file. Byte-identical output; the diagnostics-failure exit rides the
// face's cli.exit adapter.
import path from "node:path";
import { addProjectGlobalRef, removeProjectGlobalRef } from "../config-editor.mjs";
import { workspacePaths } from "../workspace.mjs";

function globalRefCommand(action) {
  const update = action === "use" ? addProjectGlobalRef : removeProjectGlobalRef;
  const verb = action === "use" ? "Added" : "Removed";
  return {
    id: `assets:${action}`,
    input: {
      type: "object",
      properties: {
        kind: { type: "string" },
        id: { type: "string" },
        target: { type: "string" },
        config: { type: "string" },
        global: { type: "boolean" },
      },
      required: ["kind", "id", "global"],
      additionalProperties: false,
    },

    async run(input) {
      const { kind, id } = input;
      if (input.global !== true || !kind || !id) {
        throw new Error(`Usage: aof assets ${action} --global <kind> <id>`);
      }

      const targetDir = path.resolve(input.target ?? process.cwd());
      const result = await update(targetDir, { kind, id }, { config: input.config });
      if (!result.ok) {
        return { ok: false, diagnostics: result.diagnostics ?? [] };
      }
      return { ok: true, kind, id, configPath: workspacePaths(targetDir).configPath };
    },

    cli: {
      route: ["assets", action],
      spec: {
        usage: `aof assets ${action} --global <kind> <id>`,
        workspace: false,
        flags: {
          global: { type: "boolean", description: "required — the reference targets a global asset" },
          target: { type: "string", description: "project directory (defaults to cwd)" },
        },
      },

      argv: (positionals, options) => ({
        kind: positionals[0],
        id: positionals[1],
        target: options.target,
        config: options.config,
        global: options.global === true ? true : undefined,
      }),

      render(result) {
        if (!result.ok) {
          return (result.diagnostics ?? []).map((item) => `${item.severity}: ${item.path} ${item.message}`).join("\n");
        }
        return [`${verb} global reference ${result.kind}:${result.id}`, `Updated ${result.configPath}`].join("\n");
      },

      json: (result) => result,

      exit: (result) => (result.ok ? 0 : 1),
    },
  };
}

export const assetsUseCommand = globalRefCommand("use");
export const assetsUnuseCommand = globalRefCommand("unuse");
