// work:run-retry — resume a retryable failed run's lineage (20/ADR-003).
//
// A thin WRITE wrapper over story 00's src/run-store.mjs:retryRun (the run-start.mjs
// idiom). resume-vs-fresh is a VERB distinction, not a flag: run-retry RESUMES (carries
// the prior sessionId, attempt + 1, retryOf linking the lineage); work:run-start stays
// FRESH (19/ADR-003). It resolves the target with `resolveItemExact` — NO slug fallback,
// so a typo'd/partial ref returns ref-not-found rather than retrying a run on the wrong
// item (08/ADR-003 write-isolation, exactly as run-start does). The store performs every
// filesystem write under runs/ (19/ADR-002) and is the single classification authority —
// this command never re-derives the retryable/non-retryable table; it surfaces the
// store's coded rejections (not-retryable / attempts-exhausted / no-retryable-run)
// unchanged. The result is the new running run record (records carry refs, not paths).
import { resolveItemExact } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { retryRun } from "../run-store.mjs";

export const runRetryCommand = {
  id: "work:run-retry",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      runId: { type: "string" },
      maxAttempts: { type: "number" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";

    // The WRITE resolves by EXACT ref — never the free-text slug fallback the read
    // commands tolerate. A typo'd/partial ref → ref-not-found, never the wrong item.
    const item = await resolveItemExact(ctx.workspace.workDir, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);

    // The attempt ceiling is the resolved config value (work.autonomous.maxAttempts,
    // default 3 — the same value the aof:autonomous skill reads and --max-attempts
    // overrides); an explicit input.maxAttempts wins. The store reads no config — the
    // resolved ceiling is passed in (08/ADR-002 basis-neutral; 20/ADR-002).
    const maxAttempts = input.maxAttempts ?? ctx.workspace.config?.work?.autonomous?.maxAttempts ?? 3;

    // The store resolves the prior run, consults shouldRetry, and mints the
    // lineage-linked run — letting its no-retryable-run / not-retryable /
    // attempts-exhausted / duplicate-run errors (each carrying .code) propagate.
    return await retryRun(item, { runId: input.runId, maxAttempts });
  },

  cli: {
    // `aof work run-retry <ref> [--run <runId>] [--max-attempts N] [--json]`.
    // parseOptions camelCases kebab flags, so --max-attempts arrives as maxAttempts.
    argv: (positionals, options) => ({
      ref: positionals[0],
      runId: options.run,
      maxAttempts: options.maxAttempts != null ? Number(options.maxAttempts) : undefined,
    }),

    // Confirm the resumed run: the ref, the running state, the minted runId.
    render: (result) => `Resumed run ${result.runId} for ${result.itemRef} — state ${result.state} (attempt ${result.attempt}).`,

    // No path in the result (records carry refs) — passes through unchanged.
    json: (result) => result,
  },
};
