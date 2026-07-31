// src/notion/mapping.mjs — the SOLE aof-item ↔ Notion-page identity store (17/ADR-001,
// re-shaped multi-board in 18/ADR-005).
//
// A derived, git-ignored `.aof/` artifact — NOT an external-id property written on
// the Notion page, NOT a resolve-by-query. The mapping binds each aof item's stable
// ref ("17" / "17/01", the listItems()/readMeta() key) to the Notion page id the
// first sync created/resolved for it, scoped per board data-source so two boards
// never collide. The sync resolves a page id from this sidecar BEFORE any Notion
// call: a HIT means the page is known (patch it); a MISS means create it (then
// record the new id back here).
//
//   <projectRoot>/.aof/notion.work-map.json   // the git-ignored sidecar (one per project)
//   shape (v2, 18/ADR-005 — multi-board):
//     { version: 2, boards: { "<dataSourceId>": { entries: { "<aofRef>": { pageId, lastStatus, lastSyncedAt } } } } }
//
// The v2 file holds bindings for MORE THAN ONE board at once — each board's bindings
// live in its own per-data-source bucket, so syncing board B never clobbers board A's
// bucket. The per-board scoping guarantee (a binding under ds-A must not resolve under
// ds-B) is preserved at the BUCKET boundary, not because the file is single-scope.
//
//   readMapping(projectRoot, dataSourceId)            → { dataSourceId, entries } (empty bucket on absent file — never throws)
//   resolvePageId(mapping, aofRef)                    → pageId | null   (HIT → patch; null → create)
//   recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta)  → persist the binding back (merge into the bucket)
//
// v1 BACK-COMPAT (18/ADR-005): a legacy `{ version:1, dataSourceId, entries }` file is
// read as the bucket for ITS OWN dataSourceId — `parsed.version < 2 &&
// parsed.dataSourceId === dataSourceId ⇒ parsed.entries` is the bucket (else a MISS —
// the cross-board guard applies to the migration path too). The first recordPageId
// rewrites the file in v2 shape; there is no standalone migration step (a derived
// artifact re-derives, additive and safe).
//
// The sidecar is the ONLY mapping store; no Notion id property is written, no
// resolve-query is issued. It is git-ignored via the aof-gitignore.mjs baseline.
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { workspacePaths } from "../workspace.mjs";

// A stable short hash of a page's BODY content (the record-doc markdown) for the
// one-way change check: the sidecar records `lastContentHash`, so a re-sync whose
// disk content is byte-identical decides noop, and a changed (or first-ever) body
// decides patch — exactly mirroring how `lastStatus` gates a status re-sync. Returns
// null for absent content (a content-less item never carries a hash — the m17 sidecar
// shape is unchanged).
export function hashContent(content) {
  if (typeof content !== "string" || content.length === 0) return null;
  return createHash("sha1").update(content).digest("hex").slice(0, 16);
}

// The sidecar file name (relative to `.aof/`). Git-ignored via AOF_GITIGNORE_ENTRIES.
export const NOTION_WORK_MAP_FILE = "notion.work-map.json";

// The schema version of the on-disk sidecar shape (bump on a breaking change). v2 is
// the multi-board, per-data-source-bucket shape (18/ADR-005).
const MAP_VERSION = 2;

// Resolve the sidecar's absolute path under the project's `.aof/`.
function mapPath(projectRoot) {
  const { workspaceDir } = workspacePaths(projectRoot);
  return path.join(workspaceDir, NOTION_WORK_MAP_FILE);
}

