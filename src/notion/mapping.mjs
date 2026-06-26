// src/notion/mapping.mjs — the SOLE aof-item ↔ Notion-page identity store (17/ADR-001).
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
//   shape: { version, dataSourceId, entries: { "<aofRef>": { pageId, lastStatus, lastSyncedAt } } }
//
//   readMapping(projectRoot, dataSourceId)            → { entries } (empty on absent file — never throws)
//   resolvePageId(mapping, aofRef)                    → pageId | null   (HIT → patch; null → create)
//   recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta)  → persist the binding back
//
// The sidecar is the ONLY mapping store; no Notion id property is written, no
// resolve-query is issued. It is git-ignored via the aof-gitignore.mjs baseline.
import path from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { workspacePaths } from "../workspace.mjs";

// The sidecar file name (relative to `.aof/`). Git-ignored via AOF_GITIGNORE_ENTRIES.
export const NOTION_WORK_MAP_FILE = "notion.work-map.json";

// The schema version of the on-disk sidecar shape (bump on a breaking change).
const MAP_VERSION = 1;

// Resolve the sidecar's absolute path under the project's `.aof/`.
function mapPath(projectRoot) {
  const { workspaceDir } = workspacePaths(projectRoot);
  return path.join(workspaceDir, NOTION_WORK_MAP_FILE);
}

// Read the mapping for a given board data-source. An absent file (a fresh project
// with no sidecar yet) returns an EMPTY mapping and NEVER throws — the projection's
// first run depends on this. The mapping is scoped per `dataSourceId`: if the file
// on disk records a DIFFERENT data-source than asked for, no entries resolve (a
// binding under ds-A must not resolve under ds-B), so two boards never collide.
export async function readMapping(projectRoot, dataSourceId) {
  let raw;
  try {
    raw = await readFile(mapPath(projectRoot), "utf8");
  } catch {
    // Absent file (or unreadable) ⇒ an empty mapping. Never throws (ADR-001).
    return { version: MAP_VERSION, dataSourceId, entries: {} };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A corrupt sidecar is treated as empty rather than throwing — it is a derived,
    // rebuildable artifact, so a re-sync re-records the bindings.
    return { version: MAP_VERSION, dataSourceId, entries: {} };
  }

  // Per-board scoping: a sidecar bound to another data-source resolves NO entries
  // for this one (a config change to a different board does not silently re-bind
  // stale page ids).
  if (parsed?.dataSourceId !== dataSourceId) {
    return { version: MAP_VERSION, dataSourceId, entries: {} };
  }

  return {
    version: parsed.version ?? MAP_VERSION,
    dataSourceId,
    entries: parsed.entries && typeof parsed.entries === "object" ? parsed.entries : {},
  };
}

// Resolve the Notion page id recorded for an aof ref. A HIT returns the recorded
// page id (the projection PATCHes it in place); a MISS returns null (the projection
// knows to POST a new page).
export function resolvePageId(mapping, aofRef) {
  const entry = mapping?.entries?.[aofRef];
  return entry?.pageId ?? null;
}

// Persist a binding back into the sidecar (creating `.aof/` if needed). A later
// readMapping for the SAME data-source resolves it, carrying the `lastStatus` /
// `lastSyncedAt` from `meta`. A record under a DIFFERENT data-source than the file
// currently holds REPLACES the scope (the sidecar binds to one board at a time;
// re-binding to a new board starts a fresh entry set, never mixing two boards).
export async function recordPageId(projectRoot, dataSourceId, aofRef, pageId, meta = {}) {
  const filePath = mapPath(projectRoot);

  // Start from the current mapping IF it is for this data-source; otherwise begin a
  // fresh scope (the per-board guard, mirrored from readMapping).
  const current = await readMapping(projectRoot, dataSourceId);
  const entries = { ...current.entries };

  entries[aofRef] = {
    pageId,
    lastStatus: meta.lastStatus ?? null,
    lastSyncedAt: meta.lastSyncedAt ?? null,
  };

  const next = { version: MAP_VERSION, dataSourceId, entries };

  const { workspaceDir } = workspacePaths(projectRoot);
  await mkdir(workspaceDir, { recursive: true });
  await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
