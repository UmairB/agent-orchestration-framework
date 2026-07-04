// src/mesh-presence.mjs — the PRESENCE dimension (milestone 23 / story 00, ADR-002):
// the presence-record assembly + the node-staleness predicate + the activeRuns read
// of the run records + the absence-tolerant presence read. The git-side, poll-for-
// durability substrate — it works over GIT ALONE (no relay; story 01 is parallel,
// story 02 adds the best-effort relay push on top). It EXTENDS milestone 20's
// single-node run liveness into a fleet (node) signal rather than standing up a
// parallel heartbeat (the genuine 23 → 20 seam, SPEC §Dependencies).
//
// THE WRITE-SCOPE DISCIPLINE (ADR-002 / fitness #3, acd-presence-write-scope, the
// 22/ADR-002 carry-forward): every presence write joins the m22-RESERVED
// presenceRecordPath / meshDir seam and routes through the atomic temp+rename
// writeText seam (19/R2) — NEVER a bare writeFile. This module references ZERO
// record-doc filename (SPEC.md/STORY.md/STATE.md/SESSION.md): record-doc resolution
// lives in work.mjs, never here. The presence record is persisted OPAQUE / AS-IS
// (pretty JSON), so a read-back is byte-equivalent.
//
// THE RECORD IS DERIVED / REBUILDABLE (22/ADR-003 discipline): a projection of the
// install's clock + its run records, NEVER a second authority. Re-deriving it from
// the same inputs yields a content-equivalent record. activeRuns is a READ of the run
// records m20/m19 own — it does NOT re-implement a run scan and does NOT mutate a run
// record (it reads the run dimension and publishes to the presence dimension).
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
// 19/R2 / 20/ADR-007 — every record write routes through the atomic temp+rename seam
// (the Windows renameWithRetry is load-bearing on this platform). Never a bare writeFile.
import { writeText } from "./fs.mjs";
// The m22-RESERVED presence seam + the partition root — presence writes the SAME
// path-safe, one-node-per-path partition form node records use (22/ADR-002). meshDir
// is re-exported so a consumer (the write-scope grep + mesh:status) reaches the root
// through one import.
import { meshDir, presenceRecordPath } from "./mesh-store.mjs";
// The m20 liveness source: readRuns(item) reads an item's run records (the 23 → 20 → 19
// seam — a READ, never a re-scan), and isStale is the EXACT staleness shape the node
// layer reuses (never a parallel heartbeat — the SPEC §Dependencies constraint). Both
// are imported, not re-derived, so the two layers provably share one definition.
import { readRuns, isStale } from "./run-store.mjs";

// The DOCUMENTED default node-staleness threshold, in seconds (ADR-002 — the
// config.mesh.presence.stalenessSeconds fallback). A node whose last heartbeat is
// older than this is rendered stale; a config value that is absent / malformed /
// negative / null falls back to THIS single source so the "documented default"
// assertion has one home. 90s sits comfortably above the ~10–30s git-sync cadence
// (PRD KR1) — a node that has synced within the last sync window is never falsely
// flagged stale.
export const DEFAULT_PRESENCE_STALENESS_SECONDS = 90;

// ----------------------------------------------------- the activeRuns read ----

// The in-flight run ids across the work items — READ from the run records (the
// 23 → 20 → 19 seam, ADR-002). For each item, readRuns(item) (m20's normalised read),
// filtered to state === "running" (the SOLE in-flight state — queued is pre-running,
// done/failed/cancelled are terminal, per the closed transition table), mapped to
// runId. This is a READ: it calls NO write/transition verb (heartbeat/persist/
// applyTransition), so a heartbeat leaves every run record BYTE-UNCHANGED. The item
// list is passed in (the reclaimStaleRuns item-list-as-input shape) — no single-
// directory assumption baked in.
export async function readActiveRuns(items) {
  const runIds = [];
  for (const item of items) {
    const runs = await readRuns(item);
    for (const run of runs) {
      if (run.state === "running") runIds.push(run.runId);
    }
  }
  return runIds;
}

// ------------------------------------------------- the record assembly ----

