import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { globalMeshPaths } from "./workspace.mjs";
import { workspaceIdFor } from "./global-work-store.mjs";
import { readNodeRecords } from "./mesh-store.mjs";
// milestone 38 / story 00 / task 08 (finding F6) — `readPresenceRecord` +
// `assemblePresenceRecord` are the SAME seam mesh:status's diskPresence read
// (src/commands/mesh-identity.mjs ~line 218) already uses; queryGlobalRegistry
// reuses them rather than inventing a second presence reader.
import { readPresenceRecords, readPresenceRecord, assemblePresenceRecord } from "./mesh-presence.mjs";
import { resolvePeers } from "./mesh-fabric.mjs";
import { writeText } from "./fs.mjs";
import { resolveCloneUrl } from "./mesh-worker-execution.mjs";

const SECRET_KEY_PATTERN = /(token|secret|credential|auth|invite|hash)/i;

export async function publishGlobalRegistryDescriptorsToStore(store, workspace, options = {}) {
  const paths = store.paths ?? globalMeshPaths(options);
  const now = options.now ?? new Date().toISOString();

  await mkdir(paths.nodesRoot, { recursive: true });
  await mkdir(paths.workspacesRoot, { recursive: true });
  const staleFabricDescriptorPaths = fabricOnlyDescriptorPaths(store);
  await removeStaleFabricDescriptors(staleFabricDescriptorPaths, paths.nodesRoot, []);

  const snapshot = await assembleGlobalRegistrySnapshot(workspace, { ...options, now, paths });

  await writeDescriptor(snapshot.workspaceDescriptorPath, snapshot.workspaceDescriptor);
  for (const descriptor of snapshot.nodeDescriptors) {
    await writeDescriptor(descriptor.descriptorPath, descriptor);
  }

  upsertGlobalRegistryRows(store, snapshot);
  await removeStaleFabricDescriptors(staleFabricDescriptorPaths, paths.nodesRoot, snapshot.nodeDescriptors);

  return {
    workspaceId: snapshot.workspaceDescriptor.workspaceId,
    nodeCount: snapshot.nodeDescriptors.length,
    publishedAt: now,
  };
}

