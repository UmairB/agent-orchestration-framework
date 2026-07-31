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
import { completeRun, startRun, retryRun } from "../run-store.mjs";
import { effectsFor } from "./table.mjs";
import { openEffectsJournal, appendEvent } from "./journal.mjs";
import { drainEffects, runEffectsEphemeral } from "./dispatch.mjs";
import { reportDegrade } from "../degrade.mjs";

// transitionRunStart(item, edge, opts) — mint a run and raise `run.started`
// (m42 wave (d) leg d4, port 1). The MINT is the second run-store fact to get a
// seam, for the same reason completeRun did: its consequence (publish-on-mutate)
// was a per-call-site import decision, so three of the four mint sites silently
// had none. Now the ledger decides, and no mint can reach the store without the
// event.
//
//   item — { ref, dir, type } (resolveItemExact's shape)
//   edge — { mode, runId, sessionId, brief, now, node, maxAttempts }
//          mode "retry" resumes a failed run's lineage (retryRun's own contract,
//          its coded rejections — no-retryable-run / not-retryable /
//          attempts-exhausted / duplicate-run — propagating untouched, nothing
//          appended); anything else is the fresh mint (startRun, whose
//          duplicate-run rejection propagates the same way).
//   opts — { workspace, publisherOptions, journalOptions, drain = true }
//          `workspace` ABSENT ⇒ payload workspaceRoot null ⇒ the publish reactor
//          skips. That is how the mint sites that never propagated (run-retry,
//          the worker's two) keep their behaviour while still riding the ledger.
export async function transitionRunStart(item, edge = {}, opts = {}) {
  const { mode = "start", runId, sessionId, brief, now, node = null, maxAttempts } = edge;
  const { workspace = null, publisherOptions = null, journalOptions = {}, drain = true } = opts;

  // (1) The FACT — the store's own guarded mint. A refusal here means no event.
  const record =
    mode === "retry"
      ? await retryRun(item, { runId, maxAttempts, brief, now, node, sessionId })
      : await startRun(item, { sessionId: sessionId ?? null, brief: brief ?? {}, now, node });

  // (2) The EVENT — past tense, carrying its own evidence.
  const payload = {
    ref: record.itemRef,
    runId: record.runId,
    mode,
    attempt: record.attempt ?? null,
    retryOf: record.retryOf ?? null,
    node: record.node ?? null,
    itemDir: item.dir,
    itemType: item.type ?? null,
    workspaceRoot: workspace?.projectRoot ?? null,
  };
  return await raise("run.started", payload, record, { publisherOptions, journalOptions, drain, now });
}

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
    publisherOptions = null,
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
  return await raise("run.completed", payload, record, { publisherOptions, journalOptions, drain, now });
}

// The append-and-drain half both run-store transitions share — one home for the
// "the ledger's own health never gates the cascade" rule (a journal that will not
// open runs the consequences EPHEMERALLY and says so, loudly) and for the
// reactor context the local-locus publish reactor reads.
async function raise(name, payload, record, { publisherOptions, journalOptions, drain, now }) {
  const reactors = effectsFor(name) ?? [];
  const reactorCtx = publisherOptions ? { publisherOptions } : {};

  let journal = null;
  try {
    journal = await openEffectsJournal(journalOptions);
  } catch (error) {
    reportDegrade("effects-journal-open", error);
  }

  if (!journal) {
    const effects = drain ? await runEffectsEphemeral(name, payload, { ctx: reactorCtx }) : [];
    return { record, eventId: null, effects };
  }

  try {
    const { eventId } = appendEvent(journal, { name, payload, source: "run-transition", now }, reactors);
    const effects = drain ? await drainEffects({ journal, eventId, now, ctx: reactorCtx }) : [];
    return { record, eventId, effects };
  } finally {
    journal.close();
  }
}
