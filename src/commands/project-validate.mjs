// project:validate — the project-config validation verb registered into the
// command core (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `validateCommand`; the report core is shared with assets:validate
// (validate-shared.mjs — one engine, thin wrappers). Byte-identical output;
// findings gate the exit code through the face's cli.exit adapter, never a
// process.exitCode write inside the command.
import { parseRuntimes, RUNTIME_FLAGS } from "../spine/flags.mjs";
import { buildProjectValidationReport, renderValidationReport, VALIDATE_FLAGS } from "./validate-shared.mjs";

export const projectValidateCommand = {
  id: "project:validate",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      config: { type: "string" },
      strict: { type: "boolean" },
      runtimes: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },

  async run(input) {
    return await buildProjectValidationReport(input);
  },

  cli: {
    route: ["project", "validate"],
    spec: {
      usage: "aof project validate [--target <dir>] [--strict] [--runtime list|--claude|--codex] [--json]",
      workspace: false,
      flags: { ...VALIDATE_FLAGS, ...RUNTIME_FLAGS },
    },

    argv: (positionals, options) => ({
      target: options.target,
      config: options.config,
      strict: options.strict === true ? true : undefined,
      runtimes: parseRuntimes(options),
    }),

    render: (report) => renderValidationReport(report, "config passed validation"),

    json: (report) => report,

    // Findings gate: errors (or warnings under --strict) exit 1.
    exit: (report) => (report.valid ? 0 : 1),
  },
};
