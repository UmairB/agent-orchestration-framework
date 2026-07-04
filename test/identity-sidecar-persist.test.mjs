// Traceability wiring for milestone 33 / story 00 — per-install node identity.
//
// Covers EVERY @executable scenario in
// tasks/00_identity-sidecar-persist.feature, exercising src/node-identity.mjs
// IN-PROCESS with INJECTED hostname / salt / sidecarPath (the white-box Build-notes
// requirement — no real-machine coupling), plus a real temp committed-config file to
// assert the "byte-unchanged" scenarios. One test object per @executable scenario
// (Scenario-Outline rows folded into one entry iterating the rows), each name tracing
// to feature + scenario. node:assert/strict.
//
//   00_identity-sidecar-persist.feature — deriveNodeId's persist target is re-pointed
//     from committed config.mesh.nodeId to the git-ignored sidecar
//     .aof/mesh/identity.json (ADR-004.2): a fresh install derives from its own
//     hostname and persists { nodeId, salt } to the sidecar, the committed config left
//     byte-unchanged; the sanitization matrix (empty-stem fallback included) is
//     exercised through the injected hostname; a clone on a different host derives its
//     OWN distinct id (the F-3203 fix); a stem collision appends a stable per-install
//     hash suffix; a sidecar-pinned id wins verbatim and is never re-derived.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { deriveNodeId, installHash } from "../src/node-identity.mjs";

const ID_RE = /^[a-z0-9-]+$/;

// A fresh fixture project: a committed config file (no mesh.nodeId/salt — a fresh
// install) + a sidecar TARGET path (not yet created) under .aof/mesh/identity.json,
// mirroring sidecarPathFor(aofDir)'s real shape.
async function freshFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-identity-sidecar-"));
  const aofDir = path.join(root, ".aof");
  await mkdir(aofDir, { recursive: true });
  const configPath = path.join(aofDir, "aof.config.json");
  const initialConfig = { name: "fixture", work: { dir: "./wiki/work" } };
  await writeFile(configPath, `${JSON.stringify(initialConfig, null, 2)}\n`, "utf8");
  const sidecarPath = path.join(aofDir, "mesh", "identity.json");
  return { root, configPath, sidecarPath, initialConfigBytes: `${JSON.stringify(initialConfig, null, 2)}\n` };
}

async function readSidecar(sidecarPath) {
  return JSON.parse(await readFile(sidecarPath, "utf8"));
}

