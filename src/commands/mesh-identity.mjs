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
import { deriveNodeId, assembleDescriptor, sidecarPathFor, writeSidecarPatch } from "../node-identity.mjs";
import { loadBundle } from "../work-bundle.mjs";
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
// milestone 26 / story 01 (ADR-005 consequences) — mesh:status is EXTENDED again,
// additively, with the LEASE render: who holds what, per state:"claimed" record,
// live|lapsed by the SAME presence clock the nodes half uses (task-01's predicate —
// never a private re-derivation). The claim read carries the mesh-store discipline
// (absence-tolerant, torn-file-skipping). A PURE READ: the render never flips a
// lapsed claim (the lapse is a rule; withdrawal is the owner's alone).
import { readLeaseClaims, claimLiveness } from "../mesh-lease.mjs";
// milestone 27 / story 01 (ADR-004 consequences) — mesh:status is EXTENDED again,
// additively, with the ISSUED render: who issued what, targeted at whom, riding
// the EXISTING verb (no new gate re-armed — the 22/R1 inverse). readIssuanceDirectives
// is the SAME absence-tolerant / torn-file-skipping union read the routing filter
// consumes (src/mesh-issuance.mjs, stories 00/01) — a PURE read, it writes nothing.
import { readIssuanceDirectives } from "../mesh-issuance.mjs";

// The publishing install's aof version (ADR-003 provenance) — read from the package
// manifest via the import.meta.url idiom (same posture as bundleRoot()): src/ ->
// package.json is one level up. Read lazily + tolerantly so a missing/unreadable
// manifest degrades to "" rather than crashing the publish.
// EXPORTED so mesh:heartbeat (milestone 23 / story 00) carries the SAME aofVersion
// provenance the node record carries — read it ONE way, not a second package.json read.
export function aofVersion() {
  try {
    return packageVersionString();
  } catch {
    return "";
  }
}

// The installed bundle skill ids — the CAPABILITY advertisement (what work this node
// can take, ADR-003). The contract leaves the exact source open ("installed bundle
// skill ids"); we read them from loadBundle()'s resources (what this install ships).
// Tolerant: an unreadable bundle degrades to [] rather than crashing the publish.
function installedSkills() {
  try {
    return loadBundle().resources.map((resource) => resource.id);
  } catch {
    return [];
  }
}

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

