// src/run-store.mjs — the run-record store, the state-machine validator, the
// runs/ path seam, and (milestone 20) the RESILIENCE spine: failure
// classification + attempt ceiling, the retry-lineage mint, the heartbeat +
// restart-time orphan-reclaim scan, the dedup guard + collision-safe mint, and the
// atomic persist. The SPINE the run commands and the autonomous skill all couple
// through (milestone 19 story 00; extended by milestone 20 story 00).
//
// A RUN is a first-class, durably-recorded entity distinct from the durable work
// ITEM (the PRD "Issue != Task" mechanic). Each run is its OWN JSON file, named by
// its runId, under the item's runs/ directory (ARCHITECTURE 19/ADR-002):
//
//   wiki/work/NN_type_slug/runs/<run-id>.json                       — a milestone's runs
//   wiki/work/NN…/stories/SS_story_…/runs/<run-id>.json             — a story's runs (its OWN folder)
//
// The runs/ log is DERIVED (19/ADR-002): rebuildable (the dir is wholly
// regenerable), prunable (delete a file ⇒ prune a run), partition-ready (per-run
// files under a path-built dir, so milestone 26's <node>/ segment slots in as ONE
// additive edit to runRecordPath, with zero schema/command/face change). Item
// frontmatter status stays the single source of truth — this store NEVER writes a
// record doc; every write joins runsDir(item) (the write-scope guard). That guard
// is why this module references ZERO record-doc filename (SPEC.md/STORY.md/STATE.md/
// SESSION.md): record-doc resolution lives in work.mjs, never here. The status
// rollback a reclaim triggers is the work.mjs writer the COMMAND layer calls over
// reclaimStaleRuns's return value — never written from inside this store (20/ADR-005).
import path from "node:path";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
// 20/ADR-007 — every run-record write routes through the atomic temp+rename seam
// (closing 19/R2a). run-store finally couples to fs.mjs like its 15 peers; the lone
// non-consumer the graph flagged.
import { writeText } from "./fs.mjs";

// ----------------------------------------------------------- error helper ----

