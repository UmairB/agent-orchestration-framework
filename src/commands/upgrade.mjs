// work:upgrade — the CLI face over the migration registry engine
// (src/work-upgrade.mjs, milestone 40 / story 02, ADR-005). A thin wrapper —
// mirrors migrate:folder / insert-milestone's argv -> input -> engine shape.
//
// Bare `aof upgrade` APPLIES (writes through the ADR-004 atomic writer);
// `--dry-run` PREVIEWS and writes nothing — the `aof project migrate`
// dry-run/apply face precedent (bare = apply, `--dry-run` = preview only). A
// schema newer than this build REFUSES the whole run (a thrown command error,
// non-zero exit at the CLI face, nothing written).
import { runUpgrade } from "../work-upgrade.mjs";

export const upgradeCommand = {
  id: "work:upgrade",
  input: {
    type: "object",
    properties: { dryRun: { type: "boolean" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    return await runUpgrade(ctx.workspace.workDir, { apply: input?.dryRun !== true });
  },

  cli: {
    // `aof upgrade [--dry-run] [--json]` (also reachable as `aof work upgrade`,
    // the SAME face — cli.mjs's workCommand dispatch reuses this one function).
    argv: (positionals, options = {}) => ({ dryRun: Boolean(options.dryRun) }),

    render(result) {
      if (result.dryRun) {
        if (result.pendingCount === 0) {
          return "aof upgrade --dry-run: nothing pending — every item is already at the current schema.";
        }
        const lines = result.pending.map(
          (entry) =>
            `  ${entry.ref} (${entry.type}): schema ${entry.schema} -> ${entry.toSchema} via ${entry.transformIds.join(", ")}`
        );
        return [`aof upgrade --dry-run: ${result.pendingCount} item(s) pending —`, ...lines].join("\n");
      }
      if (result.pendingCount === 0) {
        return "aof upgrade: nothing to do — every item is already at the current schema.";
      }
      return `aof upgrade: upgraded ${result.applied.length} item(s) to the current schema.`;
    },

    json: (result) => result,
  },
};