export async function assembleGlobalRegistrySnapshot(workspace, options = {}) {
  const paths = options.paths ?? globalMeshPaths(options);
  const now = options.now ?? new Date().toISOString();
  const config = workspace.config ?? {};
  const workspaceId = config?.mesh?.workspaceId ?? workspaceIdFor(workspace.projectRoot);
  const nodeRecords = await readNodeRecords(workspace);
  const presenceRecords = await readPresenceRecords(workspace);
  const fabricPeers = Array.isArray(options.fabricPeers)
    ? options.fabricPeers
    : config?.mesh?.fabric != null
      ? await resolvePeers(config, { ...options, roster: nodeRecords })
      : [];

  const presenceById = new Map();
  for (const presence of presenceRecords) {
    if (typeof presence?.nodeId === "string") presenceById.set(presence.nodeId, presence);
  }

  const recordsById = new Map();
  for (const record of nodeRecords) {
    if (typeof record?.nodeId === "string" && record.nodeId.length > 0) recordsById.set(record.nodeId, record);
  }

  const peersById = new Map();
  for (const peer of fabricPeers) {
    const peerId = joinedMeshPeerId(peer, recordsById);
    if (peerId) peersById.set(peerId, { ...peer, nodeId: peerId });
  }

  const nodeIds = [...recordsById.keys()].sort();

  const workspaceMembership = {
    workspaceId,
    name: config.name ?? null,
    projectRoot: path.resolve(workspace.projectRoot),
  };

  const nodeDescriptors = nodeIds.map((nodeId) => {
    const record = recordsById.get(nodeId) ?? {};
    const peer = peersById.get(nodeId) ?? {};
    const presence = presenceById.get(nodeId) ?? null;
    const controlNode = config?.mesh?.relay?.controlNode === nodeId;
    const descriptor = {
      nodeId,
      role: controlNode ? "control" : "worker",
      controlNode,
      host: safeString(record.host ?? peer.host),
      os: safeString(record.os),
      runtimes: safeStringArray(record.runtimes),
      aofVersion: safeString(record.aofVersion),
      publishedAt: safeString(record.publishedAt) || now,
      lastSeenAt: typeof presence?.heartbeatAt === "string" ? presence.heartbeatAt : null,
      fabric: {
        address: typeof peer.dialAddress === "string" ? peer.dialAddress : null,
        online: typeof peer.online === "boolean" ? peer.online : null,
      },
      recordSource: "node-record",
      workspaces: [workspaceMembership],
      descriptorPath: path.join(paths.nodesRoot, `${flatLeaf(nodeId)}.json`),
    };
    return descriptor;
  });

  // FINDING F11 (aof:verify 38, BLOCKER) — the write-side half of the fix. This
  // used to write config.work.dir VERBATIM (the raw, often-RELATIVE `./wiki/work`
  // string), so `resolveNodeWorkspaces` (mesh-presence.mjs) later resolved it
  // against the READER's cwd, not this workspace's own project root — the exact
  // "presence resolves zero/wrong workspaces from a foreign cwd" bug ADR-003 exists
  // to kill. `path.resolve(root, dir)` returns `dir` unchanged when `dir` is already
  // absolute, so a workspace with an absolute configured work dir is unaffected;
  // a RELATIVE `config.work.dir` (or an absent one, falling back to the already-
  // resolved `workspace.workDir` loadWorkspace computed) is resolved HERE, against
  // this workspace's OWN `projectRoot` — never the publisher's launch cwd — so every
  // row this seam writes is canonical/absolute at rest.
  const resolvedProjectRoot = path.resolve(workspace.projectRoot);
  const resolvedWorkDir = path.resolve(
    resolvedProjectRoot,
    typeof config?.work?.dir === "string" ? config.work.dir : (workspace.workDir ?? "./wiki/work"),
  );

  const workspaceDescriptor = {
    workspaceId,
    projectRoot: resolvedProjectRoot,
    workDir: resolvedWorkDir,
    name: config.name ?? null,
    meshEnabled: config?.mesh?.enabled === true,
    controlNode: typeof config?.mesh?.relay?.controlNode === "string" ? config.mesh.relay.controlNode : null,
    // milestone 38 (ADR-010 Gap A, extended) — the SAME raw config.mesh.repo.cloneUrl
    // read resolveCloneUrl already uses for the PUBLISHING node's own launch
    // workspace, carried into the SYNCED descriptor so a worker that has never
    // checked this workspace out can still resolve its clone source (mesh-
    // presence.mjs's resolveWorkspaceCloneUrl, the sibling of resolveWorkspaceProjectRoot).
    // null when this workspace has never been `aof mesh repo publish`ed — never
    // fabricated, never a second URL-shape validator.
    cloneUrl: resolveCloneUrl(workspace),
    publishedAt: now,
    memberNodeIds: nodeIds,
  };
  const workspaceDescriptorPath = path.join(paths.workspacesRoot, `${flatLeaf(workspaceId)}.json`);

  return {
    workspaceDescriptor,
    workspaceDescriptorPath,
    nodeDescriptors,
  };
}

