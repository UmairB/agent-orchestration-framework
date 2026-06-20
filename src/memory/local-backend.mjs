// The `local` memory backend — the integration GLUE composing the two halves of
// milestone 05's local backend behind the frozen interface (ADR-003):
//   - story 01 (`local-indexing.mjs`) owns reindex/status + the derived index.
//   - story 02 (`local-retrieval.mjs`) owns recall/ranking over that index.
//
// The default export is EXACTLY { name, recall, reindex, status } (ADR-003,
// enforced by acd-memory-backend-interface). `recall` injects the on-disk index
// loader as `ctx.loadIndex` so the retrieval half — a pure function of records —
// reads the frozen index document (ADR-005) the indexing half wrote. The seam
// (story 00) reaches this module only through the four interface methods and
// never reads the index file directly.

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { reindex, status, memoryIndexPath } from "./local-indexing.mjs";
import { recall as retrievalRecall } from "./local-retrieval.mjs";

// Load the frozen index document the indexer wrote (ADR-005). An absent or
// corrupt store reads as an empty corpus — recall never throws on no index
// (mirrors `status`, which also tolerates an absent store).
async function loadIndex(projectRoot) {
  const storePath = memoryIndexPath(projectRoot);
  if (!existsSync(storePath)) return { records: [] };
  try {
    return JSON.parse(await readFile(storePath, "utf8"));
  } catch {
    return { records: [] };
  }
}

// recall wires the retrieval half to the real on-disk index: the seam hands us
// ctx = { workDir, projectRoot, configMemory }; we add `loadIndex` so retrieval's
// `resolveRecords` reads the frozen document at `.aof/aof.memory.index.json`.
async function recall(query, scope, opts, ctx = {}) {
  return retrievalRecall(query, scope, opts, {
    ...ctx,
    loadIndex: () => loadIndex(ctx.projectRoot)
  });
}

export default {
  name: "local",
  recall,
  reindex,
  status
};