// Assemble THIS node's presence record — the FROZEN schema, EXACTLY these four keys
// in this order (ADR-002): { nodeId, heartbeatAt, activeRuns, aofVersion }. The
// task-00 "carries no keys beyond the frozen schema" + byte-equivalence assertions
// turn on this key order. nodeId is the SAME stable id the node record carries (read
// it, never re-derived here); heartbeatAt is the injected/wall-clock ISO-8601 UTC-Z
// instant; activeRuns is the run-record read; aofVersion is the provenance string.
// A PURE projection of its inputs — the same inputs yield a content-equivalent record
// (rebuildability), so it is never a second authority.
export function assemblePresenceRecord({ nodeId, heartbeatAt, activeRuns, aofVersion }) {
  return {
    nodeId,
    heartbeatAt,
    activeRuns,
    aofVersion,
  };
}

// Publish a node's presence record as exactly ONE git-tracked presence/<id>.json,
// written atomically (writeText temp+rename, 19/R2). Persisted OPAQUE / AS-IS — pretty
// JSON, no normalization — so a read-back is byte-equivalent (mirroring
// publishNodeRecord). The mkdir is belt-and-braces (writeText also mkdir's its
// dirname) and joins the presence/ seam under meshDir — the only directory write site,
// joining the partition seam (the write-scope guard, fitness #3).
export async function publishPresenceRecord(workspace, id, record) {
  await mkdir(path.join(meshDir(workspace), "presence"), { recursive: true });
  await writeText(presenceRecordPath(workspace, id), JSON.stringify(record, null, 2));
}

// ------------------------------------------------------ absence-tolerant read ----

// Read ONE presence record by node id, parsed off disk. Absence-tolerant: a node id
// with no presence record (ENOENT, or any read miss) reads as null — a node that has
// never beat (or a peer not yet synced) is NOT an error, NEVER a thrown error (the
// run-store / mesh-store ENOENT→null discipline). A read mutates nothing.
export async function readPresenceRecord(workspace, id) {
  try {
    return JSON.parse(await readFile(presenceRecordPath(workspace, id), "utf8"));
  } catch {
    return null;
  }
}

// Read every published presence record under presence/, parsed. Absence-tolerant: no
// presence/ dir ⇒ [] (the same absence-is-benign discipline). A torn/unparseable file
// is skipped rather than blinding the whole list — the records are derived/rebuildable.
// (mesh:status consumes this.) A read mutates nothing.
export async function readPresenceRecords(workspace) {
  let entries = [];
  try {
    entries = await readdir(path.join(meshDir(workspace), "presence"));
  } catch {
    return [];
  }
  const records = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      records.push(JSON.parse(await readFile(path.join(meshDir(workspace), "presence", name), "utf8")));
    } catch {
      continue;
    }
  }
  return records;
}

// --------------------------------------- the read-side liveness merge ----

// mergePresence(diskPresence, cachedPresence) → the FRESHEST of the two presence records
// (milestone 23 / story 02 / ADR-003, finding F1 — the read-side mirror of the two-publish
// write path). mesh:status reconciles the ≤30s git-durable record (disk) with the ≤5s
// relay liveness cache (the subscriber's applied signal) through ONE render, so a peer's
// pushed change surfaces over the relay WITHOUT waiting for a git sync, yet git stays the
// authority:
//   - disk null      ⇒ the cache is all we have (a peer heard over the relay before its
//                      record synced) — return cached ?? null.
//   - cached null    ⇒ no relay signal — return disk (the git-only floor, unchanged).
//   - both present   ⇒ LATEST WINS by Date.parse(heartbeatAt), but a TIE breaks in favour
//                      of the GIT-DURABLE disk record — git is the authority, so once git
//                      carries the same heartbeat the render reconciles to the durable bytes
//                      (the cache never becomes a second system of record; ADR-002 / fitness
//                      #1). A cache entry only wins while it is STRICTLY newer than disk.
// This is a PURE projection over its two inputs — no fs, no clock.
export function mergePresence(diskPresence, cachedPresence) {
  if (diskPresence == null) return cachedPresence ?? null;
  if (cachedPresence == null) return diskPresence;
  const diskMs = Date.parse(diskPresence.heartbeatAt);
  const cachedMs = Date.parse(cachedPresence.heartbeatAt);
  // The cache wins ONLY when it is strictly newer than the git-durable record; an equal or
  // unparseable-cache heartbeat reconciles to the durable disk bytes (git breaks the tie).
  if (Number.isFinite(cachedMs) && (!Number.isFinite(diskMs) || cachedMs > diskMs)) {
    return cachedPresence;
  }
  return diskPresence;
}