export async function queryGlobalRegistry(store, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const thresholdMs = (typeof options.stalenessSeconds === "number" ? options.stalenessSeconds : 60) * 1000;
  const workspaceFilter = options.workspaceId ?? options.workspace ?? null;
  const roleFilter = options.role ?? null;
  const db = store.db;
  // finding F6 (aof:verify 38) — the fleet read route's ONE presence seam: the
  // SAME machine-wide mesh root queryGlobalMeshStatus's callers already resolve
  // (store.paths, threaded from globalMeshPaths at store-open time), reused here
  // as the workspace-shaped anchor readPresenceRecord expects (meshDir(workspace)
  // reads workspace.globalMeshRoot). No second path-resolution rule.
  const paths = store.paths ?? globalMeshPaths(options);
  const presenceWorkspace = { globalMeshRoot: paths.meshRoot };

  const workspaceRows = workspaceFilter
    ? db.prepare("SELECT * FROM global_workspace_descriptors WHERE workspace_id = ? ORDER BY workspace_id").all(workspaceFilter)
    : db.prepare("SELECT * FROM global_workspace_descriptors ORDER BY workspace_id").all();

  // 34/story 02 — nodes are a MACHINE-WIDE fact: the roster is never workspace-filtered
  // (a workspaceId scopes WORK ITEMS, not the node roster). Only the role filter applies.
  let nodeRows = db.prepare("SELECT * FROM global_nodes WHERE COALESCE(record_source, 'node-record') != 'fabric' ORDER BY node_id").all();
  if (roleFilter) nodeRows = nodeRows.filter((row) => row.role === roleFilter);

  const errors = [];
  const nodes = [];
  for (const row of nodeRows) {
    const descriptor = await readDescriptor(row.descriptor_path, errors, row.node_id);
    if (!descriptor) continue;
    const memberships = db.prepare(`
      SELECT workspace_id FROM global_node_workspaces WHERE node_id = ? ORDER BY workspace_id
    `).all(row.node_id).map((entry) => entry.workspace_id);
    const node = {
      ...descriptor,
      freshness: freshnessFor(row.last_seen_at, now, thresholdMs),
      workspaceIds: memberships, // nodes are machine-wide; never narrowed by a workspace filter (34/story 02)
    };
    // finding F6 — ADDITIVE: carry the node's presence record ALONGSIDE the
    // pre-existing `freshness` ramp (unchanged), so no existing consumer breaks.
    // A never-beat node (readPresenceRecord ⇒ null) OMITS `presence` entirely —
    // never a fabricated empty record. When a record exists, it is reshaped
    // through assemblePresenceRecord ONLY to guarantee the frozen FIVE-key
    // order (ADR-001); sessions[]/activeRuns travel through EXACTLY as the
    // publisher emitted them — no liveness/subsumption is recomputed here.
    const diskPresence = await readPresenceRecord(presenceWorkspace, row.node_id);
    if (diskPresence) node.presence = assemblePresenceRecord(diskPresence);
    nodes.push(node);
  }

  const workspaces = [];
  for (const row of workspaceRows) {
    const descriptor = await readDescriptor(row.descriptor_path, errors, row.workspace_id);
    if (descriptor) workspaces.push(descriptor);
  }

  return { nodes, workspaces, errors };
}

