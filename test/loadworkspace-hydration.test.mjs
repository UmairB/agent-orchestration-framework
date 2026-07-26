// Traceability wiring for milestone 33 / story 00 — per-install node identity.
//
// Covers EVERY @executable scenario in tasks/01_loadworkspace-hydration.feature,
// exercising src/work.mjs's loadWorkspace IN-PROCESS against a real temp fixture
// project (a planted committed config + an optionally-planted sidecar). One test
// object per @executable scenario (Scenario-Outline rows folded into one entry
// iterating the rows), each name tracing to feature + scenario. node:assert/strict.
//
//   01_loadworkspace-hydration.feature — loadWorkspace overlays the sidecar's
//     nodeId/salt onto config.mesh in the returned in-memory workspace; precedence
//     sidecar > committed-fallback > (neither → absent, no derive); a downstream
//     config.mesh.nodeId reader (the mesh-gate predicate) sees the hydrated sidecar
//     id; a malformed/empty sidecar degrades to the committed fallback, never a
//     crash; loadWorkspace writes NO file across every precedence scenario here.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadWorkspace } from "../src/work.mjs";
import { meshNodeIdOf } from "../src/commands/mesh-gate.mjs";

async function fixtureProject({ committedMesh, sidecar } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-hydration-"));
  const aofDir = path.join(root, ".aof");
  await mkdir(aofDir, { recursive: true });
  const configPath = path.join(aofDir, "aof.config.json");
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (committedMesh !== undefined) config.mesh = committedMesh;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");

  const sidecarPath = path.join(aofDir, "mesh", "identity.json");
  if (sidecar !== undefined) {
    await mkdir(path.dirname(sidecarPath), { recursive: true });
    if (typeof sidecar === "string") {
      await writeFile(sidecarPath, sidecar, "utf8");
    } else {
      await writeFile(sidecarPath, `${JSON.stringify(sidecar, null, 2)}\n`, "utf8");
    }
  }
  return { root, configPath, sidecarPath };
}

async function snapshotBytes(...paths) {
  const bytes = {};
  for (const p of paths) {
    try {
      bytes[p] = await readFile(p, "utf8");
    } catch {
      bytes[p] = null;
    }
  }
  return bytes;
}

export const loadworkspaceHydrationTests = [
  // ══ Scenario Outline: precedence — sidecar > committed-fallback > (neither → absent) ═
  {
    name: "loadworkspace-hydration/01 loadWorkspace returns nodeId per precedence — sidecar > committed-fallback > (neither → absent)",
    async run() {
      const rows = [
        { committed: undefined, sidecar: { nodeId: "sidecar-id" }, resolved: "sidecar-id" },
        { committed: "committed-id", sidecar: undefined, resolved: "committed-id" },
        { committed: "committed-id", sidecar: { nodeId: "sidecar-id" }, resolved: "sidecar-id" },
        { committed: undefined, sidecar: undefined, resolved: undefined },
      ];
      for (const { committed, sidecar, resolved } of rows) {
        const committedMesh = committed !== undefined ? { nodeId: committed } : undefined;
        const { root, configPath, sidecarPath } = await fixtureProject({ committedMesh, sidecar });
        try {
          const before = await snapshotBytes(configPath, sidecarPath);
          const ws = await loadWorkspace(root);
          assert.equal(ws.config?.mesh?.nodeId, resolved, `committed=${committed} sidecar=${JSON.stringify(sidecar)} → resolved ${resolved}`);
          const after = await snapshotBytes(configPath, sidecarPath);
          assert.deepEqual(after, before, "loadWorkspace wrote NO file (neither config nor sidecar changed on disk)");
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: salt is hydrated the same way ═══════════════════════════
  {
    name: "loadworkspace-hydration/01 loadWorkspace hydrates config.mesh.salt with the same precedence as nodeId",
    async run() {
      const rows = [
        { committed: undefined, sidecar: { nodeId: "n", salt: "sidecar-salt" }, resolved: "sidecar-salt" },
        { committed: "committed-salt", sidecar: undefined, resolved: "committed-salt" },
        { committed: "committed-salt", sidecar: { nodeId: "n", salt: "sidecar-salt" }, resolved: "sidecar-salt" },
      ];
      for (const { committed, sidecar, resolved } of rows) {
        const committedMesh = committed !== undefined ? { nodeId: "committed-id", salt: committed } : undefined;
        const { root } = await fixtureProject({ committedMesh, sidecar });
        try {
          const ws = await loadWorkspace(root);
          assert.equal(ws.config?.mesh?.salt, resolved, `committed=${committed} sidecar=${JSON.stringify(sidecar)} → resolved salt ${resolved}`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ REGRESSION (craft/architect review): a nodeId-only sidecar must NOT clobber a
  //    present committed salt with undefined ═══════════════════════════════════════
  // The nodeId and salt overlays are gated INDEPENDENTLY — a sidecar carrying only
  // nodeId (no salt key at all) must leave a present committed config.mesh.salt as the
  // surviving fallback, not overwrite it with undefined (which would otherwise churn
  // resolveInstallSalt into minting a fresh salt on next use).
  {
    name: "loadworkspace-hydration/01 REGRESSION: a nodeId-only sidecar does not clobber a present committed salt with undefined",
    async run() {
      const { root } = await fixtureProject({
        committedMesh: { nodeId: "committed-id", salt: "committed-salt" },
        sidecar: { nodeId: "n" },
      });
      try {
        const ws = await loadWorkspace(root);
        assert.equal(ws.config.mesh.nodeId, "n", "the sidecar's nodeId wins (sidecar > committed)");
        assert.equal(ws.config.mesh.salt, "committed-salt", "the committed salt SURVIVES as the fallback — not clobbered to undefined");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a downstream reader sees the hydrated sidecar id (zero reader change) ═
  {
    name: "loadworkspace-hydration/01 a downstream config.mesh.nodeId reader sees the hydrated sidecar id (zero reader change)",
    async run() {
      const { root } = await fixtureProject({
        committedMesh: { nodeId: "umairs-msi" },
        sidecar: { nodeId: "macbook-pro", salt: "s" },
      });
      try {
        const ws = await loadWorkspace(root);
        assert.equal(ws.config.mesh.nodeId, "macbook-pro", "the returned workspace carries the sidecar id");
        assert.equal(meshNodeIdOf(ws.config), "macbook-pro", "the mesh-gate predicate resolves the per-install id");
        assert.notEqual(meshNodeIdOf(ws.config), "umairs-msi", "no downstream reader observes the legacy committed id");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: a malformed/empty sidecar degrades to the committed fallback ═
  {
    name: "loadworkspace-hydration/01 a malformed or empty sidecar degrades to the committed fallback, never a crash",
    async run() {
      const rows = [
        "not-valid-json{{{",
        "",
        JSON.stringify({ nodeId: "" }),
        JSON.stringify({ salt: "s-only" }),
      ];
      for (const sidecarBytes of rows) {
        const { root } = await fixtureProject({
          committedMesh: { nodeId: "committed-fallback-id" },
          sidecar: sidecarBytes,
        });
        try {
          let ws, threw = false;
          try {
            ws = await loadWorkspace(root);
          } catch {
            threw = true;
          }
          assert.equal(threw, false, `loadWorkspace does not throw on sidecar bytes ${JSON.stringify(sidecarBytes)}`);
          assert.equal(ws.config.mesh.nodeId, "committed-fallback-id", "degraded to the committed fallback");
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },
];
