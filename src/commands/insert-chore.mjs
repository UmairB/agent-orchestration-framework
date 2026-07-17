// work:insert-chore — place a new chore at a target position P in the TOP-LEVEL
// number space (ARCHITECTURE ADR-002/ADR-005, mirrored from insert-milestone.mjs /
// insert-uat.mjs). A THIN wrapper over insert-shared.mjs's runInsertTopLevel — the
// SAME engine insert-milestone/insert-uat/insert-story call — reusing the existing
// scaffold seam, never a bespoke writer (39/ADR-001, feasibility flag 4). A chore
// is a top-level DRIVER (milestone 37): it groups no stories and carries no
// depends-framing concept, exactly like insert-milestone.
import { runInsertTopLevel } from "./insert-shared.mjs";

export const insertChoreCommand = {
  id: "work:insert-chore",
  input: {
    type: "object",
    properties: {
      slug: { type: "string" },
      at: { type: ["number", "string"] },
      yes: { type: "boolean" },
      today: { type: "string" },
    },
    required: ["slug", "at"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    return await runInsertTopLevel(ctx, {
      type: "chore",
      slug: input.slug,
      at: input.at,
      yes: Boolean(input.yes),
      today: input.today,
    });
  },

  cli: {
    // `aof work insert-chore <slug> --at <P> [--yes|--force] [--json]`.
    argv: (positionals, options) => ({
      slug: positionals[0],
      at: options.at,
      yes: Boolean(options.yes || options.force),
    }),

    render(result) {
      return `Inserted chore "${result.created.slug}" at ${result.created.ref} (shifted ${result.shifted} item(s)).`;
    },

    // The --json envelope: ADR-004's { shifted, at, space } plus ADR-006's
    // created identity echo. insert-chore reports no depends (created carries no
    // `depends` key at all — same framing parity as insert-milestone).
    json: (result) => result,
  },
};
