// Shared mechanics for the milestone 41 insert-* command family. Originally
// story 02's (`insert-top-level`) module — `work:insert-milestone` and
// `work:insert-uat`, both placing a new TOP-LEVEL driver at a caller-named
// position `P` (ARCHITECTURE ADR-002/ADR-005). Story 03 (`insert-story`,
// the NESTED axis) EXTENDS this module rather than duplicating the shared
// mechanics (count-gate, template-scaffold incl. the leading-marker strip,
// envelope shape) — see `runInsertStory` below, added alongside
// `runInsertTopLevel` with zero changes to the top-level helpers or their
// behaviour (purely additive; story 02's tests are untouched).
//
// Mirrors `commands/validate.mjs`'s thin-over-engine shape: this module
// holds the MECHANICS every insert command shares; each command file
// (`insert-milestone.mjs` / `insert-uat.mjs` / `insert-story.mjs`) is the
// thin per-verb `cli` adapter (ADR-002 — "each is a THIN command wrapper
// over the ADR-001 engine").
//
// Does NOT touch `src/work-reindex.mjs` or `src/work.mjs` — milestone 41/story 01
// owns the reindex engine; this module only CALLS `countShiftedByInsert`/
// `reindexForInsert` and `work.mjs`'s readers/constant (`listItems`, `ITEM_RE`,
// `recordDoc`, and — milestone 40/story 01, ADR-002 — `WORK_ITEM_SCHEMA_VERSION`,
// consumed to born-stamp a newly scaffolded item's frontmatter; see stampVersion
// below).
import path from "node:path";
import { readFile, mkdir } from "node:fs/promises";
import { listItems, ITEM_RE, recordDoc, WORK_ITEM_SCHEMA_VERSION } from "../work.mjs";
import { countShiftedByInsert, reindexForInsert } from "../work-reindex.mjs";
import { writeText } from "../fs.mjs";
import { packageVersionString } from "../asset-base.mjs";
import { commandError } from "./errors.mjs";

// ADR-004: "the threshold ... resolved from config via the raw optional-chain
// idiom (NOT the config-editor whitelist — the recurring lesson), with a named
// default." Pinned at refine (task 02 feature header): 5.
const DEFAULT_CONFIRM_THRESHOLD = 5;

function resolveConfirmThreshold(config) {
  const configured = config?.work?.insert?.confirmThreshold;
  return Number.isFinite(configured) ? configured : DEFAULT_CONFIRM_THRESHOLD;
}

// The record docs each top-level type scaffolds — the SAME pair add-milestone/
// add-uat write (SPEC+STATE / SESSION+STATE); no other conditional docs (ADR-002:
// "Frame ONLY").
// 39/ADR-001 (feasibility flag 4): `chore` (milestone 37) joins this map — a
// chore's whole record is the ONE `CHORE.md` doc (no STATE.md; a chore carries
// no running narrative, per 37/ADR-001 — it groups no stories and its whole
// deliverable is a ticked checklist). This is the ONLY change needed to make
// `runInsertTopLevel({ type: "chore", … })` scaffold a chore — the engine below
// is otherwise untouched (reused, not a bespoke writer).
const DOCS_BY_TYPE = {
  milestone: ["SPEC.md", "STATE.md"],
  uat: ["SESSION.md", "STATE.md"],
  chore: ["CHORE.md"],
};

function normalizeSlug(raw) {
  const slug = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9-]*$/.test(slug) ? slug : null;
}

function parsePosition(raw) {
  if (raw == null || raw === "") return null;
  const at = Number.parseInt(raw, 10);
  return Number.isInteger(at) && at >= 0 ? at : null;
}

