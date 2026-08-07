// work:observe — mine Claude Code session transcripts for a milestone's
// per-agent time/token spend + stall gaps (m42 wave (d) leg d1, wave-3 tail;
// formerly cli.mjs's CLI-only workObserveCommand). A READ by default; `--write`
// drops `observability/{report.md,agents.json}` into the milestone.
//
// `--if-enabled` self-gates on the config flag (work.observability.enabled, which
// DEFAULTS ON as of 2026-08-07 — `false` is the explicit opt-out) and no-ops when
// off. This is the form the lifecycle
// (aof:retrospective) calls, so the bundle instruction can invoke observe
// unconditionally and the CLI decides — deterministic, rather than asking the
// agent to branch on config. A DIRECT `aof work observe` (no --if-enabled)
// always runs: an operator asked for it.
//
// Documented contract change with the migration: a skipped `--if-enabled --json`
// run previously printed NOTHING; it now emits ONE `{ skipped: true }` document
// (the face's one-document discipline — a machine caller always gets a
// parseable answer).
import path from "node:path";
import { observeMilestone, observabilityEnabled } from "../work-observe.mjs";
import { loadWorkspace } from "../work.mjs";
import { commandError } from "../command-error.mjs";

export const observeCommand = {
  id: "work:observe",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      write: { type: "boolean" },
      stall: { type: "string" },
      humanWait: { type: "string" },
      ifEnabled: { type: "boolean" },
      config: { type: "string" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input) {
    // The opt-in gate loads the workspace itself (the observe read otherwise
    // resolves everything from the cwd — spec.workspace: false below keeps the
    // retired face's posture).
    if (input.ifEnabled) {
      const workspace = await loadWorkspace(process.cwd(), input.config);
      if (!observabilityEnabled(workspace.config)) {
        return { skipped: true };
      }
    }
    const stallMs = input.stall != null ? Number(input.stall) * 60 * 1000 : undefined;
    const humanWaitMs = input.humanWait != null ? Number(input.humanWait) * 60 * 1000 : undefined;
    return await observeMilestone({
      cwd: process.cwd(),
      ref: input.ref,
      stallMs,
      humanWaitMs,
      // Stamp with the caller's wall clock (Date.now is fine in the CLI process).
      generatedAt: Date.now(),
      write: Boolean(input.write),
    });
  },

  cli: {
    route: ["work", "observe"],
    spec: {
      usage: "aof work observe <milestone-ref> [--write] [--json] [--stall <minutes>] [--human-wait <minutes>] [--if-enabled]",
      workspace: false,
      flags: {
        write: { type: "boolean", description: "write observability/{report.md,agents.json} into the milestone" },
        stall: { type: "string", description: "stall threshold in minutes" },
        humanWait: { type: "string", description: "main-thread quiet time in minutes before it counts as blocked on a human" },
        ifEnabled: { type: "boolean", description: "no-op when work.observability.enabled is false (the lifecycle form; the flag defaults on)" },
      },
    },

    argv: (positionals, options) => {
      if (!positionals[0]) {
        throw commandError(
          "Usage: aof work observe <milestone-ref> [--write] [--json] [--stall <minutes>] [--human-wait <minutes>] [--if-enabled]",
          "invalid-input",
          400,
        );
      }
      return {
        ref: positionals[0],
        ...(options.write ? { write: true } : {}),
        ...(options.stall !== undefined ? { stall: options.stall } : {}),
        ...(options.humanWait !== undefined ? { humanWait: options.humanWait } : {}),
        ...(options.ifEnabled ? { ifEnabled: true } : {}),
        ...(options.config !== undefined ? { config: options.config } : {}),
      };
    },

    render(result) {
      if (result.skipped) return "observability disabled (work.observability.enabled is false) — skipped.";
      const lines = [result.report];
      if (!result.found) {
        lines.push(`\n(no Claude Code transcripts found under ${result.projectsDir})`);
      }
      if (result.written) {
        lines.push(`\nWrote ${path.relative(process.cwd(), result.written.reportPath)} + agents.json`);
      }
      return lines.join("\n");
    },

    json: (result) => (result.skipped ? { skipped: true } : result.json),
  },
};
