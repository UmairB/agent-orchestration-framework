// mesh:heartbeat — the one-shot presence PUBLISH command (milestone 23 / stories 00 + 02,
// ADR-002 + ADR-003). Thin over src/mesh-presence.mjs (the record assembly + the
// activeRuns read of the run records + the atomic publish via the m22-reserved
// presenceRecordPath) and the node-identity id resolution (src/node-identity.mjs +
// mesh-identity's salt/version idiom), carrying the frozen { id, input, run, cli }
// contract (08/ADR-002).
//
//   mesh:heartbeat — assemble THIS node's presence record (its stable nodeId, the
//                    heartbeat instant, its in-flight run ids READ from the run records,
//                    its aof version) and PUBLISH it over BOTH buses in a structurally-
//                    frozen order: write git UNCONDITIONALLY first (the durable floor),
//                    then push the relay BEST-EFFORT second (the accelerator), returning
//                    the published record + the relay-push outcome (a republish bumps
//                    heartbeatAt; nodeId is stable; a peer's record is untouched).
//
// THE TWO-PUBLISH PATH (story 02 / ADR-003 / fitness #4 — acd-presence-relay-independent
// is a SOURCE grep of EXACTLY this shape):
//
//     await publishPresenceRecord(ws, nodeId, record);   // git, UNCONDITIONAL — the floor
//     try {
//       await pushPresenceSignal(relayClient, envelope); // relay, BEST-EFFORT — accelerator
//     } catch (err) {
//       // liveness lost, data safe — NEVER rethrown; recorded as a non-fatal best-effort
//       //   failure in the result so the heartbeat is exit-0 regardless of relay state.
//     }
//
// The git write is NOT inside any relay-success branch and NOT guarded by relay
// reachability — it ALWAYS runs (the durable, payload-agnostic-synced path, story 00).
// The relay push is wrapped in a try/catch that SWALLOWS the throw: no relay configured ⇒
// skip; relay unreachable ⇒ catch + continue; push error ⇒ catch + continue. A relay
// failure NEVER propagates to the heartbeat result and NEVER undoes the git write — the
// structural form of graceful degradation to git-only (data safe, liveness lost).
//
// THE INJECTED RELAY-CLIENT SEAM (the @executable feasibility lever): the relay client is
// taken from ctx.relayClient when present (tests inject a stub so the four relay states —
// up / down-connect-throws / unconfigured / push-throws — are reachable with NO real ws
// server); otherwise the production client is built from config (null when unconfigured).
//
// It writes ONLY through the presence seam (presenceRecordPath/meshDir) via the atomic
// writeText seam, and references ZERO record-doc filename (the write-scope guard, fitness
// #3 / acd-presence-write-scope — story 00's, untouched). The activeRuns read is a READ
// of the run records — it mutates no run record.
import os from "node:os";
import { listItems } from "../work.mjs";
import { aofVersion, resolveInstallSalt } from "./mesh-identity.mjs";
import { deriveNodeId } from "../node-identity.mjs";
import {
  assemblePresenceRecord,
  readActiveRuns,
  publishPresenceRecord,
} from "../mesh-presence.mjs";
// The node-side relay client (story 02): the best-effort push + the frozen envelope
// builder + the production client factory. The push is the ACCELERATOR — the catch below
// keeps it from ever gating the git write.
import {
  createRelayClient,
  pushPresenceSignal,
  relayEnvelope,
} from "../mesh-relay-client.mjs";

