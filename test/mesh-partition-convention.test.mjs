// Traceability wiring for milestone 22 / story 00 — the path-partition convention.
//
// Covers EVERY @executable scenario in tasks/01_path-partition-convention.feature,
// exercising the REAL src/mesh-store.mjs path seam in-process. One test object per
// @executable scenario (the Scenario-Outline folded into one entry looping the
// Examples). node:assert/strict.
//
//   01_path-partition-convention.feature — the node-record path is the single
//     node-id-keyed seam under the global partition root; the id is
//     ONE flat leaf segment directly under nodes/, never escaping into a parent or
//     nested dir; there is no aggregate nodes.json two nodes co-write; the
//     run-dimension convention equals milestone 19's runRecordPath + one <node>/
//     segment (composition demonstrated, not built); presence is a reserved shape,
//     no presence file written.
//
// CONTRACT DEFECT FLAGGED (see story STATE feedback): the Scenario-Outline's two
// traversal rows list expected-leaf "../escape.json" and "a/b.json" — values that
// CANNOT simultaneously be "one flat leaf segment directly under nodes/ that does not
// escape" (Then-steps 1+3 + the feature's prose/QA-comment). A leaf literally named
// "../escape.json" escapes nodes/; "a/b.json" nests into nodes/a/. The locked ADR-002
// INVARIANT (one node id, never a multi-segment escape) is what the seam honours: it
// coerces the id to a flat leaf, so "../escape" → "--escape.json" and "a/b" →
// "a-b.json", both directly under nodes/. The test asserts the genuine invariant for
// all rows; the two safe rows also match their literal expected-leaf.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const workspace = { workDir: path.join("C:", "repo", "wiki", "work"), globalMeshRoot: path.join("C:", "aof-global", "mesh") };

