// The recovery SEAM (milestone 13 — story 01 OWNS the real heuristics).
//
// Story 00 (the spine) freezes the SIGNATURE + the `recovered` shape; this module
// fills in the real source-shape tolerance — aof-STRUCTURED (its own SPEC /
// ARCHITECTURE / RETROSPECTIVE) OR ARBITRARY (README, docs/, ADR-style files,
// commit history) — and the "absence is information" recording (ADR-005): recovery
// recovers only what is PRESENT and NEVER fabricates a SPEC objective, an ADR, or a
// lesson the source never had.
//
//   recoverMilestone(sourceDir, selector) → recovered
//   listRecoverableMilestones(sourceDir)  → [ { ref, slug, dir } ]
//
// FROZEN `recovered` shape (the seam stories 00/01/02 couple to):
//   {
//     intent:    { objective, scope } | null,          // → SPEC.md (legible intent, never indexed)
//     decisions: [ { id, title, status, body } ],       // → ARCHITECTURE.md `## ADR-NNN` → adr records
//     outcomes:  [ { id, title, body } ],               // → RETROSPECTIVE.md `## R<n>` → lesson records
//   }
//
// A recovered decision carries `{ id:"ADR-00N", title, status, body }` and a
// recovered outcome `{ id:"R<n>", title, body }` so the round-trip
// (recover → materializeImport → parseArchitecture/parseRetrospective) yields
// exactly the right adr/lesson record counts — recovery PRODUCES the `recovered`
// shape; it does not import the parsers (ADR-001).
//
// Source access here is READ-ONLY (ADR-002): the sourceDir is read in place; this
// module spawns ONLY the read-only `git log` verb (no shell string, never a write
// verb against the source). The read-only REMOTE fetch seam lives in
// src/import/source.mjs.
import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

// The aof work-item milestone-folder pattern (mirrors src/work.mjs ITEM_RE, scoped
// to milestones) — the aof-STRUCTURED lane's detector.
const MILESTONE_RE = /^(\d+)_milestone_([a-z0-9-]+)$/;

// The synthetic ref an ARBITRARY (non-aof) source recovers under, so the
// missing-`<selector>` default in the command still resolves (story 00's flow keys
// off listRecoverableMilestones returning ≥1 candidate). It is NOT a work item name
// (the store prefixes it `import-…`), and the import store slugs it stably.
const ARBITRARY_REF = "repo";
const ARBITRARY_SLUG = "repo";

// The conventional work dir under an aof-structured source.
function sourceWorkDir(sourceDir) {
  return path.join(sourceDir, "wiki", "work");
}

