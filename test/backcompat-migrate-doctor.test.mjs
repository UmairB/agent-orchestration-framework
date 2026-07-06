// Traceability wiring for milestone 33 / story 00 — per-install node identity.
//
// Covers EVERY @executable scenario in tasks/02_backcompat-migrate-doctor.feature,
// exercising src/node-identity.mjs's migrateIdentity IN-PROCESS over injected
// committed-config/sidecar paths, and src/commands/doctor.mjs's `work:doctor`
// mesh-identity-committed warn-group via the real command core against a temp
// fixture repo. One test object per @executable scenario (Scenario-Outline rows
// folded into one entry iterating the rows), each name tracing to feature +
// scenario. node:assert/strict.
//
//   02_backcompat-migrate-doctor.feature — a legacy committed mesh.nodeId with no
//     sidecar stays a working fallback AND work doctor warns "mesh-identity-committed"
//     off the RAW committed config (never the hydrated ctx.config); the migrate moves
//     nodeId/salt to the sidecar and strips them from committed config, preserving
//     fleet-shared sibling keys; the migrate is idempotent and absence-tolerant.
import assert from "node:assert/strict";
import { mkdtemp, rm, mkdir, writeFile, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { migrateIdentity } from "../src/node-identity.mjs";
import { invoke } from "../src/command-core.mjs";
import { loadWorkspace } from "../src/work.mjs";

async function fixtureRepo({ committedMesh } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "aof-migrate-doctor-"));
  const aofDir = path.join(root, ".aof");
  const workDir = path.join(root, "wiki", "work");
  await mkdir(aofDir, { recursive: true });
  await mkdir(workDir, { recursive: true });
  const configPath = path.join(aofDir, "aof.config.json");
  const config = { name: "fixture", work: { dir: "./wiki/work" } };
  if (committedMesh !== undefined) config.mesh = committedMesh;
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  const sidecarPath = path.join(aofDir, "mesh", "identity.json");
  return { root, configPath, sidecarPath };
}

async function runDoctor(root) {
  const ctx = { workspace: await loadWorkspace(root) };
  return invoke("work:doctor", {}, ctx);
}

async function readJsonOrAbsent(target) {
  try {
    return JSON.parse(await readFile(target, "utf8"));
  } catch {
    return undefined;
  }
}

