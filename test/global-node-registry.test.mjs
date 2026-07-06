import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { openGlobalWorkProjectionStore, workspaceIdFor } from "../src/global-work-store.mjs";
import { publishGlobalWorkSnapshot } from "../src/global-work-publisher.mjs";
import { publishGlobalRegistryDescriptorsToStore, queryGlobalRegistry } from "../src/global-node-registry.mjs";
import { nodeRecordPath, publishNodeRecord } from "../src/mesh-store.mjs";
import { publishPresenceRecord } from "../src/mesh-presence.mjs";
import { globalMeshPaths } from "../src/workspace.mjs";

const NOW = "2026-07-04T10:02:00.000Z";

async function withTemp(fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-global-node-registry-"));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function makeWorkspace(root, { name = "alpha", mesh = {} } = {}) {
  const workDir = path.join(root, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(root, ".aof"), { recursive: true });
  await writeFile(
    path.join(root, ".aof", "aof.config.json"),
    `${JSON.stringify({ name, work: { dir: "./wiki/work" }, mesh: { enabled: true, ...mesh } }, null, 2)}\n`,
    "utf8",
  );
  return await loadWorkspace(root);
}

async function seedNode(workspace, nodeId, fields = {}) {
  const record = {
    nodeId,
    host: fields.host ?? nodeId,
    os: fields.os ?? "win32",
    runtimes: fields.runtimes ?? ["codex"],
    skills: fields.skills ?? ["aof-refine"],
    aofVersion: fields.aofVersion ?? "1.2.3",
    publishedAt: fields.publishedAt ?? "2026-07-04T10:00:00.000Z",
    ...fields.extra,
  };
  await publishNodeRecord(workspace, nodeId, record);
  return record;
}

async function seedPresence(workspace, nodeId, heartbeatAt) {
  await publishPresenceRecord(workspace, nodeId, { nodeId, heartbeatAt, activeRuns: [], aofVersion: "1.2.3" });
}

function openStore(home) {
  return openGlobalWorkProjectionStore({ env: { AOF_GLOBAL_HOME: home } });
}