// Read + parse the WHOLE sidecar file as a raw object. An absent, unreadable, or
// corrupt file ⇒ `null` (treated as no sidecar) — a derived, rebuildable artifact, so a
// re-sync re-records the bindings. Used by both readMapping (a single bucket) and
// recordPageId (merge into one bucket, leaving the others untouched).
async function readRawFile(projectRoot) {
  let raw;
  try {
    raw = await readFile(mapPath(projectRoot), "utf8");
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

// Pull a single data-source's entries bucket out of a parsed sidecar object, honouring
// BOTH the v2 multi-board shape and the v1 legacy single-board shape (18/ADR-005). An
// absent bucket (or a v1 file bound to a DIFFERENT data-source) ⇒ `{}` — the per-board
// scoping guard, applied to the migration path too. Never throws.
function bucketEntries(parsed, dataSourceId) {
  if (!parsed || typeof parsed !== "object") return {};

  // v2 multi-board: the entries live under boards[dataSourceId].entries.
  if (parsed.boards && typeof parsed.boards === "object") {
    const bucket = parsed.boards[dataSourceId];
    const entries = bucket && typeof bucket.entries === "object" ? bucket.entries : null;
    return entries || {};
  }

  // v1 legacy single-board: read as the bucket for ITS OWN dataSourceId. A v1 file bound
  // to another data-source resolves NO entries for this one (the same cross-board guard
  // the old shape had — now applied to the migration path so a v1 binding can't silently
  // collide on another board).
  if ((parsed.version ?? 1) < MAP_VERSION && parsed.dataSourceId === dataSourceId) {
    return parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
  }

  return {};
}

// Read the mapping for a given board data-source. An absent file (a fresh project with
// no sidecar yet) returns an EMPTY mapping and NEVER throws — the projection's first run
// depends on this. The mapping is scoped per `dataSourceId`: only THAT data-source's
// bucket is returned, so a binding under ds-A does not resolve under ds-B (two boards
// never collide) — now because buckets are separate, not because the file is
// single-scope. The requested `dataSourceId` is echoed back so the projection's
// `mapping?.dataSourceId` fallback still resolves.
export async function readMapping(projectRoot, dataSourceId) {
  const parsed = await readRawFile(projectRoot);
  return { dataSourceId, entries: bucketEntries(parsed, dataSourceId) };
}

// Resolve the Notion page id recorded for an aof ref. A HIT returns the recorded
// page id (the projection PATCHes it in place); a MISS returns null (the projection
// knows to POST a new page).
export function resolvePageId(mapping, aofRef) {
  const entry = mapping?.entries?.[aofRef];
  return entry?.pageId ?? null;
}

// Persist a binding back into the sidecar (creating `.aof/` if needed). The WHOLE file
// is re-parsed and the binding MERGED into this data-source's bucket, leaving every
// OTHER board's bucket untouched (the m17 clobber is gone — recording under a new
// data-source no longer replaces the scope). A later readMapping for the SAME
// data-source resolves it, carrying the `lastStatus` / `lastSyncedAt` from `meta`. A
// legacy v1 file is migrated to v2 on this first write (its own bucket is preserved).
export async function recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta = {}) {
  const filePath = mapPath(projectRoot);

  // Re-parse the WHOLE current file and reduce it to a v2 `{ boards: { <ds>: { entries } } }`
  // map (carrying every existing bucket forward — a v1 file becomes its own bucket).
  const parsed = await readRawFile(projectRoot);
  const boards = collectBoards(parsed);

  // Merge the new binding into THIS data-source's bucket (start from its current entries
  // so a second record under the same board keeps the earlier bindings).
  const entries = { ...(boards[dataSourceId]?.entries ?? {}) };
  entries[aofRef] = {
    pageId,
    lastStatus: meta.lastStatus ?? null,
    lastSyncedAt: meta.lastSyncedAt ?? null,
    // Record the body content hash ONLY when a body was synced — a content-less item
    // keeps the m17 entry shape ({ pageId, lastStatus, lastSyncedAt }) byte-for-byte.
    ...(meta.lastContentHash != null ? { lastContentHash: meta.lastContentHash } : {}),
  };
  boards[dataSourceId] = { entries };

  const next = { version: MAP_VERSION, boards };

  const { workspaceDir } = workspacePaths(projectRoot);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

// remapMappingRefs(projectRoot, remap, { eventId }) — follow an insert/reindex with
// the sidecar's own keys (m42 wave (d) leg d4, port 3). The bindings are keyed by
// AOF REF, so a renumber silently re-points every entry at a DIFFERENT item: the
// next sync PATCHes the page that used to be `03` with the content of whatever is
// `03` now. That is the mis-binding this port exists to kill, and it was invisible
// because nothing told the sidecar the refs had moved.
//
// A ref remap is a PERMUTATION, not an idempotent write — applying `{03→04, 04→05}`
// twice would shift everything a second time — so this is EVENT-ID DEDUPED (the
// reactor contract's sanctioned alternative to idempotence): the applied event id is
// stamped on the file and a repeat delivery is a no-op. The whole map is rebuilt in
// memory and written ONCE, so a crash leaves the previous file intact.
//
// Every board's bucket is remapped (a ref means the same item on all of them), and
// entries whose ref did not move are carried through byte-identical.
export async function remapMappingRefs(projectRoot, remap = [], { eventId = null } = {}) {
  if (!Array.isArray(remap) || remap.length === 0) return { remapped: 0, skipped: true, reason: "empty-remap" };

  const parsed = await readRawFile(projectRoot);
  if (parsed == null) return { remapped: 0, skipped: true, reason: "no-sidecar" };
  if (eventId != null && parsed.lastReindexEventId === eventId) {
    return { remapped: 0, skipped: true, reason: "already-applied" };
  }

  const boards = collectBoards(parsed);
  const moves = new Map(remap.map(({ from, to }) => [from, to]));
  let remapped = 0;
  for (const [dsId, bucket] of Object.entries(boards)) {
    const next = {};
    for (const [ref, entry] of Object.entries(bucket.entries)) {
      const to = moves.get(ref);
      if (to != null) remapped += 1;
      next[to ?? ref] = entry;
    }
    boards[dsId] = { entries: next };
  }

  const filePath = mapPath(projectRoot);
  const { workspaceDir } = workspacePaths(projectRoot);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(
    filePath,
    `${JSON.stringify({ version: MAP_VERSION, boards, ...(eventId != null ? { lastReindexEventId: eventId } : {}) }, null, 2)}\n`,
    "utf8",
  );
  return { remapped };
}

// Reduce a parsed sidecar (v2 OR v1 OR null) to the v2 `boards` map, carrying every
// existing bucket forward NON-LOSSILY. A v2 file's buckets are kept as-is; a v1 file
// becomes a single bucket keyed by its own dataSourceId (the migration); an
// absent/corrupt file is an empty map. Used by recordPageId so a write under board B
// preserves board A's bucket.
function collectBoards(parsed) {
  if (!parsed || typeof parsed !== "object") return {};

  if (parsed.boards && typeof parsed.boards === "object") {
    const out = {};
    for (const [dsId, bucket] of Object.entries(parsed.boards)) {
      const entries = bucket && typeof bucket.entries === "object" ? bucket.entries : {};
      out[dsId] = { entries: { ...entries } };
    }
    return out;
  }

  // v1 legacy single-board ⇒ its own bucket (the migration carries it forward).
  if ((parsed.version ?? 1) < MAP_VERSION && typeof parsed.dataSourceId === "string") {
    const entries = parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {};
    return { [parsed.dataSourceId]: { entries: { ...entries } } };
  }

  return {};
}
