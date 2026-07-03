// src/mesh-store.mjs — the mesh-store: the path-partition seam (ADR-002), the
// frozen node-record schema's opaque per-node persist/read (ADR-003), addressed
// only by node id. The low-fan-out SPINE the mesh:* commands (stories 01/02) and
// milestones 23/24/26 all couple through — the exact role src/run-store.mjs plays
// for the run dimension (milestone 22 story 00).
//
// THE PARTITION INVARIANT (ADR-002, frozen): every mesh record file is owned and
// addressed by EXACTLY ONE node id, built from a SINGLE seam (meshDir/nodeRecordPath),
// so two nodes never write the same path. Git merges of disjoint per-node files are
// add-only — never a three-way content merge — which is the precondition that keeps
// git viable as the mesh's bus (story 02's sync engine rests on it). There is NO
// shared or aggregate file two nodes co-write (no nodes.json roster).
//
// The partition root is a git-TRACKED mesh dir under the .aof config home
// (`.aof/mesh/`, beside aof's git-tracked config/lock): git IS the bus, so a peer
// reads this node's record straight from the synced tree. Mesh is aof config/runtime
// state — a cross-cutting, extensible concept (planning too, not only the work
// stream) — so it anchors on .aof, force-tracked exactly as `.aof/aof.lock.json` is
// (28/verify decision superseding 22/ADR-002+003's earlier work-stream co-location;
// the git-tracked property is unchanged, only the location moved off workDir).
//
// Like run-store, this module references ZERO record-doc filename (SPEC.md/STORY.md/
// STATE.md/SESSION.md): record-doc resolution lives in work.mjs, never here (the
// write-scope guard, fitness #2). Every write joins meshDir/nodeRecordPath and routes
// through the atomic temp+rename writeText seam (19/R2). UNLIKE run-store the
// mesh-store persists the node record OPAQUE / AS-IS — NO normalization, NO schema
// reshaping (descriptor assembly is story 01): an unknown additive key and a nested
// mixed-type value survive byte-equivalent + key-order-preserved.
import path from "node:path";
import { mkdir, readFile, readdir } from "node:fs/promises";
// 19/R2 / 20/ADR-007 — every record write routes through the atomic temp+rename
// seam (the Windows renameWithRetry is load-bearing on this platform). Never a bare
// writeFile.
import { writeText } from "./fs.mjs";
// The run dimension adopts milestone 19's frozen run-record seam as the reference
// (ADR-002 "compose-with-19"): runNodeRecordPath composes 22's <node>/ convention
// with 19's runsDir — it does NOT redefine the run seam. As of milestone 26
// (26/ADR-001.1) the builder's AUTHORITY lives in run-store.mjs (the import
// direction — this module imports run-store — forbids the reverse), and this module
// RE-EXPORTS it: every existing import site is unchanged, and there is still
// exactly ONE builder.
import { runsDir, runRecordPath, runNodeRecordPath } from "./run-store.mjs";

// --------------------------------------------------------- the path seam ----

// The .aof config-home a workspace's mesh anchors under. `loadWorkspace` supplies
// `aofDir` (the real .aof dir); a synthetic `{ workDir }` workspace (tests) derives it
// from `projectRoot`, else from the conventional <root>/wiki/work workDir. ONE resolver
// so the anchor lives in a single place.
export function aofHome(workspace) {
  if (workspace.aofDir) return workspace.aofDir;
  if (workspace.projectRoot) return path.join(workspace.projectRoot, ".aof");
  return path.join(path.dirname(path.dirname(workspace.workDir)), ".aof");
}

// THE single partition-root seam (ADR-002; location superseded at 28/verify). The
// git-TRACKED mesh dir lives under the .aof config home (`.aof/mesh/`), git-tracked
// beside aof's config/lock — mesh is aof config/runtime state, an extensible concept
// (planning too), NOT work-stream content, so it is no longer co-located under
// workDir (the 22/ADR-002+003 work-stream anchor is superseded). This is the ONLY
// partition-root join site; nodeRecordPath / presenceRecordPath build FROM it. The
// literal "mesh" leaf is the seam's own choice (the contract pins only node-id-keyed,
// under the .aof home, git-tracked) — renameable without a contract change.
export function meshDir(workspace) {
  return path.join(aofHome(workspace), "mesh");
}

// The node id is coerced to ONE FLAT leaf segment before it becomes a path: any
// directory separator (and the parent-traversal `..`) collapses to a single `-`, so a
// node-id-keyed path can NEVER escape nodes/ into a parent or a nested directory (the
// trust-boundary the partition rests on, ADR-002 invariant — "the seam never lets an
// id become a multi-segment path", feature 01). This is a PATH-SAFETY coercion at the
// seam, NOT id POLICY (id derivation/sanitization is story 01's node-identity
// mechanic); it only guarantees the structural one-leaf-per-node invariant holds even
// for a malformed id. An already-flat id (build-server, laptop-a1b2) is unchanged.
function flatLeaf(id) {
  return String(id).replace(/[\\/]/g, "-").replace(/\.\.+/g, "-");
}

