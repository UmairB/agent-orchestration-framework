// src/integrations/routing.mjs — the per-folder `.integrations.json` routing reader
// (milestone 18 / story 00 — the AUTHORING SPINE; ADR-001/002/003/006).
//
// A work item's external-tool routing (which Notion board, which parent page) is
// AUTHORED intent committed BESIDE the item, not milestone frontmatter and not the
// git-ignored sidecar. It lives in a discrete dotfile `.integrations.json` at the
// item's RECORD-DOC folder (a sibling of SPEC.md/AOF.md/STORY.md), machine-managed by
// the `associate` verb (notion-associate.mjs). This module is the NEW shared seam both
// the authoring side (associate, the write) and the consumption side (story 01's
// projection, the read) go through.
//
//   <item.dir>/.integrations.json   shape (provider-namespaced):
//     { "notion": { "board"?: <board-key>, "parent"?: <page-id|key> }, "<other>"?: … }
//
//   readRouting(item)                         → the parsed descriptor object ({} on absent/corrupt)
//   classifyParent(value) / isPageId(value)   → "raw page-id" vs "key" (by UUID shape, ADR-001)
//   resolveNotionRouting(item, notionConfig)  → { board, parentPageId|null, reason? } (combines descriptor + boards registry)
//   writeRouting(item, next) / clearing       → the associate mutation (ADR-004)
//
// It reads the file with `JSON.parse` ONLY — it has NO `parseFrontmatter` import or
// dependency (R4 (m18): extending the shared frontmatter parser is a blast-radius
// hazard, so routing is a discrete JSON file; FF-B enforces this). Its only imports
// are `node:fs`, `node:path`, and `recordDoc` from `../work.mjs` — no Notion spawn
// seam is imported (ADR-006, the no-read invariant holds by construction).
import path from "node:path";
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync } from "node:fs";
import { recordDoc } from "../work.mjs";

// The descriptor file name (folder-rooted — a sibling of the record doc).
export const INTEGRATIONS_FILE = ".integrations.json";

// Resolve the descriptor's absolute path: it lives in the item's RECORD-DOC folder
// (recordDoc semantics — AOF.md-first for a converted milestone, else SPEC.md), so an
// imported AOF.md-class milestone is first-class (the carried-forward BLOCKER fix).
// The descriptor is folder-rooted, so in practice "the folder" is `item.dir`; tying it
// to recordDoc keeps the doc-class first-classness explicit.
function descriptorPath(item) {
  // recordDoc returns the record-doc FILENAME; the descriptor is its sibling. We only
  // need the folder, which is item.dir — calling recordDoc keeps the tie honest and
  // future-proofs a record doc that ever moves out of item.dir.
  recordDoc(item);
  return path.join(item.dir, INTEGRATIONS_FILE);
}

// Read the item's routing descriptor. An absent, unreadable, or corrupt file ⇒ `{}`
// ("no routing"), NEVER an exception (mirrors readMapping's absent-file tolerance,
// mapping.mjs:41-57) — an unrouted item is the common case (the m17 default-board /
// top-level path depends on this). The descriptor is provider-namespaced; this reader
// returns the WHOLE parsed object so a caller reads `notion` and ignores peers (FF-E:
// an unknown provider block is tolerated, never a hard failure).
export function readRouting(item) {
  let raw;
  try {
    raw = readFileSync(descriptorPath(item), "utf8");
  } catch {
    // Absent or unreadable ⇒ no routing. Never throws (ADR-003).
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    // A non-object payload (e.g. a bare array/string) is treated as no routing — the
    // descriptor is a machine-managed object; a re-associate rewrites it.
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    // A corrupt descriptor is "no routing" rather than a throw — it is a
    // machine-managed file a re-associate rewrites (sidecar-style tolerance).
    return {};
  }
}

