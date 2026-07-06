import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { globalMeshPaths } from "./workspace.mjs";
import { workspaceIdFor } from "./global-work-store.mjs";
import { readNodeRecords } from "./mesh-store.mjs";
import { readPresenceRecords } from "./mesh-presence.mjs";
import { resolvePeers } from "./mesh-fabric.mjs";
import { writeText } from "./fs.mjs";

const SECRET_KEY_PATTERN = /(token|secret|credential|auth|invite|hash)/i;

export async function publishGlobalRegistryDescriptorsToStore(store, workspace, options = {}) {
  const paths = store.paths ?? globalMeshPaths(options);
  const now = options.now ?? new Date().toISOString();
  const snapshot = await assembleGlobalRegistrySnapshot(workspace, { ...options, now, paths });

  await mkdir(paths.nodesRoot, { recursive: true });
  await mkdir(paths.workspacesRoot, { recursive: true });

  await writeDescriptor(snapshot.workspaceDescriptorPath, snapshot.workspaceDescriptor);
  for (const descriptor of snapshot.nodeDescriptors) {
    await writeDescriptor(descriptor.descriptorPath, descriptor);
  }

  upsertGlobalRegistryRows(store, snapshot);

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
    const peerId = fabricPeerId(peer);
    if (peerId) peersById.set(peerId, { ...peer, nodeId: peerId });
  }

  const nodeIds = [];
  const seen = new Set();
  for (const id of recordsById.keys()) {
    seen.add(id);
    nodeIds.push(id);
  }
  for (const id of peersById.keys()) {
    if (!seen.has(id)) {
      seen.add(id);
      nodeIds.push(id);
    }
  }
  nodeIds.sort();

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
      recordSource: recordsById.has(nodeId) ? "node-record" : "fabric",
      workspaces: [workspaceMembership],
      descriptorPath: path.join(paths.nodesRoot, `${flatLeaf(nodeId)}.json`),
    };
    return descriptor;
  });

  const workspaceDescriptor = {
    workspaceId,
    projectRoot: path.resolve(workspace.projectRoot),
    workDir: typeof config?.work?.dir === "string" ? config.work.dir : path.resolve(workspace.workDir),
    name: config.name ?? null,
    meshEnabled: config?.mesh?.enabled === true,
    controlNode: typeof config?.mesh?.relay?.controlNode === "string" ? config.mesh.relay.controlNode : null,
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

  const workspaceRows = workspaceFilter
    ? db.prepare("SELECT * FROM global_workspace_descriptors WHERE workspace_id = ? ORDER BY workspace_id").all(workspaceFilter)
    : db.prepare("SELECT * FROM global_workspace_descriptors ORDER BY workspace_id").all();

  // 34/story 02 — nodes are a MACHINE-WIDE fact: the roster is never workspace-filtered
  // (a workspaceId scopes WORK ITEMS, not the node roster). Only the role filter applies.
  let nodeRows = db.prepare("SELECT * FROM global_nodes ORDER BY node_id").all();
  if (roleFilter) nodeRows = nodeRows.filter((row) => row.role === roleFilter);

  const errors = [];
  const nodes = [];
  for (const row of nodeRows) {
    const descriptor = await readDescriptor(row.descriptor_path, errors, row.node_id);
    if (!descriptor) continue;
    const memberships = db.prepare(`
      SELECT workspace_id FROM global_node_workspaces WHERE node_id = ? ORDER BY workspace_id
    `).all(row.node_id).map((entry) => entry.workspace_id);
    nodes.push({
      ...descriptor,
      freshness: freshnessFor(row.last_seen_at, now, thresholdMs),
      workspaceIds: memberships, // nodes are machine-wide; never narrowed by a workspace filter (34/story 02)
    });
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
      INSERT INTO global_workspace_descriptors (workspace_id, project_root, work_dir, name, mesh_enabled, control_node, member_node_ids_json, published_at, descriptor_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        project_root = excluded.project_root,
        work_dir = excluded.work_dir,
        name = excluded.name,
        mesh_enabled = excluded.mesh_enabled,
        control_node = excluded.control_node,
        member_node_ids_json = excluded.member_node_ids_json,
        published_at = excluded.published_at,
        descriptor_path = excluded.descriptor_path
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
    );

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

function fabricPeerId(peer) {
  if (typeof peer?.nodeId === "string" && peer.nodeId.length > 0) return peer.nodeId;
  if (typeof peer?.host === "string" && peer.host.length > 0) return peer.host;
  return null;
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
