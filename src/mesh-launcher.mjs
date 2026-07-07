// src/mesh-launcher.mjs — the per-node presence and global propagation daemon (milestone 33 / story 01,
// ADR-003). The coordination launcher (F-3201): with the ws@8 broker eliminated
// (ADR-002), this is the per-node process the fabric-native model needs — it publishes
// this node's global presence record, runs global propagation cadence, and
// periodically re-reads the fabric peer-map so mesh:status reflects live liveness. On
// the control node it hosts the mesh WebSocket/enrollment service; on worker nodes it
// opens an outbound WebSocket client to that control service.
//
// TWO FACES over the SAME core (08/ADR-001 / the 23 precedent):
//   - launcherProbe(config, options)   — the NON-BLOCKING probe the registered mesh:*
//                                        command run IS (ADR-003.2): reports fabric
//                                        state + self-address + registered mesh peer count + whether
//                                        this node is the control node, and RETURNS.
//                                        Never starts long-lived listeners or tickers.
//   - startLauncher(ws, options)       — the long-lived launcher face: preflights the
//                                        fabric (refuse-with-guidance if degraded),
//                                        publishes presence, starts the reused global
//                                        propagation, and for control/worker roles
//                                        starts the appropriate server/client stream.
//                                        Returns { stop() } (mirrors
//                                        the serveRelay returned shape)
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
import { publishGlobalWorkSnapshot, workspaceIdFor, readWorkspaceProjectionItems } from "./global-work-publisher.mjs";
import { meshRole, resolveWorkerStreamTarget } from "./mesh-role.mjs";
import { createWorkerStreamClient, createWorkerWsTransport } from "./worker-stream-client.mjs";
import { startControlStreamServer, DEFAULT_HEARTBEAT_WINDOW_SECONDS } from "./control-stream-server.mjs";
import { createEnrollmentHttpHandler } from "./mesh-relay.mjs";
import { readMeshLauncherLockStatus } from "./mesh-launcher-lock.mjs";

const DEFAULT_CADENCE_SECONDS = 15;
const DEFAULT_CONTROL_SERVICE_PORT = 4182;
const DEFAULT_CONTROL_STREAM_PATH = "/ws/relay";

function resolveCadenceSeconds(value) {
  if (typeof value !== "number") return DEFAULT_CADENCE_SECONDS;
  if (!Number.isFinite(value)) return DEFAULT_CADENCE_SECONDS;
  if (!Number.isInteger(value)) return DEFAULT_CADENCE_SECONDS;
  if (value <= 0) return DEFAULT_CADENCE_SECONDS;
  return value;
}

function cadenceFromConfig(workspace) {
  return resolveCadenceSeconds(workspace?.config?.mesh?.sync?.cadenceSeconds);
}

function resolveNow(options = {}) {
  if (typeof options?.now === "function") return String(options.now());
  if (typeof options?.now === "string" && options.now.length > 0) return options.now;
  return new Date().toISOString();
}

async function assembleCurrentPresenceRecord(ws, nodeId, options = {}) {
  const items = await listItems(ws.workDir);
  const activeRuns = await readActiveRuns(items);
  return assemblePresenceRecord({ nodeId, heartbeatAt: resolveNow(options), activeRuns, aofVersion: aofVersion() });
}

