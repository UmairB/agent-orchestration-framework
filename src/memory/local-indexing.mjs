// The local memory backend's indexing half (milestone 05 / story 01).
//
// Two source parsers + the derived-index writer, behind the frozen backend
// contract (ADR-003: { reindex, status } here; recall/ingest live in the seam
// and retrieval halves). The store is a DERIVED INDEX (ADR-001): a fresh
// `reindex` reconstructs it from the work-stream `.md` files alone, nothing
// accretes, and every record's `source` (`path:line`) resolves to live text
// (the load-bearing invariant of this story).
//
// Source set (ADR-007): RETROSPECTIVE `R<n>` entries -> `lesson` records;
// ARCHITECTURE `ADR-NNN` blocks -> `adr` records, across every milestone folder.
// Each record is the frozen `MemoryRecord` (ADR-005): fields absent for a given
// recordType are present as "" (never omitted) so retrieval filters uniformly.
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { listItems } from "../work.mjs";
import { readJson, writeText } from "../fs.mjs";
import { ensureAofGitignore } from "../aof-gitignore.mjs";

// The index-format version (ADR-005). Bump on a breaking record-shape change.
export const INDEX_VERSION = 1;

// The fixed, git-ignored store location (ADR-005), relative to the project root
// (the directory holding `.aof/`). The index is the only persistent artifact the
// local backend owns, and it is disposable. It is git-ignored via the nested
// `.aof/.gitignore` baseline owned by src/aof-gitignore.mjs (F-02).
const INDEX_REL = path.join(".aof", "aof.memory.index.json");

export function memoryIndexPath(projectRoot) {
  return path.join(projectRoot, INDEX_REL);
}

// ----------------------------------------------------------- section split ----

