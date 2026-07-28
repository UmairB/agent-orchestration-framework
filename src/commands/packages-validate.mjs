// packages:validate — validate the declared package intents (m42 wave (d) leg
// d1). Class-A migration of cli.mjs's inline `packagesValidateCommand` over
// packages.mjs's packageDiagnostics (moved to its owning module). Byte-identical
// output; findings gate through the face's cli.exit adapter.
import path from "node:path";
import { readJson } from "../fs.mjs";
import { findProjectConfig } from "../workspace.mjs";
import { packageDiagnostics } from "../packages.mjs";
import { renderValidationReport, VALIDATE_FLAGS } from "./validate-shared.mjs";

export const packagesValidateCommand = {
  id: "packages:validate",
  input: {
    type: "object",
    properties: {
      target: { type: "string" },
      config: { type: "string" },
      strict: { type: "boolean" },
    },
    additionalProperties: false,
  },

  async run(input) {
    const targetDir = path.resolve(input.target ?? process.cwd());
    const configPath = await findProjectConfig(targetDir, input.config);
    const raw = await readJson(configPath);
    const diagnostics = packageDiagnostics(raw);
    const errors = diagnostics.filter((item) => item.severity === "error");
    const warnings = diagnostics.filter((item) => item.severity === "warning");
    const failed = errors.length > 0 || (input.strict === true && warnings.length > 0);
    return {
      valid: !failed,
      strict: input.strict === true,
      errors: errors.length,
      warnings: warnings.length,
      diagnostics,
    };
  },

  cli: {
    route: ["packages", "validate"],
    spec: {
      usage: "aof packages validate [--target <dir>] [--strict] [--json]",
      workspace: false,
      flags: { ...VALIDATE_FLAGS },
    },

    argv: (positionals, options) => ({
      target: options.target,
      config: options.config,
      strict: options.strict === true ? true : undefined,
    }),

    render: (report) => renderValidationReport(report, "packages passed validation"),

    json: (report) => report,

    exit: (report) => (report.valid ? 0 : 1),
  },
};
