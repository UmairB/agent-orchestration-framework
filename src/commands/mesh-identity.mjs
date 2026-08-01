// mesh:identity + mesh:status — the two registered node-identity commands
// (milestone 22 / story 01 / ADR-001/003). Thin over story 00's src/mesh-store.mjs
// (the partition seam + opaque per-node persist/read) and story 01's
// src/node-identity.mjs (id derivation + descriptor assembly), carrying the frozen
// { id, input, run, cli } contract (08/ADR-002). A node is "just another thin face":
// publishing identity + reading the fleet are command-core capabilities, not a
// parallel subsystem.
//
//   mesh:identity  — no ref → assemble THIS node's descriptor (real hostname /
//                    platform / runtimes / skills / version), publish it via the store,
//                    and return the published record (republish bumps publishedAt; the
//                    id is stable, persisted to config.mesh.nodeId on first publish). A
//                    ref → readNodeRecord(ref) and return it. Command-level: an absent
//                    read returns null (NOT an error — the run-store ENOENT→null
//                    discipline). The CLI FACE turns an absent READ into node-not-found
//                    (a face-level error); that split lives in meshVerbCli, not here.
//
//   mesh:status    — no input → readNodeRecords(ws) → { nodes:[...] } (an empty roster
//                    reads as { nodes: [] }, NOT an error). A pure read.
//
// This story WRITES only through the store's meshDir seam and NEVER calls the sync
// engine (story 02 moves the records); it is parallel-with-02 by construction.
import os from "node:os";
import crypto from "node:crypto";
import { publishNodeRecord, readNodeRecord, readNodeRecords } from "../mesh-store.mjs";
import { MESH_WORKSPACE_FLAG, guardMeshPositionals, refuseReadMiss } from "./mesh-face-shared.mjs";
import { deriveNodeId, assembleDescriptor, sidecarPathFor, writeSidecarPatch, sanitizeHostname } from "../node-identity.mjs";
// milestone 28 / story 00 (ADR-003): the version read routes through the ONE
// SEA-safe asset-base seam instead of joining a path off a bare
// import.meta.url — dev behaviour is byte-for-byte unchanged.
import { packageVersionString } from "../asset-base.mjs";
// milestone 23 / story 00 (ADR-002) — mesh:status is EXTENDED to render each node's
// presence + a stale flag. The reads (presence + threshold + node-staleness) live in
// the presence dimension; status stays a PURE READ (writes nothing).
import {
  readPresenceRecord,
  resolveStalenessSeconds,
  isNodeStale,
  mergePresence,
} from "../mesh-presence.mjs";
// milestone 33 / story 01 (ADR-002.1 cutover) — the read-side liveness accelerator's
// fast SOURCE cuts over from the retired relay cache to the fabric peer-map
// (src/mesh-fabric.mjs's resolvePeers). mergePresence itself is UNCHANGED (fitness
// #1's byte-unchanged git assembly) — only this caller re-points its second argument.
import { resolvePeers } from "../mesh-fabric.mjs";
// milestone 25 / story 01 (ADR-002) — mesh:status is EXTENDED again to aggregate the
// whole fleet: the m24 group registry (readRegistry — the roster of admitted nodes +
// the set of registered boards) joined with each board's active runs. This is the
// SOLE fleet-data join site (acd-mesh-ui-single-data-command): no other module
// co-reads readRegistry alongside the node/presence roster. The boards read owns its
// OWN graceful degradation (see boardsProjection): readRegistry tolerates ONLY ENOENT
// (a torn/unparseable registry THROWS, a wrong-shape one parses to a non-registry), so
// the projection wraps the call in try/catch AND shape-guards the parsed value — a
// missing/torn/foreign registry degrades to empty boards, NEVER blinding the roster.
import { readRegistry, isControlNode } from "../mesh-registry.mjs";

