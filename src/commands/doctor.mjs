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
//
// milestone 33 / story 00 (ADR-004.4, F-3203) — the RAW committed config's mesh block
// is ALSO read HERE, at this SAME impure edge, and handed to the engine as plain data
// (`rawCommittedMesh`/`committedConfigPath`) so the mesh-identity-committed check-group
// never trusts `ctx.workspace.config` (the loadWorkspace-HYDRATED object, which a
// correctly-migrated repo still populates from the sidecar) for its committed-config
// decision.
//
// milestone 33 / story 01 (ADR-001.4 / ADR-003.4, task 04) — the per-fabric operator
// guidance is ADDITIVELY appended to `findings` at THIS SAME impure edge (the probe is
// an async fabric read, the same class of impurity as Date.now()/the raw config read
// above) — never inside work-doctor.mjs's pure CHECK_GROUPS registry, which stays a
// synchronous (snapshot, ctx) => Finding[] pipeline. SILENT (no finding appended) when
// config.mesh.fabric is undeclared, so a clean/unconfigured stream's doctor output is
// byte-identical to before this task (no dangling finding on every install that never
// opted into a fabric).
import path from "node:path";
import { doctorWork, staleWindowFromConfig } from "../work-doctor.mjs";
import { readJson } from "../fs.mjs";
import { probeFabric, remediationForReason } from "../mesh-fabric.mjs";

export const doctorCommand = {
  id: "work:doctor",
  input: {
    type: "object",
    properties: { scope: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const scope = scopeOf(input);
    let rawCommittedMesh = {};
    try {
      const rawCommitted = await readJson(ctx.workspace.configPath);
      if (rawCommitted?.mesh && typeof rawCommitted.mesh === "object") rawCommittedMesh = rawCommitted.mesh;
    } catch {
      rawCommittedMesh = {}; // an unreadable/torn committed config has no identity to warn about here.
    }
    // milestone 34 / story 00 — does a LEGACY per-workspace identity sidecar still exist
    // (should be migrated up to the machine-wide global home)? Read at the impure edge,
    // handed to the pure check-group as plain data (never a read the engine performs).
    let legacyIdentitySidecarPresent = false;
    try {
      const { sidecarPathFor } = await import("../node-identity.mjs");
      const { existsSync } = await import("node:fs");
      legacyIdentitySidecarPresent = existsSync(sidecarPathFor(ctx.workspace.aofDir));
    } catch {
      legacyIdentitySidecarPresent = false;
    }
    const findings = await doctorWork(ctx.workspace.workDir, ctx.workspace.config, scope, {
      now: Date.now(), // the impure edge — the engine stays wall-clock-free
      staleWindow: staleWindowFromConfig(ctx.workspace.config),
      rawCommittedMesh,
      committedConfigPath: ctx.workspace.configPath,
      legacyIdentitySidecarPresent,
      legacyIdentitySidecarPath: ctx.workspace.aofDir ? `${ctx.workspace.aofDir}/mesh/identity.json` : null,
    });

    // milestone 33 / story 01 (ADR-001.4 / ADR-003.4, task 04) — the fabric preflight
    // check, ADDITIVE and SILENT unless config.mesh.fabric is declared (a wholly
    // unconfigured mesh is byte-identical to before this task — no dangling finding).
    // A degraded probe warns with the SAME remediation text the launcher preflight
    // prints (ONE source, src/mesh-fabric.mjs) — this NEVER runs a remediation itself
    // (ADR-001.consequence: report, never auto-fix).
    if (ctx.workspace.config?.mesh?.fabric != null) {
      const probe = ctx?.fabricProbe ?? (await probeFabric(ctx.workspace.config));
      if (!probe.healthy) {
        findings.push({
          code: "mesh-fabric-degraded",
          severity: "warn",
          path: ctx.workspace.configPath,
          message: `the mesh fabric is degraded (${probe.reason}) — ${remediationForReason(probe.reason)}`,
        });
      }
    }

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
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs face copy is deleted. The ADVISORY exit
    // gate (error always fails; warn fails only under --strict) rides cli.exit —
    // run's findings stay identical across --strict (the gate is the face).
    route: ["work", "doctor"],
    spec: {
      usage: "aof work doctor [scope] [--json] [--strict]",
      flags: {
        strict: { type: "boolean", description: "treat warn findings as failures" },
      },
    },

    // `aof work doctor [scope] [--json] [--strict]` — the optional positional maps
    // onto the input; --strict/--json are face flags.
    argv: (positionals) => (positionals[0] ? { scope: positionals[0] } : {}),

    // The human render: a healthy line on a clean stream (finding-oriented, silent
    // when well); otherwise one `severity: code — message` line per finding with
    // the anchor path shown CWD-RELATIVE (the CLI's path-projection face — run
    // carries the raw absolute, the face relativises to process.cwd()).
    render(result, faceCtx = {}) {
      const scope = faceCtx.scope ?? faceCtx.positionals?.[0];
      if (result.findings.length === 0) {
        return `healthy — ${scope ? `${scope} is` : "work stream is"} coherent.`;
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
      const strict = doctorStrict(faceCtx);
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

    exit(result, faceCtx = {}) {
      const strict = doctorStrict(faceCtx);
      const errors = result.findings.filter((finding) => finding.severity === "error").length;
      const warns = result.findings.filter((finding) => finding.severity === "warn").length;
      return errors > 0 || (strict && warns > 0) ? 1 : 0;
    },
  },
};

// The face flag read once: the generic face passes { positionals, options };
// a direct adapter caller may still pass { strict } (the pre-route shape).
function doctorStrict(faceCtx = {}) {
  return Boolean(faceCtx.strict ?? faceCtx.options?.strict);
}

function scopeOf(input) {
  const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
  return scope === "" ? undefined : scope;
}
