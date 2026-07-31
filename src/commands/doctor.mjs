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
import { existsSync } from "node:fs";
import { doctorWork, staleWindowFromConfig } from "../work-doctor.mjs";
import { readJson } from "../fs.mjs";
import { probeFabric, remediationForReason } from "../mesh-fabric.mjs";
import { commandError } from "../command-error.mjs";
import { effectsFor, knownEvents } from "../effects/table.mjs";
import {
  openEffectsJournal,
  effectsJournalPath,
  readEvents,
  readEventSteps,
  pendingSteps,
} from "../effects/journal.mjs";
import { drainEffects, reachableLoci } from "../effects/dispatch.mjs";
import { reconcileRunRecords } from "../effects/reconcile.mjs";

// The operator guidance for a step left owed at a locus this process cannot
// reach — the honest half of --converge's report: what was NOT paid, and whose
// job it is. One home for the hints so render and --json carry the same words.
const LEFT_HINTS = Object.freeze({
  "control-store": "paid by the control daemon's converge tick (aof mesh serve), or delivered over the mesh bridge",
  "integration:notion": "run `aof work integrations notion sync-work <milestone>`, or set work.integrations.notion.autoSync",
});

function leftHint(locus) {
  return LEFT_HINTS[locus] ?? `owed at "${locus}" — drained by the process that reaches that locus`;
}

export const doctorCommand = {
  id: "work:doctor",
  input: {
    type: "object",
    properties: {
      scope: { type: "string" },
      // m42 wave (d) leg d5 — the ledger's two diagnostic modes. `explain`
      // renders one event's declared cascade + its journal state (read-only);
      // `converge` runs the file-store reconciler scan and drains everything
      // this process's loci can pay. Mutually exclusive with each other; the
      // bare findings lane is untouched when neither is set.
      explain: { type: "string" },
      converge: { type: "boolean" },
      // The injected clock for timestamp-deterministic assertions (the 22/R2
      // white-box idiom — a test input, never a CLI flag).
      now: { type: "string" },
    },
    additionalProperties: false,
  },

  async run(input, ctx) {
    if (typeof input.explain === "string" && input.converge === true) {
      throw commandError("Use --explain <event> or --converge, not both.", "invalid-input", 400);
    }
    if (typeof input.explain === "string") return await explainEvent(input.explain, ctx);
    if (input.converge === true) return await convergeLedger(ctx, input.now);

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
      usage: "aof work doctor [scope] [--strict] | --explain <event> | --converge [--json]",
      flags: {
        strict: { type: "boolean", description: "treat warn findings as failures" },
        explain: { type: "string", description: "render one event's declared cascade + journal state" },
        converge: { type: "boolean", description: "reconcile the file stores and drain everything owed that this process can pay" },
      },
    },

    // `aof work doctor [scope] [--strict] | --explain <event> | --converge` — the
    // optional positional maps onto the input; the two ledger modes ride flags.
    argv: (positionals, options = {}) => ({
      ...(positionals[0] ? { scope: positionals[0] } : {}),
      ...(typeof options.explain === "string" ? { explain: options.explain } : {}),
      ...(options.converge ? { converge: true } : {}),
    }),

    // The human render: a healthy line on a clean stream (finding-oriented, silent
    // when well); otherwise one `severity: code — message` line per finding with
    // the anchor path shown CWD-RELATIVE (the CLI's path-projection face — run
    // carries the raw absolute, the face relativises to process.cwd()).
    render(result, faceCtx = {}) {
      if (result.explain) return renderExplain(result.explain);
      if (result.converge) return renderConverge(result.converge);
      const scope = faceCtx.positionals?.[0];
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
      // The ledger modes carry no paths — their envelopes pass through verbatim.
      if (result.explain || result.converge) return result;
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
      if (!Array.isArray(result.findings)) return 0; // the ledger modes report; they do not gate
      const strict = doctorStrict(faceCtx);
      const errors = result.findings.filter((finding) => finding.severity === "error").length;
      const warns = result.findings.filter((finding) => finding.severity === "warn").length;
      return errors > 0 || (strict && warns > 0) ? 1 : 0;
    },
  },
};

// The face flag read once: the generic face passes { positionals, options } —
// the ONE calling convention (the pre-route { strict } shape is retired).
function doctorStrict(faceCtx = {}) {
  return Boolean(faceCtx.options?.strict);
}

function scopeOf(input) {
  const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
  return scope === "" ? undefined : scope;
}

// The human faces of the two ledger modes — cascade first, then journal state.
function renderExplain(explain) {
  const lines = [`${explain.event} — declared cascade:`];
  for (const reactor of explain.reactors) {
    lines.push(`  ${reactor.key} @ ${reactor.locus}${reactor.predicated ? " (predicated — owed only where it applies)" : ""}`);
  }
  if (!explain.journal.present) {
    lines.push("journal: no journal file on this node yet (no event has ever been appended).");
    return lines.join("\n");
  }
  const owed = explain.journal.owed;
  lines.push(`journal: ${owed.length} owed step(s) for this event.`);
  for (const step of owed) {
    lines.push(`  owed: ${step.key} @ ${step.locus} — ${step.status}, ${step.attempts} attempt(s) (${step.eventId})`);
  }
  if (explain.journal.recent.length > 0) {
    lines.push("recent:");
    for (const event of explain.journal.recent) {
      const steps = event.steps.map((step) => `${step.key}=${step.status}`).join(", ");
      lines.push(`  ${event.eventId} (${event.createdAt}${event.source ? `, ${event.source}` : ""}): ${steps}`);
    }
  }
  return lines.join("\n");
}

