// work:list — the whole work stream as the board's read model (ADR-002).
//
// `run` returns the full `listStream` array UNWRAPPED. Each row's `dir` is
// exactly what `listStream` emits — already a forward-slashed absolute
// (work.mjs:223) — so the command neither re-bases nor re-slashes it: it is
// basis-neutral (neither cwd- nor projectRoot-relative) and both faces emit it
// unchanged. Path display for list is therefore a no-op on either face.
import { listStream } from "../work.mjs";

export const listCommand = {
  id: "work:list",
  input: { type: "object", properties: {}, additionalProperties: false },

  async run(_input, ctx) {
    return await listStream(ctx.workspace.workDir);
  },

  cli: {
    // No positionals/options map onto list's input — it takes none.
    argv: () => ({}),

    // The human render reproduces today's `aof work list` listing byte-for-byte —
    // depth-indented `ref · type · status · title`, optionally narrowed to a scope
    // subtree. The scope filter is a human-view affordance (the `--json` form below
    // always emits the WHOLE stream); the CLI face passes `faceCtx.scope`. `dir` is
    // already forward-slashed, so no path projection is needed for the human view.
    render(rows, faceCtx = {}) {
      const scope = faceCtx.scope;
      const listed = rows.filter((row) => inScope(row, scope));
      if (listed.length === 0) return `Nothing in scope${scope ? ` for "${scope}"` : ""}.`;
      return listed
        .map((row) => {
          const indent = row.parent == null ? "" : "  ";
          const title = row.title ?? "-";
          return `${indent}${row.ref.padEnd(7)} ${row.type.padEnd(9)} ${(row.status ?? "-").padEnd(12)} ${title}`;
        })
        .join("\n");
    },

    // `aof work list --json` passes the stream through. `dir` is already
    // forward-slashed; today's CLI emits it as-is, so no cwd projection.
    json: (rows) => rows,
  },
};

// The human-view scope filter (mirrors validateWork's `inScope`): an item is in
// scope if its own number equals the scope, its parent equals the scope, or — for
// free text — its slug contains it. Empty/absent scope matches everything.
function inScope(row, scope) {
  if (!scope) return true;
  const ref = String(scope).trim();
  const itemNumber = row.ref.includes("/") ? row.ref.split("/")[1] : row.ref;
  if (/^\d+$/.test(ref)) {
    const driver = row.parent ?? itemNumber;
    return Number.parseInt(driver, 10) === Number.parseInt(ref, 10);
  }
  const pair = ref.match(/^(\d+)\/(\d+)$/);
  if (pair) return row.ref === `${pair[1]}/${pair[2]}` || row.ref === ref;
  return row.slug.includes(ref);
}