// "widget-support" -> "Widget Support" — a reasonable placeholder title; the PO
// rewrites it via the same aof-product-owner framing pass add-* uses (ADR-002).
function deriveTitle(slug) {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// CRITICAL (this milestone's own STATE feedback / the build gotcha this story was
// warned about): every `.aof/templates/work/<type>/*.md` ships a leading
// `<!-- aof-generated: bundle -->` comment + a blank line BEFORE the doc's real
// first content line. `parseFrontmatter` (work.mjs) anchors on `^---` with NO /m
// flag, so an identity-bearing doc whose FIRST line is that comment parses to
// `{}` and is born VALIDATE-BROKEN. Strip it so the scaffolded doc's first line
// is its real content.
//
// CRLF/BOM tolerant (review fix): `\r?\n+` alone only consumes complete `\r\n`
// PAIRS one at a time — fine for a lone `\n+` run, but on a CRLF template
// (`-->\r\n\r\n---`, i.e. TWO separate `\r\n` units) a naive `+` over the
// 2-char alternation can stop after the FIRST `\r\n`, leaving a leftover
// `\r\n---` that a fence-only lookahead never satisfied — nothing strips, and
// the scaffolded doc is born validate-broken (`.gitattributes` did not pin
// `.aof/templates/**/*.md` to LF, so a `core.autocrlf=true` Windows checkout
// hits this for real). `(?:\r?\n)+` groups the WHOLE line-ending atom so `+`
// repeats complete `\r\n`/`\n` units, and a leading UTF-8 BOM (`﻿`) is
// tolerated too (an editor-saved template may carry one).
//
// 39/ADR-004 (feasibility flag 1): the lookahead used to anchor on `(?=---)` — a
// frontmatter fence — so it never stripped a frontmatter-less template (e.g.
// `OUTCOME.md`, which opens on `# NN · <Item Title> — Outcome` per ADR-004: it
// carries no identity). Relaxed to `(?=\S)` — ANY non-blank first content line,
// frontmatter fence or heading alike — so the strip is a general leading-marker
// strip, not a frontmatter-specific one. Frontmatter docs are unaffected (`-` in
// `---` is non-blank, so the lookahead still fires identically); the only change
// in behaviour is that a marker-carrying doc with no frontmatter now strips too.
// Exported (39/story 01) so a frontmatter-less doc's strip (OUTCOME.md is never
// scaffolded through the insert-time DOCS_BY_TYPE path — ADR-004: it is authored
// at Accept, not insert) can be asserted directly without a DOCS_BY_TYPE entry.
export function stripBundleMarker(text) {
  return text.replace(/^﻿?<!--[^\n]*-->(?:\r?\n)+(?=\S)/, "");
}

// The born-stamp (ADR-002, milestone 40): `<schema-version>` / `<aof-version>`
// resolve to the RUNNING build's own WORK_ITEM_SCHEMA_VERSION / packageVersionString()
// — never a pinned literal, so the stamp can never drift behind the current
// shape. A template with no such placeholder (uat/chore — story 01 stamps only
// the milestone/story templates, per ARCHITECTURE ADR-002) is unaffected: the
// replace is a harmless no-op when the token is absent.
function stampVersion(text) {
  return text.replace(/<schema-version>/g, String(WORK_ITEM_SCHEMA_VERSION)).replace(/<aof-version>/g, packageVersionString());
}

// Replace the template placeholders (ADR-002 "correctly-numbered,
// correctly-referenced SKELETON"): `NN` (identity number), `<kebab-slug>`,
// `YYYY-MM-DD` (created/updated), and the title placeholder — NEVER the body
// `<...>` prose placeholders (objective/scope stay PO-authored, per ADR-002 "does
// NOT invent objective/scope prose").
function renderTemplate(text, { number, slug, title, today, depends }) {
  let out = stripBundleMarker(text);
  out = out.replace(/\bNN\b/g, number);
  out = out.replace(/<kebab-slug>/g, slug);
  out = out.replace(/YYYY-MM-DD/g, today);
  out = out.replace(/<Milestone Title>/g, title);
  out = out.replace(/<Session Title>/g, title);
  // 39/ADR-001 (feasibility flag 4): the chore template's own title placeholder
  // (`.aof/templates/work/chore/CHORE.md` — frontmatter `title:` + the `# NN ·`
  // heading), the SAME idiom as `<Milestone Title>`/`<Session Title>` above.
  out = out.replace(/<Chore Title>/g, title);
  if (Array.isArray(depends)) {
    out = out.replace(/^(depends:\s*)\[[^\]]*\]/m, `$1[${depends.join(", ")}]`);
  }
  out = stampVersion(out);
  return out;
}