// The ONLY node-record path builder — built FROM meshDir, keyed by node id: exactly
// one flat nodes/<id>.json leaf directly under the partition root.
export function nodeRecordPath(workspace, id) {
  return path.join(meshDir(workspace), "nodes", flatLeaf(id) + ".json");
}

// RESERVED shape (named, not built — milestone 23 builds the presence dimension):
// per-node presence/heartbeat record, the same one-node-per-path partition form.
// Routed through the SAME flatLeaf trust boundary nodeRecordPath uses, so the reserved
// seam is uniformly path-traversal-safe BEFORE m23 builds on it (a flat id like
// umair-desktop is unchanged by flatLeaf).
export function presenceRecordPath(workspace, id) {
  return path.join(meshDir(workspace), "presence", flatLeaf(id) + ".json");
}

// RESERVED shape (named, not built — milestone 26 story 01 builds the lease writes;
// 26/ADR-003.1, the m22→m23 seam-reservation idiom presenceRecordPath set): the
// per-(item, contender) lease claim record — a node claims item <itemRef> by writing
// its OWN file, one contender per path, so every lease merge is add-only (the
// 22/ADR-002 partition invariant holds STRICTLY for leases; a contested same-path
// lease file would wedge the sync bus on a content conflict). Routed through the
// SAME flatLeaf trust boundary as nodeRecordPath/presenceRecordPath, so the reserved
// seam is path-traversal-safe BEFORE story 01 builds on it. This is a PURE path
// builder — it WRITES NOTHING (story 01 builds the writes).
export function leaseClaimPath(workspace, itemRef, nodeId) {
  return path.join(meshDir(workspace), "leases", flatLeaf(itemRef), flatLeaf(nodeId) + ".json");
}

// RESERVED shape (named, not built — milestone 27 story 01 builds the directive
// writes; 27/ADR-001.1, the m22→m23→m26 seam-reservation idiom presenceRecordPath/
// leaseClaimPath set): the per-ISSUER partitioned issuance directive record — an
// issuer offers item <itemRef> by writing its OWN file, one issuer per path, so
// every directive merge is add-only (the 22/ADR-002 partition invariant holds
// STRICTLY for issuance; a contested same-path directive file would wedge the sync
// bus on a content conflict — two issuers of the SAME item write DISTINCT paths).
// Routed through the SAME flatLeaf trust boundary as nodeRecordPath/
// presenceRecordPath/leaseClaimPath, so the reserved seam is path-traversal-safe
// BEFORE story 01 builds on it. This is a PURE path builder — it WRITES NOTHING
// (story 01 builds the writes, behind mesh:issue).
export function issuanceDirectivePath(workspace, issuerNodeId, itemRef) {
  return path.join(meshDir(workspace), "issuance", flatLeaf(issuerNodeId), flatLeaf(itemRef) + ".json");
}

// Re-export 19's frozen run seam — and 26's node-partitioned builder (the ADR-002
// "compose-with-19" convention: runRecordPath with one <node>/ segment before the
// run-id leaf), whose authority now lives beside it in run-store.mjs — so the
// composition can be asserted against the same reference the convention adopts (no
// divergent run-path builder lives here; 26/ADR-001.1 — a home change, not a
// contract change).
export { runsDir, runRecordPath, runNodeRecordPath };

// ------------------------------------------------- opaque per-node persist ----

// Publish a node's record as exactly ONE git-tracked nodes/<id>.json, written
// atomically (writeText temp+rename, 19/R2). The record is persisted OPAQUE / AS-IS
// — pretty JSON, no normalization, no schema reshaping: unknown additive keys and
// nested mixed-type values survive byte-equivalent + key-order-preserved (ADR-003 is
// additive-friendly; the store never interprets a record it is handed). The mkdir is
// belt-and-braces (writeText also mkdir's its dirname) and joins the nodes/ seam —
// the store's only fs write site (the write-scope guard, fitness #2).
export async function publishNodeRecord(workspace, id, record) {
  await mkdir(path.join(meshDir(workspace), "nodes"), { recursive: true });
  await writeText(nodeRecordPath(workspace, id), JSON.stringify(record, null, 2));
}

// Read ONE node record by id, parsed off disk. Absence-tolerant: a node id with no
// record on disk (ENOENT, or any read miss) reads as null — a peer not yet synced is
// not an error, NEVER a thrown error (the run-store ENOENT→absent discipline). A read
// mutates nothing.
export async function readNodeRecord(workspace, id) {
  try {
    return JSON.parse(await readFile(nodeRecordPath(workspace, id), "utf8"));
  } catch {
    return null;
  }
}

// Read every published node record under nodes/, parsed. Absence-tolerant: no
// nodes/ dir ⇒ [] (the same absence-is-benign discipline). A torn/unparseable file
// is skipped rather than blinding the whole list — the records are derived/rebuildable.
// (Story 01's mesh:status consumes this.)
export async function readNodeRecords(workspace) {
  let entries = [];
  try {
    entries = await readdir(path.join(meshDir(workspace), "nodes"));
  } catch {
    return [];
  }
  const records = [];
  for (const name of entries) {
    if (!name.endsWith(".json")) continue;
    try {
      records.push(JSON.parse(await readFile(path.join(meshDir(workspace), "nodes", name), "utf8")));
    } catch {
      continue;
    }
  }
  return records;
}