// Run-store errors carry `.code` (and a `.status` for the future board face),
// matching the command error contract (src/commands/errors.mjs) so a face maps
// them uniformly. The state-machine illegal case throws code "illegal-transition";
// the milestone-20 mint/retry guards throw "duplicate-run" / "not-retryable" /
// "attempts-exhausted" / "no-retryable-run".
function runError(message, code, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

// --------------------------------------------------------- the path seam ----

// THE single run-path seam (19/ADR-002). runs/ sits inside the item's own folder
// (item.dir — the story's own folder for a NN/SS ref, the milestone's for NN), so
// a story's runs live under the story, never pooled at the milestone.
export function runsDir(item) {
  return path.join(item.dir, "runs");
}

// The ONLY run-file path builder — built FROM runsDir so milestone 26's <node>/
// dimension is a pure additive delta here (join(runsDir(item), node, runId + ".json"))
// with no change to the schema, the store API, or any face.
export function runRecordPath(item, runId) {
  return path.join(runsDir(item), runId + ".json");
}

// ----------------------------------------------------- the state machine ----

// The CLOSED transition table (19/ADR-001), legal edges ONLY. queued is the legal,
// persisted-representable pre-running state (its outbound edges are validated). It
// gains its GUARD — not yet a producer — in this milestone's dedup (20/ADR-006):
// no verb mints a queued run, but the dedup check READS state ∈ {queued, running}.
// Everything not listed — every self-loop, every move out of a terminal state
// (done/failed/cancelled are TERMINAL) — is illegal.
const LEGAL_TRANSITIONS = new Set([
  "queued>running",
  "queued>cancelled",
  "running>done",
  "running>failed",
  "running>cancelled",
]);

// A PURE function over a (from, to) pair — the one authority both the store and
// the run commands share, so a bad transition can never slip through a face.
export function isLegalTransition(from, to) {
  return LEGAL_TRANSITIONS.has(`${from}>${to}`);
}

// ------------------------------------------- failure classification (20) ----

// The CLOSED retryable/non-retryable classification (20/ADR-002), the
// isLegalTransition sibling (the 06/ADR-003 single-pure-resolver precedent):
//   runtime_offline / timeout  → retryable     (infra: host down / no verdict in time)
//   agent_error                → non-retryable  (the agent ran and produced a bad output)
//   anything else, or null     → non-retryable  (FAIL CLOSED — an unknown reason never auto-retries)
// PURE: reads no clock/fs/config. A face never improvises which failures retry.
const RETRYABLE_REASONS = new Set(["runtime_offline", "timeout"]);

export function isRetryable(failureReason) {
  return RETRYABLE_REASONS.has(failureReason);
}

// shouldRetry ANDs the classification with the attempt ceiling (20/ADR-002): true
// IFF the reason is retryable AND the record is still below the ceiling. PURE over
// (record, maxAttempts) — the resolved ceiling is passed in; the store never reads
// config (08/ADR-002 basis-neutral). Fails closed at attempt >= maxAttempts.
export function shouldRetry(record, maxAttempts) {
  return isRetryable(record.failureReason) && record.attempt < maxAttempts;
}

// ---------------------------------------------------- run-record helpers ----

// The frozen runId form (19/ADR-003): "<createdAt-compact>-<seq>" where compact is
// the createdAt with colon/dot/dash punctuation stripped (YYYYMMDDTHHMMSSsssZ) and
// seq is the count of pre-existing runs/ files, zero-padded to 4 digits. So the
// first run of an item gets 0000, two runs at the same instant get 0000 then 0001,
// and a wipe resets the count → the next run is 0000 again. ids sort chronologically
// AND are unique. The compactStamp UTC-Z toISOString() assumption is PRESERVED
// across every new persist path (20/ADR-007) — never inject a non-UTC clock.
function compactStamp(createdAt) {
  return createdAt.replace(/[-:.]/g, "");
}

function mintRunId(createdAt, seq) {
  return `${compactStamp(createdAt)}-${String(seq).padStart(4, "0")}`;
}

// How many run files already live under runs/ — the positional seq SEED. Absence
// tolerant (no runs/ dir ⇒ 0), the same ENOENT→[] discipline work.mjs:readDirSafe uses.
// The mint path's write-if-absent retry (mintRun) makes the seq collision-safe under
// concurrency (closing 19/R2b) — this count is only the seed.
async function countRunFiles(item) {
  let entries = [];
  try {
    entries = await readdir(runsDir(item));
  } catch {
    return 0;
  }
  return entries.filter((name) => name.endsWith(".json")).length;
}

// Persist a record AS-IS through the ATOMIC temp+rename seam (20/ADR-007): pretty
// JSON, every write under runs/ (the write seam). A kill mid-write leaves the PRIOR
// file intact (the rename is atomic), never a torn record. The mkdir stays
// belt-and-braces (writeText also mkdir's its dirname) and is the store's only fs
// write-verb call, joining the runs/ seam (the write-scope guard).
async function persist(item, record) {
  await mkdir(runsDir(item), { recursive: true });
  await writeText(runRecordPath(item, record.runId), JSON.stringify(record, null, 2));
}

// Build the frozen run-record object literal — EXACTLY these THIRTEEN keys, in this
// order (20/ADR-001 SUPERSEDES 19/ADR-003's nine-key freeze): the original nine
// (runId, itemRef, state, attempt, outcome, sessionId, brief, createdAt, updatedAt)
// UNCHANGED in name/order/meaning, then the four additive resilience keys
// (failureReason, heartbeatAt, retryOf, reclaimedAt), each scalar, defaulting null.
// attempt + retryOf carry the retry lineage (20/ADR-003); a fresh start is attempt 1,
// retryOf null. The brief is persisted OPAQUE/verbatim (never reshaped).
function buildRecord({ runId, itemRef, sessionId, brief, createdAt, attempt = 1, retryOf = null }) {
  return {
    runId,
    itemRef,
    state: "running",
    attempt,
    outcome: null,
    sessionId: sessionId ?? null,
    brief: brief ?? {},
    createdAt,
    updatedAt: createdAt,
    failureReason: null,
    heartbeatAt: null,
    retryOf: retryOf ?? null,
    reclaimedAt: null,
  };
}

// Normalise a record read off disk to the frozen thirteen keys, in order — a
// milestone-19 nine-key record reads forward-compatibly, each missing resilience
// key as null (20/ADR-001 + 19/ADR-002 "absence is benign"). The original keys are
// preserved verbatim; the four resilience keys default null when absent.
function normalizeRecord(raw) {
  return {
    runId: raw.runId,
    itemRef: raw.itemRef,
    state: raw.state,
    attempt: raw.attempt,
    outcome: raw.outcome ?? null,
    sessionId: raw.sessionId ?? null,
    brief: raw.brief ?? {},
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
    failureReason: raw.failureReason ?? null,
    heartbeatAt: raw.heartbeatAt ?? null,
    retryOf: raw.retryOf ?? null,
    reclaimedAt: raw.reclaimedAt ?? null,
  };
}

// ------------------------------------------------------------- the store ----

// The shared mint path for startRun + retryRun (20/ADR-006/007): the DEDUP guard
// ("no duplicate non-terminal run per item" — giving 19's reserved queued state its
// guard), the COLLISION-SAFE write-if-absent mint (closing 19/R2b — a runId
// collision bumps seq and retries rather than the second mint silently overwriting
// the first), and the ATOMIC persist (20/ADR-007). attempt/retryOf carry the retry
// lineage (20/ADR-003); a fresh start passes the defaults (attempt 1, retryOf null).
async function mintRun(item, { sessionId = null, brief = {}, now, attempt = 1, retryOf = null } = {}) {
  // Dedup: an item must never have two NON-TERMINAL (queued|running) runs in flight.
  // A second mint while one exists is rejected duplicate-run, minting nothing — the
  // anti-loop BACKSTOP the skill leans on, and the producer guard for 19's queued.
  const existing = await readRuns(item);
  if (existing.some((run) => run.state === "queued" || run.state === "running")) {
    throw runError("a non-terminal run already exists for this item", "duplicate-run", 409);
  }

  const createdAt = now ?? new Date().toISOString();
  // Collision-safe mint: seed seq from the file count, but if the minted runId file
  // already exists (an interleaved mint won the race), bump seq and retry so two
  // mints at the identical instant get DISTINCT ids — never a silent overwrite.
  let seq = await countRunFiles(item);
  for (;;) {
    const runId = mintRunId(createdAt, seq);
    if (existsSync(runRecordPath(item, runId))) {
      seq += 1;
      continue;
    }
    const record = buildRecord({ runId, itemRef: item.ref, sessionId, brief, createdAt, attempt, retryOf });
    await persist(item, record);
    return record;
  }
}

// Create + persist ONE FRESH run, ALREADY in `running` (19/ADR-001: work:run-start
// creates-and-begins). attempt 1, retryOf null, sessionId as supplied (or null) —
// it never carries a prior session (the contrast 20/ADR-003 turns on). Subject to
// the dedup guard + collision-safe mint.
export async function startRun(item, { sessionId = null, brief = {}, now } = {}) {
  return mintRun(item, { sessionId, brief, now });
}

// Read an item's runs, NORMALISED to the frozen thirteen keys and ordered ASCENDING
// by runId (the lexically-sortable id ⇒ creation order). Absence-tolerant: no runs/
// dir OR an empty dir ⇒ [], never an ENOENT throw (19/ADR-002).
export async function readRuns(item) {
  let entries = [];
  try {
    entries = await readdir(runsDir(item));
  } catch {
    return [];
  }
  const records = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    // Tolerate a torn/unparseable run file (a non-atomic write interrupted mid-flight,
    // an external edit): SKIP it rather than letting one bad file blind the WHOLE item's
    // history. The runs/ log is derived + rebuildable (19/ADR-002), so a corrupt record
    // degrades to one MISSING run — the same "absence is benign" discipline as the
    // absent-dir read above.
    try {
      records.push(normalizeRecord(JSON.parse(await readFile(path.join(runsDir(item), name), "utf8"))));
    } catch {
      continue;
    }
  }
  records.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  return records;
}