export const backcompatMigrateDoctorTests = [
  // ══ Scenario Outline: work doctor warns mesh-identity-committed iff the committed
  //    config carries nodeId or salt ═══════════════════════════════════════════════
  {
    name: "backcompat-migrate-doctor/02 work doctor warns mesh-identity-committed iff the committed config carries nodeId or salt",
    async run() {
      const rows = [
        { committedMesh: { nodeId: "umairs-msi", salt: "s" }, emitted: true },
        { committedMesh: { nodeId: "umairs-msi" }, emitted: true },
        { committedMesh: { salt: "s" }, emitted: true },
        { committedMesh: { relay: { controlNode: "n" }, fabric: "tailscale" }, emitted: false },
        { committedMesh: undefined, emitted: false },
      ];
      for (const { committedMesh, emitted } of rows) {
        const { root, configPath } = await fixtureRepo({ committedMesh });
        try {
          const result = await runDoctor(root);
          const finding = result.findings.find((f) => f.code === "mesh-identity-committed");
          if (emitted) {
            assert.ok(finding, `a warn IS emitted for committed mesh ${JSON.stringify(committedMesh)}`);
            assert.equal(finding.severity, "warn");
            assert.equal(finding.path, configPath, "anchored at the committed config path");
            // 34/story 05: identity is now MACHINE-WIDE (global AOF home), so the migrate
            // target the warn names is the global home, not the legacy per-workspace sidecar.
            assert.match(finding.message, /global AOF home/, "message names the machine-wide global home as the migrate target");
            assert.match(finding.message, /F-3203/, "message names the F-3203 migration");
          } else {
            assert.equal(finding, undefined, `NO warn is emitted for committed mesh ${JSON.stringify(committedMesh)}`);
          }
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario Outline: migrate moves+strips, no-op when already-migrated or absent ═
  {
    name: "backcompat-migrate-doctor/02 migrate moves+strips committed identity to the sidecar, and is a clean no-op when already-migrated or absent",
    async run() {
      const rows = [
        {
          committedBefore: { nodeId: "umairs-msi", salt: "sA" },
          sidecarBefore: undefined,
          committedAfter: {},
          sidecarAfter: { nodeId: "umairs-msi", salt: "sA" },
          case: "migrate",
        },
        {
          committedBefore: undefined,
          sidecarBefore: { nodeId: "umairs-msi", salt: "sA" },
          committedAfter: undefined,
          sidecarAfter: { nodeId: "umairs-msi", salt: "sA" },
          case: "already-migrated",
        },
        {
          committedBefore: undefined,
          sidecarBefore: undefined,
          committedAfter: undefined,
          sidecarAfter: undefined,
          case: "absent-no-op",
        },
      ];
      for (const row of rows) {
        const { root, configPath, sidecarPath } = await fixtureRepo({ committedMesh: row.committedBefore });
        try {
          if (row.sidecarBefore !== undefined) {
            await mkdir(path.dirname(sidecarPath), { recursive: true });
            await writeFile(sidecarPath, `${JSON.stringify(row.sidecarBefore, null, 2)}\n`, "utf8");
          }
          const configBytesBefore = await readFile(configPath, "utf8");
          const sidecarBytesBefore = await readJsonOrAbsent(sidecarPath);

          await migrateIdentity(configPath, sidecarPath);

          const configAfter = JSON.parse(await readFile(configPath, "utf8"));
          const sidecarAfter = await readJsonOrAbsent(sidecarPath);

          if (row.case === "migrate") {
            assert.deepEqual(configAfter.mesh, row.committedAfter, `${row.case}: committed mesh stripped`);
            assert.deepEqual(sidecarAfter, row.sidecarAfter, `${row.case}: sidecar gains the identity`);
          } else {
            // already-migrated / absent-no-op: byte-unchanged.
            assert.equal(await readFile(configPath, "utf8"), configBytesBefore, `${row.case}: committed config byte-unchanged`);
            assert.deepEqual(sidecarAfter, sidecarBytesBefore, `${row.case}: sidecar unchanged`);
          }
          assert.ok(!("nodeId" in (configAfter.mesh ?? {})) && !("salt" in (configAfter.mesh ?? {})), `${row.case}: committed carries no identity after migrate`);
        } finally {
          await rm(root, { recursive: true, force: true });
        }
      }
    },
  },

  // ══ Scenario: the migrate preserves sibling fleet-shared committed mesh keys ═══
  {
    name: "backcompat-migrate-doctor/02 the migrate strips only nodeId/salt and leaves fleet-shared committed mesh keys intact",
    async run() {
      const { root, configPath, sidecarPath } = await fixtureRepo({
        committedMesh: { nodeId: "umairs-msi", salt: "sA", relay: { controlNode: "umairs-msi" }, fabric: "tailscale" },
      });
      try {
        await migrateIdentity(configPath, sidecarPath);
        const configAfter = JSON.parse(await readFile(configPath, "utf8"));
        assert.deepEqual(configAfter.mesh, { relay: { controlNode: "umairs-msi" }, fabric: "tailscale" }, "fleet-shared keys survive");
        assert.ok(!("nodeId" in configAfter.mesh) && !("salt" in configAfter.mesh));
        const sidecar = JSON.parse(await readFile(sidecarPath, "utf8"));
        assert.deepEqual(sidecar, { nodeId: "umairs-msi", salt: "sA" }, "the sidecar holds exactly the stripped identity");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },

  // ══ Scenario: a second migrate over an already-migrated repo rewrites nothing ═══
  {
    name: "backcompat-migrate-doctor/02 a second migrate over an already-migrated repo rewrites nothing (byte-level no-op)",
    async run() {
      const { root, configPath, sidecarPath } = await fixtureRepo({ committedMesh: { nodeId: "umairs-msi", salt: "sA" } });
      try {
        await migrateIdentity(configPath, sidecarPath);
        const configAfterFirst = await readFile(configPath, "utf8");
        const sidecarAfterFirst = await readFile(sidecarPath, "utf8");

        await migrateIdentity(configPath, sidecarPath);
        const configAfterSecond = await readFile(configPath, "utf8");
        const sidecarAfterSecond = await readFile(sidecarPath, "utf8");

        assert.equal(configAfterSecond, configAfterFirst, "committed config byte-identical after a second migrate");
        assert.equal(sidecarAfterSecond, sidecarAfterFirst, "sidecar byte-identical after a second migrate");

        const result = await runDoctor(root);
        assert.equal(result.findings.find((f) => f.code === "mesh-identity-committed"), undefined, "no warn after migration");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  },
];
