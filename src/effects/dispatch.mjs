// src/effects/dispatch.mjs — the topology-aware effects dispatcher (m42 wave (d)
// leg d2). Runs the steps a journal owes whose locus THIS process can reach;
// leaves remote-locus steps pending for the outbox (leg d3). Two drain modes by
// design: the CLI face drains synchronously before exit (per-reactor outcomes in
// the result envelope); daemons drain on the converge tick (d3). Failures are
// events, never silence: a failing reactor marks its step `failed` (retried
// while under the attempts ceiling), reports a coded degrade, and NEVER aborts
// the drain — one consequence's fault cannot strand its siblings.
import { EFFECTS } from "./table.mjs";
import { pendingSteps, markStep } from "./journal.mjs";
import { reportDegrade } from "../degrade.mjs";

// The loci a plain CLI process on a checkout can reach: its own repo folder and
// its own node-local projection/logs. integration:* joins in d4.
export const LOCAL_LOCI = Object.freeze(["checkout", "local"]);

// The loci a CONTROL-NODE process can reach (m42 wave (d) leg d3): everything a
// local process can, PLUS the authoritative mesh store it is the writer for.
// A worker process is NOT given this set — its `control-store` steps stay
// pending and travel by outbox (outbox.mjs), which is the whole point: a
// consequence owed to another node's store is DURABLE, not fire-and-forget.
export const CONTROL_LOCI = Object.freeze(["checkout", "local", "control-store"]);

// reachableLoci(workspace) — the loci a drain acting FOR this workspace may run
// (m42 wave (d) leg d4, port 4). An `integration:<name>` locus is WORKSPACE-
// scoped, not node-scoped: reachability is the workspace's own config (the
// credentials reference lives there), and the operator decision that makes a
// completion's own drain perform the external write is that integration's
// `autoSync: true`. Without the opt-in the base set is returned unchanged and
// the integration step stays deferred — owed to the integration's own verb
// (notion: sync-work), which passes the locus explicitly when the operator runs
// it. No workspace ⇒ the base set (the worker-site posture).
export function reachableLoci(workspace, base = LOCAL_LOCI) {
  const integrations = workspace?.config?.work?.integrations;
  if (!integrations || typeof integrations !== "object") return base;
  const extra = Object.entries(integrations)
    .filter(([, config]) => config?.autoSync === true)
    .map(([name]) => `integration:${name}`);
  return extra.length > 0 ? [...base, ...extra] : base;
}

export const EFFECT_MAX_ATTEMPTS = 5;

// drainEffects — execute what is owed. Scope with `eventId` for the
// transition-time sync drain (this command's own cascade); omit it for the
// crash-recovery sweep (anything any process left pending). Returns one outcome
// per considered step: { eventId, event, key, locus, status, detail?, error? }
// with status done|failed|deferred|skipped.
export async function drainEffects({
  journal,
  effects = EFFECTS,
  loci = LOCAL_LOCI,
  eventId = null,
  limit = 100,
  maxAttempts = EFFECT_MAX_ATTEMPTS,
  now,
  // Reactor context — handles this process already holds that a reactor would
  // otherwise have to re-open (the control tick's open projection store is the
  // driving case). A reactor MUST work without it (opening and closing its own),
  // so a crash-recovery drain from any process behaves identically.
  ctx = {},
} = {}) {
  // The crash-recovery sweep (no eventId) fetches ONLY steps this drain can run:
  // legitimately-deferred steps (a record-only integration:notion backlog) are
  // oldest-first in the journal, so without the locus filter they would consume
  // the whole limit window and starve every payable step behind them (m42 wave
  // (d) leg d4, port 4). An eventId-scoped drain keeps the full fetch — its
  // caller reads the `deferred` outcomes off the envelope (run-complete's wire).
  const steps = pendingSteps(journal, { eventId, maxAttempts, limit, ...(eventId ? {} : { loci }) });
  const outcomes = [];
  for (const step of steps) {
    const base = { eventId: step.eventId, event: step.name, key: step.key, locus: step.locus };
    if (!lociReach(loci, step.locus)) {
      // Not ours to run — the outbox/tick with that locus drains it (d3/d4).
      outcomes.push({ ...base, status: "deferred" });
      continue;
    }
    const reactor = (effects[step.name] ?? []).find((entry) => entry.key === step.key);
    if (!reactor) {
      // Vocabulary drift: the step was materialised by a build whose EFFECTS
      // declared this reactor; this build does not. Loud, terminal, visible.
      markStep(journal, step.eventId, step.key, { status: "skipped", error: "unknown-reactor", now });
      reportDegrade("effect-unknown-reactor", new Error(`${step.name}/${step.key} has no reactor in this build`));
      outcomes.push({ ...base, status: "skipped", error: "unknown-reactor" });
      continue;
    }
    try {
      const detail = await reactor.apply({ eventId: step.eventId, name: step.name, payload: step.payload }, ctx);
      markStep(journal, step.eventId, step.key, { status: "done", now });
      outcomes.push({ ...base, status: "done", ...(detail !== undefined ? { detail } : {}) });
    } catch (error) {
      markStep(journal, step.eventId, step.key, { status: "failed", error: String(error?.message ?? error), now });
      reportDegrade("effect-failed", error, { path: `${step.name}/${step.key}` });
      outcomes.push({ ...base, status: "failed", error: String(error?.message ?? error) });
    }
  }
  return outcomes;
}

// runEffectsEphemeral — the journal-less fallback (sqlite unavailable / journal
// open refused): the cascade still RUNS — behaviour is never gated on the
// ledger's own health — it is just not durable, and says so via degrade at the
// caller. Same outcome shape as drainEffects. `reactors` is the seam's OWN
// applicability-filtered resolution (applicableReactors) so the ephemeral path
// owes exactly what the journaled path would have appended; absent, the full
// declared set runs (the pre-predicate behaviour).
export async function runEffectsEphemeral(name, payload, { effects = EFFECTS, reactors = null, loci = LOCAL_LOCI, ctx = {} } = {}) {
  const outcomes = [];
  for (const reactor of reactors ?? effects[name] ?? []) {
    const base = { eventId: null, event: name, key: reactor.key, locus: reactor.locus };
    if (!lociReach(loci, reactor.locus)) {
      outcomes.push({ ...base, status: "deferred" });
      continue;
    }
    try {
      const detail = await reactor.apply({ eventId: null, name, payload }, ctx);
      outcomes.push({ ...base, status: "done", ...(detail !== undefined ? { detail } : {}) });
    } catch (error) {
      reportDegrade("effect-failed", error, { path: `${name}/${reactor.key}` });
      outcomes.push({ ...base, status: "failed", error: String(error?.message ?? error) });
    }
  }
  return outcomes;
}

function lociReach(loci, locus) {
  return loci.includes(locus);
}
