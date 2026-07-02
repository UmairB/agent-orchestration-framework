// Traceability wiring for milestone 24 / story 00 — the group-registry store + seam
// (tasks/00_registry-store-and-seam.feature).
//
// Covers EVERY @executable scenario in tasks/00_registry-store-and-seam.feature,
// exercising the REAL src/mesh-registry.mjs in-process against a temp fixture
// (mkdtemp → a workspace-shaped { workDir } → exercise → rm in finally), with an
// INJECTED config.mesh.nodeId / config.mesh.relay.controlNode pair driving the
// control-node truth table (matching → control node; mismatched → non-authority).
// No relay, no git, no credential — the dependency root, standalone. One test object
// per scenario / Scenario Outline row group. node:assert/strict.
//
//   00_registry-store-and-seam.feature — writeRegistry persists under meshDir/registry/
//     and reads back byte-equivalent (an unknown additive top-level "futureField"
//     survives); readRegistry on an absent file returns the EMPTY registry (roster [],
//     boards [], pending [], revocations []), never a throw; writeRegistry writes ONLY
//     on the control node and is a structured no-op off it (the pre-existing file
//     byte-unchanged); the write touches only meshDir/registry/ (nothing outside
//     .mesh/); the write is atomic via the writeText temp+rename seam (an interrupted
//     write leaves the prior complete registry).
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, readFile, readdir, writeFile, access } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const CONTROL_ID = "control-node-a";
const PEER_ID = "peer-node-b";

// A workspace-shaped object: the store only needs workspace.workDir (where meshDir
// — .mesh/ — sits inside the work stream).
async function makeWorkspace() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-meshreg-seam-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  return { repo, workspace: { workDir } };
}

// The injected control-node predicate inputs: on the control node the nominated
// controlNode EQUALS this node's id; on a non-control node it points at another node.
function controlConfig() {
  return { mesh: { nodeId: CONTROL_ID, relay: { controlNode: CONTROL_ID } } };
}
function nonControlConfig() {
  return { mesh: { nodeId: PEER_ID, relay: { controlNode: CONTROL_ID } } };
}

// A full ADR-001-shaped registry value (roster + boards + pending + revocations),
// with injected timestamps (never wall-clock) and an OPAQUE codeHash.
function sampleRegistry(overrides = {}) {
  return {
    group: "umair-fleet",
    roster: [{ nodeId: "node-a", admittedAt: "2026-07-01T10:00:00Z", boards: ["board-x"] }],
    boards: ["board-x"],
    pending: [{ codeHash: "OPAQUE-HASH-1", issuedAt: "2026-07-01T10:00:00Z", expiresAt: "2026-07-01T10:05:00Z", consumedAt: null }],
    revocations: [{ nodeId: "node-z", revokedAt: "2026-07-01T09:00:00Z", reason: "left the fleet" }],
    ...overrides,
  };
}

// Recursive snapshot of every file under root → { relativePath: bytes } (for the
// write-scope confinement assertions).
async function snapshotTree(root) {
  const files = {};
  async function walk(dir) {
    let entries = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        files[path.relative(root, full)] = await readFile(full, "utf8");
      }
    }
  }
  await walk(root);
  return files;
}