// ------------------------------------------- fabric reachability (milestone 33) ----

// resolvePeerReachability(online, dialAddress, options) → "reachable" | "unreachable
// (check shields-up/ACL)" | "offline" (milestone 33 / story 01, ADR-002.3). `Online`
// (resolvePeers' fast pre-filter, src/mesh-fabric.mjs) is necessary-but-not-sufficient
// for dialable (RESEARCH §5) — a connect attempt against the peer's dialAddress is
// GROUND TRUTH:
//   - online:false      ⇒ "offline" — NO dial is attempted (an offline peer is not
//                          worth a connect probe; RESEARCH §5's silent shields-up/ACL
//                          failure only matters for a peer the fabric reports up).
//   - online:true, dial resolves  ⇒ "reachable".
//   - online:true, dial rejects   ⇒ "unreachable (check shields-up/ACL)" — a HANDLED,
//                          DISTINCT outcome (shields-up / ACL-deny / a peer that
//                          dropped between snapshot and dial, RESEARCH §5), NEVER a
//                          crash — the dial's rejection is caught here, not propagated.
// THE INJECTED DIALER (the createRelayClient.connect() precedent, mesh-relay-
// client.mjs:121-214): `options.dial` is a `(dialAddress) => Promise<void>` closure a
// test scripts to resolve/reject; production has no default (task 05's @manual soak
// exercises a real socket probe) — an absent dialer with online:true is treated as
// "reachable" is NOT assumed; callers that care about a real dial MUST inject one.
// (review Fix 3): with NO injected dialer, "reachable" is NEVER returned — the code
// must not silently ASSUME a probe that never ran. An online peer with no dialer
// resolves to "online (undialed)", an honest distinct outcome from BOTH "reachable"
// (a dialer actually resolved) and "unreachable (check shields-up/ACL)" (a dialer
// actually rejected) — a caller that never injects a dialer sees exactly what it did:
// no dial was attempted, so nothing beyond Online is known.
export async function resolvePeerReachability(online, dialAddress, options = {}) {
  if (online !== true) return "offline";
  const dial = typeof options?.dial === "function" ? options.dial : null;
  if (dial == null) return "online (undialed)";
  try {
    await dial(dialAddress);
    return "reachable";
  } catch {
    return "unreachable (check shields-up/ACL)";
  }
}

// ----------------------------------------------------- node staleness ----

// A node is STALE when now − heartbeatAt > threshold — the EXACT milestone-20 isStale
// shape (strict `>`, UTC-Z Date.parse) applied to the presence record's heartbeatAt
// (ADR-002 — the genuine 23 → 20 seam; isStale is IMPORTED from run-store, not
// re-derived, so the run layer and the node layer share ONE definition). A node AT the
// threshold (age == threshold) is STILL LIVE (60 > 60 is false). `nowMs` and
// `thresholdMs` are the caller's resolved milliseconds; the presence record is shaped
// { heartbeatAt } so isStale's `heartbeatAt ?? updatedAt` fallback resolves to
// heartbeatAt. PURE over its inputs (the 22/R2 inject-the-clock discipline) — never
// wall-clock.
export function isNodeStale(presence, nowMs, thresholdMs) {
  return isStale(presence, nowMs, thresholdMs);
}

// Resolve the node-staleness threshold (in SECONDS) from config, falling back to the
// DOCUMENTED default (ADR-002). Read off config.mesh?.presence?.stalenessSeconds via
// the raw optional-chain idiom (NOT config-editor.mjs — its whitelist would drop an
// unknown mesh block on rewrite, the m22 story-01 lesson). An absent / non-number /
// non-finite / negative / null value falls back to DEFAULT_PRESENCE_STALENESS_SECONDS
// — the single documented source. Zero is a valid (if aggressive) threshold and is
// honoured; only a meaningless value falls back.
export function resolveStalenessSeconds(config) {
  const configured = config?.mesh?.presence?.stalenessSeconds;
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return DEFAULT_PRESENCE_STALENESS_SECONDS;
}