export const meshHeartbeatCommand = {
  id: "mesh:heartbeat",
  input: {
    type: "object",
    // An INJECTED heartbeat instant (ISO-8601 UTC-Z) for white-box byte-equivalence +
    // rebuildability (the 22/R2 inject-the-clock discipline); absent ⇒ wall-clock.
    properties: { now: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    const config = ws.config ?? {};

    // Resolve THIS node's STABLE id the SAME way mesh:identity does — a pinned
    // config.mesh.nodeId wins verbatim (deriveNodeId returns it), so heartbeat and
    // identity carry the SAME id; a never-published node derives + persists a stable id.
    const salt = await resolveInstallSalt(ws.configPath, config);
    const nodeId = await deriveNodeId({
      config,
      hostname: os.hostname(),
      salt,
      configPath: ws.configPath,
    });

    // activeRuns is a READ of the run records across the work items (the 23 → 20 → 19
    // seam) — readActiveRuns enumerates every item's runs/ and filters to running. It
    // calls no write/transition verb, so a heartbeat leaves every run record unchanged.
    const items = await listItems(ws.workDir);
    const activeRuns = await readActiveRuns(items);

    // The heartbeat instant — the injected now (white-box) or wall-clock, UTC-Z.
    const heartbeatAt = typeof input?.now === "string" && input.now.length > 0 ? input.now : new Date().toISOString();

    // Assemble the frozen-schema record.
    const record = assemblePresenceRecord({ nodeId, heartbeatAt, activeRuns, aofVersion: aofVersion() });

    // (1) GIT, UNCONDITIONAL — the durable floor (story 00 / ADR-002). This write is NOT
    // inside any relay branch and NOT guarded by relay reachability: it ALWAYS runs, so a
    // peer reads this node's presence over git even with the relay dead (poll-for-
    // durability). The bytes are identical whatever the relay does (the byte-identical
    // baseline, task 00's invariant matrix).
    await publishPresenceRecord(ws, nodeId, record);

    // (2) RELAY, BEST-EFFORT — the accelerator (story 02 / ADR-003). The relay client is
    // the INJECTED ctx.relayClient (tests stub the four relay states) or the production
    // client built from config (null when unconfigured ⇒ the push is SKIPPED, not
    // attempted). The push is wrapped in a try/catch that SWALLOWS the throw: a relay-
    // absent / connect-fail / push-fail is CAUGHT, never thrown — the heartbeat succeeds
    // regardless of relay state (exit-0). The outcome rides the result as a non-fatal
    // best-effort field (relayPushed / relayError) so a caller can see whether liveness
    // resumed — it NEVER reds the heartbeat.
    const relayClient = ctx?.relayClient !== undefined ? ctx.relayClient : createRelayClient(config);
    const envelope = relayEnvelope(nodeId, record);
    let relayPushed = false;
    let relayAttempted = false;
    let relayError = null;
    try {
      const outcome = await pushPresenceSignal(relayClient, envelope);
      // An unconfigured client SKIPS (not attempted); a configured client ATTEMPTS and,
      // on the happy path, PUSHES. `skipped` distinguishes "skip" from "attempt + catch".
      relayPushed = outcome.pushed === true;
      relayAttempted = outcome.skipped !== true;
    } catch (err) {
      // liveness lost, data safe — NEVER rethrown. The push was ATTEMPTED (a configured
      // relay that failed mid-connect/mid-send), and the error is recorded as a non-fatal
      // best-effort failure the result reports.
      relayAttempted = true;
      relayError = err instanceof Error ? err.message : String(err);
    }

    // The result IS the frozen-schema record (the four enumerable keys — story 00's
    // contract: Object.keys === the frozen schema, JSON.stringify byte-identical, the
    // returned record === the persisted bytes). The best-effort relay outcome rides as a
    // NON-ENUMERABLE `relay` property so it is READABLE (task 00: "the result reports the
    // relay push as a non-fatal best-effort failure") yet INVISIBLE to Object.keys /
    // JSON.stringify (so the persisted/returned record stays the byte-identical baseline
    // across every relay state — the durable write never depends on relay state). The
    // command SUCCEEDS regardless of relay state; relay.error is non-null only on a caught
    // best-effort failure.
    Object.defineProperty(record, "relay", {
      value: { pushed: relayPushed, attempted: relayAttempted, error: relayError },
      enumerable: false,
      writable: false,
      configurable: false,
    });
    return record;
  },

  cli: {
    // `aof mesh heartbeat` — no positional (it publishes THIS node, not a named ref).
    argv: () => ({}),

    // The publish confirmation names the node id + its in-flight count.
    render(result) {
      if (result == null) return "No presence record.";
      return `Heartbeat ${result.nodeId} — ${result.activeRuns.length} active run(s) at ${result.heartbeatAt}`;
    },

    // The --json face is the bare presence record.
    json: (result) => result,
  },
};
