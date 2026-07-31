// src/run-store.mjs — the run-record store, the state-machine validator, the
// runs/ path seam, and (milestone 20) the RESILIENCE spine: failure
// classification + attempt ceiling, the retry-lineage mint, the heartbeat +
// restart-time orphan-reclaim scan, the dedup guard + collision-safe mint, and the
// atomic persist. The SPINE the run commands and the autonomous skill all couple
// through (milestone 19 story 00; extended by milestone 20 story 00).
//
// A RUN is a first-class, durably-recorded entity distinct from the durable work
// ITEM (the PRD "Issue != Task" mechanic). Each run is its OWN JSON file, named by
// its runId, under the item's runs/ directory (ARCHITECTURE 19/ADR-002; the
// node-partitioned shape is 26/ADR-001 — the m22-frozen convention made real):
//
//   wiki/work/NN_type_slug/runs/<run-id>.json                       — a milestone's runs (flat / single-node)
//   wiki/work/NN…/stories/SS_story_…/runs/<run-id>.json             — a story's runs (its OWN folder)
//   wiki/work/NN…/runs/<node>/<run-id>.json                         — a node-partitioned run (26/ADR-001)
//
// The runs/ log is DERIVED (19/ADR-002): rebuildable (the dir is wholly
// regenerable), prunable (delete a file ⇒ prune a run), and — as of milestone 26 —
// node-PARTITIONED: 19's promised <node>/ segment landed as the additive
// runNodeRecordPath builder, the record's one additive `node` key decides placement
// (record → path, never path → record on write), and every reader sees the UNION of
// flat entries + one level of node subdirs. The node id arrives as DATA (a mint
// option / record key) — this store reads no config and imports no mesh module. Item
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
// m42 item 3 — every former silent catch reports a coded degrade event.
import { reportDegrade } from "./degrade.mjs";

// ----------------------------------------------------------- error helper ----

// Run-store errors carry `.code` (and a `.status` for the future board face),
// matching the command error contract (src/command-error.mjs) so a face maps
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

// The ONE run-file LEAF form — the runId stem is assembled in exactly one place so
// the flat and node-partitioned builders can never diverge on the filename
// (19/ADR-002's single-seam discipline; acd-run-partition-ready pins one stem site).
function runFileLeaf(runId) {
  return runId + ".json";
}

// The FLAT run-file path builder (19/ADR-002) — the single-node legacy shape,
// unchanged: a run minted with no node id still lands here, byte-identical to today.
export function runRecordPath(item, runId) {
  return path.join(runsDir(item), runFileLeaf(runId));
}

// The NODE-PARTITIONED run-file path builder (26/ADR-001 — the m22-frozen convention
// made real): EXACTLY runRecordPath with one <node>/ segment inserted before the
// run-id leaf — join(runsDir(item), node, runId + ".json"), byte-identical to the
// shape mesh-store.mjs froze in milestone 22. The builder's AUTHORITY lives HERE
// (mesh-store.mjs RE-EXPORTS it — mesh-store imports run-store, so the reverse home
// would be an import cycle). A PURE builder: it writes nothing by itself; the
// persist derives placement FROM the record's `node` key (record → path, one
// direction — never path → record on write).
export function runNodeRecordPath(item, node, runId) {
  return path.join(runsDir(item), node, runFileLeaf(runId));
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

// How many run files already live under runs/ — the positional seq SEED, counted
// over the UNION of flat entries + one level of node subdirs (26/ADR-001: the seq
// seed counts the union, so two nodes minting at the same instant get distinct ids
// even before their trees converge). Absence tolerant (no runs/ dir ⇒ 0; an
// unreadable subdir counts 0), the same ENOENT→[] discipline work.mjs:readDirSafe
// uses. The mint path's write-if-absent retry (mintRun) makes the seq
// collision-safe under concurrency (closing 19/R2b) — this count is only the seed.
async function countRunFiles(item) {
  let entries = [];
  try {
    entries = await readdir(runsDir(item), { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.isDirectory()) {
      try {
        const nested = await readdir(path.join(runsDir(item), entry.name));
        count += nested.filter((name) => name.endsWith(".json")).length;
      } catch (error) {
        // An unreadable node subdir counts as empty (absence is benign).
      reportDegrade("run-store", error); }
      continue;
    }
    if (entry.name.endsWith(".json")) count += 1;
  }
  return count;
}

// Persist a record AS-IS through the ATOMIC temp+rename seam (20/ADR-007): pretty
// JSON, every write under runs/ (the write seam). PLACEMENT DERIVES FROM THE RECORD
// (26/ADR-001.3): record.node set ⇒ the node-partitioned runNodeRecordPath; null ⇒
// the flat legacy runRecordPath — ONE direction (record → path), on EVERY write, so
// completion / heartbeat / reclaim persist a node-partitioned run back AT its node
// path, never relocated. A kill mid-write leaves the PRIOR file intact (the rename
// is atomic), never a torn record. The mkdir stays belt-and-braces (writeText also
// mkdir's its dirname, covering the <node>/ subdir) and is the store's only fs
// write-verb call, joining the runs/ seam (the write-scope guard).
async function persist(item, record) {
  await mkdir(runsDir(item), { recursive: true });
  await writeText(
    record.node ? runNodeRecordPath(item, record.node, record.runId) : runRecordPath(item, record.runId),
    JSON.stringify(record, null, 2)
  );
}

// Build the frozen run-record object literal — EXACTLY these FOURTEEN keys, in this
// order (26/ADR-001 SUPERSEDES 20/ADR-001's thirteen-key freeze, by the same
// discipline that freeze used to supersede 19/ADR-003's nine): the prior thirteen —
// the original nine (runId, itemRef, state, attempt, outcome, sessionId, brief,
// createdAt, updatedAt) plus the four resilience keys (failureReason, heartbeatAt,
// retryOf, reclaimedAt) — UNCHANGED in name/order/meaning, then the ONE additive
// partition-provenance key `node` (string | null, defaulting null): a run read in
// isolation knows its owner without path archaeology. attempt + retryOf carry the
// retry lineage (20/ADR-003); a fresh start is attempt 1, retryOf null. The brief is
// persisted OPAQUE/verbatim (never reshaped).
function buildRecord({ runId, itemRef, sessionId, brief, createdAt, attempt = 1, retryOf = null, node = null }) {
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
    node: node ?? null,
  };
}

// Normalise a record read off disk to the frozen fourteen keys, in order — a
// milestone-19 nine-key record and a milestone-20 thirteen-key record read
// forward-compatibly, each missing resilience key — and the missing `node` — as
// null (26/ADR-001 + 20/ADR-001 + 19/ADR-002 "absence is benign": every generation
// of record is the SAME record through this one normalization, never a distinct
// shape). The original keys are preserved verbatim.
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
    node: raw.node ?? null,
  };
}

