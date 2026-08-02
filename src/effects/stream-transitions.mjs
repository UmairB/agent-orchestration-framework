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
import { reindexForInsert, refsTouchedByInsert } from "../work-reindex.mjs";
import { resolveWorkspaceId } from "../workspace-identity.mjs";
// m43 / ADR-003 + ADR-004 — the CONTROL-SIDE MUTATION door. STATE's settled rule
// ("control-side writes refused mid-phase, allowed at a gate") lands in the SAME guard
// as the mint door rather than as a second rule, and it lands HERE — the single seam
// both insert call sites already route through — rather than in the cache's upsert
// seam: an insert RENUMBERS FOLDERS while a worker holds a worktree full of the old
// refs, which is the destructive case the lock exists for, and it is this seam that
// opens the slot.
import { guardItemLock, lockContextFor } from "../item-lock.mjs";
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

  // (0) THE LOCK — in front of the fact, so a refused insert renames not one folder.
  // Every ref this insert would renumber must be free: a nested insert under a held
  // milestone, and a top-level insert that shifts a held milestone's own number, are
  // both refused with the ONE code naming the holder. The touched set comes from the
  // engine's OWN selection (refsTouchedByInsert), never a second derivation.
  await guardItemLock(await refsTouchedByInsert(workspace.workDir, { at, space, parent }), {
    lock: lockContextFor(workspace, opts.publisherOptions ?? {}),
  });

  // (1) The FACT — the engine's own guarded renumber.
  const result = await reindexForInsert(workspace.workDir, { at, space, parent });
  if (!Array.isArray(result.remap) || result.remap.length === 0) {
    return { ...result, eventId: null, effects: [] };
  }

  // (2) The EVENT — past tense, carrying the remap as its own evidence. It also
  // carries the workspace's RESOLVED id (m42 wave (d) leg d5): the control-facts
  // remap may be applied on a machine where workspaceRoot names a checkout that
  // does not exist (a worker-side insert arriving over the d3 bridge), so the id
  // must ride the payload rather than be re-derived from a path.
  const payload = {
    workspaceRoot: workspace.projectRoot ?? null,
    workspaceId: resolveWorkspaceId(workspace) ?? null,
    at: result.at,
    space: result.space,
    parent: result.parent,
    shifted: result.shifted,
    remap: result.remap,
  };
  const name = "stream.reindexed";
  // Append-time applicability (m42 wave (d) leg d4, port 4): the seam owes only
  // what can apply — here the mesh predicate on the control-facts remap.
  const reactorCtx = {
    ...(publisherOptions ? { publisherOptions } : {}),
    workspace,
  };
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
