// `planning-prd` — the PRD seam helpers that `aof:shatter` step 1 binds to.
//
// The seam rests on an agent-honoured CONVENTION, not a tool-enforced path
// (milestone 02 ADR-005, RESEARCH §7): a `create-prd`-skill PRD lands as
// `PRD-<name>.md`, but a `/write-prd`-command PRD may carry no prefix and sit
// elsewhere. So discovery must:
//   - auto-find a single `PRD-*.md` at the workspace root, OR
//   - accept an explicit path (which always wins, even unprefixed), OR
//   - ASK — never silently miss, never guess among other `*.md`.
//
// Two pure helpers, tested over temp-dir/fixtures (the codebase idiom — cf.
// `findWork`/`listItems` in src/work.mjs):
//   discoverPrd(workspaceDir, explicitPath) → { prd } | { ask, candidates }
//   readSeam(prdPath)                       → { objective, scope, milestones }
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";

// A workspace file is a PRD candidate iff its name is `PRD-*.md` (case-sensitive
// prefix per the fixtures; `NOTES.md` and other `*.md` are never candidates).
const PRD_RE = /^PRD-.+\.md$/;

async function fileExists(p) {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

// --------------------------------------------------------------- discover ----

// Resolve the PRD the shatter seam will consume (ADR-005). The discovery matrix:
//   explicit path that exists → { prd } (always wins, disambiguates, even
//                                 unprefixed / outside root)
//   exactly one PRD-*.md root → { prd } (do NOT ask)
//   zero PRD-*.md             → { ask: true, candidates: [] }
//   two or more PRD-*.md      → { ask: true, candidates: [...] } (never pick)
// A non-PRD `*.md` (NOTES.md) is NEVER auto-selected — it is not a candidate.
// Returns absolute paths so callers/tests can `path.basename(...)` portably.
export async function discoverPrd(workspaceDir, explicitPath) {
  // 1. An explicit path always wins — even when it breaks the `PRD-*.md`
  //    convention, even when two PRD-*.md sit at the root (it disambiguates).
  if (explicitPath) {
    const resolved = path.resolve(explicitPath);
    if (await fileExists(resolved)) {
      return { prd: resolved };
    }
    // A passed-but-missing path is not a silent miss: fall through to ASK so
    // the caller surfaces "that path isn't there" rather than guessing.
    return { ask: true, candidates: [] };
  }

  // 2. Scan the workspace root (non-recursive) for `PRD-*.md`.
  let entries;
  try {
    entries = await readdir(workspaceDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  const candidates = entries
    .filter((e) => e.isFile() && PRD_RE.test(e.name))
    .map((e) => path.resolve(workspaceDir, e.name))
    .sort();

  // 3. Exactly one → resolve it; otherwise ASK (zero = nothing to discover;
  //    two-or-more = ambiguous, never silently pick).
  if (candidates.length === 1) {
    return { prd: candidates[0] };
  }
  return { ask: true, candidates };
}

// ---------------------------------------------------------------- readSeam ---

// Strip a leading `#`-style heading marker and surrounding emphasis/punctuation
// so headings like "## 2. Problem & Objective" reduce to "problem & objective".
function headingText(line) {
  return line
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\d+[.)]\s*/, "")
    .replace(/[*_`]/g, "")
    .trim();
}

function isHeading(line) {
  return /^#{1,6}\s+/.test(line);
}

// Pull list items (`- `, `* `, `1. `) out of a block of lines, trimming the
// marker and surrounding emphasis. Stops contributing nothing for prose lines.
function listItems(lines) {
  const items = [];
  for (const raw of lines) {
    const line = raw.trim();
    const m = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.*)$/);
    if (m && m[1].trim()) items.push(m[1].replace(/[*_`]/g, "").trim());
  }
  return items;
}