// ------------------------------------------------------------- the store ----

// The shared mint path for startRun + retryRun (20/ADR-006/007): the DEDUP guard
// ("no duplicate non-terminal run per item" — giving 19's reserved queued state its
// guard), the COLLISION-SAFE write-if-absent mint (closing 19/R2b — a runId
// collision bumps seq and retries rather than the second mint silently overwriting
// the first), and the ATOMIC persist (20/ADR-007). attempt/retryOf carry the retry
// lineage (20/ADR-003); a fresh start passes the defaults (attempt 1, retryOf null).
async function mintRun(item, { sessionId = null, brief = {}, now, attempt = 1, retryOf = null, node = null } = {}) {
  // Dedup: an item must never have two NON-TERMINAL (queued|running) runs in flight —
  // and readRuns is the UNION read (26/ADR-001.4), so a peer NODE's non-terminal run
  // blocks a mint exactly like a local one: two nodes' records can never hide a
  // duplicate from each other. A second mint while one exists is rejected
  // duplicate-run, minting nothing — the anti-loop BACKSTOP the skill leans on, and
  // the producer guard for 19's queued.
  const existing = await readRuns(item);
  if (existing.some((run) => run.state === "queued" || run.state === "running")) {
    throw runError("a non-terminal run already exists for this item", "duplicate-run", 409);
  }

  const createdAt = now ?? new Date().toISOString();
  // Collision-safe mint: seed seq from the UNION file count, and probe the UNION for
  // the minted runId (26/ADR-001.4 — runId uniqueness is per-ITEM across ALL node
  // subdirs): if the id exists ANYWHERE in the union (an interleaved mint — possibly
  // a peer node's — won the race), bump seq and retry so two mints at the identical
  // instant get DISTINCT ids — never a silent overwrite, even across partitions.
  let seq = await countRunFiles(item);
  for (;;) {
    const runId = mintRunId(createdAt, seq);
    if (await findRunPath(item, runId)) {
      seq += 1;
      continue;
    }
    const record = buildRecord({ runId, itemRef: item.ref, sessionId, brief, createdAt, attempt, retryOf, node });
    await persist(item, record);
    return record;
  }
}

// Create + persist ONE FRESH run, ALREADY in `running` (19/ADR-001: work:run-start
// creates-and-begins). attempt 1, retryOf null, sessionId as supplied (or null) —
// it never carries a prior session (the contrast 20/ADR-003 turns on). Subject to
// the dedup guard + collision-safe mint. The optional `node` (26/ADR-001) is
// INJECTED DATA — the COMMAND layer passes config.mesh.nodeId when mesh is
// configured (story 02's pass-through); the store never reads config, and the
// no-node mint stays the flat single-node behaviour, byte-identical to today.
export async function startRun(item, { sessionId = null, brief = {}, now, node = null } = {}) {
  return mintRun(item, { sessionId, brief, now, node });
}

