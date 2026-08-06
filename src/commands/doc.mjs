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
// m43 / story 06 (ADR-005) — WHOSE VIEW IS FRESHER, decided by `node_id` and nothing else.
// The resolver is now cache-first, so a ref another node authored resolves here even when
// this node holds only a stale scaffold — and for THAT ref the cached artifact is the
// truthful body, while the local file is the scaffold the milestone exists to stop serving.
// For a ref THIS node last reported, the opposite holds by construction: the disk is what
// this node publishes FROM, so the local file is never older than the copy it produced, and
// preferring the cache would shadow the operator's own live edits with their last publish.
// One rule, both directions, and it is the same discriminator ADR-005 gives doctor.
// The predicate itself lives at the seam that owns `answeredFrom` (ADR-016/G10 collapsed the
// byte-identical copy this file and `tasks.mjs` each kept: one fact, one source).
import { meshNodeIdOf } from "./mesh-gate.mjs";
import { reportedElsewhere } from "../work-read.mjs";

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

    // m43 / story 04 — the ARTIFACT's own provenance, under the SAME two wire names the row
    // carries (`reportedBy` + `syncedAt`). A doc can be older than the row that names it, so
    // its instant travels with it rather than being inferred from the row. `answeredFrom`
    // (m43 / story 06) says which SIDE produced the body sitting beside them.
    const fromCache = (lookupRef, streamed) => ({
      ref: lookupRef, doc: docName, ...memberField, present: true, body: streamed.body,
      fromWorker: true, answeredFrom: "cache", reportedBy: streamed.reportedBy, syncedAt: streamed.syncedAt,
    });

    const item = await resolveItem(ctx, ref);
    if (!item) {
      // Neither this node's disk nor the cache's ROW set resolves the ref — but the cache
      // may still hold its docs (an artifact streamed ahead of the row that names it).
      const streamed = await streamedDoc(ref);
      if (streamed != null) return fromCache(ref, streamed);
      // The streamed-existence rule (m42): a listed streamed item with no
      // streamed copy of THIS doc is absent-not-error — never ref-not-found.
      const row = await readStreamedItemRow(ctx.workspace, ref, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} });
      if (row != null) return { ref, doc: docName, ...memberField, present: false, body: "", fromWorker: true, answeredFrom: "cache" };
      throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    }

    // A ref another node reported — the cached body is the truthful one, and for a ref with
    // NO local folder at all it is the only one there can be (ADR-010/R6.4: never fabricate
    // a path to go looking for the other).
    if (item.dir == null || reportedElsewhere(item, meshNodeIdOf(ctx.workspace.config ?? {}))) {
      const streamed = await streamedDoc(item.ref);
      if (streamed != null) return fromCache(item.ref, streamed);
      if (item.dir == null) {
        // Resolved, cache-answered, and the cache holds no copy of THIS doc: absent, and
        // explicitly so — never an unmarked empty dressed as a local read.
        return { ref: item.ref, doc: docName, ...memberField, present: false, body: "", fromWorker: true, answeredFrom: "cache", reportedBy: item.reportedBy ?? null };
      }
    }

    // path.join on the native dir (findWork returns the OS-native path). A missing
    // file is NOT an error — ENOENT → { present:false, body:"" } (ADR-003), after
    // the projection has had its chance to answer (the item may resolve locally as
    // a pre-run scaffold while the worker holds the real doc).
    try {
      const body = await readFile(path.join(item.dir, fileName), "utf8");
      return { ref: item.ref, doc: docName, ...memberField, present: true, body, answeredFrom: "disk" };
    } catch (error) {
      if (error.code === "ENOENT") {
        const streamed = await streamedDoc(item.ref);
        if (streamed != null) return fromCache(item.ref, streamed);
        return { ref: item.ref, doc: docName, ...memberField, present: false, body: "", answeredFrom: "disk" };
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
