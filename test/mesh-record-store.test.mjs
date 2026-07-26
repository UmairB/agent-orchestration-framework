// Traceability wiring for milestone 22 / story 00 — the mesh-record store.
//
// Covers EVERY @executable scenario in tasks/00_mesh-record-store.feature,
// exercising the REAL src/mesh-store.mjs in-process against a temp fixture
// (mkdtemp → build a workspace-shaped { workDir } → exercise → rm in finally). One
// test object per @executable scenario. node:assert/strict.
//
//   00_mesh-record-store.feature — publishing a node record writes exactly ONE
//     nodes/<id>.json under the partition root, written atomically (writeText
//     temp+rename), and reads back byte-equivalent; the record is persisted OPAQUE
//     (unknown additive keys + nested mixed types survive byte-equivalent +
//     key-order-preserved); an absent record reads as null (not an error); two ids
//     write two files (the unaffected file byte-identical); a republish overwrites
//     the node's own file and leaves a sibling byte-identical.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { meshDir } from "../src/mesh-store.mjs";

// A workspace-shaped object: the store only needs workspace.workDir (where meshDir
// — .aof/mesh/ — sits under the .aof home).
async function makeWorkspace() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-meshstore-rec-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workspace: { workDir, globalMeshRoot: path.join(repo, "global", "mesh") } };
}

// A node-record object in the frozen ADR-003 schema shape (the store persists it
// AS-IS — node-id derivation + descriptor assembly are story 01).
function nodeRecord(id, overrides = {}) {
  return {
    nodeId: id,
    host: id,
    os: "win32",
    runtimes: ["claude", "codex"],
    skills: ["acd"],
    aofVersion: "0.0.0",
    publishedAt: "2026-06-30T00:00:00.000Z",
    ...overrides,
  };
}

function nodesDir(workspace) {
  return path.join(meshDir(workspace), "nodes");
}

async function listNodeFiles(workspace) {
  try {
    return (await readdir(nodesDir(workspace))).filter((name) => name.endsWith(".json")).sort();
  } catch {
    return [];
  }
}

async function readBytes(workspace, leaf) {
  return readFile(path.join(nodesDir(workspace), leaf), "utf8");
}

