// work:run-status — read an item's run history (ADR-003 the observability READ).
//
// A thin READ wrapper over story 00's src/run-store.mjs (the doc.mjs idiom). It
// resolves the ref with `resolveItem` (exact-preferred, free-text slug fallback
// tolerated — the read is forgiving where the writes are not, like work:doc /
// work:tasks). An item with no runs is absent-NOT-error: readRuns returns [] (the
// store's ENOENT→[] discipline, ADR-002), never a thrown error. The result is
// { ref, runs:[…] } — records carry refs, so there is no path projection.
import { resolveItem } from "./resolve.mjs";
import { commandError } from "../command-error.mjs";
import { readRuns } from "../run-store.mjs";
// schema v5 (TECH_DEBT item 6 — finish the board bridge): a ref whose runs live on
// another machine's worktree answers from the worker-streamed projection — the RUNS
// tab used to read the LOCAL runs/ dir and say "No runs yet" for an item that was
// running remotely at that moment.
import { readWorkerRuns, readStreamedItemRow } from "../board-worker-stream.mjs";
import { executionScopeRef } from "../board-mesh-execution.mjs";

export const runStatusCommand = {
  id: "work:run-status",
  input: {
    type: "object",
    properties: { ref: { type: "string" } },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";
    const streamedRuns = (lookupRef) => readWorkerRuns(ctx.workspace, lookupRef, {
      globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {},
    });

    // Streamed lookup honours the EXECUTION SCOPE (runs are recorded at the
    // top-level item — a story's run context IS its milestone's): the ref's own
    // streamed runs, else the scope's.
    const streamedScoped = async (lookupRef) =>
      (await streamedRuns(lookupRef)) ?? (executionScopeRef(lookupRef) !== lookupRef ? await streamedRuns(executionScopeRef(lookupRef)) : null);

    // The READ tolerates the slug-fallback resolver (like work:doc / work:tasks).
    const item = await resolveItem(ctx.workspace.workDir, ref);
    if (!item) {
      // The streamed-existence rule (m42): an item the worker streams EXISTS.
      // Its runs come from the projection (own ref, else scope); no streamed
      // runs is an EMPTY history — "Could not load runs" for a listed item was
      // a lie about existence.
      const streamed = await streamedScoped(ref);
      if (streamed != null) return { ref, runs: streamed.runs, fromWorker: true, reportedBy: streamed.reportedBy };
      const row = await readStreamedItemRow(ctx.workspace, ref, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} });
      if (row != null) return { ref, runs: [], fromWorker: true };
      throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    }

    // readRuns is absence-tolerant: an item with no runs/ dir → an empty array —
    // in which case the worker's streamed records (an item running remotely RIGHT
    // NOW) are the truthful answer, not an empty local dir.
    const runs = await readRuns(item);
    if (runs.length === 0) {
      const streamed = await streamedScoped(item.ref);
      if (streamed != null) return { ref: item.ref, runs: streamed.runs, fromWorker: true, reportedBy: streamed.reportedBy };
    }
    return { ref: item.ref, runs };
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs face copy is deleted.
    route: ["work", "run-status"],
    spec: {
      usage: "aof work run-status <ref> [--json]",
      flags: {},
    },

    // `aof work run-status <ref>` — one positional maps onto the input.
    argv: (positionals) => ({ ref: positionals[0] }),

    // List each run with its runId + state; an item with no runs renders an
    // explicit empty-history line.
    render(result) {
      if (result.runs.length === 0) {
        return `${result.ref} — no runs.`;
      }
      const lines = result.runs.map((run) => `  ${run.runId}  ${run.state}`);
      return `${result.ref} — ${result.runs.length} run(s):\n${lines.join("\n")}`;
    },

    // No path in the result (records carry refs) — passes through unchanged.
    json: (result) => result,
  },
};