export const meshRegistryStoreSeamTests = [
  {
    name: "mesh-registry-seam/00 writeRegistry persists under meshDir/registry/ and readRegistry reads it back byte-equivalent, an unknown additive key surviving",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { writeRegistry, readRegistry, registryDir, registryPath } = await import("../src/mesh-registry.mjs");
        const { meshDir } = await import("../src/mesh-store.mjs");
        // a registry with roster, boards, pending, revocations PLUS an unknown
        // additive top-level key the store has never seen
        const registry = sampleRegistry({ futureField: { schemaRev: 2, note: "unknown to the store" } });
        const writtenJson = JSON.stringify(registry);

        const result = await writeRegistry(workspace, registry, controlConfig());
        assert.equal(result.written, true, "the control-node write reports written: true");

        const read = await readRegistry(workspace);
        assert.deepEqual(read, registry, "the read registry equals the written registry (roster, boards, pending, revocations preserved)");
        assert.equal(JSON.stringify(read), writtenJson, "the round-trip is byte-equivalent (identical serialization, nothing dropped/reshaped/reordered)");
        assert.deepEqual(Object.keys(read), Object.keys(registry), "top-level keys appear in written order");
        assert.deepEqual(read.futureField, { schemaRev: 2, note: "unknown to the store" }, "the unknown additive top-level key futureField survives the round-trip unchanged");

        // the persisted file lives under meshDir/registry/ — registryPath joins the partition root
        assert.equal(registryDir(workspace), path.join(meshDir(workspace), "registry"), "registryDir joins the meshDir partition root");
        assert.equal(path.dirname(registryPath(workspace)), registryDir(workspace), "registryPath is a leaf directly under registryDir");
        await assert.doesNotReject(() => access(registryPath(workspace)), "the persisted file exists at registryPath");
        assert.deepEqual(JSON.parse(await readFile(registryPath(workspace), "utf8")), registry, "the on-disk file under meshDir/registry/ parses as the written registry");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-registry-seam/00 readRegistry on a workspace with no registry file yet returns an empty registry, never a throw",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { readRegistry } = await import("../src/mesh-registry.mjs");
        // meshDir/registry/ has no registry file yet (not even the .mesh/ dir exists)
        let read;
        await assert.doesNotReject(async () => { read = await readRegistry(workspace); }, "reading an absent registry raises no error (absence is benign — the ENOENT→absent discipline)");
        assert.deepEqual(read, { roster: [], boards: [], pending: [], revocations: [] }, "the result is an empty registry with roster [], boards [], pending [], and revocations []");
        // ONLY absence is tolerated (story-00 structural-review fix): a corrupt/torn
        // registry THROWS rather than silently reading as empty — the registry is the
        // authoritative git-of-record, and a control-node read→mutate→write over a
        // silently-emptied registry would persist the wipe.
        const { registryDir, registryPath } = await import("../src/mesh-registry.mjs");
        await mkdir(registryDir(workspace), { recursive: true });
        await writeFile(registryPath(workspace), "{ this is not json", "utf8");
        await assert.rejects(async () => { await readRegistry(workspace); }, "a corrupt registry rejects (fail-closed) — corruption never reads as an empty registry");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-registry-seam/00 writeRegistry writes only on the control node and is a structured no-op off it (truth table: control writes / non-control leaves prior bytes unchanged)",
    async run() {
      // Scenario Outline rows: | control node | true | does | + | non-control node | false | does not |
      const rows = [
        { role: "control node", config: controlConfig(), writes: true },
        { role: "non-control node", config: nonControlConfig(), writes: false },
      ];
      for (const row of rows) {
        const { repo, workspace } = await makeWorkspace();
        try {
          const { writeRegistry, registryPath } = await import("../src/mesh-registry.mjs");
          // a pre-existing registry file on disk whose bytes I record (seeded via the
          // control-node write — the one legitimate writer)
          const prior = sampleRegistry();
          await writeRegistry(workspace, prior, controlConfig());
          const priorBytes = await readFile(registryPath(workspace), "utf8");

          // writeRegistry a CHANGED registry on that node — no error either way
          const changed = sampleRegistry({ boards: ["board-x", "board-y"] });
          let result;
          await assert.doesNotReject(
            async () => { result = await writeRegistry(workspace, changed, row.config); },
            `[${row.role}] the invocation raises no error (a non-authority write is a structured no-op, not a throw)`
          );

          const after = await readFile(registryPath(workspace), "utf8");
          if (row.writes) {
            assert.equal(result.written, true, `[${row.role}] the write reports written: true`);
            assert.deepEqual(JSON.parse(after), changed, `[${row.role}] the registry file DOES reflect the changed registry`);
          } else {
            assert.equal(result.written, false, `[${row.role}] the no-op is STRUCTURED (written: false)`);
            assert.equal(result.reason, "not-control-node", `[${row.role}] the no-op carries its reason`);
            assert.equal(after, priorBytes, `[${row.role}] the pre-existing registry file is BYTE-unchanged (the registry file does NOT reflect the changed registry)`);
          }
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }

      // and on a FRESH workspace a non-control invocation creates nothing at all
      const { repo, workspace } = await makeWorkspace();
      try {
        const { writeRegistry, registryPath } = await import("../src/mesh-registry.mjs");
        const result = await writeRegistry(workspace, sampleRegistry(), nonControlConfig());
        assert.equal(result.written, false, "the fresh-workspace non-control write is a structured no-op");
        await assert.rejects(() => access(registryPath(workspace)), "the non-control node neither creates nor mutates a registry file");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-registry-seam/00 the registry write touches only meshDir/registry/ and writes no file outside .mesh/",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { writeRegistry } = await import("../src/mesh-registry.mjs");
        // a workspace with real content OUTSIDE meshDir whose on-disk state I record
        await writeFile(path.join(repo, "outside-root.txt"), "workDir-root sentinel\n", "utf8");
        await mkdir(path.join(workspace.workDir, "24_milestone_group-enrollment"), { recursive: true });
        await writeFile(path.join(workspace.workDir, "24_milestone_group-enrollment", "notes.md"), "work-stream sentinel\n", "utf8");
        const before = await snapshotTree(repo);

        await writeRegistry(workspace, sampleRegistry(), controlConfig());

        const after = await snapshotTree(repo);
        const meshRegistryPrefix = path.join("wiki", "work", ".mesh", "registry") + path.sep;
        const meshPrefix = path.join("wiki", "work", ".mesh") + path.sep;

        // the only file created or modified is under meshDir/registry/
        const changed = Object.keys(after).filter((rel) => before[rel] !== after[rel]);
        assert.ok(changed.length >= 1, "the write created the registry file");
        for (const rel of changed) {
          assert.ok(rel.startsWith(meshRegistryPrefix), `the only created/modified path is under meshDir/registry/ — got: ${rel}`);
        }
        // no file was written outside .mesh/ (no workDir-root file, no .aof/ sidecar)
        const outsideBefore = Object.keys(before).filter((rel) => !rel.startsWith(meshPrefix)).sort();
        const outsideAfter = Object.keys(after).filter((rel) => !rel.startsWith(meshPrefix)).sort();
        assert.deepEqual(outsideAfter, outsideBefore, "no file was created outside .mesh/");
        for (const rel of outsideBefore) {
          assert.equal(after[rel], before[rel], `the workspace state outside meshDir is byte-unchanged — ${rel}`);
        }
        assert.ok(!outsideAfter.some((rel) => rel.startsWith(".aof" + path.sep) || rel === ".aof"), "no .aof/ sidecar was written (the registry rides the m22/R4 + m22/R5 .mesh/ pins, no new pin owed)");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
  {
    name: "mesh-registry-seam/00 writeRegistry is atomic — an interrupted write never leaves a truncated registry (temp+rename via writeText, not a bare writeFile)",
    async run() {
      const { repo, workspace } = await makeWorkspace();
      try {
        const { writeRegistry, readRegistry, registryDir, registryPath } = await import("../src/mesh-registry.mjs");
        // a prior COMPLETE registry on disk on the control node
        const prior = sampleRegistry();
        await writeRegistry(workspace, prior, controlConfig());
        const priorBytes = await readFile(registryPath(workspace), "utf8");

        // a completed write leaves NO temp artifact behind (the rename consumed it)
        const settled = (await readdir(registryDir(workspace))).filter((name) => name.includes(".tmp-"));
        assert.deepEqual(settled, [], "a completed writeRegistry leaves no .tmp- artifact (the temp+rename seam settles)");

        // simulate a write INTERRUPTED after the temp file is written but before the
        // rename completes — exactly writeText's pre-rename on-disk state: a .tmp-
        // sibling holding the NEW content, the target untouched
        const changed = sampleRegistry({ boards: ["board-x", "board-y"] });
        const tempLeaf = `.tmp-group.json-${process.pid}-interrupted`;
        await writeFile(path.join(registryDir(workspace), tempLeaf), JSON.stringify(changed, null, 2), "utf8");

        // the on-disk registry is the PRIOR complete registry (the rename never happened)
        assert.equal(await readFile(registryPath(workspace), "utf8"), priorBytes, "the on-disk registry is the prior complete registry, byte-identical");
        const read = await readRegistry(workspace);
        assert.deepEqual(read, prior, "readRegistry returns the complete, parseable prior registry (never a truncated file)");

        // the write goes through the atomic writeText temp+rename seam, not a bare
        // writeFile — the module imports the fs.mjs seam and joins registryPath at it
        const source = await readFile(path.join(repoRoot, "src", "mesh-registry.mjs"), "utf8");
        const live = source.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
        assert.ok(/import\s*\{[^}]*\bwriteText\b[^}]*\}\s*from\s*["']\.\/fs\.mjs["']/.test(live), "the store imports writeText from src/fs.mjs (the atomic temp+rename seam)");
        assert.ok(/\bwriteText\s*\(\s*registryPath\s*\(/.test(live), "the persist calls writeText(registryPath(...)) — the atomic seam at the registry partition");
        assert.ok(!/\bwriteFile(?:Sync)?\s*\(/.test(live) && !/\bappendFile(?:Sync)?\s*\(/.test(live), "no bare writeFile/appendFile bypasses the atomic seam");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
