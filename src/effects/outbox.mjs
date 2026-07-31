// src/effects/outbox.mjs — the DURABLE OUTBOX for remote-locus effect steps
// (m42 wave (d) leg d3; PRD-command-spine-effects-ledger: "facts over the bridge").
//
// THE MEASURED DEFECT. Worker->control facts were fire-once frames. STATE
// 2026-07-27, verbatim: "Worker startup-reclaim frames are fire-once — the Mac
// worker restarted in the ~3-min window while the control was ALSO down; its
// `failed/daemon-restarted` report for run 0017's stranded worktree died on the
// dead connection, and the control row read a stale `running` for 35+ min". A
// fact that only exists while a socket happens to be open is not a fact, it is a
// hope. This module makes worker->control facts survive the connection.
//
// HOW IT WORKS — no second queue. A step whose locus this process cannot reach is
// ALREADY a durable row in the journal (`effect_steps`, status `pending`); the
// dispatcher leaves it alone (`deferred`). The outbox is the delivery half of
// that same row:
//
//   1. drainOutbox() reads the pending steps whose locus is remote and hands each
//      to the injected `send` — in production, one `effect-step` up-frame on the
//      worker's already-open stream.
//   2. Delivery is NOT completion. The step stays `pending` until the control
//      node ACKs it by (eventId, reactorKey) — the durable receipt. So a frame
//      lost in flight, or a control that died mid-apply, simply redelivers on the
//      next drain. AT-LEAST-ONCE by construction, which is exactly the contract
//      every reactor already promises (idempotent or event-id-deduped).
//   3. A failed SEND is not an attempt. Being offline is the normal case, not a
//      fault, so it never burns the attempts budget — otherwise a worker that
//      restarts while control is down would exhaust its retries against nobody
//      and silently drop the fact, recreating the very defect.
//   4. An ACK carrying a coded refusal ends the step: `skipped`, with the code
//      recorded. Redelivering a fact the control node has REFUSED (an unknown
//      assignment, a row another writer already settled) would loop forever.
import { pendingSteps, markStep } from "./journal.mjs";
import { LOCAL_LOCI } from "./dispatch.mjs";
import { reportDegrade } from "../degrade.mjs";

// The frame kind the outbox speaks. One home for the literal (the
// WORKTREE_CONTENT_FRAME_KIND discipline): the worker's client builds it, the
// control server branches on it, and neither re-spells it.
export const EFFECT_STEP_FRAME_KIND = "effect-step";
export const EFFECT_ACK_FRAME_KIND = "effect-ack";

// remoteSteps(journal, { loci, limit }) — the outbox's work-list: owed steps this
// process cannot run itself. The complement of what drainEffects will execute, so
// a step is never both drained locally and shipped. `integration:*` is EXCLUDED
// from the complement (m42 wave (d) leg d4, port 4): an integration step is
// WORKSPACE-scoped — it drains where its workspace's config and credentials are
// (autoSync's completion drain, or the integration's own verb) — never at the
// control node's store; shipping one would burn it into the bridge door's
// vocabulary refusal.
export function remoteSteps(journal, { loci = LOCAL_LOCI, limit = 100, maxAttempts = 5, eventId = null } = {}) {
  return pendingSteps(journal, { limit, maxAttempts, eventId }).filter(
    (step) => !loci.includes(step.locus) && !String(step.locus).startsWith("integration:"),
  );
}

// drainOutbox({ journal, send, loci, now }) — deliver what is owed elsewhere.
// `send(envelope)` returns the sendFrame shape ({ sent, code? }); anything falsy
// leaves the step pending for the next drain. Returns one outcome per step:
// { eventId, key, locus, status } with status sent|unsent.
export async function drainOutbox({ journal, send, loci = LOCAL_LOCI, limit = 100, now, eventId = null } = {}) {
  const steps = remoteSteps(journal, { loci, limit, eventId });
  const outcomes = [];
  for (const step of steps) {
    const envelope = {
      eventId: step.eventId,
      reactorKey: step.key,
      locus: step.locus,
      name: step.name,
      payload: step.payload,
      at: now ?? new Date().toISOString(),
    };
    let result;
    try {
      result = await send(envelope);
    } catch (error) {
      // A transport fault is a degrade, never a throw into the tick — and never
      // an attempt: the step is still owed, and the next drain will try again.
      reportDegrade("effect-outbox-send", error, { path: `${step.name}/${step.key}` });
      result = { sent: false, code: "send-threw" };
    }
    outcomes.push({
      eventId: step.eventId,
      key: step.key,
      locus: step.locus,
      status: result?.sent ? "sent" : "unsent",
      ...(result?.code ? { code: result.code } : {}),
    });
  }
  return outcomes;
}

// applyEffectAck(journal, { eventId, reactorKey, ok, code, error }, { now }) — the
// DURABLE RECEIPT. Called by the worker's ack handler with the control node's
// verdict for one (eventId, reactorKey):
//   ok            -> done. The fact landed; the step is paid.
//   coded refusal -> skipped, code recorded. The control node has DECIDED; a
//                    redelivery would loop forever against the same verdict.
//   fault         -> failed. Retryable while under the attempts ceiling.
// Unknown ids are ignored (an ack for a step this journal never owed — a stale
// reconnect echo, or another node's) rather than fabricating a row.
export function applyEffectAck(journal, { eventId, reactorKey, ok = false, code = null, error = null } = {}, { now } = {}) {
  if (!eventId || !reactorKey) return { applied: false, code: "effect-ack-invalid" };
  const owed = journal.db
    .prepare("SELECT status FROM effect_steps WHERE event_id = ? AND reactor_key = ?")
    .get(eventId, reactorKey);
  if (!owed) return { applied: false, code: "effect-ack-unknown-step" };
  if (owed.status === "done" || owed.status === "skipped") {
    // A duplicate ack for a settled step: the at-least-once tax, paid silently.
    return { applied: false, code: "effect-ack-already-settled" };
  }
  if (ok) {
    markStep(journal, eventId, reactorKey, { status: "done", now });
    return { applied: true, status: "done" };
  }
  if (code) {
    markStep(journal, eventId, reactorKey, { status: "skipped", error: code, now });
    return { applied: true, status: "skipped", code };
  }
  markStep(journal, eventId, reactorKey, { status: "failed", error: error ?? "effect-step-refused", now });
  return { applied: true, status: "failed" };
}