export const meshIdentityCommand = {
  id: "mesh:identity",
  input: {
    type: "object",
    properties: { ref: { type: "string" } },
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
    const config = ws.config ?? {};
    const sidecarPath = sidecarPathFor(ws.aofDir);
    const salt = await resolveInstallSalt(sidecarPath, config);
    const hostname = os.hostname();
    const nodeId = await deriveNodeId({
      config,
      hostname,
      salt,
      sidecarPath,
    });
    const descriptor = assembleDescriptor({
      nodeId,
      hostname,
      platform: process.platform,
      runtimes: Array.isArray(config.runtimes) ? config.runtimes : [],
      skills: installedSkills(),
      aofVersion: aofVersion(),
    });
    await publishNodeRecord(ws, nodeId, descriptor);
    return descriptor;
  },

  cli: {
    // `aof mesh identity [<id>]` — an optional positional is the read ref.
    argv: (positionals) => ({ ref: positionals[0] }),

    // Publish confirmation names the node id; a read renders the node line. (A
    // null read never reaches here — meshVerbCli surfaces node-not-found first.)
    render(result) {
      if (result == null) return "No node record.";
      const caps = describeCaps(result);
      return `Node ${result.nodeId} — ${caps}`;
    },

    // The --json face is the bare node record (publish OR read), per the feature.
    json: (result) => result,
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
      return {
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

    // milestone 26 / story 01 (ADR-005 consequences) — the ADDITIVE lease section,
    // gated on config.mesh.nodeId being a NON-EMPTY string (the SAME predicate
    // commands/next.mjs gates its lease view on — the two m26 gates never diverge;
    // an empty-string nodeId is unconfigured): ABSENT when mesh is unconfigured
    // (byte-identical to today — the key never appears), [] when
    // configured-but-empty. Per held ("claimed") record: { itemRef, holder, live } —
    // itemRef/holder straight off the claim record's vocabulary (ADR-003.1), `live`
    // a boolean by task-01's predicate over the holder's OWN presence and the SAME
    // nowMs/thresholdMs the nodes half computed. A released file is a withdrawal,
    // not a hold — filtered out. Two claims for one item (the transient race window)
    // render as two entries, one per claimant — a third-party reader NEVER resolves
    // the winner (ADR-003.4). A no-presence holder renders live (the never-beat ≠
    // stale lock: not affirmatively stale, so never shown reclaimable/lapsed).
    if (typeof localId === "string" && localId.length > 0) {
      const claims = await readLeaseClaims(ws);
      const leases = [];
      for (const claim of claims) {
        if (claim?.state !== "claimed") continue;
        if (typeof claim.itemRef !== "string" || typeof claim.nodeId !== "string") continue;
        const holderPresence = presenceById.get(claim.nodeId) ?? await readPresenceRecord(ws, claim.nodeId);
        const liveness = claimLiveness(claim, holderPresence ?? null, nowMs, thresholdMs);
        leases.push({ itemRef: claim.itemRef, holder: claim.nodeId, live: liveness !== "lapsed" });
      }
      result.leases = leases;
    }

    // milestone 27 / story 01 (ADR-004 consequences) — the ADDITIVE ISSUED section,
    // gated on the SAME config.mesh.nodeId predicate the leases section gates on
    // (the m26/m27 gates never diverge): ABSENT when mesh is unconfigured
    // (byte-identical to today — the key never appears), [] when
    // configured-but-empty. Per OPEN (non-withdrawn/non-fulfilled) directive:
    // { issuer, itemRef, target } straight off the frozen six-key record's
    // vocabulary (ADR-001.2) — a withdrawn/fulfilled directive is spent, filtered
    // out exactly as a released lease is filtered from LEASES. A PURE read — the
    // issuance partition tree is byte-unchanged after this render.
    if (typeof localId === "string" && localId.length > 0) {
      const directives = await readIssuanceDirectives(ws);
      const issued = [];
      for (const directive of directives) {
        if (directive?.state === "withdrawn" || directive?.state === "fulfilled") continue;
        if (typeof directive?.itemRef !== "string" || typeof directive?.issuer !== "string") continue;
        issued.push({ issuer: directive.issuer, itemRef: directive.itemRef, target: directive.target });
      }
      result.issued = issued;
    }

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
    // `aof mesh status` — no positional; an injected now is a white-box test input, not
    // a CLI flag, so the live face renders against wall-clock.
    argv: () => ({}),

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
            .map((node) => `${node.nodeId} — ${node.presence ? (node.stale ? "stale" : "live") : "no presence"}`)
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

      // milestone 26 / story 01 — the ADDITIVE lease section: appended ONLY when
      // result.leases exists AND is non-empty (zero leases ⇒ an empty section, i.e.
      // nothing appended; unconfigured mesh ⇒ the key is absent, so the render is
      // byte-identical to today's). One line per held claim: item, holder,
      // live|lapsed by the presence clock.
      const leases = Array.isArray(result.leases) ? result.leases : [];
      if (leases.length > 0) {
        const leaseLines = leases.map(
          (lease) => `${lease.itemRef} — held by ${lease.holder} (${lease.live ? "live" : "lapsed"})`
        );
        sections.push("LEASES", ...leaseLines);
      }

      // milestone 27 / story 01 — the ADDITIVE ISSUED section: appended ONLY when
      // result.issued exists AND is non-empty (zero directives ⇒ nothing appended;
      // unconfigured mesh ⇒ the key is absent, so the render is byte-identical to
      // today's — no dangling ISSUED heading). One line per open directive: item,
      // issuer, target.
      const issued = Array.isArray(result.issued) ? result.issued : [];
      if (issued.length > 0) {
        const issuedLines = issued.map(
          (entry) => `${entry.itemRef} — issued by ${entry.issuer} (${describeTarget(entry.target)})`
        );
        sections.push("ISSUED", ...issuedLines);
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

// A one-line capability summary for the human render: runtimes + skill count.
function describeCaps(node) {
  const runtimes = Array.isArray(node.runtimes) ? node.runtimes : [];
  const skills = Array.isArray(node.skills) ? node.skills : [];
  const runtimePart = runtimes.length ? `runtimes: ${runtimes.join(", ")}` : "no runtimes";
  return `${runtimePart}; ${skills.length} skill(s)`;
}

// A one-line target summary for the ISSUED render (milestone 27 / story 01):
// the discriminated union rendered as a short human phrase — an unknown/malformed
// kind reads as "any" (fail-safe rendering, never a crash on a foreign shape).
function describeTarget(target) {
  if (target?.kind === "node") return `node ${target.nodeId}`;
  if (target?.kind === "capability") return `capability ${target.value}`;
  return "any";
}