// Read one run record by runId (the runId is the filename stem), normalised forward.
async function readRun(item, runId) {
  const body = await readFile(runRecordPath(item, runId), "utf8");
  return normalizeRecord(JSON.parse(body));
}

// Apply a transition with VALIDATE-BEFORE-WRITE ordering ("an illegal transition
// writes nothing"): read → compute (from,to) → validate → (legal) write / (illegal)
// throw illegal-transition. An illegal transition leaves the on-disk file
// BYTE-IDENTICAL. On a →failed transition, an optional failureReason is recorded
// verbatim (20/ADR-001 the producer's store half; the closed-set safety stays with
// the classifier failing closed, ADR-002, NOT a store rejection); reclaimedAt is set
// when the reclaim scan supplies it. The other resilience keys are PRESERVED unless
// the transition sets them. `now` is the injected UTC-Z clock (20/ADR-007).
export async function applyTransition(item, runId, toState, { now, failureReason = null, reclaimedAt = null } = {}) {
  const record = await readRun(item, runId);
  const from = record.state;
  if (!isLegalTransition(from, toState)) {
    throw runError(`illegal transition ${from} -> ${toState}`, "illegal-transition", 409);
  }
  // Legal: terminal target equals its state (outcome == state on terminal,
  // 19/ADR-003), bump updatedAt, preserve runId/createdAt/everything else.
  const updated = {
    ...record,
    state: toState,
    outcome: toState,
    updatedAt: now ?? new Date().toISOString(),
  };
  if (toState === "failed") {
    updated.failureReason = failureReason ?? record.failureReason ?? null;
  }
  if (reclaimedAt) {
    updated.reclaimedAt = reclaimedAt;
  }
  await persist(item, updated);
  return updated;
}

