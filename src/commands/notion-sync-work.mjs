// notion:sync-work — push an aof milestone (+ its stories) to a Notion work board
// (milestone 17 / story 00 — the SPINE; ADR-002 command/envelope, ADR-004 opt-in
// no-op gate, ADR-001 mapping sidecar).
//
//   input  { milestone: string, dryRun?: boolean }   // required: ["milestone"]
//   result SyncResult { milestone, configured, dryRun, items: [ItemResult], hint?, drained? }
//
// THE BODY LIVES IN src/notion/sync-work.mjs (m42 wave (d) leg d4, port 4): the
// opt-in gate, traversal, routing, sidecar, projection and apply are ONE core —
// `syncMilestoneWork` — shared with the effects ledger's `notion-status-sync`
// reactor, so the verb and the cascade can never drift apart. This file keeps the
// FACE (input schema, argv/render/json) plus the verb's own half of the ledger
// contract: DRAINING the owed `integration:notion` steps.
//
// THE DRAIN (port 4's recorded decision): a run completion in a Notion-configured
// workspace appends a durable `notion-status-sync` step. With `autoSync: true`
// the completion's own drain pays it in place; WITHOUT autoSync the step stays
// deferred — owed to exactly this verb, the operator's "do Notion egress now"
// door. A successful non-dry-run sync therefore finishes by draining every owed
// step of THIS workspace (any milestone — the step's own scope is its payload),
// through the ordinary dispatcher: the reactor re-projects, the sidecar's
// lastStatus/lastContentHash dedup makes already-covered items no-ops, and the
// journal marks the debt paid. `drained` rides the envelope (additive, present
// only when steps were paid) so the egress is visible.
import { existsSync } from "node:fs";
import { commandError } from "../command-error.mjs";
import { syncMilestoneWork, NOTION_SETUP_HINT } from "../notion/sync-work.mjs";
import { effectsJournalPath, openEffectsJournal, pendingSteps } from "../effects/journal.mjs";
import { drainEffects, LOCAL_LOCI } from "../effects/dispatch.mjs";
import { reportDegrade } from "../degrade.mjs";

// Compat re-exports: the hint + default spawn seam moved to the core with the body.
export { NOTION_SETUP_HINT, defaultNotionSpawnFor } from "../notion/sync-work.mjs";

// Pay the owed `notion-status-sync` steps for THIS workspace. Best-effort by
// design (the sync itself already succeeded — a drain fault degrades loudly and
// the steps stay owed for the next drain); read-only when no journal file exists.
async function drainOwedNotionSteps(ctx) {
  const journalOptions = ctx.effectsJournalOptions ?? {};
  try {
    if (!existsSync(effectsJournalPath(journalOptions))) return [];
    const journal = await openEffectsJournal(journalOptions);
    try {
      const owed = pendingSteps(journal, { limit: 100 }).filter(
        (step) =>
          step.key === "notion-status-sync" &&
          step.payload?.workspaceRoot === ctx.workspace.projectRoot
      );
      if (owed.length === 0) return [];
      // The verb's authority is what unlocks the integration locus here — the
      // same loci shape the autoSync completion drain uses.
      const loci = [...LOCAL_LOCI, "integration:notion"];
      const reactorCtx = { publisherOptions: ctx, workspace: ctx.workspace };
      const drained = [];
      const seenEvents = new Set();
      for (const step of owed) {
        if (seenEvents.has(step.eventId)) continue;
        seenEvents.add(step.eventId);
        const outcomes = await drainEffects({ journal, eventId: step.eventId, loci, ctx: reactorCtx });
        for (const outcome of outcomes) {
          if (outcome.key !== "notion-status-sync") continue;
          drained.push({
            eventId: outcome.eventId,
            ref: step.payload?.ref ?? null,
            status: outcome.status,
            ...(outcome.error ? { error: outcome.error } : {}),
          });
        }
      }
      return drained;
    } finally {
      journal.close();
    }
  } catch (error) {
    reportDegrade("notion-sync-drain", error);
    return [];
  }
}

export const notionSyncWorkCommand = {
  id: "notion:sync-work",
  input: {
    type: "object",
    properties: {
      milestone: { type: "string" },
      dryRun: { type: "boolean" },
    },
    required: ["milestone"],
    additionalProperties: false,
  },

  async run(input, ctx, deps = {}) {
    // The ONE body (core): gate → traversal → routing → sidecar → projection →
    // apply, through the injectable spawn seam (ctx-injected spy → deps override
    // → the real provisioned-CLI default, resolved inside the core).
    const result = await syncMilestoneWork(ctx?.workspace, {
      milestone: input.milestone,
      dryRun: input.dryRun === true,
      notionSpawn: ctx?.notionSpawn ?? deps.notionSpawn ?? null,
      // m43 / story 06 — the core's traversal is cache-first now, so it needs this
      // command's store injection seam (a test's hermetic global home) exactly as every
      // other migrated leaf does.
      globalWorkStoreOptions: ctx?.globalWorkStoreOptions ?? {},
    });

    // The verb's ledger half: a real (configured, non-dry-run) sync pays this
    // workspace's owed steps. A dry-run pays nothing — zero egress, zero journal
    // mutation — and an unconfigured no-op has nothing owed (the applicability
    // predicate never appended a step).
    if (result.configured && !result.dryRun) {
      const drained = await drainOwedNotionSteps(ctx);
      if (drained.length > 0) return { ...result, drained };
    }
    return result;
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs notionSyncWorkCli copy is deleted. The
    // missing-milestone usage refusal moved into the argv adapter (thrown BEFORE
    // invoke, so nothing is pushed to Notion — the retired guard's contract).
    route: ["work", "integrations", "notion", "sync-work"],
    spec: {
      usage: "aof work integrations notion sync-work <milestone> [--dry-run] [--json]",
      flags: {
        dryRun: { type: "boolean", description: "plan the sync without any Notion egress" },
      },
    },

    // `aof work integrations notion sync-work <milestone> [--dry-run] [--json]`.
    argv: (positionals, options = {}) => {
      if (positionals[0] == null) {
        throw commandError(
          "Usage: aof work integrations notion sync-work <milestone> [--dry-run] [--json]",
          "usage",
          400,
        );
      }
      return {
        milestone: positionals[0],
        dryRun: !!options.dryRun,
      };
    },

    // Human render: the no-op prints the setup hint naming the config block; a
    // configured run prints a per-item summary (one line per applied op), then —
    // when the ledger owed anything — the drained steps it paid.
    render(result) {
      if (!result.configured) {
        return `Notion sync: no-op for milestone ${result.milestone} (not configured).\n  ${result.hint}`;
      }
      const mode = result.dryRun ? " (dry-run)" : "";
      const head = `Notion sync: milestone ${result.milestone}${mode} — ${result.items.length} item(s).`;
      const lines = result.items.map(
        (item) =>
          `  ${item.ref} (${item.type}) — ${item.action}${item.reason ? `: ${item.reason}` : ""}`
      );
      if (Array.isArray(result.drained) && result.drained.length > 0) {
        lines.push(`Paid ${result.drained.length} owed Notion sync step(s) from the effects ledger.`);
        for (const step of result.drained) {
          lines.push(`  ${step.ref ?? step.eventId} — ${step.status}${step.error ? `: ${step.error}` : ""}`);
        }
      }
      return [head, ...lines].join("\n");
    },

    // --json face: the envelope verbatim (refs are not paths — no relativise step).
    json: (result) => result,
  },
};