export const identitySidecarPersistTests = [
  // ══ Scenario: a fresh install derives from its own hostname and persists to the
  //    sidecar, committed config byte-unchanged ═══════════════════════════════════
  {
    name: "identity-sidecar-persist/00 a fresh install derives from its own hostname and persists nodeId+salt to the sidecar, committed config byte-unchanged",
    async run() {
      const { root, configPath, sidecarPath, initialConfigBytes } = await freshFixture();
      try {
        const id = await deriveNodeId({
          config: {},
          hostname: "umairs-msi",
          salt: "fixed-salt-A",
          sidecarPath,
        });
        assert.equal(id, "umairs-msi", "the returned id is the sanitized hostname");
        const sidecar = await readSidecar(sidecarPath);
        assert.deepEqual(sidecar, { nodeId: "umairs-msi", salt: "fixed-salt-A", derivedFrom: "umairs-msi" }, "the sidecar holds nodeId+salt (+derivedFrom)");
        const afterBytes = await readFile(configPath, "utf8");
        assert.equal(afterBytes, initialConfigBytes, "the committed config file is byte-identical (no nodeId/salt written there)");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario Outline: the sidecar's persisted nodeId is the sanitized hostname ═
  {
    name: "identity-sidecar-persist/00 the sidecar's persisted nodeId is the sanitized hostname (empty stem falls back to node-<installHash(salt)>)",
    async run() {
      const rows = [
        ["umairs-msi", "umairs-msi"],
        ["MacBook-Pro.local", "macbook-pro-local"],
        ["Umair's MacBook", "umair-s-macbook"],
        ["umair--__--desktop", "umair-desktop"],
        ["---trim-me---", "trim-me"],
        ["HOST_42", "host-42"],
        ["!!!@@@###", `node-${installHash("fixed-salt-A")}`],
        ["", `node-${installHash("fixed-salt-A")}`],
      ];
      for (const [hostname, expectedId] of rows) {
        const { root, configPath, sidecarPath, initialConfigBytes } = await freshFixture();
        try {
          await deriveNodeId({ config: {}, hostname, salt: "fixed-salt-A", sidecarPath });
          const sidecar = await readSidecar(sidecarPath);
          assert.equal(sidecar.nodeId, expectedId, `"${hostname}" → sidecar nodeId "${expectedId}"`);
          assert.match(sidecar.nodeId, ID_RE, `"${sidecar.nodeId}" is path-safe [a-z0-9-]-only`);
          const afterBytes = await readFile(configPath, "utf8");
          assert.equal(afterBytes, initialConfigBytes, `"${hostname}": committed config left byte-unchanged`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: a clone on a different host derives its own distinct id ═
  {
    name: "identity-sidecar-persist/00 a clone on a different host derives its own distinct sidecar id (the inherited-id bug fixed)",
    async run() {
      const rows = [
        ["macbook-pro", "fixed-salt-B", "macbook-pro"],
        ["build-server", "fixed-salt-C", "build-server"],
        ["ci-runner-07", "fixed-salt-D", "ci-runner-07"],
      ];
      for (const [hostname, salt, expectedId] of rows) {
        const { root, sidecarPath } = await freshFixture();
        try {
          // The committed config carries NO pinned mesh.nodeId (a clone of a migrated
          // repo) — config: {} simulates this (no pin to inherit).
          const id = await deriveNodeId({ config: {}, hostname, salt, sidecarPath });
          const sidecar = await readSidecar(sidecarPath);
          assert.equal(sidecar.nodeId, expectedId, `clone on "${hostname}" derives "${expectedId}"`);
          assert.equal(id, expectedId);
          assert.notEqual(sidecar.nodeId, "umairs-msi", "identity was not inherited from the origin machine");
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: two same-host installs with distinct salts persist distinct suffixed
  //    sidecar ids ═════════════════════════════════════════════════════════════════
  {
    name: "identity-sidecar-persist/00 two same-host installs with distinct salts persist distinct suffixed sidecar ids",
    async run() {
      const { root: rootA, sidecarPath: sidecarPathA } = await freshFixture();
      const { root: rootB, sidecarPath: sidecarPathB } = await freshFixture();
      try {
        const idA = await deriveNodeId({
          config: {}, hostname: "shared-host", salt: "fixed-salt-A", takenIds: ["shared-host"], sidecarPath: sidecarPathA,
        });
        const idB = await deriveNodeId({
          config: {}, hostname: "shared-host", salt: "fixed-salt-B", takenIds: ["shared-host"], sidecarPath: sidecarPathB,
        });
        assert.equal(idA, `shared-host-${installHash("fixed-salt-A")}`);
        assert.equal(idB, `shared-host-${installHash("fixed-salt-B")}`);
        assert.notEqual(idA, idB, "distinct salts ⇒ distinct installs");
        assert.equal((await readSidecar(sidecarPathA)).nodeId, idA);
        assert.equal((await readSidecar(sidecarPathB)).nodeId, idB);
      } finally {
        await rm(rootA, { recursive: true, force: true });
        await rm(rootB, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a sidecar-pinned nodeId wins verbatim and is not re-derived ══════
  {
    name: "identity-sidecar-persist/00 a sidecar-pinned nodeId wins verbatim and is not re-derived from the hostname",
    async run() {
      const { root, configPath, sidecarPath, initialConfigBytes } = await freshFixture();
      try {
        // The sidecar already holds a pinned id (per-install, not committed) — simulated
        // as the ALREADY-HYDRATED config a caller (loadWorkspace) would hand in.
        const config = { mesh: { nodeId: "operator-choice" } };
        const id = await deriveNodeId({ config, hostname: "some-other-host", salt: "s", sidecarPath });
        assert.equal(id, "operator-choice", "the pin wins verbatim, never re-derived");
        const afterBytes = await readFile(configPath, "utf8");
        assert.equal(afterBytes, initialConfigBytes, "the committed config is left byte-unchanged (the pin never travels to committed config)");
        // A pinned id short-circuits before any persist — no sidecar write happens here.
        await assert.rejects(readFile(sidecarPath, "utf8"), "no sidecar write for an already-pinned id");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
