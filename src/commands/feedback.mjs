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
//
// m42 wave (d) leg d4, port 1 — the WRITE ITSELF now lives in the record-doc
// transition seam (effects/doc-transitions.mjs), which appends the bullet AND
// raises `feedback.recorded`. This command composes the canonical bullet and
// guards the input; it no longer decides whether the workspace propagates
// afterwards (the retired `withGlobalWorkPropagation` import) — the ledger does.
import { resolveItemExact, requireLocalCheckout } from "./resolve.mjs";
import { commandError } from "../command-error.mjs";
import { transitionFeedbackAppended } from "../effects/doc-transitions.mjs";
import { renderWithPropagationWarnings, threadPropagationWarnings } from "../global-work-publisher.mjs";

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
    const item = await resolveItemExact(ctx, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    if (item.type !== "milestone" && item.type !== "story") {
      throw commandError("Feedback targets a milestone or story item.", "unsupported-target", 400);
    }
    // m43 / story 06 (ADR-010/R6.4) — one of the two doors that WRITES through `item.dir`.
    // The resolver is cache-first now, so a ref another node owns resolves here; appending a
    // bullet to it would mean scaffolding a record doc for content this node does not own.
    // Refuse coded, before any write. The gate ordering matters: `unsupported-target` above
    // is a property of the REF and is answerable from the cache, so it still fires first.
    requireLocalCheckout(item, ref);

    // The canonical bullet form (templates/uat/STATE.md): em-dash before
    // "Raised by:", and exactly three spaces before an optional "Refs:".
    const bullet = refs
      ? `- ${note} — Raised by: ${actor}   Refs: ${refs}`
      : `- ${note} — Raised by: ${actor}`;

    const { effects } = await transitionFeedbackAppended(item, { bullet }, {
      workspace: ctx.workspace,
      publisherOptions: ctx,
      journalOptions: ctx.effectsJournalOptions ?? {},
    });
    return threadPropagationWarnings({ ok: true, bullet }, effects);
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
