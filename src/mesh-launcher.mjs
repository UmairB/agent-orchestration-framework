// src/mesh-launcher.mjs — the per-node presence+sync daemon (milestone 33 / story 01,
// ADR-003). The coordination launcher (F-3201): with the ws@8 broker eliminated
// (ADR-002), this is the per-node process the fabric-native model needs — it publishes
// this node's git presence record, runs the reused startSyncLoop cadence, and
// periodically re-reads the fabric peer-map so mesh:status reflects live liveness. It
// binds NO listening broker socket — the "bind" is the fabric self-address resolved via
// src/mesh-fabric.mjs's selfAddress.
//
// TWO FACES over the SAME core (08/ADR-001 / the 23 precedent):
//   - launcherProbe(config, options)   — the NON-BLOCKING probe the registered mesh:*
//                                        command run IS (ADR-003.2): reports fabric
//                                        state + self-address + peer count + whether
//                                        this node is the issuance authority, and
//                                        RETURNS. Never calls listen()/startSyncLoop.
//   - startLauncher(ws, options)       — the long-lived `--serve` face: preflights the
//                                        fabric (refuse-with-guidance if degraded),
//                                        publishes presence, starts the reused
//                                        startSyncLoop, and periodically re-reads
//                                        resolvePeers. Returns { stop() } (mirrors
//                                        startSyncLoop's / serveRelay's returned shape)
//                                        so the CLI face traps SIGINT/SIGTERM and calls
//                                        it — never a dependency on a raw process.on
//                                        firing inside a test.
import os from "node:os";
import { probeFabric, selfAddress, resolvePeers, fabricGuidance } from "./mesh-fabric.mjs";
import { readNodeRecords } from "./mesh-store.mjs";
import { deriveNodeId, sidecarPathFor, readSidecar } from "./node-identity.mjs";
import { aofVersion } from "./commands/mesh-identity.mjs";
import { assemblePresenceRecord, readActiveRuns, publishPresenceRecord } from "./mesh-presence.mjs";
import { listItems } from "./work.mjs";
import { startSyncLoop, intervalTicker, cadenceFromConfig, runsPathspec, syncMesh } from "./mesh-sync.mjs";
import { meshDir } from "./mesh-store.mjs";

// Resolve THIS node's stable id + whether it is the issuance authority
// (config.mesh.relay.controlNode === nodeId — the SAME comparison relayStatus already
// makes, mesh-relay.mjs:669). READ-ONLY, always — this NEVER mints or persists
// anything (no writeSidecarPatch call reachable from this function): a pinned
// config.mesh.nodeId (the hydrated sidecar overlay OR the committed fallback) wins
// verbatim; otherwise the id is DERIVED IN-MEMORY from the current salt/hostname
// WITHOUT ever calling deriveNodeId with a sidecarPath (that is deriveNodeId's
// PERSISTING mode) and WITHOUT minting a fresh salt when none exists yet (an absent
// salt derives with salt:undefined — installHash(undefined) is still deterministic
// per hostname, so a fresh, never-published node still gets a STABLE id for the
// life of this probe/serve call, even though nothing was written). Minting +
// persisting the salt/id stays owned exclusively by mesh:identity / mesh:heartbeat
// (story 00's design) — the launcher's registered run is a config+fabric READ, never
// a mint, and its --serve daemon's presence publish is the only legitimate git write
// it performs.
async function resolveNodeIdentity(ws) {
  const config = ws.config ?? {};
  const sidecarPath = sidecarPathFor(ws.aofDir);
  const sidecar = await readSidecar(sidecarPath);
  const salt = typeof sidecar?.salt === "string" && sidecar.salt.length > 0 ? sidecar.salt : config?.mesh?.salt;
  // NO sidecarPath passed to deriveNodeId — the in-memory-derive mode
  // (node-identity.mjs's own documented "persistence is skipped when no sidecarPath
  // is given" branch): a pinned id still wins verbatim; an unpinned one is derived
  // but never written back.
  const nodeId = await deriveNodeId({ config, hostname: os.hostname(), salt });
  const controlNode = config?.mesh?.relay?.controlNode ?? null;
  return { nodeId, issuanceAuthority: controlNode != null && controlNode === nodeId };
}

// launcherProbe(ws, options) → { fabricState, selfAddress, peerCount, issuanceAuthority
// } — the NON-BLOCKING registered-run shape (ADR-003.2, the relayStatus precedent). A
// pure config+fabric read: probeFabric + selfAddress + resolvePeers().length + the
// issuance-authority comparison — ZERO blocking calls, so acd-mesh-command-cli-bijection
// stays green (the probe runs clean + parseable + RETURNS).
export async function launcherProbe(ws, options = {}) {
  const config = ws.config ?? {};
  const probe = await probeFabric(config, options);
  const address = probe.healthy ? await selfAddress(config, options) : null;
  const nodeRecords = probe.healthy ? await readNodeRecords(ws) : [];
  const peers = probe.healthy ? await resolvePeers(config, { ...options, roster: nodeRecords }) : [];
  const { issuanceAuthority } = await resolveNodeIdentity(ws);
  return {
    fabricState: probe.reason ?? "running",
    healthy: probe.healthy,
    selfAddress: address,
    peerCount: peers.length,
    issuanceAuthority,
  };
}

