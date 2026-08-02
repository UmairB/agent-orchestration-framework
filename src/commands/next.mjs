// work:next — the next actionable item, respecting `depends` (ADR-002).
//
// `run` returns the core `nextWork` result with its `path` left a RAW ABSOLUTE in
// its on-disk OS form. Mesh git-bus lease/issuance overlays are retired; global
// visibility is handled by the mesh projection/WebSocket path, not by filtering
// next-work candidacy from repo-local mesh files.
//
// m43 / ADR-003 — THE SKIP-AND-REPORT HALF OF THE ITEM LOCK. `next` consults the SAME
// predicate the mint door does and renders it the other way round: it returns the next
// UNHELD item and REPORTS the ones it stepped over, each naming its holder. The two
// failure modes the criterion names are both closed here — silently omitting a held
// item (the item becomes invisible, and an operator cannot tell "nothing left" from
// "everything is being worked"), and handing one out to be refused a step later (a bad
// seam). One rule, two renderings.
import path from "node:path";
import { nextWork, listItems } from "../work.mjs";
// The lock's read side. The command never decides the scope lock itself and never
// queries `global_assignments` — it asks the predicate (acd-item-lock-single-door).
import { readHeldScopes } from "../item-lock.mjs";
// The scope rule from its OWN home, the pure leaf — never through
// board-mesh-execution.mjs's compatibility re-export, which exists for that face's
// three pre-existing consumers and would drag a FACE plus its six dependencies into a
// command that otherwise imports only work.mjs (m43/ADR-003's layering).
import { executionScopeRef } from "../assignment-record.mjs";

export const nextCommand = {
  id: "work:next",
  input: {
    type: "object",
    // `now` remains accepted as a white-box no-op for older callers.
    properties: { scope: { type: "string" }, now: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const scope = scopeOf(input);
    const ws = ctx.workspace;

    // Every execution scope an active assignment holds in THIS workspace. Empty for a
    // workspace mesh was never configured for — in which case everything below is a
    // no-op and the envelope is byte-identical to the pre-lock one, plus an empty
    // `skipped`.
    const held = await readHeldScopes(ws, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} });
    const items = held.size === 0 ? [] : await listItems(ws.workDir);

    // The candidacy view is the EXISTING injected seam (m26/ADR-005, m27/ADR-004) —
    // "being worked, just not here" is precisely what a held scope means, so the walk
    // needs no new concept and `work.mjs` gains nothing. A ref whose execution scope is
    // held is passed over exactly as not-actionable, and a milestone whose every
    // remaining story is passed over is not offered for acceptance either.
    const candidacyView = new Map();
    for (const item of items) {
      const holder = held.get(executionScopeRef(item.ref));
      if (holder) candidacyView.set(item.ref, { state: "leased-live", holder: holder.holderNode });
    }

    // The raw nextWork result — its `path` (when present) is the OS-native
    // absolute item directory; the command does not relativise or slash it.
    const result = await nextWork(ws.workDir, scope, candidacyView.size > 0 ? { candidacyView } : {});
    const skipped = skippedEntries(items, held, scope);
    if (skipped.length === 0) return { ...result, skipped };

    // THE SEAM PROPERTY: whatever next hands out, the mint door accepts. The
    // milestone-ACCEPT fallthrough inside `nextWork` is deliberately candidacy-blind
    // (a genuinely-done milestone is not a claimable work ref), so a held milestone
    // whose stories are all done could still arrive here — it is reported as held
    // rather than offered, because offering it would hand out an item `run-start`
    // would refuse a step later.
    if (result.state === "ready" && held.has(executionScopeRef(result.ref))) {
      return { state: "held", skipped };
    }
    // "everything actionable is held elsewhere" is NOT "done" (ADR-010/R1.5) —
    // reporting done over work someone else is doing is the invisible-item failure
    // with a friendly face. `blocked` stands: a held item and a blocked item are
    // different answers.
    if (result.state === "done") return { state: "held", skipped };
    return { ...result, skipped };
  },
  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs face copy is deleted.
    route: ["work", "next"],
    spec: {
      usage: "aof work next [range] [--json]",
      flags: {},
    },

    // `aof work next [scope]` — an optional positional maps onto the input.
    argv: (positionals) => (positionals[0] ? { scope: positionals[0] } : {}),

    // Reproduces today's `aof work next` human render byte-for-byte: a scope-aware
    // done line, the blocked line naming the unmet drivers, or the
    // ready item's two-line `ref … / cwd-relative path` form.
    render(result, faceCtx = {}) {
      const scope = faceCtx.positionals?.[0];
      if (result.state === "held") {
        // Deliberately NOT the done line: "everything is being worked" and
        // "everything is done" are different facts and an operator acts on them
        // differently. Each holder is named, because the next move is to ask them.
        const holders = result.skipped
          .map((entry) => `  ${entry.ref.padEnd(7)} held by ${entry.holderNode ?? "another node"} (${entry.state ?? "active"}, assignment ${entry.assignmentId ?? "?"})`)
          .join("\n");
        return `Nothing free${scope ? ` in ${scope}` : ""} — everything actionable is being worked elsewhere:\n${holders}`;
      }
      const skippedNote = Array.isArray(result.skipped) && result.skipped.length > 0
        ? `\n        (skipped ${result.skipped.map((entry) => `${entry.ref} — held by ${entry.holderNode ?? "another node"}`).join("; ")})`
        : "";
      if (result.state === "done") {
        return `Nothing actionable${scope ? ` in ${scope}` : ""} — everything is done.`;
      }
      if (result.state === "blocked") {
        return `Blocked: ${result.ref} (${result.slug}) waits on milestone(s) ${result.waitingOn.join(", ")} — not done.${skippedNote}`;
      }
      const head = `${result.ref.padEnd(7)} ${result.type.padEnd(9)} ${(result.status ?? "-").padEnd(12)} ${result.slug}`;
      return `${head}\n        ${path.relative(process.cwd(), result.path)}${skippedNote}`;
    },

    // `aof work next --json` relativises `path` to cwd (cli.mjs:611), passing the
    // rest of the result through; a path-less (done/held) result passes through whole.
    json: (result) =>
      typeof result.path === "string"
        ? { ...result, path: path.relative(process.cwd(), result.path) }
        : result,
  },
};