// RETIRED (m42 wave (d) leg d1): `aofVersion()` — a try/catch wrapper around
// `packageVersionString()`, which has degraded to "" on its own since the SEA
// asset-base seam landed. A second door to one fact, and the one that dragged
// mesh-launcher.mjs into an upward import of this module. Every publisher now
// reads the provenance string ONE way: `packageVersionString()` from asset-base.

// Resolve a STABLE per-install salt for the id-hash (the empty-stem fallback +
// collision suffix). Read config.mesh.salt (post milestone-33/ADR-004, this is the
// HYDRATED value — the sidecar's, when one exists, via loadWorkspace's overlay); mint
// + persist one to the git-ignored SIDECAR (never the committed config — the
// re-point, ADR-004.2) when absent, so the install-hash is stable across publishes,
// via the ONE sidecar read-merge-write (writeSidecarPatch, 22/R2 — one writer per
// subtree, shared with persistNodeId/migrateIdentity). Returns the salt string.
// EXPORTED so mesh:heartbeat (milestone 23 / story 00) resolves the SAME stable id the
// node record carries via the SAME salt → deriveNodeId path — read the id ONE way.
export async function resolveInstallSalt(sidecarPath, config) {
  const existing = config?.mesh?.salt;
  if (typeof existing === "string" && existing.length > 0) return existing;
  const salt = crypto.randomUUID();
  if (sidecarPath) {
    await writeSidecarPatch(sidecarPath, { salt });
  }
  return salt;
}

// A structured command error the mesh face renders as ONE { ok:false, error, code }
// envelope (the mesh-join.mjs faceError shape — the property is assigned, not an
// object-literal field).
function faceError(message, token) {
  const error = new Error(message);
  error.code = token;
  return error;
}

