// src/effects/run-transitions.mjs — the run store's TRANSITION seam (m42 wave (d) leg
// d2; PRD flow: face → invoke → transition → drain). transitionRunComplete is
// the ONLY place that both writes the run-completion fact AND raises its
// `run.completed` event — callers stop re-remembering the cascade (rollback,
// publish, …) because they can no longer reach the fact-write without the
// event. The store (run-store.mjs) stays mesh-blind and event-blind; the seam
// wraps it, never replaces it (the write seams are kept, not replaced).
//
// File-store discipline: the run record is a FILE store, so this is
// write-then-append (fact first, event second) with the d5 reconciler scan
// closing the crash window between them — chosen over 2PC, knowingly (PRD
// §settled design). A crash after the write leaves a fact without its event;
// the scan re-derives it. A crash after the append leaves PENDING steps any
// later drain pays out — the property the whole arc exists for.
import { completeRun } from "../run-store.mjs";
import { effectsFor } from "./table.mjs";
import { openEffectsJournal, appendEvent } from "./journal.mjs";
import { drainEffects, runEffectsEphemeral } from "./dispatch.mjs";
import { reportDegrade } from "../degrade.mjs";

// transitionRunComplete(item, edge, opts) — complete the run fact, append
// `run.completed` to the per-node journal, and (by default) drain the event's
// own local-locus steps synchronously so every existing caller keeps its
// cascade-before-return behaviour. Returns { record, eventId, effects }.
//
//   item — { ref, dir, type } (resolveItemExact's shape; type feeds recordDoc)
//   edge — { runId, outcome, failureReason, now } (completeRun's own contract;
//          its coded rejections — no-running-run / ambiguous-run /
//          illegal-transition — propagate untouched, and NOTHING is appended)
//   opts — { workspace, journalOptions, drain = true }
export async function transitionRunComplete(item, { runId, outcome, failureReason = null, now } = {}, opts = {}) {
  const {
    workspace = null,
    journalOptions = {},
    drain = true,
  } = opts;

  // (1) The FACT — the store's own guarded terminal transition. A refusal here
  // means no event: facts precede announcements.
  const record = await completeRun(item, { runId, outcome, failureReason, now });

  // (2) The EVENT — past tense, carrying its own evidence (never a ping that
  // forces reactors to re-read racing state).
  const payload = {
    ref: record.itemRef,
    runId: record.runId,
    outcome,
    failureReason: record.failureReason ?? null,
    node: record.node ?? null,
    itemDir: item.dir,
    itemType: item.type ?? null,
    workspaceRoot: workspace?.projectRoot ?? null,
  };
  const reactors = effectsFor("run.completed") ?? [];

  let journal = null;
  try {
    journal = await openEffectsJournal(journalOptions);
  } catch (error) {
    // The ledger's own health never gates the cascade: run it ephemerally (the
    // consequences still happen, just not durably) and say so, loudly.
    reportDegrade("effects-journal-open", error);
  }

  if (!journal) {
    const effects = drain ? await runEffectsEphemeral("run.completed", payload) : [];
    return { record, eventId: null, effects };
  }

  try {
    const { eventId } = appendEvent(journal, { name: "run.completed", payload, source: "run-transition", now }, reactors);
    const effects = drain ? await drainEffects({ journal, eventId, now }) : [];
    return { record, eventId, effects };
  } finally {
    journal.close();
  }
}