// Fix 1 (structural review, non-atomic insert): PRE-FLIGHT everything that
// can fail cheaply — resolve the computed folder name (validated against
// ITEM_RE) AND read every template the scaffold needs — BEFORE
// `reindexForInsert` renames a single folder. Mirrors the count-gate's own
// "gate before any mutation" discipline (ADR-004): a caller who hits
// `insert-template-missing` (a missing/misconfigured template) must find the
// stream UNTOUCHED — never mid-shifted with an empty gap at slot P and no new
// item to fill it. Read-only; throws, never writes.
async function preflightTopLevelScaffold(workspace, { type, at, slug }) {
  const items = await listItems(workspace.workDir);
  // Match the stream's existing zero-pad width (a sibling top-level item's own
  // folder-number length); an empty stream falls back to the documented 2-digit
  // default ("String(P).padStart(2, '0')" per the task brief).
  const width = items.find((item) => item.parent == null)?.number.length ?? 2;
  const paddedNumber = String(at).padStart(width, "0");
  const folderName = `${paddedNumber}_${type}_${slug}`;
  if (!ITEM_RE.test(folderName)) {
    throw commandError(`computed folder name "${folderName}" is not a valid work-item folder name`, "insert-invalid-folder-name", 500);
  }
  const dir = path.join(workspace.workDir, folderName);

  const templates = [];
  for (const docName of DOCS_BY_TYPE[type]) {
    const templatePath = path.join(workspace.aofDir, "templates", "work", type, docName);
    let raw;
    try {
      raw = await readFile(templatePath, "utf8");
    } catch {
      throw commandError(`scaffold template "${templatePath}" is missing`, "insert-template-missing", 500);
    }
    templates.push({ docName, raw });
  }

  return { paddedNumber, dir, templates };
}

// The WRITE half — called only AFTER `preflightTopLevelScaffold` succeeded
// (every template read, the folder name validated) and `reindexForInsert`
// has opened the slot. Pure write, no template-missing/invalid-name failure
// mode left to surface here (already gated pre-flight).
async function writeTopLevelScaffold(type, slug, today, depends, plan) {
  const { paddedNumber, dir, templates } = plan;
  const title = deriveTitle(slug);
  for (const { docName, raw } of templates) {
    const rendered = renderTemplate(raw, { number: paddedNumber, slug, title, today, depends });
    await writeText(path.join(dir, docName), rendered);
  }

  // `dir` is additive (review fix): the scaffold already computed the created
  // item's own folder path (`plan.dir`) — surfacing it here lets a caller (e.g.
  // promote-gap-to-chore.mjs) consume the ENGINE's own path instead of
  // re-deriving `${ref}_${type}_${slug}` by hand, which duplicates the naming
  // convention and risks an ENOENT crash after the stream has already been
  // reindex-shifted. Existing keys are unchanged — this never removes a key.
  const created = { ref: paddedNumber, type, slug, parent: null, dir };
  if (type === "uat") created.depends = depends ?? [];
  return created;
}

// ADR-006 depends-framing rule (feature 01): the operator names milestones by
// their CURRENT (pre-insert) numbers; the written value is authored against the
// POST-shift stream. A named target `d` becomes `d + 1` when `d >= P` (it itself
// shifts as a consequence of this insert), else it is unchanged. Pure function of
// `at` — no read required, ADR-004's "one source of truth" already fixes which
// items move.
function renumberDepends(rawDepends, at) {
  const list = parseDependsInput(rawDepends);
  return list.map((value) => (value >= at ? value + 1 : value));
}

function parseDependsInput(raw) {
  if (raw == null || raw === "") return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(",");
  return parts
    .map((part) => String(part).trim())
    .filter(Boolean)
    .map((part) => Number.parseInt(part, 10))
    .filter((value) => Number.isInteger(value));
}

// The shared run: count-gate (BEFORE any mutation) -> open the slot -> scaffold.
// `type` is "milestone" | "uat"; `dependsInput` is the raw `--depends` string,
// meaningful only for "uat" (ADR-006: "insert-milestone carries no depends
// concept").
export async function runInsertTopLevel(ctx, { type, slug: rawSlug, at: rawAt, yes, today, dependsInput } = {}) {
  const workDir = ctx.workspace.workDir;
  const config = ctx.workspace.config;

  const slug = normalizeSlug(rawSlug);
  if (!slug) throw commandError("A valid kebab-case slug is required.", "insert-invalid-slug", 400);

  const at = parsePosition(rawAt);
  if (at == null) throw commandError("A target position (--at) is required and must be a non-negative integer.", "insert-invalid-at", 400);

  // ADR-004: compute + gate the count BEFORE any mutation — an above-threshold
  // caller without --yes must leave the stream untouched.
  const shifted = await countShiftedByInsert(workDir, { at, space: "top-level" });
  const threshold = resolveConfirmThreshold(config);
  if (shifted >= threshold && !yes) {
    const error = commandError(
      `insert at ${at} would shift ${shifted} item(s) — re-run with --yes to confirm.`,
      "insert-confirm-required",
      400,
    );
    error.shifted = shifted;
    throw error;
  }

  const writtenDepends = type === "uat" ? renumberDepends(dependsInput, at) : null;

  // Fix 1: pre-flight the scaffold (folder name + every template read)
  // BEFORE the first mutation — see preflightTopLevelScaffold above.
  const plan = await preflightTopLevelScaffold(ctx.workspace, { type, at, slug });

  const reindexResult = await reindexForInsert(workDir, { at, space: "top-level" });

  const created = await writeTopLevelScaffold(type, slug, today ?? new Date().toISOString().slice(0, 10), writtenDepends, plan);

  return { shifted: reindexResult.shifted, at, space: reindexResult.space, created };
}

