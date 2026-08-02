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
import { commandError } from "../command-error.mjs";
// m43 / ADR-007 + ADR-010/R3.D — the requestable set is the MANIFEST, read from its
// one home. A `file` entry is requested by NAME; a `dir` entry (`TASKS`) by NAME plus
// an ADDITIVE optional MEMBER. There is deliberately no pattern language: `work:doc`'s
// input contract is a name, so "what can I ask for" stays answerable, and an
// out-of-contract member is a CODED refusal rather than a read.
import { resolveArtifactRequest } from "../work-artifacts.mjs";
import { readWorkerDoc, readStreamedItemRow } from "../board-worker-stream.mjs";

export const docCommand = {
  id: "work:doc",
  input: {
    type: "object",
    properties: { ref: { type: "string" }, doc: { type: "string" }, member: { type: "string" } },
    required: ["ref", "doc"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const request = resolveArtifactRequest(input.doc, input.member);
    if (!request.ok) {
      throw commandError(request.message, request.code, 400);
    }
    // The echoed name stays the manifest's UPPERCASE name; a dir-kind answer echoes
    // its member beside it. `docKey` is the streamed row's key — the ONE spelling the
    // worker wrote and this reader asks for.
    const docName = request.name;
    const fileName = request.relPath;

    const streamedDoc = (lookupRef) => readWorkerDoc(ctx.workspace, lookupRef, request.docKey, {
      globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
    });
    // A dir-kind answer echoes its member beside the name; a file-kind answer's shape
    // is byte-unchanged from before the widening (no stray key appears).
    const memberField = request.member == null ? {} : { member: request.member };

    const item = await resolveItem(ctx.workspace.workDir, ref);
    if (!item) {
      // The local checkout has never seen this ref (a worker-streamed story) — the
      // projection is the only place its docs exist on this machine.
      const streamed = await streamedDoc(ref);
      if (streamed != null) {
        return { ref, doc: docName, ...memberField, present: true, body: streamed.body, fromWorker: true, reportedBy: streamed.reportedBy };
      }
      // The streamed-existence rule (m42): a listed streamed item with no
      // streamed copy of THIS doc is absent-not-error — never ref-not-found.
      const row = await readStreamedItemRow(ctx.workspace, ref, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} });
      if (row != null) return { ref, doc: docName, ...memberField, present: false, body: "", fromWorker: true };
      throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    }

    // path.join on the native dir (findWork returns the OS-native path). A missing
    // file is NOT an error — ENOENT → { present:false, body:"" } (ADR-003), after
    // the projection has had its chance to answer (the item may resolve locally as
    // a pre-run scaffold while the worker holds the real doc).
    try {
      const body = await readFile(path.join(item.dir, fileName), "utf8");
      return { ref: item.ref, doc: docName, ...memberField, present: true, body };
    } catch (error) {
      if (error.code === "ENOENT") {
        const streamed = await streamedDoc(item.ref);
        if (streamed != null) {
          return { ref: item.ref, doc: docName, ...memberField, present: true, body: streamed.body, fromWorker: true, reportedBy: streamed.reportedBy };
        }
        return { ref: item.ref, doc: docName, ...memberField, present: false, body: "" };
      }
      throw error;
    }
  },

  cli: {
    // m42 wave (d) leg d1 — dispatched by the registry-derived route table
    // through the ONE generic face (spine/face.mjs); the verbatim
    // workDocCommand face copy in cli.mjs is retired. The spec IS the flag
    // vocabulary: only --json/--config (BASE_FLAGS) apply here.
    route: ["work", "doc"],
    spec: {
      usage: "aof work doc <ref> <DOC> [member] [--json]",
    },

    // `aof work doc <ref> <DOC>` — two positionals map onto the input.
    // A third positional is the DIR-kind entry's MEMBER (`aof work doc 43/03 TASKS
    // 00_a.feature`) — additive, and absent for every exact-filename request.
    argv: (positionals) => ({ ref: positionals[0], doc: positionals[1], ...(positionals[2] ? { member: positionals[2] } : {}) }),

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