// Read the seam contract out of a PRD markdown file (ADR-005, A4): the
// objective (the "why"), the in/out scope, and the milestone-sized chunks.
// Parses STRUCTURALLY (headings + sub-lists), not by matching the fixture's
// exact text, so "a PRD the seam can consume" = read-out present & extractable
// is what's tested — robust across the skill- and command-shaped fixtures.
export async function readSeam(prdPath) {
  const text = await readFile(prdPath, "utf8");
  const lines = text.split(/\r?\n/);

  // Group the body into heading-delimited sections: { title, lines[] }.
  const sections = [];
  let current = { title: "", heading: "", lines: [] };
  for (const line of lines) {
    if (isHeading(line)) {
      sections.push(current);
      const heading = headingText(line);
      current = { title: heading.toLowerCase(), heading, lines: [] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);

  const objective = extractObjective(sections);
  const scope = extractScope(sections);
  const milestones = extractMilestones(sections);

  return { objective, scope, milestones };
}

// The objective is the prose under the first heading whose title mentions
// "objective" (e.g. "Objective", "Problem & Objective"). Prefer a sentence
// flagged with a bold "Objective." lead-in; else the first prose paragraph. A
// line-wrapped sentence is joined into its full paragraph (until a blank line,
// heading, list item, or blockquote) so the read-out is not truncated mid-clause.
function extractObjective(sections) {
  const section = sections.find((s) => /objective/.test(s.title));
  if (!section) return "";

  const clean = (value) => value.replace(/[*_`]/g, "").trim();
  const paragraphFrom = (startIdx, firstChunk) => {
    const parts = firstChunk ? [firstChunk.trim()] : [];
    for (let i = startIdx; i < section.lines.length; i += 1) {
      const raw = section.lines[i];
      const line = raw.trim();
      if (!line) break;
      if (isHeading(raw) || line.startsWith(">") || /^(?:[-*+]\s+|\d+[.)]\s+)/.test(line)) break;
      parts.push(line);
    }
    return clean(parts.join(" "));
  };

  // A "**Objective.** …" lead-in is the sharpest signal when present.
  for (let i = 0; i < section.lines.length; i += 1) {
    const m = section.lines[i].match(/\*\*\s*objective\.?\s*\*\*[.:]?\s*(.+)/i);
    if (m && m[1].trim()) return paragraphFrom(i + 1, m[1]);
  }
  // Otherwise the first non-empty, non-blockquote prose paragraph.
  for (let i = 0; i < section.lines.length; i += 1) {
    const line = section.lines[i].trim();
    if (!line || line.startsWith(">")) continue;
    return paragraphFrom(i + 1, line);
  }
  return "";
}

// Scope = the in/out split, with a fixed fallback precedence (ADR-010) so the
// existing shapes keep matching first and the real create-prd template falls
// through to a Release-derived split:
//   1. a section whose title mentions "scope" → the two-shape logic below:
//        (a) sub-headings / bold leads "In scope" / "Out of scope" each owning a list
//        (b) inline "In: …" / "Out: …" lines (the /write-prd command shape)
//   2. else (no "## Scope" — the real 8-section template) → classify each
//      top-level list item of the "## 8. Release" section by its bold-lead label.
function extractScope(sections) {
  const section = sections.find((s) => /scope/.test(s.title));
  if (!section) return scopeFromRelease(sections);

  const inLines = [];
  const outLines = [];
  let bucket = null; // "in" | "out" | null

  for (const raw of section.lines) {
    const line = raw.trim();
    if (!line) continue;

    // Inline "In: a, b, c." / "Out: x, y." (command-shaped).
    const inline = line.match(/^(in|out)(?:[ -]scope)?\s*[:]\s*(.+)$/i);
    if (inline) {
      const which = inline[1].toLowerCase() === "in" ? inLines : outLines;
      for (const part of inline[2].split(/[,;]/)) {
        const item = part.replace(/[*_`.]/g, "").trim();
        if (item) which.push(item);
      }
      continue;
    }

    // Bold / heading sub-section leads: "**In scope**", "Out of scope".
    const plain = line.replace(/[*_`:#]/g, "").trim().toLowerCase();
    if (/^out[ -]?of[ -]?scope$/.test(plain) || /^out[ -]?scope$/.test(plain)) {
      bucket = "out";
      continue;
    }
    if (/^out$/.test(plain)) {
      bucket = "out";
      continue;
    }
    if (/^in[ -]?scope$/.test(plain) || plain === "in") {
      bucket = "in";
      continue;
    }

    // List items fall into the active bucket.
    const li = listItems([raw]);
    if (li.length && bucket) {
      (bucket === "in" ? inLines : outLines).push(...li);
    }
  }

  return { in: inLines, out: outLines };
}

// Fallback scope (ADR-010 step 2): with no "## Scope" heading, the real
// create-prd template carries the in-vs-deferred partition in "## 8. Release"
// as bold-lead list items ("**First version (MVP).** …", "**Fast follow.** …",
// "**Later.** …"). Classify each top-level item by its lead label, matched AFTER
// stripping emphasis (`listItems` already drops `*_\``) and tolerating a trailing
// "." and a "(MVP)"-style parenthetical. Items matching neither label (e.g.
// "Timeframes are relative; no fixed dates.") are ignored. Returns empty scope
// when there is no Release section — an honest empty, not a fabrication.
const SCOPE_IN_RE = /^(first version|mvp|now|v1|initial|launch|fast follow)\b/i;
const SCOPE_OUT_RE = /^(later|future|deferred|out of scope|not in v1|won.?t|non-goals?)\b/i;

function scopeFromRelease(sections) {
  const section = sections.find((s) => /release/.test(s.title));
  if (!section) return { in: [], out: [] };

  const inLines = [];
  const outLines = [];
  for (const item of listItems(section.lines)) {
    // Match the lead label on the leading words, ignoring a "(MVP)" parenthetical
    // and a trailing period so "First version (MVP)." reads as "first version".
    const lead = item.replace(/\s*\([^)]*\)/g, "").replace(/\.$/, "").trim();
    if (SCOPE_IN_RE.test(lead)) inLines.push(item);
    else if (SCOPE_OUT_RE.test(lead)) outLines.push(item);
  }
  return { in: inLines, out: outLines };
}

// Milestone-sized chunks, with a fixed fallback precedence (ADR-010); the first
// step that yields >=1 item wins and later steps are NOT consulted:
//   1. a section whose title mentions "milestone" → its list items (the existing
//      path; keeps both hand-shaped fixtures' "## Milestones" green);
//   2. else a section whose title mentions "key features" → its list items (the
//      real template's "### 7.2 Key Features" — one chunk per key feature);
//   3. else a section whose title mentions the word "features" → its list items
//      (a looser fallback for a "Features" heading step 2 missed).
// "## 8. Release" deliberately does NOT supply chunks — it is the scope source
// (scopeFromRelease), so deriving chunks from Key Features avoids double-counting.
// Each list item is one chunk; a bold lead "**Name** — desc" is fine.
function extractMilestones(sections) {
  const byMilestone = sections.find((s) => /milestone/.test(s.title));
  if (byMilestone) {
    const items = listItems(byMilestone.lines);
    if (items.length) return items;
  }
  const byKeyFeatures = sections.find((s) => /key features/.test(s.title));
  if (byKeyFeatures) {
    const items = listItems(byKeyFeatures.lines);
    if (items.length) return items;
  }
  const byFeatures = sections.find((s) => /\bfeatures\b/.test(s.title));
  if (byFeatures) {
    const items = listItems(byFeatures.lines);
    if (items.length) return items;
  }
  return [];
}
