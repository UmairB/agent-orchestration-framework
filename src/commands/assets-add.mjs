// assets:add — scaffold a new source asset (m42 wave (d) leg d1). Class-A
// migration of cli.mjs's inline `assetsAddCommand`. The INTERACTIVE half
// (prompting for a missing kind/id) lives in the cli.argv adapter — argv
// completion is a face concern, and run() stays headless for every other face.
// Byte-identical output.
import path from "node:path";
import { promptResourceInput } from "../prompt.mjs";
import { supportedRuntimes } from "../adapters.mjs";
import { hasRuntimeOptions, parseRuntimes, RUNTIME_FLAGS } from "../spine/flags.mjs";

export const assetsAddCommand = {
  id: "assets:add",
  input: {
    type: "object",
    properties: {
      kind: { type: "string" },
      id: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      body: { type: "string" },
      runtimes: { type: "array", items: { type: "string" } },
      force: { type: "boolean" },
      dryRun: { type: "boolean" },
      global: { type: "boolean" },
      target: { type: "string" },
    },
    required: ["kind", "id"],
    additionalProperties: false,
  },

  async run(input) {
    // Dynamic import mirrors the retired handler (scaffold stays lazy-loaded).
    const { scaffoldGlobalResource, scaffoldResource } = await import("../scaffold.mjs");
    const scaffoldInput = {
      kind: input.kind,
      id: input.id,
      name: input.name,
      description: input.description,
      body: input.body,
      runtimes: input.runtimes,
      force: Boolean(input.force),
      dryRun: Boolean(input.dryRun),
    };
    const targetDir = path.resolve(input.target ?? process.cwd());
    const result = input.global
      ? await scaffoldGlobalResource(scaffoldInput)
      : await scaffoldResource(targetDir, scaffoldInput);
    return { dryRun: Boolean(result.dryRun), assetPath: result.assetPath, configPath: result.configPath };
  },

  cli: {
    route: ["assets", "add"],
    spec: {
      usage: "aof assets add [--global] <kind> <id> [--name N] [--description D] [--body B] [--runtime list|--claude|--codex] [--force] [--dry-run]",
      workspace: false,
      flags: {
        global: { type: "boolean", description: "scaffold into the global config instead of the project" },
        target: { type: "string", description: "project directory (defaults to cwd)" },
        name: { type: "string", description: "display name" },
        description: { type: "string", description: "asset description" },
        body: { type: "string", description: "inline body content" },
        force: { type: "boolean", description: "overwrite an existing asset" },
        dryRun: { type: "boolean", description: "preview the writes without changing anything" },
        ...RUNTIME_FLAGS,
      },
    },

    // ASYNC by design: a missing kind/id completes interactively (the retired
    // handler's promptResourceInput flow, verbatim — including the prompt-driven
    // description/body/runtimes taking precedence over flags).
    async argv(positionals, options) {
      let [kind, id] = positionals;
      let interactiveInput = null;
      if (!kind || !id) {
        interactiveInput = await promptResourceInput({
          global: Boolean(options.global),
          ...(kind ? { kind } : {}),
          ...(id ? { id } : {}),
          description: options.description,
          skipBody: true,
          runtimes: hasRuntimeOptions(options) ? parseRuntimes(options) : undefined,
        });
        kind = interactiveInput.kind;
        id = interactiveInput.id;
      }

      return {
        kind,
        id,
        name: options.name,
        description: interactiveInput?.description ?? options.description,
        body: options.body ?? interactiveInput?.body,
        runtimes: interactiveInput?.runtimes ?? (hasRuntimeOptions(options) ? parseRuntimes(options) : supportedRuntimes()),
        force: options.force === true ? true : undefined,
        dryRun: options.dryRun === true ? true : undefined,
        global: options.global === true ? true : undefined,
        target: options.target,
      };
    },

    render(result) {
      if (result.dryRun) {
        return [`write: ${result.assetPath}`, `write: ${result.configPath}`].join("\n");
      }
      return [
        `Created ${result.assetPath}`,
        `Updated ${result.configPath}`,
        "Next: edit the source file directly or run `aof assets ui`.",
      ].join("\n");
    },

    json: (result) => result,
  },
};