// ADR-001 shape disambiguation: a `parent` value is a RAW PAGE-ID iff it is EITHER the
// compact 32-hex form OR the canonical 8-4-4-4-12 dashed UUID — exactly those two
// shapes, nothing looser (a stray-dash form like `1-1-1-…` is NOT a page-id). The
// boundary is exact — 31 hex, 33 hex, or a non-hex char (e.g. `g`) all fall cleanly to
// "key". A page-id is used verbatim (no registry lookup); any other string is a KEY
// resolved against the chosen board's `parents` map.
const COMPACT_PAGE_ID = /^[0-9a-fA-F]{32}$/;
const DASHED_PAGE_ID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
export function isPageId(value) {
  if (typeof value !== "string") return false;
  return COMPACT_PAGE_ID.test(value) || DASHED_PAGE_ID.test(value);
}

// Classify a parent value as a raw page-id or a key (the human-readable label the
// reader/resolver and the associate verb speak in).
export function classifyParent(value) {
  return isPageId(value) ? "raw page-id" : "key";
}

// Normalise a board connection to the m17 flat shape (dataSourceId, tokenEnv?,
// statusProperty, statusMap, relationProperty, parents?). Used to synthesise the
// implicit default board from a flat m17 config (back-compat, ADR-002).
function asBoardConnection(block) {
  return {
    dataSourceId: block.dataSourceId,
    tokenEnv: block.tokenEnv,
    statusProperty: block.statusProperty,
    statusType: block.statusType,
    titleProperty: block.titleProperty,
    statusMap: block.statusMap,
    relationProperty: block.relationProperty,
    parents: block.parents,
  };
}

// Reduce a central `work.integrations.notion` config to a uniform `{ default, boards }`
// view (ADR-002). A boards-registry block is returned as-is; a FLAT m17 block (a
// `dataSourceId` at the top level and no `boards` key) is synthesised into the implicit
// default board: `boards = { default: <flat> }`, `default = "default"`. An absent
// config ⇒ no boards.
export function asBoardsRegistry(notionConfig) {
  if (!notionConfig || typeof notionConfig !== "object") {
    return { default: undefined, boards: {} };
  }
  if (notionConfig.boards && typeof notionConfig.boards === "object") {
    return { default: notionConfig.default, boards: notionConfig.boards };
  }
  // Flat m17 block ⇒ the implicit default board (back-compat). The whole flat block IS
  // the single board, keyed "default".
  if (typeof notionConfig.dataSourceId === "string") {
    return { default: "default", boards: { default: asBoardConnection(notionConfig) } };
  }
  return { default: undefined, boards: {} };
}

// A resolve error — a config defect (an unknown board key referenced by a descriptor,
// or an unknown `default`) the Ajv schema cannot express (the cross-check that
// `default` names a real board is the resolver's, ADR-002). The associate verb maps
// these to honest command errors; the projection surfaces them as resolve failures.
export class RoutingError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RoutingError";
    this.code = code;
  }
}

// Resolve an item's routing against the central `boards` registry (ADR-002/003). It
// combines the committed descriptor (readRouting) with the registry, PURELY from
// committed config — no Notion call (ADR-006).
//
//   → { board: <resolved board connection>, parentPageId: <string|null>, reason?: <string> }
//
// Resolution (ADR-002/003):
//   - descriptor `board: X` ⇒ X's connection; absent `board` ⇒ the configured `default`
//     board; a flat m17 block ⇒ the implicit default board (back-compat); no descriptor
//     at all ⇒ the default board, parentPageId: null.
//   - `parent` (ADR-001): a raw page-id is used verbatim; a key resolves against the
//     CHOSEN board's `parents` map; an absent/unresolvable parent ⇒ parentPageId: null
//     plus an honest `reason` naming the unresolvable key.
//   - an unknown referenced board ⇒ RoutingError("unknown-board-key"); an unknown
//     `default` ⇒ RoutingError("unknown-default-board") — each naming the available boards.
export function resolveNotionRouting(item, notionConfig) {
  const { default: defaultKey, boards } = asBoardsRegistry(notionConfig);
  const available = Object.keys(boards);

  const descriptor = readRouting(item);
  const notion = descriptor && typeof descriptor.notion === "object" ? descriptor.notion : {};

  // Choose the board: the descriptor's `board`, else the configured `default`.
  const requested = typeof notion.board === "string" ? notion.board : undefined;
  const boardKey = requested ?? defaultKey;

  if (requested != null && !Object.prototype.hasOwnProperty.call(boards, requested)) {
    throw new RoutingError(
      `Unknown board key "${requested}". Available boards: ${formatBoards(available)}.`,
      "unknown-board-key"
    );
  }
  if (boardKey != null && !Object.prototype.hasOwnProperty.call(boards, boardKey)) {
    // The descriptor named no board (or names the default) but `default` itself is
    // dangling — an honest config error (ADR-002, the resolver's cross-check).
    throw new RoutingError(
      `Unknown default board "${boardKey}". Available boards: ${formatBoards(available)}.`,
      "unknown-default-board"
    );
  }

  const board = boardKey != null ? boards[boardKey] : undefined;

  // Resolve the parent page id (ADR-001): a raw page-id verbatim; a key against the
  // chosen board's parents; an absent/unresolvable parent ⇒ null + an honest reason.
  let parentPageId = null;
  let reason;
  const parent = notion.parent;
  if (typeof parent === "string" && parent.length > 0) {
    if (isPageId(parent)) {
      parentPageId = parent;
    } else {
      const parents = (board && board.parents) || {};
      if (Object.prototype.hasOwnProperty.call(parents, parent)) {
        parentPageId = parents[parent];
      } else {
        reason = boardKey
          ? `parent key "${parent}" is not bound in the "${boardKey}" board's parents map`
          : `parent key "${parent}" is not bound (no board resolved for this item)`;
      }
    }
  }

  return { board, parentPageId, ...(reason ? { reason } : {}) };
}

