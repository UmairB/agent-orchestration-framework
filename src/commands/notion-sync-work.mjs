// notion:sync-work — push an aof milestone (+ its stories) to a Notion work board
// (milestone 17 / story 00 — the SPINE; ADR-002 command/envelope, ADR-004 opt-in
// no-op gate, ADR-001 mapping sidecar).
//
//   input  { milestone: string, dryRun?: boolean }   // required: ["milestone"]
//   result SyncResult { milestone, configured, dryRun, items: [ItemResult], hint? }
//
// `run` reads the milestone + its stories via the shared `listItems`/`readMeta`
// traversal (NO new traversal) and returns a basis-NEUTRAL per-item envelope.
//
// The OPT-IN NO-OP GATE (ADR-004 / STATE §Opt-in no-op): when the workspace config
// has NO `work.integrations.notion` block, the command is an HONEST no-op — it
// returns `{ configured:false, items:[], hint }`, spawns NO CLI, and issues ZERO
// Notion calls. An unconfigured project is HEALTHY; the no-op is success, not an
// error, and names the config block the operator must add.
//
// The CONFIGURED path is a STORY-00 STUB: when configured, it walks the milestone +
// stories and returns `configured:true` with an EMPTY items list. The real
// projection (story 01, ADR-003) fills the create/patch plan; it reaches Notion ONLY
// through the INJECTABLE spawn seam below (`ctx.notionSpawn` / `deps.notionSpawn`),
// so a test can inject a spy and assert it is NEVER called on a story-00 path.
//
// CLI face: `aof work integrations notion sync-work <milestone> [--json] [--dry-run]`
// (the new `integrations` sub-noun on workCommand; ADR-002). Refs are not paths, so
// `json` returns the envelope verbatim — no relativise step.
import { commandError } from "./errors.mjs";
import { listItems, parseFrontmatter } from "../work.mjs";
import { readMapping } from "../notion/mapping.mjs";
import { projectMilestone } from "../notion/projection.mjs";
import { applyPlan } from "../notion/sync.mjs";
import { makeNotionSpawn } from "../notion/cli.mjs";
import path from "node:path";
import { readFile } from "node:fs/promises";

// The setup hint the no-op prints/carries — it names the config block to add so an
// operator knows exactly what makes the command live (ADR-004). Kept here so the
// `run` envelope and the CLI render share one source of truth.
export const NOTION_SETUP_HINT =
  'Notion sync is not configured. Add a "work.integrations.notion" block (dataSourceId, tokenEnv, statusProperty, statusMap, relationProperty) to your aof config to enable it.';

// The DEFAULT Notion-CLI spawn seam (ADR-004 / story 02). When no spawn spy is
// injected (ctx.notionSpawn / deps.notionSpawn), the configured apply path uses the
// REAL provisioned-CLI spawn built from the config — it reads the token from the
// named env var, passes it (plus NOTION_KEYRING=0) through the spawned `ntn`'s
// ENVIRONMENT (never the argv), resolves the binary via the m12 store-then-PATH
// resolver, and fails HONESTLY on an absent token / absent binary (a structured
// configured-but-unreachable error, never a half-write). Built per-run from the
// resolved `work.integrations.notion` config (so the tokenEnv reference is honoured).
export function defaultNotionSpawnFor(notionConfig, env = process.env) {
  return makeNotionSpawn({ config: notionConfig, env });
}

