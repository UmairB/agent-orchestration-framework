// migrate:folder — convert a source folder INTO a managed aof work item
// (story 29 / migrate-command). The load-bearing CONTRAST with import:milestone:
//
//   import  → SUMMARISES a foreign folder into a co-located AOF.md knowledge
//             digest. Read-only on the source, a one-time snapshot, NEVER managed.
//   migrate → CONVERTS a folder INTO managed work in the stream — a real, numbered
//             milestone SPEC.md (+ STATE.md, ARCHITECTURE.md, stories/tasks) under
//             work.dir that resolves via `aof work find` and passes `aof work
//             validate`. The work BECOMES the item, not a digest of it.
//
//   input  { folder, dryRun?, migratedAt? }
//   result { migrated, milestoneRef, dir, status, storyCount, taskCount,
//            findingCount, findings, dryRun }
//
// `run` resolves the source READ-ONLY through the SAME seam import uses
// (resolveImportSource → isLocalSource, the offline @executable lane) and recovers
// it with the SAME recovery (recoverMilestone, including the arbitrary-source lane:
// README→intent, docs/ADRs→decisions, history→outcomes). It NEVER mutates or moves
// the source (the story-03 read-only arch-test). It then SCAFFOLDS a fresh managed
// milestone under work.dir at the NEXT FREE top-level slot — the architect's
// scaffold-not-relocate call (STORY.md Notes). A --dry-run PREVIEWS the scaffold
// (ref + dir + counts) and writes NOTHING (import's preview discipline).
//
// Four migrate-NEW seams over what import/recovery give for free (STORY.md
// feasibility notes), each implemented here:
//   - EMPTY-SOURCE REFUSAL: recovery returns an all-empty shape rather than
//     throwing, so migrate adds its own refusal (nothing-recoverable) — non-zero,
//     nothing written (file 03 "empty source refused cleanly").
//   - `done`-CLAMP: a source's self-asserted "done" is clamped to at most
//     in-review — migrate NEVER stamps "done" (earned only via aof:verify; file 02).
//   - FINDINGS + GAP-DETECTION: when delivered work has gaps, write
//     developer-actionable findings into the produced STATE.md `## Findings` (file
//     02). No delivered work → no findings (absence is information, never invented).
//   - STATUS reflecting reality: no work → not-started; delivered-with-gaps →
//     in-progress; fully delivered, clean → in-review (the honest ceiling).
import path from "node:path";
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import { commandError } from "./errors.mjs";
import { resolveImportSource } from "../import/source.mjs";
import { recoverMilestone, listRecoverableMilestones } from "../import/recovery.mjs";
import { slugifySource } from "../import/store.mjs";

// The aof top-level work-item folder pattern (mirrors src/work.mjs ITEM_RE, scoped
// to the leading number) — used to find the next free slot under work.dir. Keep the
// six-type alternation in lockstep with src/work.mjs (m37 added spike/chore): a
// top-slot spike/chore folder must count toward nextFreeSlot, else migrate could
// mint a milestone with a duplicate driver number.
const ITEM_RE = /^(\d+)_(milestone|story|task|uat|spike|chore)_([a-z0-9-]+)$/;
// A story-folder pattern under a source milestone's `stories/` dir. Tolerant of the
// aof `SS_story_slug` form and a loose `SS[-_]slug` numbered form (a foreign source
// need not use aof's exact naming — the project principle: ingest as-is).
// NOTE: keep in sync with recovery.mjs NUMBERED_FOLDER_RE + recoverAofMeta's heading
// parse. This re-implements the same number+title parse one level down (story folders,
// not milestone folders) and has drifted once already (`[·•]` vs `[·•\s]`). DEFERRED
// follow-up: have recovery.mjs export a shared story-folder enumerator / title helper
// so there is ONE parser for the source's aof story folders — left here because that
// extraction is non-trivial (recovery's helpers are milestone-scoped + unexported).
const STORY_FOLDER_RE = /^(\d+)[-_]+(?:story[-_]+)?(.+)$/;

