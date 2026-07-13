// src/mesh-session.mjs — the SESSION dimension (milestone 38 / story 00, ADR-002): a
// per-(nodeId, workspaceId, assistant) live coding-assistant session record, TTL
// self-expiring liveness (REUSING the shared isStale predicate, never a parallel
// staleness rule), and the store's own path-traversal-safe leaf composition.
//
// A session record is a TRANSIENT per-install liveness fact — like presence, like
// identity — so it lives under the node's OWN global mesh home
// (globalMeshPaths(...).meshRoot, honoring AOF_GLOBAL_HOME) in a `sessions/`
// partition: NEVER git, NEVER the repo working tree, NEVER synced over the git bus
// (23/ADR-001 relay-stateless + 33/ADR-004 clone-safe discipline).
//
// `startSession`/`pingSession`/`endSession` are the SOLE producers of a session
// record (ADR-002's "sole producer per state" discipline, mirroring the m35
// assignment-record module): start writes (startedAt = lastPingAt = now); ping
// upserts (an unknown session is upserted, so ping works with no prior start);
// end deletes (ENOENT-tolerant — ending an already-gone/never-written session is a
// benign no-op, never an error). Each is ONE atomic single-record write through the
// m19/R2 writeText temp+rename seam — never a bare write.
//
// TTL liveness (isSessionLive) REUSES the shared isStale predicate (imported from
// run-store.mjs — the SAME predicate mesh-presence.mjs's isNodeStale reuses) — no
// hand-rolled parallel staleness rule (acd-session-ttl-reuses-isstale).
import path from "node:path";
import { mkdir, readFile, readdir, unlink } from "node:fs/promises";
import { writeText } from "./fs.mjs";
import { meshDir } from "./mesh-store.mjs";
import { isStale } from "./run-store.mjs";

// The DOCUMENTED default session TTL, in seconds (ADR-002). Comfortably above the
// UserPromptSubmit ping cadence's headroom, so a live-but-quiet session (an assistant
// open, no prompt yet) is never falsely expired. EXPORTED (mirroring
// DEFAULT_PRESENCE_STALENESS_SECONDS) so a test imports the constant, never a
// duplicated literal.
export const DEFAULT_SESSION_TTL_SECONDS = 120;

// Resolve the session TTL (in SECONDS) from config, falling back to the DOCUMENTED
// default (ADR-002) — mirrors resolveStalenessSeconds EXACTLY: read off
// config.mesh?.session?.ttlSeconds via the raw optional-chain idiom (NOT
// config-editor.mjs's whitelist — the 22/story-01 lesson). A finite number >= 0 is
// honoured (so 0 is a valid, if aggressive, TTL); absent / NaN / negative / null /
// wrong-type all fall back to THIS single documented source.
export function resolveSessionTtlSeconds(config) {
  const configured = config?.mesh?.session?.ttlSeconds;
  if (typeof configured === "number" && Number.isFinite(configured) && configured >= 0) {
    return configured;
  }
  return DEFAULT_SESSION_TTL_SECONDS;
}

// ------------------------------------------------- the traversal-safe 3-part leaf ----

// A single path segment collapses `..`/`/`/`\` into `-` (the mesh-store.mjs flatLeaf
// invariant, applied per-input) — never letting a traversal-shaped id become a
// multi-segment path. This is a PATH-SAFETY coercion at the seam, not id policy.
function safeSegment(value) {
  return String(value).replace(/[\\/]/g, "-").replace(/\.\.+/g, "-");
}

// The session record's traversal-safe leaf — a NEW composition (the one place this
// story invents a path rule rather than reusing mesh-store.mjs's flatLeaf verbatim):
// the 3-part key (nodeId, workspaceId, assistant) each pass through safeSegment
// independently, then join with `~` (a separator neither safeSegment output nor a
// typical id ever contains) so the three parts can never be confused for each other
// even if one part's raw value happened to contain the collapsed `-` sequence.
function sessionLeaf(nodeId, workspaceId, assistant) {
  return `${safeSegment(nodeId)}~${safeSegment(workspaceId)}~${safeSegment(assistant)}`;
}

// The ONE session-record path builder — built FROM meshDir (the same partition root
// presence/nodes use), keyed by the 3-part tuple: exactly one flat
// sessions/<node>~<workspace>~<assistant>.json leaf directly under the partition
// root. Co-located with the global_node_workspaces registry the aggregation reads
// (ADR-003) — one AOF_GLOBAL_HOME covers both.
export function sessionRecordPath(workspace, nodeId, workspaceId, assistant) {
  return path.join(meshDir(workspace), "sessions", `${sessionLeaf(nodeId, workspaceId, assistant)}.json`);
}

function sessionsDir(workspace) {
  return path.join(meshDir(workspace), "sessions");
}

// ------------------------------------------------------- the record assembly ----

