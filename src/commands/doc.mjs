// work:doc — read an item's record doc (was board-ui.mjs handleDoc; ADR-002/003).
//
// A READ command: resolves the ref with `resolveItem` (exact-preferred, free-text
// slug fallback tolerated). An unknown doc NAME is an input-contract failure
// (invalid-doc → 400). An unresolved ref is ref-not-found → 404. A doc that
// exists is returned with `present:true` and its verbatim body; a missing file is
// absent-NOT-error — `{ present:false, body:"" }` (today's ENOENT path), not a
// thrown error. The echoed `doc` is the UPPERCASE doc name.
//
// schema v5 (TECH_DEBT item 6 — finish the board bridge): a ref/doc the LOCAL
// checkout cannot answer falls back to the worker-streamed projection (the SAME
// path the item rows already ride — board-worker-stream.mjs) before 404/absent. A
// mesh item's streamed story used to dead-end here ("No item resolves to ref
// \"18/03\"") even while the board was listing it; the fallback answers with the
// worker's own body, marked `fromWorker` + `reportedBy` so the surface can say
// whose view it is. Local disk still wins whenever it can answer.
import path from "node:path";
import { readFile } from "node:fs/promises";
import { resolveItem } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { WORK_ITEM_DOC_FILES } from "../global-work-store.mjs";
import { readWorkerDoc } from "../board-worker-stream.mjs";

// The docs the detail panel may request, mapped to their on-disk filename — the ONE
// home shared with the worker's content stream (global-work-store.mjs), so the
// requestable set and the streamed set can never drift.
const DOC_FILES = WORK_ITEM_DOC_FILES;

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

    const streamedDoc = (lookupRef) => readWorkerDoc(ctx.workspace, lookupRef, docName, {
      globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
    });

    const item = await resolveItem(ctx.workspace.workDir, ref);
    if (!item) {
      // The local checkout has never seen this ref (a worker-streamed story) — the
      // projection is the only place its docs exist on this machine.
      const streamed = await streamedDoc(ref);
      if (streamed != null) {
        return { ref, doc: docName, present: true, body: streamed.body, fromWorker: true, reportedBy: streamed.reportedBy };
      }
      throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    }

    // path.join on the native dir (findWork returns the OS-native path). A missing
    // file is NOT an error — ENOENT → { present:false, body:"" } (ADR-003), after
    // the projection has had its chance to answer (the item may resolve locally as
    // a pre-run scaffold while the worker holds the real doc).
    try {
      const body = await readFile(path.join(item.dir, fileName), "utf8");
      return { ref: item.ref, doc: docName, present: true, body };
    } catch (error) {
      if (error.code === "ENOENT") {
        const streamed = await streamedDoc(item.ref);
        if (streamed != null) {
          return { ref: item.ref, doc: docName, present: true, body: streamed.body, fromWorker: true, reportedBy: streamed.reportedBy };
        }
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
