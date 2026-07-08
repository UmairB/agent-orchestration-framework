// Traceability wiring for milestone 27 / story 01 — the additive mesh:status
// ISSUED render + the isControlNode marker
// (tasks/04_mesh-status-issued-render.feature, ADR-004 consequences).
//
// Covers EVERY @executable scenario in 04_mesh-status-issued-render.feature.
// Driven via the REGISTERED mesh:status command (invoke + loadWorkspace) over
// planted directive fixtures.
//
//   04_mesh-status-issued-render.feature —
//     - mesh:status appends an ISSUED section per open directive alongside
//       nodes/boards (the { nodes, boards } shape unchanged);
//     - a withdrawn directive is filtered out of the issued render;
//     - with no directives the issued render is empty and byte-identical;
//     - with mesh unconfigured the issued key is absent and directives are
//       invisible;
//     - the --json face carries the directives unchanged;
//     - the isControlNode marker: true when this node IS the control node, false
//       otherwise;
//     - the issued render is a pure read — the issuance tree is byte-unchanged.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { invoke } from "../src/command-core.mjs";
import { meshStatusCommand } from "../src/commands/mesh-identity.mjs";
import { issuanceDirectivePath, nodeRecordPath, meshDir } from "../src/mesh-store.mjs";
import { writeText } from "../src/fs.mjs";

const NOW = "2026-07-03T10:00:00.000Z";

async function makeRepo({ mesh } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "aof-mesh-status-issued-"));
  const workDir = path.join(repo, "wiki", "work");
  await mkdir(workDir, { recursive: true });
  await mkdir(path.join(repo, ".aof"), { recursive: true });
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (mesh !== undefined) config.mesh = mesh;
  await writeFile(path.join(repo, ".aof", "aof.config.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return { repo, workDir };
}

const ctxFor = async (repo) => ({ workspace: await loadWorkspace(repo) });

async function seedNodeRecord(workspace, nodeId) {
  await mkdir(path.dirname(nodeRecordPath(workspace, nodeId)), { recursive: true });
  await writeText(nodeRecordPath(workspace, nodeId), JSON.stringify({ nodeId, host: "h", os: "linux", runtimes: [], skills: [], aofVersion: "0.1.0", publishedAt: NOW }, null, 2));
}

async function writeDirective(workspace, issuer, itemRef, target, state = "issued") {
  await mkdir(path.dirname(issuanceDirectivePath(workspace, issuer, itemRef)), { recursive: true });
  await writeText(issuanceDirectivePath(workspace, issuer, itemRef), JSON.stringify({ itemRef, issuer, target, state, issuedAt: NOW, aofVersion: "0.1.0" }, null, 2));
}

async function snapshotIssuanceTree(workspace) {
  const root = path.join(meshDir(workspace), "issuance");
  const snap = {};
  async function walk(dir, rel) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      const r = path.join(rel, entry.name);
      if (entry.isDirectory()) await walk(abs, r);
      else snap[r] = await readFile(abs, "utf8");
    }
  }
  await walk(root, "");
  return snap;
}

