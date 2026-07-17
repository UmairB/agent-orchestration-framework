// work:upgrade — the CLI face over the migration registry engine
// (src/work-upgrade.mjs, milestone 40 / story 02, ADR-005). A thin wrapper —
// mirrors migrate:folder / insert-milestone's argv -> input -> engine shape.
//
// Bare `aof upgrade` APPLIES (writes through the ADR-004 atomic writer);
// `--dry-run` PREVIEWS and writes nothing — the `aof project migrate`
// dry-run/apply face precedent (bare = apply, `--dry-run` = preview only). A
// schema newer than this build REFUSES the whole run (a thrown command error,
// non-zero exit at the CLI face, nothing written).
//
// `--changelog` (milestone 40 / story 04, ADR-006) is the changelog's
// regenerate/drift-guard SURFACE: it emits `renderChangelog()` — the pure
// projection of `WORK_ITEM_MIGRATIONS` — to stdout and touches NO workspace
// state (no fs read of the committed artifact, no write). A maintainer (or
// CI) diffs the emitted text against the committed `UPGRADE-CHANGELOG.md` to
// confirm regenerate == committed, or pipes it straight over the file to
// regenerate. Takes precedence over `--dry-run`/apply — it never runs the
// engine.
import { runUpgrade, renderChangelog } from "../work-upgrade.mjs";

export const upgradeCommand = {
  id: "work:upgrade",
  input: {
    type: "object",
    properties: { dryRun: { type: "boolean" }, changelog: { type: "boolean" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    if (input?.changelog === true) {
      return { changelog: true, text: renderChangelog() };
    }
    return await runUpgrade(ctx.workspace.workDir, { apply: input?.dryRun !== true });
  },

  cli: {
    // `aof upgrade [--dry-run] [--changelog] [--json]` (also reachable as
    // `aof work upgrade`, the SAME face — cli.mjs's workCommand dispatch
    // reuses this one function).
    argv: (positionals, options = {}) => ({
      dryRun: Boolean(options.dryRun),
      changelog: Boolean(options.changelog),
    }),

    render(result) {
      // `renderChangelog()` output ends in a trailing newline (the committed
      // UPGRADE-CHANGELOG.md ends in exactly one LF). The CLI's plain-text path
      // wraps render()'s return in `console.log`, which appends its OWN newline —
      // so we strip the generator's trailing newline here to emit exactly one,
      // keeping `aof upgrade --changelog` stdout byte-identical to the committed
      // artifact (so `--changelog > UPGRADE-CHANGELOG.md` round-trips and the
      // regenerate-and-diff drift check stays green). QA-40-04-1.
      if (result.changelog) return result.text.replace(/\n$/, "");
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
