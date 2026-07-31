// mesh:heartbeat — the one-shot presence PUBLISH command (milestone 23 / story 00,
// ADR-002; the relay push RETIRED milestone 33 / story 01, ADR-002.1). Thin over
// src/mesh-presence.mjs (the record assembly + the activeRuns read of the run records +
// the atomic publish via the m22-reserved presenceRecordPath) and the node-identity id
// resolution (src/node-identity.mjs + mesh-identity's salt/version idiom), carrying the
// frozen { id, input, run, cli } contract (08/ADR-002).
//
//   mesh:heartbeat — assemble THIS node's presence record (its stable nodeId, the
//                    heartbeat instant, its in-flight run ids READ from the run records,
//                    its aof version) and PUBLISH it to git — the durable floor (a
//                    republish bumps heartbeatAt; nodeId is stable; a peer's record is
//                    untouched).
//
// THE RELAY PUSH IS RETIRED (milestone 33 / story 01, ADR-002.1 — F-3204): the ws@8
// broker is eliminated as the presence/liveness transport; the fabric peer-map
// (src/mesh-fabric.mjs's resolvePeers) is the fast liveness read now, consumed by
// mesh:status (src/commands/mesh-identity.mjs), not pushed here. This command performs
// ONLY the git write — UNCONDITIONAL, the durable floor (story 00) — with NO relay
// push side and NO createRelayClient/pushPresenceSignal import.
//
// It writes ONLY through the presence seam (presenceRecordPath/meshDir) via the atomic
// writeText seam, and references ZERO record-doc filename (the write-scope guard, fitness
// #3 / acd-presence-write-scope — story 00's, untouched). The activeRuns read is a READ
// of the run records — it mutates no run record.
import os from "node:os";
import { listItems } from "../work.mjs";
import { resolveInstallSalt } from "./mesh-identity.mjs";
import { packageVersionString } from "../asset-base.mjs";
import { deriveNodeId, sidecarPathFor } from "../node-identity.mjs";
import { MESH_WORKSPACE_FLAG, guardMeshPositionals } from "./mesh-face-shared.mjs";
import {
  assemblePresenceRecord,
  readActiveRuns,
  publishPresenceRecord,
} from "../mesh-presence.mjs";

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
    // identity carry the SAME id; a never-published node derives + persists a stable
    // id to the git-ignored sidecar (ADR-004.2, F-3203) — never the committed config.
    // The machine-wide identity home (34/story 00) — ws.identityPath (global, resolved
    // by loadWorkspace from AOF_GLOBAL_HOME); a synthetic workspace falls back to the
    // legacy per-workspace sidecar.
    const sidecarPath = ws.identityPath ?? sidecarPathFor(ws.aofDir);
    const salt = await resolveInstallSalt(sidecarPath, config);
    const nodeId = await deriveNodeId({
      config,
      hostname: os.hostname(),
      salt,
      sidecarPath,
    });

    // activeRuns is a READ of the run records across the work items (the 23 → 20 → 19
    // seam) — readActiveRuns enumerates every item's runs/ and filters to running. It
    // calls no write/transition verb, so a heartbeat leaves every run record unchanged.
    const items = await listItems(ws.workDir);
    const activeRuns = await readActiveRuns(items);

    // The heartbeat instant — the injected now (white-box) or wall-clock, UTC-Z.
    const heartbeatAt = typeof input?.now === "string" && input.now.length > 0 ? input.now : new Date().toISOString();

    // Assemble the frozen-schema record.
    const record = assemblePresenceRecord({ nodeId, heartbeatAt, activeRuns, aofVersion: packageVersionString() });

    // GIT, UNCONDITIONAL — the durable floor (story 00 / ADR-002). milestone 33 / story 01
    // (ADR-002.1) RETIRES the relay best-effort push that used to follow this write: the
    // fabric peer-map (src/mesh-fabric.mjs's resolvePeers, consumed by mesh:status) is the
    // fast liveness read now, so there is no second bus to push over here.
    await publishPresenceRecord(ws, nodeId, record);

    // The result IS the frozen-schema record (the four enumerable keys — story 00's
    // contract: Object.keys === the frozen schema, JSON.stringify byte-identical, the
    // returned record === the persisted bytes).
    return record;
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; meshVerbCli's cli.mjs ladder branch is deleted.
    route: ["mesh", "heartbeat"],
    spec: {
      usage: "aof mesh heartbeat [--workspace <path|id>] [--json]",
      flags: { ...MESH_WORKSPACE_FLAG },
    },

    // `aof mesh heartbeat` — no positional (it publishes THIS node, not a named ref).
    argv: (positionals) => {
      guardMeshPositionals("heartbeat", positionals);
      return {};
    },

    // The publish confirmation names the node id + its in-flight count.
    render(result) {
      if (result == null) return "No presence record.";
      return `Heartbeat ${result.nodeId} — ${result.activeRuns.length} active run(s) at ${result.heartbeatAt}`;
    },

    // The --json face is the bare presence record.
    json: (result) => result,
  },
};
