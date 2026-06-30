// work:run-start — mint a new run for an item, ALREADY in `running` (ADR-001:
// work:run-start creates-and-begins; the operator triggers and runs in one step).
//
// A thin WRITE wrapper over story 00's src/run-store.mjs (the next.mjs-over-nextWork
// idiom). It resolves the target with `resolveItemExact` — NO slug fallback, so a
// typo'd/partial ref returns ref-not-found rather than writing a run to the wrong
// item (08/ADR-003 write-isolation, exactly as feedback does). The store performs
// every filesystem write under runs/ (ADR-002); this command never touches item
// frontmatter (status rollback is milestone 20). The result is the new running run
// record — records carry refs, NOT absolute paths, so there is no path projection.
import { resolveItemExact } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { startRun, reclaimStaleRuns } from "../run-store.mjs";
import { rollbackItemStatus } from "../work.mjs";

// The documented default staleness threshold for the restart-time reclaim scan
// (20/ADR-004 — the "missing-after-N" semantics): a `running` run idle this long with
// no heartbeat is treated as orphaned by a crash. Config overrides via
// work.autonomous.heartbeatStaleMs; the store reads no config (the resolved value is
// passed in). 15 minutes — long enough to never false-reclaim a healthy run.
const DEFAULT_HEARTBEAT_STALE_MS = 15 * 60 * 1000;

export const runStartCommand = {
  id: "work:run-start",
  input: {
    type: "object",
    properties: {
      ref: { type: "string" },
      sessionId: { type: "string" },
      brief: { type: "object" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";

    // The WRITE resolves by EXACT ref — never the free-text slug fallback the read
    // command tolerates. A typo'd/partial ref → ref-not-found, never the wrong item.
    const item = await resolveItemExact(ctx.workspace.workDir, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);

    // Restart-time reclaim (20/ADR-004): a run orphaned by a crash leaves a stale
    // `running` record that would wedge this restart (dedup would refuse the new mint).
    // Force-fail this item's stale runs FIRST (runtime_offline — retryable), then roll
    // each reclaimed item's status back so the stream is honest (best-effort). This is
    // "the work:run-start path picks it up"; the skill drives the wider scan (story 02).
    const stalenessThreshold = ctx.workspace?.config?.work?.autonomous?.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
    const reclaimed = await reclaimStaleRuns([item], { stalenessThreshold });
    for (const entry of reclaimed) {
      try {
        await rollbackItemStatus(entry.item, "not-started");
      } catch (error) {
        if (error.code !== "rollback-not-applicable") throw error;
      }
    }

    // The store mints the record (running, attempt 1, null outcome) and persists it
    // under the item's runs/ dir, returning it AS-IS. The dedup guard refuses a second
    // non-terminal run (the orphan is now terminal, so a genuine restart proceeds).
    return await startRun(item, { sessionId: input.sessionId ?? null, brief: input.brief ?? {} });
  },

  cli: {
    // `aof work run-start <ref> [--session …] [--brief '<json>']`. The brief arrives
    // as a JSON STRING on the CLI; the argv adapter parses it (undefined stays
    // undefined — an omitted --brief defaults to {} in run).
    argv: (positionals, options) => ({
      ref: positionals[0],
      sessionId: options.session,
      brief: parseBriefJson(options.brief),
    }),

    // Confirm the started run: the ref, the running state, the minted runId.
    render: (result) => `Started run ${result.runId} for ${result.itemRef} — state running.`,

    // No path in the result (records carry refs) — passes through unchanged.
    json: (result) => result,
  },
};

// Parse the --brief JSON string into the opaque object the store persists verbatim.
// An omitted --brief stays undefined (→ run defaults to {}); a present value is
// JSON.parsed so the structured brief round-trips byte-equivalent.
function parseBriefJson(raw) {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    // The CLI face surfaces an HONEST, structured error code (08/ADR-003) — not a raw
    // V8 parser message under a generic code:"error". --brief is operator input, so a
    // malformed value is a 400 input fault, mirroring feedback's coded input errors.
    throw commandError("--brief must be valid JSON.", "invalid-brief", 400);
  }
}
