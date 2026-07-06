// src/control-stream-server.mjs — the control node's always-on worker-stream ingest
// server (milestone 34 / story 04, ADR-007). Admits ONLY tailnet peers (the fabric is
// the admission boundary, 33/ADR-002 — no token/device-code); applies an admitted
// worker's snapshot-then-deltas into the SAME global store + redaction path stories
// 34/00-02 built (ADR-004/ADR-005); tracks each worker's stream liveness
// (live/stale/disconnected) from connection + heartbeat state.
//
// SHAPE: adapts serveRelay's (src/mesh-relay.mjs) concrete http.createServer + ws
// accept-loop shape (ADR-007 open Q4: re-implemented against the redacting global
// store publisher, NOT resurrected verbatim — this module never imports
// mesh-registry.mjs's credential/enrollment gate; admission here is "is this a
// tailnet peer", a DIFFERENT predicate). ws@8 (`WebSocketServer`) is the production
// transport; tests drive the pure functions below directly (admission decision,
// frame application, liveness label) — the STORY.md build note's "task 01's paired
// fake channel" pattern, generalised to the server side.
//
// THE WIRE FRAME — the SAME { kind, nodeId, workspaceId, items, at } shape
// worker-stream-client.mjs emits (documented there). This module never re-derives
// that schema; it only reads it.
import { WebSocketServer } from "ws";
import http from "node:http";
import {
  openGlobalWorkProjectionStore,
  publishWorkspaceSnapshot,
  readWorkspaceItems,
} from "./global-work-store.mjs";
import { redactDescriptor } from "./global-node-registry.mjs";

// isTailnetPeer(origin, { peerNodeIds }) — the ADMISSION PREDICATE: a tailnet peer is
// one whose resolved nodeId (via the fabric join, mesh-fabric.resolvePeers) is a
// member of the CURRENT peer set. `origin` is a { nodeId } shape carrying the
// connecting node's identity (production resolves this from the fabric's remote
// address → nodeId join at connect time; tests inject the origin directly — the
// STORY.md "injected peer-identity signal, mirroring mesh-fabric's injected exec").
// A null/unresolved nodeId is NEVER a peer (fail-closed).
export function isTailnetPeer(origin, { peerNodeIds } = {}) {
  const nodeId = typeof origin?.nodeId === "string" && origin.nodeId.length > 0 ? origin.nodeId : null;
  if (nodeId == null) return false;
  const roster = peerNodeIds instanceof Set ? peerNodeIds : new Set(peerNodeIds ?? []);
  return roster.has(nodeId);
}

// validFrameAt(value) — review fix P2.9: a `frame.at` is only trustworthy as a
// last_published_at value when it PARSES as a real instant; a non-ISO/garbage
// `frame.at` (a malformed or hostile worker frame) must never land verbatim in the
// store — the server clock (`now()`, the trustworthy source) is used instead.
function validFrameAt(value) {
  return typeof value === "string" && value.length > 0 && Number.isFinite(Date.parse(value)) ? value : null;
}

// applySnapshotFrame(store, workspace, frame, { now }) — writes a worker's FULL
// item-row set into the global store through the SAME publishWorkspaceSnapshot seam
// story 34/01 built (ADR-004: one shared publisher path). Redacts the frame's items
// (ADR-005) before anything reaches the store/descriptor. Returns the publish result.
export async function applySnapshotFrame(store, frame, { now } = {}) {
  const redactedItems = redactDescriptor(frame.items ?? []);
  const workspace = {
    projectRoot: frame.workspaceId,
    workDir: frame.workspaceId,
    config: {},
  };
  return publishWorkspaceSnapshot(store, workspace, {
    workspaceId: frame.workspaceId,
    items: { rows: redactedItems, errors: [] },
    now: now ?? validFrameAt(frame.at) ?? new Date().toISOString(),
  });
}

