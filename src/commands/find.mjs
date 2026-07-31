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
import { findWork } from "../work.mjs";
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
    const rows = await findWork(ctx.workspace.workDir, input.query);
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
        lines.push(`        ${path.relative(process.cwd(), row.dir)}`);
      }
      return lines.join("\n");
    },

    json: (result) => result.rows.map((row) => ({ ...row, dir: path.relative(process.cwd(), row.dir) })),

    // A no-match READ exits 1 on the human face only (--json reports [] at 0).
    exit: (result, faceCtx) => (faceCtx.options.json !== true && result.rows.length === 0 ? 1 : 0),
  },
};