export const globalNodeRegistryTests = [
  {
    name: "global-node-registry/00 publishes node descriptors by joining node, presence, fabric, and workspace signals",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const ws = await makeWorkspace(path.join(tmp, "alpha"), {
        mesh: { nodeId: "node-a", relay: { controlNode: "control-node" } },
      });
      await seedNode(ws, "node-a", { host: "alpha", os: "win32", runtimes: ["codex"], skills: ["aof-refine"] });
      await seedPresence(ws, "node-a", "2026-07-04T10:01:00.000Z");

      const store = await openStore(home);
      try {
        const result = await publishGlobalRegistryDescriptorsToStore(store, ws, {
          now: NOW,
          fabricPeers: [{ nodeId: "node-a", dialAddress: "ws://alpha.tailnet:7007", online: true, host: "alpha" }],
        });
        assert.equal(result.nodeCount, 1);
        const descriptorPath = path.join(globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } }).nodesRoot, "node-a.json");
        const descriptor = JSON.parse(await readFile(descriptorPath, "utf8"));
        assert.equal(descriptor.nodeId, "node-a");
        assert.equal(descriptor.host, "alpha");
        assert.equal(descriptor.os, "win32");
        assert.deepEqual(descriptor.runtimes, ["codex"]);
        assert.equal(descriptor.role, "worker");
        assert.equal(descriptor.controlNode, false);
        assert.equal(descriptor.fabric.address, "ws://alpha.tailnet:7007");
        assert.equal(descriptor.fabric.online, true);
        assert.equal(descriptor.lastSeenAt, "2026-07-04T10:01:00.000Z");
        assert.equal(descriptor.workspaces[0].workspaceId, workspaceIdFor(ws.projectRoot));

        const row = store.db.prepare("SELECT * FROM global_nodes WHERE node_id = ?").get("node-a");
        assert.equal(row.node_id, "node-a");
        assert.equal(row.fabric_address, "ws://alpha.tailnet:7007");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-node-registry/00 a nominated relay control node is rendered with control role",
    run: async () => withTemp(async (tmp) => {
      const store = await openStore(path.join(tmp, "home"));
      try {
        const ws = await makeWorkspace(path.join(tmp, "alpha"), {
          mesh: { nodeId: "node-a", relay: { controlNode: "node-a" } },
        });
        await seedNode(ws, "node-a");
        await publishGlobalRegistryDescriptorsToStore(store, ws, { now: NOW });
        const row = store.db.prepare("SELECT role, control_node, descriptor_path FROM global_nodes WHERE node_id = ?").get("node-a");
        assert.equal(row.role, "control");
        assert.equal(row.control_node, 1);
        const descriptor = JSON.parse(await readFile(row.descriptor_path, "utf8"));
        assert.equal(descriptor.role, "control");
        assert.equal(descriptor.controlNode, true);
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-node-registry/00 fabric-only peers are represented as incomplete nodes instead of disappearing",
    run: async () => withTemp(async (tmp) => {
      const store = await openStore(path.join(tmp, "home"));
      try {
        const ws = await makeWorkspace(path.join(tmp, "alpha"));
        await publishGlobalRegistryDescriptorsToStore(store, ws, {
          now: NOW,
          fabricPeers: [{ dialAddress: "ws://beta.tailnet:7007", online: true, host: "beta" }],
        });
        const descriptor = JSON.parse(await readFile(path.join(store.paths.nodesRoot, "beta.json"), "utf8"));
        assert.equal(descriptor.nodeId, "beta");
        assert.equal(descriptor.host, "beta");
        assert.equal(descriptor.fabric.address, "ws://beta.tailnet:7007");
        assert.equal(descriptor.recordSource, "fabric");
        assert.deepEqual(descriptor.runtimes, []);
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-node-registry/01 workspace descriptors are stable and membership is replaced from the current snapshot",
    run: async () => withTemp(async (tmp) => {
      const store = await openStore(path.join(tmp, "home"));
      try {
        const ws = await makeWorkspace(path.join(tmp, "alpha"), { mesh: { relay: { controlNode: "node-a" } } });
        await seedNode(ws, "node-a");
        await seedNode(ws, "node-b");
        await publishGlobalRegistryDescriptorsToStore(store, ws, { now: "2026-07-04T10:03:00.000Z" });
        const workspaceId = workspaceIdFor(ws.projectRoot);
        const first = store.db.prepare("SELECT * FROM global_workspace_descriptors WHERE workspace_id = ?").get(workspaceId);
        const descriptor = JSON.parse(await readFile(first.descriptor_path, "utf8"));
        assert.equal(descriptor.workspaceId, workspaceId);
        assert.equal(descriptor.projectRoot, path.resolve(ws.projectRoot));
        assert.equal(descriptor.workDir, "./wiki/work");
        assert.equal(descriptor.meshEnabled, true);
        assert.deepEqual(descriptor.memberNodeIds, ["node-a", "node-b"]);

        await unlink(nodeRecordPath(ws, "node-b"));
        await publishGlobalRegistryDescriptorsToStore(store, ws, { now: "2026-07-04T10:04:00.000Z" });
        const second = store.db.prepare("SELECT * FROM global_workspace_descriptors WHERE workspace_id = ?").get(workspaceId);
        assert.equal(second.descriptor_path, first.descriptor_path);
        const updated = JSON.parse(await readFile(second.descriptor_path, "utf8"));
        assert.deepEqual(updated.memberNodeIds, ["node-a"]);
        assert.equal(store.db.prepare("SELECT COUNT(*) AS count FROM global_node_workspaces WHERE workspace_id = ? AND node_id = ?").get(workspaceId, "node-b").count, 0);
        assert.ok(existsSync(path.join(store.paths.nodesRoot, "node-b.json")), "the prior node descriptor is not deleted by this workspace update");
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-node-registry/01 non-mesh workspaces skip descriptor publication before opening the store",
    run: async () => withTemp(async (tmp) => {
      const home = path.join(tmp, "home");
      const ws = await makeWorkspace(path.join(tmp, "alpha"), { mesh: { enabled: false, nodeId: "node-a" } });
      const result = await publishGlobalWorkSnapshot(ws, { globalWorkStoreOptions: { env: { AOF_GLOBAL_HOME: home } } });
      assert.equal(result.code, "mesh-global-disabled");
      const paths = globalMeshPaths({ env: { AOF_GLOBAL_HOME: home } });
      assert.equal(existsSync(paths.nodesRoot), false);
      assert.equal(existsSync(paths.workspacesRoot), false);
    }),
  },
  {
    name: "global-node-registry/02 descriptors and index rows redact credential and secret-looking fields",
    run: async () => withTemp(async (tmp) => {
      const store = await openStore(path.join(tmp, "home"));
      try {
        const ws = await makeWorkspace(path.join(tmp, "alpha"), {
          mesh: {
            nodeId: "node-a",
            relay: { controlNode: "node-a" },
            relayAuth: "plaintext-token",
          },
        });
        await seedNode(ws, "node-a", {
          extra: {
            token: "sensitive",
            secret: "sensitive",
            credential: "sensitive",
            relayAuth: "sensitive",
            relayAuthHash: "hashed-token",
            accessToken: "sensitive",
          },
        });
        await publishGlobalRegistryDescriptorsToStore(store, ws, { now: NOW });
        const nodeText = await readFile(path.join(store.paths.nodesRoot, "node-a.json"), "utf8");
        const workspaceText = await readFile(path.join(store.paths.workspacesRoot, `${workspaceIdFor(ws.projectRoot)}.json`), "utf8");
        assert.ok(!nodeText.includes("sensitive"));
        assert.ok(!nodeText.includes("relayAuth"));
        assert.ok(!nodeText.includes("hashed-token"));
        assert.ok(!workspaceText.includes("plaintext-token"));
        assert.ok(!workspaceText.includes('"mesh"'));
        assert.match(workspaceText, /"meshEnabled": true/);
        assert.ok(!JSON.stringify(store.db.prepare("SELECT * FROM global_nodes WHERE node_id = ?").get("node-a")).includes("sensitive"));
      } finally {
        store.close();
      }
    }),
  },
  {
    name: "global-node-registry/03 query returns freshness, supports workspace/role filters, and reports corrupt descriptors",
    run: async () => withTemp(async (tmp) => {
      const store = await openStore(path.join(tmp, "home"));
      try {
        const alpha = await makeWorkspace(path.join(tmp, "alpha"), {
          name: "alpha",
          mesh: { nodeId: "node-a", relay: { controlNode: "node-a" }, presence: { stalenessSeconds: 60 } },
        });
        await seedNode(alpha, "node-a");
        await seedNode(alpha, "node-b");
        await seedNode(alpha, "node-c");
        await seedPresence(alpha, "node-a", "2026-07-04T10:00:30.000Z");
        await seedPresence(alpha, "node-b", "2026-07-04T09:59:00.000Z");
        await publishGlobalRegistryDescriptorsToStore(store, alpha, { now: NOW });

        // A machine has ONE control node (34/story 06): both workspaces point at node-a.
        const beta = await makeWorkspace(path.join(tmp, "beta"), { name: "beta", mesh: { relay: { controlNode: "node-a" } } });
        await seedNode(beta, "node-z");
        await publishGlobalRegistryDescriptorsToStore(store, beta, { now: NOW });

        const queried = await queryGlobalRegistry(store, {
          now: "2026-07-04T10:01:00.000Z",
          stalenessSeconds: 60,
        });
        const byId = new Map(queried.nodes.map((node) => [node.nodeId, node]));
        assert.equal(byId.get("node-a").freshness, "live");
        assert.equal(byId.get("node-b").freshness, "stale");
        assert.equal(byId.get("node-c").freshness, "unknown");

        // 34/story 06 — a workspaceId no longer narrows the NODE roster (nodes are
        // machine-wide); it scopes WORK ITEMS. Only the role filter narrows nodes here.
        const filtered = await queryGlobalRegistry(store, {
          workspaceId: workspaceIdFor(alpha.projectRoot),
          role: "worker",
          now: "2026-07-04T10:01:00.000Z",
        });
        assert.ok(filtered.nodes.every((node) => node.role === "worker"), "the role filter narrows to workers");
        assert.deepEqual(filtered.nodes.map((node) => node.nodeId).sort(), ["node-b", "node-c", "node-z"], "every worker surfaces — the workspace filter does NOT drop machine-wide nodes");

        await writeFile(path.join(store.paths.nodesRoot, "node-b.json"), "{not-json", "utf8");
        const corrupt = await queryGlobalRegistry(store, { now: "2026-07-04T10:01:00.000Z" });
        assert.ok(corrupt.nodes.some((node) => node.nodeId === "node-a"));
        assert.ok(corrupt.nodes.some((node) => node.nodeId === "node-c"));
        assert.ok(corrupt.errors.some((error) => error.id === "node-b"));
        assert.ok(existsSync(path.join(store.paths.nodesRoot, "node-b.json")), "the corrupt descriptor is left in place");
      } finally {
        store.close();
      }
    }),
  },
];