// A work_items row's NOT NULL columns (global-work-store.mjs's schema) — a merged
// delta row missing any of these can never be INSERTed; applyDeltaFrame (below)
// screens for exactly this completeness BEFORE the re-publish, so one partial delta
// can never abort the whole workspace's merged re-publish (review fix P0.3).
const REQUIRED_ITEM_FIELDS = ["ref", "type", "slug", "sourcePath"];

function isCompleteItemRow(row) {
  return REQUIRED_ITEM_FIELDS.every((field) => typeof row?.[field] === "string" && row[field].length > 0);
}

// applyDeltaFrame(store, frame, { now }) — a TARGETED item upsert: reads the
// workspace's current rows, replaces/adds the delta rows by `ref`, and re-publishes
// the merged set through the SAME snapshot-write seam (idempotent — publishing a
// snapshot is always safe to repeat, ADR-004). Redacts the delta items first
// (ADR-005). This is how "a delta reports the running item completed" ends up
// `done` in the store: the merged row for that ref carries the delta's status.
//
// review fix P0.3: a delta for an UNSEEN ref (not in `existing`) whose own fields
// don't supply the schema's NOT NULL columns (type/slug/sourcePath) would otherwise
// merge into an INCOMPLETE row — publishWorkspaceSnapshot's INSERT then throws,
// which rolls back the ENTIRE BEGIN IMMEDIATE txn and (via the caller's
// .catch(()=>{})) silently drops every OTHER item in the same frame. Skip exactly
// that incomplete merged row here, before the re-publish, so the rest of the
// frame's items (and the rest of the workspace's already-published rows) are never
// collaterally rolled back by one partial/unseen-ref delta.
export async function applyDeltaFrame(store, frame, { now } = {}) {
  const redactedItems = redactDescriptor(frame.items ?? []);
  // review fix Craft: reads through global-work-store.mjs's own readWorkspaceItems
  // accessor rather than a raw store.db.prepare(...) SELECT held here — a plain
  // read, so this does not weaken acd-global-publisher-single-seam (write-scoped).
  const existing = readWorkspaceItems(store, frame.workspaceId);
  const byRef = new Map(existing.map((row) => [row.ref, row]));
  for (const item of redactedItems) {
    byRef.set(item.ref, { ...byRef.get(item.ref), ...item });
  }
  const mergedRows = [...byRef.values()].filter(isCompleteItemRow);
  const workspace = { projectRoot: frame.workspaceId, workDir: frame.workspaceId, config: {} };
  return publishWorkspaceSnapshot(store, workspace, {
    workspaceId: frame.workspaceId,
    items: { rows: mergedRows, errors: [] },
    // review fix P2.9: a malformed frame.at falls back to the server clock, never
    // a verbatim non-ISO string written into last_published_at.
    now: now ?? validFrameAt(frame.at) ?? new Date().toISOString(),
  });
}

// applyStreamFrame(store, frame, options) — dispatch by frame.kind. An unrecognised
// kind is a no-op (never a crash — the never-crash discipline every mesh module in
// this codebase keeps).
export async function applyStreamFrame(store, frame, options = {}) {
  if (frame?.kind === "snapshot") return applySnapshotFrame(store, frame, options);
  if (frame?.kind === "delta") return applyDeltaFrame(store, frame, options);
  return { published: false, skipped: true, code: "unknown-frame-kind" };
}

// THE STALENESS WINDOW — a connected worker with no heartbeat inside this window is
// "stale", not "live". A missing/malformed lastHeartbeatAt is treated as immediately
// stale (never silently "live" on absent data).
export const DEFAULT_HEARTBEAT_WINDOW_SECONDS = 30;

