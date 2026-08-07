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
import { completeRun, startRun, retryRun, reclaimRun, staleRunningRuns } from "../run-store.mjs";
import { applicableReactors } from "./table.mjs";
import { openEffectsJournal, appendEvent } from "./journal.mjs";
import { drainEffects, runEffectsEphemeral, reachableLoci } from "./dispatch.mjs";
import { reportDegrade } from "../degrade.mjs";
// m43 / ADR-003 — THE item lock. It sits INSIDE this seam, in front of the fact, and
// not in front of it at each of the five mint call sites: a rule living at whichever
// call site needed it first is not a rule (assignment-transitions.mjs's discipline,
// copied deliberately). No mint can reach the run store without passing it.
import { guardItemLock } from "../item-lock.mjs";

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
//          including 348's `force` override of the session_limit PARK gate,
//          its coded rejections — no-retryable-run / not-retryable /
//          attempts-exhausted / duplicate-run — propagating untouched, nothing
//          appended); anything else is the fresh mint (startRun, whose
//          duplicate-run rejection propagates the same way).
//   opts — { workspace, lock, publisherOptions, journalOptions, drain = true }
//          `workspace` ABSENT ⇒ payload workspaceRoot null ⇒ the publish reactor
//          skips. That is how the mint sites that never propagated (run-retry,
//          the worker's two) keep their behaviour while still riding the ledger.
//          `lock` — m43/ADR-003's item-lock context, `{ workspaceId, byAssignment }`,
//          DELIBERATELY a separate opt from `workspace` (ADR-010/R1.3): reusing
//          `workspace` would set the event's workspaceRoot and flip run-retry into
//          publishing as a side effect. A mint made UNDER an assignment names it in
//          `byAssignment` and is admitted by that identity; every other mint onto a
//          held execution scope is refused `item-locked-by-assignment`.
export async function transitionRunStart(item, edge = {}, opts = {}) {
  const { mode = "start", runId, sessionId, brief, now, node = null, maxAttempts, force = false } = edge;
  const { workspace = null, lock, publisherOptions = null, journalOptions = {}, drain = true } = opts;

  // (0) THE LOCK — the ONE enforcement door, in front of the fact. It outranks the
  // store's own refusals (duplicate-run, no-retryable-run …) because a held item's
  // honest answer is "held", never a store-level cause that is only incidentally true.
  await guardItemLock(item.ref, { lock, workspace });

  // (1) The FACT — the store's own guarded mint. A refusal here means no event.
  const record =
    mode === "retry"
      ? await retryRun(item, { runId, maxAttempts, brief, now, node, sessionId, force })
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
  return await raise("run.started", payload, record, { workspace, publisherOptions, journalOptions, drain, now });
}

// transitionRunComplete(item, edge, opts) — complete the run fact, append
// `run.completed` to the per-node journal, and (by default) drain the event's
// own local-locus steps synchronously so every existing caller keeps its
// cascade-before-return behaviour. Returns { record, eventId, effects }.
//
//   item — { ref, dir, type } (resolveItemExact's shape; type feeds recordDoc)
//   edge — { runId, outcome, failureReason, resumeAfter, now } (completeRun's own
//          contract; `resumeAfter` is the 348 park stamp, resolved at the command
//          edge and passed through as data — this seam does no clock arithmetic;
//          its coded rejections — no-running-run / ambiguous-run /
//          illegal-transition — propagate untouched, and NOTHING is appended)
//   opts — { workspace, journalOptions, drain = true }
export async function transitionRunComplete(item, { runId, outcome, failureReason = null, resumeAfter = null, now } = {}, opts = {}) {
  const {
    workspace = null,
    publisherOptions = null,
    journalOptions = {},
    drain = true,
  } = opts;

  // (1) The FACT — the store's own guarded terminal transition. A refusal here
  // means no event: facts precede announcements.
  const record = await completeRun(item, { runId, outcome, failureReason, resumeAfter, now });

  // (2) The EVENT — past tense, carrying its own evidence (never a ping that
  // forces reactors to re-read racing state).
  const payload = {
    ref: record.itemRef,
    runId: record.runId,
    outcome,
    failureReason: record.failureReason ?? null,
    resumeAfter: record.resumeAfter ?? null,
    node: record.node ?? null,
    itemDir: item.dir,
    itemType: item.type ?? null,
    workspaceRoot: workspace?.projectRoot ?? null,
  };
  return await raise("run.completed", payload, record, { workspace, publisherOptions, journalOptions, drain, now });
}

