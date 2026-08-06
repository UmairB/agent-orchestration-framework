// work:run-start — mint a new run for an item, ALREADY in `running` (19/ADR-001:
// work:run-start creates-and-begins; the operator triggers and runs in one step).
//
// Mesh no longer takes a git-bus lease before minting. A mesh-configured run carries
// this machine node id on the run record, then publishes the workspace snapshot into
// the global mesh store for WebSocket/backstop propagation.
import { readdir } from "node:fs/promises";
import { resolveItemExact, requireLocalCheckout } from "./resolve.mjs";
// m43 / story 06 (ADR-005) — the fleet sweep below is a CONTROL-SIDE read and migrates onto
// the cache-first seam; `localItemsOnly` is the shared reach-through filter, because the
// sweep reads run RECORDS out of each candidate's folder and a cache-answered row has none.
import { listItemsCacheFirst, localItemsOnly, reportReachThroughSkips } from "../work-read.mjs";
import { commandError } from "../command-error.mjs";
import { readRuns, runsDir, shouldRetry } from "../run-store.mjs";
import { isNodeStale, resolveStalenessSeconds, readPresenceRecord } from "../mesh-presence.mjs";
import { meshNodeIdOf } from "./mesh-gate.mjs";
import { transitionRunStart, transitionStaleRunsReclaimed } from "../effects/run-transitions.mjs";
import { renderWithPropagationWarnings, threadPropagationWarnings } from "../global-work-publisher.mjs";
// m43 / ADR-003 — the item-lock CONTEXT this verb hands the mint seam. The seam owns
// the refusal; this command owns only the two facts it already has (its resolved
// workspace identity, and the fact that a hand-typed mint carries no assignment).
import { lockContextFor } from "../item-lock.mjs";

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
      // `now` (ISO-8601 UTC-Z) is an INJECTED clock (the mesh:heartbeat/mesh:status
      // white-box idiom, 22/R2 — a test input, never a CLI flag): it drives the claim
      // stamp, the reclaim scan, and the deterministic runId; absent ⇒ wall-clock.
      now: { type: "string" },
    },
    required: ["ref"],
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ref = typeof input.ref === "string" ? input.ref.trim() : "";

    // The WRITE resolves by EXACT ref — never the free-text slug fallback the read
    // command tolerates. A typo'd/partial ref → ref-not-found, never the wrong item.
    const item = await resolveItemExact(ctx, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);
    // m43 / story 06 (ADR-010/R6.4) — the SECOND door that writes through `item.dir`: a run
    // record is minted under it. A ref that resolves only from the cache has no folder here,
    // and minting one would create a second authority for an item another node owns — the
    // disease, reintroduced by the cure. Refuse coded, before the reclaim scan or any write.
    requireLocalCheckout(item, ref);

    const ws = ctx.workspace;
    const config = ws.config ?? {};
    // THE CONFIG GATE (ADR-004/ADR-006) — the ONE shared predicate (mesh-gate.mjs):
    // the mesh branch exists only for a mesh-configured install. With no
    // config.mesh.nodeId every mesh step below is skipped and the command is
    // byte-identical to today's single-node run-start.
    const meshNodeId = meshNodeIdOf(config);
    const nowIso = typeof input.now === "string" && input.now.length > 0 ? input.now : new Date().toISOString();

    // (0) Restart-time reclaim (20/ADR-004), fleet-widened under mesh (26/ADR-006): a
    // run orphaned by a crash leaves a stale `running` record that would wedge a
    // restart (dedup would refuse the new mint) — and on a fleet, a CRASHED PEER's
    // orphan would wedge its item for everyone. Build the scan set, then settle each
    // stale run through the ONE reclaim edge. The status rollback that used to be an
    // inline loop HERE (a hand copy of the ledger's rollback-status reactor, and the
    // half the control tick never had) is now the declared cascade of the
    // `run.completed` a reclaim raises — m42 wave (d) leg d4, port 2.
    const stalenessThreshold = config.work?.autonomous?.heartbeatStaleMs ?? DEFAULT_HEARTBEAT_STALE_MS;
    const scanSet = [];
    if (meshNodeId) {
      // THE DUAL-STALENESS PREFILTER (ADR-006.2/6.3 — orchestration; the store stays
      // fleet-blind): presence has PRECEDENCE. Only a run owned by an affirmatively
      // presence-STALE peer may reach the scan; the scan's own heartbeat gate
      // (unchanged) is the second half of the dual guard.
      const nowMs = Date.parse(nowIso);
      const presenceThresholdMs = resolveStalenessSeconds(config) * 1000;
      const presenceByNode = new Map();
      const ownerIsStale = async (node) => {
        if (!presenceByNode.has(node)) presenceByNode.set(node, await readPresenceRecord(ws, node));
        const presence = presenceByNode.get(node);
        // No presence record ⇒ UNKNOWN liveness, not staleness (the m23 lock) —
        // hands off, the KR2-safe direction. Fresh ⇒ hands off, unconditionally.
        if (presence == null || typeof presence.heartbeatAt !== "string") return false;
        return isNodeStale(presence, nowMs, presenceThresholdMs);
      };
      // The cheap prefilter floor: FOREIGN runs live ONLY under runs/<node>/ (the
      // record→path invariant, 26/ADR-001.3), so an item whose runs/ dir carries no
      // foreign node subdir cannot hold a peer's run — one readdir stat, ZERO record
      // parses, cuts the hot path from O(total runs) parses to O(items) stats.
      const hasForeignPartition = async (candidate) => {
        let entries = [];
        try {
          entries = await readdir(runsDir(candidate), { withFileTypes: true });
        } catch {
          return false; // no runs/ dir ⇒ no runs at all — absence is benign
        }
        return entries.some((entry) => entry.isDirectory() && entry.name !== meshNodeId);
      };

      // The STARTED item keeps today's local scan (own/flat runs — heartbeat rules
      // alone; presence is never consulted for oneself) UNLESS its in-flight run is
      // owned by a hands-off peer (fresh/unknown presence ⇒ the item leaves the scan;
      // the dedup guard will refuse the mint — the item is being worked elsewhere).
      let includeStarted = true;
      if (await hasForeignPartition(item)) {
        for (const run of await readRuns(item)) {
          if (run.state !== "running") continue;
          if (run.node == null || run.node === meshNodeId) continue; // own/flat — local rules
          if (!(await ownerIsStale(run.node))) {
            includeStarted = false;
            break;
          }
        }
      }
      if (includeStarted) scanSet.push(item);

      // The FLEET SWEEP (ADR-006.1 — reclaim happens when ANY node seeks work; no
      // daemon, no new verb): any OTHER item whose in-flight run is owned by a
      // presence-stale peer joins the scan. This node's own runs on other items are
      // EXCLUDED (they stay under the local scan's existing rules).
      // m43 / story 06 — the sweep's candidate set is now the CACHE-FIRST one, so a peer's
      // orphaned run on an item this checkout has never held is visible to the reclaim at
      // all. Its reach-through obligation is uniform with every other leaf's: a row whose
      // folder is not on this node is SKIPPED, never faulted on and never given a fabricated
      // `runs/` path (ADR-010/R6.4). Nothing is lost by skipping — a run record this node
      // cannot read is one it could not reclaim either.
      const swept = localItemsOnly(await listItemsCacheFirst(ws, { globalWorkStoreOptions: ctx.globalWorkStoreOptions ?? {} }));
      // Reported, not swallowed — a run record is a frozen shape with nowhere to carry it,
      // so the durable degrade sink is where the skip is answerable (rule 2 of the seam).
      reportReachThroughSkips("work:run-start fleet sweep", swept.skipped);
      for (const candidate of swept.items) {
        if (candidate.ref === item.ref) continue;
        if (!(await hasForeignPartition(candidate))) continue; // zero parses on the common path
        for (const run of await readRuns(candidate)) {
          if (run.state !== "running") continue;
          if (run.node == null || run.node === meshNodeId) continue;
          if (await ownerIsStale(run.node)) {
            scanSet.push(candidate);
            break;
          }
        }
      }
    } else {
      // Unconfigured mesh ⇒ today's local [item] scan — the WHOLE of it (ADR-006.1).
      scanSet.push(item);
    }
    // The transition-seam options both of this command's edges use. `workspace` is
    // what makes the publish reactor reachable for this workspace's cascades (the
    // seam's callers that never propagated pass none); `publisherOptions` carries
    // the command ctx's established publisher injection seam to the reactor.
    //
    // `lock` is m43/ADR-003's item-lock context and is a SEPARATE opt from
    // `workspace` on purpose (ADR-010/R1.3). The workspaceId comes from this
    // command's already-resolved workspace — never from `item.dir` (TECH_DEBT item 4).
    // `byAssignment: null`: an operator's local mint carries no assignment identity,
    // so it is refused whenever any active assignment covers the item's execution
    // scope — there is no flag on this verb that could ever pass one.
    const seamOpts = {
      workspace: ws,
      lock: lockContextFor(ws, ctx),
      publisherOptions: ctx,
      journalOptions: ctx.effectsJournalOptions ?? {},
    };
    await transitionStaleRunsReclaimed(scanSet, { now: nowIso, stalenessThreshold }, seamOpts);

    // Mesh no longer uses the retired git-bus lease/sync path. A mesh-configured node
    // still stamps its run record with the machine node id; visibility and convergence
    // ride the global work projection plus the WebSocket stream/backstop.
    //
    // THE MINT rides the run store's transition seam (m42 wave (d) leg d4, port
    // 1): the fact is written, `run.started` is appended to the per-node journal,
    // and its declared local-locus cascade — publish-projection, which this
    // command used to remember as its own `withGlobalWorkPropagation` import —
    // drains synchronously before we return.
    if (!meshNodeId) {
      const { record, effects } = await transitionRunStart(
        item,
        { sessionId: input.sessionId ?? null, brief: input.brief ?? {}, now: input.now },
        seamOpts,
      );
      return threadPropagationWarnings(record, effects);
    }

    const runs = await readRuns(item);
    const latest = runs.length > 0 ? runs[runs.length - 1] : null;
    const reclaimedPrior =
      latest != null && latest.state === "failed" && latest.failureReason === "runtime_offline" && latest.reclaimedAt != null
        ? latest
        : null;
    const maxAttempts = config.work?.autonomous?.maxAttempts ?? 3;
    const edge =
      reclaimedPrior != null && shouldRetry(reclaimedPrior, maxAttempts)
        ? { mode: "retry", runId: reclaimedPrior.runId, maxAttempts, brief: input.brief, now: nowIso, node: meshNodeId, sessionId: input.sessionId ?? null }
        : { sessionId: input.sessionId ?? null, brief: input.brief ?? {}, now: nowIso, node: meshNodeId };

    const { record, effects } = await transitionRunStart(item, edge, seamOpts);
    return threadPropagationWarnings(record, effects);
  },

  cli: {
    // m42 wave (d) leg d1 (wave 2) — routed through the registry-derived table +
    // the ONE generic face (whose --json single-envelope discipline IS the retired
    // runVerbCli's); the cli.mjs face copy is deleted.
    route: ["work", "run-start"],
    spec: {
      usage: "aof work run-start <ref> [--session <id>] [--brief '<json>'] [--json]",
      flags: {
        session: { type: "string", description: "the initiating session id" },
        brief: { type: "string", description: "opaque JSON brief persisted on the run" },
      },
    },

    // `aof work run-start <ref> [--session …] [--brief '<json>']`. The brief arrives
    // as a JSON STRING on the CLI; the argv adapter parses it (undefined stays
    // undefined — an omitted --brief defaults to {} in run). `now` is a white-box
    // test input, never a CLI flag.
    argv: (positionals, options) => ({
      ref: positionals[0],
      sessionId: options.session,
      brief: parseBriefJson(options.brief),
    }),

    // Confirm the started run: the ref, the running state, and the minted runId.
    render: (result) => renderWithPropagationWarnings(`Started run ${result.runId} for ${result.itemRef} — state running.`, result),

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
