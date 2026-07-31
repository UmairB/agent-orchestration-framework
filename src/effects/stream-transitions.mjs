// src/effects/stream-transitions.mjs — the WORK STREAM's transition seam (m42 wave
// (d) leg d4, port 3). The fourth seam, beside run-transitions.mjs (the run store),
// assignment-transitions.mjs (the assignment store) and doc-transitions.mjs (the
// record docs).
//
// THE DEFECT THIS CLOSES. `aof work insert-*` opens a slot by renaming folders and
// rewriting the `depends`/`parent` values that name the moved numbers — and stops.
// But an item's REF is the join key of six other stores, and the renumber told none
// of them: the run records inside the renamed folder still stamp the old ref, the
// Notion sidecar still binds `03` to the page that is now item `04` (so the next
// sync overwrites a page with another item's content — the measured symptom), and
// the streamed doc/run rows, assignment rows and item branches all keep the ref they
// were written with. Nothing was wrong at the call site; the consequence simply had
// no home. It has one now: `stream.reindexed`, whose reactors are declared in
// effects/table.mjs.
//
// File-store discipline is run-transitions.mjs's: write-then-append, with the d5
// reconciler scan closing the window between them. The REMAP is computed by the
// engine BEFORE its renames (work-reindex.mjs's buildRefRemap) — after them the old
// refs exist nowhere to be derived from, so the event must carry them.
import { reindexForInsert } from "../work-reindex.mjs";
import { applicableReactors } from "./table.mjs";
import { openEffectsJournal, appendEvent } from "./journal.mjs";
import { drainEffects, runEffectsEphemeral } from "./dispatch.mjs";
import { reportDegrade } from "../degrade.mjs";

// transitionStreamReindexed(workspace, edge, opts) — open the slot and raise the
// cascade.
//
//   workspace — the loaded workspace (its workDir is reindexed; its projectRoot is
//               the evidence every reactor rebuilds from)
//   edge      — { at, space, parent } (reindexForInsert's own contract; its coded
//               refusals — reindex-invalid-space / reindex-invalid-folder-name /
//               reindex-number-bump-failed — propagate untouched, and NOTHING is
//               appended)
//   opts      — { publisherOptions, journalOptions, drain = true }
//
// Returns reindexForInsert's own result shape (so its callers are unchanged) plus
// `eventId` and the per-reactor `effects`.
//
// A no-op reindex (nothing shifted, so nothing to remap) raises NO event: an
// insert at the end of the stream moves no ref, and a ledger entry claiming
// otherwise would be a lie the crash-recovery drain would faithfully repeat.
export async function transitionStreamReindexed(workspace, { at, space, parent } = {}, opts = {}) {
  const { publisherOptions = null, journalOptions = {}, drain = true } = opts;

  // (1) The FACT — the engine's own guarded renumber.
  const result = await reindexForInsert(workspace.workDir, { at, space, parent });
  if (!Array.isArray(result.remap) || result.remap.length === 0) {
    return { ...result, eventId: null, effects: [] };
  }

  // (2) The EVENT — past tense, carrying the remap as its own evidence.
  const payload = {
    workspaceRoot: workspace.projectRoot ?? null,
    at: result.at,
    space: result.space,
    parent: result.parent,
    shifted: result.shifted,
    remap: result.remap,
  };
  const name = "stream.reindexed";
  // Append-time applicability (m42 wave (d) leg d4, port 4): the uniform seam
  // rule, a pass-through while this event's reactors declare no predicate.
  const reactorCtx = publisherOptions ? { publisherOptions } : {};
  const reactors = await applicableReactors(name, payload, reactorCtx);

  let journal = null;
  try {
    journal = await openEffectsJournal(journalOptions);
  } catch (error) {
    // The ledger's own health never gates the cascade (the d2 rule).
    reportDegrade("effects-journal-open", error);
  }

  if (!journal) {
    const effects = drain ? await runEffectsEphemeral(name, payload, { reactors, ctx: reactorCtx }) : [];
    return { ...result, eventId: null, effects };
  }

  try {
    const { eventId } = appendEvent(journal, { name, payload, source: "stream-transition", now: opts.now }, reactors);
    const effects = drain ? await drainEffects({ journal, eventId, now: opts.now, ctx: reactorCtx }) : [];
    return { ...result, eventId, effects };
  } finally {
    journal.close();
  }
}