// streamLivenessLabel({ connected, lastHeartbeatAt, now, windowSeconds }) → "live" |
// "stale" | "disconnected". A PURE label over connection + heartbeat state — no
// wall-clock read (the `now` is always supplied by the caller, defaulting to
// Date.now() only in production).
export function streamLivenessLabel({ connected, lastHeartbeatAt, now, windowSeconds = DEFAULT_HEARTBEAT_WINDOW_SECONDS } = {}) {
  if (!connected) return "disconnected";
  if (typeof lastHeartbeatAt !== "string" || lastHeartbeatAt.length === 0) return "stale";
  const heartbeatMs = Date.parse(lastHeartbeatAt);
  const nowMs = typeof now === "string" ? Date.parse(now) : (now ?? Date.now());
  if (!Number.isFinite(heartbeatMs) || !Number.isFinite(nowMs)) return "stale";
  return nowMs - heartbeatMs <= windowSeconds * 1000 ? "live" : "stale";
}

// freshnessLabel({ connected, everConnected, lastHeartbeatAt, now, windowSeconds }) →
// "live" | "stale" | "never-connected" — task 03's THREE-state view label: a worker
// that is fabric-visible but has NEVER opened a stream is distinguished from one that
// streamed before and dropped.
export function freshnessLabel({ connected, everConnected, lastHeartbeatAt, now, windowSeconds } = {}) {
  if (!everConnected) return "never-connected";
  const label = streamLivenessLabel({ connected, lastHeartbeatAt, now, windowSeconds });
  return label === "disconnected" ? "stale" : label;
}

// ------------------------------------------------------- the server host ----

// createStreamRegistry() — the in-memory (never persisted) per-worker connection
// state the server tracks: connected?, lastHeartbeatAt, everConnected. Mirrors
// serveRelay's in-memory `clients` Set discipline (ADR-007: this is liveness
// bookkeeping, not a record).
export function createStreamRegistry() {
  const byNodeId = new Map();
  return {
    markConnected(nodeId, now) {
      const entry = byNodeId.get(nodeId) ?? {};
      byNodeId.set(nodeId, { ...entry, connected: true, everConnected: true, lastHeartbeatAt: now ?? entry.lastHeartbeatAt ?? null });
    },
    markHeartbeat(nodeId, now) {
      const entry = byNodeId.get(nodeId) ?? {};
      byNodeId.set(nodeId, { ...entry, connected: true, everConnected: true, lastHeartbeatAt: now });
    },
    markDisconnected(nodeId) {
      const entry = byNodeId.get(nodeId) ?? {};
      byNodeId.set(nodeId, { ...entry, connected: false });
    },
    get(nodeId) {
      return byNodeId.get(nodeId) ?? { connected: false, everConnected: false, lastHeartbeatAt: null };
    },
    entries() {
      return [...byNodeId.entries()];
    },
  };
}

// listenOrDegradeToLoopback(server, port, bindAddress) — bind `bindAddress`; if
// that fails specifically because the address isn't (yet) assigned to a local
// interface (EADDRNOTAVAIL), retry ONCE on loopback rather than crashing the
// daemon (review fix P1.6(b) hardening — a transient tailscale-interface-not-
// ready race must never take down the control-node launcher). Any OTHER listen
// fault (e.g. EADDRINUSE) still rejects — never silently swallowed.
function listenOrDegradeToLoopback(server, port, bindAddress) {
  return new Promise((resolve, reject) => {
    const onFirstError = (error) => {
      if (error?.code === "EADDRNOTAVAIL" && bindAddress !== "127.0.0.1") {
        server.listen(port, "127.0.0.1", resolve);
        return;
      }
      reject(error);
    };
    server.once("error", onFirstError);
    server.listen(port, bindAddress, () => {
      server.off("error", onFirstError);
      resolve();
    });
  });
}