// ============================================================================
// Story 03 (`insert-story`) — the NESTED axis. `aof work insert-story <slug>
// --at SS --under NN` places a new story at LOCAL position SS under milestone
// NN (ARCHITECTURE ADR-002/ADR-005/ADR-006). Reuses `normalizeSlug`,
// `parsePosition`, `resolveConfirmThreshold`, `stripBundleMarker`,
// `deriveTitle` above unchanged; adds its own scaffold (a story's template
// shape differs from a top-level driver's — ONE doc, an empty `tasks/`, and
// a `parent:` line that names a DIFFERENT number than the story's own
// `number:`/heading, so the top-level `renderTemplate`'s blanket `\bNN\b`
// substitution does not apply as-is) and its own best-effort `## Stories`
// checklist update (ADR-003 Tier 2).
// ============================================================================

// The template's `parent: NN              # the milestone's number; OMIT
// when standalone` line names the MILESTONE's number — a DIFFERENT value
// from the story's own `number: NN` / `# NN ·` heading (both mean the
// story's own number). A blanket `\bNN\b` replace would conflate the two, so
// the parent line is resolved+replaced WHOLE-LINE first (surgical, no
// trailing comment kept — matches the byte-for-byte populated convention
// seen in real story records, e.g. `parent: 41`), THEN the remaining `NN`
// occurrences (the story's own number) are substituted.
function renderStoryTemplate(text, { number, parent, slug, title, today }) {
  let out = stripBundleMarker(text);
  out = out.replace(/^parent:.*$/m, `parent: ${parent}`);
  out = out.replace(/\bNN\b/g, number);
  out = out.replace(/<kebab-slug>/g, slug);
  out = out.replace(/YYYY-MM-DD/g, today);
  out = out.replace(/<Story Title>/g, title);
  out = stampVersion(out);
  return out;
}

// Fix 1 (structural review, non-atomic insert): PRE-FLIGHT the story
// scaffold — compute + validate the new folder name AND read its template —
// BEFORE `reindexForInsert` renames a single sibling folder. `parentItem` is
// the ALREADY-resolved (pre-mutation) milestone `runInsertStory` validated
// against `--under`; a nested reindex never renames the milestone's OWN
// folder (only its stories/ siblings), so `parentItem.dir` stays valid
// straight through the mutation. Read-only; throws, never writes.
async function preflightStoryScaffold(workspace, { parentItem, at, slug }) {
  const items = await listItems(workspace.workDir);
  // Match the milestone's existing sibling stories' zero-pad width; an empty
  // stories/ falls back to the documented 2-digit default.
  const siblingWidth = items.find((item) => item.type === "story" && item.parent != null && Number.parseInt(item.parent, 10) === Number.parseInt(parentItem.number, 10))?.number.length ?? 2;
  const paddedNumber = String(at).padStart(siblingWidth, "0");
  const folderName = `${paddedNumber}_story_${slug}`;
  if (!ITEM_RE.test(folderName)) {
    throw commandError(`computed folder name "${folderName}" is not a valid work-item folder name`, "insert-invalid-folder-name", 500);
  }
  const dir = path.join(parentItem.dir, "stories", folderName);

  const templatePath = path.join(workspace.aofDir, "templates", "work", "story", "STORY.md");
  let raw;
  try {
    raw = await readFile(templatePath, "utf8");
  } catch {
    throw commandError(`scaffold template "${templatePath}" is missing`, "insert-template-missing", 500);
  }

  return { paddedNumber, dir, raw };
}