export const meshIdentityCommand = {
  id: "mesh:identity",
  input: {
    type: "object",
    // `name` / `address` (2026-07-27) — the REGISTRATION OVERRIDES. Both are optional
    // and only meaningful on a publish (no ref); a read ignores them.
    properties: { ref: { type: "string" }, name: { type: "string" }, address: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    const ref = typeof input?.ref === "string" ? input.ref.trim() : "";

    // A ref → READ that node's record. Absent reads as null (NOT an error — the
    // store's ENOENT→null discipline). The face turns absent into node-not-found.
    if (ref) {
      return await readNodeRecord(ws, ref);
    }

    // No ref → PUBLISH this node. Resolve a stable salt, derive (+ persist) the id,
    // assemble the descriptor, publish it through the store, and return the record.
    // Both the salt + the id persist to the git-ignored PER-INSTALL SIDECAR
    // (ADR-004.2, F-3203) — never the committed config.
    // `let`: the registration overrides below re-bind it with the pinned id/address so
    // the SAME publish sees them (deriveNodeId reads config.mesh.nodeId).
    let config = ws.config ?? {};
    // Mint the machine-wide identity to the GLOBAL home (34/story 00) — ws.identityPath,
    // resolved by loadWorkspace from AOF_GLOBAL_HOME; a synthetic workspace (tests) with
    // no identityPath falls back to the legacy per-workspace sidecar.
    const sidecarPath = ws.identityPath ?? sidecarPathFor(ws.aofDir);
    const salt = await resolveInstallSalt(sidecarPath, config);
    const hostname = os.hostname();

    // ------------------------------------------ the registration overrides ----
    // (2026-07-27) A node cannot always derive a usable identity from its own machine.
    // The driving case is a guest that INHERITS its host's hostname — a WSL2 distro
    // answers with the Windows machine name, so the derived nodeId COLLIDES with the
    // host's and the advertised host RESOLVES TO THE HOST, not the guest. Neither is
    // recoverable by derivation, because the machine is genuinely lying about itself.
    //
    //   --name <id>       pin the nodeId, PINNED so the load-time self-heal
    //                     (work.mjs's healIdentitySidecar) never churns it back to the
    //                     colliding hostname-derived value. Sanitized through the SAME
    //                     sanitizeHostname the derivation uses, so an operator-supplied
    //                     name can never produce an id shape derivation could not.
    //   --address <ip>    the address peers should DIAL, published as the descriptor's
    //                     `host` and read back by mesh-fabric's selfAddress via the
    //                     config.mesh.address hydration — ONE stored value, both readers.
    //
    // Both persist to the per-install sidecar (never the committed config — ADR-004.2),
    // through the SAME writeSidecarPatch every other sidecar writer uses.
    const requestedName = typeof input?.name === "string" ? input.name.trim() : "";
    const requestedAddress = typeof input?.address === "string" ? input.address.trim() : "";
    if (requestedName.length > 0) {
      const pinnedId = sanitizeHostname(requestedName);
      if (pinnedId.length === 0) {
        throw faceError(
          `mesh:identity --name "${requestedName}" sanitizes to an empty id — use [a-z0-9-] characters.`,
          "invalid-node-name",
        );
      }
      // `pinned: true` + clearing `derivedFrom` is exactly the discriminator
      // healIdentitySidecar reads to leave an operator-set id alone forever.
      await writeSidecarPatch(sidecarPath, { nodeId: pinnedId, pinned: true, derivedFrom: undefined });
      config = { ...config, mesh: { ...(config.mesh ?? {}), nodeId: pinnedId } };
    }
    if (requestedAddress.length > 0) {
      await writeSidecarPatch(sidecarPath, { address: requestedAddress });
      config = { ...config, mesh: { ...(config.mesh ?? {}), address: requestedAddress } };
    }

    const nodeId = await deriveNodeId({
      config,
      hostname,
      salt,
      sidecarPath,
    });
    // The ADVERTISED host: the override when set (this publish's, or one pinned by an
    // earlier publish and hydrated onto config.mesh.address), else the real hostname.
    // This is the value peers resolve on a `direct` fabric.
    const advertisedHost = typeof config?.mesh?.address === "string" && config.mesh.address.length > 0
      ? config.mesh.address
      : hostname;
    const descriptor = assembleDescriptor({
      nodeId,
      hostname: advertisedHost,
      platform: process.platform,
      runtimes: Array.isArray(config.runtimes) ? config.runtimes : [],
      aofVersion: packageVersionString(),
    });
    await publishNodeRecord(ws, nodeId, descriptor);
    return descriptor;
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; meshVerbCli's cli.mjs ladder branch is deleted.
    route: ["mesh", "identity"],
    spec: {
      usage: "aof mesh identity [<id>] [--name <id>] [--address <ip-or-host>] [--workspace <path|id>] [--json]",
      flags: {
        name: { type: "string", description: "registration override: the node id to publish as" },
        address: { type: "string", description: "registration override: the address to advertise" },
        ...MESH_WORKSPACE_FLAG,
      },
    },

    // `aof mesh identity [<id>] [--name <id>] [--address <ip-or-host>]` — an optional
    // positional is the read ref; the two options are the publish-side registration
    // overrides (the hostname-collision escape hatch).
    argv: (positionals, options = {}) => {
      guardMeshPositionals("identity", positionals, { max: 1 });
      return { ref: positionals[0], name: options.name, address: options.address };
    },

    // Publish confirmation names the node id; a read renders the node line. A
    // null READ (a ref was supplied, no record) is the face-level node-not-found.
    render(result, faceCtx = {}) {
      refuseReadMiss(result, faceCtx);
      if (result == null) return "No node record.";
      const caps = describeCaps(result);
      return `Node ${result.nodeId} — ${caps}`;
    },

    // The --json face is the bare node record (publish OR read), per the feature.
    json(result, faceCtx = {}) {
      refuseReadMiss(result, faceCtx);
      return result;
    },
  },
};

export const meshStatusCommand = {
  id: "mesh:status",
  input: {
    type: "object",
    // milestone 23 / story 00 — an INJECTED `now` (ISO-8601 UTC-Z) is accepted so the
    // node-staleness boundary is driven over injected time (the 22/R2 inject-the-clock
    // discipline), never wall-clock. Absent ⇒ new Date() (live).
    properties: { now: { type: "string" } },
    additionalProperties: false,
  },

  async run(input, ctx) {
    const ws = ctx.workspace;
    // The synced roster — this node + every peer record in the tree. An empty roster
    // reads as { nodes: [] } (NOT an error — the store's absence-is-benign discipline).
    const nodeRecords = await readNodeRecords(ws);

    // milestone 23 / story 00 (ADR-002) — EXTEND the render: each node carries its
    // presence (when present) + a stale flag computed by m20's isStale shape over the
    // INJECTED now. Status stays a PURE READ — it writes nothing.
    const nowIso = typeof input?.now === "string" && input.now.length > 0 ? input.now : new Date().toISOString();
    const nowMs = Date.parse(nowIso);
    const thresholdMs = resolveStalenessSeconds(ws.config ?? {}) * 1000;

    // milestone 25 / design-gap B — THIS node's stable id, read PURELY off the
    // persisted config (config.mesh.nodeId, minted at first `mesh:identity` publish).
    // A read-only resolve: NEVER deriveNodeId/resolveInstallSalt here (those MINT +
    // PERSIST a salt — mesh:status must stay a pure read, the byte-unchanged
    // invariant). Absent (a node that never published) ⇒ no local marker anywhere,
    // which degrades cleanly to the pre-gap render. The web face renders the "this
    // node" tag + the local drill-in link off this marker (task 03 two-case split).
    const localId = typeof ws.config?.mesh?.nodeId === "string" ? ws.config.mesh.nodeId : null;

    // milestone 33 / story 01 (ADR-002.1 cutover) — the read-side liveness accelerator's
    // fast SOURCE. ctx.fabricPeers is INJECTED (a test's fixture value; exactly as
    // ctx.relayClient is injected for the heartbeat push) — a Map/array-like of
    // resolvePeers() results a test scripts directly, so the reconcile is exercised with
    // NO tailnet. Production (no injection) reads config.mesh.fabric: when declared, it
    // calls resolvePeers(config, { roster }) for the live fabric peer-map; when absent, NO
    // fabric read is attempted at all — the render is the git-only floor, byte-identical
    // to the pre-cutover behaviour. Either way, an Online peer becomes a fabric-liveness
    // pseudo-record (heartbeatAt: now) that mergePresence reconciles against disk — a tie
    // (or a fresher disk record) still reconciles to the git-durable bytes (git wins).
    const config = ws.config ?? {};
    const fabricPeers = Array.isArray(ctx?.fabricPeers)
      ? ctx.fabricPeers
      : config?.mesh?.fabric != null
        ? await resolvePeers(config, { roster: nodeRecords })
        : [];
    const fabricById = new Map();
    for (const peer of fabricPeers) {
      if (typeof peer?.nodeId === "string" && peer.nodeId.length > 0) fabricById.set(peer.nodeId, peer);
    }
    // A fabric-Online peer is the fast liveness pre-filter (ADR-002.1): surfaced as a
    // pseudo presence record whose heartbeatAt is "now" (INJECTED — never wall-clock in
    // the reconcile itself) so it reads as the freshest signal until git catches up.
    // activeRuns/aofVersion carry the disk record's OWN values when one exists (the
    // fabric only sharpens the LIVENESS timestamp — it never invents run/version data a
    // peer's own git-durable record already reports); a peer with no disk record yet
    // (heard over the fabric before its first sync) reads [] / "" — the honest unknown.
    const fabricLivenessFor = (id, diskPresence) => {
      const peer = fabricById.get(id);
      if (peer == null || peer.online !== true) return null;
      // m42 wave (b) / m38-F23 — fabric liveness SHARPENS the heartbeat; it never
      // REBUILDS the record. The original four-key rebuild was a whitelist, and a
      // whitelist silently drops what it was never told about: with heartbeatAt=now
      // this pseudo-record always wins the merge, so m38's additive `sessions` key
      // was DESTROYED for every fabric-Online node, on every tick — the desktop
      // fleet read `idle` during live work, and the feature only worked while the
      // fabric believed the node was OFFLINE. The disk record now rides through
      // whole (sessions and any future additive key included); the fabric
      // contributes exactly one fact: this peer is alive NOW.
      return {
        ...(diskPresence != null && typeof diskPresence === "object" ? diskPresence : {}),
        nodeId: id,
        heartbeatAt: nowIso,
        activeRuns: Array.isArray(diskPresence?.activeRuns) ? diskPresence.activeRuns : [],
        aofVersion: typeof diskPresence?.aofVersion === "string" ? diskPresence.aofVersion : "",
      };
    };

    // The roster is the UNION of the git node-record ids and the fabric-Online peer ids —
    // a peer the fabric reports Online BEFORE its node record has synced still surfaces.
    // With no fabric read (unconfigured mesh) the union is exactly the node-record ids in
    // insertion order (record always defined, mergePresence(disk, null) === disk) — the
    // no-fabric path is byte-identical to the story-00 render.
    const rosterById = new Map();
    for (const record of nodeRecords) rosterById.set(record.nodeId, record);
    const ids = [...rosterById.keys()];
    for (const id of fabricById.keys()) {
      if (!rosterById.has(id)) ids.push(id);
    }

    const nodes = [];
    // The merged presence per node id — reused by the boards projection (ADR-005) so a
    // board's active runs are read from its OWNER's presence, NOT re-read a second way.
    const presenceById = new Map();
    for (const id of ids) {
      const record = rosterById.get(id);
      // The ≤30s git-durable presence off disk, reconciled with the fabric peer-map
      // liveness. Applying a PEER's signal never touches THIS node's own presence: the
      // fabric read is keyed by the peer's nodeId, and this node's own entry reads its
      // disk presence. A tie reconciles to the git-durable bytes (git is the authority).
      const diskPresence = await readPresenceRecord(ws, id);
      const presence = mergePresence(diskPresence, fabricLivenessFor(id, diskPresence));
      if (presence) presenceById.set(id, presence);
      // The base fields: the git node record when it exists, else the bare peer id (a
      // relay-only peer that has no synced node record yet still surfaces by nodeId).
      const base = record ? { ...record } : { nodeId: id };
      // ADDITIVE over the node record (08/ADR-001 additive-friendly): the m23 stale flag,
      // and presence WHEN it exists. The locked never-beat rule (Flag 2): a node with NO
      // presence (or one missing heartbeatAt) is "no-presence / unknown liveness" — the
      // `presence` key is OMITTED (not null) and stale is FALSE (you can only be stale once
      // you have beat). isStale applies ONLY when a heartbeatAt exists.
      const node = presence && typeof presence.heartbeatAt === "string"
        ? { ...base, presence, stale: isNodeStale(presence, nowMs, thresholdMs) }
        : { ...base, stale: false };
      // The local marker rides additively (true ONLY on this node; omitted
      // otherwise — the "absent, not false" idiom the boards/owner join uses).
      if (localId != null && id === localId) node.local = true;
      nodes.push(node);
    }

    // milestone 25 / story 01 (ADR-002) — the boards projection, ADDITIVE over the
    // frozen { nodes } shape (existing consumers see nodes byte-identical). Each
    // registered board is joined with its owner (the first-wins roster scan) + its
    // active runs (the m21 run read against this node's local work stream). The read
    // is PURE — it writes nothing.
    const boards = await boardsProjection(ws, localId, presenceById);
    const result = { nodes, boards };

    // milestone 27 / story 01 (25/ADR-002 one-data-command; SECURITY/ADR-006.3
    // framing) — the UNCONDITIONAL additive isControlNode marker (a PURE read of
    // isControlNode(config), 24/ADR-001): present EVEN unconfigured (false, NEVER
    // absent — the feature-04 true-absence contract) so story 02's fleet UI gates
    // the [assign ▸] affordance off this ONE data command. It never gates the
    // render itself — a pure fact a face reads.
    result.isControlNode = isControlNode(ws.config ?? {});

    return result;
  },

  cli: {
    // m42 wave (d) leg d1 (wave 3) — routed through the registry-derived table +
    // the ONE generic face; meshVerbCli's cli.mjs ladder branch is deleted.
    route: ["mesh", "status"],
    spec: {
      usage: "aof mesh status [--workspace <path|id>] [--json]",
      flags: { ...MESH_WORKSPACE_FLAG },
    },

    // `aof mesh status` — no positional; an injected now is a white-box test input, not
    // a CLI flag, so the live face renders against wall-clock.
    argv: (positionals) => {
      guardMeshPositionals("status", positionals);
      return {};
    },

    // The human render is composed of a NODES half + a BOARDS section (milestone 25 /
    // story 01, task 01). The NODES half is BYTE-IDENTICAL to m23: one line per node
    // `<nodeId> — <live|stale|no presence>`, and the verbatim "No nodes in the mesh
    // roster." line when the roster is empty. The BOARDS section is APPENDED below it
    // whenever boards[] is non-empty (the never-blank discipline, task 02) — so an
    // empty node roster + a populated registry renders the no-nodes line THEN the
    // boards. When BOTH halves are empty the render is the no-nodes line ALONE (no
    // dangling empty BOARDS heading — byte-identical to m23).
    render(result) {
      const nodesHalf = result.nodes.length === 0
        ? "No nodes in the mesh roster."
        : result.nodes
            // m42 wave (c) / item 1 — each node line names the BUILD it reports
            // (the presence record's sixth additive key), so a stale remote build
            // is read off `aof mesh status` instead of inferred by SSH. A
            // pre-stamp node simply omits the suffix.
            .map((node) => {
              const build = typeof node.presence?.buildId === "string" && node.presence.buildId.length > 0 ? ` · build ${node.presence.buildId}` : "";
              return `${node.nodeId} — ${node.presence ? (node.stale ? "stale" : "live") : "no presence"}${build}`;
            })
            .join("\n");

      const sections = [nodesHalf];

      const boards = Array.isArray(result.boards) ? result.boards : [];
      if (boards.length > 0) {
        // One line per board: its ref, its owner ("on <nodeId>" — OMITTED for an
        // ownerless board, no dangling suffix), and its running count (a zero-count
        // board is LISTED, not dropped).
        const boardLines = boards.map((board) => {
          const ownerSuffix = typeof board.owner === "string" ? ` on ${board.owner}` : "";
          const running = Array.isArray(board.activeRuns) ? board.activeRuns.length : 0;
          return `${board.ref}${ownerSuffix} — running ${running}`;
        });
        sections.push("BOARDS", ...boardLines);
      }

      return sections.join("\n");
    },

    // The stable { nodes: [ { nodeId, presence?, stale } ], boards: [...] } shape
    // passes through untouched — the machine face is never mixed with the human render.
    json: (result) => result,
  },
};

// milestone 25 / story 01 (ADR-002 decision 4 + task 02; run-source per ADR-005) — the
// boards projection. Reads the m24 group registry and joins each registered board with
// its owner + its active runs, degrading gracefully to an EMPTY boards list on ANY
// registry trouble (absent / torn / unparseable / foreign-shaped) so a missing seam
// NEVER blinds the node roster. A board's activeRuns is its OWNER node's synced
// presence.activeRuns (ADR-005 / finding F1) — the only fleet-durable run signal
// (reachable for peer boards too); an ownerless board or an owner with no presence
// reads []. A PURE read — it writes nothing.
async function boardsProjection(ws, localId = null, presenceById = new Map()) {
  // (a) Guarded read: readRegistry tolerates ONLY ENOENT (an unparseable registry
  // THROWS — JSON.parse sits outside its try/catch). Wrap the call so a THROW degrades
  // to empty boards, never a crash that blinds the roster (task 02 — "a torn record —
  // skipped, never blinding the list").
  let registry;
  try {
    registry = await readRegistry(ws);
  } catch {
    return [];
  }
  // (b) Shape-guard: a parseable-but-wrong-shape registry (a JSON array, {}, null
  // roster/boards) is NOT a crash on `.boards`/`.roster` — the defensive `?? []`
  // coercions below read a non-registry value as the empty union.
  if (registry == null || typeof registry !== "object") return [];
  const topBoards = Array.isArray(registry.boards) ? registry.boards : [];
  const roster = Array.isArray(registry.roster) ? registry.roster : [];

  // The enumeration is the UNION of the top-level boards set ∪ every roster entry's
  // boards, de-duped with SET semantics (one entry per slug however many places name
  // it), FIRST-APPEARANCE order preserved. A board present only on a roster entry
  // surfaces; a board present only in top-level boards[] (ownerless) also surfaces.
  const slugs = [];
  const seen = new Set();
  const addSlug = (slug) => {
    if (typeof slug !== "string" || seen.has(slug)) return;
    seen.add(slug);
    slugs.push(slug);
  };
  for (const slug of topBoards) addSlug(slug);
  for (const entry of roster) {
    const entryBoards = Array.isArray(entry?.boards) ? entry.boards : [];
    for (const slug of entryBoards) addSlug(slug);
  }

  const boards = [];
  for (const slug of slugs) {
    // owner = FIRST-WINS: the nodeId of the FIRST roster entry (in insertion order —
    // admitNode appends order-preserving) whose boards[] carries the slug. None found
    // ⇒ owner OMITTED entirely (absent, NOT owner: null — the m23 never-beat idiom).
    const ownerEntry = roster.find(
      (entry) => Array.isArray(entry?.boards) && entry.boards.includes(slug)
    );
    // activeRuns = the OWNER node's synced presence.activeRuns (ADR-005 / finding F1) —
    // the only fleet-durable run signal, reachable even for a PEER board (its owner's
    // presence syncs though its run records do not). An ownerless board, or an owner
    // with no presence / no active runs, reads [] (the never-blank []-not-error
    // discipline). This is the reduced running/idle fleet chip; the full m21 run-state
    // ramp is a drill-in concern (one level down), where the board's runs are local.
    const owner = ownerEntry ? ownerEntry.nodeId : undefined;
    // The owner's merged presence when it is in the roster (already cache-reconciled);
    // else a direct disk read (an owner may carry a synced presence record before its
    // node record has reached this node). Absent presence ⇒ [].
    const ownerPresence = owner != null
      ? (presenceById.get(owner) ?? await readPresenceRecord(ws, owner))
      : null;
    const activeRuns = Array.isArray(ownerPresence?.activeRuns) ? ownerPresence.activeRuns : [];
    const entry = ownerEntry
      ? { ref: slug, owner, activeRuns }
      : { ref: slug, activeRuns };
    // A board owned by THIS node is locally-served (its work stream + git are here),
    // so its drill-in navigates to the local `aof work ui`; a peer board floors to
    // the honest-locality hint (task 03). Marker rides additively, local-only.
    if (localId != null && entry.owner === localId) entry.local = true;
    boards.push(entry);
  }
  return boards;
}

// A one-line capability summary for the human render: runtimes.
function describeCaps(node) {
  const runtimes = Array.isArray(node.runtimes) ? node.runtimes : [];
  return runtimes.length ? `runtimes: ${runtimes.join(", ")}` : "no runtimes";
}

// A one-line target summary for the ISSUED render (milestone 27 / story 01):
// the discriminated union rendered as a short human phrase — an unknown/malformed
// kind reads as "any" (fail-safe rendering, never a crash on a foreign shape).
function describeTarget(target) {
  if (target?.kind === "node") return `node ${target.nodeId}`;
  if (target?.kind === "capability") return `capability ${target.value}`;
  return "any";
}