// startControlStreamServer({ port, bindAddress, peerNodeIds, peersByAddress,
// openStore, now }) → { server, wss, registry, stop }. The always-on daemon face
// (production: hosted by mesh-launcher.mjs's startLauncher when this node's role
// is "control", ADR-007). `peerNodeIds` is the CURRENT tailnet roster (a
// Set/array of nodeIds resolved via mesh-fabric's resolvePeers — the launcher
// refreshes this on its existing peer-poll ticker); `openStore` defaults to
// openGlobalWorkProjectionStore.
//
// review fix P1.6: `bindAddress` defaults to the loopback "127.0.0.1" — NEVER
// "0.0.0.0" (all interfaces) — so an operator who supplies no fabric-resolved
// self-address still gets a server unreachable from off-host, rather than one
// reachable from every interface on the machine. Production (mesh-launcher.mjs)
// passes the fabric-resolved selfAddress here so tailnet peers CAN reach it while
// every other interface still cannot.
//
// ADMISSION: the upgrade handler resolves the connecting request's origin nodeId
// via options.resolveOrigin(request) (defaultResolveOrigin, below — joins
// request.socket.remoteAddress to a nodeId through the injected `peersByAddress`
// map; tests may inject a resolver directly) and checks isTailnetPeer against the
// live peerNodeIds. A non-peer is destroyed at the gate — socket.destroy(), no ws
// ever emitted, so NOTHING reaches the global-store write path (the fitness
// acd-control-stream-tailnet-only invariant).
export async function startControlStreamServer({
  port = 0,
  bindAddress = "127.0.0.1",
  peerNodeIds = [],
  peersByAddress = [],
  resolveOrigin,
  openStore = openGlobalWorkProjectionStore,
  storeOptions = {},
  now = () => new Date().toISOString(),
} = {}) {
  const registry = createStreamRegistry();
  const store = await openStore(storeOptions);
  const roster = new Set(Array.isArray(peerNodeIds) ? peerNodeIds : peerNodeIds instanceof Set ? [...peerNodeIds] : []);
  const addressIndex = buildAddressIndex(peersByAddress);
  const resolve = resolveOrigin ?? ((request) => defaultResolveOrigin(request, { peersByAddress: addressIndex }));

  const server = http.createServer((request, response) => {
    response.writeHead(426, { "Content-Type": "text/plain" });
    response.end("Upgrade required");
  });
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const origin = resolve(request);
    if (!isTailnetPeer(origin, { peerNodeIds: roster })) {
      // A refused connection writes NOTHING to the global store — destroyed upstream
      // of the ws accept, before any frame can ever be read.
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, { nodeId: origin.nodeId });
    });
  });

  wss.on("connection", (ws, meta) => {
    const nodeId = meta.nodeId;
    registry.markConnected(nodeId, now());

    ws.on("message", (data) => {
      let frame = null;
      try {
        frame = JSON.parse(data.toString());
      } catch {
        return; // never-crash: a malformed frame is dropped, never thrown.
      }
      if (frame?.kind === "heartbeat") {
        registry.markHeartbeat(nodeId, now());
        return;
      }
      registry.markHeartbeat(nodeId, now());
      applyStreamFrame(store, frame, { now: now() }).catch(() => {
        // A store-apply fault must never crash the accept loop — the next frame
        // simply tries again (mirrors probeFabric's never-crash discipline).
      });
    });

    ws.on("close", () => {
      registry.markDisconnected(nodeId);
    });
    ws.on("error", () => {
      registry.markDisconnected(nodeId);
    });
  });

  // review fix P1.6(b): bind the resolved address (default loopback), NEVER
  // "0.0.0.0" (all interfaces) — the fabric IS the admission boundary (33/ADR-002),
  // so the socket itself should be reachable only on the tailnet interface a
  // fabric-resolved bindAddress names, plus loopback for same-host diagnostics.
  //
  // A caller-supplied bindAddress that is NOT (yet) assigned to a local interface
  // (EADDRNOTAVAIL — e.g. a transient tailscale interface-not-ready race, or a
  // stale self-address) degrades to loopback rather than crashing the daemon —
  // still never "0.0.0.0", so the admission-boundary invariant holds either way;
  // this never masks an actually-occupied port (EADDRINUSE still rejects, the
  // setup-ui.mjs listen-or-reject discipline).
  await listenOrDegradeToLoopback(server, port, bindAddress);

  return {
    server,
    wss,
    registry,
    updatePeers(nextPeerNodeIds, nextPeersByAddress) {
      roster.clear();
      for (const id of (Array.isArray(nextPeerNodeIds) ? nextPeerNodeIds : [...(nextPeerNodeIds ?? [])])) {
        roster.add(id);
      }
      // review fix P1.6(a): the remote-address→nodeId join must stay current too —
      // a peer whose fabric IP changes (or a newly-enrolled peer) must be joinable
      // on the VERY NEXT poll, the same freshness P0.2 already guarantees for the
      // roster itself. Optional 2nd arg — a caller that only refreshes the roster
      // (nextPeersByAddress omitted) leaves the address index untouched.
      if (nextPeersByAddress !== undefined) {
        addressIndex.clear();
        for (const [address, nodeId] of buildAddressIndex(nextPeersByAddress)) {
          addressIndex.set(address, nodeId);
        }
      }
    },
    stop() {
      for (const client of wss.clients) {
        try { client.terminate(); } catch { /* already gone */ }
      }
      wss.close();
      server.close();
      store.close?.();
    },
  };
}