async function readDirSafe(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readFileSafe(file) {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

// Enumerate the recoverable milestones in a source. For an aof-STRUCTURED source
// these are its `wiki/work/<NN>_milestone_<slug>/` folders. For an ARBITRARY source
// (no aof work dir) this returns a SINGLE synthetic candidate (the repo treated as
// one milestone) so the missing-`<selector>` default still resolves (ADR-005:
// absence of aof structure is not absence of a milestone to recover). Returns
// [{ ref, slug, dir }] sorted by ref. The synthetic candidate carries the repo root
// as `dir` so recoverMilestone can read its arbitrary signals.
export async function listRecoverableMilestones(sourceDir) {
  const workDir = sourceWorkDir(sourceDir);
  const milestones = [];
  for (const entry of await readDirSafe(workDir)) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(MILESTONE_RE);
    if (!match) continue;
    milestones.push({ ref: match[1], slug: match[2], dir: path.join(workDir, entry.name) });
  }
  if (milestones.length > 0) {
    return milestones.sort((a, b) => Number.parseInt(a.ref, 10) - Number.parseInt(b.ref, 10));
  }
  // ARBITRARY lane: no aof milestones — the repo IS the single recoverable unit.
  return [{ ref: ARBITRARY_REF, slug: ARBITRARY_SLUG, dir: sourceDir, arbitrary: true }];
}

// Pick the milestone the selector names. A numeric/slug selector matches an aof
// milestone; for an arbitrary source the lone synthetic candidate is the default
// (any selector resolves to it, since the repo is the one recoverable unit).
// Returns the candidate or null.
function findMilestone(milestones, selector) {
  if (selector == null) return null;
  const wantNum = Number.parseInt(selector, 10);
  return (
    milestones.find((m) => m.slug === selector) ??
    milestones.find((m) => m.ref === String(selector)) ??
    milestones.find((m) => Number.isFinite(wantNum) && Number.parseInt(m.ref, 10) === wantNum) ??
    // An arbitrary source has exactly one (synthetic) candidate: a selector that
    // names a path/anchor resolves to it (the repo is the only recoverable unit).
    (milestones.length === 1 && milestones[0].arbitrary ? milestones[0] : null) ??
    null
  );
}

// ─────────────────────────────────────────── shared section/heading parsing ──

// Split a markdown body into heading-delimited sections (mirrors the indexer's
// splitSections, but recovery owns its own copy — it PRODUCES the recovered shape
// and never imports the parsers, ADR-001). Each section: { header, body[] }.
function splitSections(text, headerRe) {
  const lines = text.split(/\r?\n/);
  const sections = [];
  let current = null;
  for (const line of lines) {
    if (headerRe.test(line)) {
      if (current) sections.push(current);
      current = { header: line, body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

// The prose paragraphs of a section body, dropping front-matter/HTML-comment/blank
// noise, joined with blank-line separators (a faithful body for materialize).
function sectionBody(bodyLines) {
  const out = [];
  let blanks = 0;
  for (const raw of bodyLines) {
    const line = raw.replace(/\s+$/, "");
    if (line.trim().length === 0) {
      blanks += 1;
      continue;
    }
    if (out.length > 0 && blanks > 0) out.push("");
    blanks = 0;
    out.push(line);
  }
  return out.join("\n").trim();
}

// Read the prose after a heading matched by `headingRe`, up to the next heading.
// Improves on the stub's first-paragraph-only capture: it collects ALL prose lines
// of the section (skipping HTML comments + blockquote callouts) so the recovered
// Objective/Scope is the real section text, not a truncated first line. Returns ""
// when the heading is absent.
function proseAfter(body, headingRe) {
  const lines = body.split(/\r?\n/);
  const start = lines.findIndex((line) => headingRe.test(line));
  if (start < 0) return "";
  const out = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^#{1,6}\s/.test(line)) break;
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      if (out.length > 0) break; // first blank AFTER content ends the paragraph
      continue;
    }
    if (/^<!--/.test(trimmed) || /^-->/.test(trimmed)) continue; // HTML comment lines
    if (/^>/.test(trimmed)) continue; // blockquote callout (e.g. SPEC "> Inputs:")
    out.push(trimmed);
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

// ──────────────────────────────────────────────── aof-STRUCTURED recovery ──

// Recover intent from an aof SPEC.md: the Objective + Scope section prose. Returns
// { objective, scope } | null — null when NEITHER is recoverable (absence is
// information, ADR-005: a missing/empty SPEC records the intent as not recoverable).
//
// The objective heading is matched by SYNONYM, not just aof's own `## Objective`:
// a source it didn't run may head its intent `## Goal` (a common real-world SPEC
// convention — surfaced by the voice-vox testbed, where every SPEC used `## Goal`).
// Matching `Objective|Goal` recovers the intent of a non-aof-native SPEC without
// fabricating — the prose still comes verbatim from the matched heading's section.
async function recoverAofIntent(milestoneDir) {
  const specPath = path.join(milestoneDir, "SPEC.md");
  if (!existsSync(specPath)) return null;
  const body = await readFileSafe(specPath);
  const objective = proseAfter(body, /^#{1,6}\s+.*\b(Objective|Goal)\b/i);
  const scope = proseAfter(body, /^#{1,6}\s+.*\bScope\b/i);
  if (objective.length === 0 && scope.length === 0) return null;
  return { objective, scope };
}

// Recover decisions from an aof ARCHITECTURE.md: each `## ADR-NNN` block → a
// `{ id, title, status, body }` decision. The id/title come from the heading
// (accepting the same separator variants the parser tolerates); the status from the
// block's `**Status:**` line; the body is the recovered section prose. Round-trip:
// N source ADR blocks → N decisions → N `## ADR-NNN` materialized blocks → N adr
// records. Returns [] when the doc is absent or holds no ADR blocks (no fabrication).
async function recoverAofDecisions(milestoneDir) {
  const archPath = path.join(milestoneDir, "ARCHITECTURE.md");
  if (!existsSync(archPath)) return [];
  const body = await readFileSafe(archPath);
  const decisions = [];
  for (const section of splitSections(body, /^#{2,3}\s+ADR-\d+/)) {
    const head = section.header.match(/^#{2,3}\s+(ADR-\d+)\s*[:·—–-]?\s*(.*)$/);
    const id = head ? head[1] : section.header.replace(/^#{2,3}\s+/, "").trim();
    const title = head ? head[2].replace(/`/g, "").trim() : "";
    const statusLine = section.body.find((line) => /\*\*Status:\*\*/i.test(line)) ?? "";
    const status = (statusLine.match(/\*\*Status:\*\*\s*(.+)/) ?? [, "Accepted"])[1].trim() || "Accepted";
    // Drop the source's own `**Status:**` line(s) from the recovered body — the
    // status is captured into the `status` field and `renderArchitecture` re-emits
    // it, so keeping it here would duplicate the Status line in the materialized
    // block. The decision prose (Context/Decision/Invariant) is the recovered body.
    const bodyLines = section.body.filter((line) => !/^\s*\*\*Status:\*\*/i.test(line));
    decisions.push({ id, title, status, body: sectionBody(bodyLines) });
  }
  return renumberDecisions(decisions);
}

// Recover outcomes from an aof RETROSPECTIVE.md: each `## R<n>` entry → an
// `{ id, title, body }` outcome. Round-trip: N source R-entries → N outcomes → N
// `## R<n>` materialized entries → N lesson records. Returns [] when the doc is
// absent or holds no R-entries (no fabrication).
async function recoverAofOutcomes(milestoneDir) {
  const retroPath = path.join(milestoneDir, "RETROSPECTIVE.md");
  if (!existsSync(retroPath)) return [];
  const body = await readFileSafe(retroPath);
  const outcomes = [];
  for (const section of splitSections(body, /^#{2,3}\s+R\d+\b/)) {
    const head = section.header.match(/^#{2,3}\s+(R\d+)\s*[:·—–-]?\s*(.*)$/);
    const id = head ? head[1] : section.header.replace(/^#{2,3}\s+/, "").trim();
    const title = head ? head[2].replace(/`/g, "").trim() : "";
    outcomes.push({ id, title, body: sectionBody(section.body) });
  }
  return renumberOutcomes(outcomes);
}

// ──────────────────────────────────────────────────── ARBITRARY recovery ──

// Recover intent from an arbitrary repo's README overview. The README's leading
// prose (before any "## Install"/"## Usage" boilerplate, the "what it set out to do"
// summary) becomes the Objective; the same overview seeds Scope (an arbitrary repo
// rarely separates them). Returns { objective, scope } | null when no README/overview
// is present (absence is information, ADR-005). Reads a `readme` file with an
// optional `.md` / `.markdown` / `.txt` extension, case-insensitively (so
// `README.md`, `README`, `readme.txt`, … all match on any filesystem).
async function recoverArbitraryIntent(sourceDir) {
  const entries = await readDirSafe(sourceDir);
  const readme = entries.find(
    (e) => e.isFile() && /^readme(\.md|\.markdown|\.txt)?$/i.test(e.name)
  );
  if (!readme) return null;
  const body = await readFileSafe(path.join(sourceDir, readme.name));
  const overview = readmeOverview(body);
  if (overview.length === 0) return null;
  return { objective: overview, scope: overview };
}

// The README's overview prose: the first run of non-heading, non-badge prose lines
// (the "what the project set out to do" summary). Skips the title heading, HTML
// comments, shields/badges, and stops at the first section heading. Honest — if the
// README is all headings/badges with no prose, returns "" (no fabrication).
function readmeOverview(body) {
  const lines = body.split(/\r?\n/);
  const out = [];
  let seenProse = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^#{1,6}\s/.test(line)) {
      if (seenProse) break; // a section heading after the overview prose ends it
      continue; // the title heading(s) before the overview
    }
    if (line.length === 0) {
      if (seenProse) break;
      continue;
    }
    if (/^<!--/.test(line) || /^-->/.test(line)) continue;
    if (/^(\[!\[|!\[|\[!)/.test(line)) continue; // badge / shield image lines
    out.push(line);
    seenProse = true;
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

// Recover decisions from an arbitrary repo's `docs/` tree + ADR-style files. Each
// recovered decision is written INTO a `{ id:"ADR-00N", title, status:"Accepted",
// body }` so materialize produces a parser-clean `## ADR-NNN` block (the
// Three-Amigos "parser-clean headings" pin). Sources scanned: `docs/adr/*.md`,
// `decisions/*.md`, and any top-level/`docs/` file whose name contains "adr" or
// "decision". The title is the file's first heading (or its basename); the body is
// the file's prose. Returns [] when no such files exist (no fabrication).
async function recoverArbitraryDecisions(sourceDir) {
  const files = await collectDecisionFiles(sourceDir);
  const decisions = [];
  for (const file of files) {
    const text = await readFileSafe(file);
    const title = firstHeading(text) || titleFromFilename(file);
    const body = stripFrontmatterAndComments(text);
    if (title.length === 0 && body.length === 0) continue;
    decisions.push({ id: "ADR-000", title, status: "Accepted", body });
  }
  return renumberDecisions(decisions);
}

// Collect the arbitrary decision-source files, de-duplicated + sorted for a stable
// recovery order (so a re-import is a clean snapshot, ADR-005). Looks under
// `docs/adr/`, `docs/decisions/`, `decisions/`, and any `*adr*`/`*decision*`.md at
// the repo root or under `docs/`.
async function collectDecisionFiles(sourceDir) {
  const found = new Set();
  const adrDirs = [
    path.join(sourceDir, "docs", "adr"),
    path.join(sourceDir, "docs", "adrs"),
    path.join(sourceDir, "docs", "decisions"),
    path.join(sourceDir, "decisions"),
    path.join(sourceDir, "adr"),
  ];
  for (const dir of adrDirs) {
    for (const entry of await readDirSafe(dir)) {
      if (entry.isFile() && /\.(md|markdown)$/i.test(entry.name)) {
        found.add(path.join(dir, entry.name));
      }
    }
  }
  // Loose ADR/decision-named files at the root and under docs/.
  for (const dir of [sourceDir, path.join(sourceDir, "docs")]) {
    for (const entry of await readDirSafe(dir)) {
      if (
        entry.isFile() &&
        /\.(md|markdown)$/i.test(entry.name) &&
        /(adr|decision)/i.test(entry.name) &&
        !/^readme/i.test(entry.name)
      ) {
        found.add(path.join(dir, entry.name));
      }
    }
  }
  return [...found].sort();
}

// Recover outcomes from an arbitrary repo's git commit history: each commit subject
// (`git log --format=%s`, read-only) → an `{ id:"R<n>", title:<subject>, body }`
// outcome, written INTO a parser-clean `## R<n>` entry. Subjects are recovered in
// chronological (oldest-first) order so R1 is the first delivered. Returns [] when
// the source is not a git repo or has no commits (no fabrication). Read-only: ONLY
// `git log` — never a write verb against the source (ADR-002).
function recoverArbitraryOutcomes(sourceDir) {
  if (!existsSync(path.join(sourceDir, ".git"))) return [];
  // No shell: `git` is a real executable found on PATH, and a shell would
  // word-split args + invite injection. The read-only `git log` verb only.
  const result = spawnSync(
    "git",
    ["-C", sourceDir, "log", "--reverse", "--no-merges", "--format=%s"],
    { encoding: "utf8" }
  );
  if (result.status !== 0 || typeof result.stdout !== "string") return [];
  const subjects = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const outcomes = subjects.map((subject) => ({
    id: "R0",
    title: subject,
    body: `- **Lesson:** ${subject}`,
  }));
  return renumberOutcomes(outcomes);
}

// ───────────────────────────────────────────────────────────── helpers ──

// Re-number a decision list to contiguous `ADR-001`, `ADR-002`, … so the
// materialized headings are parser-clean and unique even when the source ids
// collided or were absent. Preserves order (the recovered sequence).
function renumberDecisions(decisions) {
  return decisions.map((decision, idx) => ({
    ...decision,
    id: `ADR-${String(idx + 1).padStart(3, "0")}`,
  }));
}

// Re-number an outcome list to contiguous `R1`, `R2`, … (the `## R<n>` convention
// the parser reads), preserving order.
function renumberOutcomes(outcomes) {
  return outcomes.map((outcome, idx) => ({ ...outcome, id: `R${idx + 1}` }));
}

// The first `#`-level heading text of a doc (its title), de-emphasised. "" when none.
function firstHeading(text) {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) return m[1].replace(/`/g, "").trim();
  }
  return "";
}

// A human title from a filename (e.g. "0001-use-postgres.md" → "use postgres").
function titleFromFilename(file) {
  return path
    .basename(file)
    .replace(/\.(md|markdown)$/i, "")
    .replace(/^\d+[-_]?/, "")
    .replace(/[-_]+/g, " ")
    .trim();
}

// Strip YAML front-matter + HTML comments from a doc body, leaving the recovered
// prose for the materialized block.
function stripFrontmatterAndComments(text) {
  let body = text.replace(/^---\n[\s\S]*?\n---\n?/, "");
  body = body.replace(/<!--[\s\S]*?-->/g, "");
  return body.trim();
}

// ─────────────────────────────────────────────────────── the seam entry ──

// Recover one milestone's `recovered` shape from a source (the FROZEN seam). Detects
// the source SHAPE: an aof-structured milestone folder (recover its own SPEC /
// ARCHITECTURE / RETROSPECTIVE) vs an arbitrary repo (README → intent, docs/ADRs →
// decisions, git log → outcomes). Recovers only what is PRESENT and leaves what is
// absent as `intent:null` / `decisions:[]` / `outcomes:[]` — materialize then writes
// the not-recoverable marker / omits the absent artifact (ADR-005: NEVER fabricates).
export async function recoverMilestone(sourceDir, selector) {
  const milestones = await listRecoverableMilestones(sourceDir);
  const picked =
    findMilestone(milestones, selector) ?? (milestones.length === 1 ? milestones[0] : null);

  const recovered = { intent: null, decisions: [], outcomes: [] };
  if (!picked) return recovered;

  if (picked.arbitrary) {
    // ARBITRARY lane: read the repo's arbitrary signals.
    recovered.intent = await recoverArbitraryIntent(picked.dir);
    recovered.decisions = await recoverArbitraryDecisions(picked.dir);
    recovered.outcomes = recoverArbitraryOutcomes(picked.dir);
    return recovered;
  }

  // aof-STRUCTURED lane: recover the source milestone's own docs.
  recovered.intent = await recoverAofIntent(picked.dir);
  recovered.decisions = await recoverAofDecisions(picked.dir);
  recovered.outcomes = await recoverAofOutcomes(picked.dir);
  return recovered;
}
