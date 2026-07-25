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
// …and, for an item whose mesh work lives on a BRANCH this checkout does not carry, the
// stream AS IT EXISTS THERE — otherwise a fully-broken-down milestone reads "0 stories".
import { readBranchItems, mergeBranchItems } from "../board-branch-stream.mjs";

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
    let merged = applyExecutionOverlay(rows, overlay);
    // For every item whose mesh work landed on a branch, splice in that branch's OWN
    // subtree (the milestone plus the stories a refine authored there). Without this the
    // board lists only what THIS checkout has — a scaffolded milestone with "0 stories"
    // over one that has been fully broken down on the branch. Per-item and best-effort:
    // an unresolvable ref, or a git fault, simply leaves that item's local rows in place.
    const workDirRel = relativeWorkDir(ctx.workspace);
    for (const [itemRef, execution] of overlay) {
      if (execution?.branch == null) continue;
      try {
        const branchRows = await readBranchItems(ctx.workspace.projectRoot, execution.branch, { workDirRel, itemRef });
        if (branchRows != null) {
          // The branch rows describe the same item the overlay just annotated, so carry
          // the execution facts onto the milestone row they replace.
          merged = mergeBranchItems(merged, branchRows.map((row) => (row.ref === itemRef ? { ...row, execution } : row)));
        }
      } catch {
        // best-effort: this item keeps whatever the local stream gave it.
      }
    }
    return merged;
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

// relativeWorkDir(workspace) — the workspace's work dir as a REPO-RELATIVE, forward-slashed
// path (`wiki/work`), which is how it appears inside a git tree listing. Falls back to the
// documented default when the two paths do not relate (a workspace configured oddly).
function relativeWorkDir(workspace) {
  const root = String(workspace?.projectRoot ?? "");
  const workDir = String(workspace?.workDir ?? "");
  if (!root || !workDir) return "wiki/work";
  const normalizedRoot = root.replaceAll("\\", "/").replace(/\/+$/, "");
  const normalized = workDir.replaceAll("\\", "/");
  if (!normalized.startsWith(`${normalizedRoot}/`)) return "wiki/work";
  return normalized.slice(normalizedRoot.length + 1);
}

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