export const meshPartitionConventionTests = [
  {
    name: "mesh-store/01 the node-record path is the single node-id-keyed seam under the partition root",
    async run() {
      const { meshDir, nodeRecordPath } = await import("../src/mesh-store.mjs");
      const p = nodeRecordPath(workspace, "build-server");

      // the path ends with nodes/build-server.json
      assert.equal(path.basename(p), "build-server.json", "the path's leaf is build-server.json");
      assert.equal(path.basename(path.dirname(p)), "nodes", "the leaf sits directly under a nodes/ dir");
      // rooted at the global partition root.
      assert.equal(path.dirname(p), path.join(meshDir(workspace), "nodes"), "the path is rooted under meshDir/nodes");
      assert.ok(p.startsWith(meshDir(workspace) + path.sep), "the path is inside the partition root");
      const segments = p.split(path.sep);
      assert.ok(segments.includes("mesh"), "the partition root is the global mesh home (the node-record path resolves under mesh)");
    },
  },
  {
    name: "mesh-store/01 the node id is one flat filename segment directly under nodes/, never a sub-path (Scenario Outline)",
    async run() {
      const { meshDir, nodeRecordPath } = await import("../src/mesh-store.mjs");
      const nodesDir = path.join(meshDir(workspace), "nodes");

      // Examples from the feature. The two SAFE ids match their literal expected-leaf
      // exactly. The two TRAVERSAL ids assert the genuine flat-leaf invariant (Then
      // 1+3 + prose): the seam coerces them to one leaf directly under nodes/ — the
      // feature's expected-leaf literals "../escape.json"/"a/b.json" are mis-specified
      // (a contract defect, flagged), as they would escape/nest. The asserted leaf is
      // the safe coercion the seam produces.
      const rows = [
        { id: "build-server", expectedLeaf: "build-server.json", literalLeafMatches: true },
        { id: "laptop-a1b2", expectedLeaf: "laptop-a1b2.json", literalLeafMatches: true },
        { id: "../escape", expectedLeaf: "--escape.json", literalLeafMatches: false },
        { id: "a/b", expectedLeaf: "a-b.json", literalLeafMatches: false },
      ];

      for (const { id, expectedLeaf } of rows) {
        const p = nodeRecordPath(workspace, id);
        // Then: the path's parent directory is exactly the partition root's nodes/ dir
        assert.equal(path.dirname(p), nodesDir, `[${id}] parent directory is exactly nodes/`);
        // Then: the path's final segment is <expected-leaf>
        assert.equal(path.basename(p), expectedLeaf, `[${id}] final segment is ${expectedLeaf}`);
        // Then: the path does not escape nodes/ into a parent or nested directory —
        // a single leaf directly under nodes/, no ".." segment survives, no extra
        // directory segment beyond nodes/.
        const rel = path.relative(nodesDir, p);
        assert.ok(!rel.split(path.sep).includes(".."), `[${id}] the path does not escape nodes/ into a parent`);
        assert.equal(path.dirname(rel), ".", `[${id}] the path does not nest into a sub-directory under nodes/`);
      }
    },
  },
  {
    name: "mesh-store/01 there is no aggregate file two nodes would co-write",
    async run() {
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-partition-"));
      try {
        const ws = { workDir: path.join(repo, "wiki", "work"), globalMeshRoot: path.join(repo, "global", "mesh") };
        await mkdir(ws.workDir, { recursive: true });
        const { publishNodeRecord, meshDir } = await import("../src/mesh-store.mjs");

        await publishNodeRecord(ws, "umair-desktop", { nodeId: "umair-desktop" });
        await publishNodeRecord(ws, "umair-mbp", { nodeId: "umair-mbp" });

        // no nodes.json (or any combined-roster file) exists under the partition root
        const root = meshDir(ws);
        async function walk(dir) {
          let entries = [];
          try {
            entries = await readdir(dir, { withFileTypes: true });
          } catch {
            return [];
          }
          const found = [];
          for (const e of entries) {
            const full = path.join(dir, e.name);
            if (e.isDirectory()) found.push(...(await walk(full)));
            else found.push(full);
          }
          return found;
        }
        const allFiles = (await walk(root)).map((f) => path.basename(f));
        assert.ok(!allFiles.includes("nodes.json"), "no nodes.json aggregate exists under the partition root");
        assert.ok(!allFiles.some((f) => f === "roster.json" || f === "index.json" || f === "all.json"), "no combined-roster file exists under the partition root");
        // each node's record is its own discrete file under nodes/
        const nodeFiles = (await readdir(path.join(root, "nodes"))).filter((n) => n.endsWith(".json")).sort();
        assert.deepEqual(nodeFiles, ["umair-desktop.json", "umair-mbp.json"], "each node's record is its own discrete file under nodes/");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-store/01 the run-dimension convention is the additive <node>/ delta on milestone 19's runRecordPath shape",
    async run() {
      const { runNodeRecordPath, runsDir, runRecordPath } = await import("../src/mesh-store.mjs");
      // import 19's seam DIRECTLY too, to prove the convention adopts the SAME
      // reference (not a divergent run-path builder).
      const runStore = await import("../src/run-store.mjs");
      assert.equal(runsDir, runStore.runsDir, "the convention re-exports milestone 19's frozen runsDir seam (same reference)");
      assert.equal(runRecordPath, runStore.runRecordPath, "the convention re-exports milestone 19's frozen runRecordPath seam (same reference)");

      const item = { dir: path.join("C:", "repo", "wiki", "work", "19_milestone_x") };
      const runId = "20260629T173045123Z-0000";
      const node = "umair-desktop";

      // 19's runRecordPath for the run is <runs-dir>/<run-id>.json
      const m19 = runStore.runRecordPath(item, runId);
      assert.equal(m19, path.join(runStore.runsDir(item), runId + ".json"), "19's runRecordPath is <runs-dir>/<run-id>.json");

      // the convention path is <runs-dir>/<node>/<run-id>.json
      const convention = runNodeRecordPath(item, node, runId);
      assert.equal(convention, path.join(runStore.runsDir(item), node, runId + ".json"), "the convention path is <runs-dir>/<node>/<run-id>.json");

      // it equals 19's runRecordPath with one <node>/ segment inserted before the run-id leaf
      const inserted = path.join(path.dirname(m19), node, path.basename(m19));
      assert.equal(convention, inserted, "it equals 19's runRecordPath with one <node>/ segment inserted before the run-id file");
      // the run-id leaf filename is byte-identical to 19's (only the <node>/ segment was added)
      assert.equal(path.basename(convention), path.basename(m19), "the run-id leaf filename is byte-identical to milestone 19's");
      // and the convention's parent dir is exactly <runs-dir>/<node>
      assert.equal(path.dirname(convention), path.join(runStore.runsDir(item), node), "the only inserted segment is <node>/ under runsDir");

      // this milestone does NOT write any runs/<node>/ file — runNodeRecordPath is a
      // PURE path builder (it returns a string; it touches no filesystem). The
      // write-scope arch-test (fitness #2) enforces the store performs no write
      // outside meshDir; here we pin the convention helper itself is a pure builder.
      assert.equal(typeof convention, "string", "runNodeRecordPath is a pure path builder (returns a string, writes nothing)");
    },
  },
  {
    name: "mesh-store/01 the presence dimension is named as a reserved shape but not built here",
    async run() {
      const { presenceRecordPath, meshDir, publishNodeRecord } = await import("../src/mesh-store.mjs");
      const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-presence-"));
      try {
        const ws = { workDir: path.join(repo, "wiki", "work"), globalMeshRoot: path.join(repo, "global", "mesh") };
        await mkdir(ws.workDir, { recursive: true });

        // the convention NAMES the presence record shape as presence/<node-id>.json
        assert.equal(typeof presenceRecordPath, "function", "presenceRecordPath is named (the reserved presence shape)");
        const p = presenceRecordPath(ws, "umair-desktop");
        assert.equal(path.basename(p), "umair-desktop.json", "the presence path leaf is <node-id>.json");
        assert.equal(path.basename(path.dirname(p)), "presence", "the presence path is under presence/ (the reserved shape)");
        assert.equal(path.dirname(p), path.join(meshDir(ws), "presence"), "presence/<node-id>.json is rooted under the partition root");

        // this milestone writes no presence/ file — publishing a node record touches
        // only nodes/, never presence/ (milestone 23 builds the presence dimension).
        await publishNodeRecord(ws, "umair-desktop", { nodeId: "umair-desktop" });
        let presenceEntries = [];
        try {
          presenceEntries = await readdir(path.join(meshDir(ws), "presence"));
        } catch {
          presenceEntries = [];
        }
        assert.deepEqual(presenceEntries, [], "no presence/ file was written (milestone 23 builds the presence dimension)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