// The WRITE half — the new STORY.md (+ empty tasks/) into
// `<milestone dir>/stories/<SS>_story_<slug>/` — the SAME template
// `add-story` uses. Called only AFTER `preflightStoryScaffold` succeeded and
// `reindexForInsert` has opened the slot.
async function writeStoryScaffold(parentItem, slug, today, plan) {
  const { paddedNumber, dir, raw } = plan;
  const title = deriveTitle(slug);
  const rendered = renderStoryTemplate(raw, { number: paddedNumber, parent: parentItem.number, slug, title, today });
  await writeText(path.join(dir, "STORY.md"), rendered);
  await mkdir(path.join(dir, "tasks"), { recursive: true });

  return { ref: `${parentItem.number}/${paddedNumber}`, type: "story", slug, parent: parentItem.number, paddedNumber };
}

// --- ADR-003 Tier 2: the milestone SPEC's `## Stories` checklist, BEST-EFFORT ---

const STORIES_HEADING_RE = /^##\s+Stories\s*$/;

// Locate a `## <heading>` section's line range: `[headingIdx+1, end)` is the
// section BODY, `end` the index of the next heading (or EOF). Mirrors
// `commands/feedback.mjs`'s own section-walk (`appendFeedbackBullet`).
function findHeadingSection(lines, headingRe) {
  const headingIdx = lines.findIndex((line) => headingRe.test(line.trim()));
  if (headingIdx === -1) return null;
  let end = lines.length;
  for (let i = headingIdx + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return { headingIdx, end };
}

// A `## Stories` bullet in the FIXTURE-ONLY `NN/SS` convention (feature 02's
// own tests: `- [ ] `NN/SS` — `SS_story_<slug>` — <one-line outcome>.`).
// Captures the ref's milestone/story numbers so a bullet can be matched to
// THIS milestone and renumbered when its story shifted.
function bulletRefMatch(line) {
  const match = line.match(/^(-\s*\[[ xX]\]\s*`)(\d+)\/(\d+)(`.*)$/);
  if (!match) return null;
  return { prefix: match[1], milestoneNum: match[2], storyNum: match[3], rest: match[4] };
}

// A `## Stories` bullet in the REAL convention every shipped milestone
// template/SPEC actually writes (`.aof/templates/work/milestone/SPEC.md`,
// and milestones 00-40's own SPECs): `- [ ] `NN_story_<slug>` — <one-line
// outcome>` — NO milestone-number prefix (the section is already scoped to
// its own milestone). Captures the story's own number for renumbering; the
// number is stripped from the "rest" tail (unlike the `NN/SS` form, the
// folder-name mention here has no SEPARATE embedded number to fix up — it's
// the SAME digits already captured).
function bulletStoryFormMatch(line) {
  const match = line.match(/^(-\s*\[[ xX]\]\s*`)(\d+)(_story_[a-z0-9][a-z0-9-]*`.*)$/);
  if (!match) return null;
  return { prefix: match[1], storyNum: match[2], rest: match[3] };
}

// A checkbox bullet line in ANY form — used only to tell "the section is
// genuinely empty, no established convention yet" apart from "the section
// HAS bullets, in some convention this command doesn't recognize." Fix 4
// (structural review): never splice-at-heading + report `updated:true` over
// the latter — that silently fails to renumber real bullets while claiming
// success.
const ANY_BULLET_RE = /^-\s*\[[ xX]\]/;

// Renumber every shifted sibling's bullet (storyNum >= at -> storyNum+1,
// preserving its zero-pad width) and insert a new bullet for the just-placed
// story immediately before the first (now-renumbered) shifted sibling — or
// after the section's last own bullet when nothing shifted (an append).
function renumberRefForm(lines, { headingIdx, end, newline, milestoneNum, at, paddedNumber, slug, targetMilestoneNum }) {
  let insertBeforeIdx = null;
  let lastOwnBulletIdx = headingIdx;

  for (let i = headingIdx + 1; i < end; i += 1) {
    const match = bulletRefMatch(lines[i]);
    if (!match || Number.parseInt(match.milestoneNum, 10) !== targetMilestoneNum) continue;
    lastOwnBulletIdx = i;
    const storyNum = Number.parseInt(match.storyNum, 10);
    if (storyNum >= at) {
      const newNum = storyNum + 1;
      const newNumStr = String(newNum).padStart(match.storyNum.length, "0");
      const rest = match.rest.replace(new RegExp("`" + match.storyNum + "_story_"), "`" + newNumStr + "_story_");
      lines[i] = `${match.prefix}${match.milestoneNum}/${newNumStr}${rest}`;
      if (insertBeforeIdx === null) insertBeforeIdx = i;
    }
  }

  const newBullet = `- [ ] \`${milestoneNum}/${paddedNumber}\` — \`${paddedNumber}_story_${slug}\` — ${deriveTitle(slug)}.`;
  const insertIdx = insertBeforeIdx === null ? lastOwnBulletIdx + 1 : insertBeforeIdx;
  lines.splice(insertIdx, 0, newBullet);
  return { updated: true, text: lines.join(newline) };
}

// Same shape as `renumberRefForm`, in the real `NN_story_<slug>` convention —
// no milestone-number prefix to match/preserve (every bullet in the section
// already belongs to this milestone).
function renumberStoryForm(lines, { headingIdx, end, newline, at, paddedNumber, slug }) {
  let insertBeforeIdx = null;
  let lastBulletIdx = headingIdx;

  for (let i = headingIdx + 1; i < end; i += 1) {
    const match = bulletStoryFormMatch(lines[i]);
    if (!match) continue;
    lastBulletIdx = i;
    const storyNum = Number.parseInt(match.storyNum, 10);
    if (storyNum >= at) {
      const newNum = storyNum + 1;
      const newNumStr = String(newNum).padStart(match.storyNum.length, "0");
      lines[i] = `${match.prefix}${newNumStr}${match.rest}`;
      if (insertBeforeIdx === null) insertBeforeIdx = i;
    }
  }

  const newBullet = `- [ ] \`${paddedNumber}_story_${slug}\` — ${deriveTitle(slug)}.`;
  const insertIdx = insertBeforeIdx === null ? lastBulletIdx + 1 : insertBeforeIdx;
  lines.splice(insertIdx, 0, newBullet);
  return { updated: true, text: lines.join(newline) };
}

// Renumber+insert the milestone's `## Stories` checklist, in WHICHEVER
// convention the section's existing bullets actually use — never a blind
// splice at the heading. Returns `{ updated:false, reason }` for every
// honest non-update: no `## Stories` section (feature 02's original skip),
// or a section whose bullets use a convention this command does not
// recognize (Fix 4, structural review — the "falsely reports success on the
// dominant bullet convention" fix: NEVER report `updated:true` when nothing
// was actually renumbered/placed correctly).
function renumberAndInsertStoriesBullets(text, { milestoneNum, at, paddedNumber, slug }) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r?\n/);
  const section = findHeadingSection(lines, STORIES_HEADING_RE);
  if (!section) return { updated: false, reason: "## Stories section not found" };

  const { headingIdx, end } = section;
  const targetMilestoneNum = Number.parseInt(milestoneNum, 10);

  // Classify every bullet-looking line in the section BEFORE mutating
  // anything, so the whole section is renumbered in ONE consistent,
  // recognized form.
  let hasOwnRefForm = false;
  let hasStoryForm = false;
  let hasUnrecognizedBullet = false;
  for (let i = headingIdx + 1; i < end; i += 1) {
    const line = lines[i];
    const refMatch = bulletRefMatch(line);
    if (refMatch) {
      if (Number.parseInt(refMatch.milestoneNum, 10) === targetMilestoneNum) hasOwnRefForm = true;
      continue;
    }
    if (bulletStoryFormMatch(line)) {
      hasStoryForm = true;
      continue;
    }
    if (ANY_BULLET_RE.test(line)) hasUnrecognizedBullet = true;
  }

  if (hasOwnRefForm) {
    return renumberRefForm(lines, { headingIdx, end, newline, milestoneNum, at, paddedNumber, slug, targetMilestoneNum });
  }
  if (hasStoryForm) {
    return renumberStoryForm(lines, { headingIdx, end, newline, at, paddedNumber, slug });
  }
  if (hasUnrecognizedBullet) {
    // The section has bullets, but none in a convention this command
    // recognizes for THIS milestone — the honest-skip fix: never splice at
    // the heading and claim success over an unrenumbered/misplaced result.
    return { updated: false, reason: "## Stories section uses an unrecognized bullet convention" };
  }

  // Genuinely empty (no bullets at all — e.g. a freshly scaffolded
  // milestone's "to be broken down" placeholder prose) — append in the real
  // template's own bare form, the only honest default with no established
  // convention to match.
  return renumberStoryForm(lines, { headingIdx, end, newline, at, paddedNumber, slug });
}

