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
import { resolveItemExact, requireLocalCheckout } from "./resolve.mjs";
import { commandError } from "../command-error.mjs";
import { transitionRunStart } from "../effects/run-transitions.mjs";
import { meshNodeIdOf } from "./mesh-gate.mjs";
// m43 / ADR-003 — the item-lock context. It rides `opts.lock`, NOT `opts.workspace`
// (ADR-010/R1.3), precisely so this verb's never-published-on-mutate posture is
// byte-unchanged: a lock check must not smuggle a propagation behaviour change into
// the verb it now sits in front of.
import { lockContextFor } from "../item-lock.mjs";

export const runRetryCommand = {
  id: "work:run-retry",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      runId: { type: "string" },
      maxAttempts: { type: "number" },
      // 348 auto-resume — the operator override for the PARK gate. A `session_limit`
      // prior is refused `retry-parked` until its stated reset passes; --force says
      // "go now" (the reset was wrong, or the limit lifted early). Nothing else is
      // overridden: not-retryable and attempts-exhausted still refuse.
      force: { type: "boolean" },
      // `now` (ISO-8601 UTC-Z) is an INJECTED clock for timestamp-deterministic
      // assertions (the 22/R2 white-box idiom — a test input, never a CLI flag).
      now: { type: "string" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";

    // The WRITE resolves by EXACT ref — never the free-text slug fallback the read
    // commands tolerate. A typo'd/partial ref → ref-not-found, never the wrong item.
    const item = await resolveItemExact(ctx, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    // m43 / story 06 (ADR-010/R6.4) — the resolver is cache-first, so a ref another node
    // owns now RESOLVES here. This door reads and rewrites run records under `item.dir`,
    // which is not on this node for such a ref: refuse coded (echoing the resolved ref, so
    // "resolved but not writable here" is distinguishable from "no such ref") and write
    // nothing. Never scaffold — that would mint a second authority for another node's item.
    requireLocalCheckout(item, ref);

    // The attempt ceiling is the resolved config value (work.autonomous.maxAttempts,
    // default 3 — the same value the aof:autonomous skill reads and --max-attempts
    // overrides); an explicit input.maxAttempts wins. The store reads no config — the
    // resolved ceiling is passed in (08/ADR-002 basis-neutral; 20/ADR-002).
    const maxAttempts = input.maxAttempts ?? ctx.workspace.config?.work?.autonomous?.maxAttempts ?? 3;

    // The `node` pass-through (m26/ADR-001 + ADR-004 consequences): when mesh is
    // configured, the retried run lands under THIS node's partition — the RETRIER
    // owns the new run; the lineage links via retryOf (the record carries its own
    // partition provenance). Unconfigured ⇒ null ⇒ the flat single-node mint,
    // byte-identical to today. The store never reads config — the id arrives as data
    // through the ONE shared gate predicate (mesh-gate.mjs).
    const meshNodeId = meshNodeIdOf(ctx.workspace.config);

    // The store resolves the prior run, consults shouldRetry, and mints the
    // lineage-linked run — letting its no-retryable-run / not-retryable /
    // attempts-exhausted / duplicate-run errors (each carrying .code) propagate.
    // The mint rides the run store's transition seam (m42 wave (d) leg d4, port
    // 1) so `run.started` is raised here as it is at every other mint site. NO
    // `workspace` is passed — this verb never published on mutate, so the
    // ledger's publish reactor skips on a null workspaceRoot and the behaviour is
    // byte-unchanged. (Whether a retry SHOULD propagate is a real question; it is
    // a behaviour change and is deliberately not smuggled into a mechanical port.)
    const { record } = await transitionRunStart(
      item,
      { mode: "retry", runId: input.runId, maxAttempts, now: input.now, node: meshNodeId, force: Boolean(input.force) },
      { lock: lockContextFor(ctx.workspace, ctx), journalOptions: ctx.effectsJournalOptions ?? {} },
    );
    return record;
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face; the cli.mjs face copy is deleted.
    route: ["work", "run-retry"],
    spec: {
      usage: "aof work run-retry <ref> [--run <runId>] [--max-attempts N] [--force] [--json]",
      flags: {
        run: { type: "string", description: "the prior runId to resume (defaults to the latest retryable)" },
        maxAttempts: { type: "string", description: "override the retry attempt ceiling" },
        force: { type: "boolean", description: "resume a parked (session_limit) run before its stated reset" },
      },
    },

    // `aof work run-retry <ref> [--run <runId>] [--max-attempts N] [--json]`.
    // The spec camelCases kebab flags, so --max-attempts arrives as maxAttempts.
    argv: (positionals, options) => ({
      ref: positionals[0],
      runId: options.run,
      maxAttempts: options.maxAttempts != null ? Number(options.maxAttempts) : undefined,
      ...(options.force ? { force: true } : {}),
    }),

    // Confirm the resumed run: the ref, the running state, the minted runId.
    render: (result) => `Resumed run ${result.runId} for ${result.itemRef} — state ${result.state} (attempt ${result.attempt}).`,

    // No path in the result (records carry refs) — passes through unchanged.
    json: (result) => result,
  },
};