// Read an item's record-doc frontmatter (SPEC.md for a milestone, STORY.md for a
// story) WITHOUT depending on work.mjs's private readMeta — story 00 only needs the
// status, and the traversal contract is `listItems` + `parseFrontmatter` (both
// exported). Returns {} on any read failure (an absent/partial doc is not fatal).
async function readItemMeta(item) {
  const doc = item.type === "milestone" ? "SPEC.md" : item.type === "story" ? "STORY.md" : null;
  if (!doc) return {};
  try {
    return parseFrontmatter(await readFile(path.join(item.dir, doc), "utf8"));
  } catch {
    return {};
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
    const milestone = input.milestone;
    const dryRun = input.dryRun === true;

    if (typeof milestone !== "string" || milestone.length === 0) {
      throw commandError(
        "Usage: aof work integrations notion sync-work <milestone>",
        "missing-milestone",
        400
      );
    }

    // OPT-IN NO-OP GATE (ADR-004): absent `work.integrations.notion` ⇒ an honest
    // no-op. Returns the no-op envelope, spawns NO CLI, issues ZERO Notion calls —
    // the gate is reached BEFORE any traversal/spawn, so no Notion egress is even
    // constructed on this path (the hard requirement, STATE §Opt-in no-op).
    const notionConfig = ctx?.workspace?.config?.work?.integrations?.notion;
    if (notionConfig == null) {
      return {
        milestone,
        configured: false,
        dryRun,
        items: [],
        hint: NOTION_SETUP_HINT,
      };
    }

    // CONFIGURED PATH (story 01, ADR-003). Walk the milestone + its stories via the
    // shared traversal (NO new traversal), read the sidecar mapping (ADR-001),
    // compute the PURE projection plan, and — unless --dry-run — apply it through the
    // injectable spawn seam.
    //
    // The seam is resolved (ctx-injected spy → deps override → the real default) and
    // is reached ONLY by the apply layer (src/notion/sync.mjs) on a non-dry-run path;
    // a test injects a spy via ctx.notionSpawn to assert dry-run/noop/skip call it ZERO
    // times and to capture the create/patch argv on the apply path.
    const notionSpawn = ctx?.notionSpawn ?? deps.notionSpawn ?? defaultNotionSpawnFor(notionConfig);

    const all = await listItems(ctx.workspace.workDir);
    const milestoneItem = all.find(
      (item) => item.type === "milestone" && item.parent == null && item.ref === String(milestone)
    );
    if (!milestoneItem) {
      throw commandError(
        `No milestone "${milestone}" found in the work stream.`,
        "milestone-not-found",
        404
      );
    }

    // The milestone + its stories, in traversal order (milestone FIRST — the §A3
    // self-relation parent). Read each item's on-disk frontmatter (title + status)
    // so the projection has the inputs it needs.
    const scope = all.filter(
      (item) => item.ref === milestoneItem.ref || item.parent === milestoneItem.number
    );
    const items = await Promise.all(
      scope.map(async (item) => ({
        ref: item.ref,
        type: item.type,
        slug: item.slug,
        meta: await readItemMeta(item),
      }))
    );

    // Read the sidecar mapping for the configured data-source (ADR-001) — the SOLE
    // identity store; a HIT decides patch, a MISS decides create. NO Notion call.
    const projectRoot = ctx.workspace.projectRoot;
    const mapping = await readMapping(projectRoot, notionConfig.dataSourceId);

    // The PURE projection (ADR-003): one Op per item, decided from local facts only.
    const plan = projectMilestone({ items, config: notionConfig, mapping });

    // --dry-run: apply NOTHING (zero spawns) — the plan IS the preview (ADR-003).
    // A non-dry-run applies the plan through the spawn seam, recording new page ids.
    const { items: results } = await applyPlan({
      plan,
      config: notionConfig,
      projectRoot,
      notionSpawn,
      dryRun,
    });

    return {
      milestone,
      configured: true,
      dryRun,
      items: results,
    };
  },

  cli: {
    // `aof work integrations notion sync-work <milestone> [--dry-run] [--json]`.
    argv: (positionals, options = {}) => ({
      milestone: positionals[0],
      dryRun: !!options.dryRun,
    }),

    // Human render: the no-op prints the setup hint naming the config block; a
    // configured run prints a per-item summary (empty on the story-00 stub).
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
      return [head, ...lines].join("\n");
    },

    // --json face: the envelope verbatim (refs are not paths — no relativise step).
    json: (result) => result,
  },
};