export function upsertGlobalRegistryRows(store, snapshot) {
  const db = store.db;
  const workspace = snapshot.workspaceDescriptor;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare(`
      INSERT INTO global_workspace_descriptors (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path, clone_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        project_root = excluded.project_root,
        work_dir = excluded.work_dir,
        name = excluded.name,
        mesh_enabled = excluded.mesh_enabled,
        control_node = excluded.control_node,
        member_node_ids_json = excluded.member_node_ids_json,
        published_at = excluded.published_at,
        descriptor_path = excluded.descriptor_path,
        clone_url = excluded.clone_url
    `).run(
      workspace.workspaceId,
      workspace.projectRoot,
      workspace.workDir,
      workspace.name,
      workspace.meshEnabled ? 1 : 0,
      workspace.controlNode,
      JSON.stringify(workspace.memberNodeIds),
      workspace.publishedAt,
      snapshot.workspaceDescriptorPath,
      workspace.cloneUrl,
    );

    db.prepare("DELETE FROM global_node_workspaces WHERE node_id IN (SELECT node_id FROM global_nodes WHERE record_source = 'fabric')").run();
    db.prepare("DELETE FROM global_nodes WHERE record_source = 'fabric'").run();
    db.prepare("DELETE FROM global_node_workspaces WHERE workspace_id = ?").run(workspace.workspaceId);

    const upsertNode = db.prepare(`
      INSERT INTO global_nodes (node_id, role, control_node, host, os, runtimes_json, skills_json, aof_version, published_at, last_seen_at, fabric_address, fabric_online, record_source, descriptor_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(node_id) DO UPDATE SET
        role = excluded.role,
        control_node = excluded.control_node,
        host = excluded.host,
        os = excluded.os,
        runtimes_json = excluded.runtimes_json,
        skills_json = excluded.skills_json,
        aof_version = excluded.aof_version,
        published_at = excluded.published_at,
        last_seen_at = excluded.last_seen_at,
        fabric_address = excluded.fabric_address,
        fabric_online = excluded.fabric_online,
        record_source = excluded.record_source,
        descriptor_path = excluded.descriptor_path
    `);
    const link = db.prepare("INSERT OR REPLACE INTO global_node_workspaces (node_id, workspace_id) VALUES (?, ?)");
    for (const node of snapshot.nodeDescriptors) {
      upsertNode.run(
        node.nodeId,
        node.role,
        node.controlNode ? 1 : 0,
        node.host,
        node.os,
        JSON.stringify(node.runtimes),
        JSON.stringify(node.skills ?? []), // skills removed from the descriptor (34/story 02); column kept vestigial to avoid a schema migration
        node.aofVersion,
        node.publishedAt,
        node.lastSeenAt,
        node.fabric.address,
        node.fabric.online == null ? null : node.fabric.online ? 1 : 0,
        node.recordSource,
        node.descriptorPath,
      );
      link.run(node.nodeId, workspace.workspaceId);
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function freshnessFor(lastSeenAt, now, thresholdMs) {
  if (typeof lastSeenAt !== "string" || lastSeenAt.length === 0) return "unknown";
  const seenMs = Date.parse(lastSeenAt);
  const nowMs = Date.parse(now);
  if (!Number.isFinite(seenMs) || !Number.isFinite(nowMs)) return "unknown";
  return nowMs - seenMs > thresholdMs ? "stale" : "live";
}

async function readDescriptor(filePath, errors, id) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    errors.push({ id, path: filePath, code: error.code ?? "descriptor-unparseable", message: error.message });
    return null;
  }
}

async function writeDescriptor(filePath, descriptor) {
  await writeText(filePath, `${JSON.stringify(redactDescriptor(descriptor), null, 2)}\n`);
}

export function redactDescriptor(value) {
  if (Array.isArray(value)) return value.map((entry) => redactDescriptor(entry));
  if (value == null || typeof value !== "object") return value;
  const output = {};
  for (const [key, child] of Object.entries(value)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    output[key] = redactDescriptor(child);
  }
  return output;
}

function joinedMeshPeerId(peer, recordsById) {
  if (typeof peer?.nodeId !== "string" || peer.nodeId.length === 0) return null;
  return recordsById.has(peer.nodeId) ? peer.nodeId : null;
}

function fabricOnlyDescriptorPaths(store) {
  return store.db.prepare("SELECT descriptor_path FROM global_nodes WHERE record_source = 'fabric'").all()
    .map((row) => row.descriptor_path)
    .filter((entry) => typeof entry === "string" && entry.length > 0);
}

async function removeStaleFabricDescriptors(filePaths, nodesRoot, currentDescriptors) {
  if (filePaths.length === 0) return;
  const rootKey = pathKey(nodesRoot);
  const keep = new Set(currentDescriptors.map((descriptor) => pathKey(descriptor.descriptorPath)));
  for (const filePath of filePaths) {
    const resolved = path.resolve(filePath);
    const key = pathKey(resolved);
    if (keep.has(key)) continue;
    if (!key.startsWith(`${rootKey}${path.sep}`)) continue;
    if (!(await isFabricOnlyDescriptor(resolved))) continue;
    try {
      await rm(resolved, { force: true });
    } catch {
      // Stale descriptors are best-effort cleanup; database rows are already pruned.
    }
  }
}

async function isFabricOnlyDescriptor(filePath) {
  try {
    const descriptor = JSON.parse(await readFile(filePath, "utf8"));
    return descriptor?.recordSource === "fabric";
  } catch {
    return false;
  }
}

function pathKey(filePath) {
  const resolved = path.resolve(filePath);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function safeString(value) {
  return typeof value === "string" ? value : "";
}

function safeStringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function flatLeaf(id) {
  return String(id).replace(/[\\/]/g, "-").replace(/\.\.+/g, "-");
}