// The terminal transition running→outcome on the target run. Target resolution: a
// supplied runId wins; otherwise the item's single in-flight `running` run (0 →
// no-running-run, >1 → ambiguous-run). On --outcome failed an optional failureReason
// is written onto the record (20/ADR-001 producer store half); a clean done/cancelled
// records null. applyTransition naturally rejects a non-legal target (the outcome-set
// validation done|failed|cancelled is the COMMAND's job).
export async function completeRun(item, { runId, outcome, failureReason = null, now } = {}) {
  let targetRunId = runId;
  if (!targetRunId) {
    const running = (await readRuns(item)).filter((run) => run.state === "running");
    if (running.length === 0) {
      throw runError("no running run to complete for this item", "no-running-run", 409);
    }
    if (running.length > 1) {
      throw runError("more than one running run — runId is required", "ambiguous-run", 409);
    }
    targetRunId = running[0].runId;
  }
  return applyTransition(item, targetRunId, outcome, { failureReason, now });
}

// Resume a retryable failed run's lineage (20/ADR-003): resolve the prior run (a
// supplied runId, else the item's most-recent terminal `failed` run), consult the
// classification + ceiling, and on a YES mint a NEW run that CARRIES the prior
// sessionId forward with attempt = prior.attempt + 1 and retryOf = prior.runId
// (reusing the dedup + collision-safe + atomic mint path). A non-retryable prior →
// not-retryable; a ceiling-exhausted prior → attempts-exhausted; no failed run at
// all → no-retryable-run. Each rejection mints NO run and leaves the prior
// byte-unchanged. maxAttempts is the resolved ceiling passed in (the store reads no
// config); a fresh start (startRun) stays untouched — it never carries a prior session.
export async function retryRun(item, { runId, maxAttempts = Infinity, brief, now } = {}) {
  const runs = await readRuns(item);
  let prior;
  if (runId) {
    prior = runs.find((run) => run.runId === runId) ?? null;
  } else {
    prior = [...runs].reverse().find((run) => run.state === "failed") ?? null;
  }
  if (!prior) {
    throw runError("no retryable failed run for this item", "no-retryable-run", 409);
  }
  // The two distinct gates (kept separate so the codes stay distinct): a
  // non-retryable reason (agent_error / unknown / null) vs a retryable reason already
  // at/over the ceiling. The classifier (ADR-002) is the single authority.
  if (!isRetryable(prior.failureReason)) {
    throw runError(`run ${prior.runId} failed with a non-retryable reason`, "not-retryable", 409);
  }
  if (prior.attempt >= maxAttempts) {
    throw runError(`run ${prior.runId} has exhausted its ${maxAttempts} attempt(s)`, "attempts-exhausted", 409);
  }
  // Resume: a NEW run carrying the prior sessionId, attempt + 1, retryOf linking the
  // lineage. The dedup guard in mintRun still applies (a self-retry while this item's
  // own run is in flight is refused duplicate-run — the anti-loop backstop).
  return mintRun(item, {
    sessionId: prior.sessionId,
    brief: brief ?? prior.brief ?? {},
    now,
    attempt: prior.attempt + 1,
    retryOf: prior.runId,
  });
}

