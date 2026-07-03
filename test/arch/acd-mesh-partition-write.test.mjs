// Fitness function: acd-mesh-partition-write (milestone 22, ADR-002 / fitness #1).
//
// Partition discipline: every mesh record path is built by the SINGLE seam
// (meshDir/nodeRecordPath), keyed by node id; there is NO shared/aggregate file two
// nodes co-write — so git merges are add-only and the m26 <node>/ segment slots into
// the one join site (compose-with-19). Mirrors 19's acd-run-partition-ready
// (stripComments source-analysis + a runtime N-discrete-files check).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readFile } from "node:fs/promises";

const MESH_STORE = new URL("../../src/mesh-store.mjs", import.meta.url);

export const archTests = [
  {
    name: "arch/mesh-partition-write: meshDir is the single partition-root seam and nodeRecordPath is built from it (one join site)",
    async run() {
      const source = await readFile(MESH_STORE, "utf8");
      const code = stripComments(source);

      // meshDir is the SINGLE partition-root seam — defined exactly once, joining the
      // .aof config home (via aofHome) to the "mesh" leaf. (Location moved off workDir
      // to .aof/mesh at 28/verify — mesh is aof config/runtime state, git-tracked
      // beside aof's config/lock, superseding 22/ADR-002+003's work-stream anchor.)
      const meshDirDefs = [...code.matchAll(/function\s+meshDir\s*\(/g)];
      assert.equal(meshDirDefs.length, 1, "meshDir is defined exactly once (the single partition-root seam)");
      assert.ok(/function\s+meshDir[\s\S]*?path\.join\s*\(\s*aofHome\s*\(\s*workspace\s*\)\s*,\s*["']mesh["']/.test(code), "meshDir joins aofHome(workspace) to the \"mesh\" leaf (the .aof-anchored partition root)");
      assert.ok(/function\s+aofHome[\s\S]*?["']\.aof["']/.test(code), "aofHome resolves the .aof config home (the git-tracked mesh anchor, beside aof's config/lock)");

      // nodeRecordPath is the ONE node-record path builder, built FROM meshDir.
      const recordPathDefs = [...code.matchAll(/function\s+nodeRecordPath\s*\(/g)];
      assert.equal(recordPathDefs.length, 1, "nodeRecordPath is defined exactly once (the single node-record path builder)");
      assert.ok(/nodeRecordPath[\s\S]*?path\.join\s*\(\s*meshDir\s*\(/.test(code), "nodeRecordPath joins meshDir(...) (the one seam the <node> segment slots into)");
    },
  },
  {
    name: "arch/mesh-partition-write: every node-record path embeds a node-id segment and no aggregate/shared filename is built",
    async run() {
      const source = await readFile(MESH_STORE, "utf8");
      const code = stripComments(source);

      // Every node-record path embeds an id segment — the node-record stem is
      // assembled in exactly one place (nodeRecordPath), keyed by the id.
      assert.ok(/nodeRecordPath[\s\S]*?["']nodes["']/.test(code), "nodeRecordPath builds the nodes/ partition with an id-keyed leaf");
      // No aggregate/shared filename appears anywhere — no nodes.json/roster/index
      // any two nodes would co-write (the three-way-merge hazard the convention rejects).
      for (const aggregate of ["nodes.json", "roster.json", "index.json", "all.json"]) {
        assert.ok(!code.includes(aggregate), `the store builds no aggregate "${aggregate}" filename two nodes would co-write`);
      }
    },
  },
  {
    name: "arch/mesh-partition-write: publishing N distinct ids produces N discrete files under nodes/ with no aggregate",
    async run() {
      const { publishNodeRecord, meshDir } = await import("../../src/mesh-store.mjs");
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-partition-arch-"));
      try {
        const workspace = { workDir: path.join(repo, "wiki", "work") };
        await mkdir(workspace.workDir, { recursive: true });

        const ids = ["umair-desktop", "umair-mbp", "build-server", "laptop-a1b2", "ci-runner"];
        for (const id of ids) {
          await publishNodeRecord(workspace, id, { nodeId: id });
        }

        const nodesDir = path.join(meshDir(workspace), "nodes");
        const entries = await readdir(nodesDir);
        assert.equal(entries.length, ids.length, `nodes/ holds exactly ${ids.length} discrete files (one per node)`);
        const jsonFiles = entries.filter((name) => name.endsWith(".json")).sort();
        assert.deepEqual(jsonFiles, ids.map((id) => `${id}.json`).sort(), "each file is named by its node's id");
        // NO aggregate alongside the per-node files
        assert.ok(!entries.includes("nodes.json"), "there is no nodes.json aggregate");
        assert.ok(!entries.some((name) => name === "roster.json" || name === "index.json" || name === "all.json"), "no aggregate/combined-roster file alongside the per-node files");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];

function stripComments(source) {
  return source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
}
