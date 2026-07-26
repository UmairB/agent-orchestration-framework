// work:insert-uat — place a new uat acceptance session at a target position P in
// the TOP-LEVEL number space (ARCHITECTURE ADR-002/ADR-005). A thin wrapper over
// insert-shared.mjs's runInsertTopLevel, mirroring commands/validate.mjs's
// thin-over-engine shape. The ONE difference from insert-milestone: `--depends`
// authors the new session's `depends:` frontmatter, renumbered against the
// POST-shift stream (ADR-006 depends-framing rule — see insert-shared.mjs).
import { runInsertTopLevel } from "./insert-shared.mjs";

export const insertUatCommand = {
  id: "work:insert-uat",
  input: {
    type: "object",
    properties: {
      slug: { type: "string" },
      at: { type: ["number", "string"] },
      yes: { type: "boolean" },
      depends: { type: "string" },
      today: { type: "string" },
    },
    required: ["slug", "at"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    return await runInsertTopLevel(ctx, {
      type: "uat",
      slug: input.slug,
      at: input.at,
      yes: Boolean(input.yes),
      today: input.today,
      dependsInput: input.depends,
    });
  },

  cli: {
    // `aof work insert-uat <slug> --at <P> [--depends a,b] [--yes|--force] [--json]`.
    argv: (positionals, options) => ({
      slug: positionals[0],
      at: options.at,
      yes: Boolean(options.yes || options.force),
      depends: options.depends,
    }),

    render(result) {
      const depends = Array.isArray(result.created.depends) ? result.created.depends.join(", ") : "";
      return `Inserted uat "${result.created.slug}" at ${result.created.ref}${depends ? ` (depends: [${depends}])` : ""} (shifted ${result.shifted} item(s)).`;
    },

    // ADR-004's { shifted, at, space } plus ADR-006's created identity echo,
    // INCLUDING created.depends — the black-box channel the depends-framing
    // scenarios read (find/validate never surface depends).
    json: (result) => result,
  },
};
