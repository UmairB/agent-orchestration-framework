// project:doctor — the project-config health verb registered into the command
// core (m42 wave (d) leg d1). Class-A migration of cli.mjs's inline
// `doctorCommand` (a thin seam over config-inspect.mjs's doctorConfig).
// Byte-identical output; the exit gate rides the face's cli.exit adapter.
import path from "node:path";
import { doctorConfig } from "../config-inspect.mjs";
import { parseRuntimes, RUNTIME_FLAGS } from "../spine/flags.mjs";
import { adapterWarningLines, VALIDATE_FLAGS } from "./validate-shared.mjs";

export const projectDoctorCommand = {
  id: "project:doctor",
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
    const targetDir = path.resolve(input.target ?? process.cwd());
    const report = await doctorConfig(targetDir, {
      config: input.config,
      strict: input.strict,
      runtimes: input.runtimes,
    });
    const errors = report.checks.filter((item) => item.severity === "error");
    const warnings = report.checks.filter((item) => item.severity === "warning");
    const failed = errors.length > 0 || (input.strict === true && warnings.length > 0);
    return {
      healthy: !failed,
      strict: input.strict === true,
      errors: errors.length,
      warnings: warnings.length,
      ...report,
    };
  },

  cli: {
    route: ["project", "doctor"],
    spec: {
      usage: "aof project doctor [--target <dir>] [--strict] [--runtime list|--claude|--codex] [--json]",
      workspace: false,
      flags: { ...VALIDATE_FLAGS, ...RUNTIME_FLAGS },
    },

    argv: (positionals, options) => ({
      target: options.target,
      config: options.config,
      strict: options.strict === true ? true : undefined,
      runtimes: parseRuntimes(options),
    }),

    render(result) {
      const lines = [`doctor: ${result.healthy ? "healthy" : "issues found"}`];
      for (const check of result.checks) {
        lines.push(`${check.severity}: ${check.id} - ${check.message}`);
      }
      lines.push(...adapterWarningLines(result.adapterWarnings));
      for (const suggestion of result.suggestions) {
        lines.push(`next: ${suggestion}`);
      }
      return lines.join("\n");
    },

    json: (result) => result,

    exit: (result) => (result.healthy ? 0 : 1),
  },
};
