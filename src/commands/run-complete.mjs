// work:run-complete — the terminal transition running→outcome on a run (ADR-001/003),
// PORTED to the effects ledger (m42 wave (d) leg d2 — the first cascade off the
// inline pattern). The run ORDER is load-bearing: (1) validate the outcome
// against the closed set done|failed|cancelled BEFORE resolving anything;
// (2) resolve the target EXACT (resolveItemExact — a typo never completes a run
// on the wrong item); (3) hand the terminal edge to transitionRunComplete — the
// run store's ONLY event-raiser — which writes the fact, appends `run.completed`
// to the per-node journal, and drains the event's local-locus reactors
// synchronously before returning.
//
// The CASCADE THIS FILE USED TO REMEMBER INLINE (20/ADR-005 status rollback +
// publish-on-mutate) now lives DECLARED in src/effects/table.mjs's "run.completed"
// entry — this command can no longer forget it, and neither can the other
// completeRun call sites as they port (the wave-(d) migration plan's d2 sweep).
// A reactor failure is a failed journal step + degrade event (retried by later
// drains), never a silent skip and never a lost completion.
import { resolveItemExact } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { transitionRunComplete } from "../effects/run-transitions.mjs";
import { renderWithPropagationWarnings, appendPropagationWarning } from "../global-work-publisher.mjs";

// The closed terminal-outcome set (ADR-001's machine: running → done|failed|cancelled).
const VALID_OUTCOMES = new Set(["done", "failed", "cancelled"]);

export const runCompleteCommand = {
  id: "work:run-complete",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      runId: { type: "string" },
      outcome: { type: "string" },
      // DEFAULT DECISION (refine 2026-06-30) — the command half of the failureReason
      // producer split. On --outcome failed, this is recorded verbatim onto the run's
      // failureReason (20/ADR-001; the store write is story 00). The closed-set safety
      // stays with the classifier failing closed (ADR-002), NOT a command rejection —
      // so an unrecognised reason is recorded, not rejected. Ignored on done/cancelled.
      reason: { type: "string" },
      // `now` (ISO-8601 UTC-Z) is an INJECTED clock for timestamp-deterministic
      // assertions (the 22/R2 white-box idiom — a test input, never a CLI flag).
      now: { type: "string" },
    },
    required: ["ref", "outcome"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const outcome = typeof input.outcome === "string" ? input.outcome : "";

    // (1) Validate the outcome against the closed set BEFORE any resolve/write — a
    // bogus or empty --outcome is rejected up front (invalid-outcome).
    if (!VALID_OUTCOMES.has(outcome)) {
      throw commandError(`Outcome must be one of done|failed|cancelled (got "${outcome}").`, "invalid-outcome", 400);
    }

    // (2) The WRITE resolves by EXACT ref — a typo'd/partial ref → ref-not-found,
    // never completing a run on the wrong item.
    const item = await resolveItemExact(ctx.workspace.workDir, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);

    // (3) The transition seam: fact write (the store's no-running-run /
    // ambiguous-run / illegal-transition rejections propagate untouched, and
    // nothing is appended on a refusal) + `run.completed` event + sync drain of
    // its checkout/local reactors (rollback-status, publish-projection — in that
    // declared order, so the published snapshot carries the rolled-back status).
    const reason = typeof input.reason === "string" ? input.reason : null;
    const { record, eventId, effects } = await transitionRunComplete(
      item,
      { runId: input.runId, outcome, failureReason: reason, now: input.now },
      { workspace: ctx.workspace, journalOptions: ctx.effectsJournalOptions ?? {} },
    );

    // The result envelope: the run record (today's wire, byte-compatible) plus
    // the ADDITIVE per-reactor outcomes (PRD: outcomes ride the envelope). The
    // publish reactor's warning keeps riding the established propagationWarnings
    // key so existing renderers/consumers see exactly what they used to.
    let result = {
      ...record,
      effects: effects.map(({ event, key, locus, status, error }) => ({
        event,
        key,
        locus,
        status,
        ...(error ? { error } : {}),
      })),
      ...(eventId ? { eventId } : {}),
    };
    const publish = effects.find((outcome_) => outcome_.key === "publish-projection");
    if (publish?.detail?.warning) {
      result = appendPropagationWarning(result, publish.detail.warning);
    }
    return result;
  },

  cli: {
    // m42 wave (d) leg d1 — dispatched by the registry-derived route table
    // through the ONE generic face; the runVerbCli branch in cli.mjs is retired
    // for this verb (its single-envelope --json discipline is now the face's).
    route: ["work", "run-complete"],
    spec: {
      usage: "aof work run-complete <ref> --outcome done|failed|cancelled [--run <runId>] [--reason <reason>] [--json]",
      flags: {
        outcome: { type: "string", description: "terminal outcome: done|failed|cancelled" },
        run: { type: "string", description: "target run id (defaults to the single running run)" },
        reason: { type: "string", description: "failureReason recorded on --outcome failed" },
      },
    },

    // `aof work run-complete <ref> --outcome done|failed|cancelled [--run <runId>] [--reason <reason>]`.
    argv: (positionals, options) => ({
      ref: positionals[0],
      runId: options.run,
      outcome: options.outcome,
      reason: options.reason,
    }),

    // Confirm the terminal state the transition reached.
    render: (result) => renderWithPropagationWarnings(`Completed run ${result.runId} for ${result.itemRef} — state ${result.state}.`, result),

    // No path in the result (records carry refs) — passes through unchanged.
    json: (result) => result,
  },
};