// The best-effort update entry point: read the milestone's record doc,
// renumber+insert its `## Stories` bullets, write it back. ANY failure
// (missing section, unreadable doc, unexpected shape) resolves to a SKIP —
// this must never throw and never fail the insert (ADR-003 Tier 2, feature
// 02's "a stale bullet is a human-doc nit ... must not make the insert
// fail").
async function updateStoriesChecklist(workDir, { parentNumber, at, paddedNumber, slug }) {
  try {
    const items = await listItems(workDir);
    const parentItem = items.find(
      (item) => item.type === "milestone" && item.parent == null && Number.parseInt(item.number, 10) === Number.parseInt(parentNumber, 10),
    );
    if (!parentItem) return { updated: false, skipped: true, reason: "milestone not found" };
    const doc = recordDoc(parentItem);
    if (!doc) return { updated: false, skipped: true, reason: "milestone has no record doc" };
    const docPath = path.join(parentItem.dir, doc);
    let text;
    try {
      text = await readFile(docPath, "utf8");
    } catch {
      return { updated: false, skipped: true, reason: "record doc unreadable" };
    }
    const result = renumberAndInsertStoriesBullets(text, { milestoneNum: parentItem.number, at, paddedNumber, slug });
    if (!result.updated) {
      return { updated: false, skipped: true, reason: result.reason ?? "## Stories checklist update skipped" };
    }
    await writeText(docPath, result.text);
    return { updated: true, skipped: false };
  } catch {
    return { updated: false, skipped: true, reason: "## Stories checklist update skipped" };
  }
}