function configuredRelayUrl(config) {
  const raw = config?.mesh?.relay?.url;
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function configuredServicePort(config) {
  const parsed = configuredRelayUrl(config);
  if (parsed == null || parsed.port.length === 0) return DEFAULT_CONTROL_SERVICE_PORT;
  const port = Number.parseInt(parsed.port, 10);
  return Number.isInteger(port) && port > 0 ? port : DEFAULT_CONTROL_SERVICE_PORT;
}

function hostForUrl(host) {
  const value = String(host ?? "");
  if (value.includes(":") && !value.startsWith("[")) return `[${value}]`;
  return value;
}

function configuredServiceUrlForAddress(config, dialAddress) {
  const parsed = configuredRelayUrl(config);
  const protocol = parsed?.protocol ?? "ws:";
  const pathname = parsed?.pathname && parsed.pathname !== "/" ? parsed.pathname : DEFAULT_CONTROL_STREAM_PATH;
  const port = configuredServicePort(config);
  return `${protocol}//${hostForUrl(dialAddress)}${port != null ? `:${port}` : ""}${pathname}`;
}
function intervalTicker() {
  return {
    start(intervalSeconds, onTick) {
      return setInterval(onTick, intervalSeconds * 1000);
    },
    stop(handle) {
      clearInterval(handle);
    },
  };
}
// peerNodeIdsFrom(peers) — the ONE roster-extraction shape both the launch-time
// admission roster AND the peer-poll refresh use (review fix P0.2): a resolvePeers()
// row array reduced to its resolved, non-empty nodeIds. Factored out so the two call
// sites can never drift on what counts as "a peer" for admission purposes.
function peerNodeIdsFrom(peers) {
  return (Array.isArray(peers) ? peers : [])
    .map((peer) => peer?.nodeId)
    .filter((id) => typeof id === "string" && id.length > 0);
}

// defaultConnectWorkerStreamClient(client, ws) — review fix P1.7b: push an INITIAL
// snapshot over the client's already-constructed transport so the stream genuinely
// carries state from the moment it opens (never an inert client that only ever
// streams nothing) — sendSnapshot() itself calls ensureConnected() internally
// (worker-stream-client.mjs), so there is no separate connect step here. DEFERRED
// to task-04's @manual soak: the per-mutation delta feed (run-start/run-complete →
// sendDelta) and the real two-machine live validation — this seam only pushes the
// snapshot the client's own reconnect contract already re-sends on every future
// reconnect (worker-stream-client.mjs's needsSnapshot flag); it does not itself
// re-snapshot on a later local mutation.
async function defaultConnectWorkerStreamClient(client, ws, presenceRecord = null) {
  const items = await readWorkspaceProjectionItems(ws).then((result) => result.rows).catch(() => []);
  await client.sendSnapshot(items);
  if (presenceRecord != null && typeof client.sendPresence === "function") {
    await client.sendPresence(presenceRecord);
  }
}

// Resolve THIS node's stable id + whether it is the control node
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
// a mint. The --serve daemon writes only this machine's global presence/global work
// projection records.
async function resolveNodeIdentity(ws) {
  const config = ws.config ?? {};
  // Read the salt from the MACHINE-WIDE identity home (34/story 00) — ws.identityPath
  // (global, resolved by loadWorkspace); a synthetic workspace falls back to the legacy
  // per-workspace sidecar. (config.mesh.salt is usually already hydrated from the same
  // file by loadWorkspace; this stays a belt-and-suspenders read of the SAME source.)
  const sidecarPath = ws.identityPath ?? sidecarPathFor(ws.aofDir);
  const sidecar = await readSidecar(sidecarPath);
  const salt = typeof sidecar?.salt === "string" && sidecar.salt.length > 0 ? sidecar.salt : config?.mesh?.salt;
  // NO sidecarPath passed to deriveNodeId — the in-memory-derive mode
  // (node-identity.mjs's own documented "persistence is skipped when no sidecarPath
  // is given" branch): a pinned id still wins verbatim; an unpinned one is derived
  // but never written back.
  const nodeId = await deriveNodeId({ config, hostname: os.hostname(), salt });
  // role — the ONE shared mesh-role predicate (mesh-role.mjs, ADR-007 /
  // acd-worker-stream-single-predicate): "control" is BYTE-IDENTICAL to the
  // control-node comparison this function already made (kept below, unchanged,
  // for every existing caller); "worker"/"standalone" are the story-04 additions no
  // prior caller reads.
  const role = meshRole(config, nodeId);
  const controlNode = config?.mesh?.relay?.controlNode ?? null;
  return { nodeId, issuanceAuthority: controlNode != null && controlNode === nodeId, role };
}

// launcherProbe(ws, options) → { fabricState, selfAddress, peerCount, issuanceAuthority
// } — the NON-BLOCKING registered-run shape (ADR-003.2, the relayStatus precedent). A
// pure config+fabric read: probeFabric + selfAddress + registered resolvePeers() nodeIds + the
// control-node comparison — ZERO blocking calls, so acd-mesh-command-cli-bijection
// stays green (the probe runs clean + parseable + RETURNS).
export async function launcherProbe(ws, options = {}) {
  const config = ws.config ?? {};
  const probe = await probeFabric(config, options);
  const address = probe.healthy ? await selfAddress(config, options) : null;
  const nodeRecords = probe.healthy ? await readNodeRecords(ws) : [];
  const peers = probe.healthy ? await resolvePeers(config, { ...options, roster: nodeRecords }) : [];
  const { issuanceAuthority } = await resolveNodeIdentity(ws);
  const launcherStatus = await resolveLauncherStatus(ws, options);
  return {
    fabricState: probe.reason ?? "running",
    healthy: probe.healthy,
    selfAddress: address,
    peerCount: new Set(peerNodeIdsFrom(peers)).size,
    launcherRunning: launcherStatus.running === true,
    launcherPid: launcherStatus.running === true ? launcherStatus.pid : null,
    issuanceAuthority,
  };
}

async function resolveLauncherStatus(ws, options) {
  if (typeof options?.launcherStatus === "function") return await options.launcherStatus();
  const lockOptions = options?.launcherLockOptions ?? (typeof ws?.globalMeshRoot === "string" && ws.globalMeshRoot.length > 0
    ? { paths: { meshRoot: ws.globalMeshRoot } }
    : { env: process.env });
  return await readMeshLauncherLockStatus(lockOptions);
}

// startLauncher(ws, options) → { stop() } | { refused: true, guidance } — the long-lived
// `--serve` face over the one-shot core (ADR-003.1/.3):
//   (a) PREFLIGHT the fabric via probeFabric; a degraded probe REFUSES to start (no
//       loop, no presence publish) and returns { refused:true, guidance } instead of a
//       stop() handle — the caller (the CLI face) prints the guidance + exits non-zero.
//   (b) a healthy preflight publishes this node's presence record (reused
//       publishPresenceRecord) + starts global propagation on the configured
//       cadence (an INJECTED ticker, default intervalTicker() — no wall-clock wait in
//       tests) + starts a peer-poll ticker that periodically re-reads resolvePeers.
//   (c) starts the role-specific stream path: control listens on the fabric service
//       address; worker dials the control node's fabric service URL; standalone does
//       neither.
// options: { exec, platform } (the injected fabric-exec seam, task 00), { ticker }
// (the sync-loop ticker, default intervalTicker()), { peerPollTicker } (a SEPARATE
// injectable ticker for the peer re-read cadence, defaulting to the same real
// intervalTicker() when absent), { peerPollSeconds } (default 15s, the mesh propagation
// DEFAULT_CADENCE_SECONDS precedent), { onPeers } (a test/observer hook invoked with
// the resolvePeers() result on each peer-poll tick — production wires no observer).
export async function startLauncher(ws, options = {}) {
  const config = ws.config ?? {};
  const probe = await probeFabric(config, options);
  if (!probe.healthy) {
    return { refused: true, probe, guidance: fabricGuidance(probe, {}) };
  }

  // Publish this node's presence at start, then refresh it on every propagation tick.
  const { nodeId } = await resolveNodeIdentity(ws);
  const publishCurrentPresence = async () => {
    const nextRecord = await assembleCurrentPresenceRecord(ws, nodeId, options);
    await publishPresenceRecord(ws, nodeId, nextRecord);
    return nextRecord;
  };
  let record = await publishCurrentPresence();

  const launcherWarnings = [];
  const capturePropagation = async () => {
    record = await publishCurrentPresence();
    const propagation = await publishGlobalWorkSnapshot(ws, options);
    if (propagation.warning) launcherWarnings.push(propagation.warning);
    return propagation;
  };
  await capturePropagation();

  // milestone 34 / story 04 (ADR-007) — the live-stream daemon, hosted ADDITIVELY on
  // the SAME launcher: a "control" node starts the always-on stream server; a
  // "worker" node starts the persistent stream client pointed at the fabric-resolved
  // control-node dial address; a "standalone" node starts neither. Every knob is
  // OPTIONAL and options-gated — a caller that supplies none of
  // { streamServer, streamClient, controlStreamServerOptions,
  // workerStreamClientOptions } gets EXACTLY today's behaviour (no server bound, no
  // client connected), so every pre-existing startLauncher test stays byte-identical.
  //
  // Constructed BEFORE the peer-poll ticker below (review fix P0.2) so pollPeers can
  // refresh a live streamServer's admission roster on every tick — declared here (not
  // inside the poll closure) so the SAME streamServer instance the poll refreshes is
  // the one returned to the caller.
  const role = meshRole(config, nodeId);
  // review fix P0.1: the frame workspaceId MUST be the SAME id the global projection
  // publishes under (workspaceIdFor(projectRoot) when config carries no
  // explicit config.mesh.workspaceId) — never a bare `?? null`, which would land the
  // worker's streamed rows under a phantom "null" workspace distinct from every other
  // write path for this same workspace.
  const workspaceId = config?.mesh?.workspaceId ?? workspaceIdFor(ws.projectRoot ?? ws.workDir);
  let streamServer = null;
  let streamClient = null;
  // Verify follow-up (34/story 04): does this worker hold a LIVE transport (vs the
  // stream-degraded state)? Only a truly-connected worker runs the stream-sync ticker.
  let workerStreamHasTransport = false;
  if (role === "control" && options?.streamServer !== false) {
    const startServer = options?.startControlStreamServer ?? startControlStreamServer;
    const peers = await resolvePeers(config, { ...options, roster: await readNodeRecords(ws) });
    // review fix P1.6: bind the fabric-resolved self-address (never "0.0.0.0") and
    // hand the server an already-resolved peer→dialAddress index — this launcher is
    // the ONE module allowed to call resolvePeers (acd-worker-stream-fabric-
    // addressed); control-stream-server.mjs only ever consumes the resolved roster.
    const boundAddress = await selfAddress(config, options);
    const servicePort = configuredServicePort(config);
    streamServer = await startServer({
      ...(boundAddress ? { bindAddress: boundAddress } : {}),
      ...(servicePort != null ? { port: servicePort } : {}),
      peerNodeIds: peerNodeIdsFrom(peers),
      peersByAddress: peers,
      httpHandler: createEnrollmentHttpHandler({ config, workspace: ws, now: options?.now ?? null }),
      ...(options?.controlStreamServerOptions ?? {}),
    });
  } else if (role === "worker" && options?.streamClient !== false) {
    // review fix P1.7: assemble + connect the worker's dial (deferred: the
    // per-mutation delta feed from the run lifecycle and the real two-machine
    // validation stay task-04's @manual soak — this resolves the control-node
    // target FIRST, constructs the transport pointed at it, then constructs the
    // client WITH that transport, bridges a transport drop to notifyDrop(), and
    // pushes an initial snapshot so the stream genuinely carries state). A worker
    // whose control node is unresolvable on the fabric enters a stream-degraded retry state —
    // the client is still constructed (so streamClient/stop() stay well-defined)
    // but carries NO transport and makes NO connection attempt (task 00's clean
    // degrade, verbatim).
    const createClient = options?.createWorkerStreamClient ?? createWorkerStreamClient;
    const resolveTarget = options?.resolveWorkerStreamTarget ?? resolveWorkerStreamTarget;
    const nowFn = () => resolveNow(options);

    const nodeRecords = await readNodeRecords(ws);
    const resolved = await resolveTarget(config, nodeId, { ...options, roster: nodeRecords });

    let transport;
    if (resolved.target != null) {
      const createTransport = options?.createWorkerWsTransport ?? createWorkerWsTransport;
      transport = createTransport(configuredServiceUrlForAddress(config, resolved.target), options?.workerWsTransportOptions ?? {});
    } else if (resolved.message) {
      launcherWarnings.push({ code: "worker-stream-target-unresolved", message: resolved.message, path: null });
    }

    const client = createClient({
      nodeId,
      workspaceId,
      transport,
      now: nowFn,
      onWarning: (warning) => launcherWarnings.push(warning),
      ...(options?.workerStreamClientOptions ?? {}),
    });
    streamClient = client;

    if (transport != null) {
      // Bridge a transport-level drop to the client's own notifyDrop() (ADR-004: a
      // stream fault is a warning, never a rethrow) — production wires the REAL
      // transport's onDrop/close/error signal; a test-injected transport that omits
      // onDrop simply never bridges (no crash — onDrop is called only when present).
      if (typeof transport?.onDrop === "function") {
        transport.onDrop(() => client.notifyDrop());
      }
      const connectClient = options?.connectWorkerStreamClient ?? defaultConnectWorkerStreamClient;
      await connectClient(client, ws, record);
    }
    workerStreamHasTransport = transport != null;
  }

  // The peer-poll ticker — periodically re-reads resolvePeers so mesh:status reflects
  // live fabric liveness (ADR-003.1c). A SEPARATE ticker from the sync loop's (a
  // different cadence concern), defaulting to the SAME real intervalTicker() shape when
  // no injected ticker is supplied. review fix P0.2: EVERY tick also refreshes a live
  // control-node streamServer's admission roster (streamServer.updatePeers) — the
  // roster used to be frozen at launch, so a worker that enrolled after this node
  // started would be refused forever; now the SAME resolvePeers() read this tick
  // already did also keeps the stream server's roster current.
  const peerPollTicker = typeof options?.peerPollTicker === "object" && options.peerPollTicker != null ? options.peerPollTicker : intervalTicker();
  const peerPollSeconds = typeof options?.peerPollSeconds === "number" && options.peerPollSeconds > 0 ? options.peerPollSeconds : 15;
  const pollPeers = async () => {
    const nodeRecords = await readNodeRecords(ws);
    const peers = await resolvePeers(config, { ...options, roster: nodeRecords });
    // review fix P1.6(a): refresh the remote-address→nodeId join alongside the
    // roster on every tick — a peer's fabric address (or a freshly-admitted peer)
    // must be joinable on the VERY NEXT poll, not frozen at launch either.
    streamServer?.updatePeers?.(peerNodeIdsFrom(peers), peers);
    if (typeof options?.onPeers === "function") options.onPeers(peers);
  };
  const peerPollHandle = peerPollTicker.start(peerPollSeconds, () => {
    pollPeers().catch(() => {
      // a transient fabric-read fault mid-serve must never crash the daemon — the next
      // tick simply re-attempts (the same never-crash discipline probeFabric itself keeps).
    });
  });

  const propagationTicker = typeof options?.propagationTicker === "object" && options.propagationTicker != null ? options.propagationTicker : intervalTicker();
  const propagationSeconds = typeof options?.propagationSeconds === "number" && options.propagationSeconds > 0 ? options.propagationSeconds : cadenceFromConfig(ws);
  const propagationHandle = propagationTicker.start(propagationSeconds, () => {
    capturePropagation().catch((error) => {
      launcherWarnings.push({ code: error?.code ?? "global-work-propagation-failed", message: error?.message ?? "Global work propagation failed.", path: null });
    });
  });

  // The STREAM-SYNC ticker (verify follow-up, 34/story 04) — keep the worker's stream
  // CURRENT, not merely pushed-once-at-connect. A run mutation happens in a SEPARATE CLI
  // process this daemon cannot observe in-memory, and the control-stream server marks a
  // worker "stale" after DEFAULT_HEARTBEAT_WINDOW_SECONDS with no frames. So an
  // actually-connected worker re-snapshots its CURRENT projection on a ticker faster than
  // that window. This ONE periodic re-snapshot does three jobs at once: every frame
  // refreshes the server's heartbeat (keeps the worker "live"), any local work advance
  // converges within a tick (scenario 1), and a post-reconnect tick re-syncs because the
  // client's needsSnapshot contract re-sends a snapshot first (scenario 2). Snapshot-only
  // for now (operator scale); a per-mutation INSTANT delta is a later optimization, not a
  // correctness gap. Only a worker with a live transport runs it (never control/standalone,
  // never the stream-degraded state). sendSnapshot is failure-isolated (ADR-004) — a fault
  // is a warning, never a daemon crash.
  let streamSyncHandle = null;
  const streamSyncTicker = typeof options?.streamSyncTicker === "object" && options.streamSyncTicker != null ? options.streamSyncTicker : intervalTicker();
  if (role === "worker" && streamClient != null && workerStreamHasTransport) {
    const streamSyncSeconds = typeof options?.streamSyncSeconds === "number" && options.streamSyncSeconds > 0
      ? options.streamSyncSeconds
      : Math.max(5, Math.floor(DEFAULT_HEARTBEAT_WINDOW_SECONDS / 3));
    const pushStreamSnapshot = async () => {
      const items = await readWorkspaceProjectionItems(ws).then((result) => result.rows).catch(() => []);
      const presence = await publishCurrentPresence();
      await streamClient.sendSnapshot(items);
      if (typeof streamClient.sendPresence === "function") {
        await streamClient.sendPresence(presence);
      }
    };
    streamSyncHandle = streamSyncTicker.start(streamSyncSeconds, () => pushStreamSnapshot().catch(() => {}));
  }

  // stop() — the clean daemon shutdown (ADR-003.3, the serve-unit discipline): stop
  // all tickers (peer poll + propagation + optional stream sync) cleanly, plus the stream server/client when
  // this node started one. No half-published record — the presence publish already
  // completed before this handle was returned.
  const stop = () => {
    peerPollTicker.stop(peerPollHandle);
    propagationTicker.stop(propagationHandle);
    if (streamSyncHandle != null) streamSyncTicker.stop(streamSyncHandle);
    streamServer?.stop?.();
    streamClient?.stop?.();
  };

  return {
    stop,
    record,
    warnings: launcherWarnings,
    selfAddress: await selfAddress(config, options),
    role,
    streamServer,
    streamClient,
  };
}
