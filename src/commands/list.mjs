// work:list — the whole work stream as the board's read model (ADR-002).
//
// `run` returns the full `listStream` array UNWRAPPED. Each row's `dir` is
// exactly what `listStream` emits — already a forward-slashed absolute
// (work.mjs:223) — so the command neither re-bases nor re-slashes it: it is
// basis-neutral (neither cwd- nor projectRoot-relative) and both faces emit it
// unchanged. Path display for list is therefore a no-op on either face.
import { listStream } from "../work.mjs";
// VERIFICATION (board mesh-execution overlay, 2026-07-25) — the board asked "what is the
// state of this item?" and got the CONTROL node's own local frontmatter, which reads
// `not-started` for work a WORKER on another machine is executing on its own branch. The
// overlay answers the operator's three steps (is it executing / show that / else local).
import { readExecutionOverlay, applyExecutionOverlay } from "../board-mesh-execution.mjs";
// …and the WORKER's own live view of those items (streamed from its worktree into the
// projection), which is what a mesh item's rows come from — otherwise a fully-broken-down
// milestone reads "0 stories" because this checkout has only the pre-run scaffold.
import { readWorkerItems, mergeWorkerItems } from "../board-worker-stream.mjs";

export const listCommand = {
  id: "work:list",
  // `mesh` is an OPT-IN (the board face passes it; the CLI never does), so `aof work list`
  // stays a pure local read with no store open — the overlay is a board affordance, not a
  // new cost on every list.
  input: { type: "object", properties: { mesh: { type: "boolean" } }, additionalProperties: false },

  async run(input, ctx) {
    const rows = await listStream(ctx.workspace.workDir);
    if (input?.mesh !== true) return rows;
    const overlay = await readExecutionOverlay(ctx.workspace, {
      globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
    });
    // The WORKER's own view of each mesh item, streamed up the fabric from the worktree it
    // is actually working in and merged into the global projection. This is the source for
    // a mesh item — NOT the git branch: a branch only exists after a run commits and
    // pushes, so branch-reading can never show work in flight and makes committing a
    // precondition for seeing anything. Absent (no worker has reported) leaves the row
    // exactly as the local checkout has it.
    const worker = await readWorkerItems(ctx.workspace, {
      globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
      refs: [...overlay.keys()],
    });
    // Overlay LAST (2026-07-26, operator-found): a mesh milestone's stories often exist
    // ONLY as worker-streamed rows (the local checkout holds the pre-run scaffold), and
    // the earlier merge-after-overlay order meant those inserted rows never passed the
    // overlay — so a story of a RUNNING milestone still offered Continue instead of
    // "Running on <node>". applyExecutionOverlay skips its status override for
    // fromWorker rows (their streamed status IS the live truth), so the order swap
    // changes affordance data only, never a worker-reported status.
    return applyExecutionOverlay(mergeWorkerItems(rows, worker, overlay), overlay);
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs face copy is deleted.
    route: ["work", "list"],
    spec: {
      usage: "aof work list [scope] [--json]",
      flags: {},
    },

    // No positionals/options map onto list's input — it takes none.
    argv: () => ({}),

    // The human render reproduces today's `aof work list` listing byte-for-byte —
    // depth-indented `ref · type · status · title`, optionally narrowed to a scope
    // subtree. The scope filter is a human-view affordance (the `--json` form below
    // always emits the WHOLE stream); the generic face passes the raw positionals,
    // so the scope is `positionals[0]`. `dir` is already forward-slashed, so no
    // path projection is needed for the human view.
    render(rows, faceCtx = {}) {
      const scope = faceCtx.scope ?? faceCtx.positionals?.[0];
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