// skippedEntries(items, held, scope) — what next stepped over, in the SAME five-key
// vocabulary the refusal payload carries (ADR-010/R1.5), so one rule reads identically
// as an error and as a list.
//
// THE GRAIN. Held-ness is a SCOPE property — the predicate is symmetric, so a story is
// never held independently of its milestone — which makes the top-level driver the
// natural unit: one entry per held driver, `ref === scopeRef`. When the caller NAMED a
// scope, though, the question was "what inside <scope> should I pick up?", and the
// honest answer enumerates the items INSIDE it that are held, each carrying the scope
// that holds them (`ref` the item, `scopeRef` the holder's scope) — which is why the
// entry shape carries both keys.
function skippedEntries(items, held, scope) {
  if (held.size === 0) return [];
  const named = typeof scope === "string" ? scope.trim() : "";
  // Did the caller name ONE driver? A range ("01-03") or a free-text scope does not,
  // and falls back to the driver grain across the stream — over-reporting a held driver
  // outside the range is a nuisance, silently omitting one is the failure this whole
  // criterion exists to prevent.
  const namedDriver = named !== "" && items.some((item) => item.parent == null && item.ref === named);
  const entries = [];
  for (const item of items) {
    const scopeRef = executionScopeRef(item.ref);
    const holder = held.get(scopeRef);
    if (!holder) continue;
    if (namedDriver) {
      if (scopeRef !== named) continue;
    } else if (item.parent != null) {
      continue;
    }
    entries.push({
      ref: item.ref,
      scopeRef,
      holderNode: holder.holderNode,
      assignmentId: holder.assignmentId,
      state: holder.state,
    });
  }
  return entries;
}

function scopeOf(input) {
  const scope = typeof input?.scope === "string" ? input.scope.trim() : "";
  return scope === "" ? undefined : scope;
}
