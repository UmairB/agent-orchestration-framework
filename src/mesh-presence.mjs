// src/mesh-presence.mjs — the PRESENCE dimension (milestone 23 / story 00, ADR-002):
// the presence-record assembly + the node-staleness predicate + the activeRuns read
// of the run records + the absence-tolerant presence read. Presence is a derived
// machine-global record under the global mesh root; it is not a second authority over
// the canonical run/work records.
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
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
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
// milestone 38 / story 00 (ADR-001/002) — the session dimension: presence READS the
// live (non-expired) session records for this node's projection, exactly as it reads
// (never mutates) the run records for activeRuns. isSessionLive/resolveSessionTtlSeconds
// are the ONE shared TTL predicate (never a parallel staleness rule here either).
import { readSessionRecordsForNode, isSessionLive, resolveSessionTtlSeconds } from "./mesh-session.mjs";
// milestone 38 / story 00 (ADR-003) — resolveNodeWorkspaces is the ONE seam that
// reaches the global store to read the global_node_workspaces registry. It is the
// SANCTIONED indirection mesh-launcher.mjs calls (never importing
// global-work-store.mjs / openGlobalWorkProjectionStore itself — the SAME
// acd-global-publisher-single-seam discipline mesh-assignment-reclaim.mjs's
// runControlDispatchReclaimTick already keeps for the dispatch/reclaim driver): the
// launcher gains no NEW direct SQLite dependency, it reaches the registry only
// through this presence-dimension seam.
import { openGlobalWorkProjectionStore } from "./global-work-store.mjs";
import { globalMeshPaths } from "./workspace.mjs";

// The DOCUMENTED default node-staleness threshold, in seconds (ADR-002 — the
// config.mesh.presence.stalenessSeconds fallback). A node whose last heartbeat is
// older than this is rendered stale; a config value that is absent / malformed /
// negative / null falls back to THIS single source so the "documented default"
// assertion has one home. 90s sits comfortably above the default propagation cadence,
// so a node that has published recently is not falsely flagged stale.
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

// ----------------------------------------------------- the sessions[] read ----

// readLiveSessions(workspace, nodeId, options) — the LIVE session-record projection
// (ADR-001/002) that becomes the presence record's `sessions` array. Reads every
// session record for this node (mesh-session.mjs's own absence-tolerant read),
// filters to the LIVE ones through the SAME isSessionLive/isStale predicate the
// whole mesh shares (never a session-local staleness rule), and projects each
// surviving record down to EXACTLY `{ workspaceId, repo, assistant, lastPingAt }` —
// a DERIVED read: it does not mutate a session record (mirrors readActiveRuns'
// read-only discipline for run records). `options.now`/`options.ttlSeconds` are the
// injected clock/TTL (the inject-the-clock discipline — no wall clock read here);
// `options.config` resolves the TTL via resolveSessionTtlSeconds when
// options.ttlSeconds is not itself supplied.
export async function readLiveSessions(workspace, nodeId, options = {}) {
  const records = await readSessionRecordsForNode(workspace, nodeId);
  const nowMs = typeof options.now === "function" ? Date.parse(options.now()) : Date.parse(options.now ?? new Date().toISOString());
  const ttlSeconds = typeof options.ttlSeconds === "number" ? options.ttlSeconds : resolveSessionTtlSeconds(options.config);
  const ttlMs = ttlSeconds * 1000;
  const live = [];
  for (const record of records) {
    if (isSessionLive(record, nowMs, ttlMs)) {
      live.push({
        workspaceId: record.workspaceId,
        repo: record.repo,
        assistant: record.assistant,
        lastPingAt: record.lastPingAt,
      });
    }
  }
  return live;
}

// ------------------------------------------- resolving a node's registered workspaces ----