// ------------------------------------------ liveness + orphan reclaim (20) ----

// Stamp a running run's liveness (20/ADR-004): bump heartbeatAt (and updatedAt) to
// the supplied UTC-Z `now` WITHOUT changing state (a no-state-change persist — state
// stays running, outcome stays null). The stamp lives ON the record, not a sidecar.
export async function heartbeat(item, runId, { now } = {}) {
  const record = await readRun(item, runId);
  const stamp = now ?? new Date().toISOString();
  const updated = { ...record, heartbeatAt: stamp, updatedAt: stamp };
  await persist(item, updated);
  return updated;
}

// A running run is STALE when now - heartbeatAt exceeds the threshold; a run that
// NEVER beat (heartbeatAt null) falls back to now - updatedAt (20/ADR-004). Pure over
// the passed-in values — the store reads no clock/config. Strict `>` so a run exactly
// AT the threshold is still live.
function isStale(run, nowMs, stalenessThreshold) {
  const liveness = run.heartbeatAt ?? run.updatedAt;
  const age = nowMs - Date.parse(liveness);
  return age > stalenessThreshold;
}

// The restart-time orphan-reclaim scan (20/ADR-004). It WALKS RUN RECORDS BY PATH —
// it takes the LIST of items to scan as an ARGUMENT and iterates each item's runs/
// (no single-node / single-directory assumption baked in), so milestone 26's fleet
// scan passes a wider item set with NO rewrite (the 26 → 20 seam). For each STALE
// `running` run it force-fails via the legal running → failed edge (applyTransition),
// setting failureReason = runtime_offline (a crashed host is infra, so the reclaimed
// run stays RETRYABLE per ADR-002) and reclaimedAt = now (distinguishing a reclaimed
// failure from an operator-reported one). Every non-stale, queued, and terminal run
// is left BYTE-UNCHANGED (19/R4). Returns the list of reclaimed { item, run } entries
// so the COMMAND layer can call the work.mjs status-rollback writer over them
// (ADR-005 — the scan ORCHESTRATES, work.mjs WRITES; the store never writes frontmatter).
export async function reclaimStaleRuns(items, { now, stalenessThreshold = Infinity } = {}) {
  const nowIso = now ?? new Date().toISOString();
  const nowMs = Date.parse(nowIso);
  const reclaimed = [];
  for (const item of items) {
    const runs = await readRuns(item);
    for (const run of runs) {
      if (run.state !== "running") continue;
      if (!isStale(run, nowMs, stalenessThreshold)) continue;
      const failed = await applyTransition(item, run.runId, "failed", {
        now: nowIso,
        failureReason: "runtime_offline",
        reclaimedAt: nowIso,
      });
      reclaimed.push({ item, run: failed });
    }
  }
  return reclaimed;
}

// Prune ONE run by deleting its file — file-by-file, not an aggregate rewrite (the
// partition-ready payoff). A missing file is a clean no-op (swallow ENOENT): absence
// is benign, the same discipline as the absent-runs/ read (19/ADR-002).
export async function pruneRun(item, runId) {
  try {
    await unlink(runRecordPath(item, runId));
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
}