// The nested-axis run: validate `--under` resolves to a real milestone
// BEFORE any mutation, count-gate (BEFORE any mutation, ADR-004) -> open the
// slot via the engine's nested space -> scaffold the story -> best-effort
// update the `## Stories` checklist (Tier 2, never gates the result).
export async function runInsertStory(ctx, { slug: rawSlug, at: rawAt, under: rawUnder, yes, today } = {}) {
  const workDir = ctx.workspace.workDir;
  const config = ctx.workspace.config;

  const slug = normalizeSlug(rawSlug);
  if (!slug) throw commandError("A valid kebab-case slug is required.", "insert-invalid-slug", 400);

  const at = parsePosition(rawAt);
  if (at == null) throw commandError("A target local position (--at) is required and must be a non-negative integer.", "insert-invalid-at", 400);

  const under = parsePosition(rawUnder);
  if (under == null) throw commandError("A target milestone (--under) is required and must be a non-negative integer.", "insert-invalid-under", 400);

  const items = await listItems(workDir);
  const parentItem = items.find((item) => item.type === "milestone" && item.parent == null && Number.parseInt(item.number, 10) === under);
  if (!parentItem) {
    throw commandError(`no milestone resolves to "--under ${under}".`, "insert-parent-not-found", 404);
  }

  // ADR-004, scoped to the target milestone's own siblings (the engine's
  // nested count already scopes by parent) — compute + gate BEFORE any
  // mutation.
  const shifted = await countShiftedByInsert(workDir, { at, space: "nested", parent: under });
  const threshold = resolveConfirmThreshold(config);
  if (shifted >= threshold && !yes) {
    const error = commandError(
      `insert-story at ${at} under milestone ${parentItem.number} would shift ${shifted} sibling story(ies) — re-run with --yes to confirm.`,
      "insert-confirm-required",
      400,
    );
    error.shifted = shifted;
    throw error;
  }

  // Fix 1: pre-flight the story scaffold (folder name + template read)
  // BEFORE the first mutation — see preflightStoryScaffold above.
  const plan = await preflightStoryScaffold(ctx.workspace, { parentItem, at, slug });

  const reindexResult = await reindexForInsert(workDir, { at, space: "nested", parent: under });

  const scaffolded = await writeStoryScaffold(parentItem, slug, today ?? new Date().toISOString().slice(0, 10), plan);
  const { paddedNumber, ...created } = scaffolded;

  const checklist = await updateStoriesChecklist(workDir, {
    parentNumber: parentItem.number,
    at,
    paddedNumber,
    slug,
  });

  return { shifted: reindexResult.shifted, at, space: reindexResult.space, parent: parentItem.number, created, checklist };
}
