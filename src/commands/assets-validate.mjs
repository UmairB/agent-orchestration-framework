// assets:validate — validate the project (or global) asset config (m42 wave (d)
// leg d1). Class-A migration of cli.mjs's inline `assetsValidateCommand`: the
// non-global form IS project:validate by long-standing contract (the retired
// handler literally delegated); both wrap validate-shared.mjs's one engine.
// Byte-identical output; findings gate through the face's cli.exit adapter.
import { parseRuntimes, RUNTIME_FLAGS } from "../spine/flags.mjs";
import {
  buildGlobalValidationReport,
  buildProjectValidationReport,
  renderValidationReport,
  VALIDATE_FLAGS,
} from "./validate-shared.mjs";

export const assetsValidateCommand = {
  id: "assets:validate",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      config: { type: "string" },
      strict: { type: "boolean" },
      global: { type: "boolean" },
      runtimes: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },

  async run(input) {
    if (input.global === true) {
      const report = await buildGlobalValidationReport(input);
      return { ...report, scope: "global" };
    }
    const report = await buildProjectValidationReport(input);
    return { ...report, scope: "project" };
  },

  cli: {
    route: ["assets", "validate"],
    spec: {
      usage: "aof assets validate [--global] [--target <dir>] [--strict] [--json]",
      workspace: false,
      flags: {
        ...VALIDATE_FLAGS,
        ...RUNTIME_FLAGS,
        global: { type: "boolean", description: "validate the global config instead of the project" },
      },
    },

    argv: (positionals, options) => ({
      target: options.target,
      config: options.config,
      strict: options.strict === true ? true : undefined,
      global: options.global === true ? true : undefined,
      runtimes: parseRuntimes(options),
    }),

    render: (report) => renderValidationReport(
      report,
      report.scope === "global" ? "global config passed validation" : "config passed validation",
    ),

    // The retired shapes: the global branch's printValidationResult had no
    // adapterWarnings key; the project branch's validateCommand did. The scope
    // key is a render affordance, not part of the wire.
    json: ({ scope, ...report }) => report,

    exit: (report) => (report.valid ? 0 : 1),
  },
};
