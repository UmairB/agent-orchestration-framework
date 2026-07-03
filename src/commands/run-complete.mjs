// work:run-complete — the terminal transition running→outcome on a run (ADR-001/003).
//
// A thin WRITE wrapper over story 00's src/run-store.mjs. The run ORDER is
// load-bearing: (1) validate the outcome is one of the closed set done|failed|
// cancelled BEFORE resolving anything (catches --outcome bogus AND --outcome "");
// (2) resolve the target EXACT (resolveItemExact — a typo never completes a run on
// the wrong item, mirroring run-start's write-isolation); (3) delegate to the store's
// completeRun, letting its no-running-run / ambiguous-run / illegal-transition errors
// (each carrying .code) propagate to the face. runId defaults to the item's single
// in-flight running run; an explicit runId disambiguates when more than one is in
// flight. The store writes only under runs/; this command never touches frontmatter.
import { resolveItemExact } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { completeRun } from "../run-store.mjs";
import { rollbackItemStatus } from "../work.mjs";
// m26/ADR-003.2 — the holder's lease release at completion: an OWN-PATH state write
// (its own claim file flips state:"released" — never a delete, never a foreign write),
// wired here on ALL THREE terminal outcomes (done|failed|cancelled: a failed or
// cancelled run must hand the item back too, or a crash-free failure would wedge the
// item exactly like a crash). Gated on config.mesh — an unconfigured install never
// reads or writes a lease (byte-identical to today).
import { releaseLease } from "../mesh-lease.mjs";
import { meshNodeIdOf } from "./mesh-gate.mjs";

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

    // (3) Let the store perform the terminal transition; its no-running-run /
    // ambiguous-run / illegal-transition errors (each carrying .code) propagate. The
    // reason is written onto failureReason only on a → failed transition (store-side).
    const reason = typeof input.reason === "string" ? input.reason : null;
    const record = await completeRun(item, { runId: input.runId, outcome, failureReason: reason, now: input.now });

    // (3.5) THE LEASE RELEASE (m26/ADR-003.2 — the lifecycle behind the EXISTING verb,
    // zero new commands): under the config.mesh gate, flip THIS node's OWN claim file
    // for the item to state:"released" — on EVERY terminal outcome (the run above just
    // reached done|failed|cancelled), so the item reads claimable again the moment its
    // run terminates. An own-path STATE write (never a delete — releaseLease is
    // absence-tolerant: no own claim ⇒ a clean no-op). Unconfigured mesh ⇒ the whole
    // branch is skipped: no lease read, no lease write, byte-identical to today. The
    // gate is the ONE shared predicate (mesh-gate.mjs) — it can never drift from the
    // claim path's.
    const meshNodeId = meshNodeIdOf(ctx.workspace.config);
    if (meshNodeId) {
      await releaseLease(ctx.workspace, item.ref, meshNodeId);
    }

    // (4) Status rollback (20/ADR-005): a run completed as FAILED rolls its in-progress
    // item back to not-started so the stream is left honest — the failed path CALLS the
    // work.mjs writer (best-effort: an item not in-progress / without a record doc is a
    // no-op, the completion still succeeds; any other rollback fault propagates).
    if (outcome === "failed") {
      try {
        await rollbackItemStatus(item, "not-started");
      } catch (error) {
        if (error.code !== "rollback-not-applicable") throw error;
      }
    }
    return record;
  },

  cli: {
    // `aof work run-complete <ref> --outcome done|failed|cancelled [--run <runId>] [--reason <reason>]`.
    argv: (positionals, options) => ({
      ref: positionals[0],
      runId: options.run,
      outcome: options.outcome,
      reason: options.reason,
    }),

    // Confirm the terminal state the transition reached.
    render: (result) => `Completed run ${result.runId} for ${result.itemRef} — state ${result.state}.`,

    // No path in the result (records carry refs) — passes through unchanged.
    json: (result) => result,
  },
};
