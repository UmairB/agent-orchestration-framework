// work:find — resolve a milestone (04), story (04/02), or slug (auth) to its
// work-stream rows (m42 wave (d) leg d1, wave-3 tail; formerly cli.mjs's
// CLI-only workFindCommand). A READ over the ONE resolver (work.mjs findWork),
// routed through the registry-derived route table + the generic face.
//
// Carried contracts (the retired face's bytes): the --json document is the BARE
// ARRAY of rows with cwd-relativised dirs (not an object envelope — pinned
// consumer shape); a no-match run prints `No work item matches "<q>".` on
// STDOUT and exits 1 (a read-miss, not an error) — but --json stays exit 0 with
// `[]` (the machine face reports the empty set, the caller branches).
import path from "node:path";
// m43 / story 06 (ADR-005) — a STAGE-2 LEAF, migrated onto the cache-first seam. `find` is
// one of the three surfaces the milestone's headline names: an item a worker authored and
// whose worktree is gone used to be invisible here, because this node's disk had never held
// it. Every returned row now says which side answered it.
import { findWorkCacheFirst } from "../work-read.mjs";
import { commandError } from "../command-error.mjs";

export const findCommand = {
  id: "work:find",
  input: {
    type: "object",
    properties: {
      query: { type: "string" },
    },
    required: ["query"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const rows = await findWorkCacheFirst(ctx.workspace, input.query, {
      globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
    });
    return { query: input.query, rows };
  },

  cli: {
    route: ["work", "find"],
    spec: {
      usage: "aof work find <ref | query> [--json]",
      flags: {},
    },

    argv: (positionals) => {
      if (!positionals[0]) {
        throw commandError(
          "Usage: aof work find <ref | query>   (e.g. aof work find 04, aof work find 04/02, aof work find auth)",
          "invalid-input",
          400,
        );
      }
      return { query: positionals[0] };
    },

    render(result) {
      if (result.rows.length === 0) return `No work item matches "${result.query}".`;
      const lines = [];
      for (const row of result.rows) {
        const title = row.title ? `  — ${row.title}` : "";
        lines.push(`${row.ref.padEnd(7)} ${row.type.padEnd(9)} ${(row.status ?? "-").padEnd(12)} ${row.slug}${title}`);
        // A cache-answered row for a ref this node does not hold has NO folder here
        // (ADR-010/R6.4). The human line says where the answer came from instead of printing
        // a relative path to nothing — `path.relative(cwd, null)` would throw, and a plausible
        // path would be worse than a throw.
        lines.push(`        ${displayDir(row)}`);
      }
      return lines.join("\n");
    },

    json: (result) => result.rows.map((row) => ({ ...row, dir: row.dir == null ? null : path.relative(process.cwd(), row.dir) })),

    // A no-match READ exits 1 on the human face only (--json reports [] at 0).
    exit: (result, faceCtx) => (faceCtx.options.json !== true && result.rows.length === 0 ? 1 : 0),
  },
};

// The human render's second line: this node's own path where there is one, else an honest
// statement of whose copy answered. Never a fabricated path (m43 / ADR-010/R6.4).
function displayDir(row) {
  if (typeof row.dir === "string" && row.dir.length > 0) return path.relative(process.cwd(), row.dir);
  return `(no local checkout — answered from the cache${row.reportedBy ? `, reported by ${row.reportedBy}` : ""})`;
}
