// src/mesh-store.mjs — the mesh-store: the path-partition seam (ADR-002), the
// frozen node-record schema's opaque per-node persist/read (ADR-003), addressed
// only by node id. The low-fan-out SPINE the mesh:* commands (stories 01/02) and
// milestones 23/24/26 all couple through — the exact role src/run-store.mjs plays
// for the run dimension (milestone 22 story 00).
//
// THE PARTITION INVARIANT (ADR-002, frozen): every mesh record file is owned and
// addressed by EXACTLY ONE node id, built from a SINGLE seam (meshDir/nodeRecordPath),
// so two nodes never write the same path. The active mesh root is machine-global, not
// repository-local; WebSocket streams and global projections are the sync surface, not
// a per-workspace git bus. There is NO shared or aggregate file two nodes co-write
// (no nodes.json roster).
//
// Mesh is AOF runtime state — a cross-cutting, extensible concept (planning too, not
// only the work stream) — so the active mesh store anchors in the global AOF home
// (`AOF_GLOBAL_HOME` or `~/.aof`), outside project `.aof` output/config.
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
// 34/story 00 — mesh state is machine-wide GLOBAL (the operator directive): the roster/
// presence/coordination live in the global AOF home, not per-project `.aof/mesh/`.
import { globalMeshPaths } from "./workspace.mjs";

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

// THE single partition-root seam. MACHINE-WIDE GLOBAL as of 34/story 00 (operator
// directive): mesh is a machine fact, NOT per-project — the node roster, presence, and
// coordination state live in the GLOBAL AOF home (globalMeshPaths().meshRoot, honoring
// AOF_GLOBAL_HOME), initialized once per machine, propagated between machines over the
// WebSocket stream (ADR-007) — NOT the git bus (the git-bus mesh transport is retired;
// see ADR-007). No `workspace` anchor anymore — every workspace on the machine sees the
// SAME mesh home. `loadWorkspace` injects the resolved globalMeshRoot so tests and
// subprocess callers that set AOF_GLOBAL_HOME stay hermetic; synthetic workspaces fall
// back to the process default global home.
export function meshDir(workspace) {
  if (typeof workspace?.globalMeshRoot === "string" && workspace.globalMeshRoot.length > 0) {
    return workspace.globalMeshRoot;
  }
  return globalMeshPaths().meshRoot;
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

// Re-export 19's frozen run seam — and 26's node-partitioned builder (the ADR-002
// "compose-with-19" convention: runRecordPath with one <node>/ segment before the
// run-id leaf), whose authority now lives beside it in run-store.mjs — so the
// composition can be asserted against the same reference the convention adopts (no
// divergent run-path builder lives here; 26/ADR-001.1 — a home change, not a
// contract change).
export { runsDir, runRecordPath, runNodeRecordPath };

// ------------------------------------------------- opaque per-node persist ----

// Publish a node's record as exactly ONE global nodes/<id>.json, written
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