// Format an available-board list for an error message ("ops","growth"), or a clear
// "(none configured)" when the registry is empty.
function formatBoards(available) {
  return available.length ? available.map((k) => `"${k}"`).join(",") : "(none configured)";
}

// Write (or clear) the item's `.integrations.json` — the associate verb's ONLY
// mutation (ADR-004). `next` is the WHOLE descriptor object to persist; an EMPTY
// descriptor (no provider blocks) is REMOVED from disk (the file is deleted) so it
// round-trips to "absent ⇒ defaults" (an empty `{}` is never left lingering). Returns
// the descriptor as persisted ({} when cleared).
export function writeRouting(item, next) {
  const filePath = descriptorPath(item);
  const isEmpty = !next || typeof next !== "object" || Object.keys(next).length === 0;
  if (isEmpty) {
    // Clearing the whole descriptor removes the file (round-trips to "no routing").
    try {
      rmSync(filePath, { force: true });
    } catch {
      // A best-effort remove of an absent file is a no-op.
    }
    return {};
  }
  writeFileSync(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

// Does the item's descriptor file exist on disk? (The associate verb consults this to
// distinguish "clearing an already-clear item" — an unchanged no-write — from a
// genuine clear.)
export function hasRouting(item) {
  return existsSync(descriptorPath(item));
}

// Tolerant milestone-folder resolution for the integration verbs (associate/sync): a
// repo may name its milestone folders in the GSD `NN-slug` form (or `NN_slug`), not
// aof's `NN_milestone_slug`. The shared `listItems`/ITEM_RE only sees the aof form,
// so this is the FALLBACK the integration commands use when listItems misses — it
// scans the work dir for a folder whose name LEADS with the ref and carries a record
// doc (AOF.md/SPEC.md), synthesising a top-level milestone item so a GSD-managed
// repo's milestones are associable WITHOUT a rename. Mirrors the import reader's
// folder-name tolerance ([[aof-import-milestone-naming]]). Returns the item or null.
const NUMBERED_FOLDER_RE = /^(\d+)[-_]+(.+)$/;
export function resolveMilestoneFolderByRef(workDir, ref) {
  let entries;
  try {
    entries = readdirSync(workDir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(NUMBERED_FOLDER_RE);
    if (!match || match[1] !== String(ref)) continue;
    const dir = path.join(workDir, entry.name);
    // Only a folder that actually carries a record doc is a milestone folder.
    if (!existsSync(path.join(dir, "AOF.md")) && !existsSync(path.join(dir, "SPEC.md"))) continue;
    return { ref: match[1], number: Number.parseInt(match[1], 10), type: "milestone", parent: null, dir, slug: match[2] };
  }
  return null;
}
