// work:feedback — the command core's SOLE filesystem write (was board-ui.mjs
// handleFeedback + appendFeedbackBullet; ADR-002/003).
//
// The load-bearing distinction lives here so BOTH faces inherit it and neither
// can weaken it: this WRITE resolves with `resolveItemExact` — NO slug fallback,
// so a typo'd/partial ref returns null (→ ref-not-found) rather than appending
// the bullet to the wrong (first slug-matched) item. The input contract is
// guarded BEFORE any write (missing-ref / missing-note → 400). Feedback targets a
// milestone or story only (other kinds → unsupported-target, before any write).
// Exactly one canonical bullet is appended under the verbatim
// `## Feedback (for retro)` heading (created verbatim if absent; prior bullets
// never disturbed). The result is { ok:true, bullet }.
import path from "node:path";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { resolveItemExact } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { renderWithPropagationWarnings, withGlobalWorkPropagation } from "../global-work-publisher.mjs";

// The verbatim feedback heading — must match templates/uat/STATE.md and
// src/bundle/commands/feedback.md byte-for-byte (ADR-003 / 02_add-feedback.feature).
const FEEDBACK_HEADING = "## Feedback (for retro)";

export const feedbackCommand = {
  id: "work:feedback",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      note: { type: "string" },
      actor: { type: "string" },
      refs: { type: "string" },
    },
    required: ["ref", "note"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const note = typeof input.note === "string" ? input.note.trim() : "";
    const actor = typeof input.actor === "string" && input.actor.trim() ? input.actor.trim() : "you";
    const refs = typeof input.refs === "string" ? input.refs.trim() : "";

    // Guard the input contract BEFORE any write.
    if (!ref) throw commandError("A target ref is required.", "missing-ref", 400);
    if (!note) throw commandError("Feedback note is required.", "missing-note", 400);

    // The WRITE resolves by EXACT ref — never the free-text slug fallback the read
    // commands tolerate. A typo'd/partial ref → ref-not-found, never the wrong item.
    const item = await resolveItemExact(ctx.workspace.workDir, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    if (item.type !== "milestone" && item.type !== "story") {
      throw commandError("Feedback targets a milestone or story item.", "unsupported-target", 400);
    }

    // The canonical bullet form (templates/uat/STATE.md): em-dash before
    // "Raised by:", and exactly three spaces before an optional "Refs:".
    const bullet = refs
      ? `- ${note} — Raised by: ${actor}   Refs: ${refs}`
      : `- ${note} — Raised by: ${actor}`;

    await appendFeedbackBullet(path.join(item.dir, "STATE.md"), bullet);
    return await withGlobalWorkPropagation({ ok: true, bullet }, ctx.workspace, ctx);
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs face copy is deleted.
    route: ["work", "feedback"],
    spec: {
      usage: 'aof work feedback <ref> --note "…" [--actor …] [--refs …] [--json]',
      flags: {
        note: { type: "string", description: "the feedback note (required)" },
        actor: { type: "string", description: "who raised it (defaults to \"you\")" },
        refs: { type: "string", description: "verbatim refs recorded on the bullet" },
      },
    },

    // `aof work feedback <ref> --note "…" [--actor …] [--refs …]`.
    argv: (positionals, options) => ({
      ref: positionals[0],
      note: options.note,
      actor: options.actor,
      refs: options.refs,
    }),

    // No historical human form; confirm the appended bullet.
    render: (result) => renderWithPropagationWarnings(`Appended: ${result.bullet}`, result),

    // No path in the result — passes through to --json unchanged.
    json: (result) => result,
  },
};

// The command core's ONLY filesystem write: ensure the verbatim heading exists
// (creating it if absent), then append exactly one bullet beneath the existing
// entries — never disturbing prior content (ADR-003).
async function appendFeedbackBullet(statePath, bullet) {
  let original;
  try {
    original = await readFile(statePath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    original = null;
  }

  if (original === null) {
    // No STATE.md at all: create it with the heading and the one bullet.
    await writeFile(statePath, `${FEEDBACK_HEADING}\n\n${bullet}\n`, "utf8");
    return;
  }

  if (!original.includes(FEEDBACK_HEADING)) {
    // Heading absent: append it verbatim, then the bullet, beneath existing body.
    const prefix = original.length === 0 || original.endsWith("\n") ? "" : "\n";
    const gap = original.length === 0 ? "" : "\n";
    await appendFile(statePath, `${prefix}${gap}${FEEDBACK_HEADING}\n\n${bullet}\n`, "utf8");
    return;
  }

  // Heading present: insert the bullet at the end of the heading's section,
  // beneath any existing bullets, without rewriting them.
  const lines = original.split(/\r?\n/);
  const headingIndex = lines.findIndex((line) => line.trim() === FEEDBACK_HEADING);
  // Find where this section ends (the next heading, or end of file).
  let sectionEnd = lines.length;
  for (let i = headingIndex + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i])) {
      sectionEnd = i;
      break;
    }
  }
  // Walk back over trailing blank lines so the new bullet sits with the others.
  let insertAt = sectionEnd;
  while (insertAt > headingIndex + 1 && lines[insertAt - 1].trim() === "") {
    insertAt -= 1;
  }
  // If the section has no bullet yet, leave a blank line after the heading.
  if (insertAt === headingIndex + 1) {
    lines.splice(insertAt, 0, "", bullet);
  } else {
    lines.splice(insertAt, 0, bullet);
  }
  const newline = original.includes("\r\n") ? "\r\n" : "\n";
  await writeFile(statePath, lines.join(newline), "utf8");
}