export const meshRecordStoreTests = [
  {
    name: "mesh-store/00 publishing a node record persists exactly one JSON file named by the node id",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { publishNodeRecord } = await import("../src/mesh-store.mjs");
        // partition root has no nodes/ directory yet
        assert.deepEqual(await listNodeFiles(workspace), [], "no nodes/ files before the first publish");

        const record = nodeRecord("umair-desktop");
        await publishNodeRecord(workspace, "umair-desktop", record);

        const files = await listNodeFiles(workspace);
        assert.equal(files.length, 1, "the nodes/ dir contains exactly one file");
        assert.equal(files[0], "umair-desktop.json", "that file is named umair-desktop.json");
        // it lives under the global partition root meshDir.
        assert.equal(path.dirname(path.join(nodesDir(workspace), files[0])), path.join(meshDir(workspace), "nodes"), "the file is under meshDir/nodes");
        const nodesSegments = path.join(meshDir(workspace), "nodes").split(path.sep);
        assert.ok(nodesSegments.includes("mesh"), "the partition root is the global mesh home (nodes dir resolves under mesh)");

        const parsed = JSON.parse(await readBytes(workspace, files[0]));
        assert.deepEqual(parsed, record, "the file parses as JSON equal to the published node record");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/00 reading a published node record round-trips byte-equivalent",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { publishNodeRecord, readNodeRecord } = await import("../src/mesh-store.mjs");
        const record = nodeRecord("umair-desktop");
        await publishNodeRecord(workspace, "umair-desktop", record);

        const read = await readNodeRecord(workspace, "umair-desktop");
        assert.deepEqual(read, record, "the read record equals the published record");
        assert.equal(JSON.stringify(read), JSON.stringify(record), "the read record is byte-equivalent (identical serialization)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/00 a record with unknown additive keys round-trips byte-equivalent and key-order-preserved",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { publishNodeRecord, readNodeRecord } = await import("../src/mesh-store.mjs");
        // a record carrying an unknown top-level "tags" array of objects, mixing
        // string/number/boolean/null leaf values at depth 3 — the store has never
        // seen "tags"; it must persist the record AS-IS (ADR-003 additive-friendly).
        const record = nodeRecord("umair-desktop", {
          tags: [
            { key: "role", value: "builder", weight: 3, primary: true, note: null },
            { key: "zone", value: "eu", weight: 0, primary: false, note: "x" },
          ],
          capabilities: { routing: { nested: { flag: true, n: 42, s: "deep", nothing: null } } },
        });
        const publishedJson = JSON.stringify(record);

        await publishNodeRecord(workspace, "umair-desktop", record);
        const read = await readNodeRecord(workspace, "umair-desktop");

        assert.deepEqual(read, record, "the read record equals the published object");
        assert.equal(JSON.stringify(read), publishedJson, "the read record is byte-equivalent (identical serialization)");
        // keys appear in the same order they were published — at every level
        assert.deepEqual(Object.keys(read), Object.keys(record), "top-level keys appear in publish order (none added/dropped/reordered)");
        assert.deepEqual(Object.keys(read.capabilities.routing.nested), Object.keys(record.capabilities.routing.nested), "nested keys preserve order too");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/00 reading a node id with no record reads as absent (null), not an error",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { readNodeRecord } = await import("../src/mesh-store.mjs");
        // nodes/ has no record for umair-mbp (the dir may not even exist)
        let read;
        await assert.doesNotReject(async () => { read = await readNodeRecord(workspace, "umair-mbp"); }, "reading an absent record raises no error");
        assert.equal(read, null, "the read result is absent (null)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/00 two distinct node ids persist as two distinct files, never the same path (the unaffected file is byte-identical)",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { publishNodeRecord, readNodeRecord } = await import("../src/mesh-store.mjs");
        const desktop = nodeRecord("umair-desktop");
        const mbp = nodeRecord("umair-mbp");

        await publishNodeRecord(workspace, "umair-desktop", desktop);
        const desktopBytesBefore = await readBytes(workspace, "umair-desktop.json");
        await publishNodeRecord(workspace, "umair-mbp", mbp);

        const files = await listNodeFiles(workspace);
        assert.equal(files.length, 2, "the nodes/ dir contains exactly two files");
        assert.deepEqual(files, ["umair-desktop.json", "umair-mbp.json"], "the two files are umair-desktop.json and umair-mbp.json");
        assert.equal(await readBytes(workspace, "umair-desktop.json"), desktopBytesBefore, "umair-desktop.json is byte-identical to before umair-mbp was published");

        // reading one peer back never touches the other's record on disk
        const readMbp = await readNodeRecord(workspace, "umair-mbp");
        assert.deepEqual(readMbp, mbp, "the read record is the umair-mbp record");
        assert.equal(await readBytes(workspace, "umair-desktop.json"), desktopBytesBefore, "umair-desktop.json on disk is still byte-identical (the read mutated no file)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/00 republishing the same node id overwrites that node's own single file and leaves siblings untouched",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { publishNodeRecord } = await import("../src/mesh-store.mjs");
        await publishNodeRecord(workspace, "umair-desktop", nodeRecord("umair-desktop"));
        await publishNodeRecord(workspace, "umair-mbp", nodeRecord("umair-mbp"));
        const mbpBytesBefore = await readBytes(workspace, "umair-mbp.json");

        const updated = nodeRecord("umair-desktop", { publishedAt: "2026-06-30T12:00:00.000Z", skills: ["acd", "graphify"] });
        await publishNodeRecord(workspace, "umair-desktop", updated);

        const files = await listNodeFiles(workspace);
        assert.equal(files.length, 2, "the nodes/ dir still contains exactly two files");
        assert.equal(files.filter((f) => f === "umair-desktop.json").length, 1, "there is still exactly one file named umair-desktop.json");
        assert.deepEqual(JSON.parse(await readBytes(workspace, "umair-desktop.json")), updated, "umair-desktop.json parses as JSON equal to the updated record");
        assert.equal(await readBytes(workspace, "umair-mbp.json"), mbpBytesBefore, "umair-mbp.json is byte-identical to before the republish (the sibling was untouched)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
