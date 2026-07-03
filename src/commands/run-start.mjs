// work:run-start — mint a new run for an item, ALREADY in `running` (19/ADR-001:
// work:run-start creates-and-begins; the operator triggers and runs in one step).
//
// A thin WRITE wrapper over story 00's src/run-store.mjs (the next.mjs-over-nextWork
// idiom). It resolves the target with `resolveItemExact` — NO slug fallback, so a
// typo'd/partial ref returns ref-not-found rather than writing a run to the wrong
// item (08/ADR-003 write-isolation, exactly as feedback does). The store performs
// every filesystem write under runs/ (19/ADR-002); this command never touches item
// frontmatter (status rollback rides the work.mjs writer, 20/ADR-005). The result is
// the new running run record — records carry refs, NOT absolute paths — or, on the
// mesh path, the stood-down envelope when the lease race is lost.
//
// MILESTONE 26 — THE A2 JOIN (ADR-004.3 + ADR-006, composed HERE so the frozen
// sequence is greppable in ONE file — the 20/ADR-005 command-orchestrates precedent):
//
//   (0) the FLEET-RECLAIM PREFILTER (ADR-006) — the m20 restart scan, widened BY
//       ARGUMENT under the config.mesh gate: the scan set is [item] (today's local
//       scan, byte-identical, and the WHOLE of it when mesh is unconfigured) PLUS any
//       item whose in-flight run is owned by a PRESENCE-STALE peer (isNodeStale —
//       presence wins: a fresh-presence peer is hands-off UNCONDITIONALLY; a peer
//       with NO presence record is UNKNOWN liveness, hands-off too; this node's own
//       runs on OTHER items stay under their own restart scan). reclaimStaleRuns is
//       UNCHANGED (its run-heartbeat half is the second staleness gate — dual
//       staleness), and the rollbackItemStatus loop is 20/ADR-005 verbatim.
//   (1)+(2) CLAIM-WRITE → INTENT → SYNC (the FROZEN ADR-004.3 order): acquireLease
//       (ADR-003, story 01's mechanics) performs the durable own-path claim write,
//       fires the injected onClaimWritten hook — where THIS command pushes the
//       best-effort relay intent, caught NEVER thrown (fitness #9,
//       acd-claim-relay-independent), so peers hear the intent BEFORE the first sync
//       round (under contention the sync loop is at its slowest — the intent must
//       not wait for it) — then runs the authoritative git sync and decides
//       hold/stand-down from git observation ONLY, over runSync = syncMesh(ws,
//       { roots: [meshDir, runsPathspec] }) (the story-00 mesh-aware root set). A
//       relay failure is swallowed — arbitration falls to the git cadence; the
//       claim and the sync are never gated or undone by the relay.
//   (3) RESOLVE — held ⇒ mint WITH this node's id (the run lands under its
//       partition) + the runId tie-back onto the OWN claim file (mesh-lease's
//       tieClaimToRun — the seam WRITES, this command ORCHESTRATES, 20/ADR-005);
//       stood down ⇒ mint NOTHING, return { state:"stood-down", heldBy }. The
//       reclaimed-lineage refinement (ADR-006.4): when the item's latest run is a
//       reclaimed runtime_offline failure that is still retryable, the mint rides
//       retryRun so the new run carries retryOf → the reclaimed run — the crash is
//       visible in the lineage (and NEVER the dead peer's sessionId: the winner's
//       own input session, or null, rides the sessionId override).
import { readdir } from "node:fs/promises";
import { resolveItemExact } from "./resolve.mjs";
import { commandError } from "./errors.mjs";
import { startRun, retryRun, reclaimStaleRuns, readRuns, runsDir, shouldRetry } from "../run-store.mjs";
import { rollbackItemStatus, listItems } from "../work.mjs";
import { meshDir } from "../mesh-store.mjs";
import { syncMesh, runsPathspec } from "../mesh-sync.mjs";
// The lease mechanics + the lease↔run tie-back: the tie is a LEASE write, so it lives
// in mesh-lease.mjs (ONE lease-write home, ADR-003's claim-write module) — this
// command carries NO write verb of its own (20/ADR-005: commands ORCHESTRATE, the
// owning seam WRITES).
import { acquireLease, tieClaimToRun } from "../mesh-lease.mjs";
import { isNodeStale, resolveStalenessSeconds, readPresenceRecord } from "../mesh-presence.mjs";
import { createRelayClient, pushLeaseSignal, leaseRelayEnvelope } from "../mesh-relay-client.mjs";
import { aofVersion } from "./mesh-identity.mjs";
import { meshNodeIdOf } from "./mesh-gate.mjs";

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
    const item = await resolveItemExact(ctx.workspace.workDir, ref);
    if (!item) throw commandError(`No item resolves to ref "${ref}".`, "ref-not-found", 404);

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
    // orphan would wedge its item for everyone. Build the scan set, force-fail the
    // stale runs (runtime_offline — retryable), then roll each reclaimed item's
    // status back so the stream is honest (best-effort, 20/ADR-005 verbatim).
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
      for (const candidate of await listItems(ws.workDir)) {
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
    const reclaimed = await reclaimStaleRuns(scanSet, { now: nowIso, stalenessThreshold });
    for (const entry of reclaimed) {
      try {
        await rollbackItemStatus(entry.item, "not-started");
      } catch (error) {
        if (error.code !== "rollback-not-applicable") throw error;
      }
    }

    // THE UNCONFIGURED FLOOR (SPEC §Scope): no mesh ⇒ no lease read, no lease write,
    // no relay — the store mints the flat record exactly as today (the dedup guard
    // refuses a second non-terminal run; the orphan above is now terminal, so a
    // genuine restart proceeds).
    if (!meshNodeId) {
      return await startRun(item, { sessionId: input.sessionId ?? null, brief: input.brief ?? {}, now: input.now });
    }

    // (1)+(2) ACQUIRE with the intent riding the FROZEN slot (ADR-004.3:
    // claim-write → intent → sync — arbitration from git observation ONLY):
    // acquireLease writes the durable own-path claim, fires onClaimWritten — where
    // the best-effort relay intent goes out BEFORE the first sync round, so peers
    // defer within relay latency (~ms), not a sync round (~seconds under contention)
    // — then syncs (commit → pull → push over the mesh-aware root set so claims AND
    // run records ride the tick) and decides hold/stand-down. The client is the
    // INJECTED ctx.relayClient (tests stub the four relay states) or the production
    // client from config (null when unconfigured ⇒ the push is SKIPPED, not
    // attempted). The push failure is SWALLOWED — the try/catch lives HERE, lexically
    // on the claim path (fitness #9, acd-claim-relay-independent): a relay failure
    // never propagates, never gates the claim, never blocks the sync. The claim
    // write + sync are NOT nested in any relay branch — the hook is a slot INSIDE
    // the acquire, so the relay grant can never outrank the git win.
    const runSync = () => syncMesh(ws, { roots: [meshDir(ws), runsPathspec(ws)] });
    const relayClient = ctx?.relayClient !== undefined ? ctx.relayClient : createRelayClient(config);
    const lease = await acquireLease(ws, item.ref, meshNodeId, {
      runSync,
      now: nowIso,
      config,
      aofVersion: aofVersion(),
      onClaimWritten: async (claim) => {
        try {
          await pushLeaseSignal(relayClient, leaseRelayEnvelope(meshNodeId, claim));
        } catch {
          // best-effort — swallowed: liveness lost, data safe; arbitration falls to
          // the git cadence (the relay grant is worth nothing without the git win).
        }
      },
    });

    // (3) RESOLVE — stand down ⇒ mint NOTHING (ADR-003 step e: defeat and ambiguity
    // fail CLOSED; two losers is a liveness hiccup, two winners is the KR2 violation).
    // The result names the holding peer so the operator/skill can move on.
    if (!lease.held) {
      return { itemRef: item.ref, state: "stood-down", stoodDown: true, heldBy: lease.heldBy ?? null };
    }

    // HELD — mint WITH this node's id (26/ADR-001: the record carries its partition
    // provenance; the store derives placement FROM the record). THE RECLAIMED-LINEAGE
    // REFINEMENT (ADR-006.4 — a scoped refinement of the 19/ADR-003 fresh-verb rule,
    // mesh-configured + reclaimed-retryable prior ONLY): when the item's latest run is
    // a reclaimed runtime_offline failure still inside the attempt ceiling, the mint
    // rides retryRun so the new run carries retryOf → the reclaimed run (the crash is
    // visible in the lineage, not erased by it). Otherwise the fresh startRun mint.
    const runs = await readRuns(item);
    const latest = runs.length > 0 ? runs[runs.length - 1] : null;
    const reclaimedPrior =
      latest != null && latest.state === "failed" && latest.failureReason === "runtime_offline" && latest.reclaimedAt != null
        ? latest
        : null;
    const maxAttempts = config.work?.autonomous?.maxAttempts ?? 3;
    // The sessionId OVERRIDE on the reclaimed lineage (the sanctioned retryRun
    // co-edit's second half): the lineage mint must NEVER carry the DEAD PEER's
    // sessionId across hosts (same-node resume semantics do not cross machines) —
    // the winner's own input session rides, or null.
    const record =
      reclaimedPrior != null && shouldRetry(reclaimedPrior, maxAttempts)
        ? await retryRun(item, { runId: reclaimedPrior.runId, maxAttempts, brief: input.brief, now: nowIso, node: meshNodeId, sessionId: input.sessionId ?? null })
        : await startRun(item, { sessionId: input.sessionId ?? null, brief: input.brief ?? {}, now: nowIso, node: meshNodeId });

    // The runId TIE-BACK (ADR-003.1): the lease↔run tie every reader consumes — an
    // OWN-PATH state write on THIS node's claim file, delegated to mesh-lease's
    // tieClaimToRun (the seam WRITES, this command ORCHESTRATES — 20/ADR-005; never
    // a foreign write; the tie rides the next sync tick to the fleet).
    await tieClaimToRun(ws, item.ref, meshNodeId, record.runId);

    return record;
  },

  cli: {
    // `aof work run-start <ref> [--session …] [--brief '<json>']`. The brief arrives
    // as a JSON STRING on the CLI; the argv adapter parses it (undefined stays
    // undefined — an omitted --brief defaults to {} in run). `now` is a white-box
    // test input, never a CLI flag.
    argv: (positionals, options) => ({
      ref: positionals[0],
      sessionId: options.session,
      brief: parseBriefJson(options.brief),
    }),

    // Confirm the started run: the ref, the running state, the minted runId — or the
    // honest stood-down line when the lease race was lost (mesh path only).
    render: (result) =>
      result?.stoodDown === true
        ? `Stood down for ${result.itemRef} — leased by ${result.heldBy ?? "another node"}; no run minted.`
        : `Started run ${result.runId} for ${result.itemRef} — state running.`,

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