function renderConverge(converge) {
  const lines = [];
  if (converge.reconciled.length > 0) {
    lines.push(`Reconciled ${converge.reconciled.length} fact(s) whose event a crash ate:`);
    for (const entry of converge.reconciled) {
      lines.push(`  ${entry.ref} run ${entry.runId} → ${entry.event} (${entry.eventId})`);
    }
  }
  const paid = converge.drained.filter((outcome) => outcome.status === "done").length;
  const failed = converge.drained.filter((outcome) => outcome.status === "failed").length;
  lines.push(`Drained ${paid} step(s)${failed ? ` (${failed} failed — retried by a later drain)` : ""}.`);
  if (converge.left.length > 0) {
    lines.push("Still owed elsewhere:");
    for (const entry of converge.left) {
      lines.push(`  ${entry.count}× ${entry.key} @ ${entry.locus} — ${entry.hint}`);
    }
  } else {
    lines.push("Nothing owed at unreachable loci — the ledger is converged for this node.");
  }
  return lines.join("\n");
}

// --------------------------------------------------- the ledger modes (d5) ----

// --explain <event>: the declared cascade (from the ONE effects table) + the
// journal's state for that event. Read-only — it renders, never drains.
async function explainEvent(event, ctx) {
  const declared = effectsFor(event);
  if (declared == null) {
    throw commandError(
      `Unknown event "${event}". Declared events: ${knownEvents().join(", ")}.`,
      "unknown-event",
      400,
    );
  }
  const reactors = declared.map((reactor) => ({
    key: reactor.key,
    locus: reactor.locus,
    // A predicated reactor is owed only where its predicate says so — worth
    // rendering, because "why is there no step?" is this mode's whole job.
    predicated: typeof reactor.applies === "function",
  }));

  const journalOptions = ctx.effectsJournalOptions ?? {};
  if (!existsSync(effectsJournalPath(journalOptions))) {
    return { explain: { event, reactors, journal: { present: false } } };
  }
  const journal = await openEffectsJournal(journalOptions);
  try {
    const recent = readEvents(journal, { name: event, limit: 5 }).map((row) => ({
      eventId: row.eventId,
      createdAt: row.createdAt,
      source: row.source ?? null,
      steps: readEventSteps(journal, row.eventId).map((step) => ({
        key: step.key,
        locus: step.locus,
        status: step.status,
        attempts: step.attempts,
        ...(step.lastError ? { lastError: step.lastError } : {}),
      })),
    }));
    const owed = pendingSteps(journal, { limit: 500 }).filter((step) => step.name === event);
    return {
      explain: {
        event,
        reactors,
        journal: {
          present: true,
          recent,
          owed: owed.map((step) => ({ eventId: step.eventId, key: step.key, locus: step.locus, status: step.status, attempts: step.attempts })),
        },
      },
    };
  } finally {
    journal.close();
  }
}

// --converge: reconcile the file stores (the write-vs-append crash window), then
// drain everything this process's loci can pay, then report — paid, and LEFT,
// each leftover with the hint naming whose job it is. The one deliberately
// mutating doctor mode: an explicit operator request, like sync-work's drain.
async function convergeLedger(ctx, now) {
  const journalOptions = ctx.effectsJournalOptions ?? {};
  const reconciled = await reconcileRunRecords(ctx.workspace, { journalOptions, now });

  if (!existsSync(effectsJournalPath(journalOptions))) {
    return { converge: { reconciled: reconciled.appended ?? [], drained: [], left: [] } };
  }

  const loci = reachableLoci(ctx.workspace);
  const reactorCtx = { publisherOptions: ctx, workspace: ctx.workspace };
  const drained = [];
  const journal = await openEffectsJournal(journalOptions);
  try {
    // Bounded passes: each pass fetches only runnable steps (the d4 starvation
    // guard), so an empty pass means convergence — not an infinite loop against
    // steps that keep failing (attempts cap them out of the fetch).
    for (let pass = 0; pass < 10; pass += 1) {
      const outcomes = await drainEffects({ journal, loci, limit: 100, now, ctx: reactorCtx });
      drained.push(...outcomes);
      if (outcomes.length === 0) break;
    }
    // The honest half: what is STILL owed, fetched without the loci filter.
    const leftByKey = new Map();
    for (const step of pendingSteps(journal, { limit: 500 })) {
      if (loci.includes(step.locus)) continue; // will be paid by a later pass here
      const key = `${step.locus} ${step.key}`;
      leftByKey.set(key, (leftByKey.get(key) ?? 0) + 1);
    }
    const left = [...leftByKey.entries()].map(([key, count]) => {
      const [locus, reactorKey] = key.split(" ");
      return { locus, key: reactorKey, count, hint: leftHint(locus) };
    });
    return {
      converge: {
        reconciled: reconciled.appended ?? [],
        drained: drained.map(({ event, key, locus, status, error }) => ({ event, key, locus, status, ...(error ? { error } : {}) })),
        left,
      },
    };
  } finally {
    journal.close();
  }
}