export const meshStatusIssuedRenderTests = [
  // ══ Scenario: mesh:status appends an ISSUED section per open directive alongside nodes and boards ══
  {
    name: "mesh-status-issued/04 mesh:status appends an ISSUED section per open directive alongside nodes and boards — the { nodes, boards } shape unchanged",
    async run() {
      const { repo } = await makeRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo);
        await seedNodeRecord(ctx.workspace, "node-a");
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "node", nodeId: "build-server" });
        await writeDirective(ctx.workspace, "node-b", "27/01", { kind: "capability", value: "codex" });

        const result = await invoke("mesh:status", { now: NOW }, ctx);

        assert.ok(Array.isArray(result.nodes), "the { nodes } shape is present and unchanged");
        assert.ok(Array.isArray(result.boards), "the { boards } shape is present and unchanged");
        assert.ok(
          result.issued.some((e) => e.issuer === "node-a" && e.itemRef === "27/00" && JSON.stringify(e.target) === JSON.stringify({ kind: "node", nodeId: "build-server" })),
          "result.issued carries the node-a/27-00 entry"
        );
        assert.ok(
          result.issued.some((e) => e.issuer === "node-b" && e.itemRef === "27/01" && JSON.stringify(e.target) === JSON.stringify({ kind: "capability", value: "codex" })),
          "result.issued carries the node-b/27-01 entry"
        );
        const rendered = meshStatusCommand.cli.render(result);
        assert.ok(rendered.includes("ISSUED"), "the human render appends an ISSUED section");
        assert.ok(rendered.includes("27/00"), "the render names the item");
        assert.ok(rendered.includes("node-a"), "the render names the issuer");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a withdrawn directive is filtered out of the issued render ══
  {
    name: "mesh-status-issued/04 a withdrawn directive is filtered out of the issued render — only the open directive renders",
    async run() {
      const { repo } = await makeRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo);
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "any" }, "withdrawn");
        await writeDirective(ctx.workspace, "node-a", "27/01", { kind: "any" }, "issued");

        const result = await invoke("mesh:status", { now: NOW }, ctx);

        assert.ok(result.issued.some((e) => e.itemRef === "27/01"), "the open 27/01 entry renders");
        assert.ok(!result.issued.some((e) => e.itemRef === "27/00"), "the withdrawn 27/00 entry is filtered out");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: with no directives the issued render is empty and appends nothing ══
  {
    name: "mesh-status-issued/04 with no directives the issued render is [] and appends no ISSUED section — byte-identical to today",
    async run() {
      const { repo } = await makeRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo);
        const result = await invoke("mesh:status", { now: NOW }, ctx);
        assert.deepEqual(result.issued, [], "configured-but-empty");
        assert.ok(!meshStatusCommand.cli.render(result).includes("ISSUED"), "no dangling ISSUED heading");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: with mesh unconfigured the issued key is absent and directive files on disk are invisible ══
  {
    name: "mesh-status-issued/04 with mesh unconfigured the issued key is absent — directive files on disk are invisible, render byte-identical to { nodes, boards }",
    async run() {
      const { repo } = await makeRepo(); // no mesh config
      try {
        const ctx = await ctxFor(repo);
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "any" });
        await writeDirective(ctx.workspace, "node-a", "27/01", { kind: "any" });

        const result = await invoke("mesh:status", { now: NOW }, ctx);
        assert.ok(!("issued" in result), "the issued key never appears — the read never ran");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the --json face carries the directives through untouched ══
  {
    name: "mesh-status-issued/04 the --json face carries the issued directives through untouched alongside nodes and boards",
    async run() {
      const { repo } = await makeRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo);
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "any" });
        const result = await invoke("mesh:status", { now: NOW }, ctx);
        const json = meshStatusCommand.cli.json(result);
        assert.ok(Array.isArray(json.nodes) && Array.isArray(json.boards), "nodes and boards carry through");
        assert.ok(json.issued.some((e) => e.itemRef === "27/00"), "issued carries the 27/00 entry");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: the isControlNode marker — true on the control node, false otherwise ══
  {
    name: "mesh-status-issued/04 mesh:status emits an additive isControlNode marker — true when this node IS the control node, false otherwise, false when unconfigured",
    async run() {
      // This node IS the control node.
      {
        const { repo } = await makeRepo({ mesh: { nodeId: "node-a", relay: { controlNode: "node-a" } } });
        try {
          const ctx = await ctxFor(repo);
          const result = await invoke("mesh:status", { now: NOW }, ctx);
          assert.equal(result.isControlNode, true);
          assert.ok(Array.isArray(result.nodes) && Array.isArray(result.boards), "the { nodes, boards } shape is otherwise unchanged");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // This node is NOT the control node.
      {
        const { repo } = await makeRepo({ mesh: { nodeId: "node-b", relay: { controlNode: "node-a" } } });
        try {
          const ctx = await ctxFor(repo);
          const result = await invoke("mesh:status", { now: NOW }, ctx);
          assert.equal(result.isControlNode, false);
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
      // Unconfigured mesh — the marker is present and false (never absent).
      {
        const { repo } = await makeRepo();
        try {
          const ctx = await ctxFor(repo);
          const result = await invoke("mesh:status", { now: NOW }, ctx);
          assert.equal(result.isControlNode, false, "an unconfigured node reports isControlNode false (never absent)");
        } finally {
          await rm(repo, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: rendering the issued directives writes nothing — the issuance tree is byte-unchanged ══
  {
    name: "mesh-status-issued/04 rendering the issued directives writes nothing — the issuance partition tree is byte-unchanged",
    async run() {
      const { repo } = await makeRepo({ mesh: { nodeId: "node-a" } });
      try {
        const ctx = await ctxFor(repo);
        await writeDirective(ctx.workspace, "node-a", "27/00", { kind: "any" });
        await writeDirective(ctx.workspace, "node-a", "27/01", { kind: "any" });
        const before = await snapshotIssuanceTree(ctx.workspace);

        await invoke("mesh:status", { now: NOW }, ctx);

        assert.deepEqual(await snapshotIssuanceTree(ctx.workspace), before, "the issuance partition tree is byte-unchanged");
      } finally {
        await rm(repo, { recursive: true, force: true });
      }
    },
  },
];