// Assemble a session record — the FROZEN schema, EXACTLY these six keys in this
// order (ADR-002): { nodeId, workspaceId, repo, assistant, startedAt, lastPingAt }.
// A PURE projection of its inputs (no fs, no clock) so the frozen shape has ONE home
// both start/ping route through.
export function assembleSessionRecord({ nodeId, workspaceId, repo, assistant, startedAt, lastPingAt }) {
  return {
    nodeId,
    workspaceId,
    repo,
    assistant,
    startedAt,
    lastPingAt,
  };
}

// ------------------------------------------------------------- read ----

// Read ONE session record by its 3-part key, parsed off disk. Absence-tolerant: a
// tuple with no record on disk (ENOENT, or any read miss) reads as null — the same
// absence-is-benign discipline mesh-store/mesh-presence keep. A read mutates
// nothing.
export async function readSessionRecord(workspace, nodeId, workspaceId, assistant) {
  try {
    return JSON.parse(await readFile(sessionRecordPath(workspace, nodeId, workspaceId, assistant), "utf8"));
  } catch {
    return null;
  }
}

// Read every session record for a node, parsed. Absence-tolerant: no sessions/ dir
// (or nothing yet written) reads as [] — never an error. A torn/unparseable file is
// skipped rather than blinding the whole list (the derived/rebuildable discipline).
// This is a per-NODE read (filters to files whose leaf's node segment matches) — the
// aggregation (ADR-003) reads across workspaces for THIS node, never another node's.
export async function readSessionRecordsForNode(workspace, nodeId) {
  let entries = [];
  try {
    entries = await readdir(sessionsDir(workspace));
  } catch {
    return [];
  }
  const prefix = `${safeSegment(nodeId)}~`;
  const records = [];
  for (const name of entries) {
    if (!name.endsWith(".json") || !name.startsWith(prefix)) continue;
    try {
      records.push(JSON.parse(await readFile(path.join(sessionsDir(workspace), name), "utf8")));
    } catch {
      continue;
    }
  }
  return records;
}

// ------------------------------------------------------------- write (sole producers) ----

// startSession(workspace, { nodeId, workspaceId, repo, assistant, now }) — writes the
// record fresh: startedAt = lastPingAt = now. ONE atomic single-record write through
// the writeText temp+rename seam.
export async function startSession(workspace, { nodeId, workspaceId, repo, assistant, now }) {
  const nowIso = now ?? new Date().toISOString();
  const record = assembleSessionRecord({ nodeId, workspaceId, repo, assistant, startedAt: nowIso, lastPingAt: nowIso });
  await mkdir(sessionsDir(workspace), { recursive: true });
  await writeText(sessionRecordPath(workspace, nodeId, workspaceId, assistant), JSON.stringify(record, null, 2));
  return record;
}

// pingSession(workspace, { nodeId, workspaceId, repo, assistant, now }) — UPSERTS:
// refreshes lastPingAt = now on an existing record (startedAt/repo unchanged), or
// mints a fresh record (startedAt = lastPingAt = now) when no prior record exists —
// idempotent, so a ping without a prior start still registers the session (a
// crash-recovered assistant self-heals on its very next ping). ONE atomic
// single-record write.
export async function pingSession(workspace, { nodeId, workspaceId, repo, assistant, now }) {
  const nowIso = now ?? new Date().toISOString();
  const existing = await readSessionRecord(workspace, nodeId, workspaceId, assistant);
  const record = assembleSessionRecord({
    nodeId,
    workspaceId,
    repo: existing?.repo ?? repo,
    assistant,
    startedAt: existing?.startedAt ?? nowIso,
    lastPingAt: nowIso,
  });
  await mkdir(sessionsDir(workspace), { recursive: true });
  await writeText(sessionRecordPath(workspace, nodeId, workspaceId, assistant), JSON.stringify(record, null, 2));
  return record;
}

// endSession(workspace, { nodeId, workspaceId, assistant }) — DELETES the record.
// ENOENT-tolerant: ending a tuple with no record (already TTL-expired, or never
// written) is a benign no-op success, never a thrown error — writeText has no
// delete counterpart, so this is the ONE place the session module reaches past it
// for the "end" verb's delete-semantics.
export async function endSession(workspace, { nodeId, workspaceId, assistant }) {
  try {
    await unlink(sessionRecordPath(workspace, nodeId, workspaceId, assistant));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

// ------------------------------------------------------------- TTL liveness ----

// isSessionLive(record, nowMs, ttlMs) — a session is LIVE iff `!isStale(...)` using
// the SAME shared predicate the whole mesh already shares (isStale, run-store.mjs;
// re-exposed as isNodeStale by mesh-presence.mjs) — strict `>`, so a session AT the
// TTL is still live. isStale reads `record.heartbeatAt ?? record.updatedAt`; the
// session record carries neither key, so `heartbeatAt` is passed EXPLICITLY here —
// the record is shaped so the shared predicate's fallback resolves to lastPingAt
// without the predicate itself needing to know the session schema.
export function isSessionLive(record, nowMs, ttlMs) {
  return !isStale({ heartbeatAt: record?.lastPingAt }, nowMs, ttlMs);
}
