// work:promote-gap — milestone 39 / story 03 (gap-to-chore, SPEC "a gap is a
// debt, not a note"; ARCHITECTURE ADR-001). Promotes a declared OPEN gap
// (title + discharge condition) into a top-level `chore` (milestone 37) whose
// `## Definition of Done` is seeded from the gap's OWN discharge condition (its
// close criterion) and which records a back-reference to the originating gap —
// so a declared debt becomes SCHEDULABLE work, visible where work is chosen.
//
// REUSES the existing chore insert seam — `runInsertTopLevel({ type: "chore" })`
// from insert-shared.mjs, the SAME engine `work:insert-chore` calls — never a
// bespoke writer (feasibility flag 4). After the generic scaffold lands, this
// module does the ONE thing the generic scaffold cannot know: it seeds the
// freshly-written CHORE.md's `## Definition of Done` with the gap's discharge
// condition and appends a `## Notes` back-reference bullet naming the gap. The
// chore is born `not-started` with NO ticked box (the template's checkboxes are
// already unticked; this only replaces placeholder TEXT, never a `- [x]`) —
// closed later by `aof:verify`, never asserted at creation.
//
// Boundary (QA-added, STORY "Notes"): an already-`discharged` gap has no debt
// left to schedule — the promotion is REFUSED (no chore created), not silently
// scheduled as closed work.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { INSERT_FLAGS, runInsertTopLevel } from "./insert-shared.mjs";
import { listItems } from "../work.mjs";
import { writeText } from "../fs.mjs";
import { commandError } from "./errors.mjs";

const DOD_HEADING_RE = /^##\s+Definition of Done\s*$/;
const NOTES_HEADING_RE = /^##\s+Notes\s*$/;

