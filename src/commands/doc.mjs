// work:doc — read an item's record doc (was board-ui.mjs handleDoc; ADR-002/003).
//
// A READ command: resolves the ref with `resolveItem` (exact-preferred, free-text
// slug fallback tolerated). An unknown doc NAME is an input-contract failure
// (invalid-doc → 400). An unresolved ref is ref-not-found → 404. A doc that
// exists is returned with `present:true` and its verbatim body; a missing file is
// absent-NOT-error — `{ present:false, body:"" }` (today's ENOENT path), not a
// thrown error. The echoed `doc` is the UPPERCASE doc name.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { resolveItem } from "./resolve.mjs";
import { commandError } from "./errors.mjs";

// The docs the detail panel may request, mapped to their on-disk filename.
const DOC_FILES = {
  SPEC: "SPEC.md",
  STORY: "STORY.md",
  VERIFICATION: "VERIFICATION.md",
  RETROSPECTIVE: "RETROSPECTIVE.md",
};

export const docCommand = {
  id: "work:doc",
  input: {
    type: "object",
    properties: { ref: { type: "string" }, doc: { type: "string" } },
    required: ["ref", "doc"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const docName = (typeof input.doc === "string" ? input.doc : "").trim().toUpperCase();
    const fileName = DOC_FILES[docName];
    if (!fileName) {
      throw commandError(`Unknown document "${input.doc ?? ""}".`, "invalid-doc", 400);
    }

    const item = await resolveItem(ctx.workspace.workDir, ref);
    if (!item) {
      throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    }

    // path.join on the native dir (findWork returns the OS-native path). A missing
    // file is NOT an error — ENOENT → { present:false, body:"" } (ADR-003).
    try {
      const body = await readFile(path.join(item.dir, fileName), "utf8");
      return { ref: item.ref, doc: docName, present: true, body };
    } catch (error) {
      if (error.code === "ENOENT") {
        return { ref: item.ref, doc: docName, present: false, body: "" };
      }
      throw error;
    }
  },

  cli: {
    // `aof work doc <ref> <DOC>` — two positionals map onto the input.
    argv: (positionals) => ({ ref: positionals[0], doc: positionals[1] }),

    // No historical human form; render a one-line presence summary (the body
    // itself prints in --json mode, which is the contract surface here).
    render(result) {
      if (!result.present) return `${result.ref} ${result.doc} — absent`;
      return result.body;
    },

    // No path in the result — passes through to --json unchanged.
    json: (result) => result,
  },
};