// startLauncher(ws, options) → { stop() } | { refused: true, guidance } — the long-lived
// `--serve` face over the one-shot core (ADR-003.1/.3):
//   (a) PREFLIGHT the fabric via probeFabric; a degraded probe REFUSES to start (no
//       loop, no presence publish) and returns { refused:true, guidance } instead of a
//       stop() handle — the caller (the CLI face) prints the guidance + exits non-zero.
//   (b) a healthy preflight publishes this node's presence record (reused
//       publishPresenceRecord) + starts the reused startSyncLoop on the configured
//       cadence (an INJECTED ticker, default intervalTicker() — no wall-clock wait in
//       tests) + starts a peer-poll ticker that periodically re-reads resolvePeers.
//   (c) binds NO listening broker socket — the "bind" is the fabric self-address.
// options: { exec, platform } (the injected fabric-exec seam, task 00), { ticker }
// (the sync-loop ticker, default intervalTicker()), { peerPollTicker } (a SEPARATE
// injectable ticker for the peer re-read cadence, defaulting to the same real
// intervalTicker() when absent), { peerPollSeconds } (default 15s, the mesh-sync
// DEFAULT_CADENCE_SECONDS precedent), { onPeers } (a test/observer hook invoked with
// the resolvePeers() result on each peer-poll tick — production wires no observer).
export async function startLauncher(ws, options = {}) {
  const config = ws.config ?? {};
  const probe = await probeFabric(config, options);
  if (!probe.healthy) {
    return { refused: true, probe, guidance: fabricGuidance(probe, {}) };
  }

  // Publish this node's presence record ONCE at start (the reused assembly + atomic
  // publish seam — byte-identical to mesh:heartbeat's record shape).
  const { nodeId } = await resolveNodeIdentity(ws);
  const items = await listItems(ws.workDir);
  const activeRuns = await readActiveRuns(items);
  const heartbeatAt = typeof options?.now === "string" && options.now.length > 0 ? options.now : new Date().toISOString();
  const record = assemblePresenceRecord({ nodeId, heartbeatAt, activeRuns, aofVersion: aofVersion() });
  await publishPresenceRecord(ws, nodeId, record);

  // The reused mesh:sync cadence loop (mesh-sync.mjs's startSyncLoop, UNCHANGED) — an
  // injected runSync closure over syncMesh, mirroring run-start.mjs's shape.
  const runSync = () => syncMesh(ws, { roots: [meshDir(ws), runsPathspec(ws)] });
  const syncTicker = typeof options?.ticker === "object" && options.ticker != null ? options.ticker : intervalTicker();
  const syncLoop = startSyncLoop({ runSync, cadenceSeconds: cadenceFromConfig(ws), ticker: syncTicker });

  // The peer-poll ticker — periodically re-reads resolvePeers so mesh:status reflects
  // live fabric liveness (ADR-003.1c). A SEPARATE ticker from the sync loop's (a
  // different cadence concern), defaulting to the SAME real intervalTicker() shape when
  // no injected ticker is supplied.
  const peerPollTicker = typeof options?.peerPollTicker === "object" && options.peerPollTicker != null ? options.peerPollTicker : intervalTicker();
  const peerPollSeconds = typeof options?.peerPollSeconds === "number" && options.peerPollSeconds > 0 ? options.peerPollSeconds : 15;
  const pollPeers = async () => {
    const nodeRecords = await readNodeRecords(ws);
    const peers = await resolvePeers(config, { ...options, roster: nodeRecords });
    if (typeof options?.onPeers === "function") options.onPeers(peers);
  };
  const peerPollHandle = peerPollTicker.start(peerPollSeconds, () => {
    pollPeers().catch(() => {
      // a transient fabric-read fault mid-serve must never crash the daemon — the next
      // tick simply re-attempts (the same never-crash discipline probeFabric itself keeps).
    });
  });

  // stop() — the clean daemon shutdown (ADR-003.3, the serve-unit discipline): stop
  // BOTH tickers (sync loop + peer poll) cleanly. No half-published record — the
  // presence publish already completed before this handle was returned.
  const stop = () => {
    syncLoop.stop();
    peerPollTicker.stop(peerPollHandle);
  };

  return { stop, record, syncLoop, selfAddress: await selfAddress(config, options) };
}