export const migrateFolderCommand = {
  id: "migrate:folder",
  input: {
    type: "object",
    properties: {
      folder: { type: "string" },
      dryRun: { type: "boolean" },
      // Injectable provenance date for the produced frontmatter (created/updated),
      // defaulting to today. Injectable so tests are deterministic, mirroring
      // import's `importedAt`.
      migratedAt: { type: "string" },
    },
    required: ["folder"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const folder = input.folder;
    const dryRun = input.dryRun === true;

    if (typeof folder !== "string" || folder.length === 0) {
      throw commandError("Usage: aof migrate <folder>", "missing-folder", 400);
    }

    // Resolve the source READ-ONLY through the SAME seam import uses. A LOCAL
    // <folder> reads in place (no network — the @executable lane); a nonexistent /
    // unreadable path throws the distinct source-read error resolveImportSource
    // raises (kept distinct from the missing-folder usage error — QA's two rows).
    const { sourceDir } = resolveImportSource({ repo: folder, dryRun });
    if (sourceDir == null) {
      // A remote source has no local tree to recover offline (import's spine only
      // drives the local lane); migrate's @executable surface is offline-only.
      throw commandError(
        `Migrating from a remote source is not supported. Pass a local <folder> path.`,
        "remote-source-unsupported",
        501
      );
    }

    // Recover the source with the SAME recovery import uses — the source-shape
    // tolerance (aof-structured OR arbitrary: README→intent, docs/ADRs→decisions,
    // history→outcomes), never demanding aof's layout. A missing selector defaults
    // to the sole recoverable unit (recovery's missing-selector default).
    const recovered = await recoverMilestone(sourceDir, null);

    // EMPTY-SOURCE REFUSAL (migrate-NEW guard): recovery returns an all-empty shape
    // rather than throwing, so refuse cleanly here — non-zero, NOTHING written under
    // work.dir (file 03 "an empty or unrecoverable source is refused cleanly").
    const hasIntent = recovered.intent != null;
    const decisions = Array.isArray(recovered.decisions) ? recovered.decisions : [];
    const outcomes = Array.isArray(recovered.outcomes) ? recovered.outcomes : [];
    if (!hasIntent && decisions.length === 0 && outcomes.length === 0) {
      throw commandError(
        `Nothing was recoverable to migrate from "${folder}" — no intent, decisions, or delivered work found.`,
        "nothing-recoverable",
        422
      );
    }

    const workDir = ctx.workspace.workDir;
    const migratedAt = input.migratedAt ?? new Date().toISOString().slice(0, 10);

    // The produced milestone's identity: the next free top-level slot (so it never
    // clobbers or renumbers existing work) + the recovered slug. The recovered slug
    // is re-slugged to the aof `[a-z0-9-]` folder vocabulary.
    const number = await nextFreeSlot(workDir);
    const slug = slugifySource(recovered.meta?.slug ?? recovered.meta?.title ?? "migrated") || "migrated";
    const milestoneRef = number;
    const title = String(recovered.meta?.title ?? slug).trim() || slug;
    const milestoneDir = path.join(workDir, `${number}_milestone_${slug}`);

    // Map the recovered substructure into stories. An aof-structured source with its
    // own stories scaffolds one `stories/<SS>_story_<slug>/` per recovered unit; an
    // arbitrary source with no distinct units scaffolds the milestone alone (an
    // empty `## Stories` is valid). recovery.mjs does not surface the substructure
    // (its frozen shape is intent/decisions/outcomes/meta), so migrate reads the
    // source's own `stories/` tree READ-ONLY here.
    const units = await recoverSourceStories(sourceDir);
    const stories = units.map((unit, idx) => ({
      number: String(idx).padStart(2, "0"),
      slug: slugifySource(unit.slug ?? unit.title ?? `unit-${idx}`) || `unit-${idx}`,
      title: String(unit.title ?? unit.slug ?? `Unit ${idx}`).trim(),
      tasks: Array.isArray(unit.tasks) ? unit.tasks : [],
    }));
    const taskCount = stories.reduce((sum, story) => sum + story.tasks.length, 0);

    // STATUS (honest; NEVER `done`): delivered work present → in-progress (with gaps)
    // or in-review (clean); no delivered work → not-started. A source-asserted "done"
    // is clamped to at most in-review (file 02 — done is earned only via aof:verify).
    const deliveredWork = outcomes.length > 0 || statusIndicatesProgress(recovered.meta?.status);
    const gaps = detectGaps({ hasIntent, decisions, outcomes, deliveredWork, taskCount });
    const status = resolveStatus({ deliveredWork, gaps });

    // FINDINGS: developer-actionable items, each NAMING what to act on, derived
    // mechanically from the recovery-signal gaps. No delivered work → no findings
    // (absence is information — file 02 "no spurious findings"). The architect's
    // deeper review is the @manual lane, NOT faked here.
    const findings = deliveredWork ? gaps : [];

    const result = {
      migrated: !dryRun,
      milestoneRef,
      dir: milestoneDir, // RAW absolute; cli.json relativises
      status,
      storyCount: stories.length,
      taskCount,
      findingCount: findings.length,
      findings,
      dryRun,
    };

    // --dry-run PREVIEWS (the ref + dir + counts it WOULD scaffold) and writes /
    // indexes NOTHING (import's preview discipline) — return before any write.
    if (dryRun) return result;

    // SCAFFOLD the managed milestone under work.dir (the architect's
    // scaffold-not-relocate call — the source is left read-only and untouched).
    // CLEAN-WRITE DISCIPLINE (mirrors materialize.mjs): the scaffold lands in the
    // MANAGED namespace under work.dir, so a mid-write throw would leave a
    // half-milestone that the next `work validate`/`nextFreeSlot` trips on (unlike
    // import's git-ignored, rm-first store). The whole scaffold (the milestone mkdir
    // + every write) runs under one try: any failure removes the FRESHLY-CREATED
    // milestone dir and rethrows — so a failed migrate leaves NO partial milestone in
    // the stream (all-or-nothing). `createdFresh` guards the rollback so it removes
    // ONLY a dir migrate itself created (it never deletes a pre-existing path it did
    // not own — `nextFreeSlot` already keeps the destination dir-name free).
    // `mkdir(recursive)` returns the first-created path (or undefined when the dir
    // already existed), so it doubles as the "did we create it" signal — no extra stat.
    let createdFresh = false;
    try {
      createdFresh = (await mkdir(milestoneDir, { recursive: true })) !== undefined;
      await writeFile(
        path.join(milestoneDir, "SPEC.md"),
        renderSpec({ number, slug, title, status, migratedAt, recovered, stories }),
        "utf8"
      );
      await writeFile(
        path.join(milestoneDir, "STATE.md"),
        renderState({ number, slug, title, status, migratedAt, stories, outcomes, findings }),
        "utf8"
      );
      // Recovered decisions → ARCHITECTURE.md `## ADR-NNN` blocks (only when present;
      // absence is information — no ADR doc is fabricated).
      if (decisions.length > 0) {
        await writeFile(
          path.join(milestoneDir, "ARCHITECTURE.md"),
          renderArchitecture({ number, title, decisions }),
          "utf8"
        );
      }
      // Scaffold each recovered unit as a managed story (STORY.md + an empty tasks/
      // dir; recovered tasks are listed as task .feature files when present).
      for (const story of stories) {
        const storyDir = path.join(milestoneDir, "stories", `${story.number}_story_${story.slug}`);
        const tasksDir = path.join(storyDir, "tasks");
        await mkdir(tasksDir, { recursive: true });
        await writeFile(
          path.join(storyDir, "STORY.md"),
          renderStory({ story, parent: number, migratedAt }),
          "utf8"
        );
        for (const task of story.tasks) {
          const taskSlug = slugifySource(task.slug ?? task.title ?? "task") || "task";
          await writeFile(
            path.join(tasksDir, `${String(task.number ?? "00").padStart(2, "0")}_${taskSlug}.feature`),
            renderTaskFeature({ task, taskSlug }),
            "utf8"
          );
        }
      }
    } catch (err) {
      // ROLLBACK: remove the half-scaffolded milestone so the managed namespace is
      // left exactly as it was before the failed migrate (no partial milestone for
      // the next validate/nextFreeSlot to trip on), then surface the failure. Only
      // when migrate created the dir this run — never delete a pre-existing path.
      if (createdFresh) await rm(milestoneDir, { recursive: true, force: true });
      throw err;
    }

    return result;
  },

  cli: {
    // `aof migrate <folder> [--dry-run] [--json]`.
    argv: (positionals, options = {}) => {
      const input = { folder: positionals[0] };
      if (options.dryRun) input.dryRun = true;
      return input;
    },

    // Human render: a one-line summary of the managed item created (or that would be).
    render(result) {
      const verb = result.dryRun ? "Would migrate" : "Migrated";
      const where = path.relative(process.cwd(), result.dir);
      const head = `${verb} folder into managed milestone ${result.milestoneRef} (${result.status}) — ${where}`;
      const body =
        `  ${result.dryRun ? "would scaffold" : "scaffolded"}: ${result.storyCount} story(s), ` +
        `${result.taskCount} task feature(s), ${result.findingCount} finding(s)`;
      return `${head}\n${body}`;
    },

    // --json face: relativise the raw absolute dir to cwd (import's relativisePaths
    // discipline) and project the structured result. The internal `findings` array
    // is dropped from the JSON face — findingCount is the observable an automated
    // caller reads; the findings text lives in the produced STATE.md `## Findings`.
    json: (result) => {
      const { findings, ...rest } = result;
      return { ...rest, dir: path.relative(process.cwd(), result.dir) };
    },
  },
};

// The next free top-level slot under work.dir: max existing `NN_` index + 1,
// zero-padded to 2. An empty stream starts at "00". Reads the work-item folders
// only (ITEM_RE), so a stray non-item dir never shifts the numbering.
async function nextFreeSlot(workDir) {
  let max = -1;
  let entries;
  try {
    entries = await readdir(workDir, { withFileTypes: true });
  } catch {
    entries = [];
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(ITEM_RE);
    if (!match) continue;
    const n = Number.parseInt(match[1], 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return String(max + 1).padStart(2, "0");
}

// Does a source-asserted status indicate delivered progress? (anything past
// not-started — in-progress/in-review/blocked/done). "Delivered work present" is
// `outcomes.length > 0 OR this` (A4).
function statusIndicatesProgress(raw) {
  const s = String(raw ?? "").trim().toLowerCase();
  return s.length > 0 && s !== "not-started";
}

// Resolve the produced status (A4). No delivered work → not-started. Delivered with
// gaps → in-progress. Delivered, clean → in-review — the honest ceiling. migrate
// NEVER emits "done" (earned only via aof:verify): a source's self-asserted "done"
// is clamped here, the same clean-delivery ceiling as any other source status.
function resolveStatus({ deliveredWork, gaps }) {
  if (!deliveredWork) return "not-started";
  if (gaps.length > 0) return "in-progress";
  // Fully + cleanly delivered: the verify-ready ceiling is in-review. A source-
  // asserted "done"/"in-review" is clamped to in-review (never stamped "done").
  return "in-review";
}

// Detect developer-actionable gaps in the delivered work, derived MECHANICALLY from
// the recovery signal (recovery has no notion of "gaps" — this is migrate-NEW code).
// Each finding NAMES what to act on, not just that something is wrong. Returns [].
function detectGaps({ hasIntent, decisions, outcomes, deliveredWork, taskCount }) {
  const findings = [];
  if (!deliveredWork) return findings;
  // Delivered outcomes but no decisions/ADRs captured — the architecture is unrecorded.
  if (outcomes.length > 0 && decisions.length === 0) {
    findings.push(
      "Delivered outcomes were recovered but no decisions/ADRs were captured — record the architecture that produced them (author ARCHITECTURE.md ADRs)."
    );
  }
  // Code/outcomes present but no aof tasks/contract — the work is unverified.
  if (taskCount === 0) {
    findings.push(
      "Delivered work is present but no aof tasks/feature scenarios exist — author the contract and verify it (aof:refine, then aof:verify)."
    );
  }
  // Delivered work but no recovered intent — the objective is unstated.
  if (!hasIntent) {
    findings.push(
      "Delivered work is present but the source states no intent — write the objective/scope this work was meant to satisfy."
    );
  }
  return findings;
}

// Read the source's OWN story substructure READ-ONLY (migrate-NEW over recovery,
// which surfaces only intent/decisions/outcomes/meta). Resolves the SAME picked
// source milestone dir recovery picks (listRecoverableMilestones), then enumerates
// its `stories/` tree — the aof `SS_story_slug` form OR a loose numbered form (never
// demanding aof's exact naming). Each unit recovers { number, slug, title, tasks }.
// An arbitrary source (no aof milestone dir) or a milestone with no stories/ yields
// [] — the milestone scaffolds alone (an empty `## Stories` is valid). Reads only.
async function recoverSourceStories(sourceDir) {
  let picked;
  try {
    const candidates = await listRecoverableMilestones(sourceDir);
    picked = candidates.find((c) => !c.arbitrary) ?? null;
  } catch {
    picked = null;
  }
  if (!picked || picked.arbitrary) return [];
  const storiesDir = path.join(picked.dir, "stories");
  let entries;
  try {
    entries = await readdir(storiesDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const units = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const match = entry.name.match(STORY_FOLDER_RE);
    if (!match) continue;
    const storyDir = path.join(storiesDir, entry.name);
    const slug = slugifySource(match[2]);
    units.push({
      number: match[1],
      slug,
      title: await storyTitle(storyDir, slug),
      tasks: await recoverSourceTasks(storyDir),
    });
  }
  // Sort by the source story number for a stable, source-faithful scaffold order.
  units.sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));
  return units;
}

// A source story's title: its STORY.md frontmatter `title:` or `# ` heading, else
// the slug humanised. Read-only; "" never propagates (the slug is the fallback).
async function storyTitle(storyDir, slug) {
  let text = "";
  try {
    text = await readFile(path.join(storyDir, "STORY.md"), "utf8");
  } catch {
    text = "";
  }
  // NOTE: keep in sync with recovery.mjs recoverAofMeta's heading parse (the same
  // `title:` frontmatter + `# ` heading recovery, with a leading `NN ·`/`NN •` strip).
  const fmTitle = (text.match(/^title:\s*["']?(.+?)["']?\s*$/m) ?? [])[1];
  const h1 = (text.split(/\r?\n/).find((line) => /^#\s+/.test(line)) ?? "")
    .replace(/^#\s+/, "")
    .replace(/^\d+\s*[·•]\s*/, "")
    .trim();
  return (fmTitle ?? h1 ?? "").trim() || slug.replace(/-+/g, " ");
}

// A source story's recovered tasks: its `tasks/*.feature` files. Each yields a
// { number, slug, title } so migrate scaffolds one task .feature per recovered task.
// Returns [] when the story has no tasks/ dir or no .feature files (no fabrication).
async function recoverSourceTasks(storyDir) {
  let entries;
  try {
    entries = await readdir(path.join(storyDir, "tasks"), { withFileTypes: true });
  } catch {
    return [];
  }
  const tasks = [];
  for (const entry of entries) {
    if (!entry.isFile() || !/\.feature$/i.test(entry.name)) continue;
    const base = entry.name.replace(/\.feature$/i, "");
    const m = base.match(/^(\d+)[-_]+(.+)$/);
    const number = m ? m[1] : "00";
    const slug = slugifySource(m ? m[2] : base);
    tasks.push({ number, slug, title: slug.replace(/-+/g, " ") });
  }
  tasks.sort((a, b) => Number.parseInt(a.number, 10) - Number.parseInt(b.number, 10));
  return tasks;
}

// ─────────────────────────────────────────────────────────── renderers ──

// Collapse a recovered title to a SINGLE line for a body heading: any newline (or
// run of whitespace) becomes one space, trimmed. A heading line MUST NOT span the
// `---`/section boundary — a multi-line `# N · <title>` would inject stray lines
// into the rendered doc (the frontmatter `title:` is separately JSON-escaped).
function headingLine(title) {
  return String(title).replace(/\s+/g, " ").trim();
}

function frontmatter(fields) {
  const lines = Object.entries(fields)
    .filter(([, value]) => value != null)
    .map(([key, value]) => `${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n`;
}

// The produced milestone SPEC.md — the native managed record doc (A3). Frontmatter
// matches the bundle milestone template (type/number/slug/title/status/owner/
// created/updated); the recovered intent.objective/scope populate the body. Absence
// is information: a missing objective/scope records the not-recoverable marker.
function renderSpec({ number, slug, title, status, migratedAt, recovered, stories }) {
  const objective = recovered.intent?.objective?.trim();
  const scope = recovered.intent?.scope?.trim();
  const fm = frontmatter({
    type: "milestone",
    number,
    slug,
    // JSON.stringify produces a valid, fully-escaped double-quoted YAML scalar
    // (mirrors materialize.mjs) — a recovered title is unbounded user content (a
    // README heading / source `# `), so a raw newline, backslash, quote, or
    // leading-`status:`-like text MUST NOT break the `---` block or inject a line.
    title: JSON.stringify(title),
    status,
    owner: "product-owner",
    created: migratedAt,
    updated: migratedAt,
  });
  const objectiveBlock = objective
    ? objective
    : "_Not recoverable from the source — state the objective this work set out to satisfy._";
  const scopeBlock = scope
    ? `In scope:\n- ${scope}`
    : "_Not recoverable from the source — state what is in and out of scope._";
  const storyLines =
    stories.length > 0
      ? stories.map((s) => `- [ ] \`${s.number}_story_${s.slug}\` — ${s.title}`).join("\n")
      : "_No distinct stories recovered from the source._";
  return (
    `${fm}` +
    `# ${number} · ${headingLine(title)}\n\n` +
    `## Objective\n\n${objectiveBlock}\n\n` +
    `## Scope\n\n${scopeBlock}\n\n` +
    `## Stories\n\n${storyLines}\n`
  );
}

// The produced milestone STATE.md (A3/A5). Carries the recovered outcomes as the
// delivered-work narrative, and — when delivered work has gaps — a `## Findings`
// section a developer picks up at aof:continue. No delivered work → no `## Findings`
// section (no spurious findings).
function renderState({ number, slug, title, status, migratedAt, stories, outcomes, findings }) {
  const fm = frontmatter({ doc: "state" });
  const progress =
    stories.length > 0
      ? stories.map((s) => `- [ ] \`${s.number}_story_${s.slug}\` — ${s.title}`).join("\n")
      : "- _No distinct stories recovered._";
  const delivered =
    outcomes.length > 0
      ? outcomes.map((o) => `- ${o.title}`).join("\n")
      : "- _No delivered outcomes recovered from the source._";
  let body =
    `${fm}` +
    `# ${number} · ${headingLine(title)} — State\n\n` +
    `Migrated from a source folder on ${migratedAt} (status: ${status}).\n\n` +
    `## Progress\n\n${progress}\n\n` +
    `## Delivered (recovered from source)\n\n${delivered}\n`;
  // FINDINGS (A5): only when delivered work with gaps is detected.
  if (findings.length > 0) {
    const findingLines = findings.map((f) => `- [ ] ${f}`).join("\n");
    body +=
      `\n## Findings\n\n` +
      `Developer-actionable items from reconciling the delivered work (pick up at \`aof:continue ${number}\`):\n\n` +
      `${findingLines}\n`;
  }
  return body;
}

// The produced ARCHITECTURE.md — recovered decisions as `## ADR-NNN` blocks (A3),
// the SAME heading convention the existing parsers read (no new parser).
function renderArchitecture({ number, title, decisions }) {
  const blocks = decisions
    .map((d) => {
      const head = `## ${d.id}${d.title ? ` — ${d.title}` : ""}`;
      const statusLine = `**Status:** ${d.status ?? "Accepted"}`;
      const body = (d.body ?? "").trim();
      return `${head}\n\n${statusLine}\n\n${body}\n`;
    })
    .join("\n");
  return `# ${number} · ${headingLine(title)} — Architecture\n\nRecovered decisions, migrated from the source folder.\n\n${blocks}`;
}

// A scaffolded story's STORY.md — native managed-story frontmatter (parent resolves
// to the produced milestone number, so `work validate` passes).
function renderStory({ story, parent, migratedAt }) {
  const fm = frontmatter({
    type: "story",
    number: story.number,
    slug: story.slug,
    // JSON.stringify: a recovered story title is unbounded user content too (a source
    // STORY.md `# ` heading) — the same YAML-safety as the milestone SPEC frontmatter.
    title: JSON.stringify(story.title),
    status: "not-started",
    owner: "product-owner",
    parent,
    created: migratedAt,
    updated: migratedAt,
  });
  return `${fm}# ${story.number} · ${headingLine(story.title)}\n\n## User story\n\nMigrated from a source folder — refine before continuing.\n`;
}

// A scaffolded task .feature — carries a FEATURE-level `@manual` verification tag so
// every scenario inherits exactly one verification tag (the work validate contract:
// a scenario needs exactly one @executable/@manual/@uat). `@manual` is the honest
// lane: a migrated stub's behaviour is NOT yet proven by an executable test — the
// Three Amigos re-author the real scenarios + lane at aof:refine. No domain/layer
// tags, so it is not held to the project tag vocabulary.
function renderTaskFeature({ task }) {
  const title = String(task.title ?? task.slug ?? "task").trim();
  return (
    `@manual\n` +
    `Feature: ${title}\n` +
    `  # Migrated from a source folder — author the acceptance scenarios + lane at aof:refine.\n\n` +
    `  Scenario: ${title}\n` +
    `    Given the migrated work\n`
  );
}
