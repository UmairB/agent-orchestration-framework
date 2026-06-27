// work:doctor — the deterministic, cross-item HEALTH lane of the work stream
// (milestone 15 / ADR-001). The SIBLING of work:validate on the SAME command
// core: same `{ id, input, run, cli }` contract, same getCommand/invoke door, the
// same basis-neutral `{ findings }` shape and scope-as-filter semantics — but a
// RICHER finding `{ code, severity, path, message }` (a health finding carries a
// severity + a machine code) where validate's is a per-file `{ path, problem }`.
//
// `run` returns `{ findings }` basis-neutral: every `finding.path` is a RAW
// ABSOLUTE in its on-disk OS form — NO displayPath, NO path.relative, NO slashing
// (the 08/ADR-002 keystone, inherited from validate.mjs). The FACES relativise:
// the board to projectRoot + forward-slash, the CLI --json adapter to cwd. The
// `--strict` exit gate is a FACE concern (ADR-002) — it is NOT part of `input`,
// and `run` ALWAYS returns the full, advisory finding set.
//
// `Date.now()` lives HERE, at the impure command boundary (ADR-003 step 4) — the
// engine (work-doctor.mjs) reads no wall-clock; it receives `now`/`staleWindow`.
import path from "node:path";
import { doctorWork, staleWindowFromConfig } from "../work-doctor.mjs";

export const doctorCommand = {
  id: "work:doctor",
  input: {
    type: "object",
    properties: { scope: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const scope = scopeOf(input);
    const findings = await doctorWork(ctx.workspace.workDir, ctx.workspace.config, scope, {
      now: Date.now(), // the impure edge — the engine stays wall-clock-free
      staleWindow: staleWindowFromConfig(ctx.workspace.config),
    });
    // Raw absolute paths, OS-native, NO projection — the face relativises.
    return {
      findings: findings.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        path: finding.path,
        message: finding.message,
      })),
    };
  },

  cli: {
    // `aof work doctor [scope] [--json] [--strict]` — the optional positional maps
    // onto the input; --strict/--json are face flags (parseOptions reads them).
    argv: (positionals) => (positionals[0] ? { scope: positionals[0] } : {}),

    // The human render: a healthy line on a clean stream (finding-oriented, silent
    // when well); otherwise one `severity: code — message` line per finding with
    // the anchor path shown CWD-RELATIVE (the CLI's path-projection face — run
    // carries the raw absolute, the face relativises to process.cwd()).
    render(result, faceCtx = {}) {
      if (result.findings.length === 0) {
        return `healthy — ${faceCtx.scope ? `${faceCtx.scope} is` : "work stream is"} coherent.`;
      }
      return result.findings
        .map((finding) => {
          const rel = path.relative(process.cwd(), finding.path);
          return `${finding.severity}: ${finding.code} — ${finding.message} (${rel})`;
        })
        .join("\n");
    },

    // --json emits the canonical envelope (each finding cwd-relative-pathed) PLUS
    // the config-doctor-shaped summary { healthy, strict, errors, warnings,
    // findings } so a CI step reads health without re-deriving. `strict`/`healthy`
    // reflect the FACE gate (ADR-002): error ⇒ never healthy; warn ⇒ unhealthy
    // only under --strict. The finding SET is identical with/without --strict.
    json(result, faceCtx = {}) {
      const strict = Boolean(faceCtx.strict);
      const findings = result.findings.map((finding) => ({
        code: finding.code,
        severity: finding.severity,
        path: path.relative(process.cwd(), finding.path),
        message: finding.message,
      }));
      const errors = findings.filter((finding) => finding.severity === "error").length;
      const warnings = findings.filter((finding) => finding.severity === "warn").length;
      const failed = errors > 0 || (strict && warnings > 0);
      return { healthy: !failed, strict, errors, warnings, findings };
    },
  },
};

function scopeOf(input) {
  const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
  return scope === "" ? undefined : scope;
}
