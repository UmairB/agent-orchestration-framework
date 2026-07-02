// src/mesh-presence-cache.mjs — the in-memory PRESENCE LIVENESS CACHE (milestone 23 /
// story 02 / ADR-003, finding F1). The consumer-side mirror of the relay's statelessness
// (fitness #1): a fast-path PROJECTION of the fanned-out presence signals a node's relay
// subscriber applies, keyed by the PEER's nodeId — NEVER a second system of record. Git
// stays the durable authority (ADR-002); this cache only accelerates the READ so a peer's
// pushed change surfaces in mesh:status ≤5s over the relay WITHOUT waiting for a ≤30s git
// sync. A later git sync of the same record reconciles to the git-durable bytes
// (mergePresence breaks a tie in favour of disk).
//
// PURE — NO fs, NO ws, NO record schema. This module imports NEITHER a durable-write seam
// (mesh-store.mjs's publishPresenceRecord/presenceRecordPath) NOR mesh-presence.mjs's write
// path NOR node:fs — it holds the in-flight liveness view in memory ONLY, exactly as the
// relay holds the in-flight frame in memory only. It reuses ONLY the frozen
// PRESENCE_SIGNAL_KIND literal (from the relay client) so the consumer and the producer
// agree on the one wire `kind`. The arch-test acd-presence-subscriber-cache-only (fitness
// #7, ADR-004) enforces this statelessness discipline over this module's source.
//
// LATEST-WINS, keyed by nodeId (the ADR-002 one-node-per-partition discipline applied in
// memory): apply() supersedes a cached entry ONLY when the incoming heartbeatAt is strictly
// newer (Date.parse compare) — an equal-or-older signal is dropped, so a re-broadcast /
// out-of-order frame never regresses the view.
import { PRESENCE_SIGNAL_KIND } from "./mesh-relay-client.mjs";

// createPresenceCache() → the in-memory liveness cache. A plain closure over a Map keyed by
// the PEER's nodeId; each value is the OPAQUE presence record (the signal blob) the
// subscriber applied. Holds no fs handle, no socket — a pure in-memory projection.
export function createPresenceCache() {
  // nodeId -> the latest applied presence record (the opaque signal blob).
  const byId = new Map();

  return {
    // apply(envelope) → boolean (true iff the envelope superseded / seeded an entry).
    // IGNORES anything that is not a presence envelope carrying a valid record — it returns
    // false (never throws) unless:
    //   - envelope is a non-null object,
    //   - envelope.kind === "presence" (an unknown kind — e.g. m26 leasing — is ignored),
    //   - envelope.signal is a non-null object,
    //   - signal.nodeId is a non-empty string (the cache key),
    //   - signal.heartbeatAt is a string (the liveness clock the latest-wins compare reads).
    // LATEST-WINS: if an entry for this nodeId already exists and its heartbeatAt is >= the
    // incoming one (Date.parse compare), the incoming signal does NOT supersede — return
    // false. Otherwise store the signal (keyed by signal.nodeId) and return true.
    apply(envelope) {
      if (envelope == null || typeof envelope !== "object") return false;
      if (envelope.kind !== PRESENCE_SIGNAL_KIND) return false;
      const signal = envelope.signal;
      if (signal == null || typeof signal !== "object") return false;
      if (typeof signal.nodeId !== "string" || signal.nodeId.length === 0) return false;
      if (typeof signal.heartbeatAt !== "string") return false;

      const existing = byId.get(signal.nodeId);
      if (existing != null) {
        // Equal-or-older ⇒ do NOT supersede (a re-broadcast / out-of-order frame is
        // dropped). Only a STRICTLY newer heartbeatAt wins. NaN-tolerant: an unparseable
        // existing heartbeat never blocks a parseable newer one from a well-formed record.
        const existingMs = Date.parse(existing.heartbeatAt);
        const incomingMs = Date.parse(signal.heartbeatAt);
        if (Number.isFinite(existingMs) && Number.isFinite(incomingMs) && existingMs >= incomingMs) {
          return false;
        }
      }
      byId.set(signal.nodeId, signal);
      return true;
    },

    // get(id) → the cached presence record for a peer, or null when none is cached.
    get(id) {
      return byId.has(id) ? byId.get(id) : null;
    },

    // ids() → the cached nodeIds (the roster the subscriber has heard from over the relay).
    ids() {
      return [...byId.keys()];
    },

    // list() → the cached presence records.
    list() {
      return [...byId.values()];
    },

    // size → the count of cached peers.
    get size() {
      return byId.size;
    },
  };
}