// Split a markdown body into heading-delimited sections, recording the 1-based
// line of each heading so a record's `source` resolves back to live text.
function splitSections(text, headerRe) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;
  lines.forEach((line, idx) => {
    if (headerRe.test(line)) {
      if (current) sections.push(current);
      current = { header: line, line: idx + 1, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  });
  if (current) sections.push(current);
  return sections;
}

// Strip markdown emphasis (backticks) from a heading's title text so the stored
// title is the de-emphasised prose a reader sees — the contract names titles in
// that form (e.g. "… reusing hashContent", not "… reusing `hashContent`").
function cleanTitle(raw) {
  return raw.replace(/`/g, "").trim();
}

// Pull a "- **Label:** value" / "**Label.** value" inline field out of a body,
// flattening soft-wrapped continuation lines into one searchable string. The
// value runs until a blank line or the next "- **" field marker. Parentheticals
// are PRESERVED (e.g. owner "contract authors (Three Amigos)" — the contract
// names the full string, including the parenthetical, as the field value).
function inlineField(body, label) {
  // The value runs until a blank line OR the next field label starting a line —
  // whether dash-prefixed (`- **Kind:**`, RETROSPECTIVE) or not (`**Decision.**`,
  // ARCHITECTURE). Keying the terminator only off `\n- **` let a non-dash ADR field
  // swallow the following field(s) when they were not blank-line-separated.
  const re = new RegExp(`\\*\\*${label}[:.]\\*\\*\\s*([\\s\\S]*?)(?:\\n\\s*\\n|\\n\\s*(?:-\\s*)?\\*\\*|$)`, "i");
  const match = body.join("\n").match(re);
  return match ? match[1].replace(/\s+/g, " ").trim() : "";
}

// ----------------------------------------------------- RETROSPECTIVE parser ----

// One `lesson` MemoryRecord per `## R<n>` heading (ADR-007). The meta line
// "- **Kind:** … · **Area:** … · **Stage:** … · **Owner:** … · **Raised by:** …"
// drives area/stage/kind/owner; the heading drives id and title; status (an
// adr-only field) is present-as-"" (ADR-005), never omitted.
export function parseRetrospective(text, { item, itemSlug, workRelPath }) {
  return splitSections(text, /^#{2,3}\s+R\d+\b/).map((section) => {
    // Heading shape: `## R<n> <sep> Title`, authored at h2 or h3 with a `—`/`–`/`-`,
    // `:`, `·`, or bare-whitespace separator. Accept the variants (or none) so a
    // stream's lessons are not lost to a heading-level or separator choice.
    const headMatch = section.header.match(/^#{2,3}\s+(R\d+)\s*[:·—–-]?\s*(.*)$/);
    const id = headMatch ? headMatch[1] : section.header.replace(/^#{2,3}\s+/, "").trim();
    const title = headMatch ? cleanTitle(headMatch[2]) : "";

    // The meta fields (Kind/Area/Stage/Owner) live on ONE OR MORE `- **Label:** v`
    // lines, each a `·`-separated run of segments. Scan EVERY meta-labelled line and
    // accumulate (first value wins) so a meta split across lines — common in real
    // streams — still populates all four fields, not only those on the first line.
    // Keying off any one label (`Kind:` alone) silently zeroed the rest.
    const meta = {};
    for (const line of section.body) {
      if (!/\*\*(?:Kind|Area|Stage|Owner|Raised by):\*\*/i.test(line)) continue;
      for (const part of line.split("·")) {
        const m = part.match(/\*\*([^:]+):\*\*\s*(.+)/);
        if (m) {
          const key = m[1].trim().toLowerCase();
          if (!(key in meta)) meta[key] = m[2].trim();
        }
      }
    }

    const what = inlineField(section.body, "What happened");
    const why = inlineField(section.body, "Why");
    const lesson = inlineField(section.body, "Lesson");

    return {
      recordType: "lesson",
      id,
      item,
      itemSlug,
      title,
      area: meta.area ?? "",
      stage: meta.stage ?? "",
      kind: meta.kind ?? "",
      owner: meta.owner ?? "",
      status: "", // adr-only field; present-as-"" on a lesson (ADR-005), never omitted
      summary: lesson, // the one-line lesson gist — the short display line
      text: [title, what, why, lesson].filter(Boolean).join(" \n "), // searchable blob
      source: `${workRelPath}:${section.line}`,
    };
  });
}

// ------------------------------------------------------ ARCHITECTURE parser ----

// One `adr` MemoryRecord per `## ADR-NNN` block (ADR-007). area is ALWAYS
// "architecture"; the lesson-only fields (stage/kind/owner) are present-as-""
// (ADR-005); status comes from the block's "**Status:**" line verbatim.
export function parseArchitecture(text, { item, itemSlug, workRelPath }) {
  return splitSections(text, /^#{2,3}\s+ADR-\d+/).map((section) => {
    // Heading shape: `## ADR-NNN <sep> Title`. The separator is authored
    // inconsistently across real streams — `:` (aof's own docs), `·` (middot),
    // `—`/`–` (em/en dash), `-` (hyphen), or bare whitespace. Accept any of them
    // (or none) at h2 or h3, so a stream's ADR titles are not silently swallowed
    // into the id when the author picked a different separator than aof's `:`.
    const headMatch = section.header.match(/^#{2,3}\s+(ADR-\d+)\s*[:·—–-]?\s*(.*)$/);
    const id = headMatch ? headMatch[1] : section.header.replace(/^#{2,3}\s+/, "").trim();
    const title = headMatch ? cleanTitle(headMatch[2]) : "";

    const statusLine = section.body.find((line) => /\*\*Status:\*\*/i.test(line)) ?? "";
    const status = (statusLine.match(/\*\*Status:\*\*\s*(.+)/) ?? [, ""])[1].trim();

    const context = inlineField(section.body, "Context");
    const decision = inlineField(section.body, "Decision");
    const invariant = inlineField(section.body, "Invariant");

    return {
      recordType: "adr",
      id,
      item,
      itemSlug,
      title,
      area: "architecture", // ADR-005: always "architecture" for an adr, regardless of source file
      stage: "", // lesson-only; present-as-"" on an adr (ADR-005), never omitted
      kind: "",
      owner: "",
      status,
      summary: decision || invariant, // the decision/invariant gist — the short display line
      text: [title, context, decision, invariant].filter(Boolean).join(" \n "), // searchable blob
      source: `${workRelPath}:${section.line}`,
    };
  });
}

// ------------------------------------------------------------- index build ----

// Forward-slash, work-relative path for a record's `source` (so it resolves the
// same on every platform).
function toWorkRel(workDir, absPath) {
  return path.relative(workDir, absPath).split(path.sep).join("/");
}

// Build the record set from the live `.md` files. `only` (e.g. "01") scopes the
// rebuild to one milestone; null/undefined scans the whole stream. Reused by
// both `reindex` and the derived-index fitness function.
export async function buildRecords(only, ctx) {
  const { workDir } = ctx;
  const items = await listItems(workDir);
  const milestones = items
    .filter((item) => item.type === "milestone" && item.parent == null)
    .filter((item) => !only || Number.parseInt(item.number, 10) === Number.parseInt(only, 10));

  const records = [];
  for (const item of milestones) {
    const meta = { item: item.number, itemSlug: item.slug };
    const retroPath = path.join(item.dir, "RETROSPECTIVE.md");
    const archPath = path.join(item.dir, "ARCHITECTURE.md");
    if (existsSync(retroPath)) {
      const text = await readFile(retroPath, "utf8");
      records.push(...parseRetrospective(text, { ...meta, workRelPath: toWorkRel(workDir, retroPath) }));
    }
    if (existsSync(archPath)) {
      const text = await readFile(archPath, "utf8");
      records.push(...parseArchitecture(text, { ...meta, workRelPath: toWorkRel(workDir, archPath) }));
    }
  }
  return records;
}

// Build the frozen index DOCUMENT (ADR-005 index format) over the live stream.
// Pure of disk side-effects so the fitness function can compare two builds.
export async function buildIndex(only, ctx) {
  const records = await buildRecords(only, ctx);
  return {
    backend: "local",
    version: INDEX_VERSION,
    generatedAt: new Date().toISOString(),
    workDir: path.resolve(ctx.workDir),
    recordCount: records.length,
    records,
  };
}

// ----------------------------------------------------------- reindex/status ----

// Reconstruct the derived index from the work-stream `.md` files and write it to
// the fixed path (ADR-005), idempotently ensuring it is git-ignored via the nested
// `.aof/.gitignore` baseline (F-02 — never the repo-root `.gitignore`). `.aof/` is
// tracked, so a committed index would be an authoritative second copy (ADR-001
// violation). A fresh `reindex` fully reconstructs — nothing accretes (ADR-001).
// `only` scopes the rebuild to one milestone; `ingest` is an alias of this (ADR-003).
export async function reindex(only, ctx) {
  const { projectRoot } = ctx;
  const index = await buildIndex(only, ctx);
  const storePath = memoryIndexPath(projectRoot);
  await writeText(storePath, `${JSON.stringify(index, null, 2)}\n`);
  await ensureAofGitignore(projectRoot);
  return {
    backend: "local",
    recordCount: index.recordCount,
    store: storePath,
    version: index.version,
    records: index.records,
  };
}

// Report the backend + counts + store location + lesson/adr split (ADR-003).
// Never throws on an absent store — reports recordCount 0 / not-built.
export async function status(ctx) {
  const { projectRoot } = ctx;
  const storePath = memoryIndexPath(projectRoot);
  let index = null;
  if (existsSync(storePath)) {
    try {
      index = await readJson(storePath);
    } catch {
      index = null; // a corrupt store reports as absent rather than throwing
    }
  }
  const records = Array.isArray(index?.records) ? index.records : [];
  const lessons = records.filter((r) => r.recordType === "lesson").length;
  const adrs = records.filter((r) => r.recordType === "adr").length;
  return {
    backend: "local",
    // Report the LIVE array length, not the persisted `recordCount` field — a stale
    // or hand-edited store must not report a count that disagrees with lessons+adrs.
    recordCount: records.length,
    store: storePath,
    present: Boolean(index),
    lessons,
    adrs,
  };
}