// Locate a `## <heading>` section's line range: `[headingIdx+1, end)` is the
// section BODY, `end` the index of the next heading (or EOF). A LOCAL copy of
// insert-shared.mjs's own idiom — deliberately not imported, so this module
// never reaches into that file's Tier-2 checklist internals (ownership: this
// module owns ONLY the promotion-specific content seed).
function findSection(lines, headingRe) {
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

// Seed the freshly-scaffolded chore's content with the two promotion-specific
// facts the generic template placeholder-fill (renderTemplate) cannot know:
//   1. the gap's OWN discharge condition, replacing the DoD's generic
//      placeholder checklist (still unticked — "born not-started, never
//      hand-ticked");
//   2. a back-reference bullet under `## Notes` naming the originating gap's
//      title, so the debt and its scheduled discharge stay linked.
function seedChoreContent(text, { gapTitle, dischargeCondition }) {
  const newline = text.includes("\r\n") ? "\r\n" : "\n";
  let lines = text.split(/\r?\n/);

  const dod = findSection(lines, DOD_HEADING_RE);
  if (dod) {
    const before = lines.slice(0, dod.headingIdx + 1);
    const after = lines.slice(dod.end);
    const body = ["", `- [ ] ${dischargeCondition}`, "- [ ] `aof work validate` is green (no regression)", ""];
    lines = [...before, ...body, ...after];
  }

  const backref = `- **Promoted from gap:** "${gapTitle}"`;
  const notes = findSection(lines, NOTES_HEADING_RE);
  if (notes) {
    lines = [...lines.slice(0, notes.headingIdx + 1), "", backref, ...lines.slice(notes.headingIdx + 1)];
  } else {
    lines = [...lines, "", "## Notes", "", backref, ""];
  }

  return lines.join(newline);
}

// "warnings_delivered field" -> "warnings-delivered-field" — the SAME
// kebab-case a slug must satisfy (insert-shared.mjs's normalizeSlug), derived
// from the gap's OWN title so this works for ANY gap, not a hardcoded one.
function slugifyGapTitle(title) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// The default target position when the caller names none: append after every
// existing top-level item (shifts zero items). A promote caller is scheduling
// debt, not choosing a shelf position — appending is the least-surprising
// default (mirrors insert's own "no --yes needed" zero-shift path).
async function defaultAt(workDir) {
  const items = await listItems(workDir);
  return items.filter((item) => item.parent == null).length;
}

// The promotion engine. `gap` is { title, status, dischargeCondition } — the
// minimal shape a declared `## Gaps` record (story 01/02's ADR-001 `gap`
// MemoryRecord) already carries; this module reads it as plain data, coupling
// to no parser. Returns:
//   promoted:false -> { promoted:false, reason, gap }               (refused)
//   promoted:true  -> { promoted:true, gap, chore:{ref,slug,dir}, shifted }
export async function runPromoteGapToChore(ctx, { gap, at: rawAt, yes, today } = {}) {
  const title = gap?.title;
  const status = gap?.status ?? "open";
  const dischargeCondition = gap?.dischargeCondition ?? "";

  if (!title) throw commandError("A gap title is required to promote.", "promote-gap-invalid-title", 400);
  // `invoke` does NOT enforce the input schema's `required` (schema is advisory,
  // not enforced) — a missing/blank --discharge must be refused HERE, mirroring
  // the title guard above, or a chore is born with an empty `- [ ] ` DoD (a debt
  // scheduled with no close criterion — the discharge condition IS the DoD).
  if (!dischargeCondition.trim()) {
    throw commandError("A discharge condition (--discharge) is required to promote a gap.", "promote-gap-invalid-discharge", 400);
  }

  // Boundary: an already-discharged gap has no debt to schedule — refused, not
  // silently scheduled as closed work.
  if (status === "discharged") {
    return { promoted: false, reason: "gap is already discharged", gap: { title, status } };
  }

  const workDir = ctx.workspace.workDir;
  const slug = slugifyGapTitle(title);
  if (!slug) throw commandError(`gap title "${title}" does not yield a valid slug.`, "promote-gap-invalid-title", 400);

  const at = rawAt != null && rawAt !== "" ? rawAt : await defaultAt(workDir);

  // Reuse the SAME chore insert engine `work:insert-chore` calls — never a
  // bespoke writer (feasibility flag 4).
  const insertResult = await runInsertTopLevel(ctx, { type: "chore", slug, at, yes: Boolean(yes), today });

  // Consume the insert engine's OWN scaffold dir (review fix) rather than
  // re-deriving `${ref}_chore_${slug}` by hand here — that duplicated the
  // naming convention and risked an ENOENT crash after the stream had already
  // been reindex-shifted.
  const dir = insertResult.created.dir;
  const chorePath = path.join(dir, "CHORE.md");
  const raw = await readFile(chorePath, "utf8");
  const seeded = seedChoreContent(raw, { gapTitle: title, dischargeCondition });
  await writeText(chorePath, seeded);

  return {
    promoted: true,
    gap: { title, status },
    chore: { ref: insertResult.created.ref, slug, dir },
    shifted: insertResult.shifted,
  };
}

export const promoteGapToChoreCommand = {
  id: "work:promote-gap",
  input: {
    type: "object",
    properties: {
      title: { type: "string" },
      discharge: { type: "string" },
      status: { type: "string" },
      at: { type: ["number", "string"] },
      yes: { type: "boolean" },
      today: { type: "string" },
    },
    required: ["title", "discharge"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    return await runPromoteGapToChore(ctx, {
      gap: { title: input.title, status: input.status || "open", dischargeCondition: input.discharge },
      at: input.at,
      yes: Boolean(input.yes),
      today: input.today,
    });
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs workInsertCli branch is deleted.
    route: ["work", "promote-gap"],
    spec: {
      usage: 'aof work promote-gap "<title>" --discharge "…" [--status open] [--at <P>] [--yes] [--json]',
      flags: {
        ...INSERT_FLAGS,
        discharge: { type: "string", description: "the discharge condition the chore must satisfy" },
        status: { type: "string", description: "the gap's recorded status (default open)" },
      },
    },
    // `aof work promote-gap "<gap title>" --discharge "<condition>" [--status open|discharged] [--at P] [--yes] [--json]`.
    argv: (positionals, options) => ({
      title: positionals[0],
      discharge: options.discharge,
      status: options.status,
      at: options.at,
      yes: Boolean(options.yes || options.force),
    }),

    render(result) {
      if (!result.promoted) {
        return `Gap "${result.gap.title}" is already discharged — nothing to promote.`;
      }
      return `Promoted gap "${result.gap.title}" to chore "${result.chore.slug}" at ${result.chore.ref} (shifted ${result.shifted} item(s)).`;
    },

    json: (result) => result,
  },
};