// transitionRunReclaimed(item, edge, opts) — THE reclaim edge, shared by both
// halves (m42 wave (d) leg d4, port 2).
//
// THE DEFECT THIS CLOSES. A reclaim is a run COMPLETION (failed/runtime_offline),
// but neither reclaim path went through the completion seam, so neither raised
// `run.completed` and the cascade was whatever each half remembered: the restart
// scan's caller (commands/run-start.mjs) looped over the returned entries calling
// `rollbackItemStatus` INLINE — a hand copy of the ledger's own rollback-status
// reactor — while the CONTROL tick (mesh-assignment-reclaim.mjs) rolled nothing
// back and published nothing at all. Two implementations of one consequence, one
// of them silently missing. Both now settle here, so both inherit the SAME
// declared cascade.
//
//   item — { ref, dir, type }
//   edge — { runId, now }
//   opts — { workspace, publisherOptions, journalOptions, drain = true }
export async function transitionRunReclaimed(item, { runId, now } = {}, opts = {}) {
  const { workspace = null, publisherOptions = null, journalOptions = {}, drain = true } = opts;

  // (1) The FACT — the store's ONE reclaim edge.
  const record = await reclaimRun(item, runId, { now });

  // (2) The EVENT — a reclaim IS a completion, so it is `run.completed` rather
  // than a parallel vocabulary; `reclaimed: true` marks how the run ended for any
  // reactor that cares, and the outcome stays `failed` so rollback-status fires.
  const payload = {
    ref: record.itemRef,
    runId: record.runId,
    outcome: "failed",
    failureReason: record.failureReason ?? null,
    reclaimed: true,
    node: record.node ?? null,
    itemDir: item.dir,
    itemType: item.type ?? null,
    workspaceRoot: workspace?.projectRoot ?? null,
  };
  return await raise("run.completed", payload, record, { workspace, publisherOptions, journalOptions, drain, now });
}

// transitionStaleRunsReclaimed(items, edge, opts) — the RESTART-SCAN half over the
// same edge: select the stale `running` runs (the store's own pure scan — the
// staleness rule is never re-derived here), then settle each through
// transitionRunReclaimed. Returns one { item, record, eventId, effects } per
// reclaimed run, so the caller can report what it reclaimed without owning any
// consequence of it.
export async function transitionStaleRunsReclaimed(items, { now, stalenessThreshold } = {}, opts = {}) {
  const nowIso = now ?? new Date().toISOString();
  const settled = [];
  for (const candidate of await staleRunningRuns(items, { now: nowIso, stalenessThreshold })) {
    const { item } = candidate;
    settled.push({ item, ...(await transitionRunReclaimed(item, { runId: candidate.runId, now: nowIso }, opts)) });
  }
  return settled;
}

// The append-and-drain half both run-store transitions share — one home for the
// "the ledger's own health never gates the cascade" rule (a journal that will not
// open runs the consequences EPHEMERALLY and says so, loudly) and for the
// reactor context the local-locus publish reactor reads.
//
// Two port-4 responsibilities live here (m42 wave (d) leg d4): the reactors are
// resolved through applicableReactors — the APPEND-TIME applicability evaluation,
// so a consequence that can never apply to this workspace is not owed — and the
// drain's loci come from reachableLoci(workspace), which is what lets a
// completion in an `autoSync: true` workspace pay its own integration step in
// place while every other posture leaves it deferred for the integration's verb.
async function raise(name, payload, record, { workspace, publisherOptions, journalOptions, drain, now }) {
  const reactorCtx = {
    ...(publisherOptions ? { publisherOptions } : {}),
    ...(workspace ? { workspace } : {}),
  };
  const reactors = await applicableReactors(name, payload, reactorCtx);
  const loci = reachableLoci(workspace);

  let journal = null;
  try {
    journal = await openEffectsJournal(journalOptions);
  } catch (error) {
    reportDegrade("effects-journal-open", error);
  }

  if (!journal) {
    const effects = drain ? await runEffectsEphemeral(name, payload, { reactors, loci, ctx: reactorCtx }) : [];
    return { record, eventId: null, effects };
  }

  try {
    const { eventId } = appendEvent(journal, { name, payload, source: "run-transition", now }, reactors);
    const effects = drain ? await drainEffects({ journal, eventId, loci, now, ctx: reactorCtx }) : [];
    return { record, eventId, effects };
  } finally {
    journal.close();
  }
}