// buildAddressIndex(peers) → Map<normalisedAddress, nodeId> — from an array of
// { nodeId, dialAddress } rows (mesh-fabric's resolvePeers() shape — the caller,
// mesh-launcher.mjs, hands this in; this module never calls resolvePeers itself,
// preserving acd-worker-stream-fabric-addressed's "control-stream-server.mjs
// consumes an already-resolved roster" invariant). A Map is also accepted verbatim
// (already-built index) so updatePeers can pass one straight through.
function buildAddressIndex(peers) {
  if (peers instanceof Map) return peers;
  const index = new Map();
  for (const peer of Array.isArray(peers) ? peers : []) {
    const address = normaliseRemoteAddress(peer?.dialAddress);
    const nodeId = typeof peer?.nodeId === "string" && peer.nodeId.length > 0 ? peer.nodeId : null;
    if (address && nodeId) index.set(address, nodeId);
  }
  return index;
}

// normaliseRemoteAddress(address) — strips the IPv4-mapped-IPv6 prefix
// ("::ffff:100.x.x.x" → "100.x.x.x") Node's http/net sockets present for an IPv4
// peer on a dual-stack listener, so a bare fabric dial address (mesh-fabric's
// TailscaleIPs[0], always plain IPv4/IPv6) still joins the socket's own
// remoteAddress reading. A non-string input is never a valid address.
function normaliseRemoteAddress(address) {
  if (typeof address !== "string" || address.length === 0) return null;
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

// defaultResolveOrigin(request, { peersByAddress }) — review fix P1.6(a): resolves
// identity from request.socket.remoteAddress (the CONNECTION-LEVEL fact, never a
// self-declared header — the retired broker's own admission shape, mesh-
// relay.mjs's defaultIsGroupConnection, inspected `request.socket.remoteAddress`
// the SAME way) joined to a nodeId via the injected `peersByAddress` index (an
// ALREADY-resolved fabric roster; this module never calls resolvePeers itself —
// acd-worker-stream-fabric-addressed). An unresolved/unmapped remote address is
// { nodeId: null } (fail-closed — isTailnetPeer never admits a null nodeId).
function defaultResolveOrigin(request, { peersByAddress } = {}) {
  const index = peersByAddress instanceof Map ? peersByAddress : buildAddressIndex(peersByAddress);
  const remoteAddress = normaliseRemoteAddress(request?.socket?.remoteAddress);
  const nodeId = remoteAddress != null ? index.get(remoteAddress) ?? null : null;
  return { nodeId };
}