// resolveNodeWorkspaces(nodeId, options) — the ADR-003 aggregation seam:
// this node's registered workspaces, resolved from `global_node_workspaces WHERE
// node_id = ?` in the node's OWN local global store (the SAME AOF_GLOBAL_HOME the
// launcher already publishes into — the SAME table `localNodeWorkspaceMembership`,
// mesh-worker-execution.mjs, already reads for the worker's OWN repo-membership
// check). Each row's `workspace_id` is resolved to its `workDir`/`projectRoot` via
// `global_workspace_descriptors` (the store's own descriptor columns — no second
// enumeration strategy). FAILURE-ISOLATED (never a daemon crash):
//   - store unreachable → returns `{ ok:false, workspaces:[] }` (the caller degrades
//     to the launch-cwd workspace only);
//   - a workspace row with no matching descriptor, or whose workDir no longer
//     resolves on disk, is SKIPPED (absence-is-benign) — never thrown.
// `options.openStore` is the injected store opener (default
// openGlobalWorkProjectionStore); `options.globalWorkStoreOptions` threads the
// store's env/paths (the hermetic-test seam every other store caller in this
// codebase already exposes).
//
// FINDING F11 (aof:verify 38, BLOCKER) — the READ-side defensive half of the fix.
// A stored `work_dir` MUST NOT be `stat()`-ed as-is against the READER's
// process.cwd() — that is exactly the bug (a relative `"./wiki/work"` only
// "resolved" when the daemon happened to launch from that very repo; from any
// OTHER cwd — a packaged tray app's install dir — it resolved to nothing).
// Every candidate `work_dir` is resolved with `path.resolve(descriptor.project_root,
// descriptor.work_dir)` — against THAT ROW's OWN absolute `project_root`, never the
// caller's cwd. `path.resolve` is a no-op (beyond normalization) when `work_dir` is
// already absolute (the write-side fix's canonical output), so this is the SAME
// resolve either way: it makes a post-fix row correct AND tolerates a legacy row
// still holding the pre-fix raw relative string, with zero migration.
// `skipped` (a `{ workspaceId, workDir, reason }[]`) is the LOUD-skip diagnostic:
// a workspace whose resolved absolute work dir genuinely does not exist is skipped
// but SURFACED here — never a silent `continue` that lets a zero-workspace
// aggregation masquerade as a healthy "nothing to report".
export async function resolveNodeWorkspaces(nodeId, options = {}) {
  const openStore = options.openStore ?? openGlobalWorkProjectionStore;
  const storeOptions = options.globalWorkStoreOptions ?? {};
  let store;
  try {
    store = await openStore({ ...storeOptions, paths: storeOptions.paths ?? globalMeshPaths(storeOptions) });
  } catch {
    return { ok: false, workspaces: [], skipped: [] };
  }
  try {
    const rows = store.db.prepare("SELECT workspace_id FROM global_node_workspaces WHERE node_id = ? ORDER BY workspace_id").all(nodeId);
    const workspaces = [];
    const skipped = [];
    for (const row of rows) {
      const descriptor = store.db.prepare(
        "SELECT workspace_id, project_root, work_dir FROM global_workspace_descriptors WHERE workspace_id = ?",
      ).get(row.workspace_id);
      if (descriptor == null || typeof descriptor.work_dir !== "string" || descriptor.work_dir.length === 0) {
        skipped.push({ workspaceId: row.workspace_id, workDir: null, reason: "no-descriptor" });
        continue;
      }
      const anchor = typeof descriptor.project_root === "string" && descriptor.project_root.length > 0
        ? descriptor.project_root
        // A row with no project_root is degraded data (the schema is NOT NULL, so
        // this is belt-and-suspenders); resolving against the raw value keeps an
        // already-absolute work_dir intact and never silently invents a cwd-relative
        // resolve for one that isn't.
        : descriptor.work_dir;
      const resolvedWorkDir = path.resolve(anchor, descriptor.work_dir);
      try {
        const stats = await stat(resolvedWorkDir);
        if (!stats.isDirectory()) {
          skipped.push({ workspaceId: descriptor.workspace_id, workDir: resolvedWorkDir, reason: "not-a-directory" });
          continue;
        }
      } catch {
        // descriptor's resolved absolute workDir genuinely doesn't exist on disk —
        // skip LOUDLY (recorded in `skipped`), never throw.
        skipped.push({ workspaceId: descriptor.workspace_id, workDir: resolvedWorkDir, reason: "workdir-missing" });
        continue;
      }
      workspaces.push({ workspaceId: descriptor.workspace_id, workDir: resolvedWorkDir, projectRoot: descriptor.project_root });
    }
    return { ok: true, workspaces, skipped };
  } catch {
    return { ok: false, workspaces: [], skipped: [] };
  } finally {
    store.close?.();
  }
}

// ------------------------------------------------- the record assembly ----

// Assemble THIS node's presence record — the FROZEN schema, EXACTLY these FIVE keys
// in this order (milestone 38 / ADR-001, evolving the m23 four-key freeze): { nodeId,
// heartbeatAt, activeRuns, sessions, aofVersion }. `sessions` is inserted BEFORE the
// trailing `aofVersion` provenance string (ADR-001's "group the run/session liveness
// pair together") — the m23 four keys keep their RELATIVE order, so a no-session
// record's nodeId/heartbeatAt/activeRuns/aofVersion values stay byte-identical to an
// m23 record (acd-session-presence-additive). ABSENT-IS-BENIGN: `sessions` defaults
// to `[]` when the caller supplies none — the key is ALWAYS present (never omitted),
// so the shape is stable and every pre-38 call site (mesh:heartbeat, which does not
// yet read session records) keeps emitting a valid, five-key record with an empty
// sessions array. nodeId is the SAME stable id the node record carries (read it,
// never re-derived here); heartbeatAt is the injected/wall-clock ISO-8601 UTC-Z
// instant; activeRuns is the run-record read; sessions is the derived LIVE
// session-record projection (ADR-002, each entry `{ workspaceId, repo, assistant,
// lastPingAt }` — presence reads-but-never-mutates session state, exactly as
// activeRuns reads-but-never-mutates run state); aofVersion is the provenance string.
// A PURE projection of its inputs — the same inputs yield a content-equivalent record
// (rebuildability), so it is never a second authority.
export function assemblePresenceRecord({ nodeId, heartbeatAt, activeRuns, sessions, aofVersion }) {
  return {
    nodeId,
    heartbeatAt,
    activeRuns,
    sessions: sessions ?? [],
    aofVersion,
  };
}

// Publish a node's presence record as exactly ONE global presence/<id>.json,
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
// (milestone 23 / story 02 / ADR-003). mesh:status reconciles the persisted global
// record with the optional fast-path cache through ONE render. A cache entry only wins
// while it is STRICTLY newer than disk; equal or older cached data reconciles to the
// persisted bytes so the cache never becomes a second system of record.
// This is a PURE projection over its two inputs — no fs, no clock.
export function mergePresence(diskPresence, cachedPresence) {
  if (diskPresence == null) return cachedPresence ?? null;
  if (cachedPresence == null) return diskPresence;
  const diskMs = Date.parse(diskPresence.heartbeatAt);
  const cachedMs = Date.parse(cachedPresence.heartbeatAt);
  // The cache wins ONLY when it is strictly newer than the persisted record; an equal or
  // unparseable-cache heartbeat reconciles to the durable disk bytes.
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
