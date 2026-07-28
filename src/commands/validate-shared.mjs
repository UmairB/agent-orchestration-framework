// validate-shared.mjs — the shared validation-report core for the config-family
// validate/doctor verbs (m42 wave (d) leg d1; the insert-shared.mjs precedent:
// one engine, thin command wrappers). `aof project validate` and non-global
// `aof assets validate` are the SAME check by long-standing contract; the
// global branch reuses the same report shape over validateGlobalConfig. Renders
// reproduce the retired inline handlers' console.log lines byte-for-byte,
// including the adapter-warnings block.
import path from "node:path";
import { adapterWarningsForConfig, validateConfig, validateGlobalConfig } from "../config-inspect.mjs";

// The project-config validation report: diagnostics + adapter warnings, with
// the strict/failed math the CLI has always applied.
export async function buildProjectValidationReport(input) {
  const targetDir = path.resolve(input.target ?? process.cwd());
  const diagnostics = await validateConfig(targetDir, { config: input.config });
  const adapterWarnings = await adapterWarningsForConfig(targetDir, {
    config: input.config,
    runtimes: input.runtimes,
  });
  const errors = diagnostics.filter((item) => item.severity === "error");
  const warnings = diagnostics.filter((item) => item.severity === "warning");
  const warningCount = warnings.length + adapterWarnings.length;
  const failed = errors.length > 0 || (input.strict === true && warningCount > 0);
  return {
    valid: !failed,
    strict: input.strict === true,
    errors: errors.length,
    warnings: warningCount,
    diagnostics,
    adapterWarnings,
  };
}

// The global-config validation report (assets validate --global): no adapter
// warnings lane — the retired printValidationResult shape.
export async function buildGlobalValidationReport(input) {
  const diagnostics = await validateGlobalConfig();
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
}

// The adapter-warnings block, exactly as the retired printAdapterWarnings
// printed it (returned as lines so renders can compose it).
export function adapterWarningLines(warnings = []) {
  if (warnings.length === 0) return [];
  const lines = ["adapter-warnings:"];
  for (const warning of warnings) {
    const source = warning.kind && warning.id ? `${warning.kind}:${warning.id}` : warning.kind;
    const output = warning.generatedPath ? ` output=${warning.generatedPath}` : "";
    lines.push(`- [${warning.code}] ${warning.path} runtime=${warning.runtime} source=${source}${output}`);
    lines.push(`  reason: ${warning.reason}`);
    lines.push(`  remediation: ${warning.remediation}`);
  }
  return lines;
}

// The human render of a validation report — the retired inline shape: a
// "valid:"/"invalid:" head line, diagnostics on failure, adapter warnings
// where the report carries them.
export function renderValidationReport(report, successMessage) {
  const lines = [];
  const adapterWarnings = report.adapterWarnings ?? [];
  if (report.valid) {
    lines.push(`valid: ${successMessage}`);
    if (report.warnings > 0) lines.push(`warnings: ${report.warnings}`);
    lines.push(...adapterWarningLines(adapterWarnings));
  } else {
    const reason = report.errors > 0
      ? `${report.errors} error(s)`
      : `${report.warnings} warning(s) under --strict`;
    lines.push(`invalid: ${reason}`);
    for (const item of report.diagnostics) lines.push(`${item.severity}: ${item.path} ${item.message}`);
    lines.push(...adapterWarningLines(adapterWarnings));
  }
  return lines.join("\n");
}

// The shared validate-verb flag vocabulary.
export const VALIDATE_FLAGS = Object.freeze({
  target: Object.freeze({ type: "string", description: "project directory (defaults to cwd)" }),
  strict: Object.freeze({ type: "boolean", description: "treat warnings as failures" }),
});