// Read an item's runs — the UNION of flat entries + ONE level of node subdirs
// (26/ADR-001.4: one item, one run history, whatever partition each record lives
// in) — NORMALISED to the frozen fourteen keys and ordered ASCENDING by runId (the
// lexically-sortable id ⇒ creation order, regardless of directory walk order).
// Absence-tolerant: no runs/ dir OR an empty dir ⇒ [], never an ENOENT throw
// (19/ADR-002). The torn-file tolerance is PER ENTRY and spans partitions: a
// torn/unparseable file (a non-atomic write interrupted mid-flight, an external
// edit) — flat OR inside a node subdir — is SKIPPED rather than blinding the rest
// of the union. The runs/ log is derived + rebuildable, so a corrupt record
// degrades to one MISSING run — the same "absence is benign" discipline as the
// absent-dir read.
export async function readRuns(item) {
  let entries = [];
  try {
    entries = await readdir(runsDir(item), { withFileTypes: true });
  } catch {
    return [];
  }
  const records = [];
  const readInto = async (filePath) => {
    try {
      records.push(normalizeRecord(JSON.parse(await readFile(filePath, "utf8"))));
    } catch (error) {
      // Torn-file tolerance: skip the one bad entry, keep the rest of the union.
      reportDegrade("run-store", error); }
  };
  for (const entry of entries) {
    if (entry.isDirectory()) {
      // One level of node subdirs — each <sub>/<run-id>.json resolved through THE
      // builder (runNodeRecordPath), the same normalization + torn-skip as flat.
      let nested = [];
      try {
        nested = await readdir(path.join(runsDir(item), entry.name));
      } catch {
        continue;
      }
      for (const name of nested) {
        if (!name.endsWith(".json")) continue;
        await readInto(runNodeRecordPath(item, entry.name, name.slice(0, -".json".length)));
      }
      continue;
    }
    if (!entry.name.endsWith(".json")) continue;
    await readInto(path.join(runsDir(item), entry.name));
  }
  records.sort((a, b) => (a.runId < b.runId ? -1 : a.runId > b.runId ? 1 : 0));
  return records;
}

// Resolve a runId to its on-disk path across the UNION (26/ADR-001.4): the flat
// legacy path first, else ONE level of node subdirs. ENOENT-tolerant (an absent
// runs/ dir resolves null); returns null when the id lives nowhere in the union.
// Consumers: readRun (so applyTransition/heartbeat/completeRun target a run in ANY
// partition) and the mint's write-if-absent probe (union-spanning id uniqueness).
async function findRunPath(item, runId) {
  const flat = runRecordPath(item, runId);
  if (existsSync(flat)) return flat;
  let entries = [];
  try {
    entries = await readdir(runsDir(item), { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const nested = runNodeRecordPath(item, entry.name, runId);
    if (existsSync(nested)) return nested;
  }
  return null;
}

// Read one run record by runId (the runId is the filename stem), resolved across
// the union, normalised forward. An id found nowhere still reads (and throws) at
// the flat path — the pre-partition ENOENT semantics, preserved.
async function readRun(item, runId) {
  const target = (await findRunPath(item, runId)) ?? runRecordPath(item, runId);
  const body = await readFile(target, "utf8");
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
// The optional `node` (26/ADR-001, the startRun idiom) is INJECTED DATA the COMMAND
// layer passes when mesh is configured, so the lineage mint lands under the RETRIER's
// node partition; the store still reads no config, and the no-node retry stays flat.
// The optional `sessionId` OVERRIDE (26/ADR-006.4 — the same additive pattern): when
// ABSENT (undefined) the retry carries the prior sessionId unchanged (today's
// same-node resume semantics, byte-identical); when PASSED (a string or null) it
// REPLACES the carry — the fleet-reclaim winner mints the reclaimed lineage under its
// OWN session (or none), never the dead peer's (resume semantics do not cross hosts).
export async function retryRun(item, { runId, maxAttempts = Infinity, brief, now, node = null, sessionId } = {}) {
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
  // Resume: a NEW run carrying the prior sessionId (unless the caller overrides —
  // the cross-host reclaim never inherits a dead peer's session), attempt + 1,
  // retryOf linking the lineage. The dedup guard in mintRun still applies (a
  // self-retry while this item's own run is in flight is refused duplicate-run —
  // the anti-loop backstop).
  return mintRun(item, {
    sessionId: sessionId !== undefined ? sessionId : prior.sessionId,
    brief: brief ?? prior.brief ?? {},
    now,
    attempt: prior.attempt + 1,
    retryOf: prior.runId,
    node,
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
//
// EXPORTED (milestone 23 / story 00, ADR-002): the node-staleness predicate in
// src/mesh-presence.mjs REUSES this exact shape rather than re-deriving it, so the
// run layer (m20) and the node layer (m23) PROVABLY share ONE staleness definition
// (the genuine 23 → 20 seam — never a parallel heartbeat, the SPEC §Dependencies
// constraint). The presence record carries a heartbeatAt but no updatedAt, so its
// caller passes a presence-shaped { heartbeatAt } object (the `?? updatedAt` fallback
// is inert there — presence always has a heartbeatAt when staleness is computed).
export function isStale(run, nowMs, stalenessThreshold) {
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
